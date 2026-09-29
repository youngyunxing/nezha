import { useState } from "react";
import { History } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { LocalClaudeSession } from "../../types";

function formatSessionTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 任务列表里「本地 Claude Code 会话」分组的一行。刻意复用任务卡片的样式
 * （s.taskCard），高度与观感一致，但它不是 Nezha 任务：点开只是看记录，
 * 要接着聊得进详情再点「恢复」。
 */
export function LocalSessionRow({
  session,
  selected,
  onClick,
}: {
  session: LocalClaudeSession;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={session.preview || session.sessionId}
      style={{
        ...s.taskCard,
        width: "100%",
        border: "none",
        cursor: "pointer",
        textAlign: "left" as const,
        fontFamily: "var(--font-ui)",
        boxSizing: "border-box" as const,
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <History size={13} strokeWidth={2} color="var(--text-hint)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.taskCardTitle}>{session.preview || t("localSession.noPreview")}</div>
        <div style={s.taskCardSub}>{formatSessionTime(session.updatedAt)}</div>
      </div>
    </button>
  );
}
