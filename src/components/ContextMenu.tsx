import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { useI18n } from "../i18n";
import s from "../styles";

/** 菜单挂在哪：光标位置。 */
export type ContextMenuAnchor = { x: number; y: number };

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 破坏性动作：红字 + 悬停红底 */
  destructive?: boolean;
};

/**
 * 通用右键菜单：遮罩 + 贴着光标的浮层 + 夹进视口（按量出来的真实尺寸，不是猜的）。
 *
 * 抽出来的原因：任务列表、文件树、本地会话三处各有一份同构实现（issue #234 说的"无法复用"
 * 就是这个）。新入口一律用它；文件树那份还没迁（`file-explorer/ContextMenu.tsx`）。
 */
export function ContextMenu({
  anchor,
  onClose,
  items,
  footer,
  narrow,
}: {
  anchor: ContextMenuAnchor;
  onClose: () => void;
  items: ContextMenuItem[];
  /** 菜单底部的自定义内容（比如标签色板） */
  footer?: React.ReactNode;
  /** 条目短（两三个字）时用窄一点的面板 */
  narrow?: boolean;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });

  // 夹进视口：菜单贴着屏幕右/下边缘时右键会弹到窗口外面去。
  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const maxX = Math.max(margin, viewportWidth - rect.width - margin);
    const maxY = Math.max(margin, viewportHeight - rect.height - margin);
    setPosition({
      x: Math.min(Math.max(anchor.x, margin), maxX),
      y: Math.min(Math.max(anchor.y, margin), maxY),
    });
  }, [anchor.x, anchor.y]);

  useLayoutEffect(() => {
    setPosition({ x: anchor.x, y: anchor.y });
    updatePosition();
  }, [anchor.x, anchor.y, updatePosition]);

  useLayoutEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

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
        role="menu"
        aria-label={t("common.moreActions")}
        style={{ ...s.ctxMenu, ...(narrow ? s.taskCtxMenu : null), left: position.x, top: position.y }}
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
              disabled={item.disabled}
              style={{
                ...s.ctxMenuItem,
                color: item.disabled ? "var(--text-hint)" : baseColor,
              }}
              onMouseEnter={(e) => {
                if (item.disabled) return;
                e.currentTarget.style.background = item.destructive
                  ? "var(--danger-action-bg, #d23f3f)"
                  : "var(--accent)";
                e.currentTarget.style.color = item.destructive
                  ? "var(--danger-action-fg, #ffffff)"
                  : "var(--fg-on-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = item.disabled ? "var(--text-hint)" : baseColor;
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (item.disabled) return;
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          );
        })}
        {footer}
      </div>
    </>
  );
}
