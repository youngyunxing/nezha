import { useState } from "react";
import type React from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import { agentLabel, type LocalClaudeSession, type Task } from "../../types";

function formatDeletedTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 任务列表里「历史」分组的一行：被删掉的任务。
 *
 * 删除只是打了 `deleted` 标记 —— 名字、状态、会话 id、worktree 信息、终端屏幕记录
 * **全都还在磁盘上**，所以这一行能把名字原样显示出来，恢复就是把标记抹掉。
 *
 * 点开**不恢复**（恢复只在右键菜单里）：有会话的点开 = 预览（和本地会话一致）；
 * 纯终端任务点开 = 选中它，主区域显示上次那块屏幕。
 * 时间显示的是删除时间（`softDeleteTasks` 会把 `updatedAt` 刷成那一刻）。
 */
export function DeletedTaskRow({
  task,
  session,
  selected,
  onClick,
  onContextMenu,
}: {
  task: Task;
  /** 能预览时给的「本地会话」形状（预览走同一套 LocalSessionView）；纯终端任务没有 */
  session: LocalClaudeSession | null;
  selected: boolean;
  /** 有会话的点开 = 预览；纯终端任务点开 = 选中（主区域显示上次那块屏幕），不恢复 */
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const title = task.name ?? task.prompt;
  // 有会话的能点开预览（和本地会话一致）；纯终端任务没有会话文件，点开是选中它、
  // 看主区域里那块上次屏幕 —— 两种都不恢复，恢复只在右键菜单
  const previewable = session !== null;
  const Row = "button" as const;

  return (
    <Row
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={previewable ? `${title}（点开预览）` : `${title}（点开看上次屏幕）`}
      style={{
        ...s.taskCard,
        width: "100%",
        border: "none",
        textAlign: "left" as const,
        fontFamily: "var(--font-ui)",
        boxSizing: "border-box" as const,
        cursor: "pointer",
        // 观感跟「本地会话」那一组对齐（用户口径：字体颜色和本地会话一致）——
        // 以前压暗 0.6，看起来像禁用项，和本地会话行不是一套
        background: selected
          ? "var(--bg-selected)"
          : hovered
            ? "var(--bg-hover)"
            : "transparent",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <Trash2 size={13} strokeWidth={2} color="var(--text-hint)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.taskCardTitle}>{title}</div>
        <div style={s.taskCardSub}>
          {agentLabel(task.agent)} · {formatDeletedTime(task.updatedAt ?? task.createdAt)} ·{" "}
          {t("task.restore")}
        </div>
      </div>
    </Row>
  );
}
