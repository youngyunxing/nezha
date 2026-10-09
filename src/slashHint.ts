import type { Terminal } from "@xterm/xterm";
import type { SlashCommand } from "./slashCommands";

/** 候选最多铺几条 —— 提示条只有一行，再多就只剩省略号了 */
export const MAX_SLASH_SUGGESTIONS = 4;

/** 命令名之外的余量：超过这个长度就当它不是命令（输出里的一串路径很容易长这样） */
const MAX_HEAD_CHARS = 40;

export interface SlashHintMatch {
  /** 用户已经敲出来的那段（含斜杠），提示条最左边原样重复一遍 */
  token: string;
  /** 命令名敲全了（或敲的是别名）—— 这时给「用法 + 说明」 */
  exact: SlashCommand | null;
  /** 还没敲全时的前缀候选，按表里的顺序 */
  suggestions: readonly SlashCommand[];
}

/**
 * 输入框行首那点装饰 —— 只削行首，不碰正文。
 *
 * 实测（拿 app 自己存的终端快照验的）：Claude Code 2.1.x 的输入行长这样
 * ```
 * ───────────────────────────  ← 分隔线，U+2500
 * ❯ /co                        ← 提示符是 U+276F + 一个不换行空格
 * ```
 * 所以 **`❯`（U+276F）必须在表里** —— 最早只写 `\u2500-\u257F` 和 `>` 的那版因此
 * 永远不触发。\u2500-\u257F 是制表符区（边框都落在这一段），`\s` 覆盖不换行
 * 空格 U+00A0。后面几个是别的 TUI / 老版本用过的提示符，一并吃掉。
 */
const LEADING_DECOR =
  /^[\s\u2500-\u257F|>\u276f\u203a\u00bb\u2023\u25b6\u279c]+/;

/**
 * 从「光标之前的那一行」认出正在敲的斜杠命令，认不出返回 null。
 *
 * 判据只有两条：行首（削掉装饰后）是斜杠，且这个名字是表里某个命令（或别名）的前缀。
 * 第二条是真正的护栏 —— 输出里的 `/usr/local/bin` 前缀不中任何命令，不会误报。
 */
export function matchSlashHint(
  lineBeforeCursor: string,
  commands: readonly SlashCommand[],
): SlashHintMatch | null {
  const text = lineBeforeCursor.replace(LEADING_DECOR, "");
  if (!text.startsWith("/")) return null;
  // 只取第一段：敲完命令名接着敲参数时，提示条要留着（还要看用法）
  const head = text.slice(1).split(/\s+/, 1)[0];
  if (!head || head.length > MAX_HEAD_CHARS) return null;

  const exact =
    commands.find((c) => c.name === head || (c.aliases ?? []).includes(head)) ?? null;
  if (exact) return { token: `/${head}`, exact, suggestions: [] };

  const suggestions = commands
    .filter(
      (c) =>
        c.name.startsWith(head) ||
        (c.aliases ?? []).some((alias) => alias.startsWith(head)),
    )
    // 名字命中的排前面：敲 `/c` 该看到 clear / compact / context，而不是被
    // `/continue`（resume 的别名）占掉一格。sort 是稳定的，同组内保持表里的顺序。
    .sort(
      (a, b) => Number(b.name.startsWith(head)) - Number(a.name.startsWith(head)),
    )
    .slice(0, MAX_SLASH_SUGGESTIONS);
  if (suggestions.length === 0) return null;

  return { token: `/${head}`, exact: null, suggestions };
}

/**
 * 光标所在行、光标之前的文本。
 * CLI 把输入框画在屏幕上，光标就是输入位置 —— 所以这一行就是「用户正在敲什么」。
 * baseY 是视口顶行在 buffer 里的行号，cursorY 相对视口，所以光标行是两者之和。
 */
export function readLineBeforeCursor(term: Terminal): string {
  const buf = term.buffer.active;
  const line = buf.getLine(buf.baseY + buf.cursorY);
  if (!line) return "";
  return line.translateToString(false, 0, buf.cursorX);
}

export function detectSlashHint(
  term: Terminal,
  commands: readonly SlashCommand[],
): SlashHintMatch | null {
  if (commands.length === 0) return null;
  return matchSlashHint(readLineBeforeCursor(term), commands);
}

/** 提示内容没变就别 setState —— 这个读盘是每帧都在跑的 */
export function slashHintKey(match: SlashHintMatch | null): string {
  if (!match) return "";
  const names = match.exact
    ? `=${match.exact.name}`
    : match.suggestions.map((c) => c.name).join(",");
  return `${match.token}|${names}`;
}

/** 量不出光标位置时退回的老位置：贴着容器左下角，和右下角那排按钮同一条线 */
export const SLASH_HINT_FALLBACK_BOTTOM = 4;
/** 光标贴顶时至少给提示条留这么多像素，别把它顶出容器 */
const HINT_MIN_TOP_GAP = 32;

/**
 * 提示条该浮多高 —— 目标是**贴着「光标那一行的上边缘」**，也就是正好压在
 * 光标所在行的上面一行。
 *
 * 传进来的全是像素（都相对于提示条所在的容器），返回的是 CSS `bottom`。
 * 抽成纯函数是为了能测：真要测量得读 DOM，jsdom 里量不出来（一律返回 0）。
 */
export function hintBottomOffset(input: {
  containerHeight: number;
  /** `.xterm-screen` 顶边相对容器顶边的偏移 */
  screenTop: number;
  screenHeight: number;
  rows: number;
  /** `buffer.active.cursorY`，本来就是视口相对的 */
  cursorRow: number;
}): number {
  const { containerHeight, screenTop, screenHeight, rows, cursorRow } = input;
  if (rows <= 0 || screenHeight <= 0 || containerHeight <= 0) {
    return SLASH_HINT_FALLBACK_BOTTOM;
  }
  const cellHeight = screenHeight / rows;
  const cursorTop = screenTop + cursorRow * cellHeight;
  const bottom = containerHeight - cursorTop;
  // 光标在很上面的时候别把提示条顶出去（正常不会发生：输入框总在底部）
  return Math.max(0, Math.min(bottom, containerHeight - HINT_MIN_TOP_GAP));
}
