import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionView } from "../components/SessionView";
import { I18nProvider } from "../i18n";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// jsdom 里 scrollHeight / clientHeight 恒为 0，滚动逻辑没法验 —— 直接给个假的尺寸。
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 100;

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

/** 假的 ResizeObserver：把回调收下来，测试里手动触发（模拟"代码高亮完内容变高"）。 */
let resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => SCROLL_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT,
  });
  resizeCallbacks = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  resizeCallbacks = [];
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  if (originalScrollHeight) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
  }
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  }
});

const messages = [
  { role: "user", content: [{ type: "text", text: "第一条消息" }] },
  { role: "assistant", content: [{ type: "text", text: "最新一条回复" }] },
];

async function renderSession() {
  invokeMock.mockResolvedValue(messages);
  const { container } = render(
    <I18nProvider>
      <SessionView sessionPath="/tmp/session.jsonl" themeVariant="dark" />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText("最新一条回复")).toBeTruthy());
  return container.querySelector(".session-scroll-pane") as HTMLElement;
}

function fireResize() {
  for (const callback of resizeCallbacks) {
    callback([], {} as ResizeObserver);
  }
}

describe("历史会话的滚动", () => {
  it("打开后默认停在最新一条（滚到底）", async () => {
    const pane = await renderSession();
    await waitFor(() => expect(pane.scrollTop).toBe(SCROLL_HEIGHT));
  });

  it("右上角两颗按钮：跳到顶部 / 跳到底部", async () => {
    const pane = await renderSession();
    fireEvent.click(screen.getByLabelText("跳到顶部"));
    expect(pane.scrollTop).toBe(0);
    fireEvent.click(screen.getByLabelText("跳到底部"));
    expect(pane.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("内容继续变高时保持贴底（懒高亮的代码块会撑大）", async () => {
    const pane = await renderSession();
    pane.scrollTop = 0;
    fireResize();
    expect(pane.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("用户自己往上滚之后就不再自动贴底", async () => {
    const pane = await renderSession();
    pane.scrollTop = 300; // 离底部还有 600px
    fireEvent.scroll(pane);
    fireResize();
    expect(pane.scrollTop).toBe(300);
  });
});
