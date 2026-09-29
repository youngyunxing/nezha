/** 快捷输入：一段预设文本，点一下就填进当前会话的输入框（不自动回车，由你确认后再发）。 */
export interface QuickInput {
  id: string;
  /** 弹层里显示的短名 */
  label: string;
  /** 实际填进去的文本 */
  text: string;
}

const STORAGE_KEY = "nezha:quick-inputs";

/** 首次使用时给两条，免得功能看着是空的。 */
export const DEFAULT_QUICK_INPUTS: QuickInput[] = [
  { id: "qi-continue", label: "继续", text: "继续" },
  {
    id: "qi-summary",
    label: "总结进度",
    text: "把当前进度总结一下：已经做完什么、还剩什么、下一步建议做什么",
  },
];

function sanitize(raw: unknown): QuickInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const text = typeof o.text === "string" ? o.text : "";
  if (!id || !text.trim()) return null;
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : text.trim();
  return { id, label, text };
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
