import { describe, expect, it } from "vitest";
import { agentLabel, canForkAgent } from "../types";

describe("agentLabel", () => {
  it("每个 agent 都有名字，流转提示词里不能把 kimi 写成 Claude Code", () => {
    expect(agentLabel("claude")).toBe("Claude Code");
    expect(agentLabel("codex")).toBe("Codex");
    expect(agentLabel("kimi")).toBe("Kimi");
    expect(agentLabel("shell")).toBe("终端");
  });
});

describe("canForkAgent", () => {
  it("只有 claude / codex 能分叉：kimi 没有 --fork-session 之类的入口", () => {
    expect(canForkAgent("claude")).toBe(true);
    expect(canForkAgent("codex")).toBe(true);
    expect(canForkAgent("kimi")).toBe(false);
    expect(canForkAgent("shell")).toBe(false);
  });
});
