import { isActiveTaskStatus, type Task, type TaskStatus } from "./types";

/**
 * 启动时把「进程已经不在的活跃任务」归一化成 `interrupted`（待恢复）。
 *
 * 用 `processAlive` 区分两种待恢复：进程还在 → 点「重连」；进程没了 → 点「恢复」。
 *
 * 顺带回一份 `wasWorkingIds`：**归一化之前**它是不是真的在干活（`pending` / `running`）。
 * 原始状态在这一步会被抹掉，而启动时的自动续跑只该管这一批 —— 见 App 里那段注释。
 */
export function normalizeInterruptedTasksOnStartup(
  tasks: Task[],
  activeTaskIds: Set<string>,
): {
  tasks: Task[];
  changedProjectIds: Set<string>;
  /** 归一化前状态是 pending / running 的任务 id（真正在干活的） */
  wasWorkingIds: Set<string>;
} {
  const interruptedAt = Date.now();
  const changedProjectIds = new Set<string>();
  const wasWorkingIds = new Set<string>();
  const normalized = tasks.map((task) => {
    const hasLiveChild = activeTaskIds.has(task.id);
    if (!isActiveTaskStatus(task.status) && !(task.status === "interrupted" && hasLiveChild)) {
      return task;
    }

    // 「它当时到底在干什么」只有这里知道 —— 过了这村就没这店了（下一句就把状态改掉）
    if (task.status === "pending" || task.status === "running") {
      wasWorkingIds.add(task.id);
    }

    if (!hasLiveChild && task.status === "interrupted" && !task.processAlive) return task;
    changedProjectIds.add(task.projectId);
    return {
      ...task,
      status: "interrupted" as TaskStatus,
      processAlive: hasLiveChild,
      updatedAt: interruptedAt,
      attentionRequestedAt: task.attentionRequestedAt ?? interruptedAt,
    };
  });

  return { tasks: normalized, changedProjectIds, wasWorkingIds };
}
