export const FILE_TREE_POINTER_DRAG_EVENT = "nezha:file-tree-pointer-drag";

export interface FileTreePointerDragDetail {
  type: "start" | "move" | "drop" | "cancel";
  paths: string[];
  x: number;
  y: number;
}

export function dispatchFileTreePointerDrag(detail: FileTreePointerDragDetail) {
  window.dispatchEvent(
    new CustomEvent<FileTreePointerDragDetail>(FILE_TREE_POINTER_DRAG_EVENT, { detail }),
  );
}

function quotePosixShellPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

// 写入 PTY stdin 后会被解释为 Enter / NUL,可能触发已输入命令立即执行
const PTY_CONTROL_CHARS = /[\r\n\0]/;

export function formatTerminalDroppedPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (PTY_CONTROL_CHARS.test(trimmed)) {
    console.warn("Dropped path contains control character, ignored:", path);
    return "";
  }
  return quotePosixShellPath(trimmed);
}

export function formatTerminalDroppedPaths(paths: string[]): string {
  return paths
    .map((path) => formatTerminalDroppedPath(path))
    .filter(Boolean)
    .join(" ");
}
