import type React from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import type { ProjectAppearanceSource } from "../projectAvatar";

/**
 * 项目头像:预设色板渐变底 + 缩写(或用户自定义的 emoji)。颜色 / 缩写由
 * useProjectAppearance 统一解析(同屏去重、自定义优先),样式见 styles/project-rail.css
 * 的 .project-avatar;尺寸通过 --avatar-size 注入。
 */
export function ProjectAvatar({
  project,
  size = 28,
  className,
}: {
  project: ProjectAppearanceSource;
  size?: number;
  className?: string;
}) {
  const appearance = useProjectAppearance(project);
  const sizeVar = { "--avatar-size": `${size}px` } as React.CSSProperties;
  // 图片直接从项目本体兜一道底：解析层负责同屏去重/配色，不该因为漏传一个字段就让头像丢图
  const image = appearance.image ?? project.avatar?.image;
  const showImage = Boolean(image);
  const showEmoji = Boolean(appearance.emoji);
  return (
    <div
      className={className ? `project-avatar ${className}` : "project-avatar"}
      // 有图就不给颜色属性：色板整套 CSS 变量（--avatar-from/to）随之不生效，
      // 免得图片透明处透出底色 —— 图片档根本不该有"底色"这个概念。
      data-avatar-color={showImage ? undefined : appearance.color}
      data-avatar-kind={showImage ? "image" : showEmoji ? "emoji" : "label"}
      data-avatar-len={showImage || showEmoji ? undefined : appearance.label.length}
      style={sizeVar}
    >
      {showImage ? <img className="project-avatar-img" src={image} alt="" /> : showEmoji ? appearance.emoji : appearance.label}
    </div>
  );
}
