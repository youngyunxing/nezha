import { RotateCcw } from "lucide-react";
import { SessionView } from "./SessionView";
import { useI18n } from "../i18n";
import s from "../styles";
import type { LocalClaudeSession, ThemeVariant } from "../types";

function formatSessionTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 查看本机 Claude Code 留下的一条会话：上半是它的元信息与「恢复」入口，
 * 下半复用任务的会话回放组件（同一份 JSONL 解析）。
 */
export function LocalSessionView({
  session,
  themeVariant,
  onResume,
}: {
  session: LocalClaudeSession;
  themeVariant: ThemeVariant;
  onResume: () => void;
}) {
  const { t } = useI18n();

  return (
    <div style={s.localSessionView}>
      <div style={s.localSessionHeader}>
        <span style={s.localSessionBadge}>{t("localSession.badge")}</span>
        <span style={s.localSessionPreview}>
          {session.preview || t("localSession.noPreview")}
        </span>
        <span style={s.localSessionTime}>{formatSessionTime(session.updatedAt)}</span>
        {/* 与 Nezha 任务的「恢复」按钮同一套样式/图标，避免两处语义相同、长相不同 */}
        <button type="button" onClick={onResume} style={s.interruptedPrimaryBtn}>
          <RotateCcw size={12} strokeWidth={2.1} />
          <span>{t("localSession.resume")}</span>
        </button>
      </div>
      <SessionView sessionPath={session.sessionPath} themeVariant={themeVariant} />
    </div>
  );
}
