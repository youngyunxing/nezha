import type React from "react";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { useI18n } from "../../i18n";
import type { ContextMenuState } from "./types";

export function FileExplorerContextMenu({
  ctxMenu,
  onClose,
  onNewFile,
  onNewFolder,
  onDelete,
  onOpenInSystem,
  onCopyPath,
}: {
  ctxMenu: ContextMenuState;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
  onOpenInSystem: (e: React.MouseEvent, path: string) => void;
  onCopyPath: (e: React.MouseEvent, path: string, withAt: boolean) => void;
}) {
  const { t } = useI18n();
  const items: ContextMenuItem[] = [
    { label: t("file.newFile"), onSelect: onNewFile },
    { label: t("file.newFolder"), onSelect: onNewFolder },
    { separator: true },
    {
      label: t("file.openInSystemFolder"),
      onSelect: (event) => onOpenInSystem(event, ctxMenu.path),
    },
    {
      label: t("file.copyFullPath"),
      onSelect: (event) => onCopyPath(event, ctxMenu.path, false),
    },
    {
      label: t("file.copyAtFullPath"),
      onSelect: (event) => onCopyPath(event, ctxMenu.path, true),
    },
    ...(ctxMenu.isRoot
      ? []
      : [
          { separator: true } as const,
          {
            label: t("file.delete"),
            onSelect: onDelete,
            destructive: true,
          },
        ]),
  ];

  return <ContextMenu anchor={ctxMenu} onClose={onClose} items={items} />;
}
