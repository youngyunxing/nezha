/** 项目小标的「已读」时间戳（projectId → 上次看过的时间）。
 *
 *  小标（小圆点 / 数量角标 / 招手动画）表示「这个项目里有新的等待事件」：任务变成
 *  「等你确认 / 有新回复」或中断时，会盖上 attentionRequestedAt。只有当它晚于这个时间
 *  才亮标 —— 点开这个项目就把它标成已读，于是小标会消失；之后再来新的等待事件才会
 *  重新亮起并招手。任务列表里的「等你 / 待恢复」分组不受影响，那是状态不是未读标记。
 */
const STORAGE_KEY = "nezha:project-attention-seen";

export type AttentionSeenMap = Record<string, number>;

export function loadAttentionSeen(): AttentionSeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AttentionSeenMap = {};
    for (const [projectId, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === "number" && Number.isFinite(ts)) out[projectId] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAttentionSeen(map: AttentionSeenMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage 不可用就退化成「每次启动都重新亮标」，不值得打断用户
  }
}

/** 这个任务对这个项目来说算不算「尚未看过的等待」。 */
export function isUnreadAttention(task: { projectId: string; attentionRequestedAt?: number; updatedAt?: number; createdAt: number }, seen: AttentionSeenMap): boolean {
  const at = task.attentionRequestedAt ?? task.updatedAt ?? task.createdAt;
  return at > (seen[task.projectId] ?? 0);
}
