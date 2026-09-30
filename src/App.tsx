import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { open as openDialog, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  Project,
  Task,
  TaskStatus,
  AgentType,
  PermissionMode,
  ThemeMode,
  ThemeVariant,
  TerminalFontSize,
  TerminalScrollback,
  TaskDisplayWindow,
  LocalClaudeSession,
} from "./types";
import {
  isActiveTaskStatus,
  DEFAULT_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
  DEFAULT_TERMINAL_SCROLLBACK,
  clampTerminalScrollback,
  DEFAULT_TASK_DISPLAY_WINDOW,
  normalizeTaskDisplayWindow,
} from "./types";
import {
  DEFAULT_UI_FONT,
  defaultTaskName,
  getDefaultMonoFont,
  isAutoDefaultMonoFont,
} from "./types";
import type { FontFamily, ProjectAvatarStyle } from "./types";
import { quoteFontName } from "./utils/fonts";
import { load, save } from "./utils";
import { ProjectPage } from "./components/ProjectPage";
import { useToast } from "./components/Toast";
import { isHideWindowShortcut } from "./shortcuts";
import { ProjectAppearanceProvider } from "./hooks/useProjectAppearance";
import { normalizeProjectAvatar } from "./projectAvatar";
import { useTerminalManager } from "./hooks/useTerminalManager";
import { loadAttentionSeen, saveAttentionSeen, type AttentionSeenMap } from "./attentionSeen";
import { buildProjectActivityMap } from "./components/project-rail/activity";
import { loadTaskPresets, saveTaskPresets, type TaskPreset } from "./taskPresets";
import {
  TaskPresetAddDialog,
  TaskPresetEditDialog,
} from "./components/new-task/TaskPresetDialog";
import {
  loadQuickAutoEnter,
  loadQuickInputs,
  saveQuickAutoEnter,
  saveQuickInputs,
  type QuickInput as QuickInputItem,
} from "./quickInputs";
import { buildHandoffPrompt, sessionMessagesToText, type CopyableMessage } from "./sessionText";
import type { HandoffOptions } from "./components/running-view/FlowHandoff";
import { useWorktreeDiffStats } from "./hooks/useWorktreeDiffStats";
import {
  normalizeProjectNameInput,
  validateProjectName,
  type ProjectRenameResult,
} from "./projectName";
import { useI18n } from "./i18n";
import { ProjectDrawer } from "./components/ProjectDrawer";
import {
  DARK_THEME_MODE,
  getNextThemeMode,
  isThemeMode,
  LIGHT_THEME_MODE,
  resolveThemeVariant,
  THEME_STORAGE_KEY,
} from "./theme";
import s from "./styles";
import "./App.css";

function deriveProjectName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return path;

  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

async function persistProjects(
  projects: Project[],
  onError: (msg: string) => void,
  formatError: (error: string) => string,
): Promise<boolean> {
  try {
    await invoke("save_projects", { projects });
    return true;
  } catch (e: unknown) {
    console.error(e);
    onError(formatError(String(e)));
    return false;
  }
}

// 启动时任务加载失败(文件损坏/IO 错误)的项目。本次会话内禁止对这些项目
// 覆盖写盘——此时内存 state 是空的,一旦写出去会把磁盘上尚可人工恢复的
// 数据覆盖或清空。重启后重新加载成功即自动解除。
const taskPersistBlockedProjectIds = new Set<string>();

function persistProjectTasks(
  projectId: string,
  allTasks: Task[],
  onError: (msg: string) => void,
  formatError: (error: string, projectId: string) => string,
) {
  if (taskPersistBlockedProjectIds.has(projectId)) {
    onError(
      formatError(
        "tasks failed to load at startup; saving is disabled to protect on-disk data (restart to retry)",
        projectId,
      ),
    );
    return;
  }
  invoke("save_project_tasks", {
    projectId,
    tasks: allTasks.filter((t) => t.projectId === projectId),
  }).catch((e: unknown) => {
    console.error(e);
    onError(formatError(String(e), projectId));
  });
}

function persistProjectTasksQuietly(projectId: string, allTasks: Task[]) {
  if (taskPersistBlockedProjectIds.has(projectId)) return;
  invoke("save_project_tasks", {
    projectId,
    tasks: allTasks.filter((t) => t.projectId === projectId),
  }).catch(console.error);
}

// 老用户首次升级到拖拽排序版本时,把 projects 数组按 id 升序排一次并落盘,
// 让上来看到的 rail 顺序和旧版本(railProjects useMemo 里的 sort)一致。
// 之后用户拖拽产生的顺序由 projects 数组本身承载,不再排序。
const RAIL_PROJECTS_ORDERED_KEY = "nezha:rail-projects-ordered";

/** 跨重启保留「上次在这个项目里看的是哪条会话」。只存用户主动选的会话——
 *  「停在新建任务页」是有意为之，不该粘到下次启动。 */
const PROJECT_VIEWS_KEY = "nezha:project-views";

interface PersistedProjectView {
  selectedTaskId?: string;
  localSession?: LocalClaudeSession;
}

type PersistedProjectViews = Record<string, PersistedProjectView>;

function isProjectsIdAscending(projects: Project[]): boolean {
  for (let i = 1; i < projects.length; i++) {
    if (Number(projects[i].id) < Number(projects[i - 1].id)) return false;
  }
  return true;
}

// 拖拽重排:beforeId === null 表示拖到 visible 末尾;draggedId === beforeId 视为无操作。
// visibleIds 是 rail 当前可见子集(过滤了 hiddenFromRail 与 hub),src/dst 在这个子序列
// 里算 — 直接在完整 projects 上 splice 会因为 hidden 项夹在中间而无声改写它们的相对位置
// (用户取消隐藏时会看到位置错乱)。重排后只回填到 visible 槽位,hidden 项原位保留。
// 返回新数组(若顺序无变化则返回原数组,方便 setState 早退)。
function reorderProjects(
  projects: Project[],
  visibleIds: string[],
  draggedId: string,
  beforeId: string | null,
): Project[] {
  if (draggedId === beforeId) return projects;

  const srcIdxV = visibleIds.indexOf(draggedId);
  if (srcIdxV === -1) return projects;

  const dstIdxV = beforeId === null ? visibleIds.length : visibleIds.indexOf(beforeId);
  if (dstIdxV === -1) return projects;

  const newVisibleOrder = [...visibleIds];
  const [dragged] = newVisibleOrder.splice(srcIdxV, 1);
  const adjustedDstIdxV = dstIdxV > srcIdxV ? dstIdxV - 1 : dstIdxV;
  newVisibleOrder.splice(adjustedDstIdxV, 0, dragged);

  const visibleSet = new Set(visibleIds);
  const projectById = new Map(projects.map((p) => [p.id, p] as const));
  let visibleCursor = 0;
  const next = projects.map((p) => {
    if (!visibleSet.has(p.id)) return p;
    const id = newVisibleOrder[visibleCursor++];
    return projectById.get(id) ?? p;
  });

  if (next.every((p, i) => p === projects[i])) return projects;
  return next;
}

interface ProjectViewState {
  selectedTaskId: string | null;
  isNewTask: boolean;
  /** 正在查看的本地 Claude Code 会话（非 Nezha 任务）。 */
  localSession: LocalClaudeSession | null;
}

function createDefaultProjectViewState(): ProjectViewState {
  return { selectedTaskId: null, isNewTask: true, localSession: null };
}

function normalizeInterruptedTasksOnStartup(
  tasks: Task[],
  activeTaskIds: Set<string>,
): {
  tasks: Task[];
  changedProjectIds: Set<string>;
} {
  const interruptedAt = Date.now();
  const changedProjectIds = new Set<string>();
  const normalized = tasks.map((task) => {
    const hasLiveChild = activeTaskIds.has(task.id);
    if (!isActiveTaskStatus(task.status) && !(task.status === "interrupted" && hasLiveChild)) {
      return task;
    }

    // 一律落成 interrupted，用 processAlive 区分「进程还在 → 点重连」和「进程没了 → 点恢复」
    if (!hasLiveChild && task.status === "interrupted" && !task.processAlive) return task;
    changedProjectIds.add(task.projectId);
    return {
      ...task,
      status: "interrupted" as TaskStatus,
      processAlive: hasLiveChild,
      updatedAt: interruptedAt,
      attentionRequestedAt: task.attentionRequestedAt ?? interruptedAt,
    };
  });

  return { tasks: normalized, changedProjectIds };
}



function getSystemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

function getInitialTerminalFontSize(): TerminalFontSize {
  const stored = localStorage.getItem("nezha:terminalFontSize");
  if (stored == null) return DEFAULT_TERMINAL_FONT_SIZE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampTerminalFontSize(parsed) : DEFAULT_TERMINAL_FONT_SIZE;
}

function getInitialTaskDisplayWindow(): TaskDisplayWindow {
  const stored = localStorage.getItem("nezha:taskDisplayWindow");
  return stored == null ? DEFAULT_TASK_DISPLAY_WINDOW : normalizeTaskDisplayWindow(stored);
}

function getInitialAttentionBadge(): boolean {
  // 默认开启:项目栏显示待确认任务数量角标;关闭后回退为黄色小圆点
  return localStorage.getItem("nezha:attentionBadge") !== "0";
}

function getInitialFontFamily(key: string, fallback: FontFamily): FontFamily {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  // 老版本 useEffect 无差别把当时的 DEFAULT_MONO_FONT 写进 localStorage,
  // 导致默认更新对老用户无效。识别到历史自动默认值就清掉,改用当前平台默认。
  if (key === "nezha:monoFontFamily" && isAutoDefaultMonoFont(stored)) {
    localStorage.removeItem(key);
    return fallback;
  }
  // 旧版本写入的裸字体名（如 "Maple Mono NF CN"）在 Canvas 2D 下会被
  // tokenize 成多个 family 全部 miss；读出时统一 normalize 一次。
  return quoteFontName(stored);
}

const noop = () => {};

function App() {
  const { showToast } = useToast();
  const { t } = useI18n();

  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);
  const themeVariant: ThemeVariant = resolveThemeVariant(themeMode, systemPrefersDark);
  const [terminalFontSize, setTerminalFontSize] = useState<TerminalFontSize>(
    getInitialTerminalFontSize,
  );
  const [taskDisplayWindow, setTaskDisplayWindow] = useState<TaskDisplayWindow>(
    getInitialTaskDisplayWindow,
  );
  const [attentionBadge, setAttentionBadge] = useState<boolean>(getInitialAttentionBadge);
  const [terminalScrollback, setTerminalScrollbackState] = useState<TerminalScrollback>(
    DEFAULT_TERMINAL_SCROLLBACK,
  );
  const handleTerminalScrollbackChange = useCallback((value: TerminalScrollback) => {
    const clamped = clampTerminalScrollback(value);
    setTerminalScrollbackState(clamped);
    invoke("save_terminal_scrollback", { scrollback: clamped }).catch(console.error);
  }, []);
  const [uiFontFamily, setUiFontFamily] = useState<FontFamily>(() =>
    getInitialFontFamily("nezha:uiFontFamily", DEFAULT_UI_FONT),
  );
  const [monoFontFamily, setMonoFontFamily] = useState<FontFamily>(() =>
    getInitialFontFamily("nezha:monoFontFamily", getDefaultMonoFont()),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // 终端管理器要在回调里读最新的任务表（判断任务在不在跑、属于哪个项目）
  const tasksRef = useRef<Task[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  // 项目小标的「已读」时间戳：点开项目就标已读，小标随之消失（见 attentionSeen.ts）
  const [attentionSeen, setAttentionSeen] = useState<AttentionSeenMap>(() => loadAttentionSeen());
  // 快捷创建按钮（预设）：存在 localStorage，跟着应用走（命令在哪个项目里跑就用哪个项目的目录）
  const [presets, setPresets] = useState<TaskPreset[]>(() => loadTaskPresets());
  // 快捷命令的两个弹窗：添加（一张表单）/ 编辑（左列表 + 右面板）
  // 快捷输入（会话右下角）：预设文本，点一下填进当前会话的输入框
  const [quickInputs, setQuickInputs] = useState<QuickInputItem[]>(() => loadQuickInputs());
  const [quickAutoEnter, setQuickAutoEnter] = useState(() => loadQuickAutoEnter());
  const [presetDialog, setPresetDialog] = useState<
    { mode: "add" } | { mode: "edit"; focusId?: string } | null
  >(null);

  /** 快捷按钮：按预设参数直接建任务。worktree 的基准分支留空，由 handleSubmitTask 解析成当前分支。 */
  function handleRunPreset(project: Project, preset: TaskPreset, repoPath?: string) {
    void handleSubmitTask(project, {
      prompt: "",
      agent: preset.agent,
      permissionMode: "full_access",
      images: [],
      texts: [],
      launchMode: preset.useWorktree ? "worktree" : "local",
      baseBranch: "",
      repoPath,
      command: preset.agent === "shell" ? preset.command : undefined,
    });
  }
  const [projectViews, setProjectViews] = useState<Record<string, ProjectViewState>>({});
  const [mountedProjectIds, setMountedProjectIds] = useState<string[]>([]);
  const [taskRunCounts, setTaskRunCounts] = useState<Record<string, number>>({});

  tasksRef.current = tasks;

  const tm = useTerminalManager({
    resolveTaskContext: (taskId) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return null;
      return { projectId: task.projectId, live: isActiveTaskStatus(task.status) };
    },
  });
  const pendingResumeStartsRef = useRef<Record<string, () => void>>({});

  const formatSaveProjectsError = useCallback(
    (error: string) => t("toast.saveProjectsFailed", { error }),
    [t],
  );
  const formatSaveTasksError = useCallback(
    (error: string, projectId: string) => t("toast.saveTasksFailed", { error, projectId }),
    [t],
  );

  const persistTasksForHook = useCallback(
    (projectId: string, allTasks: Task[]) => {
      persistProjectTasks(projectId, allTasks, showToast, formatSaveTasksError);
    },
    [showToast, formatSaveTasksError],
  );
  const { scheduleForDoneTask } = useWorktreeDiffStats({
    projects,
    tasks,
    setTasks,
    persistTasks: persistTasksForHook,
  });

  const mountProject = useCallback((projectId: string) => {
    setMountedProjectIds((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
  }, []);

  const updateProjectView = useCallback((projectId: string, patch: Partial<ProjectViewState>) => {
    setProjectViews((prev) => ({
      ...prev,
      [projectId]: {
        ...createDefaultProjectViewState(),
        ...prev[projectId],
        ...patch,
      },
    }));
  }, []);

  const clearProjectView = useCallback((projectId: string) => {
    setProjectViews((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  // 上次各项目看的会话（跨重启）。用 ref 是因为要在 render 期间读，不引入额外依赖。
  const persistedViewsRef = useRef<PersistedProjectViews>(
    load<PersistedProjectViews>(PROJECT_VIEWS_KEY, {}),
  );

  const persistViewsReadyRef = useRef(false);
  useEffect(() => {
    // 首帧 projectViews 还是空的（初始状态），这时写盘会把刚读出来的存档擦成空。
    if (!persistViewsReadyRef.current) {
      persistViewsReadyRef.current = true;
      return;
    }
    const reduced: PersistedProjectViews = {};
    for (const [projectId, view] of Object.entries(projectViews)) {
      if (view.localSession) {
        reduced[projectId] = { localSession: view.localSession };
      } else if (view.selectedTaskId) {
        reduced[projectId] = { selectedTaskId: view.selectedTaskId };
      }
    }
    persistedViewsRef.current = reduced;
    save(PROJECT_VIEWS_KEY, reduced);
  }, [projectViews]);

  /**
   * 某个项目**首次显示**时的默认视图。以前一律落到「新建任务」页，等于每次打开、每次切
   * 项目都要自己去任务列表里点一下会话。现在按优先级推导：
   *   ① 正在跑的会话（打开时最想看的就是它，启动自动恢复的也是它）
   *   ② 上次在这个项目里看的会话（跨重启保留）
   *   ③ 最近一条任务
   *   ④ 项目里确实没有任务，才回落到新建任务页
   */
  const deriveProjectView = useCallback(
    (projectId: string, allTasks: Task[] = tasks): ProjectViewState => {
      const projectTasks = allTasks.filter((task) => task.projectId === projectId);
      const byRecency = (a: Task, b: Task) =>
        (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt);

      // ① 上次在这个项目里看的东西优先——「回到我离开时的界面」比「猜我想看活跃会话」更稳。
      const persisted = persistedViewsRef.current[projectId];
      if (
        persisted?.selectedTaskId &&
        projectTasks.some((task) => task.id === persisted.selectedTaskId)
      ) {
        return { selectedTaskId: persisted.selectedTaskId, isNewTask: false, localSession: null };
      }
      if (persisted?.localSession) {
        return { selectedTaskId: null, isNewTask: false, localSession: persisted.localSession };
      }

      // ② 没有上次记录（比如第一次打开这个项目）才去找正在跑的会话。
      const active = projectTasks.filter((task) => isActiveTaskStatus(task.status)).sort(byRecency);
      if (active.length > 0) {
        return { selectedTaskId: active[0].id, isNewTask: false, localSession: null };
      }

      const latest = [...projectTasks].sort(byRecency)[0];
      if (latest) {
        return { selectedTaskId: latest.id, isNewTask: false, localSession: null };
      }
      return createDefaultProjectViewState();
    },
    [tasks],
  );

  function getProjectView(projectId: string): ProjectViewState {
    // 没记过状态 = 这个项目本次还没显示过 → 推导一个，避免先闪一下新建任务页。
    return projectViews[projectId] ?? deriveProjectView(projectId);
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // The midnight variant layers on top of the dark token set: it keeps the
    // `dark` class (so it inherits every dark token) and adds `midnight` for the
    // few near-black overrides (menu border / surface backgrounds) declared later
    // in themes.css, which win by source order at equal specificity.
    root.classList.toggle("dark", themeVariant === "dark" || themeVariant === "midnight");
    root.classList.toggle("midnight", themeVariant === "midnight");
    root.classList.toggle("eyecare", themeVariant === "eyecare");
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeVariant, themeMode]);

  useEffect(() => {
    // Tauri window theme only understands light/dark/null; map eyecare to light
    // so the native chrome (titlebar, scrollbars) stays in the light family.
    const nativeTheme =
      themeMode === "system"
        ? null
        : themeMode === "dark" || themeMode === "midnight"
          ? "dark"
          : "light";
    getCurrentWindow().setTheme(nativeTheme).catch(console.error);
  }, [themeMode]);

  useEffect(() => {
    // Cmd+W 收起窗口（隐藏到 Dock），点 Dock 图标可唤回（见 lib.rs Reopen）。
    // 在捕获阶段拦截，先于 xterm 等组件的 keydown 处理，避免被吞掉。
    function handleHideWindow(event: KeyboardEvent) {
      if (!isHideWindowShortcut(event)) return;
      event.preventDefault();
      // 走后端命令收起窗口：全屏时需先退出全屏再隐藏，否则会留下黑屏的空 Space。
      invoke("hide_main_window").catch(console.error);
    }
    window.addEventListener("keydown", handleHideWindow, true);
    return () => window.removeEventListener("keydown", handleHideWindow, true);
  }, []);

  useEffect(() => {
    saveAttentionSeen(attentionSeen);
  }, [attentionSeen]);

  useEffect(() => {
    saveTaskPresets(presets);
  }, [presets]);

  useEffect(() => {
    saveQuickInputs(quickInputs);
  }, [quickInputs]);

  useEffect(() => {
    saveQuickAutoEnter(quickAutoEnter);
  }, [quickAutoEnter]);

  /** 把当前会话的上下文交给另一个 agent：跨 agent 没法恢复对方的会话记录，所以是把
   *  上下文原样写进新任务的提示词。新任务用占位名，跑完第一轮会自动起标题。 */
  async function handleHandoff(taskId: string, options: HandoffOptions): Promise<boolean> {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const project = projects.find((p) => p.id === task.projectId);
    const sessionPath = task.claudeSessionPath ?? task.codexSessionPath;
    if (!project || !sessionPath) return false;
    const sourceLabel = task.agent === "codex" ? "Codex" : "Claude Code";
    const targetLabel = options.agent === "codex" ? "Codex" : "Claude Code";
    try {
      // 压缩摘要：让源 agent 把会话读一遍再写交接摘要（比原样搬更适合长会话）
      const contextText =
        options.contextMode === "compress"
          ? await invoke<string>("compress_session_context", {
              projectPath: project.path,
              agent: task.agent,
              sessionPath,
            })
          : sessionMessagesToText(
              await invoke<CopyableMessage[]>("read_session_messages", { sessionPath }),
              {
                count: options.contextMode === "all" ? undefined : options.contextCount,
                assistantLabel: sourceLabel,
                youLabel: t("copySession.you"),
              },
            );
      if (!contextText) {
        showToast(t("copySession.empty"), "warning");
        return false;
      }
      showToast(t("handoff.created", { agent: targetLabel }), "success");
      await handleSubmitTask(project, {
        prompt: buildHandoffPrompt({ sourceLabel, contextText, note: options.note }),
        agent: options.agent,
        permissionMode: "full_access",
        images: [],
        texts: [],
        launchMode: "local",
        baseBranch: "",
        name: defaultTaskName(options.agent, `${Date.now()}`),
      });
      return true;
    } catch (error) {
      showToast(t("handoff.failed", { error: String(error) }), "error");
      return false;
    }
  }

  function handleSaveQuickInput(item: QuickInputItem) {
    setQuickInputs((prev) =>
      prev.some((q) => q.id === item.id)
        ? prev.map((q) => (q.id === item.id ? item : q))
        : [...prev, item],
    );
  }

  function handleDeleteQuickInput(id: string) {
    setQuickInputs((prev) => prev.filter((q) => q.id !== id));
  }

  function handleSavePreset(preset: TaskPreset) {
    setPresets((prev) => {
      const exists = prev.some((p) => p.id === preset.id);
      return exists ? prev.map((p) => (p.id === preset.id ? preset : p)) : [...prev, preset];
    });
    showToast(t("preset.saved", { name: preset.name }), "success");
  }

  function handleDeletePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    showToast(t("preset.deleted"), "success");
  }

  // Dock 角标 = 所有项目「未读等待」之和：有任务在等你确认 / 有新回复、且你还没看过那个
  // 项目时点亮；点开项目看过、或把等待处理掉（状态离开等待、任务被删）就归零消失。
  // 应用没在前台时它就是「回来看看」的提示，在前台时它也如实反映还有几处没看。
  const unreadAttentionTotal = useMemo(() => {
    let total = 0;
    for (const activity of buildProjectActivityMap(tasks, attentionSeen).values()) {
      total += activity.attentionCount;
    }
    return total;
  }, [tasks, attentionSeen]);

  useEffect(() => {
    invoke("set_dock_badge", { count: unreadAttentionTotal }).catch(() => {});
  }, [unreadAttentionTotal]);

  // 打开一个项目 = 看过它的等待项，小标消失；之后再出现新的等待事件才会重新亮标/招手。
  // 同一秒内的重复激活直接跳过，避免无谓的 setState。
  const activeProjectId = activeProject?.id;
  useEffect(() => {
    if (!activeProjectId) return;
    setAttentionSeen((prev) =>
      Date.now() - (prev[activeProjectId] ?? 0) < 1000 ? prev : { ...prev, [activeProjectId]: Date.now() },
    );
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem("nezha:terminalFontSize", String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    let cancelled = false;
    invoke<{ terminal_scrollback?: unknown }>("load_app_settings")
      .then((settings) => {
        if (cancelled) return;
        setTerminalScrollbackState(clampTerminalScrollback(settings.terminal_scrollback));
      })
      .catch(() => {
        /* 默认 1000 已经在 state 初值,无需 fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("nezha:taskDisplayWindow", String(taskDisplayWindow));
  }, [taskDisplayWindow]);

  useEffect(() => {
    localStorage.setItem("nezha:attentionBadge", attentionBadge ? "1" : "0");
  }, [attentionBadge]);

  useEffect(() => {
    const value = uiFontFamily.trim() || DEFAULT_UI_FONT;
    localStorage.setItem("nezha:uiFontFamily", value);
    document.documentElement.style.setProperty("--font-ui", value);
  }, [uiFontFamily]);

  useEffect(() => {
    const trimmed = monoFontFamily.trim();
    const effective = trimmed || getDefaultMonoFont();
    // 用户没显式自定义时不写入 localStorage,避免把默认值固化、
    // 导致后续改默认对老用户失效（这正是历史 bug 的根因）。
    if (!trimmed || isAutoDefaultMonoFont(trimmed)) {
      localStorage.removeItem("nezha:monoFontFamily");
    } else {
      localStorage.setItem("nezha:monoFontFamily", trimmed);
    }
    document.documentElement.style.setProperty("--font-mono", effective);
  }, [monoFontFamily]);

  const handleToggleTheme = useCallback(() => {
    setThemeMode((currentMode) => {
      return getNextThemeMode(currentMode, systemPrefersDark, LIGHT_THEME_MODE, DARK_THEME_MODE);
    });
  }, [systemPrefersDark]);

  useEffect(() => {
    async function init() {
      // Load projects from ~/.nezha/projects.json
      const loadedProjects = await invoke<Project[]>("load_projects");

      // 仅在首次升级到拖拽版本时做一次性顺序迁移:若 projects.json 不是
      // id 升序(老版本 handleOpen 把新项目插到首位,所以多半是降序),
      // 重排成 id 升序并落盘,与旧版 railProjects 的视觉顺序保持一致。
      // 之后顺序由用户拖拽决定,不再触发此分支。
      const alreadyOrdered = localStorage.getItem(RAIL_PROJECTS_ORDERED_KEY) === "1";
      const projectsForState =
        alreadyOrdered || isProjectsIdAscending(loadedProjects)
          ? loadedProjects
          : [...loadedProjects].sort((a, b) => Number(a.id) - Number(b.id));
      if (!alreadyOrdered) {
        // flag 必须在写盘成功后才落:否则一次磁盘失败 → flag 已锁 → 下次启动跳过
        // 迁移 → 老用户 rail 顺序永久错乱。无需写盘的分支可直接 set。
        if (projectsForState !== loadedProjects) {
          invoke("save_projects", { projects: projectsForState })
            .then(() => {
              localStorage.setItem(RAIL_PROJECTS_ORDERED_KEY, "1");
            })
            .catch((e: unknown) => {
              console.error(e);
              showToast(formatSaveProjectsError(String(e)));
            });
        } else {
          localStorage.setItem(RAIL_PROJECTS_ORDERED_KEY, "1");
        }
      }
      setProjects(projectsForState);

      // 给已有数据补一份 path 索引：任务记录按 project_id 存放，而 id 是「添加项目」
      // 那一刻生成的。没有这份索引，删掉项目再重新添加同一目录就找不回旧记录了。
      projectsForState.forEach((p) => {
        invoke("save_project_meta", { projectId: p.id, path: p.path }).catch(console.error);
      });

      // Load tasks for all known projects。allSettled 隔离单项目失败:
      // 一个 tasks.json 损坏不能让所有项目的任务在 UI 里消失(Promise.all
      // 整体 reject 曾造成这个假象),失败项目单独提示并禁止写盘。
      const results = await Promise.allSettled(
        loadedProjects.map((p) => invoke<Task[]>("load_project_tasks", { projectId: p.id })),
      );
      const chunks: Task[][] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          chunks.push(result.value);
          return;
        }
        const project = loadedProjects[i];
        taskPersistBlockedProjectIds.add(project.id);
        console.error(result.reason);
        showToast(t("toast.loadTasksFailed", { name: project.name, error: String(result.reason) }));
      });
      const activeTaskIds = new Set(await invoke<string[]>("get_active_task_ids"));
      const rawTasks = chunks.flat();
      const { tasks: loadedTasks, changedProjectIds } = normalizeInterruptedTasksOnStartup(
        rawTasks,
        activeTaskIds,
      );

      // 异常中断自动恢复：状态是「异常中断」（interrupted）的任务在启动时直接 --resume
      // 接回去，不用用户逐个点「恢复」。它涵盖两种来源：
      // - 上次还跑着、被崩溃 / 强退 / 断电带走的（上面那次归一化刚标上 interrupted）；
      // - 更早就已经是「异常中断」、一直没去管的。
      //
      // 三条刻意的克制：
      // - 有活子进程的不在这里抢，交给「重连」路径（否则会起第二个 claude）；
      //   纯终端没有会话可 resume，但同样自动重开一个 shell（屏幕由落盘记录回放）；
      // - 必须有 transcript 路径：只有 id 没有路径的多半是刚建好就被带走的，会话文件还没
      //   生成，--resume 必然失败，跳过留给用户手动处理；
      // - 不想被自动恢复就取消它（cancelled 不在恢复范围内）。
      // 另外不动 updatedAt：任务列表按它排序，改成 now 会让恢复回来的任务全跳到最前面，
      // 而这里要的是与中断前一致的顺序。
      const autoResume: Array<{ task: Task; project: Project; sessionId: string | null }> = [];
      for (const task of loadedTasks) {
        if (task.status !== "interrupted" || activeTaskIds.has(task.id)) continue;
        const project = loadedProjects.find((p) => p.id === task.projectId);
        if (!project) continue;
        // 纯终端没有会话可 resume，但也一样自动重开（屏幕由落盘的输出记录回放）。
        if (task.agent === "shell") {
          autoResume.push({ task, project, sessionId: null });
          continue;
        }
        const isCodex = task.agent === "codex";
        const sessionId = isCodex ? task.codexSessionId : task.claudeSessionId;
        const sessionPath = isCodex ? task.codexSessionPath : task.claudeSessionPath;
        if (!sessionId || !sessionPath) continue;
        autoResume.push({ task, project, sessionId });
      }

      const resumedIds = new Set(autoResume.map((item) => item.task.id));
      const nextTasks = loadedTasks.map((task) =>
        resumedIds.has(task.id)
          ? {
              ...task,
              status: "pending" as TaskStatus,
              processAlive: undefined,
              attentionRequestedAt: undefined,
            }
          : task,
      );
      // 先把要恢复的终端屏幕备进输出缓冲区，再让任务转 pending —— 面板一变成 pending
      // 就会挂载并读一次缓冲区，预塞晚于挂载就永远画不出来（重启后纯终端记录丢失就是这么来的）。
      for (const item of autoResume) {
        tm.resetTaskTerminal(item.task.id);
        await seedScreenBeforeRestore(item.task);
      }

      setTasks(nextTasks);


      const touchedProjectIds = new Set(changedProjectIds);
      autoResume.forEach((item) => touchedProjectIds.add(item.task.projectId));
      touchedProjectIds.forEach((projectId) => {
        persistProjectTasksQuietly(projectId, nextTasks);
      });

      // 没有首页了：启动要直接落到某个项目。优先选「有活跃会话」的第一个项目——打开就能
      // 看到正在跑（或刚被自动恢复）的 agent；都没有才回落到最近打开的项目。
      // 只设内存状态，不碰 lastOpenedAt，否则每次启动都会重写一遍 projects.json。
      const startProject =
        projectsForState.find((project) =>
          nextTasks.some(
            (task) => task.projectId === project.id && isActiveTaskStatus(task.status),
          ),
        ) ?? [...projectsForState].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
      if (startProject) {
        setActiveProject(startProject);
        mountProject(startProject.id);
        // 落成显式状态：既是本次运行的 sticky 视图，也会被写进持久化。
        updateProjectView(startProject.id, deriveProjectView(startProject.id, nextTasks));
      }

      autoResume.forEach(({ task, project, sessionId }) => {
        const pendingTask = {
          ...task,
          status: "pending" as TaskStatus,
          attentionRequestedAt: undefined,
        };
        if (sessionId) {
          invokeResumeTask(pendingTask, project, sessionId);
          return;
        }
        invokeRunTask(pendingTask, task.worktreePath ?? project.path, []);
      });
    }

    init().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 用 backend 列表作为内容权威,但顺序以 prev 为准:用户拖拽产生的顺序保存在
    // 前端 state 里,不能被一次后台 reload 还原。共有项的字段由 authoritative 覆盖;
    // prev 独有的(尚未持久化)条目保留;authoritative 独有的(skill hub 等新增)
    // 追加到末尾。
    const mergeProjects = (authoritative: Project[]) => {
      setProjects((prev) => {
        const authMap = new Map<string, Project>();
        authoritative.forEach((p) => authMap.set(p.id, p));
        const seenIds = new Set<string>();
        const next: Project[] = [];
        for (const p of prev) {
          const auth = authMap.get(p.id);
          if (auth !== undefined) {
            next.push(auth);
            seenIds.add(p.id);
          } else {
            next.push(p);
          }
        }
        for (const p of authoritative) {
          if (!seenIds.has(p.id)) next.push(p);
        }
        return next;
      });
    };

    invoke<Project[]>("load_projects")
      .then((loadedProjects) => mergeProjects(loadedProjects))
      .catch(console.error);
  }, []);

  // Tauri event listeners (agent-output is handled inside useTerminalManager)
  useEffect(() => {
    const p1 = listen<{ task_id: string; status: TaskStatus; failure_reason?: string }>(
      "task-status",
      (e) => {
        const { task_id, status, failure_reason } = e.payload;
        updateTaskStatus(task_id, status, undefined, failure_reason);
        if (!isActiveTaskStatus(status)) {
          tm.removeTaskBuffers([task_id]);
        }
        if (status === "done") scheduleForDoneTask(task_id);
      },
    );
    const p2 = listen<{ task_id: string; session_id: string; session_path: string }>(
      "task-session",
      (e) => {
        const { task_id, session_id, session_path } = e.payload;
        updateTaskSession(task_id, session_id, session_path);
      },
    );
    return () => {
      p1.then((fn) => fn());
      p2.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpen() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;
    const path = selected as string;
    const existing = projects.find((p) => p.path === path);
    // 同一目录以前加过（哪怕项目已被删）：沿用旧记录的项目 id，磁盘上的 tasks.json
    // 才能被重新加载回来——删项目不清会话记录，靠的就是这条线索。
    const reusedId = existing
      ? null
      : await invoke<string | null>("find_project_id_by_path", { path });
    const project: Project = existing
      ? { ...existing, lastOpenedAt: Date.now() }
      : {
          id: reusedId ?? `${Date.now()}`,
          name: deriveProjectName(path),
          path,
          lastOpenedAt: Date.now(),
        };
    setProjects((prev) => {
      const next = existing ? prev.map((p) => (p.path === path ? project : p)) : [project, ...prev];
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, createDefaultProjectViewState());
    void invoke("save_project_meta", { projectId: project.id, path }).catch(console.error);

    if (existing) return;

    // 这个目录以前在 Nezha 里跑过就有记录，优先把它们恢复出来；记录里的进程早已
    // 不在，按「启动时中断归一化」同一套逻辑把活动状态落成 interrupted（可续跑）。
    const restored = await invoke<Task[]>("load_project_tasks", { projectId: project.id });
    if (restored.length > 0) {
      const { tasks: normalizedTasks } = normalizeInterruptedTasksOnStartup(restored, new Set());
      setTasks((prev) => [
        ...prev.filter((t) => t.projectId !== project.id),
        ...normalizedTasks,
      ]);
      persistProjectTasks(project.id, normalizedTasks, showToast, formatSaveTasksError);
      return;
    }

    // 没有任何记录的全新项目：直接开一个 Claude Code 本地会话，名字固定 main。
    void handleSubmitTask(project, {
      name: "main",
      prompt: "",
      agent: "claude",
      permissionMode: "full_access",
      images: [],
      texts: [],
      launchMode: "local",
      baseBranch: "",
    });
  }

  function handleProjectClick(project: Project) {
    const updated = { ...project, lastOpenedAt: Date.now() };
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === project.id ? updated : p));
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setActiveProject(updated);
    mountProject(updated.id);
    // 该项目本次还没显示过 → 按「活跃会话 → 上次看的 → 最近任务」推导一次并落成状态。
    if (!projectViews[project.id]) {
      updateProjectView(project.id, deriveProjectView(project.id));
    }
  }

  function invokeRunTask(task: Task, projectPath: string, images: string[], texts: string[] = []) {
    invoke("run_task", {
      taskId: task.id,
      projectPath,
      prompt: task.prompt,
      agent: task.agent,
      permissionMode: task.permissionMode,
      images,
      texts,
      command: task.command ?? null,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    })
      .then(() => tm.reapplyTerminalSize(task.id))
      .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  async function handleSubmitTask(
    project: Project,
    {
      prompt,
      agent,
      permissionMode,
      images,
      texts,
      launchMode,
      baseBranch,
      repoPath,
      name,
      command,
    }: {
      prompt: string;
      agent: AgentType;
      permissionMode: PermissionMode;
      images: string[];
      texts: string[];
      launchMode: "local" | "worktree";
      baseBranch: string;
      /** 任务关联的 git 根（worktree 创建于此目录的 .nezha/worktrees）。
       *  缺省时回落 project.path，向后兼容老调用方。 */
      repoPath?: string;
      /** 显式指定任务名（如添加项目时自动建的 main 会话）；缺省时按提示词推断。 */
      name?: string;
      /** 纯终端任务要执行的命令（快捷按钮带来）；留空 = 交互式终端 */
      command?: string;
    },
  ) {
    const effectiveRepoPath = repoPath ?? project.path;
    const taskId = `${Date.now()}`;

    if (launchMode === "worktree" && !baseBranch) {
      // 快捷按钮没带基准分支：用项目当前分支（弹窗里是自己选的，预设不打断你）
      const list = await invoke<Array<{ name: string; current?: boolean }>>("git_list_branches", {
        projectPath: project.path,
        repoPath: effectiveRepoPath,
      }).catch(() => [] as Array<{ name: string; current?: boolean }>);
      baseBranch = list.find((b) => b.current)?.name ?? "";
      if (!baseBranch) {
        showToast(t("toast.worktreeBaseRequired"), "warning");
        return;
      }
    }

    // 1) 立即把任务推到 state 让 view 切到 RunningView。worktree 字段先留空，
    //    避免 await create_task_worktree 期间用户停留在 NewTaskView，让人误以为没反应。
    const now = Date.now();
    const baseTask: Task = {
      id: taskId,
      projectId: project.id,
      prompt,
      name: name ?? (prompt ? undefined : defaultTaskName(agent, taskId)),
      agent,
      permissionMode,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      command: agent === "shell" ? command : undefined,
    };
    setTasks((prev) => {
      const next = [baseTask, ...prev];
      persistProjectTasks(baseTask.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, {
      selectedTaskId: taskId,
      isNewTask: false,
      localSession: null,
    });


    // 2) 终端 buffer 在 PTY 启动前就要建好，否则首批输出会进不来 buffer。
    tm.resetTaskTerminal(taskId);

    // 3) 如果是 worktree 模式，先创建 worktree，成功后把字段补回 task 再启动 PTY。
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;
    let resolvedBaseBranch: string | undefined;

    if (launchMode === "worktree") {
      try {
        const created = await invoke<{
          worktreePath: string;
          worktreeBranch: string;
          baseBranch: string;
        }>("create_task_worktree", {
          projectPath: project.path,
          repoPath: effectiveRepoPath,
          taskId,
          baseBranch,
        });
        worktreePath = created.worktreePath;
        worktreeBranch = created.worktreeBranch;
        resolvedBaseBranch = created.baseBranch;

        setTasks((prev) => {
          const next = prev.map((tk) =>
            tk.id === taskId
              ? {
                  ...tk,
                  worktreePath,
                  worktreeBranch,
                  baseBranch: resolvedBaseBranch,
                  worktreeRepo: effectiveRepoPath,
                }
              : tk,
          );
          persistProjectTasks(baseTask.projectId, next, showToast, formatSaveTasksError);
          return next;
        });
      } catch (e) {
        showToast(t("toast.worktreeCreateFailed", { error: String(e) }), "error");
        // 回滚刚加的占位 task
        setTasks((prev) => {
          const next = prev.filter((tk) => tk.id !== taskId);
          persistProjectTasks(baseTask.projectId, next, showToast, formatSaveTasksError);
          return next;
        });
        tm.removeTaskBuffers([taskId]);
        return;
      }
    }

    // Agent cwd 恒为 project.path（workspace 根）——多 repo 项目下 agent 才能同时看到所有 sub-repo。
    // sub-repo picker（effectiveRepoPath）只用于 git 面板 / branch bar / worktree 落地位置，
    // 不参与 agent 启动路径；worktree 模式仍以 worktree 路径为 cwd（隔离语义生效）。
    invokeRunTask(
      {
        ...baseTask,
        worktreePath,
        worktreeBranch,
        baseBranch: resolvedBaseBranch,
        worktreeRepo: worktreePath ? effectiveRepoPath : undefined,
      },
      worktreePath ?? project.path,
      images,
      texts,
    );
  }

  function markTaskWorktreeDiscarded(taskId: string) {
    setTasks((prev) => {
      const task = prev.find((x) => x.id === taskId);
      if (!task) return prev;
      const next = prev.map((x) => (x.id === taskId ? { ...x, worktreeDiscarded: true } : x));
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  async function handleMergeWorktree(taskId: string) {
    const task = tasks.find((x) => x.id === taskId);
    if (!task || !task.worktreePath || !task.worktreeBranch || !task.baseBranch) return;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;
    try {
      await invoke("merge_task_worktree", {
        projectPath: project.path,
        repoPath: task.worktreeRepo ?? project.path,
        worktreePath: task.worktreePath,
        branch: task.worktreeBranch,
        baseBranch: task.baseBranch,
      });
      // 合并成功后顺手把 worktree 与分支清掉，避免遗留残留
      await invoke("remove_task_worktree", {
        projectPath: project.path,
        repoPath: task.worktreeRepo ?? project.path,
        worktreePath: task.worktreePath,
        branch: task.worktreeBranch,
      }).catch(() => {});
      markTaskWorktreeDiscarded(taskId);
    } catch (e) {
      showToast(t("toast.worktreeMergeFailed", { error: String(e) }), "error");
    }
  }

  async function handleDiscardWorktree(taskId: string) {
    const task = tasks.find((x) => x.id === taskId);
    if (!task || !task.worktreePath || !task.worktreeBranch) return;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;
    const ok = await confirm(t("task.discardWorktreePrompt", { branch: task.worktreeBranch }), {
      title: t("task.discardWorktreeTitle"),
      kind: "warning",
    });
    if (!ok) return;
    try {
      await invoke("remove_task_worktree", {
        projectPath: project.path,
        repoPath: task.worktreeRepo ?? project.path,
        worktreePath: task.worktreePath,
        branch: task.worktreeBranch,
      });
      markTaskWorktreeDiscarded(taskId);
    } catch (e) {
      showToast(t("toast.worktreeDiscardFailed", { error: String(e) }), "error");
    }
  }

  /** 会话文件大小；不存在或读不到按 0 算（= 这个会话从没写过内容）。 */
  async function sessionFileSize(path: string): Promise<number> {
    try {
      return await invoke<number>("session_file_size", { path });
    } catch {
      return 0;
    }
  }

  function invokeResumeTask(task: Task, project: Project, sessionId: string) {
    invoke("resume_task", {
      taskId: task.id,
      projectPath: task.worktreePath ?? project.path,
      agent: task.agent,
      sessionId,
      prompt: task.prompt,
      permissionMode: task.permissionMode,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    })
      .then(() => tm.reapplyTerminalSize(task.id))
      .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  /** 纯终端任务重开前，把落盘的屏幕记录预塞进缓冲区，让旧内容出现在新输出之前。
   *  agent 任务不塞：TUI 启动会自己重画历史，塞了反而重复。 */
  async function seedScreenBeforeRestore(task: Task) {
    if (task.agent !== "shell") return;
    await tm.seedTaskScreen(task.id, { projectId: task.projectId, live: false });
  }

  /** 「有新回复」是未读状态：你看到了就落回「空闲待命」，列表里不再一直挂着它。
   *  只改状态和注意力标记，不动 updatedAt —— 否则看一眼任务就把它顶到列表最前面。 */
  function markTaskRead(taskId: string) {
    setTasks((prev) => {
      const target = prev.find((t) => t.id === taskId);
      if (!target || target.status !== "awaiting_review") return prev;
      const next = prev.map((t) =>
        t.id === taskId
          ? { ...t, status: "idle" as TaskStatus, attentionRequestedAt: undefined }
          : t,
      );
      persistProjectTasks(target.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  /** 没有会话可续的任务（例如 codex 这一版不留 rollout / 会话 id 没登记上）：
   *  用同样的提示词重新拉起一个新会话，而不是给用户一条死路。 */
  function handleRestartTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    void (async () => {
      tm.resetTaskTerminal(taskId);
      await seedScreenBeforeRestore(task);
      const pendingTask: Task = {
        ...task,
        status: "pending" as TaskStatus,
        processAlive: undefined,
        attentionRequestedAt: undefined,
        failureReason: undefined,
        updatedAt: Date.now(),
      };
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === taskId ? pendingTask : t));
        persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
        return next;
      });
      setTaskRunCounts((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));
      invokeRunTask(pendingTask, task.worktreePath ?? project.path, []);
      showToast(t("running.restarted"), "success");
    })();
  }

  function handleResumeTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    // 纯终端没有会话可 resume：直接重开一个 shell（屏幕上先回放终端快照/输出缓冲）。
    const isShell = task.agent === "shell";
    const sessionId = task.agent === "codex" ? task.codexSessionId : task.claudeSessionId;
    if (!isShell && !sessionId) {
      showToast(t("running.resumeUnavailable"), "warning");
      return;
    }
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    // 顺序要紧：先清缓冲、再预塞屏幕记录，最后才把状态置成 pending —— 面板在 pending 时
    // 挂载并读一次缓冲区，预塞晚一步就画不出来。
    void (async () => {
      tm.resetTaskTerminal(taskId);
      await seedScreenBeforeRestore(task);

      // Reset task status and bump run counter to remount the terminal
      setTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "pending" as TaskStatus,
                updatedAt: Date.now(),
                attentionRequestedAt: undefined,
              }
            : t,
        );
        persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
        return next;
      });
      setTaskRunCounts((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));

      if (isShell) {
        invokeRunTask(
          { ...task, status: "pending" as TaskStatus, attentionRequestedAt: undefined },
          task.worktreePath ?? project.path,
          [],
        );
        return;
      }

      // 类型收窄：非终端的分支在上面已经保证 sessionId 存在。
      if (!sessionId) return;
      pendingResumeStartsRef.current[taskId] = async () => {
        // fork 出来的任务：如果它自己的会话文件是空的（fork 完啥也没干，Claude 根本没写过
        // 这份 transcript），--resume 会直接失败、记录回不来。这种情况用源会话重新 fork 一次。
        if (task.forkedFromSessionId && task.claudeSessionPath) {
          const size = await sessionFileSize(task.claudeSessionPath);
          if (size === 0) {
            invokeForkTask(task, project, task.forkedFromSessionId);
            return;
          }
        }
        invokeResumeTask(task, project, sessionId);
      };
    })();
  }

  /** 选中一条本地会话：主舞台切到它的消息回放（只读）。 */
  function handleSelectLocalSession(project: Project, session: LocalClaudeSession) {
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, {
      selectedTaskId: null,
      isNewTask: false,
      localSession: session,
    });
  }

  /**
   * 把本机 Claude Code 的一条会话接进 Nezha：建一条任务记录（带上它的 session id），
   * 再用 --resume 恢复。和 handleResumeTask 一样，真正拉起放在终端挂载之后，
   * 否则首批输出进不来 buffer。
   */
  function handleResumeLocalSession(project: Project, session: LocalClaudeSession) {
    const taskId = `${Date.now()}`;
    const now = Date.now();
    const task: Task = {
      id: taskId,
      projectId: project.id,
      name: session.preview || t("localSession.fallbackName"),
      prompt: "",
      agent: "claude",
      permissionMode: "full_access",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      claudeSessionId: session.sessionId,
      claudeSessionPath: session.sessionPath,
    };
    setTasks((prev) => {
      const next = [task, ...prev];
      persistProjectTasks(project.id, next, showToast, formatSaveTasksError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, {
      selectedTaskId: taskId,
      isNewTask: false,
      localSession: null,
    });
    tm.resetTaskTerminal(taskId);
    setTaskRunCounts((prev) => ({ ...prev, [taskId]: (prev[taskId] ?? 0) + 1 }));
    pendingResumeStartsRef.current[taskId] = () =>
      invokeResumeTask(task, project, session.sessionId);
  }

  function invokeForkTask(task: Task, project: Project, sourceSessionId: string) {
    invoke("fork_task", {
      taskId: task.id,
      projectPath: project.path,
      agent: task.agent,
      sourceSessionId,
      permissionMode: task.permissionMode,
      cols: tm.terminalSizeRef.current.cols,
      rows: tm.terminalSizeRef.current.rows,
      onOutput: tm.createOutputChannel(task.id),
    })
      .then(() => tm.reapplyTerminalSize(task.id))
      .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      tm.writeErrorToTerminal(task.id, `\r\nError: ${msg}\r\n`);
      updateTaskStatus(task.id, "failed", undefined, msg);
    });
  }

  function handleForkTask(sourceTaskId: string, requestedName: string) {
    const sourceTask = tasks.find((task) => task.id === sourceTaskId);
    if (!sourceTask) return;
    if (sourceTask.worktreePath) {
      showToast(t("running.forkWorktreeUnsupported"), "warning");
      return;
    }

    const sourceSessionId =
      sourceTask.agent === "codex" ? sourceTask.codexSessionId : sourceTask.claudeSessionId;
    if (!sourceSessionId) {
      showToast(t("running.forkUnavailable"), "warning");
      return;
    }
    const name = requestedName.trim();
    if (!name) return;
    const project = projects.find((candidate) => candidate.id === sourceTask.projectId);
    if (!project) return;

    const now = Date.now();
    const forkedTask: Task = {
      id: `${now}`,
      projectId: sourceTask.projectId,
      name,
      prompt: "",
      agent: sourceTask.agent,
      permissionMode: sourceTask.permissionMode,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      forkedFromSessionId: sourceSessionId,
    };

    setTasks((prev) => {
      const next = [forkedTask, ...prev];
      persistProjectTasks(forkedTask.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
    setActiveProject(project);
    mountProject(project.id);
    updateProjectView(project.id, {
      selectedTaskId: forkedTask.id,
      isNewTask: false,
      localSession: null,
    });
    tm.resetTaskTerminal(forkedTask.id);
    invokeForkTask(forkedTask, project, sourceSessionId);
  }

  async function handleReconnectTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const sessionId = task.agent === "codex" ? task.codexSessionId : task.claudeSessionId;
    if (!sessionId) {
      showToast(t("running.resumeUnavailable"), "warning");
      return;
    }

    try {
      await invoke("reset_task_process", { taskId });
    } catch (e: unknown) {
      showToast(t("toast.resetTaskFailed", { error: String(e) }));
      return;
    }
    handleResumeTask(taskId);
  }

  function cleanupTaskWorktree(task: Task, projectPath: string) {
    if (!task.worktreePath || !task.worktreeBranch || task.worktreeDiscarded) return;
    invoke("remove_task_worktree", {
      projectPath,
      repoPath: task.worktreeRepo ?? projectPath,
      worktreePath: task.worktreePath,
      branch: task.worktreeBranch,
    }).catch((e: unknown) => {
      showToast(t("toast.worktreeDiscardFailed", { error: String(e) }), "warning");
    });
  }

  function deleteTasks(taskIds: string[]) {
    if (taskIds.length === 0) return;

    setTasks((prev) => {
      const toDelete = new Set(taskIds);
      const deletingTasks = prev.filter((task) => toDelete.has(task.id));

      if (deletingTasks.length === 0) return prev;

      taskIds.forEach((taskId) => {
        delete pendingResumeStartsRef.current[taskId];
        const owner = prev.find((task) => task.id === taskId);
        if (owner) {
          invoke("delete_task_screen", { projectId: owner.projectId, taskId }).catch(() => {});
        }
      });

      deletingTasks
        .filter((task) => isActiveTaskStatus(task.status))
        .forEach((task) => {
          const proj = projects.find((p) => p.id === task.projectId);
          const projectPath = task.worktreePath ?? proj?.path ?? "";
          invoke("cancel_task", { taskId: task.id, projectPath })
            .catch((e: unknown) => {
              showToast(t("toast.cancelTaskFailed", { error: String(e) }));
            })
            .finally(() => {
              if (proj) cleanupTaskWorktree(task, proj.path);
            });
        });

      deletingTasks
        .filter((task) => !isActiveTaskStatus(task.status))
        .forEach((task) => {
          const proj = projects.find((p) => p.id === task.projectId);
          if (proj) cleanupTaskWorktree(task, proj.path);
        });

      const next = prev.filter((task) => !toDelete.has(task.id));
      const affectedProjectIds = new Set(deletingTasks.map((t) => t.projectId));
      affectedProjectIds.forEach((pid) =>
        persistProjectTasks(pid, next, showToast, formatSaveTasksError),
      );
      return next;
    });

    tm.removeTaskBuffers(taskIds);
    setProjectViews((prev) => {
      const toDelete = new Set(taskIds);
      let changed = false;
      const next = { ...prev };

      for (const [projectId, view] of Object.entries(prev)) {
        if (view.selectedTaskId && toDelete.has(view.selectedTaskId)) {
          next[projectId] = { ...view, selectedTaskId: null, isNewTask: true };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }

  async function handleDeleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const promptPreview = `${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}`;
    const ok = await confirm(t("task.deletePrompt", { prompt: promptPreview }), {
      title: t("task.deleteTitle"),
      kind: "warning",
    });
    if (!ok) return;
    deleteTasks([taskId]);
  }

  function handleToggleTaskStar(taskId: string) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      const next = prev.map((t) => (t.id === taskId ? { ...t, starred: !t.starred } : t));
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  function handleRenameTask(taskId: string, name: string) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      const next = prev.map((t) => (t.id === taskId ? { ...t, name: name || undefined } : t));
      persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      return next;
    });
  }

  async function handleGenerateTaskName(taskId: string, opts?: { auto?: boolean }) {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;
    // auto：创建时没填名字、由任务状态自动触发的后台起名。不弹失败 toast，也不校验
    // status —— 等第一轮说完时用户很可能已经接着聊下一轮了，status 变了不该丢掉这次命名。
    const auto = opts?.auto === true;
    // 按 agent 选择对应字段，避免历史数据两个字段都有时取错
    const sessionPath =
      task.agent === "codex" ? (task.codexSessionPath ?? null) : (task.claudeSessionPath ?? null);
    // 点击瞬间的快照，用于 await 完成后的并发校验（防止用户期间 rerun/resume/手改名）
    const expectedPriorName = task.name ?? "";
    const expectedPrompt = task.prompt;
    const expectedStatus = task.status;
    const expectedSessionPath = sessionPath;
    try {
      const name = await invoke<string>("generate_task_name", {
        projectPath: project.path,
        agent: task.agent,
        sessionPath,
        originalPrompt: task.prompt,
      });
      const trimmed = name.trim();
      if (!trimmed) return;

      // await 期间用户可能删除任务、改名、重跑、resume 进新 session → 在同一个
      // setTasks updater 内完成校验和写入，避免依赖 React 对 updater 的同步调度。
      setTasks((prev) => {
        const current = prev.find((x) => x.id === taskId);
        if (!current) return prev;
        if ((current.name ?? "") !== expectedPriorName) return prev;
        if (current.prompt !== expectedPrompt) return prev;
        if (!auto && current.status !== expectedStatus) return prev;
        const currentSessionPath =
          current.agent === "codex"
            ? (current.codexSessionPath ?? null)
            : (current.claudeSessionPath ?? null);
        if (currentSessionPath !== expectedSessionPath) return prev;

        const next = prev.map((x) => (x.id === taskId ? { ...x, name: trimmed || undefined } : x));
        persistProjectTasks(current.projectId, next, showToast, formatSaveTasksError);
        return next;
      });
    } catch (e) {
      if (!auto) showToast(t("task.generateNameFailed", { error: String(e) }), "error");
      throw e;
    }
  }

  async function handleDeleteProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const ok = await confirm(t("task.deleteProjectPrompt", { project: project.name }), {
      title: t("task.deleteProjectTitle"),
      kind: "warning",
    });
    if (!ok) return;
    // 只把项目从列表里摘掉，会话记录一律保留：磁盘上的 tasks.json 不动，重新添加
    // 同一目录时会按 path 找回（find_project_id_by_path）。但正在跑的任务必须真杀掉
    // 进程，否则会变成没有界面的后台 agent；状态落成 interrupted，记录仍可续跑。
    const projectTasks = tasks.filter((t) => t.projectId === projectId);
    projectTasks
      .filter((t) => isActiveTaskStatus(t.status))
      .forEach((t) => {
        invoke("cancel_task", {
          taskId: t.id,
          projectPath: t.worktreePath ?? project.path,
        }).catch(() => {});
      });
    if (projectTasks.length > 0) {
      const interruptedAt = Date.now();
      setTasks((prev) => {
        const next = prev.map((t) =>
          t.projectId === projectId && isActiveTaskStatus(t.status)
            ? { ...t, status: "interrupted" as TaskStatus, updatedAt: interruptedAt }
            : t,
        );
        persistProjectTasks(projectId, next, showToast, formatSaveTasksError);
        return next;
      });
      tm.removeTaskBuffers(projectTasks.map((t) => t.id));
    }
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== projectId);
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
    setMountedProjectIds((prev) => prev.filter((id) => id !== projectId));
    clearProjectView(projectId);
    // 没有首页了：删掉的是当前项目就回退到下一个，否则会落进空态。
    setActiveProject((prev) => {
      if (prev?.id !== projectId) return prev;
      const remaining = projects
        .filter((p) => p.id !== projectId)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      const next = remaining[0] ?? null;
      if (next) mountProject(next.id);
      return next;
    });
  }

  async function handleRenameProject(
    projectId: string,
    rawName: string,
  ): Promise<ProjectRenameResult> {
    const normalizedName = normalizeProjectNameInput(rawName);
    const current = projects.find((project) => project.id === projectId);
    if (current?.name === normalizedName) return { ok: true, name: current.name };

    const result = validateProjectName(rawName, projects, projectId);
    if (!result.ok) return result;

    const next = projects.map((project) =>
      project.id === projectId ? { ...project, name: result.name } : project,
    );
    const saved = await persistProjects(next, showToast, formatSaveProjectsError);
    if (!saved) return { ok: false, error: "save_failed" };

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, name: result.name } : project,
      ),
    );

    return result;
  }

  // 头像外观(颜色 / emoji / 缩写)整体替换;归一化后为空则删掉字段,保持 projects.json 简洁。

  // 用户没填任务名（名字还是 `claude-xxx` 这种占位符）时自动起名。触发时机：等 agent 第一轮
  // 说完（awaiting_review / input_required / done）—— 这之前会话里没有内容可总结。三条克制：
  // - 启动时已存在的老任务不补，免得一开 app 就并发起一堆命名请求；只有本次运行期间新建的
  //   （或刚建没多久就落在已完成态的）才处理，靠 createdAt 判断；
  // - 每个任务只试一次，失败就算了，名字保持占位符，用户随时能自己改；
  // - 纯终端不起名。
  const nameGenSeenRef = useRef<Set<string>>(new Set());
  const nameGenRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const NAMABLE = new Set(["awaiting_review", "input_required", "done"]);
    for (const task of tasks) {
      if (!nameGenSeenRef.current.has(task.id)) {
        nameGenSeenRef.current.add(task.id);
        if (Date.now() - (task.createdAt ?? 0) > 10 * 60_000) continue; // 老任务不补
      }
      if (nameGenRequestedRef.current.has(task.id)) continue;
      if (task.agent === "shell") continue;
      if (!/^(?:claude|codex)-\d+$/.test(task.name ?? "")) continue; // 用户填过名字
      if (!NAMABLE.has(task.status)) continue;
      nameGenRequestedRef.current.add(task.id);
      void handleGenerateTaskName(task.id, { auto: true }).catch(() => {});
    }
  }, [tasks]);

  function handleUpdateProjectAvatar(projectId: string, avatar: ProjectAvatarStyle | undefined) {
    const normalized = normalizeProjectAvatar(avatar);
    setProjects((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projectId) return p;
        const { avatar: _previous, ...rest } = p;
        return normalized ? { ...rest, avatar: normalized } : rest;
      });
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
  }

  function handleToggleProjectHidden(projectId: string) {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === projectId ? { ...p, hiddenFromRail: !p.hiddenFromRail } : p,
      );
      persistProjects(next, showToast, formatSaveProjectsError);
      return next;
    });
  }

  // 拖拽结束时一次性提交新顺序;beforeId === null 表示拖到 visible 末尾。
  // visibleIds 来自抽屉内按搜索词过滤后的顺序（含 hiddenFromRail 的项目），
  // src/dst 必须在这个子集里算,否则会无声打乱隐藏项的相对位置。
  // 拖拽期间抽屉内部只用 transform 让位,不会调到这里,避免高频重渲染和写盘。
  const handleCommitProjectOrder = useCallback(
    (draggedId: string, beforeId: string | null, visibleIds: string[]) => {
      setProjects((prev) => {
        const next = reorderProjects(prev, visibleIds, draggedId, beforeId);
        if (next === prev) return prev;
        persistProjects(next, showToast, formatSaveProjectsError);
        return next;
      });
    },
    [showToast, formatSaveProjectsError],
  );

  function updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    extra?: Pick<Task, "attentionRequestedAt">,
    failureReason?: string,
  ) {
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        if (task.id !== taskId) return task;

        const attentionRequestedAt =
          status === "input_required" || status === "awaiting_review"
            ? (extra?.attentionRequestedAt ?? Date.now())
            : undefined;

        if (task.status === status && task.attentionRequestedAt === attentionRequestedAt) {
          return task;
        }

        changed = true;
        const updated: Task = { ...task, status, attentionRequestedAt, updatedAt: Date.now() };
        if (status === "failed" && failureReason) updated.failureReason = failureReason;
        return updated;
      });

      if (changed) {
        const task = next.find((t) => t.id === taskId);
        if (task) persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      }
      return changed ? next : prev;
    });
  }

  function updateTaskSession(taskId: string, sessionId: string, sessionPath: string) {
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        if (task.id !== taskId) return task;
        if (task.agent === "claude") {
          if (task.claudeSessionId === sessionId && task.claudeSessionPath === sessionPath)
            return task;
          changed = true;
          return { ...task, claudeSessionId: sessionId, claudeSessionPath: sessionPath };
        } else {
          if (task.codexSessionId === sessionId && task.codexSessionPath === sessionPath)
            return task;
          changed = true;
          return { ...task, codexSessionId: sessionId, codexSessionPath: sessionPath };
        }
      });

      if (changed) {
        const task = next.find((t) => t.id === taskId);
        if (task) persistProjectTasks(task.projectId, next, showToast, formatSaveTasksError);
      }
      return changed ? next : prev;
    });
  }

  function handleTerminalReady(taskId: string, generation: number) {
    tm.handleTerminalReady(taskId, generation);
    const startResume = pendingResumeStartsRef.current[taskId];
    if (!startResume) return;
    delete pendingResumeStartsRef.current[taskId];
    startResume();
  }

  // rail 顺序直接由 projects 数组承载;拖拽通过 handleCommitProjectOrder 改变这个数组。
  // 老版本在这里 sort 是为了给 backend 写入的"任意"顺序提供一个稳定视觉,
  // 现在改由 init 时一次性迁移 + 用户拖拽决定。
  const railProjects = projects;
  const mountedProjects = useMemo(
    () =>
      mountedProjectIds
        .map((id) => projects.find((project) => project.id === id))
        .filter((project): project is Project => !!project),
    [mountedProjectIds, projects],
  );

  // 头像外观(缩写 / 颜色去重)按全量 projects 解析一次,供各处 ProjectAvatar 读取。
  const appTree = (
    <div style={s.rootRelative}>
      <div style={s.appProjectLayer}>
        {mountedProjects.map((project) => {
          const view = getProjectView(project.id);
          return (
            <ProjectPage
              key={project.id}
              project={project}
              visible={activeProject?.id === project.id}
              allProjects={railProjects}
              tasks={tasks}
              getTaskRestoreState={tm.getTaskRestoreState}
              taskRunCounts={taskRunCounts}
              selectedTaskId={view.selectedTaskId}
              isNewTask={view.isNewTask}
              localSession={view.localSession}
              onSelectLocalSession={(session) => handleSelectLocalSession(project, session)}
              onResumeLocalSession={(session) => handleResumeLocalSession(project, session)}
              onSelectTask={(id) =>
                updateProjectView(project.id, {
                  selectedTaskId: id,
                  isNewTask: false,
                  localSession: null,
                })
              }
              onDeleteTask={handleDeleteTask}
              onToggleTaskStar={handleToggleTaskStar}
              onRenameTask={handleRenameTask}
              onSubmitTask={(taskInput) => handleSubmitTask(project, taskInput)}
              onResumeTask={handleResumeTask}
              onForkTask={handleForkTask}
              onMergeWorktree={handleMergeWorktree}
              onDiscardWorktree={handleDiscardWorktree}
              onReconnectTask={handleReconnectTask}
              onMarkTaskRead={markTaskRead}
              attentionSeen={attentionSeen}
              presets={presets}
              onHandoffTask={handleHandoff}
              onRestartTask={handleRestartTask}
              quickInputs={quickInputs}
              quickAutoEnter={quickAutoEnter}
              onQuickAutoEnterChange={setQuickAutoEnter}
              onSaveQuickInput={handleSaveQuickInput}
              onDeleteQuickInput={handleDeleteQuickInput}
              onRunPreset={(preset, repoPath) => handleRunPreset(project, preset, repoPath)}
              onAddPreset={() => setPresetDialog({ mode: "add" })}
              onEditPresets={(presetId) => setPresetDialog({ mode: "edit", focusId: presetId })}
              onInput={tm.handleInput}
              onResize={tm.handleResize}
              onRegisterTerminal={tm.handleRegisterTerminal}
              onTerminalReady={handleTerminalReady}
              onSnapshot={tm.handleSnapshot}
              onSwitchProject={handleProjectClick}
              onCommitProjectOrder={handleCommitProjectOrder}
              onOpen={handleOpen}
              onToggleProjectHidden={handleToggleProjectHidden}
              onUpdateProjectAvatar={handleUpdateProjectAvatar}
              onDeleteProject={handleDeleteProject}
              onRenameProject={handleRenameProject}
              themeVariant={themeVariant}
              onToggleTheme={handleToggleTheme}
              terminalFontSize={terminalFontSize}
              onTerminalFontSizeChange={setTerminalFontSize}
              taskDisplayWindow={taskDisplayWindow}
              onTaskDisplayWindowChange={setTaskDisplayWindow}
              attentionBadge={attentionBadge}
              onAttentionBadgeChange={setAttentionBadge}
              terminalScrollback={terminalScrollback}
              onTerminalScrollbackChange={handleTerminalScrollbackChange}
              uiFontFamily={uiFontFamily}
              onUiFontFamilyChange={setUiFontFamily}
              monoFontFamily={monoFontFamily}
              onMonoFontFamilyChange={setMonoFontFamily}
            />

          );
        })}
      </div>
      <TaskPresetAddDialog
        open={presetDialog?.mode === "add"}
        onOpenChange={(open) => setPresetDialog(open ? { mode: "add" } : null)}
        onSave={handleSavePreset}
      />
      <TaskPresetEditDialog
        open={presetDialog?.mode === "edit"}
        presets={presets}
        focusPresetId={presetDialog?.mode === "edit" ? presetDialog.focusId : undefined}
        onOpenChange={(open) => setPresetDialog(open ? { mode: "edit" } : null)}
        onSave={handleSavePreset}
        onDelete={handleDeletePreset}
      />

      {!activeProject && projects.length === 0 && (
        <div style={s.appEmptyShell}>
          <ProjectDrawer
            projects={[]}
            allTasks={[]}
            attentionSeen={attentionSeen}
            activeProjectId=""
            onSwitch={noop}
            onCommitProjectOrder={noop}
            onOpen={handleOpen}
            onToggleProjectHidden={noop}
            onUpdateProjectAvatar={noop}
            onDelete={noop}
            onRenameProject={async () => ({ ok: false, error: "save_failed" })}
            themeVariant={themeVariant}
            onToggleTheme={handleToggleTheme}
            terminalFontSize={terminalFontSize}
            onTerminalFontSizeChange={setTerminalFontSize}
            taskDisplayWindow={taskDisplayWindow}
            onTaskDisplayWindowChange={setTaskDisplayWindow}
            attentionBadge={attentionBadge}
            onAttentionBadgeChange={setAttentionBadge}
            terminalScrollback={terminalScrollback}
            onTerminalScrollbackChange={handleTerminalScrollbackChange}
            uiFontFamily={uiFontFamily}
            onUiFontFamilyChange={setUiFontFamily}
            monoFontFamily={monoFontFamily}
            onMonoFontFamilyChange={setMonoFontFamily}
          />
        </div>
      )}
    </div>
  );
  return <ProjectAppearanceProvider projects={projects}>{appTree}</ProjectAppearanceProvider>;
}

export default App;
