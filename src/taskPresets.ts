import type { AgentType } from "./types";

/** 快捷创建按钮：点一下按这套参数直接建任务，省掉每次都填弹窗。 */
export interface TaskPreset {
  id: string;
  /** 按钮上显示的名字 */
  name: string;
  agent: AgentType;
  /** 仅纯终端用：建出来的会话里执行这条命令；留空 = 普通交互式终端 */
  command?: string;
  /** 是否用 git worktree 开独立副本（基于项目当前分支） */
  useWorktree: boolean;
}

const STORAGE_KEY = "nezha:task-presets";

/** 首次使用时预置的两个按钮。 */
export const DEFAULT_TASK_PRESETS: TaskPreset[] = [
  { id: "preset-claude", name: "Claude Code", agent: "claude", useWorktree: false },
  { id: "preset-terminal", name: "创建终端", agent: "shell", useWorktree: false },
];

const AGENTS: AgentType[] = ["claude", "codex", "shell"];

function sanitize(raw: unknown): TaskPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const agent = AGENTS.includes(o.agent as AgentType) ? (o.agent as AgentType) : null;
  if (!id || !name || !agent) return null;
  const command = typeof o.command === "string" && o.command.trim() ? o.command.trim() : undefined;
  return { id, name, agent, command, useWorktree: o.useWorktree === true };
}

/** 读快捷按钮；没存过（或存坏了）就用两个默认的。 */
export function loadTaskPresets(): TaskPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TASK_PRESETS.map((p) => ({ ...p }));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TASK_PRESETS.map((p) => ({ ...p }));
    const list = parsed.map(sanitize).filter((p): p is TaskPreset => p !== null);
    // 本来就有条目却一条都没解析出来 → 存坏了，回到默认；真的删空（存的是 []）就保持空
    if (parsed.length > 0 && list.length === 0) return DEFAULT_TASK_PRESETS.map((p) => ({ ...p }));
    return list;
  } catch {
    return DEFAULT_TASK_PRESETS.map((p) => ({ ...p }));
  }
}

export function saveTaskPresets(list: TaskPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage 不可用时这次改动不落盘，不打断用户
  }
}

export function makePresetId(): string {
  return `preset-${Date.now()}`;
}

/** 按钮上的悬停说明：这套参数会建出什么。 */
export function presetSummary(preset: TaskPreset, labels: { claude: string; codex: string; shell: string; worktree: string }): string {
  const parts = [labels[preset.agent]];
  if (preset.agent === "shell" && preset.command) parts.push(preset.command);
  if (preset.useWorktree) parts.push(labels.worktree);
  return parts.join(" · ");
}
