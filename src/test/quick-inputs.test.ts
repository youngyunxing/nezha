import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_INPUTS,
  loadQuickInputs,
  quickInputsForKind,
  saveQuickInputs,
} from "../quickInputs";

const KEY = "nezha:quick-inputs";

describe("快捷输入的存取", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it("没存过时给两条默认的", () => {
    expect(loadQuickInputs().map((q) => q.label)).toEqual(
      DEFAULT_QUICK_INPUTS.map((q) => q.label),
    );
  });

  it("存过就读存的", () => {
    saveQuickInputs([{ id: "a", label: "跑测试", text: "pnpm test", kind: "command" }]);
    expect(loadQuickInputs()).toEqual([
      { id: "a", label: "跑测试", text: "pnpm test", kind: "command" },
    ]);
  });

  it("删空就是空，不会把默认的又塞回来", () => {
    saveQuickInputs([]);
    expect(loadQuickInputs()).toEqual([]);
  });

  it("存坏了回默认", () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "x" }, 7]));
    expect(loadQuickInputs()).toHaveLength(DEFAULT_QUICK_INPUTS.length);
    localStorage.setItem(KEY, "不是 JSON");
    expect(loadQuickInputs()).toHaveLength(DEFAULT_QUICK_INPUTS.length);
  });

  it("没填名称就用文本当名称", () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "a", text: "  继续  " }]));
    // 老数据没写 kind → 按提示词处理（更保守，不会在终端里被执行）
    expect(loadQuickInputs()).toEqual([
      { id: "a", label: "继续", text: "  继续  ", kind: "prompt" },
    ]);
  });
});

describe("按会话类型筛选", () => {
  it("终端只给命令，agent 只给提示词", () => {
    const list = [
      { id: "p", label: "继续", text: "继续", kind: "prompt" as const },
      { id: "c", label: "git status", text: "git status", kind: "command" as const },
    ];
    expect(quickInputsForKind(list, "command").map((q) => q.id)).toEqual(["c"]);
    expect(quickInputsForKind(list, "prompt").map((q) => q.id)).toEqual(["p"]);
  });

  it("默认那三条里既有提示词也有命令", () => {
    expect(DEFAULT_QUICK_INPUTS.some((q) => q.kind === "prompt")).toBe(true);
    expect(DEFAULT_QUICK_INPUTS.some((q) => q.kind === "command")).toBe(true);
  });
});
