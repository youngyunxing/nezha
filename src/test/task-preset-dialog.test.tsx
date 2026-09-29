import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TaskPresetAddDialog,
  TaskPresetEditDialog,
} from "../components/new-task/TaskPresetDialog";
import { I18nProvider } from "../i18n";
import type { TaskPreset } from "../taskPresets";

const KIMI: TaskPreset = { id: "a", name: "Kimi", agent: "shell", command: "kimi", useWorktree: false };
const TEST: TaskPreset = {
  id: "b",
  name: "跑测试",
  agent: "shell",
  command: "pnpm test",
  useWorktree: false,
};

const nameInput = () => screen.getByLabelText("按钮名称") as HTMLInputElement;

function addDialog(onSave: (p: TaskPreset) => void) {
  return (
    <I18nProvider>
      <TaskPresetAddDialog open onOpenChange={() => {}} onSave={onSave} />
    </I18nProvider>
  );
}

function editDialog(
  presets: TaskPreset[],
  focusPresetId: string | undefined,
  onSave: (p: TaskPreset) => void,
  onDelete: (id: string) => void = () => {},
) {
  return (
    <I18nProvider>
      <TaskPresetEditDialog
        open
        presets={presets}
        focusPresetId={focusPresetId}
        onOpenChange={() => {}}
        onSave={onSave}
        onDelete={onDelete}
      />
    </I18nProvider>
  );
}

describe("添加快捷命令", () => {
  it("空白表单、默认终端，填名字保存即新增", () => {
    const onSave = vi.fn();
    render(addDialog(onSave));
    expect(nameInput().value).toBe("");

    fireEvent.change(nameInput(), { target: { value: "Kimi" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const saved = onSave.mock.calls[0][0] as TaskPreset;
    expect(saved).toMatchObject({ name: "Kimi", agent: "shell" });
  });
});

describe("编辑快捷命令", () => {
  it("左侧列出全部，右侧改选中的那条", () => {
    const onSave = vi.fn();
    render(editDialog([KIMI, TEST], "a", onSave));
    expect(nameInput().value).toBe("Kimi");

    fireEvent.click(screen.getByRole("button", { name: "跑测试" }));
    expect(nameInput().value).toBe("跑测试");

    fireEvent.change(nameInput(), { target: { value: "跑全部测试" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      id: "b",
      name: "跑全部测试",
      command: "pnpm test",
    });
  });

  it("保存后 presets 换新数组，也不会被顶回打开时选中的那条", () => {
    const onSave = vi.fn();
    const { rerender } = render(editDialog([KIMI, TEST], "a", onSave));
    fireEvent.click(screen.getByRole("button", { name: "跑测试" }));
    fireEvent.change(nameInput(), { target: { value: "跑全部测试" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = onSave.mock.calls[0][0] as TaskPreset;

    rerender(editDialog([KIMI, saved], "a", onSave));
    expect(nameInput().value).toBe("跑全部测试");
  });

  it("删除选中的那条：回调 + 右侧清空", () => {
    const onDelete = vi.fn();
    render(editDialog([KIMI, TEST], "b", vi.fn(), onDelete));
    expect(nameInput().value).toBe("跑测试");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("b");
    expect(screen.queryByLabelText("按钮名称")).toBeNull();
  });
});
