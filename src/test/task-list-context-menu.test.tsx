import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskList } from "../components/task-panel/TaskList";
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
    createdAt: Date.now(),
    ...over,
  };
}

function renderList(
  over: Partial<Omit<Parameters<typeof TaskList>[0], "renamingTaskId" | "onRenamingTaskIdChange">> & {
    /** 初始改名态（真的接一层 useState，跟 App 里的行为一致） */
    renamingTaskId?: string | null;
  } = {},
) {
  const handlers = {
    onSelectLocalSession: vi.fn(),
    onSelectTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onToggleTaskStar: vi.fn(),
    onRenameTask: vi.fn(),
    onRenamingTaskIdChange: vi.fn(),
  };
  const { renamingTaskId: initialRenaming = null, ...rest } = over;
  const props = {
    tasks: [makeTask()],
    taskDisplayWindow: 3 as const,
    query: "",
    selectedId: null,
    isNewTask: false,
    localSessions: [],
    selectedLocalSessionId: null,
    ...handlers,
    ...rest,
  };
  function Wrapper() {
    const [renamingTaskId, setRenamingTaskId] = useState<string | null>(initialRenaming);
    return (
      <TaskList
        {...props}
        renamingTaskId={renamingTaskId}
        onRenamingTaskIdChange={(id) => {
          handlers.onRenamingTaskIdChange(id);
          setRenamingTaskId(id);
        }}
      />
    );
  }
  render(
    <I18nProvider>
      <Wrapper />
    </I18nProvider>,
  );
  return handlers;
}

describe("任务列表右键菜单与改名", () => {
  it("右键一行弹出菜单", () => {
    renderList();
    fireEvent.contextMenu(screen.getByText("修一下登录页的报错"));
    expect(screen.getByText("重命名")).toBeTruthy();
    expect(screen.getByText("收藏")).toBeTruthy();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  it("菜单里的「重命名」把改名态交给上层（标签右键也用同一条路）", () => {
    const handlers = renderList();
    fireEvent.contextMenu(screen.getByText("修一下登录页的报错"));
    fireEvent.click(screen.getByText("重命名"));
    expect(handlers.onRenamingTaskIdChange).toHaveBeenCalledWith("t1");
    // 菜单关掉，改名输入框出现
    expect(screen.queryByText("删除")).toBeNull();
    expect(screen.getByPlaceholderText("修一下登录页的报错")).toBeTruthy();
  });

  it("菜单里的收藏 / 删除走原来的回调", () => {
    const handlers = renderList();
    fireEvent.contextMenu(screen.getByText("修一下登录页的报错"));
    fireEvent.click(screen.getByText("收藏"));
    expect(handlers.onToggleTaskStar).toHaveBeenCalledWith("t1");

    fireEvent.contextMenu(screen.getByText("修一下登录页的报错"));
    fireEvent.click(screen.getByText("删除"));
    expect(handlers.onDeleteTask).toHaveBeenCalledWith("t1");
  });

  it("改名态由上层给：直接传 renamingTaskId 也能出输入框并提交", () => {
    const handlers = renderList({ renamingTaskId: "t1" });
    const input = screen.getByPlaceholderText("修一下登录页的报错") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "登录页报错" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onRenameTask).toHaveBeenCalledWith("t1", "登录页报错");
    expect(handlers.onRenamingTaskIdChange).toHaveBeenCalledWith(null);
  });

  it("删掉的任务（deleted 标记）不再出现在列表里", () => {
    renderList({ tasks: [makeTask({ id: "a1", deleted: true, prompt: "删掉的任务" })] });
    expect(screen.queryByText("删掉的任务")).toBeNull();
    expect(screen.getByText("还没有任务")).toBeTruthy();
  });

  it("改名态属于别的任务时，这一行还是普通标题", () => {
    renderList({ renamingTaskId: "t2" });
    expect(screen.getByText("修一下登录页的报错")).toBeTruthy();
    expect(screen.queryByPlaceholderText("修一下登录页的报错")).toBeNull();
  });
});
