import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { LocalClaudeSession, Task, TaskDisplayWindow } from "../../types";
import { TaskListItem } from "./TaskListItem";
import { TaskContextMenu, type TaskContextMenuState } from "./TaskContextMenu";
import { ContextMenu } from "../ContextMenu";
import { isVisibleTask } from "../../taskDeletion";
import { DeletedTaskRow } from "./DeletedTaskRow";
import {
  TASK_DRAG_AUTOSCROLL_EDGE_PX,
  TASK_DRAG_AUTOSCROLL_STEP_PX,
  TASK_DRAG_THRESHOLD_PX,
  clampDropToRun,
  dropIndexAtOffset,
  reorderRunIds,
  shiftForRow,
  taskRunRange,
} from "./taskDrag";
import { useSessionSearch } from "../../hooks/useSessionSearch";
import { taskSessionPath } from "../../types";
import { sortTasks } from "./taskSort";
import { LocalSessionRow } from "./LocalSessionRow";
import { useI18n } from "../../i18n";
import s from "../../styles";

const GROUP_ROW_HEIGHT = 27;
const TASK_ROW_HEIGHT = 47;
const OVERSCAN_ROWS = 8;

type VirtualRow =
  | { type: "group"; key: string; label: string; height: number }
  | { type: "task"; key: string; task: Task; height: number }
  | { type: "local"; key: string; session: LocalClaudeSession; height: number }
  | { type: "deleted"; key: string; task: Task; height: number };

function findRowIndex(offsets: number[], value: number) {
  if (offsets.length <= 1) return 0;

  let low = 0;
  let high = offsets.length - 2;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid + 1] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export function TaskList({
  tasks,
  taskDisplayWindow,
  query,
  selectedId,
  isNewTask,
  localSessions,
  selectedLocalSessionId,
  onSelectLocalSession,
  onResumeLocalSession,
  onSelectTask,
  onDeleteTask,
  onRestoreTask,
  onToggleTaskStar,
  onRenameTask,
  onReorderTasks,
  renamingTaskId,
  onRenamingTaskIdChange,
  onTaskDisplayWindowChange,
}: {
  tasks: Task[];
  taskDisplayWindow: TaskDisplayWindow;
  query: string;
  selectedId: string | null;
  isNewTask: boolean;
  localSessions: LocalClaudeSession[];
  selectedLocalSessionId: string | null;
  onSelectLocalSession: (session: LocalClaudeSession) => void;
  /** 本地会话行右键「恢复会话」：把它变成一个可续跑的任务 */
  onResumeLocalSession: (session: LocalClaudeSession) => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  /** 「历史」组里恢复一条被删掉的任务（把 deleted 标记抹掉） */
  onRestoreTask: (id: string) => void;
  onToggleTaskStar: (id: string) => void;
  onRenameTask: (id: string, name: string) => void;
  /** 拖动排序：按显示顺序回传这一组任务的 id */
  onReorderTasks: (orderedIds: string[]) => void;
  /** 正在改名的任务 id（提到项目层：主区域标签上右键也能进改名） */
  renamingTaskId: string | null;
  onRenamingTaskIdChange: (id: string | null) => void;
  /** 底部「显示全部」用：把展示范围切到「所有任务」 */
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  // 右键菜单挂在哪条任务上（改名态在项目层，见 renamingTaskId）
  const [ctxMenu, setCtxMenu] = useState<TaskContextMenuState | null>(null);
  // 本地会话行的右键菜单（它不是 Nezha 任务，菜单也不同：目前只有「恢复会话」）
  const [localCtxMenu, setLocalCtxMenu] = useState<
    { x: number; y: number; session: LocalClaudeSession } | null
  >(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateViewportHeight = () => setViewportHeight(el.clientHeight);
    updateViewportHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportHeight);
      return () => window.removeEventListener("resize", updateViewportHeight);
    }

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const visibleTasks = useMemo(() => tasks.filter(isVisibleTask), [tasks]);
  // 「历史」组：删掉的任务。列表里其它地方一律过滤掉它们，只有这一组展示 ——
  // 数据一直都在（软删除），缺的只是这个入口。
  const deletedTasks = useMemo(() => {
    const sorted = tasks
      .filter((task) => !isVisibleTask(task))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    // **同一条会话只留一条**：以前「恢复会话」是新建任务，删过的会话可能挂了两条记录
    //（RedAlert 的 main / 红警复刻 就是，指向同一个会话文件），两条一起列出来等于同一条
    // 对话在历史里出现两次。sorted 是新的在前，所以留下的是最近那条。
    // 纯终端任务没有会话文件，不参与去重。
    const seenSessions = new Set<string>();
    return sorted.filter((task) => {
      const sessionId = task.claudeSessionId;
      if (!sessionId) return true;
      if (seenSessions.has(sessionId)) return false;
      seenSessions.add(sessionId);
      return true;
    });
  }, [tasks]);

  // 会话正文的搜索走后端（异步 + 防抖），名字 / 提示词 / 命令在本地同步匹配。
  // 任务的会话和「本地会话」（自己在本机跑的 claude）走的是同一条搜索 —— 它们的正文
  // 都该搜得到，不能只按标题和首条消息匹配。
  const searchPaths = useMemo(() => {
    const paths = new Set<string>();
    // 已删除的任务也算进来：搜索是搜「所有任务」，别因为删过就搜不到
    for (const task of [...visibleTasks, ...deletedTasks]) {
      const path = taskSessionPath(task);
      if (path) paths.add(path);
    }
    for (const session of localSessions) paths.add(session.sessionPath);
    return Array.from(paths);
  }, [visibleTasks, deletedTasks, localSessions]);
  const { matchedPaths, searching: searchingSessions } = useSessionSearch(searchPaths, query);

  /** 把一条被删掉的任务伪装成「本地会话」—— 预览走的是同一套（LocalSessionView），
   *  所以点开它的样子和本地会话完全一致。没有会话文件的（纯终端任务）返回 null，
   *  那种行点开没东西可看，只留右键恢复。 */
  const deletedTaskSession = (task: Task): LocalClaudeSession | null => {
    const sessionPath = taskSessionPath(task);
    if (!sessionPath || !task.claudeSessionId) return null;
    return {
      sessionId: task.claudeSessionId,
      sessionPath,
      preview: task.name ?? task.prompt,
      updatedAt: task.updatedAt ?? task.createdAt,
      sizeBytes: 0,
    };
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return visibleTasks;
    const q = query.toLowerCase();
    return visibleTasks.filter((task) => {
      // 名字 / 任务自带文本（提示词）/ 命令：只搜 prompt 时有两个坑 —— 改过名的任务按新名字
      // 搜不到；快捷指令建的任务 prompt 是空的，等于搜索里不存在。
      if ([task.name, task.prompt, task.command].some((value) => value?.toLowerCase().includes(q))) {
        return true;
      }
      // 会话正文（回放里能看到的那些消息）
      const sessionPath = taskSessionPath(task);
      return !!sessionPath && matchedPaths.has(sessionPath);
    });
  }, [visibleTasks, query, matchedPaths]);

  // 「历史」组也吃搜索：不然搜别的词时它照样把一堆删掉的任务顶在底下
  const filteredDeletedTasks = useMemo(() => {
    if (!query.trim()) return deletedTasks;
    const q = query.toLowerCase();
    return deletedTasks.filter((task) => {
      if ([task.name, task.prompt, task.command].some((value) => value?.toLowerCase().includes(q))) {
        return true;
      }
      const sessionPath = taskSessionPath(task);
      return !!sessionPath && matchedPaths.has(sessionPath);
    });
  }, [deletedTasks, query, matchedPaths]);

  const filteredLocalSessions = useMemo(() => {
    if (!query.trim()) return localSessions;
    const q = query.toLowerCase();
    return localSessions.filter(
      (session) =>
        session.preview.toLowerCase().includes(q) ||
        session.sessionId.toLowerCase().includes(q) ||
        // 会话正文（跟任务一样走后端全文搜索）
        matchedPaths.has(session.sessionPath),
    );
  }, [localSessions, query, matchedPaths]);

  // 排序规则抽在 taskSort.ts（纯函数，可单测）：等你/待恢复 > 正常 > 结束态；
  // 同档内没排过的按新旧分顶部/底部两档，排过的按手排位次 —— 详见该文件头部注释。
  const sorted = useMemo(() => sortTasks(filtered), [filtered]);

  const { todayTs, cutoffTs } = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const todayTs = d.getTime();
    const cutoffTs =
      taskDisplayWindow === "all"
        ? Number.NEGATIVE_INFINITY
        : todayTs - taskDisplayWindow * 24 * 60 * 60 * 1000;
    return { todayTs, cutoffTs };
  }, [taskDisplayWindow]);

  const { rows, windowHiddenCount } = useMemo(() => {
    // 被「任务展示范围」挡在窗口外、没能进列表的任务数（底下那行提示要用）
    let windowHiddenCount = 0;
    const waitingTasks: Task[] = [];
    const resumeTasks: Task[] = [];
    const pendingMergeTasks: Task[] = [];
    const starredTasks: Task[] = [];
    const todayTasks: Task[] = [];
    const earlierTasks: Task[] = [];

    for (const task of sorted) {
      if (task.status === "input_required" || task.status === "awaiting_review") {
        // 都是「轮到你了」：一个是被卡住必须回，一个是刚答完等你读
        waitingTasks.push(task);
      } else if (task.status === "interrupted") {
        resumeTasks.push(task);
      } else if (
        task.status === "done" &&
        !!task.worktreePath &&
        !task.worktreeDiscarded
      ) {
        pendingMergeTasks.push(task);
      } else if (task.starred) {
        starredTasks.push(task);
      } else {
        const bucketAt = task.updatedAt ?? task.createdAt;
        if (bucketAt >= todayTs) {
          todayTasks.push(task);
        } else if (bucketAt >= cutoffTs) {
          earlierTasks.push(task);
        } else {
          // 展示范围之外：不显示，但底下要告诉用户"还有多少"，否则看着像任务丢了
          windowHiddenCount += 1;
        }
      }
    }

    const nextRows: VirtualRow[] = [];
    const appendGroup = (key: string, label: string, groupTasks: Task[]) => {
      if (groupTasks.length === 0) return;
      nextRows.push({ type: "group", key, label, height: GROUP_ROW_HEIGHT });
      groupTasks.forEach((task) => {
        nextRows.push({
          type: "task",
          key: task.id,
          task,
          height: TASK_ROW_HEIGHT,
        });
      });
    };

    appendGroup("waiting", t("task.waitingForYou"), waitingTasks);
    appendGroup("resume", t("task.needsResume"), resumeTasks);
    appendGroup("pending_merge", t("task.pendingMerge"), pendingMergeTasks);
    appendGroup("starred", t("task.starred"), starredTasks);
    appendGroup("today", t("task.today"), todayTasks);
    appendGroup("earlier", t("task.earlier"), earlierTasks);

    // 「历史」紧跟任务之后、本地会话之前 —— 它装的是**被删掉的 Nezha 任务**
    // （名字、状态、时间都还是原文），比"别人的会话"更该挨着上面的任务列表。
    // 有会话的那些点开就是预览（和本地会话完全一致），恢复走右键。
    if (filteredDeletedTasks.length > 0) {
      nextRows.push({
        type: "group",
        key: "__history__",
        label: t("task.history"),
        height: GROUP_ROW_HEIGHT,
      });
      filteredDeletedTasks.forEach((task) => {
        nextRows.push({ type: "deleted", key: `deleted:${task.id}`, task, height: TASK_ROW_HEIGHT });
      });
    }

    // 本地 Claude Code 会话单独成组：它们不是 Nezha 任务，不落盘、不参与状态机，
    // 与上面的任务列表刻意分开。
    if (filteredLocalSessions.length > 0) {
      nextRows.push({
        type: "group",
        key: "__local_sessions__",
        label: t("localSession.groupTitle"),
        height: GROUP_ROW_HEIGHT,
      });
      filteredLocalSessions.forEach((session) => {
        nextRows.push({
          type: "local",
          key: `local:${session.sessionId}`,
          session,
          height: TASK_ROW_HEIGHT,
        });
      });
    }

  

    return { rows: nextRows, windowHiddenCount };
  }, [cutoffTs, filteredDeletedTasks, filteredLocalSessions, sorted, t, todayTs]);

  const offsets = useMemo(() => {
    const nextOffsets = [0];
    for (const row of rows) {
      nextOffsets.push(nextOffsets[nextOffsets.length - 1] + row.height);
    }
    return nextOffsets;
  }, [rows]);

  // 改名输入框在列表行里：从主区域标签右键进来时那一行可能在视野外 —— 先滚过去，
  // 否则点了「重命名」屏幕上什么都没发生。
  useEffect(() => {
    if (!renamingTaskId) return;
    const index = rows.findIndex((row) => row.type === "task" && row.task.id === renamingTaskId);
    const el = scrollRef.current;
    if (index === -1 || !el) return;
    const top = offsets[index] ?? 0;
    const bottom = offsets[index + 1] ?? top;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - 8);
    }
  }, [renamingTaskId, rows, offsets]);

  // ── 拖动排序 ─────────────────────────────────────────────────────────────
  // 指针位置更新很频繁，走 ref + rAF 合并，别每个 pointermove 都 setState
  const [drag, setDrag] = useState<{
    draggedIndex: number;
    dropIndex: number;
    pointerY: number;
    rowTop: number;
  } | null>(null);
  const dragRef = useRef<{
    draggedIndex: number;
    startClientY: number;
    clientY: number;
    moved: boolean;
    dropIndex: number;
    pointerY: number;
    rowTop: number;
  } | null>(null);
  const dragRafRef = useRef(0);
  // 自动滚动只在 pointermove 里步进的话，指针停在边缘不动列表就不滚了 —— 拖动期间
  // 跑一个 rAF 循环，按最后一次指针位置持续滚。
  const autoscrollRafRef = useRef(0);
  // 拖完松手那一下别把行点击也触发了（否则一拖就顺带切了任务）
  const suppressClickRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const onReorderRef = useRef(onReorderTasks);
  onReorderRef.current = onReorderTasks;

  const flushDrag = useCallback(() => {
    dragRafRef.current = 0;
    const session = dragRef.current;
    if (!session) return;
    setDrag({
      draggedIndex: session.draggedIndex,
      dropIndex: session.dropIndex,
      pointerY: session.pointerY,
      rowTop: session.rowTop,
    });
  }, []);

  /** 按最后一次指针位置重算内容坐标与落点（列表滚动后指针不动、落点也要跟着变）。 */
  const updateDropFromPointer = useCallback((clientY: number) => {
    const session = dragRef.current;
    const el = scrollRef.current;
    if (!session || !el) return;
    const rect = el.getBoundingClientRect();
    session.clientY = clientY;
    session.pointerY = clientY - rect.top + el.scrollTop;
    const run = taskRunRange(rowsRef.current, session.draggedIndex);
    session.dropIndex = clampDropToRun(dropIndexAtOffset(offsetsRef.current, session.pointerY), run);
  }, []);

  /** 拖动期间的持续自动滚动：指针停在上下边缘附近时每帧滚一步。 */
  const autoscrollTick = useCallback(() => {
    autoscrollRafRef.current = 0;
    const session = dragRef.current;
    const el = scrollRef.current;
    if (!session?.moved || !el) return;
    const rect = el.getBoundingClientRect();
    if (session.clientY < rect.top + TASK_DRAG_AUTOSCROLL_EDGE_PX) {
      el.scrollTop -= TASK_DRAG_AUTOSCROLL_STEP_PX;
      updateDropFromPointer(session.clientY);
      if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(flushDrag);
    } else if (session.clientY > rect.bottom - TASK_DRAG_AUTOSCROLL_EDGE_PX) {
      el.scrollTop += TASK_DRAG_AUTOSCROLL_STEP_PX;
      updateDropFromPointer(session.clientY);
      if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(flushDrag);
    }
    autoscrollRafRef.current = requestAnimationFrame(autoscrollTick);
  }, [flushDrag, updateDropFromPointer]);

  const handleDragMove = useCallback(
    (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      // 没越过阈值就当点击：手滑几像素不该把行拖走
      if (!session.moved && Math.abs(event.clientY - session.startClientY) < TASK_DRAG_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      updateDropFromPointer(event.clientY);
      if (!autoscrollRafRef.current) {
        autoscrollRafRef.current = requestAnimationFrame(autoscrollTick);
      }
      if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(flushDrag);
    },
    [autoscrollTick, flushDrag, updateDropFromPointer],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    if (autoscrollRafRef.current) {
      cancelAnimationFrame(autoscrollRafRef.current);
      autoscrollRafRef.current = 0;
    }
    const session = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!session?.moved) return;

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const currentRows = rowsRef.current;
    const run = taskRunRange(currentRows, session.draggedIndex);
    const before = currentRows
      .slice(run.start, run.end + 1)
      .map((row) => (row.type === "task" ? row.task.id : undefined))
      .filter((id): id is string => !!id);
    const after = reorderRunIds(currentRows, run, session.draggedIndex, session.dropIndex);
    // 顺序没变就不提交（拖回原位不该写盘）
    if (after.join(",") !== before.join(",")) onReorderRef.current(after);
  }, [handleDragMove]);

  const handleRowPointerDown = useCallback(
    (event: React.PointerEvent, rowIndex: number) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // 改名输入框、按钮上的按下不参与拖动
      if (target?.closest("input, textarea, button, a")) return;
      if (rowsRef.current[rowIndex]?.type !== "task") return;
      const rowTop = offsetsRef.current[rowIndex] ?? 0;
      dragRef.current = {
        draggedIndex: rowIndex,
        startClientY: event.clientY,
        clientY: event.clientY,
        moved: false,
        dropIndex: rowIndex,
        pointerY: rowTop,
        rowTop,
      };
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [endDrag, handleDragMove],
  );

  const totalHeight = offsets[offsets.length - 1] ?? 0;
  let startIndex = Math.max(0, findRowIndex(offsets, scrollTop) - OVERSCAN_ROWS);
  let endIndex = Math.min(
    rows.length,
    findRowIndex(offsets, scrollTop + viewportHeight) + OVERSCAN_ROWS + 1,
  );
  // 拖动中被拖的行可能滚出渲染窗（尤其自动滚动把它甩出视野时）——渲染窗要把它和
  // 落点都包进来，否则行会从 DOM 里消失、拖动视觉直接断掉。
  if (drag) {
    startIndex = Math.min(startIndex, drag.draggedIndex, drag.dropIndex);
    endIndex = Math.max(endIndex, drag.draggedIndex + 1, drag.dropIndex + 1);
  }
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <>
      <div ref={scrollRef} style={s.taskListScroll} onScroll={handleScroll}>
        {/* 「历史」里还有东西时不算空 —— 不然上面写"还没有任务"、下面又列着历史，自相矛盾 */}
        {visibleTasks.length === 0 && localSessions.length === 0 && filteredDeletedTasks.length === 0 && (
          <div style={s.taskListEmpty}>{t("task.noTasksYet")}</div>
        )}
        {query.trim() !== "" &&
          filtered.length === 0 &&
          filteredLocalSessions.length === 0 &&
          filteredDeletedTasks.length === 0 && (
          <div style={s.taskListEmpty}>
            {searchingSessions ? t("task.searchingSessions") : t("task.noMatchingTasks")}
          </div>
        )}
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleRows.map((row, visibleIndex) => {
            const rowIndex = startIndex + visibleIndex;
            const top = offsets[rowIndex] ?? 0;

            return (
              (() => {
                const isDragged = drag?.draggedIndex === rowIndex;
                const shift = drag
                  ? shiftForRow(rowIndex, drag.draggedIndex, drag.dropIndex, TASK_ROW_HEIGHT)
                  : 0;
                return (
                  <div
                    key={row.key}
                    data-draggable={row.type === "task" ? "true" : undefined}
                    data-dragging={isDragged ? "true" : undefined}
                    style={{
                      position: "absolute",
                      top,
                      left: 0,
                      right: 0,
                      height: row.height,
                      overflow: "hidden",
                      // 被拖的那行跟着指针走，其余行让位一个行高
                      transform:
                        isDragged && drag
                          ? `translateY(${drag.pointerY - drag.rowTop}px)`
                          : shift
                            ? `translateY(${shift}px)`
                            : undefined,
                      transition: isDragged ? "none" : "transform 0.12s ease",
                      zIndex: isDragged ? 3 : undefined,
                      boxShadow: isDragged ? "var(--shadow-md)" : undefined,
                      background: isDragged ? "var(--bg-sidebar)" : undefined,
                    }}
                    onPointerDown={(event) => handleRowPointerDown(event, rowIndex)}
                  >
                {row.type === "group" ? (
                  <div style={s.groupLabel}>{row.label}</div>
                ) : row.type === "deleted" ? (
                  <DeletedTaskRow
                    task={row.task}
                    session={deletedTaskSession(row.task)}
                    selected={
                      deletedTaskSession(row.task)
                        ? !!row.task.claudeSessionId &&
                          row.task.claudeSessionId === selectedLocalSessionId
                        : selectedId === row.task.id && !isNewTask
                    }
                    onClick={() => {
                      const session = deletedTaskSession(row.task);
                      if (session) {
                        onSelectLocalSession(session);
                        return;
                      }
                      // 纯终端任务：没有会话文件可读，点开就**选中它**（选中即挂载）——
                      // 主区域直接显示那块上次屏幕，这就是"看到"。
                      // **点开不恢复**（用户口径：「没有恢复就一直是历史」）：
                      // 恢复只在右键菜单里点。
                      onSelectTask(row.task.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setCtxMenu({ x: event.clientX, y: event.clientY, task: row.task });
                    }}
                  />
                ) : row.type === "local" ? (
                  <LocalSessionRow
                    session={row.session}
                    selected={selectedLocalSessionId === row.session.sessionId}
                    onClick={() => onSelectLocalSession(row.session)}
                    onContextMenu={(event) => {
                      // 顶掉 webview 自带的右键菜单（跟文件树 / 任务行一致）
                      event.preventDefault();
                      event.stopPropagation();
                      setLocalCtxMenu({ x: event.clientX, y: event.clientY, session: row.session });
                    }}
                  />
                ) : (
                  <TaskListItem
                    task={row.task}
                    selected={selectedId === row.task.id && !isNewTask}
                    onClick={() => {
                      if (suppressClickRef.current) return;
                      onSelectTask(row.task.id);
                    }}
                    onContextMenu={(event) => {
                      // 顶掉 webview 自带的右键菜单，换成任务操作（跟文件树一致）。
                      event.preventDefault();
                      event.stopPropagation();
                      setCtxMenu({ x: event.clientX, y: event.clientY, task: row.task });
                    }}
                    renaming={renamingTaskId === row.task.id}
                    onRenameSubmit={(name) => {
                      onRenameTask(row.task.id, name);
                      onRenamingTaskIdChange(null);
                    }}
                    onRenameCancel={() => onRenamingTaskIdChange(null)}
                  />
                )}
                  </div>
                );
              })()
            );
          })}
        </div>
      </div>
    {windowHiddenCount > 0 && (
      <div style={s.taskListWindowHint}>
        <span>{t("task.hiddenByWindow", { count: windowHiddenCount })}</span>
        <button
          type="button"
          style={s.taskListWindowHintBtn}
          onClick={() => onTaskDisplayWindowChange("all")}
        >
          {t("task.showAllTasks")}
        </button>
      </div>
    )}
    {localCtxMenu && (
      <ContextMenu
        anchor={localCtxMenu}
        onClose={() => setLocalCtxMenu(null)}
        narrow
        items={[
          {
            label: t("localSession.resumeSession"),
            onSelect: () => {
              onResumeLocalSession(localCtxMenu.session);
              setLocalCtxMenu(null);
            },
          },
        ]}
      />
    )}
    {ctxMenu && (
      <TaskContextMenu
        ctxMenu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        onRename={() => {
          onRenamingTaskIdChange(ctxMenu.task.id);
          setCtxMenu(null);
        }}
        onToggleStar={() => {
          onToggleTaskStar(ctxMenu.task.id);
          setCtxMenu(null);
        }}
        onDelete={() => {
          onDeleteTask(ctxMenu.task.id);
          setCtxMenu(null);
        }}
        onRestore={() => {
          onRestoreTask(ctxMenu.task.id);
          setCtxMenu(null);
        }}
      />
    )}
    </>
  );
}
