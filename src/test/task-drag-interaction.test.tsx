import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskList } from "../components/task-panel/TaskList";
import { I18nProvider } from "../i18n";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

function task(id: string, name: string): Task {
  return {
    id,
    projectId: "p1",
    name,
    prompt: name,
    agent: "claude",
    permissionMode: "full_access",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function renderList(tasks: Task[]) {
  const onReorderTasks = vi.fn();
  const onSelectTask = vi.fn();
  render(
    <I18nProvider>
      <TaskList
        tasks={tasks}
        taskDisplayWindow="all"
        query=""
        selectedId={null}
        isNewTask={false}
        localSessions={[]}
        selectedLocalSessionId={null}
        onSelectLocalSession={vi.fn()}
        onResumeLocalSession={vi.fn()}
        onSelectTask={onSelectTask}
        onDeleteTask={vi.fn()}
        onToggleTaskStar={vi.fn()}
        onRenameTask={vi.fn()}
        onReorderTasks={onReorderTasks}
        renamingTaskId={null}
        onRenamingTaskIdChange={vi.fn()}
        onTaskDisplayWindowChange={vi.fn()}
      />
    </I18nProvider>,
  );
  return { onReorderTasks, onSelectTask };
}

/** 行布局：组头 27px + 每个任务行 47px（偏移量由常量算出来，跟实现一致）。 */
function rowOf(name: string): HTMLElement {
  const el = screen.getByText(name).closest("[data-draggable]");
  if (!el) throw new Error(`找不到 ${name} 的行`);
  return el as HTMLElement;
}

describe("任务列表拖动排序", () => {
  it("从上往下拖：松手后按新顺序回传这一组的 id", () => {
    const { onReorderTasks } = renderList([task("t1", "任务一"), task("t2", "任务二"), task("t3", "任务三")]);
    // 行序：组头(0..27) 一(27..74) 二(74..121) 三(121..168)
    fireEvent.pointerDown(rowOf("任务一"), { button: 0, clientY: 30 });
    // 拖到第三行中线（144.5）以下 → 插到末尾
    fireEvent.pointerMove(window, { clientY: 150 });
    fireEvent.pointerUp(window, { clientY: 150 });
    expect(onReorderTasks).toHaveBeenCalledWith(["t2", "t3", "t1"]);
  });

  it("从下往上拖：插到落点之前", () => {
    const { onReorderTasks } = renderList([task("t1", "任务一"), task("t2", "任务二"), task("t3", "任务三")]);
    fireEvent.pointerDown(rowOf("任务三"), { button: 0, clientY: 130 });
    fireEvent.pointerMove(window, { clientY: 40 }); // 第一行中线（50.5）之上
    fireEvent.pointerUp(window, { clientY: 40 });
    expect(onReorderTasks).toHaveBeenCalledWith(["t3", "t1", "t2"]);
  });

  it("拖回原位不提交（顺序没变就不写盘）", () => {
    const { onReorderTasks } = renderList([task("t1", "任务一"), task("t2", "任务二")]);
    fireEvent.pointerDown(rowOf("任务一"), { button: 0, clientY: 30 });
    fireEvent.pointerMove(window, { clientY: 45 });
    fireEvent.pointerUp(window, { clientY: 45 });
    expect(onReorderTasks).not.toHaveBeenCalled();
  });

  it("位移没过阈值（手滑几像素）不算拖拽，点击照常选中", () => {
    const { onReorderTasks, onSelectTask } = renderList([task("t1", "任务一"), task("t2", "任务二")]);
    fireEvent.pointerDown(rowOf("任务一"), { button: 0, clientY: 30 });
    fireEvent.pointerMove(window, { clientY: 32 });
    fireEvent.pointerUp(window, { clientY: 32 });
    expect(onReorderTasks).not.toHaveBeenCalled();

    // 点击落在行内容上（onClick 挂在行内部，包装层的点击不会往下冒泡）
    fireEvent.click(screen.getByText("任务一"));
    expect(onSelectTask).toHaveBeenCalledWith("t1");
  });

  it("拖动刚结束的那一次点击不再触发选中", () => {
    const { onSelectTask } = renderList([task("t1", "任务一"), task("t2", "任务二")]);
    fireEvent.pointerDown(rowOf("任务一"), { button: 0, clientY: 30 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });
    fireEvent.click(screen.getByText("任务一"));
    expect(onSelectTask).not.toHaveBeenCalled();
  });
});
