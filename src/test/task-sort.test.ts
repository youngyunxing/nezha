import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "../types";
import { sortTasks } from "../components/task-panel/taskSort";

const NOW = Date.now();

function task(
  id: string,
  status: TaskStatus,
  updatedAt: number,
  order?: number,
  extra?: Partial<Task>,
): Task {
  return {
    id,
    projectId: "p1",
    prompt: id,
    agent: "claude",
    permissionMode: "full_access",
    status,
    createdAt: updatedAt,
    updatedAt,
    ...(order === undefined ? {} : { order }),
    ...extra,
  };
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("sortTasks", () => {
  it("结束态沉底，等你/待恢复在最前", () => {
    const sorted = sortTasks([
      task("done", "done", NOW),
      task("run", "running", NOW - 60_000),
      task("wait", "input_required", NOW - 600_000),
    ]);
    expect(ids(sorted)).toEqual(["wait", "run", "done"]);
  });

  it("全序：旧比较器的非传递用例（A 排过最新、B 没排过居中、C 排过最旧）有确定结果", () => {
    // 旧比较器：A<B（B 比 A 旧）、B<C（B 比 C 新）、C<A（位次 0<1）——循环。
    // 新规则：分界线是排过的里最旧的（C），B 比它新 → B 进顶部档；排过的按位次 C、A。
    const sorted = sortTasks([
      task("A", "running", NOW, 1),
      task("B", "running", NOW - 300_000),
      task("C", "running", NOW - 600_000, 0),
    ]);
    expect(ids(sorted)).toEqual(["B", "C", "A"]);
  });

  it("没排过的新任务排在手排结果上面", () => {
    const sorted = sortTasks([
      task("ordered", "running", NOW - 600_000, 0),
      task("new", "running", NOW),
    ]);
    expect(ids(sorted)).toEqual(["new", "ordered"]);
  });

  it("比手排最旧还旧的没排过任务沉到手排结果下面", () => {
    const sorted = sortTasks([
      task("old", "running", NOW - 900_000),
      task("ordered", "running", NOW - 600_000, 0),
    ]);
    expect(ids(sorted)).toEqual(["ordered", "old"]);
  });

  it("两边都排过时按位次，时间不参与", () => {
    const sorted = sortTasks([
      task("second", "running", NOW, 1),
      task("first", "running", NOW - 600_000, 0),
    ]);
    expect(ids(sorted)).toEqual(["first", "second"]);
  });

  it("同一档里没排过的按时间倒序", () => {
    const sorted = sortTasks([
      task("early", "running", NOW - 600_000),
      task("late", "running", NOW - 60_000),
    ]);
    expect(ids(sorted)).toEqual(["late", "early"]);
  });

  it("等你那档按 attentionRequestedAt 倒序", () => {
    const sorted = sortTasks([
      task("a", "input_required", NOW - 600_000, undefined, { attentionRequestedAt: NOW - 60_000 }),
      task("b", "input_required", NOW, undefined, { attentionRequestedAt: NOW - 300_000 }),
    ]);
    expect(ids(sorted)).toEqual(["a", "b"]);
  });

  it("比较是反对称的：任意顺序输入得到同一结果", () => {
    const base = [
      task("A", "running", NOW, 1),
      task("B", "running", NOW - 300_000),
      task("C", "running", NOW - 600_000, 0),
      task("D", "done", NOW),
      task("E", "input_required", NOW - 100_000),
    ];
    const expected = ids(sortTasks(base));
    expect(ids(sortTasks([...base].reverse()))).toEqual(expected);
  });
});
