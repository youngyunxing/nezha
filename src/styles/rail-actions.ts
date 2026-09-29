// ProjectRail 底部操作按钮（展开抽屉 / 添加项目）。原先寄居在 styles/kanban.ts
// 里，看板移除后独立出来。
const railIconBtn = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center" as const,
  justifyContent: "center" as const,
  borderRadius: 8,
  cursor: "pointer",
  transition: "background 0.12s, color 0.12s",
};

export const railActions = {
  railExpandBtn: {
    ...railIconBtn,
    background: "none",
    border: "none",
    color: "var(--text-hint)",
  },
  railExpandBtnHover: {
    ...railIconBtn,
    background: "var(--bg-hover)",
    border: "none",
    color: "var(--text-muted)",
  },
  railExpandBtnOpen: {
    ...railIconBtn,
    background: "var(--accent-subtle)",
    border: "none",
    color: "var(--accent)",
  },
  railExpandIcon: {
    transform: "none",
    transition: "transform 0.18s",
  },
  railExpandIconOpen: {
    transform: "rotate(180deg)",
    transition: "transform 0.18s",
  },
  railAddBtn: {
    ...railIconBtn,
    background: "var(--bg-card)",
    border: "1px solid var(--border-medium)",
    color: "var(--text-muted)",
  },
  railAddBtnHover: {
    ...railIconBtn,
    background: "var(--bg-hover)",
    border: "1px solid var(--border-medium)",
    color: "var(--text-primary)",
  },
};
