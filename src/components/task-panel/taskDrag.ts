import type { Task } from "../../types";

/** 手指/指针挪多少像素才算拖拽（低了会把点击吞掉，高了会觉得"拖不动"）—— 与项目栏一致。 */
export const TASK_DRAG_THRESHOLD_PX = 6;
/** 拖到列表上下边附近时的自动滚动：触发带宽度与每帧步长（像素） */
export const TASK_DRAG_AUTOSCROLL_EDGE_PX = 30;
export const TASK_DRAG_AUTOSCROLL_STEP_PX = 12;

/** 列表里的一行（只用到这几项，便于测试时构造假数据）。 */
export type DragRow = { type: "group" | "task" | "local"; task?: Task };

/** 指针在「内容坐标」里的 y → 插到第几行之前（0..rows.length）。
 *  以每行的中线为界：落在上半算插到它前面，下半算后面。 */
export function dropIndexAtOffset(offsets: readonly number[], y: number): number {
  const rowCount = Math.max(0, offsets.length - 1);
  for (let index = 0; index < rowCount; index += 1) {
    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (y < (top + bottom) / 2) return index;
  }
  return rowCount;
}

/** 拖动只在「同一段连续任务行」里生效（那段就是列表里的一个分组）。
 *  返回被拖行所在的那段范围 [start, end]（含两端）。 */
export function taskRunRange(rows: readonly DragRow[], index: number): { start: number; end: number } {
  // 只有任务行能拖；组头 / 本地会话行给个空段（调用方据此判断"这行拖不动"）
  if (rows[index]?.type !== "task") return { start: index, end: index };
  let start = index;
  while (start > 0 && rows[start - 1]?.type === "task") start -= 1;
  let end = index;
  while (end + 1 < rows.length && rows[end + 1]?.type === "task") end += 1;
  return { start, end };
}

/** 把落点夹回本段：组与组之间不互通（分组是按状态/时间算出来的，拖进去也留不住）。 */
export function clampDropToRun(dropIndex: number, run: { start: number; end: number }): number {
  return Math.min(Math.max(dropIndex, run.start), run.end + 1);
}

/** 拖动落定后，这一段任务的新顺序（被拖的那个插到落点）。 */
export function reorderRunIds(
  rows: readonly DragRow[],
  run: { start: number; end: number },
  draggedIndex: number,
  dropIndex: number,
): string[] {
  const ids: string[] = [];
  for (let index = run.start; index <= run.end; index += 1) {
    const id = rows[index]?.task?.id;
    if (id) ids.push(id);
  }
  const draggedId = rows[draggedIndex]?.task?.id;
  if (!draggedId) return ids;
  const from = ids.indexOf(draggedId);
  if (from === -1) return ids;

  ids.splice(from, 1);
  // dropIndex 是「插到第几行之前」；被拖的行原本在它前面时，移除之后要往前挪一位
  const rawInsertAt = dropIndex - run.start - (dropIndex > draggedIndex ? 1 : 0);
  const insertAt = Math.min(Math.max(rawInsertAt, 0), ids.length);
  ids.splice(insertAt, 0, draggedId);
  return ids;
}

/** 让位位移：本段里除被拖行以外，落在两者之间的行各平移一个行高。 */
export function shiftForRow(
  index: number,
  draggedIndex: number,
  dropIndex: number,
  height: number,
): number {
  if (index === draggedIndex) return 0;
  if (draggedIndex < dropIndex) {
    if (index > draggedIndex && index < dropIndex) return -height;
  } else if (draggedIndex > dropIndex) {
    if (index >= dropIndex && index < draggedIndex) return height;
  }
  return 0;
}
