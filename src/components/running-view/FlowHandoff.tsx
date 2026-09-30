import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { AgentType } from "../../types";
import { SelectField } from "../new-task/NewTaskDialog";
import claudeLogo from "../../assets/claude.svg";
import chatgptLogo from "../../assets/chatgpt.svg";

export type HandoffContextMode = "compress" | "recent" | "all";

export interface HandoffOptions {
  agent: AgentType;
  /** 上下文怎么带：压缩摘要（默认）/ 原样最近 N 条 / 原样全部 */
  contextMode: HandoffContextMode;
  /** contextMode="recent" 时的条数 */
  contextCount?: number;
  note: string;
}

const DEFAULT_CONTEXT = 20;

/**
 * 流转：把当前会话的上下文交给另一个 agent 接着做（比如 Claude Code → Codex）。
 * 跨 agent 没法「恢复」对方的会话记录，所以是把上下文原样写进新任务的提示词里。
 */
export function FlowHandoff({
  open,
  sourceLabel,
  defaultTarget,
  onOpenChange,
  onHandoff,
}: {
  open: boolean;
  sourceLabel: string;
  /** 默认交给另一个 agent（Claude 转 Codex、Codex 转 Claude） */
  defaultTarget: AgentType;
  onOpenChange: (open: boolean) => void;
  /** 返回 true 表示交接完成（弹窗关闭），false 表示失败（保持打开） */
  onHandoff: (options: HandoffOptions) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<AgentType>(defaultTarget);
  const [contextMode, setContextMode] = useState<HandoffContextMode>("compress");
  const [count, setCount] = useState(String(DEFAULT_CONTEXT));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // 打开时把默认目标重置为「另一个 agent」
  const [loadedOpen, setLoadedOpen] = useState(false);
  if (open !== loadedOpen) {
    setLoadedOpen(open);
    if (open) setAgent(defaultTarget);
  }

  const parsedCount = Number.parseInt(count, 10);
  const validCount =
    contextMode !== "recent" || (Number.isFinite(parsedCount) && parsedCount > 0);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <div style={s.forkDialogHeading}>
              <span style={s.forkDialogIcon}>
                <ArrowRightLeft size={16} strokeWidth={2.1} />
              </span>
              <Dialog.Title style={s.forkDialogTitle}>{t("handoff.title")}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {t("handoff.description", { source: sourceLabel })}
          </Dialog.Description>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel}>{t("handoff.target")}</label>
            <SelectField
              value={agent}
              label={t("handoff.target")}
              options={[
                {
                  value: "claude",
                  label: "Claude Code",
                  icon: <img src={claudeLogo} style={{ width: 13, height: 13 }} />,
                },
                {
                  value: "codex",
                  label: "Codex",
                  icon: <img src={chatgptLogo} style={{ width: 13, height: 13 }} />,
                },
              ]}
              onChange={(value) => setAgent(value as AgentType)}
            />
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel}>{t("handoff.context")}</label>
            <div style={s.handoffContextRow}>
              <button
                type="button"
                style={contextMode === "compress" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setContextMode("compress")}
              >
                {t("handoff.contextCompress")}
              </button>
              <button
                type="button"
                style={contextMode === "all" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setContextMode("all")}
              >
                {t("handoff.contextAll")}
              </button>
              <button
                type="button"
                style={contextMode === "recent" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setContextMode("recent")}
              >
                {t("handoff.contextRecent")}
              </button>
              {contextMode === "recent" && (
                <>
                  <input
                    style={s.copySessionCountInput}
                    value={count}
                    inputMode="numeric"
                    onChange={(event) => setCount(event.target.value.replace(/[^\d]/g, ""))}
                  />
                  <span style={s.copySessionRecentLabel}>{t("copySession.recentSuffix")}</span>
                </>
              )}
            </div>
            <span style={s.newTaskDialogHint}>
              {contextMode === "compress" ? t("handoff.compressHint") : t("handoff.contextHint")}
            </span>
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel} htmlFor="handoff-note">
              {t("handoff.note")}
            </label>
            <input
              id="handoff-note"
              style={s.forkDialogInput}
              value={note}
              maxLength={300}
              placeholder={t("handoff.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div style={s.forkDialogActions}>
            <Dialog.Close asChild>
              <button type="button" style={s.forkDialogCancelBtn}>
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              style={busy || !validCount ? s.forkDialogPrimaryBtnDisabled : s.forkDialogPrimaryBtn}
              disabled={busy || !validCount}
              onClick={() => {
                if (busy || !validCount) return;
                setBusy(true);
                void onHandoff({
                  agent,
                  contextMode,
                  contextCount: contextMode === "recent" ? parsedCount : undefined,
                  note,
                }).then((ok) => {
                  setBusy(false);
                  if (ok) onOpenChange(false);
                });
              }}
            >
              {busy && contextMode === "compress" ? t("handoff.compressing") : t("handoff.confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
