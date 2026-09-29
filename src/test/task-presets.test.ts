import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TASK_PRESETS, loadTaskPresets, saveTaskPresets } from "../taskPresets";

const KEY = "nezha:task-presets";

describe("快捷创建按钮的存取", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it("没存过时给两个默认按钮：Claude Code 与创建终端", () => {
    const presets = loadTaskPresets();
    expect(presets.map((p) => p.name)).toEqual(["Claude Code", "创建终端"]);
    expect(presets[0]).toMatchObject({ agent: "claude", useWorktree: false });
    expect(presets[1]).toMatchObject({ agent: "shell", useWorktree: false });
  });

  it("存过就读存的（含第三方 CLI：终端类型 + 启动命令）", () => {
    saveTaskPresets([
      { id: "kimi", name: "Kimi", agent: "shell", command: "kimi", useWorktree: true },
    ]);
    expect(loadTaskPresets()).toEqual([
      { id: "kimi", name: "Kimi", agent: "shell", command: "kimi", useWorktree: true },
    ]);
  });

  it("删空就是空，不会把默认按钮又塞回来", () => {
    saveTaskPresets([]);
    expect(loadTaskPresets()).toEqual([]);
  });

  it("存坏了回落到默认，而不是变成空列表", () => {
    localStorage.setItem(KEY, JSON.stringify([{ name: "" }, 42, { id: "x", name: "无类型" }]));
    expect(loadTaskPresets().map((p) => p.name)).toEqual(DEFAULT_TASK_PRESETS.map((p) => p.name));
    localStorage.setItem(KEY, "不是 JSON");
    expect(loadTaskPresets()).toHaveLength(2);
  });

  it("读的时候顺手清洗：名字去空格、命令空串当没填", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: "a", name: "  跑测试  ", agent: "shell", command: "  pnpm test  ", useWorktree: 1 },
        { id: "b", name: "终端", agent: "shell", command: "   ", useWorktree: false },
      ]),
    );
    const [a, b] = loadTaskPresets();
    expect(a).toMatchObject({ name: "跑测试", command: "pnpm test", useWorktree: false });
    expect(b.command).toBeUndefined();
  });
});
