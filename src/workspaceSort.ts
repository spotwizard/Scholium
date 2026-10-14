export type WorkspaceSortMode = "name" | "modified";

type SortableWorkspaceEntry = {
  kind: "parent-directory" | "directory" | "file";
  path: string;
  title: string;
  modifiedAt?: number | null;
  depth?: number;
};

function entryRank(entry: SortableWorkspaceEntry) {
  if (entry.kind === "parent-directory") return 0;
  if (entry.kind === "directory") return 1;
  return 2;
}

function compareText(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function compareEntries(
  left: SortableWorkspaceEntry,
  right: SortableWorkspaceEntry,
  mode: WorkspaceSortMode,
) {
  const rankDifference = entryRank(left) - entryRank(right);
  if (rankDifference !== 0) return rankDifference;

  if (mode === "modified") {
    const modifiedDifference =
      (right.modifiedAt ?? Number.NEGATIVE_INFINITY) -
      (left.modifiedAt ?? Number.NEGATIVE_INFINITY);
    if (modifiedDifference !== 0) return modifiedDifference;
  }

  return compareText(left.title, right.title) || compareText(left.path, right.path);
}

export function sortWorkspaceEntriesForDirectory<T extends SortableWorkspaceEntry>(
  entries: T[],
  mode: WorkspaceSortMode = "name",
) {
  type EntryNode = { entry: T; children: EntryNode[] };
  const parentEntries = entries.filter((entry) => entry.kind === "parent-directory");
  const rootNodes: EntryNode[] = [];
  const stack: EntryNode[] = [];

  entries
    .filter((entry) => entry.kind !== "parent-directory")
    .forEach((entry) => {
      const node: EntryNode = { entry, children: [] };
      const depth = entry.depth ?? 1;

      while (stack.length > 0 && (stack[stack.length - 1].entry.depth ?? 1) >= depth) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else rootNodes.push(node);
      stack.push(node);
    });

  const sortedEntries: T[] = [...parentEntries];
  const appendNodes = (nodes: EntryNode[]) => {
    nodes.sort((left, right) => compareEntries(left.entry, right.entry, mode));
    nodes.forEach((node) => {
      sortedEntries.push(node.entry);
      appendNodes(node.children);
    });
  };

  appendNodes(rootNodes);
  return sortedEntries;
}
