import { describe, expect, it } from "vitest";
import type { Project, Task } from "../types";
import { normalizeInterruptedTasksOnStartup, selectStartupAutoResumeTasks } from "../taskStartup";

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

describe("启动自动续跑：软删除的任务绝不复活", () => {
  const project: Project = { id: "p1", name: "项目", path: "/tmp/p1", lastOpenedAt: 1 };

  it("已删除的任务即使还是 interrupted 也不续 —— 它不在列表里，跑起来就是看不见的后台 agent", () => {
    const deleted = task("gone", {
      status: "interrupted",
      deleted: true,
      claudeSessionId: "s1",
      claudeSessionPath: "/tmp/s1.jsonl",
    });
    const picked = selectStartupAutoResumeTasks([deleted], [project], new Set());
    expect(picked).toEqual([]);
  });

  it("已删除的纯终端任务也不续（这条以前会每次启动都开一个 shell）", () => {
    const deletedShell = task("gone-shell", {
      status: "interrupted",
      deleted: true,
      agent: "shell",
    });
    expect(selectStartupAutoResumeTasks([deletedShell], [project], new Set())).toEqual([]);
  });

  it("没删的待恢复任务照旧一律续跑（既定设计，别加「谁在干活」的筛选）", () => {
    const claude = task("a", {
      status: "interrupted",
      claudeSessionId: "s1",
      claudeSessionPath: "/tmp/s1.jsonl",
    });
    const shell = task("b", { status: "interrupted", agent: "shell" });
    const picked = selectStartupAutoResumeTasks([claude, shell], [project], new Set());
    expect(picked.map((item) => item.task.id)).toEqual(["a", "b"]);
    expect(picked.map((item) => item.sessionId)).toEqual(["s1", null]);
  });

  it("有活子进程的交给「重连」；缺会话路径的跳过；项目没了的跳过", () => {
    const live = task("live", {
      status: "interrupted",
      claudeSessionId: "s1",
      claudeSessionPath: "/tmp/s1.jsonl",
    });
    const noPath = task("no-path", { status: "interrupted", claudeSessionId: "s2" });
    const orphan = task("orphan", {
      status: "interrupted",
      projectId: "p-missing",
      claudeSessionId: "s3",
      claudeSessionPath: "/tmp/s3.jsonl",
    });
    const picked = selectStartupAutoResumeTasks(
      [live, noPath, orphan],
      [project],
      new Set(["live"]),
    );
    expect(picked).toEqual([]);
  });
});
