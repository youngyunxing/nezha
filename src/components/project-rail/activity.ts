import type { Task } from "../../types";
import { isUnreadAttention, type AttentionSeenMap } from "../../attentionSeen";

export type ProjectStatus = "attention" | "running" | null;

export type ProjectActivity = {
  status: ProjectStatus;
  attentionCount: number;
};

export const EMPTY_PROJECT_ACTIVITY: ProjectActivity = { status: null, attentionCount: 0 };

export function getProjectActivity(
  activityByProjectId: Map<string, ProjectActivity>,
  projectId: string,
): ProjectActivity {
  return activityByProjectId.get(projectId) ?? EMPTY_PROJECT_ACTIVITY;
}

export function buildProjectActivityMap(
  tasks: Task[],
  seen: AttentionSeenMap = {},
): Map<string, ProjectActivity> {
  const activityByProjectId = new Map<string, ProjectActivity>();
  for (const task of tasks) {
    let activity = activityByProjectId.get(task.projectId);
    if (!activity) {
      activity = { status: null, attentionCount: 0 };
      activityByProjectId.set(task.projectId, activity);
    }

    if (task.status === "input_required" || task.status === "awaiting_review") {
      // 看过的等待不再亮标：小标只提示「有你还没看到的」
      if (isUnreadAttention(task, seen)) {
        activity.attentionCount += 1;
        activity.status = "attention";
      }
    } else if (task.status === "interrupted") {
      if (isUnreadAttention(task, seen)) activity.status = "attention";
    } else if (
        (task.status === "running" || task.status === "pending" || task.status === "idle") &&
        activity.status === null
      ) {
      activity.status = "running";
    }
  }
  return activityByProjectId;
}
