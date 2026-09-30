import { afterEach, describe, expect, it } from "vitest";
import {
  fileTabKey,
  loadTabColorOverrides,
  resolveTabColors,
  saveTabColorOverrides,
  taskTabColorKey,
} from "../mainTabs";
import { PROJECT_AVATAR_COLORS } from "../projectAvatar";

afterEach(() => {
  localStorage.clear();
});

describe("标签配色", () => {
  it("同一组标签里颜色互不相同", () => {
    const keys = [taskTabColorKey("t1"), fileTabKey("/p/a.ts"), fileTabKey("/p/b.md"), "diff"];
    const colors = resolveTabColors(keys, {});
    expect(new Set(Object.values(colors)).size).toBe(keys.length);
  });

  it("同一个 key 每次算出来是同一个色（不靠存盘也稳定）", () => {
    const key = fileTabKey("/p/a.ts");
    expect(resolveTabColors([key], {})[key]).toBe(resolveTabColors([key], {})[key]);
  });

  it("用户挑过的色优先，且其它标签会避开它", () => {
    const first = taskTabColorKey("t1");
    const second = fileTabKey("/p/a.ts");
    const colors = resolveTabColors([first, second], { [first]: "pink" });
    expect(colors[first]).toBe("pink");
    expect(colors[second]).not.toBe("pink");
  });

  it("标签比色板多时不会算出色板以外的值", () => {
    const keys = Array.from({ length: PROJECT_AVATAR_COLORS.length + 5 }, (_, i) => `file:/p/${i}.ts`);
    const colors = resolveTabColors(keys, {});
    for (const color of Object.values(colors)) {
      expect(PROJECT_AVATAR_COLORS).toContain(color);
    }
  });

  it("挑过的色存得下、读得回", () => {
    const key = fileTabKey("/p/a.ts");
    saveTabColorOverrides({ [key]: "teal" });
    expect(loadTabColorOverrides()).toEqual({ [key]: "teal" });
  });

  it("存盘里的脏值会被丢掉（不留坏色进渲染）", () => {
    localStorage.setItem("nezha:tab-colors", JSON.stringify({ "file:/p/a.ts": "chartreuse" }));
    expect(loadTabColorOverrides()).toEqual({});
    localStorage.setItem("nezha:tab-colors", "not json");
    expect(loadTabColorOverrides()).toEqual({});
  });
});
