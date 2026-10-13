import { isActiveTaskStatus, type Task, type TaskStatus } from "./types";

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
