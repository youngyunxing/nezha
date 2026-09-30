import type { ProjectAvatarColor } from "../../types";
import { PROJECT_AVATAR_COLORS } from "../../mainTabs";
import { useI18n } from "../../i18n";
import s from "../../styles";

/** 标签配色：一排色块，点了立刻生效（挂在右键菜单里）。
 *  色板就是项目头像那 16 色 —— 四套主题下都保证对比度，色值映射见 App.css 的 data-tab-color。 */
export function TabColorPicker({
  current,
  onPick,
}: {
  current: ProjectAvatarColor | null;
  onPick: (color: ProjectAvatarColor) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={s.tabColorSection}>
      <span style={s.tabColorLabel}>{t("mainTabs.color")}</span>
      <div style={s.tabColorGrid}>
        {PROJECT_AVATAR_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="tab-color-swatch"
            data-tab-color={color}
            data-selected={current === color ? "true" : "false"}
            title={color}
            aria-label={color}
            onClick={(event) => {
              // 不关菜单：挑色时想连着试几个
              event.preventDefault();
              event.stopPropagation();
              onPick(color);
            }}
          />
        ))}
      </div>
    </div>
  );
}
