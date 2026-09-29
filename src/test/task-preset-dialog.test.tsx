import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskPresetDialog } from "../components/new-task/TaskPresetDialog";
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

function dialog(
  presets: TaskPreset[],
  focusPresetId: string | undefined,
  onSave: (p: TaskPreset) => void,
  onDelete: (id: string) => void = () => {},
) {
  return (
    <I18nProvider>
      <TaskPresetDialog
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

const nameInput = () => screen.getByLabelText("按钮名称") as HTMLInputElement;

describe("快捷按钮编辑器", () => {
  it("保存刷新 presets 后，不会被打开时 focus 的那条的旧值顶回来", () => {
    const onSave = vi.fn();
    const { rerender } = render(dialog([KIMI, TEST], "b", onSave));
    expect(nameInput().value).toBe("跑测试");

    fireEvent.change(nameInput(), { target: { value: "跑全部测试" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = onSave.mock.calls[0][0] as TaskPreset;
    expect(saved).toMatchObject({ id: "b", name: "跑全部测试", command: "pnpm test" });

    rerender(dialog([KIMI, saved], "b", onSave));
    expect(nameInput().value).toBe("跑全部测试");
  });

  it("从「+」打开是空白表单、默认选中终端，保存即新增", () => {
    const onSave = vi.fn();
    render(dialog([KIMI], undefined, onSave));
    expect(nameInput().value).toBe("");

    fireEvent.change(nameInput(), { target: { value: "Kimi" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = onSave.mock.calls[0][0] as TaskPreset;
    expect(saved).toMatchObject({ name: "Kimi", agent: "shell" });
    expect(saved.id).not.toBe("a");
  });

  it("编辑态有删除按钮，点了清空表单", () => {
    const onDelete = vi.fn();
    render(dialog([KIMI], "a", vi.fn(), onDelete));
    expect(nameInput().value).toBe("Kimi");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("a");
    expect(nameInput().value).toBe("");
  });
});
