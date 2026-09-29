import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import { makeQuickInputId, type QuickInput as QuickInputItem } from "../../quickInputs";

/**
 * 会话右下角的快捷输入：点开选一条预设文本，填进当前会话的输入框。
 * 填进去不自动回车 —— 你还能改，确认了再发。
 */
export function QuickInput({
  items,
  onInsert,
  onSave,
  onDelete,
}: {
  items: QuickInputItem[];
  /** 把文本写进当前会话（终端 / agent 的输入框都走这条 PTY 通道） */
  onInsert: (text: string) => void;
  onSave: (item: QuickInputItem) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QuickInputItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
            {items.length === 0 && <div style={s.quickInputEmpty}>{t("quickInput.empty")}</div>}
            {items.map((item) => (
              <div key={item.id} style={s.quickInputRow}>
                <button
                  type="button"
                  className="file-viewer-tab-menu-item"
                  style={s.quickInputRowMain}
                  title={item.text}
                  onClick={() => {
                    onInsert(item.text);
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
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: QuickInputItem | null;
  onOpenChange: (open: boolean) => void;
  onSave: (item: QuickInputItem) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  // 每次打开把当前要改的那条灌进表单（新增就是空的）
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? (editing?.id ?? "__new__") : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (key) {
      setLabel(editing?.label ?? "");
      setText(editing?.text ?? "");
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
              placeholder={t("quickInput.textPlaceholder")}
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
