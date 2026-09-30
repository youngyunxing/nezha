/**
 * 快捷输入：一段预设文本，点一下就填进当前会话的输入框。
 *
 * 必须区分类型：给 agent 的是**提示词**（可以是一句话、一段要求），给终端的是**终端命令**。
 * 不区分的话，一条提示词在终端里会被当成命令执行 —— 所以要按当前会话类型只显示对应的那些。
 */
export type QuickInputKind = "prompt" | "command";

/** 适用范围：默认所有项目通用，也可以只属于某个项目。 */
export type QuickInputScope = "all" | "project";

export interface QuickInput {
  id: string;
  /** 弹层里显示的短名 */
  label: string;
  /** 实际填进去的文本 */
  text: string;
  /** prompt = 给 agent 的提示词；command = 给终端的命令 */
  kind: QuickInputKind;
  /** 默认 all；project 时配合 projectId 只在那个项目里出现 */
  scope: QuickInputScope;
  projectId?: string;
}

const STORAGE_KEY = "nezha:quick-inputs";

/** 首次使用时给两条，免得功能看着是空的。 */
export const DEFAULT_QUICK_INPUTS: QuickInput[] = [
  { id: "qi-continue", label: "继续", text: "继续", kind: "prompt", scope: "all" },
  {
    id: "qi-summary",
    label: "总结进度",
    text: "把当前进度总结一下：已经做完什么、还剩什么、下一步建议做什么",
    kind: "prompt",
    scope: "all",
  },
  { id: "qi-status", label: "git status", text: "git status", kind: "command", scope: "all" },
];

function sanitize(raw: unknown): QuickInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const text = typeof o.text === "string" ? o.text : "";
  if (!id || !text.trim()) return null;
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : text.trim();
  // 老数据没有 kind：按"给 agent 的提示词"处理（更保守，不会在终端里被执行）
  const kind: QuickInputKind = o.kind === "command" ? "command" : "prompt";
  const projectId = typeof o.projectId === "string" && o.projectId ? o.projectId : undefined;
  // 只有明确写了 scope=project 且带着 projectId 才算项目专属，其余一律通用
  const scope: QuickInputScope = o.scope === "project" && projectId ? "project" : "all";
  return { id, label, text, kind, scope, projectId: scope === "project" ? projectId : undefined };
}

export function loadQuickInputs(): QuickInput[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_INPUTS.map((q) => ({ ...q }));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_QUICK_INPUTS.map((q) => ({ ...q }));
    const list = parsed.map(sanitize).filter((q): q is QuickInput => q !== null);
    // 本来有条目却一条都没解析出来 = 存坏了，回默认；真的删空（[]）就保持空
    if (parsed.length > 0 && list.length === 0) return DEFAULT_QUICK_INPUTS.map((q) => ({ ...q }));
    return list;
  } catch {
    return DEFAULT_QUICK_INPUTS.map((q) => ({ ...q }));
  }
}

export function saveQuickInputs(list: QuickInput[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage 不可用时这次改动不落盘
  }
}

export function makeQuickInputId(): string {
  return `qi-${Date.now()}`;
}

/** 「自动回车」：开启后点一条快捷输入 = 输入并直接发送（相当于替你按了回车）。 */
const AUTO_ENTER_KEY = "nezha:quick-input-auto-enter";

export function loadQuickAutoEnter(): boolean {
  try {
    return localStorage.getItem(AUTO_ENTER_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveQuickAutoEnter(value: boolean): void {
  try {
    localStorage.setItem(AUTO_ENTER_KEY, value ? "1" : "0");
  } catch {
    // 落盘失败就用当前会话内的值
  }
}

/**
 * 筛出当前会话该显示的快捷输入，两个条件都要满足：
 * - 类型对得上（终端只给命令，agent 只给提示词）；
 * - 范围对得上（通用的一律显示；项目专属的只在它那个项目里显示）。
 */
export function quickInputsForSession(
  list: QuickInput[],
  kind: QuickInputKind,
  projectId: string | undefined,
): QuickInput[] {
  return list.filter(
    (item) =>
      item.kind === kind && (item.scope === "all" || (!!projectId && item.projectId === projectId)),
  );
}

/** 流转时「最近 N 条」的 N：记用户上次填的，默认 5。 */
const HANDOFF_COUNT_KEY = "nezha:handoff-context-count";
export const DEFAULT_HANDOFF_COUNT = 5;

export function loadHandoffCount(): string {
  try {
    const raw = localStorage.getItem(HANDOFF_COUNT_KEY);
    return raw && /^\d+$/.test(raw) ? raw : String(DEFAULT_HANDOFF_COUNT);
  } catch {
    return String(DEFAULT_HANDOFF_COUNT);
  }
}

export function saveHandoffCount(value: string): void {
  try {
    if (/^\d+$/.test(value)) localStorage.setItem(HANDOFF_COUNT_KEY, value);
  } catch {
    // 落盘失败就用内存里的值
  }
}
