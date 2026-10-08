import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  clampDropToRun,
  dropIndexAtOffset,
  reorderRunIds,
  shiftForRow,
  taskRunRange,
  type DragRow,
} from "../components/task-panel/taskDrag";

function task(id: string): Task {
  return {
    id,
    projectId: "p1",
    name: id,
    prompt: "",
    agent: "claude",
    permissionMode: "full_access",
    status: "running",
    createdAt: 1,
  };
}

// 行：组头(a) / a1 a2 a3 / 组头(b) / b1 b2
const rows: DragRow[] = [
  { type: "group" },
  { type: "task", task: task("a1") },
  { type: "task", task: task("a2") },
  { type: "task", task: task("a3") },
  { type: "group" },
  { type: "task", task: task("b1") },
  { type: "task", task: task("b2") },
];
// 组头 27、任务行 47
const offsets = [0, 27, 74, 121, 168, 195, 242, 289];

describe("拖动排序的落点计算", () => {
  it("按行中线决定插到哪一行之前", () => {
    expect(dropIndexAtOffset(offsets, 0)).toBe(0);
    expect(dropIndexAtOffset(offsets, 40)).toBe(1); // 组头中线 13.5 之下、第二个任务行中线之上
    expect(dropIndexAtOffset(offsets, 50)).toBe(1);
    expect(dropIndexAtOffset(offsets, 90)).toBe(2); // 落在第三行上半 → 插到它之前
    expect(dropIndexAtOffset(offsets, 100)).toBe(3); // 过了第三行中线 → 插到第四行之前
    expect(dropIndexAtOffset(offsets, 10_000)).toBe(7); // 拖到底 → 末尾
  });

  it("拖动只在同一段连续任务行里（跨组夹回去）", () => {
    const run = taskRunRange(rows, 1);
    expect(run).toEqual({ start: 1, end: 3 });
    // 想拖到 b 组去 → 夹回 a 组末尾
    expect(clampDropToRun(6, run)).toBe(4);
    // 想拖到组头上面 → 夹回 a 组开头
    expect(clampDropToRun(0, run)).toBe(1);
    // 组内的落点原样保留
    expect(clampDropToRun(2, run)).toBe(2);
  });

  it("组头行不属于任何任务段（拖不动它）", () => {
    expect(taskRunRange(rows, 4)).toEqual({ start: 4, end: 4 });
  });

  it("往下拖：被拖的任务插到落点，其它顺次前移", () => {
    // a1(1) 拖到 a3 之后 → 插到第 4 行之前
    expect(reorderRunIds(rows, { start: 1, end: 3 }, 1, 4)).toEqual(["a2", "a3", "a1"]);
  });

  it("往上拖：被拖的任务插到落点，其它顺次后移", () => {
    // a3(3) 拖到 a1 之前
    expect(reorderRunIds(rows, { start: 1, end: 3 }, 3, 1)).toEqual(["a3", "a1", "a2"]);
  });

  it("落点就是原位时顺序不变", () => {
    expect(reorderRunIds(rows, { start: 1, end: 3 }, 2, 2)).toEqual(["a1", "a2", "a3"]);
    expect(reorderRunIds(rows, { start: 1, end: 3 }, 2, 3)).toEqual(["a1", "a2", "a3"]);
  });

  it("让位位移：两者之间的行平移一个行高，其余不动", () => {
    // 第 1 行下拖到第 4 行之前：2、3 行上移
    expect(shiftForRow(2, 1, 4, 47)).toBe(-47);
    expect(shiftForRow(3, 1, 4, 47)).toBe(-47);
    expect(shiftForRow(1, 1, 4, 47)).toBe(0);
    expect(shiftForRow(5, 1, 4, 47)).toBe(0);
    // 第 3 行上拖到第 1 行之前：1、2 行下移
    expect(shiftForRow(1, 3, 1, 47)).toBe(47);
    expect(shiftForRow(2, 3, 1, 47)).toBe(47);
  });
});
