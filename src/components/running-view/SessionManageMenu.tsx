import { useState } from "react";
import type React from "react";
import * as Popover from "@radix-ui/react-popover";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRightLeft,
  ChevronLeft,
  ClipboardCopy,
  Download,
  GitFork,
  MoreHorizontal,
} from "lucide-react";
import { useI18n } from "../../i18n";
import { useToast } from "../Toast";
import { sessionMessagesToText, type CopyableMessage } from "../../sessionText";
import { writeClipboardText } from "../file-explorer/clipboard";
import s from "../../styles";

const DEFAULT_COUNT = 5;

/**
 * 「会话管理」：会话视图右上角那个 ⋯，收着对**整段会话**做的四个操作
 * （fork / 流转 / 复制 / 导出）。
 *
 * 它们原先是铺在右下角那一排里的 —— 那一排应该是"随手要用"的位置（快捷输入、
 * 切会话记录），而这四个都是一次性动作、用得没那么勤，铺着反而把常用的挤到边上。
 * 收进 ⋯ 里，右上角留一个总入口。
 *
 * 「复制」自己还有一层（整段 / 最近 N 条），所以菜单是两屏：主菜单 → 复制。
 * 不嵌套 Popover —— 同一个 Popover 里换一屏，简单也不会点着点着两个都开着。
 */
export function SessionManageMenu({
  sessionPath,
  assistantLabel,
  canFork,
  canExport,
  exporting,
  onFork,
  onHandoff,
  onExport,
}: {
  sessionPath: string;
  /** assistant 那一侧的署名，例如 Claude Code / Codex */
  assistantLabel: string;
  canFork: boolean;
  canExport: boolean;
  exporting: boolean;
  onFork: () => void;
  onHandoff: () => void;
  onExport: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "copy">("main");
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [busy, setBusy] = useState(false);

  /** 复制整段会话，或最近 N 条（N 自己填，1 就是最近一条）。读的就是回放那份文件。 */
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

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="file-viewer-tab-menu-item"
      style={s.sessionManageItem}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setView("main");
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className="quick-input-trigger"
            style={s.sessionManageBtn}
            title={t("session.manage")}
          >
            <MoreHorizontal size={13} strokeWidth={2.3} />
            <span>{t("session.manage")}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="file-viewer-tab-menu"
            style={s.sessionManageMenu}
            side="bottom"
            align="end"
            sideOffset={6}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {view === "main" ? (
              <>
                {item(
                  <GitFork size={12} strokeWidth={2.3} />,
                  t("running.forkSession"),
                  () => {
                    setOpen(false);
                    onFork();
                  },
                  !canFork,
                )}
                {item(
                  <ArrowRightLeft size={12} strokeWidth={2.3} />,
                  t("handoff.button"),
                  () => {
                    setOpen(false);
                    onHandoff();
                  },
                )}
                {item(
                  <ClipboardCopy size={12} strokeWidth={2.3} />,
                  t("copySession.button"),
                  () => setView("copy"),
                  false,
                )}
                {item(
                  <Download size={12} strokeWidth={2.3} />,
                  exporting ? t("running.exporting") : t("running.exportSession"),
                  () => {
                    setOpen(false);
                    onExport();
                  },
                  !canExport || exporting,
                )}
              </>
            ) : (
              <>
                {item(
                  <ChevronLeft size={12} strokeWidth={2.3} />,
                  t("session.backToManage"),
                  () => setView("main"),
                  false,
                )}
                <div className="radix-select-separator" />
                <button
                  type="button"
                  className="file-viewer-tab-menu-item"
                  style={s.sessionManageItem}
                  disabled={busy}
                  onClick={() => void copy()}
                >
                  <span>{t("copySession.copyAll")}</span>
                </button>
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
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
  );
}
