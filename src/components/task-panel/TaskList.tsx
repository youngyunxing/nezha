import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { LocalClaudeSession, Task, TaskDisplayWindow } from "../../types";
import { TaskListItem } from "./TaskListItem";
import { TaskContextMenu, type TaskContextMenuState } from "./TaskContextMenu";
import { isVisibleTask } from "../../taskDeletion";
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
import { LocalSessionRow } from "./LocalSessionRow";
import { useI18n } from "../../i18n";
import s from "../../styles";

const GROUP_ROW_HEIGHT = 27;
const TASK_ROW_HEIGHT = 47;
const OVERSCAN_ROWS = 8;

type VirtualRow =
  | { type: "group"; key: string; label: string; height: number }
  | { type: "task"; key: string; task: Task; height: number }
  | { type: "local"; key: string; session: LocalClaudeSession; height: number };

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
  onSelectTask,
  onDeleteTask,
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
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
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

  // 删掉的任务（deleted 标记）不再出现在列表里，记录还在磁盘上
  const visibleTasks = useMemo(() => tasks.filter(isVisibleTask), [tasks]);

  // 会话正文的搜索走后端（异步 + 防抖），名字 / 提示词 / 命令在本地同步匹配。
  // 任务的会话和「本地会话」（自己在本机跑的 claude）走的是同一条搜索 —— 它们的正文
  // 都该搜得到，不能只按标题和首条消息匹配。
  const searchPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const task of visibleTasks) {
      const path = taskSessionPath(task);
      if (path) paths.add(path);
    }
    for (const session of localSessions) paths.add(session.sessionPath);
    return Array.from(paths);
  }, [visibleTasks, localSessions]);
  const { matchedPaths, searching: searchingSessions } = useSessionSearch(searchPaths, query);

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

  const sorted = useMemo(() => {
    const sortKey = (task: Task) => task.updatedAt ?? task.createdAt;
    const needsAttention = (task: Task) =>
      task.status === "input_required" ||
      task.status === "awaiting_review" ||
      task.status === "interrupted";
    // 结束态（已完成 / 失败 / 已取消）沉到后面：它们刚刚更新过，按时间排会顶到最上面，
    // 把还在跑、还等着你的挤下去。同一档里再按时间倒序。
    const isFinished = (task: Task) =>
      task.status === "done" || task.status === "failed" || task.status === "cancelled";
    const rank = (task: Task) => (needsAttention(task) ? 0 : isFinished(task) ? 2 : 1);
    return [...filtered].sort((a, b) => {
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      // 同一档里：拖动排过的按手排位次；没排过的（新任务）在最上面 —— 新活别沉到你的安排底下
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return 1;
      if (b.order !== undefined) return -1;
      if (rank(a) === 0) {
        return (b.attentionRequestedAt ?? sortKey(b)) - (a.attentionRequestedAt ?? sortKey(a));
      }
      return sortKey(b) - sortKey(a);
    });
  }, [filtered]);

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
  }, [cutoffTs, filteredLocalSessions, sorted, t, todayTs]);

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
    moved: boolean;
    dropIndex: number;
    pointerY: number;
    rowTop: number;
  } | null>(null);
  const dragRafRef = useRef(0);
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

  const handleDragMove = useCallback(
    (event: PointerEvent) => {
      const session = dragRef.current;
      const el = scrollRef.current;
      if (!session || !el) return;
      // 没越过阈值就当点击：手滑几像素不该把行拖走
      if (!session.moved && Math.abs(event.clientY - session.startClientY) < TASK_DRAG_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      const rect = el.getBoundingClientRect();
      // 内容坐标：列表自己滚动时指针不动，落点也得跟着变
      const pointerY = event.clientY - rect.top + el.scrollTop;
      const run = taskRunRange(rowsRef.current, session.draggedIndex);
      session.pointerY = pointerY;
      session.dropIndex = clampDropToRun(dropIndexAtOffset(offsetsRef.current, pointerY), run);
      // 拖到上下边附近自动滚动，长列表才拖得到远处
      if (event.clientY < rect.top + TASK_DRAG_AUTOSCROLL_EDGE_PX) {
        el.scrollTop -= TASK_DRAG_AUTOSCROLL_STEP_PX;
      } else if (event.clientY > rect.bottom - TASK_DRAG_AUTOSCROLL_EDGE_PX) {
        el.scrollTop += TASK_DRAG_AUTOSCROLL_STEP_PX;
      }
      if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(flushDrag);
    },
    [flushDrag],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
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
  const startIndex = Math.max(0, findRowIndex(offsets, scrollTop) - OVERSCAN_ROWS);
  const endIndex = Math.min(
    rows.length,
    findRowIndex(offsets, scrollTop + viewportHeight) + OVERSCAN_ROWS + 1,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <>
      <div ref={scrollRef} style={s.taskListScroll} onScroll={handleScroll}>
        {visibleTasks.length === 0 && localSessions.length === 0 && (
          <div style={s.taskListEmpty}>{t("task.noTasksYet")}</div>
        )}
        {query.trim() !== "" && filtered.length === 0 && filteredLocalSessions.length === 0 && (
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
                ) : row.type === "local" ? (
                  <LocalSessionRow
                    session={row.session}
                    selected={selectedLocalSessionId === row.session.sessionId}
                    onClick={() => onSelectLocalSession(row.session)}
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
      />
    )}
    </>
  );
}
