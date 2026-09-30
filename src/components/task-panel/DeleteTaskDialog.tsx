import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import type { Task } from "../../types";
import { useI18n } from "../../i18n";
import s from "../../styles";

/**
 * 删除任务的确认框。比系统弹窗多一颗按钮：除了「取消 / 删除」，第三颗直接改走「归档」——
 * 那条路什么都不会丢。原生 confirm 只支持两个按钮，所以这里自己画。
 */
export function DeleteTaskDialog({
  task,
  onCancel,
  onConfirm,
  onArchive,
}: {
  /** 要删的任务；null = 不显示 */
  task: Task | null;
  onCancel: () => void;
  onConfirm: () => void;
  onArchive: () => void;
}) {
  const { t } = useI18n();
  // 有 worktree 的任务，删除时丢掉的是「未提交的改动」；普通任务丢的是它自己的记录。
  // 两种代价差得远，正文分开写（判据与 cleanupTaskWorktree 一致）。
  const hasWorktree = !!task?.worktreePath && !!task.worktreeBranch && !task.worktreeDiscarded;

  return (
    <Dialog.Root open={task !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox}>
          <div style={s.forkDialogHeader}>
            <div style={s.forkDialogHeading}>
              <span style={s.forkDialogIcon}>
                <AlertTriangle size={16} strokeWidth={2.1} />
              </span>
              <Dialog.Title style={s.forkDialogTitle}>{t("task.deleteConfirmTitle")}</Dialog.Title>
            </div>
          </div>
          <Dialog.Description style={s.forkDialogDescription}>
            {hasWorktree ? t("task.deleteConfirmBodyWorktree") : t("task.deleteConfirmBody")}
          </Dialog.Description>
          <div style={s.forkDialogActions}>
            <button type="button" style={s.forkDialogCancelBtn} onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="button" style={s.forkDialogPrimaryBtn} onClick={onArchive}>
              {t("task.archive")}
            </button>
            <button type="button" style={s.presetDeleteBtn} onClick={onConfirm}>
              {t("task.deleteConfirmOk")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
