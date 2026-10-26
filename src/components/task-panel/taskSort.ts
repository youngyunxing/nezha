import type { Task } from "../../types";

// 任务列表排序（TaskList 的 sorted）。抽成纯函数是为了能直接单测 —— 之前的内联比较器
// 不是全序：「只有一边排过 → 按新旧插」这条规则能构造出 A<B<C<A 的循环
//（A 排过且最新、B 没排过居中、C 排过且最旧：A<B 因 B 旧，B<C 因 B 新，C<A 因位次小），
// 不同引擎 / 不同数组长度下排序结果会乱跳。
//
// 修法是分档（tier），同档内部的比较各自是全序：
//   tier 0：没排过、但比「排过的里最旧那条」还新 → 顶部，按时间倒序（新活别沉底）
//   tier 1：排过的 → 按手排位次升序
//   tier 2：没排过、比排过的最旧那条还旧 → 底部，按时间倒序（展示范围窗口外的旧任务
//           切到「所有任务」时不该压到手排结果上面）

function sortKey(task: Task): number {
  return task.updatedAt ?? task.createdAt;
}

function needsAttention(task: Task): boolean {
  return (
    task.status === "input_required" ||
    task.status === "awaiting_review" ||
    task.status === "interrupted"
  );
}

function isFinished(task: Task): boolean {
  return task.status === "done" || task.status === "failed" || task.status === "cancelled";
}

/** 大档：等你/待恢复 = 0，正常 = 1，结束态沉底 = 2 */
function rank(task: Task): number {
  return needsAttention(task) ? 0 : isFinished(task) ? 2 : 1;
}

/** 「没排过」的任务拿什么跟排过的比新旧：等你/待恢复那档本来就按 attentionRequestedAt 排 */
function recencyKey(task: Task): number {
  return rank(task) === 0 ? (task.attentionRequestedAt ?? sortKey(task)) : sortKey(task);
}

export function sortTasks(tasks: Task[]): Task[] {
  // 每个大档各自算「排过的任务里最旧的时间」作新旧分界线
  const minOrderedRecency = new Map<number, number>();
  for (const task of tasks) {
    if (task.order === undefined) continue;
    const r = rank(task);
    const recency = recencyKey(task);
    const prev = minOrderedRecency.get(r);
    if (prev === undefined || recency < prev) minOrderedRecency.set(r, recency);
  }

  const tierOf = (task: Task): number => {
    if (task.order !== undefined) return 1;
    const boundary = minOrderedRecency.get(rank(task)) ?? Number.NEGATIVE_INFINITY;
    return recencyKey(task) > boundary ? 0 : 2;
  };

  return [...tasks].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    const tierDiff = tierOf(a) - tierOf(b);
    if (tierDiff !== 0) return tierDiff;
    // 同档：排过的按位次，没排过的按时间倒序
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
    return recencyKey(b) - recencyKey(a);
  });
}
