import type { WorkspaceSource } from "./tauriGateway";
import type { WorkspaceEntry } from "./workspaceEntries.ts";
import {
  localPathIsInsideDirectory,
  localPathsMatch,
  normalizeLocalPathForCompare,
} from "./workspacePaths.ts";

/**
 * The folder tree of a folder in the side panel that is not the current folder.
 * The current folder keeps its tree in the regular workspace state instead.
 */
export type WorkspaceRootSnapshot = {
  entries: WorkspaceEntry[];
  expandedDirectoryKeys: string[];
};

export type OpenWorkspaceRoot = {
  key: string;
  path: string;
  title: string;
  source: WorkspaceSource;
  collapsed: boolean;
  /** Null while this folder is the current folder. */
  snapshot: WorkspaceRootSnapshot | null;
};

export type StoredWorkspaceRoot = {
  path: string;
  title: string;
  collapsed: boolean;
};

export function workspaceRootKey(source: WorkspaceSource, path: string) {
  return `${source}:${normalizeLocalPathForCompare(path)}`;
}

/**
 * Makes `root` the current folder: it replaces the folder with the same key in
 * place, or is appended after the other folders when it is new.
 */
export function upsertActiveWorkspaceRoot(
  roots: OpenWorkspaceRoot[],
  root: Pick<OpenWorkspaceRoot, "path" | "title" | "source">,
): OpenWorkspaceRoot[] {
  const key = workspaceRootKey(root.source, root.path);
  const existingRoot = roots.find((candidate) => candidate.key === key);
  const activeRoot: OpenWorkspaceRoot = {
    key,
    path: root.path,
    title: root.title,
    source: root.source,
    collapsed: false,
    snapshot: null,
  };

  if (!existingRoot) return [...roots, activeRoot];

  return roots.map((candidate) => (candidate.key === key ? activeRoot : candidate));
}

/** Stores the live tree of the current folder before another folder becomes current. */
export function snapshotWorkspaceRoot(
  roots: OpenWorkspaceRoot[],
  key: string,
  snapshot: WorkspaceRootSnapshot,
): OpenWorkspaceRoot[] {
  return roots.map((root) =>
    root.key === key && root.snapshot === null ? { ...root, snapshot } : root,
  );
}

export function activateWorkspaceRootInList(
  roots: OpenWorkspaceRoot[],
  key: string,
): OpenWorkspaceRoot[] {
  return roots.map((root) => (root.key === key ? { ...root, snapshot: null } : root));
}

/** The folder whose tree is the live workspace tree. */
export function liveWorkspaceRoot(roots: OpenWorkspaceRoot[]) {
  return roots.find((root) => root.snapshot === null) ?? null;
}

export function setWorkspaceRootCollapsed(
  roots: OpenWorkspaceRoot[],
  key: string,
  collapsed: boolean,
): OpenWorkspaceRoot[] {
  return roots.map((root) => (root.key === key ? { ...root, collapsed } : root));
}

export function removeWorkspaceRootFromList(roots: OpenWorkspaceRoot[], key: string) {
  return roots.filter((root) => root.key !== key);
}

/** The folder that becomes current when `key` is removed: the next one, else the previous one. */
export function workspaceRootAfterRemoval(roots: OpenWorkspaceRoot[], key: string) {
  const index = roots.findIndex((root) => root.key === key);
  if (index < 0) return null;

  return roots[index + 1] ?? roots[index - 1] ?? null;
}

/** The deepest open local folder that contains `filePath`. */
export function workspaceRootContainingPath(roots: OpenWorkspaceRoot[], filePath: string) {
  let bestRoot: OpenWorkspaceRoot | null = null;

  roots.forEach((root) => {
    if (root.source !== "local" || !localPathIsInsideDirectory(filePath, root.path)) return;
    if (
      !bestRoot ||
      normalizeLocalPathForCompare(root.path).length >
        normalizeLocalPathForCompare(bestRoot.path).length
    ) {
      bestRoot = root;
    }
  });

  return bestRoot as OpenWorkspaceRoot | null;
}

/** The open folder whose visible tree already lists the local file at `filePath`. */
export function workspaceRootListingFile(
  roots: OpenWorkspaceRoot[],
  activeEntries: WorkspaceEntry[],
  filePath: string,
) {
  return (
    roots.find((root) => {
      if (root.source !== "local") return false;

      const entries = root.snapshot ? root.snapshot.entries : activeEntries;
      return entries.some(
        (entry) => entry.kind === "file" && localPathsMatch(entry.path, filePath),
      );
    }) ?? null
  );
}

export function sortWorkspaceRootSnapshots(
  roots: OpenWorkspaceRoot[],
  sortEntries: (entries: WorkspaceEntry[]) => WorkspaceEntry[],
): OpenWorkspaceRoot[] {
  return roots.map((root) =>
    root.snapshot
      ? { ...root, snapshot: { ...root.snapshot, entries: sortEntries(root.snapshot.entries) } }
      : root,
  );
}

export function storedWorkspaceRootsFromOpenRoots(
  roots: OpenWorkspaceRoot[],
): StoredWorkspaceRoot[] {
  return roots
    .filter((root) => root.source === "local")
    .map((root) => ({ path: root.path, title: root.title, collapsed: root.collapsed }));
}

export function parseStoredWorkspaceRoots(value: string | null): StoredWorkspaceRoot[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const seenKeys = new Set<string>();
    return parsed.flatMap((item): StoredWorkspaceRoot[] => {
      if (!item || typeof item !== "object") return [];

      const { path, title, collapsed } = item as Record<string, unknown>;
      if (typeof path !== "string" || !path.trim()) return [];

      const key = workspaceRootKey("local", path);
      if (seenKeys.has(key)) return [];
      seenKeys.add(key);

      return [
        {
          path,
          title: typeof title === "string" ? title : path,
          collapsed: collapsed === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Puts the folders restored after startup around the current folder in the
 * order they were saved, keeping any folder opened while they were loading.
 */
export function mergeRestoredWorkspaceRoots(
  currentRoots: OpenWorkspaceRoot[],
  storedRoots: StoredWorkspaceRoot[],
  restoredRoots: OpenWorkspaceRoot[],
): OpenWorkspaceRoot[] {
  const currentByKey = new Map(currentRoots.map((root) => [root.key, root]));
  const restoredByKey = new Map(restoredRoots.map((root) => [root.key, root]));
  const orderedRoots: OpenWorkspaceRoot[] = [];
  const usedKeys = new Set<string>();

  storedRoots.forEach((storedRoot) => {
    const key = workspaceRootKey("local", storedRoot.path);
    const root = currentByKey.get(key) ?? restoredByKey.get(key);
    if (!root || usedKeys.has(key)) return;

    orderedRoots.push(currentByKey.has(key) ? { ...root, collapsed: storedRoot.collapsed } : root);
    usedKeys.add(key);
  });

  currentRoots.forEach((root) => {
    if (usedKeys.has(root.key)) return;
    orderedRoots.push(root);
    usedKeys.add(root.key);
  });

  return orderedRoots;
}
