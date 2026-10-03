import { isActiveTaskStatus, type Task } from "./types";

/** 任务是不是还该出现在界面上。删除只打标记，记录留在磁盘上（可恢复），所以读的时候要过滤。 */
export function isVisibleTask(task: Task): boolean {
  return task.deleted !== true;
}

/**
 * 删除任务 = 打 `deleted` 标记，**不从数组里摘掉**。
 *
 * 这样 tasks.json 里那条记录原样留着（名字、状态、会话 id、worktree 信息），以后要做「回收站」
 * 或者手工恢复都还有得救；界面靠 isVisibleTask 过滤掉它。
 *
 * 真会丢的只有两样，都在调用方处理：正在跑的进程（必须杀，否则成了没有界面的后台 agent）、
 * worktree 任务的工作树与分支（删前会确认）。
 */
export function softDeleteTasks(tasks: Task[], ids: readonly string[]): Task[] {
  const target = new Set(ids);
  let changed = false;
  const deletedAt = Date.now();
  const next = tasks.map((task) => {
    if (!target.has(task.id) || task.deleted) return task;
    changed = true;
    return {
      ...task,
      deleted: true,
      // 在跑的会话会被调用方停掉（否则成了没界面的后台 agent），状态跟着落成 interrupted
      status: isActiveTaskStatus(task.status) ? ("interrupted" as const) : task.status,
      updatedAt: deletedAt,
    };
  });
  return changed ? next : tasks;
}
