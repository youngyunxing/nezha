import { describe, expect, test } from "vitest";
import {
  DEFAULT_SEND_SHORTCUT,
  getNewlineShortcutKeys,
  getNewlineShortcutLabel,
  getSendShortcutKeys,
  getSendShortcutLabel,
  normalizeSendShortcut,
  scrollJumpForKey,
  shouldInsertPromptNewlineKey,
  shouldSubmitPromptKey,
} from "../shortcuts";

describe("send shortcut helpers", () => {
  test("defaults to modifier plus Enter", () => {
    expect(DEFAULT_SEND_SHORTCUT).toBe("mod_enter");
    expect(normalizeSendShortcut(undefined)).toBe("mod_enter");
    expect(normalizeSendShortcut("unexpected")).toBe("mod_enter");
  });

  test("submits with Cmd+Enter on macOS modifier mode", () => {
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false },
        "mod_enter",
      ),
    ).toBe(true);
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: true },
        "mod_enter",
      ),
    ).toBe(false);
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false },
        "mod_enter",
      ),
    ).toBe(false);
  });

  test("submits plain Enter mode but leaves Shift+Enter for newline", () => {
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false },
        "enter",
      ),
    ).toBe(true);
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: true },
        "enter",
      ),
    ).toBe(false);
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false },
        "enter",
      ),
    ).toBe(false);
    expect(
      shouldSubmitPromptKey(
        { key: "Enter", metaKey: false, ctrlKey: true, shiftKey: false },
        "enter",
      ),
    ).toBe(false);
  });

  test("inserts newline with Cmd when Enter sends", () => {
    expect(
      shouldInsertPromptNewlineKey(
        { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false },
        "enter",
      ),
    ).toBe(true);
    // Ctrl+Enter is not the modifier on macOS.
    expect(
      shouldInsertPromptNewlineKey(
        { key: "Enter", metaKey: false, ctrlKey: true, shiftKey: false },
        "enter",
      ),
    ).toBe(false);
    expect(
      shouldInsertPromptNewlineKey(
        { key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false },
        "mod_enter",
      ),
    ).toBe(false);
  });

  test("formats shortcut labels", () => {
    expect(getSendShortcutLabel("mod_enter")).toBe("⌘↵");
    expect(getSendShortcutLabel("enter")).toBe("↵");
    expect(getNewlineShortcutLabel("mod_enter")).toBe("↵");
    expect(getNewlineShortcutLabel("enter")).toBe("⌘↵");
    expect(getSendShortcutKeys("mod_enter")).toEqual(["⌘", "↵"]);
    expect(getSendShortcutKeys("enter")).toEqual(["↵"]);
    expect(getNewlineShortcutKeys("mod_enter")).toEqual(["↵"]);
    expect(getNewlineShortcutKeys("enter")).toEqual(["⌘", "↵"]);
  });
});

describe("scrollJumpForKey（终端跳到顶/底）", () => {
  const ev = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  test("Cmd + 上下键命中（Mac 限定）", () => {
    expect(scrollJumpForKey(ev("ArrowUp", { metaKey: true }))).toBe("top");
    expect(scrollJumpForKey(ev("ArrowDown", { metaKey: true }))).toBe("bottom");
  });

  test("Ctrl / Home / End 都不接管 —— 笔记本没有 Home/End，Ctrl 组合另有含义", () => {
    expect(scrollJumpForKey(ev("ArrowUp", { ctrlKey: true }))).toBeNull();
    expect(scrollJumpForKey(ev("Home", { metaKey: true }))).toBeNull();
    expect(scrollJumpForKey(ev("End", { metaKey: true }))).toBeNull();
  });

  test("不按修饰键就不接管 —— TUI 自己要用上下键", () => {
    expect(scrollJumpForKey(ev("ArrowUp"))).toBeNull();
    expect(scrollJumpForKey(ev("Home"))).toBeNull();
    expect(scrollJumpForKey(ev("End"))).toBeNull();
  });

  test("带 Shift / Alt 的组合不抢（可能是选中或输入法）", () => {
    expect(scrollJumpForKey(ev("ArrowUp", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(scrollJumpForKey(ev("ArrowUp", { metaKey: true, altKey: true }))).toBeNull();
    expect(scrollJumpForKey(ev("a", { metaKey: true }))).toBeNull();
  });
});
