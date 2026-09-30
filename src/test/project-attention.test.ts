import { describe, expect, it } from "vitest";
import { buildProjectActivityMap } from "../components/project-rail/activity";
import { isUnreadAttention } from "../attentionSeen";
import type { Task, TaskStatus } from "../types";

function task(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "p1",
    name: id,
    prompt: "",
    agent: "claude",
    permissionMode: "full_access",
    status,
    createdAt: 1000,
    ...extra,
  };
}

describe("项目小标的已读机制", () => {
  it("等待事件晚于已读时间才亮标", () => {
    const tasks = [task("a", "awaiting_review", { attentionRequestedAt: 5000 })];
    expect(buildProjectActivityMap(tasks, {}).get("p1")?.status).toBe("attention");
    expect(buildProjectActivityMap(tasks, { p1: 4000 }).get("p1")?.status).toBe("attention");
    // 看过之后（已读时间晚于事件）小标消失
    expect(buildProjectActivityMap(tasks, { p1: 6000 }).get("p1")).toEqual({
      status: null,
      attentionCount: 0,
    });
  });

  it("数量角标只数没看过的那些", () => {
    const tasks = [
      task("a", "input_required", { attentionRequestedAt: 5000 }),
      task("b", "awaiting_review", { attentionRequestedAt: 3000 }),
    ];
    expect(buildProjectActivityMap(tasks, { p1: 4000 }).get("p1")?.attentionCount).toBe(1);
  });

  it("看过的中断不再亮标，但活跃会话仍然是绿灯", () => {
    const interrupted = [task("a", "interrupted", { attentionRequestedAt: 3000 })];
    expect(buildProjectActivityMap(interrupted, { p1: 4000 }).get("p1")?.status).toBeNull();
    const live = [task("b", "idle")];
    expect(buildProjectActivityMap(live, { p1: 999999 }).get("p1")?.status).toBe("running");
  });

  it("归档的任务不参与小标（等待 / 中断 / 运行都不算）", () => {
    const seen = {};
    const archivedWaiting = buildProjectActivityMap(
      [task("t1", "input_required", { archived: true })],
      seen,
    );
    expect(archivedWaiting.get("p1")?.attentionCount ?? 0).toBe(0);
    expect(archivedWaiting.get("p1")?.status ?? null).toBeNull();

    const archivedRunning = buildProjectActivityMap(
      [task("t2", "running", { archived: true })],
      seen,
    );
    expect(archivedRunning.get("p1")?.status ?? null).toBeNull();
  });

  it("缺少 attentionRequestedAt 时回落到 updatedAt / createdAt", () => {
    expect(isUnreadAttention({ projectId: "p1", createdAt: 1000, updatedAt: 9000 }, { p1: 5000 })).toBe(true);
    expect(isUnreadAttention({ projectId: "p1", createdAt: 1000, updatedAt: 9000 }, { p1: 9500 })).toBe(false);
    expect(isUnreadAttention({ projectId: "p1", createdAt: 7000 }, { p1: 5000 })).toBe(true);
  });
});
