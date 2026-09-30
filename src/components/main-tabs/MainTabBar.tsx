import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Eye, FileDiff, MoreHorizontal, PencilLine, SquareTerminal, X } from "lucide-react";
import type { OpenFileTab } from "../../hooks/useProjectPanels";
import { getFileColor } from "../../utils";
import { useI18n } from "../../i18n";
import s from "../../styles";

/** 主区域标签的标识：会话 / 某个文件 / 当前打开的 diff。 */
export type MainTabKey = "session" | "diff" | `file:${string}`;

export function fileTabKey(path: string): MainTabKey {
  return `file:${path}`;
}

/** 主区域顶部的标签条：会话是一号标签，打开的文件挨着它往后排（不覆盖会话），
 *  git 的 diff 作为覆盖层也占一个标签。文件相关的右键 / ⋮ 菜单都收在这里。 */
export function MainTabBar({
  sessionLabel,
  files,
  activeKey,
  onSelectSession,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onCloseFilesToRight,
  onCloseFilesToLeft,
  onCloseAllFiles,
  diffLabel,
  onCloseDiff,
  markdown,
}: {
  /** null = 这个项目当前没有会话可显示（没任务、没本地会话），不渲染会话标签。 */
  sessionLabel: string | null;
  files: OpenFileTab[];
  activeKey: MainTabKey | null;
  onSelectSession: () => void;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onCloseOtherFiles: (path: string) => void;
  onCloseFilesToRight: (path: string) => void;
  onCloseFilesToLeft: (path: string) => void;
  onCloseAllFiles: () => void;
  diffLabel: string | null;
  onCloseDiff: () => void;
  /** 当前文件是 markdown 时，右侧给一个编辑 / 预览开关。 */
  markdown: { previewOn: boolean; onToggle: () => void } | null;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  // 右键菜单锚在光标处，作用对象是「被右键的那个标签」，不改变当前激活的标签
  //（跟编辑器一致：右键不切标签）。
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const [tabMenuPos, setTabMenuPos] = useState<{ left: number; top: number } | null>(null);

  // 用菜单量出来的真实尺寸把光标点夹进视口（宽度随文案长度变，不能硬编码）。
  // 在绘制前跑，所以看不到跳一下。
  useLayoutEffect(() => {
    if (!tabMenu) {
      setTabMenuPos(null);
      return;
    }
    const el = tabMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(tabMenu.x, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(tabMenu.y, window.innerHeight - rect.height - margin));
    setTabMenuPos({ left, top });
  }, [tabMenu]);

  useEffect(() => {
    if (!tabMenu) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && tabMenuRef.current?.contains(event.target)) return;
      setTabMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    const close = () => setTabMenu(null);
    // 捕获阶段：点任何地方（包括另一个标签）都先关掉菜单。
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [tabMenu]);

  const activeFilePath = activeKey?.startsWith("file:")
    ? activeKey.slice("file:".length)
    : null;
  const tabMenuIndex = tabMenu ? files.findIndex((tab) => tab.path === tabMenu.path) : -1;
  const hasFiles = files.length > 0;
  // ⋮ 菜单里的「关闭其他 / 左 / 右」要有作用对象：当前激活的文件标签；会话标签激活时它们不可用。
  const canTargetActive = activeFilePath !== null;

  return (
    <div style={s.mainTabBar}>
      <div className="main-tab-strip" style={s.mainTabStrip}>
        {sessionLabel !== null && (
          <TabButton
            active={activeKey === "session"}
            title={sessionLabel}
            onSelect={onSelectSession}
          >
            <SquareTerminal size={13} className="main-tab-icon" />
            <TabLabel>{sessionLabel}</TabLabel>
          </TabButton>
        )}

        {files.map((tab) => (
          <TabButton
            key={tab.path}
            active={activeKey === fileTabKey(tab.path)}
            title={tab.path}
            onSelect={() => onSelectFile(tab.path)}
            onContextMenu={(event) => {
              // 顶掉 webview 自带的右键菜单（重新加载 / 存储为 / 打印），换成标签操作。
              event.preventDefault();
              setMenuOpen(false);
              setTabMenuPos(null);
              setTabMenu({ x: event.clientX, y: event.clientY, path: tab.path });
            }}
            onClose={() => onCloseFile(tab.path)}
            closeLabel={t("file.closeTab", { name: tab.name })}
          >
            {/* 颜色跟着文件类型走，只能内联给值 */}
            <span style={{ ...s.mainTabDot, background: getFileColor(tab.name) }} />
            <TabLabel>{tab.name}</TabLabel>
          </TabButton>
        ))}

        {diffLabel !== null && (
          <TabButton
            active={activeKey === "diff"}
            title={diffLabel}
            onSelect={() => {}}
            onClose={onCloseDiff}
            closeLabel={t("file.closeTab", { name: diffLabel })}
          >
            <FileDiff size={13} className="main-tab-icon" />
            <TabLabel>{diffLabel}</TabLabel>
          </TabButton>
        )}
      </div>

      <div style={s.mainTabActions}>
        {markdown && (
          <button className="main-tab-preview-btn" onClick={markdown.onToggle}>
            {markdown.previewOn ? <PencilLine size={13} /> : <Eye size={13} />}
            {markdown.previewOn ? t("common.edit") : t("common.preview")}
          </button>
        )}
        {hasFiles && (
          <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Popover.Trigger asChild>
              <button
                className="main-tab-icon-btn"
                title={t("file.tabActions")}
                aria-label={t("file.tabActions")}
              >
                <MoreHorizontal size={15} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="end"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="file-viewer-tab-menu"
              >
                <MenuItem
                  disabled={!canTargetActive || files.length <= 1}
                  onClick={() => {
                    if (activeFilePath) onCloseOtherFiles(activeFilePath);
                    setMenuOpen(false);
                  }}
                >
                  {t("file.closeOtherTabs")}
                </MenuItem>
                <MenuItem
                  disabled={!canTargetActive}
                  onClick={() => {
                    if (activeFilePath) onCloseFilesToRight(activeFilePath);
                    setMenuOpen(false);
                  }}
                >
                  {t("file.closeTabsToRight")}
                </MenuItem>
                <MenuItem
                  disabled={!canTargetActive}
                  onClick={() => {
                    if (activeFilePath) onCloseFilesToLeft(activeFilePath);
                    setMenuOpen(false);
                  }}
                >
                  {t("file.closeTabsToLeft")}
                </MenuItem>
                <MenuItem
                  disabled={!hasFiles}
                  onClick={() => {
                    onCloseAllFiles();
                    setMenuOpen(false);
                  }}
                >
                  {t("file.closeAllTabs")}
                </MenuItem>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>

      {tabMenu && tabMenuIndex !== -1 && (
        <div
          ref={tabMenuRef}
          className="file-viewer-tab-menu"
          style={{
            ...s.mainTabContextMenu,
            // 第一帧（还没量到尺寸）先按光标放，useLayoutEffect 在绘制前换成夹住边界的坐标。
            left: tabMenuPos?.left ?? tabMenu.x,
            top: tabMenuPos?.top ?? tabMenu.y,
            visibility: tabMenuPos ? "visible" : "hidden",
          }}
        >
          <MenuItem
            onClick={() => {
              onCloseFile(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("file.closeThisTab")}
          </MenuItem>
          <MenuItem
            disabled={files.length <= 1}
            onClick={() => {
              onCloseOtherFiles(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("file.closeOtherTabs")}
          </MenuItem>
          <MenuItem
            disabled={tabMenuIndex >= files.length - 1}
            onClick={() => {
              onCloseFilesToRight(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("file.closeTabsToRight")}
          </MenuItem>
          <MenuItem
            disabled={tabMenuIndex <= 0}
            onClick={() => {
              onCloseFilesToLeft(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {t("file.closeTabsToLeft")}
          </MenuItem>
          <MenuItem
            disabled={!hasFiles}
            onClick={() => {
              onCloseAllFiles();
              setTabMenu(null);
            }}
          >
            {t("file.closeAllTabs")}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  title,
  onSelect,
  onContextMenu,
  onClose,
  closeLabel,
  children,
}: {
  active: boolean;
  title: string;
  onSelect: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onClose?: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className="main-tab"
      data-active={active ? "true" : "false"}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={title}
    >
      {children}
      {onClose && (
        <span
          className="main-tab-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          role="button"
          aria-label={closeLabel}
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}

function TabLabel({ children }: { children: React.ReactNode }) {
  return <span style={s.mainTabLabel}>{children}</span>;
}

function MenuItem({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="file-viewer-tab-menu-item"
    >
      {children}
    </button>
  );
}
