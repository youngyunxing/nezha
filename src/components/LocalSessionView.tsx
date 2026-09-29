import { Play } from "lucide-react";
import { SessionView } from "./SessionView";
import { useI18n } from "../i18n";
import s from "../styles";
import type { LocalClaudeSession } from "../types";

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
  onResume,
}: {
  session: LocalClaudeSession;
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
        <button type="button" onClick={onResume} style={s.localSessionResumeBtn}>
          <Play size={13} strokeWidth={2} fill="currentColor" />
          {t("localSession.resume")}
        </button>
      </div>
      <SessionView sessionPath={session.sessionPath} />
    </div>
  );
}
