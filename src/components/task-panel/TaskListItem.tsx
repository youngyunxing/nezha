import { useState, memo } from "react";
import { Trash2, Star, GitBranch, Moon, Terminal } from "lucide-react";
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
    onDelete,
    onToggleStar,
  }: {
    task: Task;
    selected: boolean;
    onClick: () => void;
    onDelete: () => void;
    onToggleStar: () => void;
  }) {
    const { t } = useI18n();
    const [hov, setHov] = useState(false);
    const displayTitle = task.name ?? task.prompt;
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
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          <StatusIcon status={task.status} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.taskCardTitle}>
            {displayTitle.slice(0, 70)}
            {displayTitle.length > 70 ? "…" : ""}
          </div>
          <div
            style={s.taskCardSub}
            title={statusHintKey(task.status, task.agent) ? t(statusHintKey(task.status, task.agent)!) : undefined}
          >
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
            opacity: hov ? 0 : 1,
            pointerEvents: "none",
            transition: "opacity 0.12s ease",
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
          <span
            title={t("task.worktreeBadge", { branch: task.worktreeBranch })}
            style={{ ...s.worktreeBadge, opacity: hov ? 0 : 1 }}
          >
            <GitBranch size={11} strokeWidth={2.2} />
          </span>
        )}
        <button
          type="button"
          aria-label={task.starred ? t("task.unstar") : t("task.star")}
          title={task.starred ? t("task.unstar") : t("task.star")}
          style={{
            ...s.taskStarBtn,
            opacity: task.starred ? 1 : hov ? 0.7 : 0,
            pointerEvents: task.starred || hov ? "auto" : "none",
            color: task.starred ? "var(--star-fg)" : "var(--text-hint)",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
        >
          <Star size={12} strokeWidth={2.2} fill={task.starred ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          aria-label={t("task.deleteTask")}
          title={t("task.deleteTask")}
          style={{
            ...s.taskDeleteBtn,
            opacity: hov ? 1 : 0,
            pointerEvents: hov ? "auto" : "none",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={12} strokeWidth={2.2} />
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.task === next.task &&
    prev.selected === next.selected,
);
