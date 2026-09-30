import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskListItem } from "../components/task-panel/TaskListItem";
import { TaskContextMenu } from "../components/task-panel/TaskContextMenu";
import { I18nProvider } from "../i18n";

afterEach(cleanup);

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    prompt: "修一下登录页的报错",
    agent: "claude",
    permissionMode: "full_access",
    status: "running",
    createdAt: 1,
    ...over,
  };
}

function renderItem(over: Partial<Parameters<typeof TaskListItem>[0]> = {}) {
  const props = {
    task: makeTask(),
    selected: false,
    onClick: vi.fn(),
    onContextMenu: vi.fn(),
    renaming: false,
    onRenameSubmit: vi.fn(),
    onRenameCancel: vi.fn(),
    ...over,
  };
  render(
    <I18nProvider>
      <TaskListItem {...(props as Parameters<typeof TaskListItem>[0])} />
    </I18nProvider>,
  );
  return props;
}

describe("任务列表行：收藏 / 删除改走右键菜单", () => {
  it("行内不再有收藏和删除按钮", () => {
    renderItem({ task: makeTask({ starred: true }) });
    expect(screen.queryByLabelText("收藏")).toBeNull();
    expect(screen.queryByLabelText("取消收藏")).toBeNull();
    expect(screen.queryByLabelText("删除")).toBeNull();
  });

  it("右键交给外部处理（由它决定弹菜单）", () => {
    const props = renderItem();
    fireEvent.contextMenu(screen.getByText("修一下登录页的报错"));
    expect(props.onContextMenu).toHaveBeenCalledTimes(1);
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it("改名中输入框带出当前名字，回车提交去空格后的值", () => {
    const props = renderItem({ task: makeTask({ name: "登录页报错" }), renaming: true });
    const input = screen.getByPlaceholderText("修一下登录页的报错") as HTMLInputElement;
    expect(input.value).toBe("登录页报错");

    fireEvent.change(input, { target: { value: "  修登录页  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameSubmit).toHaveBeenCalledWith("修登录页");
  });

  it("改名中按 Esc 取消，不提交", () => {
    const props = renderItem({ renaming: true });
    const input = screen.getByPlaceholderText("修一下登录页的报错");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onRenameCancel).toHaveBeenCalledTimes(1);
    expect(props.onRenameSubmit).not.toHaveBeenCalled();
  });

  it("同一条任务第二次改名，失焦仍然提交（每次进入改名态都会重置去重标记）", () => {
    const props = {
      task: makeTask(),
      selected: false,
      onClick: vi.fn(),
      onContextMenu: vi.fn(),
      renaming: true,
      onRenameSubmit: vi.fn(),
      onRenameCancel: vi.fn(),
    };
    const ui = (renaming: boolean) => (
      <I18nProvider>
        <TaskListItem {...props} renaming={renaming} />
      </I18nProvider>
    );
    const { rerender } = render(ui(true));
    const input = screen.getByPlaceholderText("修一下登录页的报错") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "第一次" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRenameSubmit).toHaveBeenCalledTimes(1);

    // 退出改名态再进一次（同一条任务，组件实例没换）
    rerender(ui(false));
    rerender(ui(true));
    const second = screen.getByPlaceholderText("修一下登录页的报错") as HTMLInputElement;
    fireEvent.change(second, { target: { value: "第二次" } });
    fireEvent.blur(second);
    expect(props.onRenameSubmit).toHaveBeenCalledTimes(2);
    expect(props.onRenameSubmit).toHaveBeenLastCalledWith("第二次");
  });

  it("改名中失焦即提交，且不会和回车重复提交", () => {
    const props = renderItem({ renaming: true });
    const input = screen.getByPlaceholderText("修一下登录页的报错") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(props.onRenameSubmit).toHaveBeenCalledTimes(1);
    expect(props.onRenameSubmit).toHaveBeenCalledWith("新名字");
  });
});

describe("任务右键菜单", () => {
  function renderMenu(task: Task) {
    const handlers = { onClose: vi.fn(), onRename: vi.fn(), onToggleStar: vi.fn(), onDelete: vi.fn() };
    render(
      <I18nProvider>
        <TaskContextMenu ctxMenu={{ x: 10, y: 20, task }} {...handlers} />
      </I18nProvider>,
    );
    return handlers;
  }

  it("三个操作都在，各自回调自己的 handler", () => {
    const handlers = renderMenu(makeTask());
    fireEvent.click(screen.getByText("重命名"));
    expect(handlers.onRename).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("收藏"));
    expect(handlers.onToggleStar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("删除"));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it("已收藏的任务显示「取消收藏任务」", () => {
    renderMenu(makeTask({ starred: true }));
    expect(screen.getByText("取消收藏")).toBeTruthy();
    expect(screen.queryByText("收藏")).toBeNull();
  });

  it("菜单比文件树那个窄一截（条目只有两三个字）", () => {
    renderMenu(makeTask());
    const menu = screen.getByText("重命名").parentElement as HTMLElement;
    expect(menu.style.minWidth).toBe("108px");
  });

  it("点空白背景关掉菜单", () => {
    const handlers = renderMenu(makeTask());
    const backdrop = document.querySelector('[style*="inset"]') as HTMLElement;
    fireEvent.pointerDown(backdrop);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
