import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { attachCopyOnSelect, attachSmartCopy } from "./terminalCopyHelper";

/** 终端宿主：铺满父容器，滚动交给 xterm 自己管。 */
const terminalHostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  cursor: "text",
};

/** 外层：给右上角那对跳转按钮当定位锚点。 */
const scrollShellStyle: CSSProperties = { position: "relative", width: "100%", height: "100%" };

/** 跳到顶 / 到底：笔记本没有 Home/End，快捷键记不住时就点这个。 */
const scrollJumpStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 14,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  zIndex: 2,
};

const scrollJumpBtnStyle: CSSProperties = {
  width: 22,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "1px solid var(--border-dim)",
  borderRadius: 5,
  background: "var(--bg-card)",
  color: "var(--text-hint)",
  opacity: 0.5,
  cursor: "pointer",
};
import { useTerminalPathDrop } from "./useTerminalPathDrop";
import {
  DEFAULT_SHIFT_ENTER_NEWLINE,
  matchesTerminalNewline,
  normalizeShiftEnterNewline,
  TERMINAL_NEWLINE_SEQUENCE,
} from "../shortcuts";
import type { TerminalFontSize, TerminalScrollback, FontFamily, ThemeVariant } from "../types";
import {
  applyTerminalThemeOnPanel,
  initTerminal,
  loadWebglAddon,
  safeFit,
  createSmartWriter,
  attachMacWebKitTerminalGuard,
  attachTerminalScrollbarAutoHide,
  applyTerminalFontSize,
  applyTerminalFontFamily,
  applyDomCharSizeOverride,
  refreshTerminalDisplay,
  unregisterActiveTerminal,
  attachTerminalScrollShortcuts,
  TERMINAL_INPUT_MODE_RESET,
  isMouseReport,
} from "./terminalShared";
import { attachMacWebKitShiftInputFix } from "./terminalInputFix";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onRegisterTerminal: (
    writeFn: ((data: string, callback?: () => void) => void) | null,
  ) => number;
  onReady?: (generation: number) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: TerminalScrollback;
  monoFontFamily: FontFamily;
  isActive?: boolean;
  /** 这个终端是 shell 拥有的（纯终端任务）—— 鼠标上报复位只对它做 */
  shellOwned?: boolean;
  initialData?: string;
  initialSnapshot?: string;
  onSnapshot?: (snapshot: string) => void;
}

export function TerminalView({
  onInput,
  onResize,
  onRegisterTerminal,
  onReady,
  themeVariant,
  terminalFontSize,
  terminalScrollback,
  monoFontFamily,
  isActive = true,
  shellOwned = false,
  initialData,
  initialSnapshot,
  onSnapshot,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onRegisterRef = useRef(onRegisterTerminal);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  /** 最近一次真正告诉 PTY 的尺寸：用来区分"变大"和"变小" */
  const notifiedSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const onReadyRef = useRef(onReady);
  const onSnapshotRef = useRef(onSnapshot);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const shiftEnterNewlineRef = useRef<boolean>(DEFAULT_SHIFT_ENTER_NEWLINE);
  onReadyRef.current = onReady;
  onSnapshotRef.current = onSnapshot;

  // Keep refs current on every render
  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  onRegisterRef.current = onRegisterTerminal;

  // 仅在 cols/rows 真正变化时回调；否则会触发 resize_pty → SIGWINCH →
  // 下游 TUI（Claude Code / Codex）全屏重绘，导致每次切回都看到一次多余重画。
  const notifyResize = useCallback((cols: number, rows: number) => {
    const last = lastSizeRef.current;
    if (last && last.cols === cols && last.rows === rows) return;
    lastSizeRef.current = { cols, rows };
    onResizeRef.current(cols, rows);
  }, []);

  const insertDroppedPathText = useCallback((text: string) => {
    onInputRef.current(text);
    terminalRef.current?.focus();
  }, []);

  useTerminalPathDrop({
    containerRef,
    isActive,
    onInsertText: insertDroppedPathText,
    externalDrops: true,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const { term, fitAddon, whenFontsReady } = initTerminal(
      themeVariant,
      terminalScrollback,
      terminalFontSize,
      monoFontFamily,
    );
    applyTerminalThemeOnPanel(term, themeVariant, container);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    let disposed = false;

    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    term.open(container);
    // 必须在 term.open() 之后挂：_charSizeService 在 open 时才实例化。
    const disposeCharSizeOverride = applyDomCharSizeOverride(term);
    const disposeScrollbarAutoHide = attachTerminalScrollbarAutoHide(term, container);
    const disposeScrollShortcuts = attachTerminalScrollShortcuts(term);
    const disposeInputFix = attachMacWebKitShiftInputFix(term);
    const webglHandle = loadWebglAddon(term);

    // 兜底复位鼠标上报模式：上一个占用这块终端的 TUI 可能没关掉就退出了
    // 只对「shell 拥有」的终端复位鼠标上报：模式是某个 TUI 开的、它没了以后没人消费上报，
    // 鼠标一动就被 shell 的行编辑器画成 `35;42;13M` 之类垃圾（Orca: 02272febf1）。
    // 活着的 agent（claude/codex/kimi）自己要用鼠标，不能动它的模式。
    if (shellOwned) {
      term.write(TERMINAL_INPUT_MODE_RESET);
    }

    const size = safeFit(fitAddon, term, container);
    if (size) {
      notifiedSizeRef.current = { cols: size.cols, rows: size.rows };
      notifyResize(size.cols, size.rows);
    }

    // 字体 ready 后真实 cell 宽度可能变化，再 fit 一次让 cols/rows 跟上。
    whenFontsReady.then(() => {
      if (disposed) return;
      const s = safeFit(fitAddon, term, container);
      if (s) notifyResize(s.cols, s.rows);
    });

    const focusTerminal = () => {
      window.requestAnimationFrame(() => {
        term.focus();
      });
    };

    const writer = createSmartWriter(term);
    const disposeMacWebKitGuard = attachMacWebKitTerminalGuard({ term, container, writer });

    const terminalGeneration = onRegisterRef.current(writer.write);

    const completeRestore = () => {
      onReadyRef.current?.(terminalGeneration);
      focusTerminal();
    };

    window.requestAnimationFrame(() => {
      const s = safeFit(fitAddon, term, container);
      if (s) notifyResize(s.cols, s.rows);
      if (initialSnapshot) {
        term.write(initialSnapshot, () => {
          if (initialData) {
            term.write(initialData, completeRestore);
            return;
          }
          completeRestore();
        });
        return;
      }
      if (initialData) {
        term.write(initialData, completeRestore);
        return;
      }
      completeRestore();
    });

    const disposeSmartCopy = attachSmartCopy(term, {
      matchesNewline: (e) => matchesTerminalNewline(e, shiftEnterNewlineRef.current),
      onNewline: () => onInputRef.current(TERMINAL_NEWLINE_SEQUENCE),
    });
    // 必须挂在 attachMacWebKitTerminalGuard 之后:guard 的 pointerup(恢复
    // textarea + refocus)先按注册顺序执行,复制动作发生在防线状态复原之后。
    const disposeCopyOnSelect = attachCopyOnSelect(term, container);
    const linuxIME = term.onData((data) => {
      // shell 拥有的终端里，鼠标上报只会被 shell 的行编辑器画成 `35;42;13M` 那样的垃圾
      // （探针实测：这些序列全在 IN 侧）。xterm 还在发是因为鼠标模式被某个 TUI 开过没关 ——
      // 拦在输入侧是确定性生效的兜底；agent 任务不过滤，TUI 自己要鼠标。
      if (shellOwned && isMouseReport(data)) return;
      onInputRef.current(data);
    });
    const disposeOnData = { dispose: () => linuxIME.dispose() };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        focusTerminal();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      window.requestAnimationFrame(() => {
        const s = safeFit(fitAddon, term, container);
        if (s) notifyResize(s.cols, s.rows);
        refreshTerminalDisplay(term);
        term.focus();
      });
    };

    container.addEventListener("pointerdown", handlePointerDown as EventListener);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    // 尺寸变化分两种情况处理（实测：双击标题栏把窗口变小再放大，任务会被推进 39 列的
    // 窄宽度，TUI 按那个宽度打印出来的行是**硬换行**，xterm 之后重排不回来 —— 于是那几行
    // 永远是窄的）：
    //   - 变大：立刻生效（150ms 防抖只是躲开缩放动画的中间帧）；
    //   - 变小：先不告诉 PTY，只有小尺寸持续 SHRINK_DELAY_MS 之后才真的缩。
    // 于是"双击缩放"这种短暂变小不会污染 TUI 的输出，而真的把窗口拖小住手不动，终端照旧会缩。
    const applySize = (cols: number, rows: number) => {
      notifiedSizeRef.current = { cols, rows };
      notifyResize(cols, rows);
    };
    const scheduleFit = () => {
      // 只有正在显示的那个终端才能决定 PTY 尺寸：隐藏的后台面板（同项目其它任务、
      // 被文件查看器盖住的面板）窗口变化时也会收到尺寸回调，别让它们把 PTY 改成奇怪的宽度。
      if (!isActiveRef.current) return;

      // 容器变小：**整体不动**，PTY 和网格都保持原尺寸。这样 CLI 永远不会在窄宽度下重排，
      // 也就不会往历史里写下"窄行"—— TUI 在窄宽度下逐行输出的是独立行（硬断行），滚进历史
      // 后 serialize / reflow 都合并不回来（见 terminal-reflow.test.ts 的实测：3 行仍是 3 行）。
      // 代价：小窗口下只能看到左边一部分（布局正确、只是被裁掉），而不是让 CLI 重排一遍。
      // 想让终端真的缩下去：改一次字号即可（那条路径会重新 fit）。
      const proposed = fitAddon.proposeDimensions?.();
      const prev = notifiedSizeRef.current;
      if (proposed && prev && (proposed.cols < prev.cols || proposed.rows < prev.rows)) {
        return;
      }

      if (resizeTimer) clearTimeout(resizeTimer);
      const s = safeFit(fitAddon, term, container);
      if (!s) return;
      resizeTimer = setTimeout(() => applySize(s.cols, s.rows), 150);
    };
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    // 观察器偶发漏掉整窗缩放（容器尺寸由多层面板间接决定），窗口级事件再兜一次
    window.addEventListener("resize", scheduleFit);

    return () => {
      disposed = true;
      // 未触发的 fit/缩容定时器要清掉：否则卸载后还会 invoke resize_pty，
      // 给已经换过面板的任务发一个过期尺寸
      if (resizeTimer) clearTimeout(resizeTimer);
      // 必须最先 unregister:后续任一 dispose 调用抛错会中断 cleanup,
      // 让 term 永久滞留 activeTerminals,下次 sibling 广播命中 zombie。
      unregisterActiveTerminal(term);
      try {
        const snapshot = serializeAddon.serialize();
        if (snapshot) onSnapshotRef.current?.(snapshot);
      } catch {
        /* ignore */
      }
      onRegisterRef.current(null);
      fitAddonRef.current = null;
      disposeCharSizeOverride();
      webglHandle.dispose();
      disposeScrollbarAutoHide();
      disposeScrollShortcuts();
      disposeMacWebKitGuard();
      disposeInputFix();
      disposeSmartCopy();
      disposeCopyOnSelect();
      disposeOnData.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
      container.removeEventListener("pointerdown", handlePointerDown as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      terminalRef.current = null;
      term.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the configured "insert newline" combo in sync with app settings.
  // Mirrors NewTaskView: load once, then react to the global settings event.
  useEffect(() => {
    function loadNewlineShortcut() {
      invoke<{ terminal_shift_enter_newline?: unknown }>("load_app_settings")
        .then((settings) => {
          shiftEnterNewlineRef.current = normalizeShiftEnterNewline(
            settings.terminal_shift_enter_newline,
          );
        })
        .catch(() => {
          shiftEnterNewlineRef.current = DEFAULT_SHIFT_ENTER_NEWLINE;
        });
    }
    loadNewlineShortcut();
    window.addEventListener("nezha:app-settings-changed", loadNewlineShortcut);
    return () => window.removeEventListener("nezha:app-settings-changed", loadNewlineShortcut);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    window.requestAnimationFrame(() => {
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      const container = containerRef.current;
      if (!fitAddon || !term || !container) return;
      // 同样遵守「不缩窄」：隐藏期间容器变小了也不缩 —— 缩了就会让 CLI 在窄宽度下重排，
      // 那正是产生窄行的原因。只有变大（或这个面板还没量过尺寸）才重新 fit。
      const proposed = fitAddon.proposeDimensions?.();
      const prev = notifiedSizeRef.current;
      const wouldShrink =
        !!proposed && !!prev && (proposed.cols < prev.cols || proposed.rows < prev.rows);
      if (!wouldShrink) {
        const s = safeFit(fitAddon, term, container);
        if (s) {
          notifiedSizeRef.current = { cols: s.cols, rows: s.rows };
          notifyResize(s.cols, s.rows);
        }
      }
      refreshTerminalDisplay(term);
      term.focus();
    });
  }, [isActive, notifyResize]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isActive;
    }
  }, [isActive]);

  useEffect(() => {
    if (!terminalRef.current || !containerRef.current) return;
    // 后台 task 的 RunningView 容器是 visibility:hidden,此时设置
    // term.options.theme 虽同步生效,但 xterm WebGL renderer 不会把新主题色
    // 提交到不可见的 canvas;等用户切回该 task 时这个 effect 不会再跑,看到的
    // 还是旧主题色。守在 isActive,切回前台 (isActive false→true) 时补 apply 一次。
    if (!isActive) return;
    applyTerminalThemeOnPanel(terminalRef.current, themeVariant, containerRef.current);
    // 主题/对比度变化后 xterm 算出的最终前景色变了，但 WebGL atlas 仍缓存
    // 旧色的 glyph 纹理，不刷新会看到颜色和字形错位。
    refreshTerminalDisplay(terminalRef.current);
  }, [themeVariant, isActive]);

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
    const size = applyTerminalFontSize(
      terminalRef.current,
      fitAddonRef.current,
      terminalFontSize,
      containerRef.current,
    );
    if (size) notifyResize(size.cols, size.rows);
  }, [terminalFontSize, notifyResize]);

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current || !containerRef.current) return;
    const result = applyTerminalFontFamily(
      terminalRef.current,
      fitAddonRef.current,
      monoFontFamily,
      containerRef.current,
    );
    if (!result) return;
    if (result.immediate) notifyResize(result.immediate.cols, result.immediate.rows);
    let cancelled = false;
    result.whenSettled.then((s) => {
      if (cancelled || !s) return;
      notifyResize(s.cols, s.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [monoFontFamily, notifyResize]);

  return (
    <div style={scrollShellStyle}>
      <div ref={containerRef} className="nezha-xterm-host" style={terminalHostStyle} />
      {/* 右上角一对跳转按钮：笔记本没有 Home/End，快捷键记不住也能滚 */}
      <div style={scrollJumpStyle}>
        <button
          type="button"
          style={scrollJumpBtnStyle}
          title="跳到顶部"
          aria-label="跳到顶部"
          onClick={() => terminalRef.current?.scrollToTop()}
        >
          <ChevronUp size={13} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          style={scrollJumpBtnStyle}
          title="跳到底部"
          aria-label="跳到底部"
          onClick={() => terminalRef.current?.scrollToBottom()}
        >
          <ChevronDown size={13} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
