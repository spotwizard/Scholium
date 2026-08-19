import type {
  DropboxDirectoryEntryResult,
  OpenDropboxMarkdownDirectoryResult,
  OpenMarkdownDirectoryResult,
  OpenMarkdownFileResult,
  WorkspaceSource,
} from "./tauriGateway";
import {
  dropboxDocumentId,
  isDropboxDocumentId,
  localPathsMatch,
  normalizeLocalPathForCompare,
  parentDirectoryPath,
} from "./workspacePaths.ts";

export type MarkdownDocument = {
  id: string;
  title: string;
  path: string;
  filePath: string | null;
  notesPath: string | null;
  updatedAt: string;
  modifiedAt?: number | null;
  body: string;
  dropboxRev?: string | null;
};

type WorkspaceDirectoryEntry<Kind extends "parent-directory" | "directory"> = {
  kind: Kind;
  id: string;
  title: string;
  path: string;
  modifiedAt?: number | null;
  depth?: number;
  source?: WorkspaceSource;
};

export type WorkspaceEntry =
  | WorkspaceDirectoryEntry<"parent-directory">
  | WorkspaceDirectoryEntry<"directory">
  | {
      kind: "file";
      id: string;
      title: string;
      path: string;
      documentId: string;
      modifiedAt?: number | null;
      depth?: number;
      source?: WorkspaceSource;
    };

export type WorkspaceFileEntry = Extract<WorkspaceEntry, { kind: "file" }>;

export type DropboxPickerMode = "directory" | "file";

export type DropboxDirectoryPickerNode = DropboxDirectoryEntryResult & {
  children: DropboxDirectoryPickerNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  error: string;
};

export type FlattenedDropboxDirectoryPickerNode = {
  node: DropboxDirectoryPickerNode;
  depth: number;
};

export type DropboxDirectoryPickerState = {
  mode: DropboxPickerMode;
  directories: DropboxDirectoryPickerNode[];
  selectedPath: string;
  isLoadingRoot: boolean;
  isOpening: boolean;
  error: string;
};

export function documentIsFromDropbox(document: MarkdownDocument) {
  return isDropboxDocumentId(document.id);
}

export function workspaceEntryFromDocument(
  document: MarkdownDocument,
  depth = 1,
): WorkspaceFileEntry {
  return {
    kind: "file",
    id: `file:${document.id}`,
    title: document.title,
    path: document.path,
    documentId: document.id,
    modifiedAt: document.modifiedAt ?? null,
    depth,
    source: documentIsFromDropbox(document) ? "dropbox" : "local",
  };
}

export function directoryTreeKey(entry: Pick<WorkspaceEntry, "path" | "source">) {
  return `${entry.source ?? "local"}:${entry.path}`;
}

export function workspaceEntrySelectionKey(entry: WorkspaceEntry) {
  return `${entry.kind}:${entry.source ?? "local"}:${entry.path}`;
}

export function workspaceEntriesFromOpenedDirectory(
  openedDirectory: OpenMarkdownDirectoryResult,
  depth: number,
): WorkspaceEntry[] {
  return openedDirectory.entries.map((entry): WorkspaceEntry => {
    if (entry.kind === "directory") {
      return {
        kind: "directory",
        id: `directory:${entry.path}`,
        title: entry.title,
        path: entry.path,
        modifiedAt: entry.modifiedAt ?? null,
        depth,
        source: "local",
      };
    }

    return workspaceEntryFromDocument(documentFromLoadedFileResult(entry.file), depth);
  });
}

export function workspaceEntriesFromOpenedDropboxDirectory(
  openedDirectory: OpenDropboxMarkdownDirectoryResult,
  depth: number,
): WorkspaceEntry[] {
  return openedDirectory.entries.map((entry): WorkspaceEntry => {
    if (entry.kind === "directory") {
      return {
        kind: "directory",
        id: `dropbox-directory:${entry.path || "/"}`,
        title: entry.title,
        path: entry.path,
        modifiedAt: entry.serverModified ? Date.parse(entry.serverModified) : null,
        depth,
        source: "dropbox",
      };
    }

    return {
      kind: "file",
      id: `dropbox-file:${entry.path}`,
      title: entry.title,
      path: entry.path,
      documentId: dropboxDocumentId(entry.path),
      modifiedAt: entry.serverModified ? Date.parse(entry.serverModified) : null,
      depth,
      source: "dropbox",
    };
  });
}

function dropboxPickerDirectories(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
  return openedDirectory.entries.filter(
    (entry): entry is DropboxDirectoryEntryResult & { kind: "directory" } =>
      entry.kind === "directory",
  );
}

export function dropboxPickerNodeFromEntry(
  entry: DropboxDirectoryEntryResult,
): DropboxDirectoryPickerNode {
  return {
    ...entry,
    children: [],
    isExpanded: false,
    isLoaded: false,
    isLoading: false,
    error: "",
  };
}

export function dropboxPickerNodesFromOpenedDirectory(
  openedDirectory: OpenDropboxMarkdownDirectoryResult,
  mode: DropboxPickerMode,
) {
  const entries =
    mode === "file" ? openedDirectory.entries : dropboxPickerDirectories(openedDirectory);

  return entries.map(dropboxPickerNodeFromEntry);
}

export function flattenDropboxDirectoryPickerNodes(
  nodes: DropboxDirectoryPickerNode[],
  depth = 0,
): FlattenedDropboxDirectoryPickerNode[] {
  return nodes.flatMap((node) => {
    const flattenedNode = { node, depth };
    if (!node.isExpanded) return [flattenedNode];

    return [
      flattenedNode,
      ...flattenDropboxDirectoryPickerNodes(node.children, depth + 1),
    ];
  });
}

export function updateDropboxDirectoryPickerNode(
  nodes: DropboxDirectoryPickerNode[],
  path: string,
  updater: (node: DropboxDirectoryPickerNode) => DropboxDirectoryPickerNode,
): DropboxDirectoryPickerNode[] {
  return nodes.map((node) => {
    if (node.path === path) return updater(node);

    if (node.children.length === 0) return node;

    return {
      ...node,
      children: updateDropboxDirectoryPickerNode(node.children, path, updater),
    };
  });
}

export function firstDropboxMarkdownFileEntry(
  openedDirectory: OpenDropboxMarkdownDirectoryResult,
) {
  return openedDirectory.entries.find(
    (entry): entry is DropboxDirectoryEntryResult & { kind: "file" } =>
      entry.kind === "file",
  );
}

export function documentFromLoadedFileResult(
  loaded: OpenMarkdownFileResult,
): MarkdownDocument {
  return {
    id: loaded.path,
    title: loaded.title,
    path: loaded.path,
    filePath: loaded.path,
    notesPath: loaded.notesPath,
    updatedAt: "",
    modifiedAt: loaded.modifiedAt ?? null,
    body: loaded.body,
  };
}

export function collectVisibleDescendantDirectoryKeys(
  entries: WorkspaceEntry[],
  directory: WorkspaceEntry,
) {
  const directoryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return [];

  const baseDepth = directory.depth ?? 1;
  const keys: string[] = [];
  for (const entry of entries.slice(directoryIndex + 1)) {
    const entryDepth = entry.depth ?? 1;
    if (entryDepth <= baseDepth) break;
    if (entry.kind === "directory") keys.push(directoryTreeKey(entry));
  }
  return keys;
}

export function collapseWorkspaceDirectory(
  entries: WorkspaceEntry[],
  directory: WorkspaceEntry,
) {
  const directoryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return entries;

  const baseDepth = directory.depth ?? 1;
  const nextEntries = [...entries.slice(0, directoryIndex + 1)];
  const remainingEntries = entries.slice(directoryIndex + 1);
  const firstSiblingIndex = remainingEntries.findIndex(
    (entry) => (entry.depth ?? 1) <= baseDepth,
  );
  if (firstSiblingIndex >= 0) {
    nextEntries.push(...remainingEntries.slice(firstSiblingIndex));
  }
  return nextEntries;
}

export function insertWorkspaceDirectoryChildren(
  entries: WorkspaceEntry[],
  directory: WorkspaceEntry,
  childEntries: WorkspaceEntry[],
) {
  const collapsedEntries = collapseWorkspaceDirectory(entries, directory);
  const directoryIndex = collapsedEntries.findIndex(
    (entry) =>
      entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return entries;

  return [
    ...collapsedEntries.slice(0, directoryIndex + 1),
    ...childEntries,
    ...collapsedEntries.slice(directoryIndex + 1),
  ];
}

export function insertOrUpdateWorkspaceFileEntry(
  entries: WorkspaceEntry[],
  fileEntry: WorkspaceFileEntry,
  workspaceRootPath: string | null,
) {
  const existingEntryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "file" &&
      (entry.documentId === fileEntry.documentId ||
        (entry.source === fileEntry.source && localPathsMatch(entry.path, fileEntry.path))),
  );

  if (existingEntryIndex >= 0) {
    return entries.map((entry, index) =>
      index === existingEntryIndex
        ? {
            ...entry,
            title: fileEntry.title,
            path: fileEntry.path,
            id: fileEntry.id,
            documentId: fileEntry.documentId,
            modifiedAt: fileEntry.modifiedAt ?? null,
          }
        : entry,
    );
  }

  const fileParentPath = normalizeLocalPathForCompare(parentDirectoryPath(fileEntry.path));
  const rootPath = normalizeLocalPathForCompare(workspaceRootPath);

  if (!rootPath || fileParentPath === rootPath) {
    return [...entries, { ...fileEntry, depth: 1 }];
  }

  const parentDirectoryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "directory" &&
      entry.source === fileEntry.source &&
      localPathsMatch(entry.path, fileParentPath),
  );
  if (parentDirectoryIndex < 0) {
    return [...entries, { ...fileEntry, depth: 1 }];
  }

  const parentDirectory = entries[parentDirectoryIndex];
  const fileDepth = (parentDirectory.depth ?? 1) + 1;
  const followingEntries = entries.slice(parentDirectoryIndex + 1);
  const nextSiblingOffset = followingEntries.findIndex(
    (entry) => (entry.depth ?? 1) <= (parentDirectory.depth ?? 1),
  );
  const insertionIndex =
    nextSiblingOffset >= 0 ? parentDirectoryIndex + 1 + nextSiblingOffset : entries.length;

  return [
    ...entries.slice(0, insertionIndex),
    { ...fileEntry, depth: fileDepth },
    ...entries.slice(insertionIndex),
  ];
}

function normalizedFileSearchTerms(query: string) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function workspaceEntryMatchesSearch(entry: WorkspaceEntry, terms: string[]) {
  if (terms.length === 0) return true;

  const searchableText = `${entry.title} ${entry.path}`.toLowerCase();
  return terms.every((term) => searchableText.includes(term));
}

export function filterWorkspaceEntriesForSearch(entries: WorkspaceEntry[], query: string) {
  const terms = normalizedFileSearchTerms(query);
  if (terms.length === 0) return entries;

  const includedEntryIndexes = new Set<number>();
  const ancestorIndexesByDepth = new Map<number, number>();

  entries.forEach((entry, index) => {
    const depth = entry.depth ?? 1;

    Array.from(ancestorIndexesByDepth.keys()).forEach((ancestorDepth) => {
      if (ancestorDepth >= depth) ancestorIndexesByDepth.delete(ancestorDepth);
    });

    if (entry.kind !== "file") {
      ancestorIndexesByDepth.set(depth, index);
    }

    if (!workspaceEntryMatchesSearch(entry, terms)) return;

    includedEntryIndexes.add(index);
    ancestorIndexesByDepth.forEach((ancestorIndex) => {
      includedEntryIndexes.add(ancestorIndex);
    });

    if (entry.kind === "file") return;

    for (let descendantIndex = index + 1; descendantIndex < entries.length; descendantIndex += 1) {
      const descendantEntry = entries[descendantIndex];
      if ((descendantEntry.depth ?? 1) <= depth) break;
      includedEntryIndexes.add(descendantIndex);
    }
  });

  return entries.filter((_, index) => includedEntryIndexes.has(index));
}
