import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { LocalClaudeSession, Task, TaskDisplayWindow } from "../../types";
import { TaskListItem } from "./TaskListItem";
import { TaskContextMenu, type TaskContextMenuState } from "./TaskContextMenu";
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
  renamingTaskId,
  onRenamingTaskIdChange,
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
  /** 正在改名的任务 id（提到项目层：主区域标签上右键也能进改名） */
  renamingTaskId: string | null;
  onRenamingTaskIdChange: (id: string | null) => void;
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

  const filtered = useMemo(() => {
    if (!query.trim()) return tasks;
    const q = query.toLowerCase();
    return tasks.filter((t) => t.prompt.toLowerCase().includes(q));
  }, [tasks, query]);

  const filteredLocalSessions = useMemo(() => {
    if (!query.trim()) return localSessions;
    const q = query.toLowerCase();
    return localSessions.filter(
      (session) =>
        session.preview.toLowerCase().includes(q) || session.sessionId.toLowerCase().includes(q),
    );
  }, [localSessions, query]);

  const sorted = useMemo(() => {
    const sortKey = (task: Task) => task.updatedAt ?? task.createdAt;
    return [...filtered].sort((a, b) => {
      const aNeedsAttention =
        a.status === "input_required" ||
        a.status === "awaiting_review" ||
        a.status === "interrupted";
      const bNeedsAttention =
        b.status === "input_required" ||
        b.status === "awaiting_review" ||
        b.status === "interrupted";
      if (aNeedsAttention && !bNeedsAttention) return -1;
      if (!aNeedsAttention && bNeedsAttention) return 1;
      if (aNeedsAttention && bNeedsAttention) {
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

  const rows = useMemo<VirtualRow[]>(() => {
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

    return nextRows;
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
        {tasks.length === 0 && localSessions.length === 0 && (
          <div style={s.taskListEmpty}>{t("task.noTasksYet")}</div>
        )}
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleRows.map((row, visibleIndex) => {
            const rowIndex = startIndex + visibleIndex;
            const top = offsets[rowIndex] ?? 0;

            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  top,
                  left: 0,
                  right: 0,
                  height: row.height,
                  overflow: "hidden",
                }}
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
                    onClick={() => onSelectTask(row.task.id)}
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
          })}
        </div>
      </div>
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
