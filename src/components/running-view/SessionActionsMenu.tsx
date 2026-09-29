import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { GitFork, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";

const MAX_FORK_SOURCE_NAME_LENGTH = 70;

export function buildDefaultForkTaskName(
  taskName: string | undefined,
  prompt: string,
  fallbackName: string,
): string {
  const source = ((taskName ?? prompt).trim() || fallbackName).replace(/\s+/g, " ");
  const shortened =
    source.length > MAX_FORK_SOURCE_NAME_LENGTH
      ? `${source.slice(0, MAX_FORK_SOURCE_NAME_LENGTH)}…`
      : source;
  return `Fork-${shortened}`;
}

export function ForkTaskDialog({
  open,
  defaultName,
  onOpenChange,
  onFork,
}: {
  open: boolean;
  defaultName: string;
  onOpenChange: (open: boolean) => void;
  onFork: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultName, open]);

  const trimmedName = name.trim();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <div style={s.forkDialogHeading}>
              <span style={s.forkDialogIcon}>
                <GitFork size={16} strokeWidth={2.1} />
              </span>
              <Dialog.Title style={s.forkDialogTitle}>{t("running.forkDialogTitle")}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {t("running.forkDialogDescription")}
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!trimmedName) return;
              onFork(trimmedName);
              onOpenChange(false);
            }}
          >
            <label style={s.forkDialogLabel} htmlFor="fork-task-name">
              {t("running.forkTaskName")}
            </label>
            <input
              ref={inputRef}
              id="fork-task-name"
              style={s.forkDialogInput}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
            <div style={s.forkDialogActions}>
              <Dialog.Close asChild>
                <button type="button" style={s.forkDialogCancelBtn}>
                  {t("common.cancel")}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                style={trimmedName ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
                disabled={!trimmedName}
              >
                {t("running.forkConfirm")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
