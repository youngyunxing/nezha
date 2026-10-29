import { describe, expect, it } from "vitest";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { fitWithResizeOrder } from "../components/TerminalView";
import { shouldResizePtyBeforeXterm } from "../components/terminalShared";

describe("PTY 与 xterm 的缩放顺序", () => {
  it("列数缩小时先缩 PTY，避免 CLI 满宽行被 xterm 额外折行", () => {
    expect(shouldResizePtyBeforeXterm({ cols: 100, rows: 50 }, { cols: 99, rows: 50 })).toBe(true);
  });

  it("行数缩小时同样先缩 PTY", () => {
    expect(shouldResizePtyBeforeXterm({ cols: 100, rows: 50 }, { cols: 100, rows: 49 })).toBe(true);
  });

  it("放大时先扩 xterm，再扩 PTY", () => {
    expect(shouldResizePtyBeforeXterm({ cols: 99, rows: 49 }, { cols: 100, rows: 50 })).toBe(false);
  });

  it("尺寸不变不需要额外重排", () => {
    expect(shouldResizePtyBeforeXterm({ cols: 100, rows: 50 }, { cols: 100, rows: 50 })).toBe(
      false,
    );
  });
});

describe("fitWithResizeOrder 的实际调用顺序", () => {
  function harness(current: { cols: number; rows: number }, next: { cols: number; rows: number }) {
    const calls: string[] = [];
    const dimensions = { ...current };
    const term = {
      get cols() {
        return dimensions.cols;
      },
      get rows() {
        return dimensions.rows;
      },
      buffer: { active: { viewportY: 0, baseY: 0, type: "normal" } },
      scrollToBottom: () => {},
    } as Terminal;
    const fitAddon = {
      proposeDimensions: () => ({ ...next }),
      fit: () => {
        calls.push("xterm");
        dimensions.cols = next.cols;
        dimensions.rows = next.rows;
      },
    } as FitAddon;
    const container = {
      getBoundingClientRect: () => ({ width: 1000, height: 500 }),
    } as HTMLElement;
    const notifyResize = async () => {
      calls.push("pty");
    };
    return { calls, term, fitAddon, container, notifyResize };
  }

  it("缩小时 PTY 先于 xterm", async () => {
    const { calls, term, fitAddon, container, notifyResize } = harness(
      { cols: 100, rows: 50 },
      { cols: 99, rows: 50 },
    );
    await fitWithResizeOrder(fitAddon, term, container, notifyResize, () => true);
    expect(calls).toEqual(["pty", "xterm", "pty"]);
  });

  it("放大时 xterm 先于 PTY", async () => {
    const { calls, term, fitAddon, container, notifyResize } = harness(
      { cols: 99, rows: 50 },
      { cols: 100, rows: 50 },
    );
    await fitWithResizeOrder(fitAddon, term, container, notifyResize, () => true);
    expect(calls).toEqual(["xterm", "pty"]);
  });
});
