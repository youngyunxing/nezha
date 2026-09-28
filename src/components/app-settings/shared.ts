import type React from "react";
import { createElement } from "react";
import s from "../../styles";
import type { AgentKey } from "./types";

export const shortcutKeyGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  lineHeight: 1,
  verticalAlign: "middle",
};

export const shortcutKeyStyle: React.CSSProperties = {
  ...s.kbd,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  height: "auto",
  padding: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  color: "var(--text-secondary)",
  opacity: 1,
  fontSize: "inherit",
  lineHeight: "inherit",
  verticalAlign: "middle",
};

export function renderShortcutKeys(keys: string[], keyStyle = shortcutKeyStyle) {
  return createElement(
    "span",
    { style: shortcutKeyGroupStyle, "aria-hidden": true },
    keys.map((key, index) =>
      createElement("kbd", { key: `${key}-${index}`, style: keyStyle }, key),
    ),
  );
}

export function getAgentSettingsFilePath(agent: AgentKey): string {
  return agent === "claude" ? "~/.claude/settings.json" : "~/.codex/config.toml";
}

export function getAgentExecutablePlaceholder(agent: AgentKey): string {
  return agent === "claude"
    ? "claude or /opt/homebrew/bin/claude"
    : "codex or /opt/homebrew/bin/codex";
}
