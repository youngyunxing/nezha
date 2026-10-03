import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { isVisibleTask, softDeleteTasks } from "../taskDeletion";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "p1",
    name: `任务 ${id}`,
    prompt: "做点事",
    agent: "claude",
    permissionMode: "full_access",
    status: "done",
    createdAt: 1,
    ...over,
  };
}

describe("删除 = 打标记，记录留在磁盘上", () => {
  it("删除后任务还在数组里，只是标记了 deleted（名字、状态都保得住）", () => {
    const before = [task("a"), task("b")];
    const after = softDeleteTasks(before, ["a"]);

    expect(after).toHaveLength(2);
    const deleted = after.find((t) => t.id === "a")!;
    expect(deleted.deleted).toBe(true);
    expect(deleted.name).toBe("任务 a");
    expect(deleted.status).toBe("done");
    expect(deleted.claudeSessionId).toBeUndefined();
    // 没被删的那条原样不动（同一个对象引用，列表渲染不会白刷）
    expect(after.find((t) => t.id === "b")).toBe(before[1]);
  });

  it("正在跑的会话落成 interrupted —— 调用方会停掉进程，状态跟着变", () => {
    const after = softDeleteTasks([task("a", { status: "running" })], ["a"]);
    expect(after[0].status).toBe("interrupted");
    expect(after[0].deleted).toBe(true);
  });

  it("重复删 / 删不存在的 id 都不产生新数组（省一次落盘）", () => {
    const before = [task("a")];
    expect(softDeleteTasks(before, [])).toBe(before);
    expect(softDeleteTasks(before, ["nope"])).toBe(before);

    const once = softDeleteTasks(before, ["a"]);
    expect(softDeleteTasks(once, ["a"])).toBe(once);
  });

  it("isVisibleTask 把删掉的挡在列表外", () => {
    expect(isVisibleTask(task("a"))).toBe(true);
    expect(isVisibleTask(task("a", { deleted: true }))).toBe(false);
  });
});
