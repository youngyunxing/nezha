import { describe, expect, test } from "vitest";
import {
  DEFAULT_SEND_SHORTCUT,
  getNewlineShortcutKeys,
  getNewlineShortcutLabel,
  getSendShortcutKeys,
  getSendShortcutLabel,
  normalizeSendShortcut,
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
