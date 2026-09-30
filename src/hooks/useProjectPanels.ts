import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { ProjectAvatarColor } from "../types";
import {
  fileTabKey,
  loadTabColorOverrides,
  resolveTabColors,
  saveTabColorOverrides,
} from "../mainTabs";

type RightPanel = "files" | "git-changes" | "git-history" | null;
type OpenFileTab = { path: string; name: string };

/** 主区域当前显示哪一类内容。
 *  file 态下具体是哪个文件由 activeFilePath 决定 —— 最后一个文件标签关掉时它会变 null，
 *  视图自动落回会话，不需要在关标签的地方再同步一次状态。
 *  diff 不进这里：openDiff 非空就是覆盖层，关掉后自然露出下面原本这个视图。 */
export type MainView = "session" | "file";

type OpenDiff =
  | { kind: "file"; filePath: string; staged: boolean; label: string }
  | { kind: "commit"; hash: string; message: string }
  | { kind: "commit-file"; hash: string; filePath: string; label: string };

export function useProjectPanels(options?: {
  /** 会话标签的配色键（按任务记，见 mainTabs.ts）；没有选中任务时传 null。 */
  sessionColorKey?: string | null;
}) {
  const sessionColorKey = options?.sessionColorKey ?? null;
  // 默认展开文件浏览器；点同一图标可收起，点其他图标切到对应面板。
  const [rightPanel, setRightPanel] = useState<RightPanel>("files");
  const [openFilesState, setOpenFilesState] = useState<{
    tabs: OpenFileTab[];
    activePath: string | null;
  }>({
    tabs: [],
    activePath: null,
  });
  const [openDiff, setOpenDiff] = useState<OpenDiff | null>(null);
  const [mainView, setMainView] = useState<MainView>("session");
  // 每个文件自己的 markdown 预览开关（缺省按文件类型走：md 默认预览）。
  const [previewModes, setPreviewModes] = useState<Record<string, boolean>>({});
  // 标签颜色：只存用户手挑过的，自动配色按 key 现算（见 mainTabs.ts）
  const [colorOverrides, setColorOverrides] =
    useState<Record<string, ProjectAvatarColor>>(loadTabColorOverrides);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;

  const handleTogglePanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  /** 打开文件 = 在会话标签右边追加一个标签并切过去；已有会话不会被顶掉。 */
  const handleFileSelect = useCallback((path: string, name: string) => {
    setOpenDiff(null);
    setMainView("file");
    setOpenFilesState((prev) => ({
      tabs: prev.tabs.some((tab) => tab.path === path) ? prev.tabs : [...prev.tabs, { path, name }],
      activePath: path,
    }));
  }, []);

  const handleFileTabSelect = useCallback((path: string) => {
    setOpenDiff(null);
    setMainView("file");
    setOpenFilesState((prev) =>
      prev.tabs.some((tab) => tab.path === path) ? { tabs: prev.tabs, activePath: path } : prev,
    );
  }, []);

  /** 回到会话标签（文件标签保留，随时能切回来）。 */
  const showSessionView = useCallback(() => {
    setOpenDiff(null);
    setMainView("session");
  }, []);

  const togglePreviewMode = useCallback((path: string) => {
    setPreviewModes((prev) => ({ ...prev, [path]: !(prev[path] ?? true) }));
  }, []);

  const handleFileTabClose = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const closingIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (closingIndex === -1) return prev;

      const nextTabs = prev.tabs.filter((tab) => tab.path !== path);
      const nextActivePath =
        prev.activePath !== path
          ? prev.activePath
          : nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.path ?? null;

      return {
        tabs: nextTabs,
        activePath: nextActivePath,
      };
    });
  }, []);

  const handleCloseOtherFileTabs = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeTab = prev.tabs.find((tab) => tab.path === path);
      if (!activeTab) return prev;
      return {
        tabs: [activeTab],
        activePath: activeTab.path,
      };
    });
  }, []);

  const handleCloseTabsToRight = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (activeIndex === -1) return prev;

      const nextTabs = prev.tabs.slice(0, activeIndex + 1);
      return {
        tabs: nextTabs,
        activePath: nextTabs.some((tab) => tab.path === prev.activePath) ? prev.activePath : path,
      };
    });
  }, []);

  const handleCloseTabsToLeft = useCallback((path: string) => {
    setOpenFilesState((prev) => {
      const activeIndex = prev.tabs.findIndex((tab) => tab.path === path);
      if (activeIndex <= 0) return prev;

      const nextTabs = prev.tabs.slice(activeIndex);
      return {
        tabs: nextTabs,
        activePath: nextTabs.some((tab) => tab.path === prev.activePath) ? prev.activePath : path,
      };
    });
  }, []);

  const handleCloseAllFileTabs = useCallback(() => {
    setOpenFilesState({
      tabs: [],
      activePath: null,
    });
  }, []);

  // diff 是覆盖层：打开时不改 mainView，关掉后露出的还是原来那个文件（或会话）。
  const handleDiffFileSelect = useCallback((filePath: string, staged: boolean, label: string) => {
    setOpenDiff({ kind: "file", filePath, staged, label });
  }, []);

  const handleCommitSelect = useCallback((hash: string, message: string) => {
    setOpenDiff({ kind: "commit", hash, message });
  }, []);

  const handleCommitFileClick = useCallback((hash: string, filePath: string, label: string) => {
    setOpenDiff({ kind: "commit-file", hash, filePath, label });
  }, []);

  const setTabColor = useCallback((key: string, color: ProjectAvatarColor) => {
    setColorOverrides((prev) => ({ ...prev, [key]: color }));
  }, []);

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(600, startWidth + (startX - ev.clientX)));
      setRightPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // 手挑的颜色落盘（颜色是显示偏好，写盘失败不影响使用）
  useEffect(() => {
    saveTabColorOverrides(colorOverrides);
  }, [colorOverrides]);

  const colorKeys = useMemo(() => {
    const keys: string[] = [];
    if (sessionColorKey) keys.push(sessionColorKey);
    for (const tab of openFilesState.tabs) keys.push(fileTabKey(tab.path));
    if (openDiff) keys.push("diff");
    return keys;
  }, [sessionColorKey, openFilesState.tabs, openDiff]);
  const tabColors = useMemo(
    () => resolveTabColors(colorKeys, colorOverrides),
    [colorKeys, colorOverrides],
  );

  const activeFilePath = openFilesState.activePath;
  /** 主区域是不是正在显示文件（session 态下显示的是会话 / 终端）。
   *  带一次「标签还在不在」的校验：文件态下必须真有那个标签，否则落回会话。 */
  const showingFile =
    mainView === "file" &&
    activeFilePath !== null &&
    openFilesState.tabs.some((tab) => tab.path === activeFilePath);

  return {
    rightPanel,
    openFiles: openFilesState.tabs,
    activeFilePath,
    openDiff,
    mainView,
    showingFile,
    previewModes,
    tabColors,
    setTabColor,
    rightPanelWidth,
    setOpenDiff,
    handleTogglePanel,
    handleFileSelect,
    handleFileTabSelect,
    handleFileTabClose,
    handleCloseOtherFileTabs,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFileTabs,
    handleDiffFileSelect,
    handleCommitSelect,
    handleCommitFileClick,
    showSessionView,
    togglePreviewMode,
    handleRightResizeStart,
  };
}

export type { RightPanel, OpenDiff, OpenFileTab };
