import { describe, expect, it } from "vitest";
import {
  AGENT_TERMINAL_SCROLLBACK_FLOOR,
  DEFAULT_TERMINAL_SCROLLBACK,
  TERMINAL_SCROLLBACK_MAX,
  effectiveTerminalScrollback,
} from "../types";

describe("effectiveTerminalScrollback", () => {
  it("agent 任务有下限：用户的 1000 行装不下长会话", () => {
    expect(effectiveTerminalScrollback("claude", DEFAULT_TERMINAL_SCROLLBACK)).toBe(
      AGENT_TERMINAL_SCROLLBACK_FLOOR,
    );
    expect(effectiveTerminalScrollback("codex", 500)).toBe(AGENT_TERMINAL_SCROLLBACK_FLOOR);
    // 下限当前是 1000（试验性关闭）→ 用户调得更大时听用户的
    expect(effectiveTerminalScrollback("kimi", TERMINAL_SCROLLBACK_MAX)).toBe(
      TERMINAL_SCROLLBACK_MAX,
    );
  });

  it("用户调得比下限还大就听用户的", () => {
    expect(effectiveTerminalScrollback("claude", 50_000)).toBe(50_000);
  });

  it("纯终端任务照旧听用户的 —— 长驻 shell 的回滚大没有收益", () => {
    expect(effectiveTerminalScrollback("shell", DEFAULT_TERMINAL_SCROLLBACK)).toBe(
      DEFAULT_TERMINAL_SCROLLBACK,
    );
    expect(effectiveTerminalScrollback("shell", 500)).toBe(500);
  });
});
