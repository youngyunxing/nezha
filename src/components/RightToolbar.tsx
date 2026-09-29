import type { ReactNode } from "react";
import { IconButton } from "./IconButton";
import { Folder, GitBranch, History, Terminal } from "lucide-react";
import { useI18n } from "../i18n";
import type { RightPanel } from "../hooks/useProjectPanels";
import s from "../styles";

export function RightToolbar({
  activePanel,
  onToggle,
  terminalActive,
  onToggleTerminal,
}: {
  activePanel: RightPanel;
  onToggle: (panel: Exclude<RightPanel, null>) => void;
  terminalActive: boolean;
  onToggleTerminal: () => void;
}) {
  const { t } = useI18n();
  const buttons: Array<{
    key: Exclude<RightPanel, null>;
    icon: ReactNode;
    title: string;
  }> = [
    { key: "files", icon: <Folder size={17} />, title: t("toolbar.fileExplorer") },
    { key: "git-changes", icon: <GitBranch size={17} />, title: t("toolbar.gitChanges") },
    { key: "git-history", icon: <History size={17} />, title: t("toolbar.gitHistory") },
  ];

  return (
    <div style={s.rightToolbar}>
      {buttons.map((btn) => (
        <IconButton
          key={btn.key}
          icon={btn.icon}
          title={btn.title}
          active={activePanel === btn.key}
          onClick={() => onToggle(btn.key)}
        />
      ))}

      <IconButton
        icon={<Terminal size={17} />}
        title={t("terminal.title")}
        active={terminalActive}
        onClick={onToggleTerminal}
      />
    </div>
  );
}
