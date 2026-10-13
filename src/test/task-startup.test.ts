import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { normalizeInterruptedTasksOnStartup } from "../taskStartup";

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

describe("启动对账：谁算「当时在干活」", () => {
  it("running / pending 算 —— 机器是干活途中被带走的", () => {
    const { wasWorkingIds } = normalizeInterruptedTasksOnStartup(
      [task("a", { status: "running" }), task("b", { status: "pending" })],
      new Set(),
    );
    expect([...wasWorkingIds].sort()).toEqual(["a", "b"]);
  });

  it("停在等你 / 答完待读 / 它在问你 都不算 —— 重启后不该替它们续命", () => {
    // 用户报的「重启电脑后很多变成正在处理」就是这些被自动 --resume 拉起来了：
    // 它们本来已经答完、停在等你了，拉起来只会多一堆 claude 进程 + 一个假状态
    const { wasWorkingIds } = normalizeInterruptedTasksOnStartup(
      [
        task("idle", { status: "idle" }),
        task("review", { status: "awaiting_review" }),
        task("input", { status: "input_required" }),
      ],
      new Set(),
    );
    expect([...wasWorkingIds]).toEqual([]);
  });

  it("归一化本身照旧：活跃状态一律落 interrupted（进程没了 → 点恢复）", () => {
    const { tasks, changedProjectIds } = normalizeInterruptedTasksOnStartup(
      [task("a", { status: "idle" })],
      new Set(),
    );
    expect(tasks[0].status).toBe("interrupted");
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

  it("早就搁着的「待恢复」原样不动，也不再被算成在干活", () => {
    const parked = task("a", { status: "interrupted", processAlive: false });
    const { tasks, wasWorkingIds } = normalizeInterruptedTasksOnStartup([parked], new Set());
    // 同一个对象引用：没变就不该产生新数组（列表不会白刷）
    expect(tasks[0]).toBe(parked);
    expect(wasWorkingIds.has("a")).toBe(false);
  });

  it("已完成 / 已取消的不碰", () => {
    const done = task("d", { status: "done" });
    const cancelled = task("c", { status: "cancelled" });
    const { tasks, wasWorkingIds } = normalizeInterruptedTasksOnStartup(
      [done, cancelled],
      new Set(),
    );
    expect(tasks[0]).toBe(done);
    expect(tasks[1]).toBe(cancelled);
    expect([...wasWorkingIds]).toEqual([]);
  });
});
