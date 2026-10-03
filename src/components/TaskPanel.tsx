import { useState } from "react";
import { Pencil, Plus, Search, Terminal } from "lucide-react";
import type { LocalClaudeSession, Project, Task, TaskDisplayWindow } from "../types";
import { ProjectAvatar } from "./ProjectAvatar";
import { TaskList } from "./task-panel/TaskList";
import { useI18n } from "../i18n";
import claudeLogo from "../assets/claude.svg";
import chatgptLogo from "../assets/chatgpt.svg";
import { presetSummary, type TaskPreset } from "../taskPresets";
import s from "../styles";

export function TaskPanel({
  project,
  tasks,
  selectedId,
  isNewTask,
  localSessions,
  selectedLocalSessionId,
  onSelectLocalSession,
  onNewTask,
  presets,
  onRunPreset,
  onAddPreset,
  onEditPresets,
  onSelectTask,
  onDeleteTask,
  onToggleTaskStar,
  onRenameTask,
  renamingTaskId,
  onRenamingTaskIdChange,
  taskDisplayWindow,
  onTaskDisplayWindowChange,
}: {
  project: Project;
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
  /** 打开「添加」弹窗 */
  onAddPreset: () => void;
  /** 打开「编辑」弹窗；带 presetId 表示直接选中那条 */
  onEditPresets: (presetId?: string) => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onToggleTaskStar: (id: string) => void;
  /** 列表右键菜单的「重命名」 */
  onRenameTask: (id: string, name: string) => void;
  /** 改名中的任务 id（提到项目层：主区域标签上右键也能进改名） */
  renamingTaskId: string | null;
  onRenamingTaskIdChange: (id: string | null) => void;
  taskDisplayWindow: TaskDisplayWindow;
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  const [newTaskHover, setNewTaskHover] = useState(false);

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

      {/* New Task row */}
      <button
        style={{
          ...s.newTaskRowPrimary,
          ...(newTaskHover ? { filter: "brightness(0.97)" } : null),
        }}
        onMouseEnter={() => setNewTaskHover(true)}
        onMouseLeave={() => setNewTaskHover(false)}
        onClick={onNewTask}
      >
        <Plus size={14} strokeWidth={2.6} style={s.flexShrinkIcon} />
        <span style={s.newTaskRowLabel}>{t("task.newTask")}</span>
      </button>

      {/* 快捷命令：标题右侧是「添加」「编辑」两个按钮；下面排列按钮本身，点一下直接建任务。
          单颗按钮上右键 = 直接进编辑面板并选中它。 */}
      <div style={s.taskDivider} />
      <div style={s.presetSectionHeaderRow}>
        <span style={s.presetSectionHeader}>{t("preset.sectionTitle")}</span>
        <span style={s.presetSectionActions}>
          <button
            type="button"
            style={{
              ...s.presetHeaderBtn,
              ...(hoverPresetId === "__add__" ? { background: "var(--bg-hover)", color: "var(--text-primary)" } : null),
            }}
            title={t("preset.addButton")}
            aria-label={t("preset.addButton")}
            onMouseEnter={() => setHoverPresetId("__add__")}
            onMouseLeave={() => setHoverPresetId((prev) => (prev === "__add__" ? null : prev))}
            onClick={onAddPreset}
          >
            <Plus size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            style={{
              ...s.presetHeaderBtn,
              opacity: presets.length === 0 ? 0.4 : 1,
              cursor: presets.length === 0 ? "not-allowed" : "pointer",
              ...(hoverPresetId === "__edit__" ? { background: "var(--bg-hover)", color: "var(--text-primary)" } : null),
            }}
            title={t("preset.editButton")}
            aria-label={t("preset.editButton")}
            disabled={presets.length === 0}
            onMouseEnter={() => setHoverPresetId("__edit__")}
            onMouseLeave={() => setHoverPresetId((prev) => (prev === "__edit__" ? null : prev))}
            onClick={() => onEditPresets()}
          >
            <Pencil size={12} strokeWidth={2.2} />
          </button>
        </span>
      </div>
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
            title={presetSummary(preset, {
              claude: "Claude Code",
              codex: "Codex",
              kimi: "Kimi",
              shell: t("terminal.title"),
              worktree: t("newTask.dialogIsolated"),
            })}
            onMouseEnter={() => setHoverPresetId(preset.id)}
            onMouseLeave={() => setHoverPresetId((prev) => (prev === preset.id ? null : prev))}
            onContextMenu={(event) => {
              event.preventDefault();
              onEditPresets(preset.id);
            }}
            onClick={() => onRunPreset(preset)}
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
        onRenameTask={onRenameTask}
        renamingTaskId={renamingTaskId}
        onRenamingTaskIdChange={onRenamingTaskIdChange}
        onTaskDisplayWindowChange={onTaskDisplayWindowChange}
      />
    </div>
  );
}
