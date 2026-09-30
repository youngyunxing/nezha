export interface Project {
  id: string;
  name: string;
  path: string;
  branch?: string;
  lastOpenedAt: number;
  /** 为 true 时不在左侧常驻竖条显示，仅可从首页或「展开全部」抽屉访问。缺省=常驻。 */
  hiddenFromRail?: boolean;
  /** 用户自定义的头像外观；缺省 / 各字段缺省时走自动缩写 + 自动配色。
   * 与 storage.rs 的 ProjectAvatar 同步，新增字段两边都要改。 */
  avatar?: ProjectAvatarStyle;
}

/** 项目头像的自定义项，三项全部可选、可组合。 */
export interface ProjectAvatarStyle {
  /** 预设色板 key；缺省自动分配 */
  color?: ProjectAvatarColor;
  /** 单个 emoji / 符号（一个 grapheme），有则替代缩写显示 */
  emoji?: string;
  /** 1–3 个字符的自定义缩写；缺省自动生成 */
  label?: string;
}

/** 项目头像预设色板 key。颜色值定义在 styles/project-rail.css（--avatar-<key>-from/to），
 * 顺序 / 自动分配逻辑在 projectAvatar.ts；存 key 而不存 hex，便于按主题微调。 */
export type ProjectAvatarColor =
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "wine"
  | "brown"
  | "slate";

/** 单个 git 工作目录。
 * - 单仓库项目：根目录自身即 git，roots = [{ path: project.path, name: ".", isRoot: true }]
 * - 多仓库工作区（如根目录非 git，但下面有多个子 git 目录）：roots = 每个子目录一项
 * - 完全不是 git：roots = []
 */
export interface GitRoot {
  path: string;
  name: string;
  isRoot: boolean;
}

/** "shell" = 纯终端会话（不起 agent，直接开登录 shell）。 */
export type AgentType = "claude" | "codex" | "kimi" | "shell";
export type ThemeMode = "system" | "dark" | "light" | "eyecare" | "midnight";
export type ThemeVariant = "dark" | "light" | "eyecare" | "midnight";
export type PermissionMode = "ask" | "auto_edit" | "full_access";
export type TaskDisplayWindow = 3 | 7 | 15 | 30 | "all";

export const TASK_DISPLAY_WINDOW_VALUES = [3, 7, 15, 30, "all"] as const;
export const DEFAULT_TASK_DISPLAY_WINDOW: TaskDisplayWindow = 3;

export function normalizeTaskDisplayWindow(value: unknown): TaskDisplayWindow {
  if (value === "all") return "all";
  const parsed = typeof value === "number" ? value : Number(value);
  return TASK_DISPLAY_WINDOW_VALUES.includes(parsed as TaskDisplayWindow)
    ? (parsed as TaskDisplayWindow)
    : DEFAULT_TASK_DISPLAY_WINDOW;
}

export type TerminalFontSize = number;

export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 20;
export const TERMINAL_FONT_SIZE_STEP = 1;
export const DEFAULT_TERMINAL_FONT_SIZE: TerminalFontSize = 12;

export function clampTerminalFontSize(value: number): TerminalFontSize {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_FONT_SIZE;
  const snapped = Math.round(value / TERMINAL_FONT_SIZE_STEP) * TERMINAL_FONT_SIZE_STEP;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, snapped));
}

export type TerminalScrollback = number;

export const TERMINAL_SCROLLBACK_MIN = 500;
export const TERMINAL_SCROLLBACK_MAX = 5000;
export const TERMINAL_SCROLLBACK_STEP = 500;
export const DEFAULT_TERMINAL_SCROLLBACK: TerminalScrollback = 1000;

export function clampTerminalScrollback(value: unknown): TerminalScrollback {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_TERMINAL_SCROLLBACK;
  const snapped = Math.round(num / TERMINAL_SCROLLBACK_STEP) * TERMINAL_SCROLLBACK_STEP;
  return Math.min(TERMINAL_SCROLLBACK_MAX, Math.max(TERMINAL_SCROLLBACK_MIN, snapped));
}

export type FontFamily = string;
export const DEFAULT_UI_FONT: FontFamily =
  '"SF Pro Display", "IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif';

const MONO_FONT_WINDOWS: FontFamily = "Consolas";
const MONO_FONT_WINDOWS_STACK: FontFamily =
  'Consolas, "Cascadia Mono", "JetBrains Mono", "Fira Code", monospace';
const MONO_FONT_MAC: FontFamily =
  '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, ui-monospace, monospace';
const MONO_FONT_LINUX: FontFamily =
  '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace';
const MONO_FONT_FALLBACK: FontFamily = '"JetBrains Mono", "Fira Code", ui-monospace, monospace';
const MONO_FONT_PR326_INITIAL_FALLBACK: FontFamily =
  '"JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, ui-monospace, monospace';

export function getDefaultMonoFont(): FontFamily {
  return MONO_FONT_MAC;
}

// 老版本 App.tsx 的 useEffect 无差别把当时的默认 mono 字体也写进 localStorage,
// 导致后续改默认对老用户失效。所有"曾经作为自动默认值出现过"的字符串都视为
// "用户未自定义",在 getInitialFontFamily 里清掉后回退到当前平台默认。
const LEGACY_AUTO_MONO_FONTS: ReadonlySet<string> = new Set([
  MONO_FONT_FALLBACK,
  MONO_FONT_WINDOWS,
  MONO_FONT_WINDOWS_STACK,
  MONO_FONT_MAC,
  MONO_FONT_LINUX,
  MONO_FONT_PR326_INITIAL_FALLBACK,
]);

export function isAutoDefaultMonoFont(value: string): boolean {
  return LEGACY_AUTO_MONO_FONTS.has(value.trim());
}

export type TaskStatus =
  | "pending"
  /** 进程起来了、会话就绪，但大模型没在干活（刚恢复、或刚答完在等你）。 */
  | "idle"
  | "running"
  | "input_required"
  | "awaiting_review"
  | "interrupted"
  | "done"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  agent: AgentType;
  permissionMode: PermissionMode;
  status: TaskStatus;
  createdAt: number;
  /** 任务状态最近一次变更的时间戳；左侧任务列表按此字段排序与分组。缺省时回落到 createdAt。 */
  updatedAt?: number;
  attentionRequestedAt?: number;
  starred?: boolean;
  failureReason?: string;
  codexSessionId?: string;
  codexSessionPath?: string;
  /** Kimi：没有预置 id 的入口，spawn 后按索引延迟绑定（见后端 spawn_kimi_session_watcher）*/
  kimiSessionId?: string;
  /** Kimi 的 wire.jsonl（会话目录里那份对话事件流）*/
  kimiSessionPath?: string;
  claudeSessionId?: string;
  claudeSessionPath?: string;
  /** 重启归一化时的判定：进程还活着=true（点重连即可），进程没了=false（需要恢复）。
   *  两者都是 interrupted 状态，只有按钮和文案不同。 */
  processAlive?: boolean;
  /** 纯终端任务：启动时要执行的命令（留空 = 交互式登录 shell）。来自快捷创建按钮。 */
  command?: string;
  /** fork 出来的任务记下源会话 id：fork 完没说过话时，源会话的 transcript 才是唯一能恢复的记录 */
  forkedFromSessionId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  /** worktree 所属的 sub-repo 路径（多仓库工作区中追踪 worktree 归属于哪个 git 根）。
   *  缺省视为与项目根相同，向后兼容旧 worktree。 */
  worktreeRepo?: string;
  /** worktree 已被合并或丢弃后置 true：保留分支/路径用于审计，但禁用 resume / 合并 / 丢弃 */
  worktreeDiscarded?: boolean;
  /** 任务完成时计算的相对 baseBranch merge-base 的累计新增行数（仅 worktree 任务） */
  additions?: number;
  /** 任务完成时计算的相对 baseBranch merge-base 的累计删除行数（仅 worktree 任务） */
  deletions?: number;
}

const PERM_LABELS: Record<PermissionMode, string> = {
  ask: "每次询问",
  auto_edit: "自动编辑",
  full_access: "完全访问",
};

export function permissionModeLabel(mode: PermissionMode, agent?: AgentType): string {
  if (agent === "codex" && mode === "auto_edit") {
    return "自动模式";
  }
  return PERM_LABELS[mode];
}

/** 本机 Claude Code 直接在该目录产生的会话（不属于 Nezha 的任何任务）。 */
export interface LocalClaudeSession {
  sessionId: string;
  sessionPath: string;
  /** 首条用户消息，列表里当识别文本用。 */
  preview: string;
  updatedAt: number;
  sizeBytes: number;
}

/** 不填名字时的占位名：按 agent 前缀 + 任务 id（claude-xxx / codex-xxx / terminal-xxx）。
 *  这个格式也是自动起名的判据（见 App 里 /^(?:claude|codex)-\d+$/），所以快捷按钮
 *  建出来的任务也能在跑完第一轮后自动拿到标题。 */
export function defaultTaskName(agent: AgentType, id: string): string {
  const prefix = agent === "claude" ? "claude" : agent === "codex" ? "codex" : agent === "kimi" ? "kimi" : "terminal";
  return `${prefix}-${id}`;
}

/** 任务的会话 id（按 agent 取对应字段；Claude / Codex / Kimi 各存一套）。 */
export function taskSessionId(task: Task): string | undefined {
  if (task.agent === "codex") return task.codexSessionId;
  if (task.agent === "kimi") return task.kimiSessionId;
  return task.claudeSessionId;
}

/** 任务的会话文件路径（同上）。 */
export function taskSessionPath(task: Task): string | undefined {
  if (task.agent === "codex") return task.codexSessionPath;
  if (task.agent === "kimi") return task.kimiSessionPath;
  return task.claudeSessionPath;
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return (
    status === "pending" ||
    status === "idle" ||
    status === "running" ||
    status === "input_required" ||
    status === "awaiting_review"
  );
}
