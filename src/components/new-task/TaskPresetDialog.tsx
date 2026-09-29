import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Terminal, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { AgentType } from "../../types";
import { makePresetId, type TaskPreset } from "../../taskPresets";
import { SelectField } from "./NewTaskDialog";
import claudeLogo from "../../assets/claude.svg";
import chatgptLogo from "../../assets/chatgpt.svg";

interface Draft {
  /** null = 正在新建 */
  id: string | null;
  name: string;
  agent: AgentType;
  command: string;
  useWorktree: boolean;
}

const EMPTY_DRAFT: Draft = { id: null, name: "", agent: "claude", command: "", useWorktree: false };

function toDraft(preset: TaskPreset): Draft {
  return {
    id: preset.id,
    name: preset.name,
    agent: preset.agent,
    command: preset.command ?? "",
    useWorktree: preset.useWorktree,
  };
}

/** 快捷创建按钮的编辑器：上面列已有的（点一条进来改），下面表单新增/保存。 */
export function TaskPresetDialog({
  open,
  presets,
  focusPresetId,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  presets: TaskPreset[];
  focusPresetId?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (preset: TaskPreset) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // 只在「打开那一刻」载入 focusPresetId 指向的那条（没指定就空白），之后不再抢：
  // 保存会让 presets 换新数组，若把这个 effect 挂在 presets 上，就会把用户正编辑的内容
  // 顶回最早 focus 的那条 —— 也就是「点了另一条，上一条还赖在编辑态」。
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    const target = focusPresetId ? presets.find((p) => p.id === focusPresetId) : undefined;
    setDraft(target ? toDraft(target) : { ...EMPTY_DRAFT });
    // presets 只用于打开那一刻取值，故意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusPresetId]);

  const trimmedName = draft.name.trim();
  const canSave = trimmedName.length > 0;

  const agentOptions = [
    { value: "claude", label: "Claude Code", icon: <img src={claudeLogo} style={{ width: 13, height: 13 }} /> },
    { value: "codex", label: "Codex", icon: <img src={chatgptLogo} style={{ width: 13, height: 13 }} /> },
    { value: "shell", label: t("terminal.title"), icon: <Terminal size={13} strokeWidth={2.2} /> },
  ];


  function submit() {
    if (!canSave) return;
    const saved: TaskPreset = {
      id: draft.id ?? makePresetId(),
      name: trimmedName,
      agent: draft.agent,
      command: draft.agent === "shell" && draft.command.trim() ? draft.command.trim() : undefined,
      useWorktree: draft.useWorktree,
    };
    onSave(saved);
    // 保存后停在这条上（列表里它保持高亮），想加新的点「新增一个」
    setDraft(toDraft(saved));
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <Dialog.Title style={s.forkDialogTitle}>{t("preset.dialogTitle")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {t("preset.dialogHint")}
          </Dialog.Description>

          <div style={{ ...s.newTaskDialogHint, marginBottom: 8 }}>
            {draft.id ? t("preset.editingHint", { name: draft.name }) : t("preset.editHint")}
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel} htmlFor="preset-name">
              {t("preset.name")}
            </label>
            <input
              id="preset-name"
              style={s.forkDialogInput}
              value={draft.name}
              maxLength={40}
              placeholder={t("preset.namePlaceholder")}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel}>{t("preset.agent")}</label>
            <SelectField
              value={draft.agent}
              label={t("preset.agent")}
              options={agentOptions}
              onChange={(value) => setDraft((prev) => ({ ...prev, agent: value as AgentType }))}
            />
          </div>

          {draft.agent === "shell" && (
            <div style={s.presetFieldRow}>
              <label style={s.forkDialogLabel} htmlFor="preset-command">
                {t("preset.command")}
              </label>
              <input
                id="preset-command"
                style={s.forkDialogInput}
                value={draft.command}
                maxLength={240}
                placeholder={t("preset.commandPlaceholder")}
                onChange={(event) => setDraft((prev) => ({ ...prev, command: event.target.value }))}
              />
              <span style={s.newTaskDialogHint}>{t("preset.commandHint")}</span>
            </div>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={draft.useWorktree}
            style={s.settingToggle}
            onClick={() => setDraft((prev) => ({ ...prev, useWorktree: !prev.useWorktree }))}
          >
            <span style={s.newTaskDialogToggleText}>
              <span style={s.settingToggleLabel}>{t("newTask.dialogIsolated")}</span>
              <span style={s.newTaskDialogHint}>{t("preset.worktreeHint")}</span>
            </span>
            <span style={draft.useWorktree ? s.settingToggleTrackOn : s.settingToggleTrack}>
              <span style={draft.useWorktree ? s.settingToggleKnobOn : s.settingToggleKnob} />
            </span>
          </button>

          <div style={s.forkDialogActions}>
            {/* 新增和编辑分开：表单是空的就只做「添加」，载入了某条才是「保存」+「取消编辑」 */}
            {draft.id ? (
              <>
                <button
                  type="button"
                  style={s.forkDialogCancelBtn}
                  onClick={() => {
                    if (!draft.id) return;
                    onDelete(draft.id);
                    setDraft({ ...EMPTY_DRAFT });
                  }}
                >
                  <Trash2 size={12} strokeWidth={2.2} />
                  <span>{t("common.delete")}</span>
                </button>
                <button
                  type="button"
                  style={s.forkDialogCancelBtn}
                  onClick={() => setDraft({ ...EMPTY_DRAFT })}
                >
                  {t("preset.cancelEdit")}
                </button>
              </>
            ) : null}
            <button
              type="button"
              style={canSave ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
              disabled={!canSave}
              onClick={submit}
            >
              {t("common.save")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
