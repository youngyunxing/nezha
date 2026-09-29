import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardCopy } from "lucide-react";
import { useI18n } from "../../i18n";
import { useToast } from "../Toast";
import { sessionMessagesToText, type CopyableMessage } from "../../sessionText";
import { writeClipboardText } from "../file-explorer/clipboard";
import s from "../../styles";

const DEFAULT_COUNT = 5;

/**
 * 「复制会话」：复制整个会话，或最近 N 条（N 自己填，1 就是最近一条）。
 * 读的就是回放用的那份会话文件，所以和你在会话记录里看到的内容一致。
 */
export function CopySession({
  sessionPath,
  assistantLabel,
}: {
  sessionPath: string;
  /** assistant 那一侧的署名，例如 Claude Code / Codex */
  assistantLabel: string;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [busy, setBusy] = useState(false);

  async function copy(lastN?: number) {
    if (busy) return;
    setBusy(true);
    try {
      const messages = await invoke<CopyableMessage[]>("read_session_messages", { sessionPath });
      const text = sessionMessagesToText(
        messages,
        lastN === undefined
          ? { assistantLabel, youLabel: t("copySession.you") }
          : { count: lastN, assistantLabel, youLabel: t("copySession.you") },
      );
      if (!text) {
        showToast(t("copySession.empty"), "warning");
        return;
      }
      await writeClipboardText(text);
      const copied = messages.filter((m) => m.content.some((c) => c.type === "text" && c.text)).length;
      showToast(
        lastN === undefined
          ? t("copySession.copiedAll", { count: copied })
          : t("copySession.copiedRecent", { count: Math.min(lastN, copied) }),
        "success",
      );
      setOpen(false);
    } catch (error) {
      showToast(t("copySession.failed", { error: String(error) }), "error");
    } finally {
      setBusy(false);
    }
  }

  const parsedCount = Number.parseInt(count, 10);
  const validCount = Number.isFinite(parsedCount) && parsedCount > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="quick-input-trigger"
          style={s.quickInputTrigger}
          title={t("copySession.button")}
        >
          <ClipboardCopy size={12} strokeWidth={2.3} />
          <span>{t("copySession.button")}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="file-viewer-tab-menu"
          style={s.copySessionMenu}
          side="top"
          align="end"
          sideOffset={6}
        >
          <button
            type="button"
            className="file-viewer-tab-menu-item"
            style={s.quickInputAddRow}
            disabled={busy}
            onClick={() => void copy()}
          >
            <span>{t("copySession.copyAll")}</span>
          </button>
          <div className="radix-select-separator" />
          <div style={s.copySessionRecentRow}>
            <span style={s.copySessionRecentLabel}>{t("copySession.recentPrefix")}</span>
            <input
              style={s.copySessionCountInput}
              value={count}
              inputMode="numeric"
              onChange={(event) => setCount(event.target.value.replace(/[^\d]/g, ""))}
            />
            <span style={s.copySessionRecentLabel}>{t("copySession.recentSuffix")}</span>
            <button
              type="button"
              style={{
                ...s.copySessionCopyBtn,
                opacity: busy || !validCount ? 0.5 : 1,
                cursor: busy || !validCount ? "not-allowed" : "pointer",
              }}
              disabled={busy || !validCount}
              onClick={() => void copy(parsedCount)}
            >
              {t("copySession.copy")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
