import { useState } from "react";
import { ChevronsRight, Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";

export function ProjectRailActions({
  drawerOpen,
  onToggleDrawer,
  onOpen,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [addHov, setAddHov] = useState(false);
  const [expandHov, setExpandHov] = useState(false);

  return (
    <>
      <button
        title={t("project.showAllProjects")}
        data-rail-drawer-toggle=""
        onClick={onToggleDrawer}
        onMouseEnter={() => setExpandHov(true)}
        onMouseLeave={() => setExpandHov(false)}
        style={
          drawerOpen ? s.railExpandBtnOpen : expandHov ? s.railExpandBtnHover : s.railExpandBtn
        }
      >
        <ChevronsRight
          size={14}
          strokeWidth={2.5}
          style={drawerOpen ? s.railExpandIconOpen : s.railExpandIcon}
        />
      </button>

      <button
        title={t("welcome.openProject")}
        onClick={onOpen}
        onMouseEnter={() => setAddHov(true)}
        onMouseLeave={() => setAddHov(false)}
        style={addHov ? s.railAddBtnHover : s.railAddBtn}
      >
        <Plus size={14} strokeWidth={2.5} />
      </button>
    </>
  );
}
