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

function dialog(presets: TaskPreset[], focusPresetId: string | undefined, onSave: (p: TaskPreset) => void) {
  return (
    <I18nProvider>
      <TaskPresetDialog
        open
        presets={presets}
        focusPresetId={focusPresetId}
        onOpenChange={() => {}}
        onSave={onSave}
        onDelete={() => {}}
      />
    </I18nProvider>
  );
}

describe("快捷按钮编辑器", () => {
  it("点另一条后不会被上一条顶回来（保存刷新 presets 也不许）", () => {
    const onSave = vi.fn();
    const { rerender } = render(dialog([KIMI, TEST], "a", onSave));
    const nameInput = () => screen.getByLabelText("按钮名称") as HTMLInputElement;

    // 打开时载入 focus 的那条
    expect(nameInput().value).toBe("Kimi");

    // 点列表里另一条 → 切过去，上一条的编辑态就该取消
    fireEvent.click(screen.getByText("跑测试"));
    expect(nameInput().value).toBe("跑测试");

    // 保存：App 会换成新的 presets 数组。以前这里会被 focusPresetId(a) 顶回 Kimi
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = onSave.mock.calls[0][0] as TaskPreset;
    expect(saved.name).toBe("跑测试");

    rerender(dialog([KIMI, saved], "a", onSave));
    expect(nameInput().value).toBe("跑测试");
  });

  it("删掉正在编辑的那条会清空表单", () => {
    render(dialog([KIMI, TEST], "b", vi.fn()));
    const nameInput = () => screen.getByLabelText("按钮名称") as HTMLInputElement;
    expect(nameInput().value).toBe("跑测试");

    fireEvent.click(screen.getAllByLabelText("删除")[1]);
    expect(nameInput().value).toBe("");
  });
});
