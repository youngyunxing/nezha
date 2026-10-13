import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { normalizeInterruptedTasksOnStartup } from "../taskStartup";

/**
 * 只钉「归一化」本身。
 *
 * ⚠️ 这里**故意没有**「谁该被自动续跑」的测试：2026-10-13 曾经加过一版筛选
 * （只自动恢复归一化前在 pending/running 的），被用户否了 —— 「中断待恢复就自动恢复，
 * 这是之前说过的逻辑」。所以启动时的自动续跑是无条件的（只要 interrupted 且有会话），
 * 别再往 taskStartup 里加"谁算在干活"的判据。
 */
function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "p1",
    name: `任务 ${id}`,
    prompt: "做点事",
    agent: "claude",
    permissionMode: "full_access",
    status: "running",
    createdAt: 1,
    ...over,
  };
}

describe("启动对账：进程已不在的活跃任务落成「待恢复」", () => {
  it("活跃状态一律落 interrupted（进程没了 → 点恢复）", () => {
    const { tasks, changedProjectIds } = normalizeInterruptedTasksOnStartup(
      [task("a", { status: "idle" }), task("b", { status: "awaiting_review" })],
      new Set(),
    );
    expect(tasks.map((t) => t.status)).toEqual(["interrupted", "interrupted"]);
    expect(tasks[0].processAlive).toBe(false);
    expect(changedProjectIds.has("p1")).toBe(true);
  });

  it("进程还在的落 interrupted + processAlive（点重连，不抢着重开一个）", () => {
    const { tasks } = normalizeInterruptedTasksOnStartup(
      [task("a", { status: "running" })],
      new Set(["a"]),
    );
    expect(tasks[0].status).toBe("interrupted");
    expect(tasks[0].processAlive).toBe(true);
  });

  it("早就搁着的「待恢复」原样不动（同一个对象引用，列表不会白刷）", () => {
    const parked = task("a", { status: "interrupted", processAlive: false });
    const { tasks } = normalizeInterruptedTasksOnStartup([parked], new Set());
    expect(tasks[0]).toBe(parked);
  });

  it("已完成 / 已取消的不碰", () => {
    const done = task("d", { status: "done" });
    const cancelled = task("c", { status: "cancelled" });
    const { tasks } = normalizeInterruptedTasksOnStartup([done, cancelled], new Set());
    expect(tasks[0]).toBe(done);
    expect(tasks[1]).toBe(cancelled);
  });
});
