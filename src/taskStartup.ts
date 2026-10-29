import {
  isActiveTaskStatus,
  taskSessionId,
  taskSessionPath,
  type Project,
  type Task,
  type TaskStatus,
} from "./types";
import { isVisibleTask } from "./taskDeletion";

/**
 * 启动时把「进程已经不在的活跃任务」归一化成 `interrupted`（待恢复）。
 *
 * 用 `processAlive` 区分两种待恢复：进程还在 → 点「重连」；进程没了 → 点「恢复」。
 *
 * ⚠️ 2026-10-13 记一笔：这里曾经顺手回一份 `wasWorkingIds`（归一化前谁真在干活），
 * 让启动时的自动续跑只恢复那一批 —— **被用户否了**：「中断待恢复就自动恢复，这是之前
 * 说过的逻辑」。所以别再加这个筛选：待恢复的一律自动续跑，是既定设计。
 */
export function normalizeInterruptedTasksOnStartup(
  tasks: Task[],
  activeTaskIds: Set<string>,
): {
  tasks: Task[];
  changedProjectIds: Set<string>;
} {
  const interruptedAt = Date.now();
  const changedProjectIds = new Set<string>();
  const normalized = tasks.map((task) => {
    const hasLiveChild = activeTaskIds.has(task.id);
    if (!isActiveTaskStatus(task.status) && !(task.status === "interrupted" && hasLiveChild)) {
      return task;
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

  return { tasks: normalized, changedProjectIds };
}

/** 启动时自动续跑的一条候选。 */
export interface StartupAutoResumeCandidate {
  task: Task;
  project: Project;
  /** 纯终端任务没有会话可 resume（null = 重开一个 shell） */
  sessionId: string | null;
}

/**
 * 启动时该自动续跑哪些任务（判据集中在这里，便于测试钉住）。
 *
 * ⚠️ 只钉「哪些不续 / 哪些续」的事实，**不要加回「谁当时在干活」那类筛选** ——
 * 2026-10-13 加过一版按 pending/running 过滤的，被用户否了（见上方注释）。
 *
 * 三条规则：
 * - **软删除的任务一律不续**：记录还在 tasks.json 里（「历史」组能恢复），但它不在
 *   任务列表里，跑起来就是个看不见的后台 agent，而且每次启动都会被重新拉起；
 * - 有活子进程的交给「重连」路径，免得起第二个 claude；
 * - 非 shell 任务必须有会话 id + 路径（只有 id 的多半是刚建好就被带走的，--resume 必然失败）。
 */
export function selectStartupAutoResumeTasks(
  tasks: readonly Task[],
  projects: readonly Project[],
  activeTaskIds: ReadonlySet<string>,
): StartupAutoResumeCandidate[] {
  const out: StartupAutoResumeCandidate[] = [];
  for (const task of tasks) {
    if (!isVisibleTask(task)) continue;
    if (task.status !== "interrupted" || activeTaskIds.has(task.id)) continue;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) continue;
    if (task.agent === "shell") {
      out.push({ task, project, sessionId: null });
      continue;
    }
    const sessionId = taskSessionId(task);
    const sessionPath = taskSessionPath(task);
    if (!sessionId || !sessionPath) continue;
    out.push({ task, project, sessionId });
  }
  return out;
}

/** 当前屏幕要显示的会话最先恢复；同项目其他任务其次，其余保持原顺序。 */
export function prioritizeStartupAutoResumeTasks(
  candidates: readonly StartupAutoResumeCandidate[],
  selectedTaskId?: string | null,
  activeProjectId?: string | null,
): StartupAutoResumeCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const selectedRank = (id: string) => (id === selectedTaskId ? 0 : 1);
      const projectRank = (id: string) => (id === activeProjectId ? 0 : 1);
      return (
        selectedRank(a.candidate.task.id) - selectedRank(b.candidate.task.id) ||
        projectRank(a.candidate.task.projectId) - projectRank(b.candidate.task.projectId) ||
        a.index - b.index
      );
    })
    .map(({ candidate }) => candidate);
}

/** 保留全部启动任务，但限制同时进入恢复阶段的数量。 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const laneCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;
  const lanes = Array.from({ length: laneCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
