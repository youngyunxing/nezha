import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { useProjectPanels } from "../hooks/useProjectPanels";
import { MainTabBar } from "../components/main-tabs/MainTabBar";
import { fileTabKey } from "../mainTabs";

afterEach(cleanup);

describe("主区域标签：打开文件是新增标签，不覆盖会话", () => {
  it("打开文件追加标签并切过去", () => {
    const { result } = renderHook(() => useProjectPanels());
    expect(result.current.showingFile).toBe(false);
    expect(result.current.activeFilePath).toBeNull();

    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));

    expect(result.current.openFiles.map((tab) => tab.path)).toEqual(["/p/a.ts"]);
    expect(result.current.activeFilePath).toBe("/p/a.ts");
    expect(result.current.showingFile).toBe(true);
  });

  it("再开一个文件是挨着追加，不是替换", () => {
    const { result } = renderHook(() => useProjectPanels());
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    act(() => result.current.handleFileSelect("/p/b.md", "b.md"));

    expect(result.current.openFiles.map((tab) => tab.name)).toEqual(["a.ts", "b.md"]);
    expect(result.current.activeFilePath).toBe("/p/b.md");

    // 重复打开同一个文件不产生第二个标签，只是切过去
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    expect(result.current.openFiles).toHaveLength(2);
    expect(result.current.activeFilePath).toBe("/p/a.ts");
  });

  it("回到会话标签后，文件标签还在，随时能切回来", () => {
    const { result } = renderHook(() => useProjectPanels());
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    act(() => result.current.showSessionView());

    expect(result.current.showingFile).toBe(false);
    expect(result.current.openFiles).toHaveLength(1);

    act(() => result.current.handleFileTabSelect("/p/a.ts"));
    expect(result.current.showingFile).toBe(true);
    expect(result.current.activeFilePath).toBe("/p/a.ts");
  });

  it("关掉当前文件落到相邻标签，全关完自动回会话", () => {
    const { result } = renderHook(() => useProjectPanels());
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    act(() => result.current.handleFileSelect("/p/b.md", "b.md"));
    act(() => result.current.handleFileSelect("/p/c.rs", "c.rs"));

    act(() => result.current.handleFileTabClose("/p/b.md"));
    // b 不是当前激活的（c 是），关掉不动激活项
    expect(result.current.activeFilePath).toBe("/p/c.rs");

    act(() => result.current.handleFileTabClose("/p/c.rs"));
    expect(result.current.activeFilePath).toBe("/p/a.ts");
    expect(result.current.showingFile).toBe(true);

    act(() => result.current.handleFileTabClose("/p/a.ts"));
    expect(result.current.activeFilePath).toBeNull();
    expect(result.current.showingFile).toBe(false);
  });

  it("diff 是覆盖层：打开时主区域让给它，关掉后回到原来的文件", () => {
    const { result } = renderHook(() => useProjectPanels());
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    act(() => result.current.handleCommitSelect("abc123", "fix: 某处"));

    expect(result.current.openDiff).toEqual({ kind: "commit", hash: "abc123", message: "fix: 某处" });
    // 文件态没被改掉 —— 关掉 diff 就露出文件
    expect(result.current.showingFile).toBe(true);

    act(() => result.current.setOpenDiff(null));
    expect(result.current.openDiff).toBeNull();
    expect(result.current.showingFile).toBe(true);
  });

  it("打开文件会先收掉 diff（同一个主区域不能同时显示两个东西）", () => {
    const { result } = renderHook(() => useProjectPanels());
    act(() => result.current.handleCommitSelect("abc123", "fix: 某处"));
    act(() => result.current.handleFileSelect("/p/a.ts", "a.ts"));
    expect(result.current.openDiff).toBeNull();
  });

  it("markdown 预览开关按文件各记一份", () => {
    const { result } = renderHook(() => useProjectPanels());
    expect(result.current.previewModes["/p/b.md"] ?? true).toBe(true);
    act(() => result.current.togglePreviewMode("/p/b.md"));
    expect(result.current.previewModes["/p/b.md"]).toBe(false);
    expect(result.current.previewModes["/p/a.ts"]).toBeUndefined();
  });
});

describe("MainTabBar", () => {
  function renderBar(overrides: Partial<Parameters<typeof MainTabBar>[0]> = {}) {
    const handlers = {
      onSelectSession: vi.fn(),
      onSelectFile: vi.fn(),
      onCloseFile: vi.fn(),
      onCloseOtherFiles: vi.fn(),
      onCloseFilesToRight: vi.fn(),
      onCloseFilesToLeft: vi.fn(),
      onCloseAllFiles: vi.fn(),
      onCloseDiff: vi.fn(),
    };
    const props = {
      sessionLabel: "跑个任务",
      files: [
        { path: "/p/a.ts", name: "a.ts" },
        { path: "/p/b.md", name: "b.md" },
      ],
      activeKey: "session" as const,
      diffLabel: null,
      markdown: null,
      colors: {} as Record<string, never>,
      sessionColorKey: null,
      onPickColor: vi.fn(),
      ...handlers,
      ...overrides,
    };
    render(
      <I18nProvider>
        <MainTabBar {...props} />
      </I18nProvider>,
    );
    return handlers;
  }

  it("会话标签在第一位，且没有关闭按钮", () => {
    renderBar();
    const sessionTab = screen.getByTitle("跑个任务");
    expect(sessionTab.dataset.active).toBe("true");
    expect(screen.queryByLabelText("关闭 跑个任务")).toBeNull();
  });

  it("文件标签排会话后面，点击切过去", () => {
    const handlers = renderBar({ activeKey: fileTabKey("/p/b.md") });
    expect(screen.getByTitle("/p/b.md").dataset.active).toBe("true");
    expect(screen.getByTitle("/p/a.ts").dataset.active).toBe("false");

    fireEvent.click(screen.getByTitle("/p/a.ts"));
    expect(handlers.onSelectFile).toHaveBeenCalledWith("/p/a.ts");
  });

  it("点关闭按钮只关标签，不触发切换", () => {
    const handlers = renderBar();
    fireEvent.click(screen.getByLabelText("关闭 b.md"));
    expect(handlers.onCloseFile).toHaveBeenCalledWith("/p/b.md");
    expect(handlers.onSelectFile).not.toHaveBeenCalled();
  });

  it("点会话标签切回会话", () => {
    const handlers = renderBar({ activeKey: fileTabKey("/p/a.ts") });
    fireEvent.click(screen.getByTitle("跑个任务"));
    expect(handlers.onSelectSession).toHaveBeenCalledTimes(1);
  });

  it("diff 打开时占一个标签，可关闭", () => {
    const handlers = renderBar({ diffLabel: "fix: 某处", activeKey: "diff" });
    const diffTab = screen.getByTitle("fix: 某处");
    expect(diffTab.dataset.active).toBe("true");
    // 会话标签不再是激活态
    expect(screen.getByTitle("跑个任务").dataset.active).toBe("false");

    fireEvent.click(screen.getByLabelText("关闭 fix: 某处"));
    expect(handlers.onCloseDiff).toHaveBeenCalledTimes(1);
  });

  it("会话标签右键交给外部（弹任务操作菜单）", () => {
    const onSessionContextMenu = vi.fn();
    renderBar({ onSessionContextMenu });
    fireEvent.contextMenu(screen.getByTitle("跑个任务"));
    expect(onSessionContextMenu).toHaveBeenCalledTimes(1);
  });

  it("每个标签上沿的颜色来自配色表（会话按任务键取）", () => {
    renderBar({
      colors: { "task:t9": "teal", "file:/p/a.ts": "red", "file:/p/b.md": "sky" },
      sessionColorKey: "task:t9",
    });
    expect(screen.getByTitle("跑个任务").dataset.tabColor).toBe("teal");
    expect(screen.getByTitle("/p/a.ts").dataset.tabColor).toBe("red");
    expect(screen.getByTitle("/p/b.md").dataset.tabColor).toBe("sky");
  });

  it("文件标签右键能改色，挑色后菜单不关（可以连着试）", () => {
    const onPickColor = vi.fn();
    renderBar({ colors: { "file:/p/a.ts": "red" }, onPickColor });

    fireEvent.contextMenu(screen.getByTitle("/p/a.ts"));
    expect(screen.getByText("标签颜色")).toBeTruthy();
    // 当前色带选中标记
    expect(screen.getAllByLabelText("red")[0].dataset.selected).toBe("true");

    fireEvent.click(screen.getByLabelText("teal"));
    expect(onPickColor).toHaveBeenCalledWith("file:/p/a.ts", "teal");
    // 菜单还在
    expect(screen.getByText("标签颜色")).toBeTruthy();
  });

  it("没有会话可显示时只渲染文件标签", () => {
    renderBar({ sessionLabel: null, activeKey: fileTabKey("/p/a.ts") });
    expect(screen.queryByTitle("跑个任务")).toBeNull();
    expect(screen.getByTitle("/p/a.ts")).toBeTruthy();
  });

  it("markdown 开关只在当前文件是 markdown 时出现，点了回调", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <MainTabBar
          sessionLabel="跑个任务"
          files={[{ path: "/p/a.ts", name: "a.ts" }]}
          activeKey={fileTabKey("/p/a.ts")}
          onSelectSession={vi.fn()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          onCloseOtherFiles={vi.fn()}
          onCloseFilesToRight={vi.fn()}
          onCloseFilesToLeft={vi.fn()}
          onCloseAllFiles={vi.fn()}
          diffLabel={null}
          onCloseDiff={vi.fn()}
          markdown={null}
          colors={{}}
          sessionColorKey={null}
          onPickColor={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText("编辑")).toBeNull();

    rerender(
      <I18nProvider>
        <MainTabBar
          sessionLabel="跑个任务"
          files={[{ path: "/p/b.md", name: "b.md" }]}
          activeKey={fileTabKey("/p/b.md")}
          onSelectSession={vi.fn()}
          onSelectFile={vi.fn()}
          onCloseFile={vi.fn()}
          onCloseOtherFiles={vi.fn()}
          onCloseFilesToRight={vi.fn()}
          onCloseFilesToLeft={vi.fn()}
          onCloseAllFiles={vi.fn()}
          diffLabel={null}
          onCloseDiff={vi.fn()}
          markdown={{ previewOn: true, onToggle }}
          colors={{}}
          sessionColorKey={null}
          onPickColor={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText("编辑"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
