import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Task } from "../../types";
import { useI18n } from "../../i18n";
import s from "../../styles";

/** 右键点在哪条任务上（坐标 + 那条任务）。 */
export type TaskContextMenuState = { x: number; y: number; task: Task };

const VIEWPORT_MARGIN = 8;

/** 任务列表的右键菜单：重命名 / 收藏 / 删除。
 *  行内那对「收藏、删除」小按钮已删掉 —— 悬停才出现的小图标既难点中也容易误触。 */
export function TaskContextMenu({
  ctxMenu,
  onClose,
  onRename,
  onToggleStar,
  onDelete,
}: {
  ctxMenu: TaskContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: ctxMenu.x, y: ctxMenu.y });

  // 夹进视口：菜单贴着屏幕右/下边缘时右键会弹到窗口外面去。
  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const maxX = Math.max(VIEWPORT_MARGIN, viewportWidth - rect.width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, viewportHeight - rect.height - VIEWPORT_MARGIN);

    setPosition({
      x: Math.min(Math.max(ctxMenu.x, VIEWPORT_MARGIN), maxX),
      y: Math.min(Math.max(ctxMenu.y, VIEWPORT_MARGIN), maxY),
    });
  }, [ctxMenu.x, ctxMenu.y]);

  useLayoutEffect(() => {
    setPosition({ x: ctxMenu.x, y: ctxMenu.y });
    updatePosition();
  }, [ctxMenu.x, ctxMenu.y, updatePosition]);

  useLayoutEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  const items = [
    { label: t("task.renameTask"), onSelect: onRename, destructive: false },
    {
      label: ctxMenu.task.starred ? t("task.unstar") : t("task.star"),
      onSelect: onToggleStar,
      destructive: false,
    },
    { label: t("task.deleteTask"), onSelect: onDelete, destructive: true },
  ];

  return (
    <>
      <div
        style={s.ctxMenuBackdrop}
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        style={{ ...s.ctxMenu, left: position.x, top: position.y }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => {
          const baseColor = item.destructive
            ? "var(--danger-action-bg, #d23f3f)"
            : "var(--text-primary)";
          return (
            <button
              type="button"
              key={item.label}
              style={{ ...s.ctxMenuItem, color: baseColor }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = item.destructive
                  ? "var(--danger-action-bg, #d23f3f)"
                  : "var(--accent)";
                e.currentTarget.style.color = item.destructive
                  ? "var(--danger-action-fg, #ffffff)"
                  : "var(--fg-on-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = baseColor;
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
