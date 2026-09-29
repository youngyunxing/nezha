import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { LocalClaudeSession, Project, Task, GitRoot, TaskDisplayWindow } from "../types";
import { ProjectAvatar } from "./ProjectAvatar";
import { BranchBar } from "./task-panel/BranchBar";
import { RepoSelector } from "./task-panel/RepoSelector";
import { TaskList } from "./task-panel/TaskList";
import { useI18n } from "../i18n";
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
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onToggleTaskStar: (id: string) => void;
  taskDisplayWindow: TaskDisplayWindow;
  active?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

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
