import { useRef, useState } from "react";
import { Plus, Search, Terminal } from "lucide-react";
import type { LocalClaudeSession, Project, Task, GitRoot, TaskDisplayWindow } from "../types";
import { ProjectAvatar } from "./ProjectAvatar";
import { BranchBar } from "./task-panel/BranchBar";
import { RepoSelector } from "./task-panel/RepoSelector";
import { TaskList } from "./task-panel/TaskList";
import { useI18n } from "../i18n";
import claudeLogo from "../assets/claude.svg";
import chatgptLogo from "../assets/chatgpt.svg";
import { presetSummary, type TaskPreset } from "../taskPresets";
import s from "../styles";

export function TaskPanel({
  project,
  repoPath,
  branchRepoPath,
  repoSelectionLocked,
  gitRoots,
  onSelectRoot,
  tasks,
  selectedId,
  isNewTask,
  localSessions,
  selectedLocalSessionId,
  onSelectLocalSession,
  onNewTask,
  presets,
  onRunPreset,
  onManagePresets,
  onSelectTask,
  onDeleteTask,
  onToggleTaskStar,
  taskDisplayWindow,
  active = true,
}: {
  project: Project;
  /** 当前活动 git 根（用于 BranchBar / 多仓库工作区切换） */
  repoPath: string;
  /** BranchBar 的实际 git cwd；worktree 任务中为 worktreePath。 */
  branchRepoPath: string;
  /** worktree 任务选中时锁定仓库，避免界面同时操作另一个 sub-repo。 */
  repoSelectionLocked: boolean;
  /** 项目下所有 git 根。仅当 length > 1 时渲染 RepoSelector。 */
  gitRoots: GitRoot[];
  onSelectRoot: (path: string) => void;
  tasks: Task[];
  selectedId: string | null;
  isNewTask: boolean;
  localSessions: LocalClaudeSession[];
  selectedLocalSessionId: string | null;
  onSelectLocalSession: (session: LocalClaudeSession) => void;
  onNewTask: () => void;
  /** 快捷创建按钮（预设）：点一下直接建任务 */
  presets: TaskPreset[];
  onRunPreset: (preset: TaskPreset) => void;
  /** 打开预设编辑器；带 presetId 表示直接进那条的编辑态 */
  onManagePresets: (presetId?: string) => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onToggleTaskStar: (id: string) => void;
  taskDisplayWindow: TaskDisplayWindow;
  active?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  // 右击 / 长按快捷按钮 = 打开它的编辑面板；长按后要吃掉那次 click，不能顺手把任务建了
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  function startLongPress(presetId: string) {
    longPressed.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressed.current = true;
      onManagePresets(presetId);
      // 面板弹出后那次 click 可能被吃掉，标记自己过一会儿清掉，免得吃掉下一次点击
      window.setTimeout(() => {
        longPressed.current = false;
      }, 800);
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <div style={s.taskPanel}>
      {/* Project header */}
      <div style={s.panelHeader}>
        <ProjectAvatar project={project} size={22} />
        <span style={s.panelProjectName}>{project.name}</span>
      </div>

      {/* Search */}
      <div style={s.panelSearchWrap}>
        <Search size={13} strokeWidth={2} color="var(--text-muted)" style={s.flexShrinkIcon} />
        <input
          style={s.panelSearchInput}
          placeholder={t("task.searchTasks")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Repo selector (only multi-repo workspaces) */}
      {gitRoots.length > 1 && (
        <RepoSelector
          roots={gitRoots}
          selectedPath={repoPath}
          onSelect={onSelectRoot}
          disabled={repoSelectionLocked}
        />
      )}

      {/* Branch bar */}
      <BranchBar projectRoot={project.path} repoPath={branchRepoPath} active={active} />

      {/* New Task row */}
      <button style={isNewTask ? s.newTaskRowActive : s.newTaskRowInactive} onClick={onNewTask}>
        <Plus size={14} strokeWidth={2.5} style={s.flexShrinkIcon} />
        <span style={s.newTaskRowLabel}>{t("task.newTask")}</span>
      </button>

      {/* 快捷创建按钮：点一下直接建任务；末尾的「+」打开编辑器（增删改） */}
      <div style={s.presetChipRow}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            style={{
              ...s.presetChip,
              ...(hoverPresetId === preset.id
                ? { background: "var(--bg-hover)", color: "var(--text-primary)" }
                : null),
            }}
            title={`${presetSummary(preset, {
              claude: "Claude Code",
              codex: "Codex",
              shell: t("terminal.title"),
              worktree: t("newTask.dialogIsolated"),
            })}${t("preset.rightClickHint")}`}
            onMouseEnter={() => setHoverPresetId(preset.id)}
            onMouseLeave={() => {
              setHoverPresetId((prev) => (prev === preset.id ? null : prev));
              cancelLongPress();
            }}
            onPointerDown={() => startLongPress(preset.id)}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onContextMenu={(event) => {
              event.preventDefault();
              onManagePresets(preset.id);
            }}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return; // 长按已经打开编辑面板了，不再建任务
              }
              onRunPreset(preset);
            }}
          >
            {preset.agent === "claude" ? (
              <img src={claudeLogo} style={s.presetChipIcon} />
            ) : preset.agent === "codex" ? (
              <img src={chatgptLogo} style={s.presetChipIcon} />
            ) : (
              <Terminal size={11} strokeWidth={2.2} style={s.flexShrinkIcon} />
            )}
            <span style={s.presetChipLabel}>{preset.name}</span>
          </button>
        ))}
        <button
          type="button"
          style={{
            ...s.presetChipAdd,
            ...(hoverPresetId === "__add__"
              ? { background: "var(--bg-hover)", color: "var(--text-secondary)" }
              : null),
          }}
          title={t("preset.manage")}
          aria-label={t("preset.manage")}
          onMouseEnter={() => setHoverPresetId("__add__")}
          onMouseLeave={() => setHoverPresetId((prev) => (prev === "__add__" ? null : prev))}
          onClick={() => onManagePresets()}
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
      </div>

      <div style={s.taskDivider} />

      {/* Task list */}
      <TaskList
        tasks={tasks}
        taskDisplayWindow={taskDisplayWindow}
        query={query}
        selectedId={selectedId}
        isNewTask={isNewTask}
        localSessions={localSessions}
        selectedLocalSessionId={selectedLocalSessionId}
        onSelectLocalSession={onSelectLocalSession}
        onSelectTask={onSelectTask}
        onDeleteTask={onDeleteTask}
        onToggleTaskStar={onToggleTaskStar}
      />
    </div>
  );
}
