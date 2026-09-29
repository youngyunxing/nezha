import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_QUICK_INPUTS, loadQuickInputs, saveQuickInputs } from "../quickInputs";

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
    saveQuickInputs([{ id: "a", label: "跑测试", text: "pnpm test" }]);
    expect(loadQuickInputs()).toEqual([{ id: "a", label: "跑测试", text: "pnpm test" }]);
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
    expect(loadQuickInputs()).toEqual([{ id: "a", label: "继续", text: "  继续  " }]);
  });
});
