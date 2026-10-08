import type { ProjectAvatarColor, Task } from "../../types";
import { useI18n } from "../../i18n";
import { ContextMenu } from "../ContextMenu";
import { TabColorPicker } from "../main-tabs/TabColorPicker";

/** 右键点在哪条任务上（坐标 + 那条任务）。 */
export type TaskContextMenuState = { x: number; y: number; task: Task };

/** 任务列表的右键菜单：重命名 / 收藏 / 删除。
 *  行内那对「收藏、删除」小按钮已删掉 —— 悬停才出现的小图标既难点中也容易误触。
 *  菜单本体（遮罩、贴光标、夹进视口）走公共的 `ContextMenu`。 */
export function TaskContextMenu({
  ctxMenu,
  onClose,
  onRename,
  onToggleStar,
  onDelete,
  colorPicker,
}: {
  ctxMenu: TaskContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  /** 会话标签右键时才给：改这个标签的颜色（任务列表里的右键不需要） */
  colorPicker?: { current: ProjectAvatarColor | null; onPick: (color: ProjectAvatarColor) => void };
}) {
  const { t } = useI18n();

  return (
    <ContextMenu
      anchor={ctxMenu}
      onClose={onClose}
      narrow
      items={[
        { label: t("task.renameTask"), onSelect: onRename },
        {
          label: ctxMenu.task.starred ? t("task.unstar") : t("task.star"),
          onSelect: onToggleStar,
        },
        { label: t("task.deleteTask"), onSelect: onDelete, destructive: true },
      ]}
      footer={colorPicker && <TabColorPicker current={colorPicker.current} onPick={colorPicker.onPick} />}
    />
  );
}
