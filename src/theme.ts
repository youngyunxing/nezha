import type { ThemeMode, ThemeVariant } from "./types";

export type LightThemeMode = Extract<ThemeMode, "light" | "eyecare">;
export type DarkThemeMode = Extract<ThemeMode, "dark" | "midnight">;

export const THEME_STORAGE_KEY = "nezha:theme";

// 主题面板移除后，浅色档 / 深色档各自映射到哪套主题固定下来（原面板的可选项，
// 默认值保持不变）。跟随系统 + 快捷切换仍在这两档之间来回。
export const LIGHT_THEME_MODE: LightThemeMode = "light";
export const DARK_THEME_MODE: DarkThemeMode = "midnight";

export function isThemeMode(value: string | null): value is ThemeMode {
  return (
    value === "dark" ||
    value === "midnight" ||
    value === "light" ||
    value === "system" ||
    value === "eyecare"
  );
}

export function resolveThemeVariant(mode: ThemeMode, systemPrefersDark: boolean): ThemeVariant {
  if (mode === "system") return systemPrefersDark ? "midnight" : "light";
  return mode;
}

export function getNextThemeMode(
  currentMode: ThemeMode,
  systemPrefersDark: boolean,
  preferredLightTheme: LightThemeMode,
  preferredDarkTheme: DarkThemeMode,
): ThemeMode {
  const currentVariant = resolveThemeVariant(currentMode, systemPrefersDark);
  const isDark = currentVariant === "dark" || currentVariant === "midnight";
  return isDark ? preferredLightTheme : preferredDarkTheme;
}
