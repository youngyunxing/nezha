import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Terminal, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { AgentType } from "../../types";
import { makePresetId, presetSummary, type TaskPreset } from "../../taskPresets";
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

  // 每次打开按 focusPresetId 载入要改的那条；没指定就从空白开始
  useEffect(() => {
    if (!open) return;
    const target = focusPresetId ? presets.find((p) => p.id === focusPresetId) : undefined;
    setDraft(
      target
        ? {
            id: target.id,
            name: target.name,
            agent: target.agent,
            command: target.command ?? "",
            useWorktree: target.useWorktree,
          }
        : { ...EMPTY_DRAFT },
    );
  }, [open, focusPresetId, presets]);

  const trimmedName = draft.name.trim();
  const canSave = trimmedName.length > 0;

  const agentOptions = [
    { value: "claude", label: "Claude Code", icon: <img src={claudeLogo} style={{ width: 13, height: 13 }} /> },
    { value: "codex", label: "Codex", icon: <img src={chatgptLogo} style={{ width: 13, height: 13 }} /> },
    { value: "shell", label: t("terminal.title"), icon: <Terminal size={13} strokeWidth={2.2} /> },
  ];

  const summaryLabels = {
    claude: "Claude Code",
    codex: "Codex",
    shell: t("terminal.title"),
    worktree: t("newTask.dialogIsolated"),
  };

  function submit() {
    if (!canSave) return;
    onSave({
      id: draft.id ?? makePresetId(),
      name: trimmedName,
      agent: draft.agent,
      command:
        draft.agent === "shell" && draft.command.trim() ? draft.command.trim() : undefined,
      useWorktree: draft.useWorktree,
    });
    setDraft({ ...EMPTY_DRAFT });
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

          <div style={s.presetDialogList}>
            {presets.map((preset) => (
              <div
                key={preset.id}
                style={{
                  ...s.presetDialogRow,
                  ...(draft.id === preset.id ? s.presetDialogRowActive : null),
                }}
                onClick={() =>
                  setDraft({
                    id: preset.id,
                    name: preset.name,
                    agent: preset.agent,
                    command: preset.command ?? "",
                    useWorktree: preset.useWorktree,
                  })
                }
              >
                <span style={s.presetDialogRowText}>
                  <span style={s.presetDialogRowName}>{preset.name}</span>
                  <span style={s.presetDialogRowHint}>{presetSummary(preset, summaryLabels)}</span>
                </span>
                <button
                  type="button"
                  title={t("common.delete")}
                  style={s.modalCloseBtn}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(preset.id);
                    if (draft.id === preset.id) setDraft({ ...EMPTY_DRAFT });
                  }}
                >
                  <Trash2 size={13} strokeWidth={2.1} />
                </button>
              </div>
            ))}
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
            <button
              type="button"
              style={s.forkDialogCancelBtn}
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
            >
              <Plus size={12} strokeWidth={2.4} />
              <span>{t("preset.addNew")}</span>
            </button>
            <button
              type="button"
              style={canSave ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
              disabled={!canSave}
              onClick={submit}
            >
              {draft.id ? t("common.save") : t("preset.add")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
