import { describe, expect, test } from "vitest";
import {
  DARK_THEME_MODE,
  getNextThemeMode,
  isThemeMode,
  LIGHT_THEME_MODE,
  resolveThemeVariant,
} from "../theme";

describe("theme helpers", () => {
  test("resolves system mode from the OS preference", () => {
    expect(resolveThemeVariant("system", true)).toBe("midnight");
    expect(resolveThemeVariant("system", false)).toBe("light");
    expect(resolveThemeVariant("eyecare", false)).toBe("eyecare");
    expect(resolveThemeVariant("dark", false)).toBe("dark");
  });

  test("recognizes persisted theme modes", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("midnight")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("eyecare")).toBe(true);
    expect(isThemeMode("white")).toBe(false);
  });

  test("pins the light and dark families now that the picker is gone", () => {
    expect(LIGHT_THEME_MODE).toBe("light");
    expect(DARK_THEME_MODE).toBe("midnight");
  });

  test("toggles between the two pinned families", () => {
    expect(getNextThemeMode("light", false, LIGHT_THEME_MODE, DARK_THEME_MODE)).toBe("midnight");
    expect(getNextThemeMode("midnight", false, LIGHT_THEME_MODE, DARK_THEME_MODE)).toBe("light");
  });

  test("toggling from system lands on the opposite family", () => {
    expect(getNextThemeMode("system", true, LIGHT_THEME_MODE, DARK_THEME_MODE)).toBe("light");
    expect(getNextThemeMode("system", false, LIGHT_THEME_MODE, DARK_THEME_MODE)).toBe("midnight");
  });
});
