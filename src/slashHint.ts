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
 * TUI 输入框行首那点装饰：`│ > /hel` 里的竖线和提示符。
 * ─-╿ 是制表符区，Claude Code 的输入框边框全落在这一段。
 * 只削行首，不碰正文。
 */
const LEADING_DECOR = /^[\s─-╿|>]+/;

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
