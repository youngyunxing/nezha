import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskStatus } from "../types";
import { TaskList } from "../components/task-panel/TaskList";
import { I18nProvider } from "../i18n";

afterEach(cleanup);

const NOW = Date.now();

function task(id: string, title: string, status: TaskStatus, updatedAt: number): Task {
  return {
    id,
    projectId: "p1",
    name: title,
    prompt: title,
    agent: "claude",
    permissionMode: "full_access",
    status,
    createdAt: updatedAt,
    updatedAt,
  };
}

/** 渲染一批任务，返回列表里的文字顺序（用来断言排序）。 */
function renderOrder(tasks: Task[]) {
  const { container } = render(
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
        onSelectTask={vi.fn()}
        onDeleteTask={vi.fn()}
        onRestoreTask={vi.fn()}
        onToggleTaskStar={vi.fn()}
        onRenameTask={vi.fn()}
        renamingTaskId={null}
        onRenamingTaskIdChange={vi.fn()}
        onTaskDisplayWindowChange={vi.fn()}
        onReorderTasks={vi.fn()}
      />
    </I18nProvider>,
  );
  const text = container.textContent ?? "";
  const at = (title: string) => text.indexOf(title);
  return { at, text };
}

describe("任务列表排序：结束态沉底", () => {
  it("已完成的任务排在还没结束的后面（哪怕它更新时间更晚）", () => {
    const { at } = renderOrder([
      task("done1", "刚完成的", "done", NOW),
      task("run1", "还在跑的", "running", NOW - 60_000),
      task("pend1", "刚排队的", "pending", NOW - 120_000),
    ]);
    expect(at("还在跑的")).toBeGreaterThanOrEqual(0);
    expect(at("还在跑的")).toBeLessThan(at("刚完成的"));
    expect(at("刚排队的")).toBeLessThan(at("刚完成的"));
  });

  it("失败 / 已取消同样算结束态", () => {
    const { at } = renderOrder([
      task("fail1", "跑挂了的", "failed", NOW),
      task("canc1", "被取消的", "cancelled", NOW - 1000),
      task("run1", "还在跑的", "running", NOW - 60_000),
    ]);
    expect(at("还在跑的")).toBeLessThan(at("跑挂了的"));
    expect(at("还在跑的")).toBeLessThan(at("被取消的"));
  });

  it("等你 / 待恢复 仍排在最前（这次改动不动它们）", () => {
    const { at } = renderOrder([
      task("run1", "还在跑的", "running", NOW),
      task("wait1", "等你的", "input_required", NOW - 600_000),
      task("int1", "待恢复的", "interrupted", NOW - 700_000),
    ]);
    expect(at("等你的")).toBeLessThan(at("还在跑的"));
    expect(at("待恢复的")).toBeLessThan(at("还在跑的"));
  });

  it("同一档里还是按时间倒序", () => {
    const { at } = renderOrder([
      task("a", "早一点的", "running", NOW - 600_000),
      task("b", "晚一点的", "running", NOW - 60_000),
    ]);
    expect(at("晚一点的")).toBeLessThan(at("早一点的"));
  });
});
