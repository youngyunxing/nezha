import { memo, useEffect, useState } from "react";
import type React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Palette, Pin, PinOff, Trash2 } from "lucide-react";
import type { Project, ProjectAvatarStyle } from "../../types";
import { ProjectAvatar } from "../ProjectAvatar";
import { ProjectAppearanceEditor } from "./ProjectAppearanceEditor";
import { useI18n } from "../../i18n";
import claudeWaveGif from "../../assets/gif/claude-wave.gif";
import type { ProjectStatus } from "./activity";

/** rail 项上挂着的弹层:右键菜单,或从菜单进入的外观编辑器。同一时刻只有一个项打开。 */
export type RailItemPanel = "menu" | "appearance";

// 项目状态指示:启用角标且存在待确认任务时显示数量角标,否则回退为小圆点。
export function AttentionIndicator({
  status,
  count,
  showBadge,
}: {
  status: ProjectStatus;
  count: number;
  showBadge: boolean;
}) {
  if (!status) return null;
  const isAttention = status === "attention";
  if (showBadge && isAttention && count > 0) {
    return <span className="rail-attention-badge">{count > 99 ? "99+" : count}</span>;
  }
  return <span className="rail-status-dot" data-status={isAttention ? "attention" : "running"} />;
}

export const RailItem = memo(function RailItem({
  project,
  isActive,
  status,
  attentionCount,
  showBadge,
  waveNonce,
  isDragging,
  translateY,
  panel,
  menuEnabled,
  onPointerDown,
  onClick,
  onPanelChange,
  onToggleHidden,
  onUpdateAvatar,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  status: ProjectStatus;
  attentionCount: number;
  showBadge: boolean;
  waveNonce: number;
  isDragging: boolean;
  translateY: number;
  panel: RailItemPanel | null;
  menuEnabled: boolean;
  onPointerDown: (project: Project, event: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (project: Project) => void;
  onPanelChange: (projectId: string, panel: RailItemPanel | null) => void;
  onToggleHidden: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onUpdateAvatar: (projectId: string, avatar: ProjectAvatarStyle | undefined) => void;
}) {
  const { t } = useI18n();
  const [waving, setWaving] = useState(false);
  // waveNonce 每次递增(出现新的待确认任务)就触发一次性招手,3.6s 后卸载。
  // 卸载+重新挂载可让 gif 从首帧重播,同时重启 CSS 探头/缩回动画。
  useEffect(() => {
    if (waveNonce <= 0) return;
    setWaving(true);
    const id = setTimeout(() => setWaving(false), 3600);
    return () => clearTimeout(id);
  }, [waveNonce]);

  // 让位位移是拖拽期间的高频动态值,通过 CSS 变量注入,其余样式见 project-rail.css。
  const dynamicVars = { "--rail-item-dy": `${translateY}px` } as React.CSSProperties;

  const hiddenLabel = project.hiddenFromRail ? t("welcome.pinToRail") : t("welcome.unpinFromRail");

  return (
    <Popover.Root
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onPanelChange(project.id, null);
      }}
    >
      <Popover.Anchor asChild>
        <button
          data-rail-id={project.id}
          aria-label={project.name}
          className="rail-item rail-drawer-item rail-indicator-host"
          data-surface="panel"
          data-active={isActive}
          data-dragging={isDragging}
          data-moving={translateY !== 0}
          data-panel-open={panel !== null}
          style={dynamicVars}
          onClick={() => onClick(project)}
          onPointerDown={(event) => onPointerDown(project, event)}
          onContextMenu={(event) => {
            if (!menuEnabled) return;
            event.preventDefault();
            onPanelChange(project.id, "menu");
          }}
        >
          <div className="rail-drawer-item-avatar rail-indicator-host" data-surface="panel">
            {waving && (
              <img key={waveNonce} src={claudeWaveGif} alt="" className="rail-item-mascot" />
            )}
            <ProjectAvatar project={project} size={28} />
            <AttentionIndicator status={status} count={attentionCount} showBadge={showBadge} />
          </div>
          <span className="rail-drawer-item-name">{project.name}</span>
          {project.hiddenFromRail && (
            <PinOff size={12} strokeWidth={2} className="rail-drawer-item-hidden" />
          )}
        </button>
      </Popover.Anchor>

      {panel && (
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={8}
            className={
              panel === "menu" ? "rail-popover rail-menu" : "rail-popover avatar-editor-popover"
            }
            role={panel === "menu" ? "menu" : undefined}
          >
            {panel === "menu" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="rail-menu-item"
                  onClick={() => onPanelChange(project.id, "appearance")}
                >
                  <Palette size={13} strokeWidth={2} />
                  <span>{t("project.appearance")}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="rail-menu-item"
                  onClick={() => {
                    onPanelChange(project.id, null);
                    onToggleHidden(project.id);
                  }}
                >
                  {project.hiddenFromRail ? (
                    <Pin size={13} strokeWidth={2} />
                  ) : (
                    <PinOff size={13} strokeWidth={2} />
                  )}
                  <span>{hiddenLabel}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="rail-menu-item"
                  onClick={() => {
                    onPanelChange(project.id, null);
                    onDelete(project.id);
                  }}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  <span>{t("welcome.deleteProject")}</span>
                </button>
              </>
            ) : (
              <ProjectAppearanceEditor
                project={project}
                onChange={(avatar) => onUpdateAvatar(project.id, avatar)}
              />
            )}
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
});
