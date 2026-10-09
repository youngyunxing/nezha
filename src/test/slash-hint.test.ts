import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { CLAUDE_SLASH_COMMANDS, slashCommandsFor, type SlashCommand } from "../slashCommands";
import {
  MAX_SLASH_SUGGESTIONS,
  detectSlashHint,
  matchSlashHint,
  readLineBeforeCursor,
  slashHintKey,
} from "../slashHint";

/** 拿真实表来测 —— 判据是「表里有什么」，用假表测不出误报 */
const claude = CLAUDE_SLASH_COMMANDS;

describe("matchSlashHint", () => {
  it("认出 Claude Code 真实的输入行（❯ + 不换行空格）", () => {
    // 这行的形状是从 app 存的终端快照里扒出来的真东西，别改
    const m = matchSlashHint("\u276f\u00a0/comp", claude);
    expect(m?.token).toBe("/comp");
    expect(m?.exact).toBeNull();
    expect(m?.suggestions.map((c) => c.name)).toContain("compact");
  });

  it("输入框被换了一套装饰也认得出（老版本 / 别的 TUI）", () => {
    for (const line of ["│ > /comp", "> /comp", "❯ /comp", "  /comp", "› /comp"]) {
      expect(matchSlashHint(line, claude)?.token, line).toBe("/comp");
    }
  });

  it("认出 Claude Code 输入框里的命令（带边框和提示符）", () => {
    const m = matchSlashHint("│ > /comp", claude);
    expect(m?.token).toBe("/comp");
    expect(m?.exact).toBeNull();
    expect(m?.suggestions.map((c) => c.name)).toContain("compact");
  });

  it("命令名敲全了就切成「用法 + 说明」", () => {
    const m = matchSlashHint("│ > /compact", claude);
    expect(m?.exact?.name).toBe("compact");
    expect(m?.exact?.usage).toBe("<可选的摘要指令>");
    expect(m?.suggestions).toEqual([]);
  });

  it("接着敲参数时提示不消失（还要看用法）", () => {
    const m = matchSlashHint("│ > /compact 我自己的摘要要求", claude);
    expect(m?.exact?.name).toBe("compact");
    expect(m?.token).toBe("/compact");
  });

  it("别名按本名解析", () => {
    expect(matchSlashHint("/quit", claude)?.exact?.name).toBe("exit");
    expect(matchSlashHint("/new", claude)?.exact?.name).toBe("clear");
  });

  it("别名的前缀也算候选", () => {
    expect(matchSlashHint("/qui", claude)?.suggestions.map((c) => c.name)).toContain("exit");
  });

  it("斜杠后面还是空的就不显示", () => {
    expect(matchSlashHint("│ > /", claude)).toBeNull();
    expect(matchSlashHint("│ > / ", claude)).toBeNull();
  });

  it("不在行首的斜杠不算", () => {
    expect(matchSlashHint("│ > 看看 /help 说什么", claude)).toBeNull();
  });

  it("输出里的路径不会误报", () => {
    expect(matchSlashHint("/usr/local/bin/node", claude)).toBeNull();
    expect(matchSlashHint("│ > /tmp/a/b.log", claude)).toBeNull();
  });

  it("表里没有的命令名不显示", () => {
    expect(matchSlashHint("/zzznotacommand", claude)).toBeNull();
  });

  it("超长的垃圾不当命令", () => {
    expect(matchSlashHint(`/${"a".repeat(60)}`, claude)).toBeNull();
  });

  it("名字命中的排在别名命中的前面", () => {
    // `/c` 也会匹配 resume（别名 continue），但它不该挤掉 context
    const names = matchSlashHint("/c", claude)?.suggestions.map((c) => c.name) ?? [];
    expect(names).toEqual(["clear", "compact", "context", "copy"]);
  });

  it("只有别名命中时照样给出来", () => {
    const names = matchSlashHint("/conti", claude)?.suggestions.map((c) => c.name) ?? [];
    expect(names).toEqual(["resume"]);
  });

  it("候选数量封顶", () => {
    const m = matchSlashHint("/c", claude);
    expect(m?.suggestions.length).toBe(MAX_SLASH_SUGGESTIONS);
  });

  it("空表直接不显示", () => {
    expect(matchSlashHint("/help", [] as readonly SlashCommand[])).toBeNull();
  });
});

describe("slashHintKey", () => {
  it("内容一样就是同一个 key（避免每条输出都 setState）", () => {
    expect(slashHintKey(matchSlashHint("/help", claude))).toBe(
      slashHintKey(matchSlashHint("│ > /help", claude)),
    );
  });

  it("换了命令就换 key", () => {
    expect(slashHintKey(matchSlashHint("/help", claude))).not.toBe(
      slashHintKey(matchSlashHint("/clear", claude)),
    );
    expect(slashHintKey(matchSlashHint("/com", claude))).not.toBe(
      slashHintKey(matchSlashHint("/cop", claude)),
    );
  });

  it("没命中就是空 key", () => {
    expect(slashHintKey(null)).toBe("");
  });
});

describe("命令表", () => {
  it("claude 有表，其它 agent 暂时没有", () => {
    expect(slashCommandsFor("claude")).toBe(claude);
    expect(slashCommandsFor("codex")).toEqual([]);
    expect(slashCommandsFor("kimi")).toEqual([]);
    expect(slashCommandsFor("shell")).toEqual([]);
  });

  it("每条都有中文说明，命令名不重复", () => {
    const names = claude.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of claude) expect(c.zh.length).toBeGreaterThan(0);
  });

  it("常用命令排在前面，前缀候选优先给它们", () => {
    expect(claude[0].name).toBe("help");
    expect(matchSlashHint("/co", claude)?.suggestions[0].name).toBe("compact");
  });
});

describe("从真实 xterm buffer 里读光标行", () => {
  /** Claude Code 的输入框长这样：┌ 边框，里面一行 `> 输入内容` */
  const BOX = "╭────────────────╮\r\n│ > /comp\r\n╰────────────────╯";

  function makeTerm(cols = 40, rows = 8) {
    const term = new Terminal({ cols, rows, scrollback: 100 });
    const write = (data: string) => new Promise<void>((r) => term.write(data, r));
    return { term, write };
  }

  it("光标停在输入行中间时读到的是「光标之前的那段」", async () => {
    const { term, write } = makeTerm();
    // CUP 的列号从 1 起算：第 10 列 = 光标停在 `p` 后面（0 基 cursorX = 9）
    await write(`${BOX}\x1b[2;10H`);
    expect(readLineBeforeCursor(term)).toBe("│ > /comp");
    expect(detectSlashHint(term, claude)?.suggestions.map((c) => c.name)).toContain("compact");
  });

  it("光标跑到行尾空白处也只读到空白，不会误伤正文", async () => {
    const { term, write } = makeTerm();
    await write(`${BOX}\x1b[2;17H`);
    expect(readLineBeforeCursor(term)).toBe(`│ > /comp${" ".repeat(7)}`);
    // 光标之后的内容不算数，所以还是认得出 /comp
    expect(detectSlashHint(term, claude)?.exact).toBeNull();
  });

  it("真实输入行的形状（分隔线 + ❯）也认得出", async () => {
    const { term, write } = makeTerm(40, 8);
    // 不写行尾回车：光标自然停在 `/co` 后面，不用去猜提示符占几列
    await write("─".repeat(30) + "\r\n\u276f\u00a0/co");
    expect(readLineBeforeCursor(term)).toBe("\u276f\u00a0/co");
    expect(detectSlashHint(term, claude)?.suggestions.map((c) => c.name)).toContain("compact");
  });

  it("画面滚上去以后光标行照样读得对（baseY + cursorY）", async () => {
    const { term, write } = makeTerm(40, 8);
    await write("填充行\r\n".repeat(20));
    // 输入行是 buffer 里倒数第二行 → 滚上去以后落在视口第 7 行
    await write(`${BOX}\x1b[7;10H`);
    expect(term.buffer.active.baseY).toBeGreaterThan(0);
    expect(readLineBeforeCursor(term)).toBe("│ > /comp");
    expect(detectSlashHint(term, claude)?.suggestions.map((c) => c.name)).toContain("compact");
  });

  it("输入行被清空后提示就没了", async () => {
    const { term, write } = makeTerm();
    await write(`${BOX}\x1b[2;11H`);
    expect(detectSlashHint(term, claude)).not.toBeNull();
    await write("\x1b[2;5H\x1b[K"); // 回到行首、擦掉这一行
    expect(detectSlashHint(term, claude)).toBeNull();
  });
});
