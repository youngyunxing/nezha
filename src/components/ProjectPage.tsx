import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Project,
  ProjectAvatarStyle,
  Task,
  AgentType,
  PermissionMode,
  ThemeVariant,
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
  FontFamily,
  LocalClaudeSession,
} from "../types";
import type { ProjectRenameResult } from "../projectName";
import { TaskPanel } from "./TaskPanel";
import { NewTaskDialog } from "./new-task/NewTaskDialog";
import { LocalSessionView } from "./LocalSessionView";
import { RunningView } from "./RunningView";
import { FileExplorer } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { GitChanges } from "./GitChanges";
import { GitHistory } from "./GitHistory";
import { GitDiffViewer } from "./GitDiffViewer";
import { ProjectDrawer } from "./ProjectDrawer";
import { RightToolbar } from "./RightToolbar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useProjectPanels } from "../hooks/useProjectPanels";
import { resolveProjectGitContext, useGitRoots } from "../hooks/useGitRoots";
import s from "../styles";

export function ProjectPage({
  project,
  visible = true,
  allProjects = [],
  tasks,
  getTaskRestoreState,
  taskRunCounts,
  selectedTaskId,
  isNewTask,
  localSession,
  onSelectLocalSession,
  onResumeLocalSession,
  onSelectTask,
  onDeleteTask,
  onToggleTaskStar,
  onRenameTask,
  onSubmitTask,
  onResumeTask,
  onForkTask,
  onMergeWorktree,
  onDiscardWorktree,
  onReconnectTask,
  onInput,
  onResize,
  onRegisterTerminal,
  onTerminalReady,
  onSnapshot,
  onSwitchProject,
  onCommitProjectOrder,
  onOpen,
  onToggleProjectHidden,
  onUpdateProjectAvatar,
  onDeleteProject,
  onRenameProject,
  themeVariant,
  onToggleTheme,
  terminalFontSize,
  onTerminalFontSizeChange,
  taskDisplayWindow,
  onTaskDisplayWindowChange,
  attentionBadge,
  onAttentionBadgeChange,
  terminalScrollback,
  onTerminalScrollbackChange,
  uiFontFamily,
  onUiFontFamilyChange,
  monoFontFamily,
  onMonoFontFamilyChange,
}: {
  project: Project;
  visible?: boolean;
  allProjects?: Project[];
  tasks: Task[];
  getTaskRestoreState: (taskId: string) => { initialData?: string; initialSnapshot?: string };
  taskRunCounts: Record<string, number>;
  selectedTaskId: string | null;
  isNewTask: boolean;
  /** 正在查看的本地 Claude Code 会话（非 Nezha 任务）。 */
  localSession: LocalClaudeSession | null;
  onSelectLocalSession: (session: LocalClaudeSession) => void;
  onResumeLocalSession: (session: LocalClaudeSession) => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onToggleTaskStar: (id: string) => void;
  onRenameTask: (id: string, name: string) => void;
  onSubmitTask: (t: {
    prompt: string;
    agent: AgentType;
    permissionMode: PermissionMode;
    images: string[];
    texts: string[];
    launchMode: "local" | "worktree";
    baseBranch: string;
    /** 任务关联的 git 根（worktree 创建于此） */
    repoPath: string;
    /** 显式任务名（新建任务弹窗给的名字）；缺省时按提示词推断。 */
    name?: string;
  }) => void;
  onResumeTask: (id: string) => void;
  onForkTask: (id: string, name: string) => void;
  onMergeWorktree: (id: string) => Promise<void>;
  onDiscardWorktree: (id: string) => Promise<void>;
  onReconnectTask: (id: string) => void;
  onInput: (taskId: string, data: string) => void;
  onResize: (taskId: string, cols: number, rows: number) => void;
  onRegisterTerminal: (
    taskId: string,
    writeFn: ((data: string, callback?: () => void) => void) | null,
  ) => number;
  onTerminalReady: (taskId: string, generation: number) => void;
  onSnapshot: (taskId: string, snapshot: string) => void;
  onSwitchProject: (project: Project) => void;
  onCommitProjectOrder: (draggedId: string, beforeId: string | null, visibleIds: string[]) => void;
  onOpen: () => void;
  onToggleProjectHidden: (projectId: string) => void;
  onUpdateProjectAvatar: (projectId: string, avatar: ProjectAvatarStyle | undefined) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => Promise<ProjectRenameResult>;
  themeVariant: ThemeVariant;
  onToggleTheme: () => void;
  terminalFontSize: TerminalFontSize;
  onTerminalFontSizeChange: (size: TerminalFontSize) => void;
  taskDisplayWindow: TaskDisplayWindow;
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
  attentionBadge: boolean;
  onAttentionBadgeChange: (enabled: boolean) => void;
  terminalScrollback: TerminalScrollback;
  onTerminalScrollbackChange: (value: TerminalScrollback) => void;
  uiFontFamily: FontFamily;
  onUiFontFamilyChange: (family: FontFamily) => void;
  monoFontFamily: FontFamily;
  onMonoFontFamilyChange: (family: FontFamily) => void;
}) {
  const {
    rightPanel,
    openFiles,
    activeFilePath,
    openDiff,
    rightPanelWidth,
    setOpenDiff,
    handleTogglePanel,
    handleFileSelect,
    handleFileTabSelect,
    handleFileTabClose,
    handleCloseOtherFileTabs,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFileTabs,
    handleDiffFileSelect,
    handleCommitSelect,
    handleCommitFileClick,
    clearFileAndDiff,
    handleRightResizeStart,
  } = useProjectPanels();

  const [mountedTaskIds, setMountedTaskIds] = useState<Set<string>>(() => new Set());

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === project.id),
    [tasks, project.id],
  );
  const selectedTask = projectTasks.find((t) => t.id === selectedTaskId) ?? null;

  // 本机 Claude Code 直接在该目录产生的会话。已被 Nezha 接管的（任务里带 session id）
  // 排除掉，同一条会话不会既当任务又当本地记录出现两次。
  const [localSessions, setLocalSessions] = useState<LocalClaudeSession[]>([]);
  const knownClaudeSessionIds = useMemo(
    () =>
      projectTasks
        .map((task) => task.claudeSessionId)
        .filter((id): id is string => !!id)
        .sort()
        .join(","),
    [projectTasks],
  );
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    invoke<LocalClaudeSession[]>("list_local_claude_sessions", {
      projectPath: project.path,
      excludeSessionIds: knownClaudeSessionIds ? knownClaudeSessionIds.split(",") : [],
    })
      .then((sessions) => {
        if (!cancelled) setLocalSessions(sessions);
      })
      .catch(() => {
        if (!cancelled) setLocalSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, project.path, knownClaudeSessionIds]);

  // 工作区项目可能包含多个 sub-repo，selectedRoot.path 为当前活动的 git 根（缺省回落 project.path）。
  const {
    roots: gitRoots,
    selectedRoot,
    setSelectedRoot,
  } = useGitRoots(project.id, project.path, visible);
  const subRepoPath = selectedRoot?.path ?? project.path;

  // Worktree 任务固定归属于创建它的 git 根。选中这类任务时，仓库选择器、BranchBar
  // 和 Git 面板必须保持同一上下文，不能让全局 sub-repo 选择把界面拆成两个仓库。
  const {
    displayedRepoPath,
    commandRepoPath: gitContextPath,
    selectionLocked: repoSelectionLocked,
  } = resolveProjectGitContext(project.path, subRepoPath, selectedTask);

  const previousGitContextRef = useRef(gitContextPath);
  useEffect(() => {
    if (previousGitContextRef.current === gitContextPath) return;
    previousGitContextRef.current = gitContextPath;
    // diff 的 path/hash 都属于旧仓库；切换上下文后继续复用会展示另一个仓库的内容。
    setOpenDiff(null);
  }, [gitContextPath, setOpenDiff]);

  // 只挂载当前选中的任务的 xterm 实例，其他任务通过 snapshot 序列化后卸载。
  // 这样同时只有 1 个 WebGL context 存活，避免长时间运行后 GPU 内存累积。
  useEffect(() => {
    if (selectedTaskId && !isNewTask) {
      setMountedTaskIds((prev) => {
        if (prev.size === 1 && prev.has(selectedTaskId)) return prev;
        return new Set([selectedTaskId]);
      });
    }
  }, [selectedTaskId, isNewTask]);

  // diff viewer 打开/关闭时自动联动任务面板的折叠态，但只在 "无 diff → 有 diff" 或
  const handleSelectTask = useCallback(
    (id: string) => {
      clearFileAndDiff();
      onSelectTask(id);
    },
    [onSelectTask, clearFileAndDiff],
  );

  // 「新建任务」不再切走视图，而是弹窗——原来切到新建任务页会把当前会话顶掉。
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false);

  const handleNewTask = useCallback(() => {
    clearFileAndDiff();
    setShowNewTaskDialog(true);
  }, [clearFileAndDiff]);

  const currentTaskCreatedAt = selectedTask?.createdAt ?? null;

  return (
    <div style={visible ? s.projectBodyVisible : s.projectBodyHidden}>
      <ProjectDrawer
        projects={allProjects}
        allTasks={tasks}
        activeProjectId={project.id}
        onSwitch={onSwitchProject}
        onCommitProjectOrder={onCommitProjectOrder}
        onOpen={onOpen}
        onToggleProjectHidden={onToggleProjectHidden}
        onUpdateProjectAvatar={onUpdateProjectAvatar}
        onDelete={onDeleteProject}
        onRenameProject={onRenameProject}
        themeVariant={themeVariant}
        onToggleTheme={onToggleTheme}
        terminalFontSize={terminalFontSize}
        onTerminalFontSizeChange={onTerminalFontSizeChange}
        taskDisplayWindow={taskDisplayWindow}
        onTaskDisplayWindowChange={onTaskDisplayWindowChange}
        attentionBadge={attentionBadge}
        onAttentionBadgeChange={onAttentionBadgeChange}
        terminalScrollback={terminalScrollback}
        onTerminalScrollbackChange={onTerminalScrollbackChange}
        uiFontFamily={uiFontFamily}
        onUiFontFamilyChange={onUiFontFamilyChange}
        monoFontFamily={monoFontFamily}
        onMonoFontFamilyChange={onMonoFontFamilyChange}
      />
      <TaskPanel
        project={project}
        repoPath={displayedRepoPath}
        branchRepoPath={gitContextPath}
        repoSelectionLocked={repoSelectionLocked}
        gitRoots={gitRoots}
        onSelectRoot={setSelectedRoot}
        tasks={projectTasks}
        selectedId={selectedTaskId}
        isNewTask={isNewTask}
        localSessions={localSessions}
        selectedLocalSessionId={localSession?.sessionId ?? null}
        onSelectLocalSession={onSelectLocalSession}
        onNewTask={handleNewTask}
        onSelectTask={handleSelectTask}
        onDeleteTask={onDeleteTask}
        onToggleTaskStar={onToggleTaskStar}
        taskDisplayWindow={taskDisplayWindow}
        active={visible}
      />
      <div style={s.mainContent}>
        <div style={s.projectMainStage}>
          {/* Foreground: file viewer, diff, or new-task composer */}
          <ErrorBoundary
            label="主内容区"
            fallback={(error, reset) => (
              <div style={s.errorBoundaryWrap}>
                <div style={s.errorBoundaryIcon}>⚠</div>
                <div style={s.errorBoundaryTitle}>内容区渲染出错</div>
                <div style={s.errorBoundaryMessage}>{error.message || "未知错误"}</div>
                <div style={s.errorBoundaryActions}>
                  <button onClick={reset} style={s.errorBoundaryBtn}>
                    重试
                  </button>
                  <button
                    onClick={() => {
                      clearFileAndDiff();
                      reset();
                    }}
                    style={s.errorBoundaryBtn}
                  >
                    返回任务视图
                  </button>
                </div>
              </div>
            )}
          >
            {openDiff ? (
              openDiff.kind === "file" ? (
                <GitDiffViewer
                  projectRoot={project.path}
                  repoPath={gitContextPath}
                  mode="file"
                  filePath={openDiff.filePath}
                  staged={openDiff.staged}
                  title={openDiff.label}
                  onClose={() => setOpenDiff(null)}
                />
              ) : openDiff.kind === "commit-file" ? (
                <GitDiffViewer
                  projectRoot={project.path}
                  repoPath={gitContextPath}
                  mode="commit-file"
                  commitHash={openDiff.hash}
                  filePath={openDiff.filePath}
                  title={openDiff.label}
                  onClose={() => setOpenDiff(null)}
                />
              ) : (
                <GitDiffViewer
                  projectRoot={project.path}
                  repoPath={gitContextPath}
                  mode="commit"
                  commitHash={openDiff.hash}
                  title={openDiff.message}
                  onClose={() => setOpenDiff(null)}
                />
              )
            ) : openFiles.length > 0 ? (
              <FileViewer
                tabs={openFiles}
                activeFilePath={activeFilePath}
                projectPath={project.path}
                onSelectTab={handleFileTabSelect}
                onCloseTab={handleFileTabClose}
                onCloseOtherTabs={handleCloseOtherFileTabs}
                onCloseTabsToRight={handleCloseTabsToRight}
                onCloseTabsToLeft={handleCloseTabsToLeft}
                onCloseAllTabs={handleCloseAllFileTabs}
                themeVariant={themeVariant}
              />
            ) : localSession ? (
              <LocalSessionView
                session={localSession}
                themeVariant={themeVariant}
                onResume={() => onResumeLocalSession(localSession)}
              />
            ) : null}
          </ErrorBoundary>

          {/* Background terminals */}
          {projectTasks
            .filter((t) => mountedTaskIds.has(t.id))
            .map((task) => {
              const isVisible =
                openFiles.length === 0 &&
                !openDiff &&
                !isNewTask &&
                !localSession &&
                !!selectedTask &&
                task.id === selectedTaskId;
              return (
                <RunningView
                  key={task.id}
                  task={task}
                  projectPath={project.path}
                  runCount={taskRunCounts[task.id] ?? 0}
                  visible={visible && isVisible}
                  projectActive={visible}
                  onResume={() => onResumeTask(task.id)}
                  onFork={(name) => onForkTask(task.id, name)}
                  onMergeWorktree={() => onMergeWorktree(task.id)}
                  onDiscardWorktree={() => onDiscardWorktree(task.id)}
                  onReconnect={() => onReconnectTask(task.id)}
                  onInput={(data) => onInput(task.id, data)}
                  onResize={(cols, rows) => onResize(task.id, cols, rows)}
                  onRegisterTerminal={(fn) => onRegisterTerminal(task.id, fn)}
                  onTerminalReady={(generation) => onTerminalReady(task.id, generation)}
                  onSnapshot={(snapshot) => onSnapshot(task.id, snapshot)}
                  getRestoreState={() => getTaskRestoreState(task.id)}
                  onRename={(name) => onRenameTask(task.id, name)}
                  themeVariant={themeVariant}
                  terminalFontSize={terminalFontSize}
                  terminalScrollback={terminalScrollback}
                  monoFontFamily={monoFontFamily}
                />
              );
            })}
        </div>
      </div>

      {rightPanel && (
        <div style={s.rightPanelWrap}>
          <div onMouseDown={handleRightResizeStart} style={s.rightPanelResizeHandle} />
          {rightPanel === "files" && (
            <ErrorBoundary label="文件浏览器">
              <FileExplorer
                projectPath={project.path}
                projectName={project.name}
                onFileSelect={handleFileSelect}
                active={visible}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
          {rightPanel === "git-changes" && (
            <ErrorBoundary label="Git 变更">
              <GitChanges
                projectRoot={project.path}
                repoPath={gitContextPath}
                currentTaskCreatedAt={currentTaskCreatedAt}
                onFileSelect={handleDiffFileSelect}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
          {rightPanel === "git-history" && (
            <ErrorBoundary label="Git 历史">
              <GitHistory
                projectRoot={project.path}
                repoPath={gitContextPath}
                onCommitSelect={handleCommitSelect}
                onFileClick={handleCommitFileClick}
                width={rightPanelWidth}
              />
            </ErrorBoundary>
          )}
        </div>
      )}

      {showNewTaskDialog && (
        <NewTaskDialog
          projectPath={project.path}
          repoPath={subRepoPath}
          onCancel={() => setShowNewTaskDialog(false)}
          onCreate={(input) => {
            setShowNewTaskDialog(false);
            onSubmitTask({
              ...input,
              prompt: "",
              permissionMode: "full_access",
              images: [],
              texts: [],
              repoPath: subRepoPath,
            });
          }}
        />
      )}

      <RightToolbar
        activePanel={rightPanel}
        onToggle={handleTogglePanel}
      />
    </div>
  );
}
