// 抽屉行的尺寸规范:行高 44px、列表无 gap、列表 padding-top 4px。
// 拖拽时让位距离 = 行高 + gap。抽屉会把这些常量注入 CSS 变量
// (--rail-item-size / --rail-item-gap),布局与 drag.ts 的落点计算共用同一来源;
// 样式本体见 styles/project-rail.css。
export const RAIL_ITEM_SIZE = 36;
export const RAIL_ITEM_GAP = 5;
export const RAIL_ITEM_STRIDE = RAIL_ITEM_SIZE + RAIL_ITEM_GAP;

// 抽屉行：.rail-drawer-item 的 padding 8 + 头像 28 + padding 8 = 44，列表无 gap。
// 与 project-rail.css 的 .rail-drawer-item / .rail-drawer-list 必须一致。
export const DRAWER_ROW_PADDING_TOP = 4; // 与 .rail-drawer-list 的 padding-top 一致
export const DRAWER_ROW_HEIGHT = 44;
export const DRAWER_ROW_GAP = 0;
export const DRAWER_ROW_STRIDE = DRAWER_ROW_HEIGHT + DRAWER_ROW_GAP;
