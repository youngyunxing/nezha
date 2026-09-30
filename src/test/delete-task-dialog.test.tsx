import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { DeleteTaskDialog } from "../components/task-panel/DeleteTaskDialog";
import { I18nProvider } from "../i18n";

afterEach(cleanup);

const task: Task = {
  id: "t1",
  projectId: "p1",
  prompt: "重构一下会话解析",
  agent: "claude",
  permissionMode: "full_access",
  status: "done",
  createdAt: 1,
};

function renderDialog(over: Partial<Parameters<typeof DeleteTaskDialog>[0]> = {}) {
  const handlers = { onCancel: vi.fn(), onConfirm: vi.fn(), onArchive: vi.fn() };
  render(
    <I18nProvider>
      <DeleteTaskDialog task={task} {...handlers} {...over} />
    </I18nProvider>,
  );
  return handlers;
}

describe("删除任务的确认框", () => {
  it("标题是「确认删除？」，三颗按钮齐全，带上任务内容", () => {
    renderDialog();
    expect(screen.getByText("确认删除？")).toBeTruthy();
    expect(screen.getByText("取消")).toBeTruthy();
    expect(screen.getByText("归档")).toBeTruthy();
    expect(screen.getByText("确认")).toBeTruthy();
    expect(screen.getByText("重构一下会话解析")).toBeTruthy();
  });

  it("三颗按钮各走各的回调", () => {
    const handlers = renderDialog();
    fireEvent.click(screen.getByText("确认"));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onArchive).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it("点「归档」走归档，不删", () => {
    const handlers = renderDialog();
    fireEvent.click(screen.getByText("归档"));
    expect(handlers.onArchive).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it("点「取消」只是关掉", () => {
    const handlers = renderDialog();
    fireEvent.click(screen.getByText("取消"));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(handlers.onArchive).not.toHaveBeenCalled();
  });

  it("没有任务时不显示", () => {
    renderDialog({ task: null });
    expect(screen.queryByText("确认删除？")).toBeNull();
  });
});
