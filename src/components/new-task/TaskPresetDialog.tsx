import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Moon, Terminal, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { AgentType } from "../../types";
import { makePresetId, type TaskPreset } from "../../taskPresets";
import { SelectField } from "./NewTaskDialog";
import claudeLogo from "../../assets/claude.svg";
import chatgptLogo from "../../assets/chatgpt.svg";

interface Draft {
  /** null = 新按钮 */
  id: string | null;
  name: string;
  agent: AgentType;
  command: string;
  useWorktree: boolean;
}

// 新增时默认「终端」：自定义按钮多半是给第三方 CLI / 启动命令用的，不是开 Claude 会话
const EMPTY_DRAFT: Draft = { id: null, name: "", agent: "shell", command: "", useWorktree: false };

function toDraft(preset: TaskPreset): Draft {
  return {
    id: preset.id,
    name: preset.name,
    agent: preset.agent,
    command: preset.command ?? "",
    useWorktree: preset.useWorktree,
  };
}

function draftToPreset(draft: Draft): TaskPreset {
  return {
    id: draft.id ?? makePresetId(),
    name: draft.name.trim(),
    agent: draft.agent,
    command: draft.agent === "shell" && draft.command.trim() ? draft.command.trim() : undefined,
    useWorktree: draft.useWorktree,
  };
}

/** 表单本体：新增和编辑共用的那几项（名称 / 类型 / 命令 / worktree）。 */
function PresetFields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
}) {
  const { t } = useI18n();
  const agentOptions = [
    {
      value: "claude",
      label: "Claude Code",
      icon: <img src={claudeLogo} style={{ width: 13, height: 13 }} />,
    },
    { value: "codex", label: "Codex", icon: <img src={chatgptLogo} style={{ width: 13, height: 13 }} /> },
    { value: "kimi", label: "Kimi", icon: <Moon size={13} strokeWidth={2.2} /> },
    { value: "shell", label: t("terminal.title"), icon: <Terminal size={13} strokeWidth={2.2} /> },
  ];

  return (
    <>
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
    </>
  );
}

/** 「添加」弹窗：一张空白表单，填完点添加。 */
export function TaskPresetAddDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (preset: TaskPreset) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // 每次打开都是一张新表单
  useEffect(() => {
    if (open) setDraft({ ...EMPTY_DRAFT });
  }, [open]);

  const canSave = draft.name.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <Dialog.Title style={s.forkDialogTitle}>{t("preset.addTitle")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {t("preset.dialogHint")}
          </Dialog.Description>

          <div style={s.presetAddForm}>
            <PresetFields draft={draft} setDraft={setDraft} />
          </div>

          <div style={s.forkDialogActions}>
            <Dialog.Close asChild>
              <button type="button" style={s.forkDialogCancelBtn}>
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              style={canSave ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
              disabled={!canSave}
              onClick={() => {
                if (!canSave) return;
                onSave(draftToPreset(draft));
                onOpenChange(false);
              }}
            >
              {t("preset.add")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 「编辑」弹窗：左边列快捷命令，右边改选中的那条（含删除）。 */
export function TaskPresetEditDialog({
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const selected = useMemo(
    () => presets.find((p) => p.id === selectedId) ?? null,
    [presets, selectedId],
  );

  // 打开时选中 focusPresetId（右键某颗 chip 进来），否则选第一条
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    const target = (focusPresetId && presets.find((p) => p.id === focusPresetId)) || presets[0];
    setSelectedId(target?.id ?? null);
    setDraft(target ? toDraft(target) : { ...EMPTY_DRAFT });
    // presets 只用于打开那一刻取值，故意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusPresetId]);

  // 选中的那条被删掉（或列表变了）就清空右侧
  useEffect(() => {
    if (!open) return;
    if (selectedId && !presets.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      setDraft({ ...EMPTY_DRAFT });
    }
  }, [open, presets, selectedId]);

  const canSave = selected !== null && draft.name.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={{ ...s.forkDialogBox, width: 620 }}>
          <div style={s.forkDialogHeader}>
            <Dialog.Title style={s.forkDialogTitle}>{t("preset.editTitle")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

          <div style={s.presetEditBody}>
            <div style={s.presetEditList}>
              {presets.length === 0 && (
                <div style={s.presetEditEmpty}>{t("preset.editEmpty")}</div>
              )}
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  style={{
                    ...s.presetEditListRow,
                    ...(preset.id === selectedId ? s.presetEditListRowActive : null),
                  }}
                  onClick={() => {
                    setSelectedId(preset.id);
                    setDraft(toDraft(preset));
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div style={s.presetEditPanel}>
              {selected ? (
                <>
                  <PresetFields draft={draft} setDraft={setDraft} />
                  <div style={s.forkDialogActions}>
                    <button
                      type="button"
                      style={s.presetDeleteBtn}
                      onClick={() => {
                        onDelete(selected.id);
                        setSelectedId(null);
                        setDraft({ ...EMPTY_DRAFT });
                      }}
                    >
                      <Trash2 size={12} strokeWidth={2.2} />
                      <span>{t("common.delete")}</span>
                    </button>
                    <button
                      type="button"
                      style={canSave ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
                      disabled={!canSave}
                      onClick={() => {
                        if (!canSave) return;
                        onSave(draftToPreset(draft));
                      }}
                    >
                      {t("common.save")}
                    </button>
                  </div>
                </>
              ) : (
                <div style={s.presetEditEmpty}>{t("preset.editEmpty")}</div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
