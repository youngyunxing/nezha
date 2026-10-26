import { describe, expect, test } from "vitest";
import { isMouseReport, shouldDropShellMouseInput } from "../components/terminalShared";

describe("鼠标上报识别（shell 拥有者要拦掉）", () => {
  test("单条 / 多条 SGR 上报都认", () => {
    expect(isMouseReport("\x1b[<35;38;13M")).toBe(true);
    expect(isMouseReport("\x1b[<0;12;5M\x1b[<0;12;5m")).toBe(true);
    expect(isMouseReport("\x1b[<35;40;13M\x1b[<35;40;14M\x1b[<35;40;15M")).toBe(true);
  });

  test("经典 X10 上报也认", () => {
    expect(isMouseReport("\x1b[M !!")).toBe(true);
  });

  test("普通按键、粘贴、转义序列一律不认（宁可漏拦，不能吞用户输入）", () => {
    expect(isMouseReport("a")).toBe(false);
    expect(isMouseReport("\r")).toBe(false);
    expect(isMouseReport("\x1b[A")).toBe(false);
    expect(isMouseReport("\x1b[200~粘贴的内容\x1b[201~")).toBe(false);
    // 上报里混进了别的字节 → 不能整段丢掉
    expect(isMouseReport("\x1b[<35;38;13Mls")).toBe(false);
    expect(isMouseReport("\x1b[<35;38;13")).toBe(false);
  });
});

describe("shell 终端的鼠标上报过滤条件", () => {
  test("普通缓冲区 + shell 拥有 → 丢（TUI 退出没关上报，行编辑器会把上报画成垃圾）", () => {
    expect(
      shouldDropShellMouseInput("\x1b[<35;38;13M", {
        shellOwned: true,
        alternateBuffer: false,
      }),
    ).toBe(true);
  });

  test("备用缓冲区（全屏 TUI）不丢 —— vim / htop / tmux 自己的鼠标要用", () => {
    expect(
      shouldDropShellMouseInput("\x1b[<35;38;13M", {
        shellOwned: true,
        alternateBuffer: true,
      }),
    ).toBe(false);
  });

  test("agent 任务不丢；普通输入任何情况下都不丢", () => {
    expect(
      shouldDropShellMouseInput("\x1b[<35;38;13M", {
        shellOwned: false,
        alternateBuffer: false,
      }),
    ).toBe(false);
    expect(shouldDropShellMouseInput("ls\r", { shellOwned: true, alternateBuffer: false })).toBe(
      false,
    );
  });
});
