import type React from "react";

export const layout = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--bg-root)",
    overflow: "hidden",
  },
  rootRelative: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "var(--bg-root)",
    overflow: "hidden",
    position: "relative" as const,
  },
  appProjectLayer: {
    position: "absolute" as const,
    inset: 0,
    overflow: "hidden",
  },
  /** 一条项目都没有时的外壳：只挂抽屉（它不依赖 project），右侧留空。
      任务面板强依赖真实 Project，此处无法渲染。 */
  appEmptyShell: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 5,
    display: "flex",
    background: "var(--bg-shell)",
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: "linear-gradient(180deg, var(--bg-sidebar), var(--bg-sidebar-elevated))",
    borderRight: "1px solid var(--border-dim)",
    display: "flex",
    flexDirection: "column",
    padding: "18px 14px 14px",
  },
  // 非激活项目必须 display:none：visibility:hidden 仍留在 layout tree，会让 macOS
  // WKWebView 的 NSTextInputClient 在中文 IME 拖选时扫描隐藏项目的 RenderText。
  projectBodyVisible: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "auto" as const,
    zIndex: 1,
  },
  projectBodyHidden: {
    flex: 1,
    display: "none",
    overflow: "hidden",
    position: "absolute" as const,
    inset: 0,
    pointerEvents: "none" as const,
    zIndex: 0,
  },
  mainContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--bg-panel)",
  },
  projectMainStage: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    minHeight: 0,
    position: "relative" as const,
  },
  rightPanelWrap: { position: "relative" as const, display: "flex", flexShrink: 0 },
  rightPanelResizeHandle: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    cursor: "col-resize",
    zIndex: 10,
  },
  // ── RightToolbar ───────────────────────────────────────────────────────────
  rightToolbar: {
    width: 44,
    flexShrink: 0,
    background: "var(--bg-sidebar)",
    borderLeft: "1px solid var(--border-dim)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 8,
    gap: 2,
    overflow: "hidden",
  },
} satisfies Record<string, React.CSSProperties>;
