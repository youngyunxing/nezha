import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectListItem } from "../components/welcome/ProjectListItem";
import { I18nProvider } from "../i18n";
import type { ProjectRenameResult } from "../projectName";

const project = {
  id: "project-1",
  name: "Client App",
  path: "/workspace/client-app",
  lastOpenedAt: 1,
};

type RenameHandler = (name: string) => ProjectRenameResult | Promise<ProjectRenameResult>;

function renderItem(
  onRename: RenameHandler = vi.fn((): ProjectRenameResult => ({ ok: true, name: "Client Web" })),
) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onToggleHidden = vi.fn();
  const onUpdateAvatar = vi.fn();
  render(
    <I18nProvider>
      <ProjectListItem
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onToggleHidden={onToggleHidden}
        onRename={onRename}
        onUpdateAvatar={onUpdateAvatar}
      />
    </I18nProvider>,
  );
  return { onOpen, onDelete, onToggleHidden, onRename, onUpdateAvatar };
}

describe("ProjectListItem", () => {
  it("opens rename with the keyboard without opening the project", async () => {
    const user = userEvent.setup();
    const { onOpen, onRename } = renderItem();

    screen.getByRole("button", { name: "重命名项目" }).focus();
    await user.keyboard("{Enter}");

    expect(onOpen).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "项目名称" });
    await user.clear(input);
    await user.type(input, "  Client Web  ");
    await user.click(screen.getByRole("button", { name: "保存项目名称" }));

    expect(onRename).toHaveBeenCalledWith("  Client Web  ");
    expect(screen.queryByRole("textbox", { name: "项目名称" })).not.toBeInTheDocument();
  });

  it("keeps editing and presents validation errors", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => ({
      ok: false as const,
      error: "reserved_separator" as const,
    }));
    renderItem(onRename);

    await user.click(screen.getByRole("button", { name: "重命名项目" }));
    const input = screen.getByRole("textbox", { name: "项目名称" });
    await user.clear(input);
    await user.type(input, "client/api");
    await user.click(screen.getByRole("button", { name: "保存项目名称" }));

    expect(screen.getByRole("alert")).toHaveTextContent("项目名称不能包含“/”。");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps editing when persistence fails", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(async () => ({
      ok: false as const,
      error: "save_failed" as const,
    }));
    renderItem(onRename);

    await user.click(screen.getByRole("button", { name: "重命名项目" }));
    const input = screen.getByRole("textbox", { name: "项目名称" });
    await user.clear(input);
    await user.type(input, "Client Web");
    await user.click(screen.getByRole("button", { name: "保存项目名称" }));

    expect(screen.getByRole("alert")).toHaveTextContent("项目名称保存失败。");
    expect(input).toHaveValue("Client Web");
  });

  it("cancels with Escape and keeps row actions independent", async () => {
    const user = userEvent.setup();
    const { onOpen, onDelete } = renderItem();

    await user.click(screen.getByRole("button", { name: "重命名项目" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "项目名称" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除项目" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
