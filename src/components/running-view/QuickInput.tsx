import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import {
  makeQuickInputId,
  quickInputsForSession,
  type QuickInput as QuickInputItem,
  type QuickInputKind,
  type QuickInputScope,
} from "../../quickInputs";

/**
 * 会话右下角的快捷输入：点开选一条预设文本，填进当前会话的输入框。
 * 填进去不自动回车 —— 你还能改，确认了再发。
 */
export function QuickInput({
  items,
  sessionKind,
  projectId,
  autoEnter,
  onAutoEnterChange,
  onInsert,
  onSave,
  onDelete,
}: {
  items: QuickInputItem[];
  /** 当前会话是 agent（提示词）还是终端（命令）——只显示对应类型，免得提示词在终端里被执行 */
  sessionKind: QuickInputKind;
  /** 当前项目 id：项目专属的快捷输入只有在这个项目里才显示 */
  projectId: string;
  /** 开启后点一条 = 输入并直接发送（替你按回车） */
  autoEnter: boolean;
  onAutoEnterChange: (value: boolean) => void;
  /** 把文本写进当前会话（终端 / agent 的输入框都走这条 PTY 通道） */
  onInsert: (text: string) => void;
  onSave: (item: QuickInputItem) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QuickInputItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 只列当前会话类型对得上的那些
  const visibleItems = quickInputsForSession(items, sessionKind, projectId);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="quick-input-trigger"
            style={s.quickInputTrigger}
            title={t("quickInput.button")}
          >
            <Zap size={12} strokeWidth={2.4} />
            <span>{t("quickInput.button")}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="file-viewer-tab-menu"
            style={s.quickInputMenu}
            side="top"
            align="end"
            sideOffset={6}
          >
            {visibleItems.length === 0 && (
              <div style={s.quickInputEmpty}>
                {sessionKind === "command" ? t("quickInput.emptyCommand") : t("quickInput.emptyPrompt")}
              </div>
            )}
            {visibleItems.map((item) => (
              <div key={item.id} style={s.quickInputRow}>
                <button
                  type="button"
                  className="file-viewer-tab-menu-item"
                  style={s.quickInputRowMain}
                  title={item.text}
                  onClick={() => {
                    // 自动回车 = 输入并确认；
                    // 自动回车 = 输入并确认（回车符就是终端里的回车）
                    onInsert(autoEnter ? `${item.text}\r` : item.text);
                    setOpen(false);
                  }}
                >
                  <span style={s.quickInputRowLabel}>{item.label}</span>
                  <span style={s.quickInputRowPreview}>{item.text}</span>
                </button>
                <button
                  type="button"
                  style={s.quickInputRowEdit}
                  title={t("quickInput.edit")}
                  aria-label={t("quickInput.edit")}
                  onClick={() => {
                    setEditing(item);
                    setOpen(false);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil size={11} strokeWidth={2.2} />
                </button>
              </div>
            ))}
            <div className="radix-select-separator" />
            <button
              type="button"
              role="switch"
              aria-checked={autoEnter}
              style={s.quickInputToggleRow}
              onClick={() => onAutoEnterChange(!autoEnter)}
            >
              <span style={s.quickInputToggleLabel}>{t("quickInput.autoEnter")}</span>
              <span style={autoEnter ? s.settingToggleTrackOn : s.settingToggleTrack}>
                <span style={autoEnter ? s.settingToggleKnobOn : s.settingToggleKnob} />
              </span>
            </button>
            <button
              type="button"
              className="file-viewer-tab-menu-item"
              style={s.quickInputAddRow}
              onClick={() => {
                setEditing(null);
                setOpen(false);
                setDialogOpen(true);
              }}
            >
              <Plus size={12} strokeWidth={2.4} />
              <span>{t("quickInput.add")}</span>
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <QuickInputDialog
        open={dialogOpen}
        editing={editing}
        defaultKind={sessionKind}
        projectId={projectId}
        onOpenChange={setDialogOpen}
        onSave={onSave}
        onDelete={onDelete}
      />
    </>
  );
}

/** 一条快捷输入的增 / 改 / 删。 */
function QuickInputDialog({
  open,
  editing,
  defaultKind,
  projectId,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: QuickInputItem | null;
  /** 新建时的默认类型：跟着当前会话走 */
  defaultKind: QuickInputKind;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onSave: (item: QuickInputItem) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<QuickInputKind>(defaultKind);
  const [scope, setScope] = useState<QuickInputScope>("all");

  // 每次打开把当前要改的那条灌进表单（新增就是空的）
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? (editing?.id ?? "__new__") : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (key) {
      setLabel(editing?.label ?? "");
      setText(editing?.text ?? "");
      setKind(editing?.kind ?? defaultKind);
      setScope(editing?.scope ?? "all");
    }
  }

  const canSave = text.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <Dialog.Title style={s.forkDialogTitle}>{t("quickInput.dialogTitle")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {t("quickInput.hint")}
          </Dialog.Description>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel}>{t("quickInput.kind")}</label>
            <div style={s.handoffContextRow}>
              <button
                type="button"
                style={kind === "prompt" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setKind("prompt")}
              >
                {t("quickInput.kindPrompt")}
              </button>
              <button
                type="button"
                style={kind === "command" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setKind("command")}
              >
                {t("quickInput.kindCommand")}
              </button>
            </div>
            <span style={s.newTaskDialogHint}>{t("quickInput.kindHint")}</span>
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel}>{t("quickInput.scope")}</label>
            <div style={s.handoffContextRow}>
              <button
                type="button"
                style={scope === "all" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setScope("all")}
              >
                {t("quickInput.scopeAll")}
              </button>
              <button
                type="button"
                style={scope === "project" ? s.handoffChipActive : s.handoffChip}
                onClick={() => setScope("project")}
              >
                {t("quickInput.scopeProject")}
              </button>
            </div>
            <span style={s.newTaskDialogHint}>{t("quickInput.scopeHint")}</span>
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel} htmlFor="quick-input-label">
              {t("quickInput.label")}
            </label>
            <input
              id="quick-input-label"
              style={s.forkDialogInput}
              value={label}
              maxLength={30}
              placeholder={t("quickInput.labelPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div style={s.presetFieldRow}>
            <label style={s.forkDialogLabel} htmlFor="quick-input-text">
              {t("quickInput.text")}
            </label>
            <input
              id="quick-input-text"
              style={s.forkDialogInput}
              value={text}
              maxLength={500}
              placeholder={
                kind === "command"
                  ? t("quickInput.commandPlaceholder")
                  : t("quickInput.textPlaceholder")
              }
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div style={s.forkDialogActions}>
            {editing && (
              <button
                type="button"
                style={s.presetDeleteBtn}
                onClick={() => {
                  onDelete(editing.id);
                  onOpenChange(false);
                }}
              >
                <Trash2 size={12} strokeWidth={2.2} />
                <span>{t("common.delete")}</span>
              </button>
            )}
            <button
              type="button"
              style={canSave ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
              disabled={!canSave}
              onClick={() => {
                if (!canSave) return;
                const trimmedText = text.trim();
                onSave({
                  id: editing?.id ?? makeQuickInputId(),
                  label: label.trim() || trimmedText,
                  text: trimmedText,
                  kind,
                  scope,
                  projectId: scope === "project" ? projectId : undefined,
                });
                onOpenChange(false);
              }}
            >
              {t("common.save")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
