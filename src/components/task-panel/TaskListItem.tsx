import { useEffect, useRef, useState, memo } from "react";
import type React from "react";
import { GitBranch, Moon, Terminal } from "lucide-react";
import type { Task } from "../../types";
import { StatusIcon } from "../StatusIcon";
import { useI18n } from "../../i18n";
import s from "../../styles";
import claudeLogo from "../../assets/claude.svg";
import chatgptLogo from "../../assets/chatgpt.svg";

function statusLabelKey(status: Task["status"], agent: Task["agent"], alive = false): string {
  switch (status) {
    case "pending":
      return "status.pending";
    case "running":
      return "status.running";
    case "idle":
      // 纯终端只是「开着」，不是「在干活」
      return agent === "shell" ? "status.idleShell" : "status.idle";
    case "input_required":
      return "status.inputRequired";
    case "awaiting_review":
      return "status.awaitingReview";
    case "interrupted":
      return alive ? "status.interruptedAlive" : "status.interrupted";
    case "done":
      return "status.done";
    case "failed":
      return "status.failed";
    case "cancelled":
      return "status.cancelled";
  }
}

/** 悬停解释：这个状态是什么意思、我需要做什么。不常见的状态不给解释。 */
function statusHintKey(status: Task["status"], agent: Task["agent"]): string | undefined {
  switch (status) {
    case "pending":
      return "status.hint.pending";
    case "running":
      return "status.hint.running";
    case "idle":
      return agent === "shell" ? "status.hint.idleShell" : "status.hint.idle";
    case "input_required":
      return "status.hint.inputRequired";
    case "awaiting_review":
      return "status.hint.awaitingReview";
    default:
      return undefined;
  }
}

export const TaskListItem = memo(
  function TaskListItem({
    task,
    selected,
    onClick,
    onContextMenu,
    renaming,
    onRenameSubmit,
    onRenameCancel,
  }: {
    task: Task;
    selected: boolean;
    onClick: () => void;
    /** 右键：重命名 / 收藏 / 删除（收藏与删除原来挂在行内悬停按钮上，已删） */
    onContextMenu: (event: React.MouseEvent) => void;
    renaming: boolean;
    onRenameSubmit: (name: string) => void;
    onRenameCancel: () => void;
  }) {
    const { t } = useI18n();
    const [hov, setHov] = useState(false);
    // Enter / Esc 已经处理过一次后，紧接着的 blur 不要再提交一遍。每次进入改名态重置，
    // 否则同一条任务第二次改名时（组件实例还留着）会被上次的 true 挡掉 blur 提交。
    const renameDoneRef = useRef(false);
    useEffect(() => {
      if (renaming) renameDoneRef.current = false;
    }, [renaming]);
    const displayTitle = task.name ?? task.prompt;
    const hintKey = statusHintKey(task.status, task.agent);

    const submitRename = (value: string) => {
      if (renameDoneRef.current) return;
      renameDoneRef.current = true;
      onRenameSubmit(value.trim());
    };

    return (
      <div
        style={{
          ...s.taskCard,
          position: "relative",
          background: selected ? "var(--bg-selected)" : hov ? "var(--bg-hover)" : "transparent",
        }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          <StatusIcon status={task.status} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <input
              style={s.taskItemRenameInput}
              defaultValue={task.name ?? ""}
              placeholder={task.prompt.slice(0, 60)}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRename(event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  renameDoneRef.current = true;
                  onRenameCancel();
                }
              }}
              onBlur={(event) => submitRename(event.target.value)}
            />
          ) : (
            <div style={s.taskCardTitle}>
              {displayTitle.slice(0, 70)}
              {displayTitle.length > 70 ? "…" : ""}
            </div>
          )}
          <div style={s.taskCardSub} title={hintKey ? t(hintKey) : undefined}>
            {t(statusLabelKey(task.status, task.agent, task.processAlive))}
            {task.status === "done" &&
              task.worktreePath &&
              task.baseBranch &&
              task.additions !== undefined &&
              task.deletions !== undefined && (
                <span style={s.taskDiffStats}>
                  <span style={s.taskDiffAdditions}>+{task.additions}</span>
                  <span style={s.taskDiffDeletions}>−{task.deletions}</span>
                </span>
              )}
          </div>
        </div>
        <span
          title={
            task.agent === "shell"
              ? task.command
                ? `${t("terminal.title")} · ${task.command}`
                : t("terminal.title")
              : task.agent === "claude"
                ? "Claude Code"
                : task.agent === "kimi"
                  ? "Kimi"
                  : "Codex"
          }
          style={{
            ...s.agentBadge,
            position: "absolute",
            right: 16,
            top: 11,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {task.agent === "shell" ? (
            <Terminal size={13} strokeWidth={2} color="var(--text-muted)" />
          ) : task.agent === "kimi" ? (
            <Moon size={13} strokeWidth={2} color="var(--text-muted)" />
          ) : (
            <img
              src={task.agent === "claude" ? claudeLogo : chatgptLogo}
              style={{
                width: 14,
                height: 14,
                filter: task.agent === "codex" ? "var(--agent-badge-filter)" : "none",
              }}
            />
          )}
        </span>
        {task.worktreePath && task.worktreeBranch && (
          <span title={t("task.worktreeBadge", { branch: task.worktreeBranch })} style={s.worktreeBadge}>
            <GitBranch size={11} strokeWidth={2.2} />
          </span>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.task === next.task &&
    prev.selected === next.selected &&
    prev.renaming === next.renaming,
);
