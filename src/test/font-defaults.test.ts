import { describe, expect, test } from "vitest";
import { getDefaultMonoFont, isAutoDefaultMonoFont } from "../types";

describe("font defaults", () => {
  test("defaults to the macOS mono stack", () => {
    expect(getDefaultMonoFont()).toBe(
      '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, ui-monospace, monospace',
    );
  });

  test("treats every auto default stack as replaceable", () => {
    expect(
      isAutoDefaultMonoFont('"JetBrains Mono", "Fira Code", ui-monospace, monospace'),
    ).toBe(true);
    expect(
      isAutoDefaultMonoFont(
        '"JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, ui-monospace, monospace',
      ),
    ).toBe(true);
    expect(
      isAutoDefaultMonoFont('Consolas, "Cascadia Mono", "JetBrains Mono", "Fira Code", monospace'),
    ).toBe(true);
    expect(isAutoDefaultMonoFont('"JetBrains Mono"')).toBe(false);
  });
});
