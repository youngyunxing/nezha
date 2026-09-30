import { PROJECT_AVATAR_COLORS, hashString, isProjectAvatarColor } from "./projectAvatar";
import type { ProjectAvatarColor } from "./types";

// ── 标签键 ───────────────────────────────────────────────────────────────────

/** 主区域标签的标识：会话 / 某个文件 / 当前打开的 diff。
 *  colorKey 与它分开：会话标签的 key 是常量，颜色却按「当前是哪个任务」记。 */
export type MainTabKey = "session" | "diff" | `file:${string}`;

export function fileTabKey(path: string): MainTabKey {
  return `file:${path}`;
}

/** 会话标签的配色键：按任务记，同一个任务永远是同一个色。 */
export function taskTabColorKey(taskId: string): string {
  return `task:${taskId}`;
}

/** 本地 Claude Code 会话（不是 Nezha 任务）的配色键。 */
export function localSessionTabColorKey(sessionId: string): string {
  return `local:${sessionId}`;
}

// ── 配色 ─────────────────────────────────────────────────────────────────────

const PALETTE_SIZE = PROJECT_AVATAR_COLORS.length;
/** 撞色时的探测步长：与 16 互质，且每跳约 157° 色相，保证备选色彼此差异最大
 *  （线性 +1 会落到色环上最相近的邻色，等于没避开）。与 projectAvatar.ts 同源。 */
const PROBE_STRIDE = 7;

/**
 * 解析一组标签的颜色。用户手动指定过的先全部占位，其余按 key 的 hash 落点、
 * 避开已占用的槽位 —— 保证同屏标签颜色互不相同（超出色板数量才复用）。
 */
export function resolveTabColors(
  keys: readonly string[],
  overrides: Readonly<Record<string, ProjectAvatarColor>>,
): Record<string, ProjectAvatarColor> {
  const usage = new Array<number>(PALETTE_SIZE).fill(0);
  for (const key of keys) {
    const custom = overrides[key];
    if (isProjectAvatarColor(custom)) usage[PROJECT_AVATAR_COLORS.indexOf(custom)] += 1;
  }

  const resolved: Record<string, ProjectAvatarColor> = {};
  for (const key of keys) {
    const custom = overrides[key];
    if (isProjectAvatarColor(custom)) {
      resolved[key] = custom;
      continue;
    }
    const preferred = hashString(key) % PALETTE_SIZE;
    const minUsage = Math.min(...usage);
    let slot = preferred;
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const candidate = (preferred + i * PROBE_STRIDE) % PALETTE_SIZE;
      if (usage[candidate] === minUsage) {
        slot = candidate;
        break;
      }
    }
    usage[slot] += 1;
    resolved[key] = PROJECT_AVATAR_COLORS[slot];
  }
  return resolved;
}

// ── 持久化（只存用户手挑的那些，自动配色按 key 重算） ────────────────────────

const STORAGE_KEY = "nezha:tab-colors";

export function loadTabColorOverrides(): Record<string, ProjectAvatarColor> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ProjectAvatarColor> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isProjectAvatarColor(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTabColorOverrides(map: Record<string, ProjectAvatarColor>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存不下就算了：颜色是显示偏好，不该因为写盘失败打断使用
  }
}

export { PROJECT_AVATAR_COLORS };
