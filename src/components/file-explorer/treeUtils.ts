import type { CreateKind, FlatRow, FsEntry, TreeNode } from "./types";

export function pathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function joinPath(parent: string, name: string): string {
  const sep = pathSeparator(parent);
  const trimmed = parent.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${name}`;
}

export function parentPathOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function findNode(items: TreeNode[], path: string): TreeNode | null {
  for (const item of items) {
    if (item.path === path) return item;
    if (item.children) {
      const found = findNode(item.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function isSameEntry(a: FsEntry, b: FsEntry) {
  return (
    a.path === b.path &&
    a.name === b.name &&
    a.is_dir === b.is_dir &&
    a.extension === b.extension &&
    a.is_gitignored === b.is_gitignored
  );
}

export function updateNode(
  items: TreeNode[],
  path: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.path === path) {
      const nextItem = updater(item);
      if (nextItem !== item) changed = true;
      return nextItem;
    }

    if (!item.children) return item;

    const nextChildren = updateNode(item.children, path, updater);
    if (nextChildren === item.children) return item;

    changed = true;
    return { ...item, children: nextChildren };
  });

  return changed ? nextItems : items;
}

function isCompactBridge(children: TreeNode[] | null): children is [TreeNode] {
  return children !== null && children.length === 1 && children[0].is_dir;
}

export async function loadTreeNodes(
  path: string,
  previousNodes: TreeNode[],
  readEntries: (path: string) => Promise<FsEntry[] | null>,
): Promise<TreeNode[] | null> {
  const entries = await readEntries(path);
  if (entries === null) return null;

  const previousByPath = new Map(previousNodes.map((node) => [node.path, node]));
  let changed = entries.length !== previousNodes.length;
  const nextNodes: TreeNode[] = [];

  for (const [index, entry] of entries.entries()) {
    const previous = previousByPath.get(entry.path);
    const expanded = previous?.expanded ?? false;
    let children: TreeNode[] | null = null;

    if (entry.is_dir) {
      if (expanded) {
        const nextChildren = await loadTreeNodes(entry.path, previous?.children ?? [], readEntries);
        if (nextChildren === null) return null;
        children = nextChildren;
      } else {
        children = previous?.children ?? null;
      }
    }

    const previousAtIndex = previousNodes[index];
    if (!previousAtIndex || previousAtIndex.path !== entry.path) {
      changed = true;
    }

    if (previous && isSameEntry(previous, entry) && previous.children === children) {
      nextNodes.push(previous);
      continue;
    }

    changed = true;
    nextNodes.push({ ...entry, expanded, children });
  }

  return changed ? nextNodes : previousNodes;
}

function compactNode(node: TreeNode): TreeNode {
  if (!node.is_dir || !node.children) return node;

  const chain = [node];
  let target = node;
  while (isCompactBridge(target.children)) {
    target = target.children[0];
    chain.push(target);
  }

  const children = target.children ? compactTreeNodes(target.children) : target.children;
  if (chain.length === 1 && children === target.children) return node;

  return {
    ...target,
    name: chain.map((part) => part.name).join("/"),
    is_gitignored: chain.some((part) => part.is_gitignored),
    children,
  };
}

export function compactTreeNodes(nodes: TreeNode[]): TreeNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nextNode = compactNode(node);
    if (nextNode !== node) changed = true;
    return nextNode;
  });
  return changed ? nextNodes : nodes;
}

export function flattenVisible(
  nodes: TreeNode[],
  rootPath: string,
  creating: { parentPath: string; kind: CreateKind } | null,
): FlatRow[] {
  const result: FlatRow[] = [];
  if (creating && creating.parentPath === rootPath) {
    result.push({ kind: "input", parentPath: rootPath, depth: 0, createKind: creating.kind });
  }
  function walk(items: TreeNode[], depth: number) {
    for (const n of items) {
      result.push({ kind: "node", node: n, depth });
      if (n.is_dir && n.expanded && n.children) {
        if (creating && creating.parentPath === n.path) {
          result.push({
            kind: "input",
            parentPath: n.path,
            depth: depth + 1,
            createKind: creating.kind,
          });
        }
        walk(n.children, depth + 1);
      }
    }
  }
  walk(nodes, 0);
  return result;
}
