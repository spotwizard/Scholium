import assert from "node:assert/strict";
import type {
  OpenDropboxMarkdownDirectoryResult,
  OpenMarkdownDirectoryResult,
  OpenMarkdownFileResult,
} from "../src/tauriGateway.ts";
import {
  collapseWorkspaceDirectory,
  collectVisibleDescendantDirectoryKeys,
  directoryTreeKey,
  documentFromLoadedFileResult,
  documentIsFromDropbox,
  dropboxPickerNodeFromEntry,
  dropboxPickerNodesFromOpenedDirectory,
  filterWorkspaceEntriesForSearch,
  firstDropboxMarkdownFileEntry,
  flattenDropboxDirectoryPickerNodes,
  insertOrUpdateWorkspaceFileEntry,
  insertWorkspaceDirectoryChildren,
  updateDropboxDirectoryPickerNode,
  workspaceEntriesFromOpenedDirectory,
  workspaceEntriesFromOpenedDropboxDirectory,
  workspaceEntryFromDocument,
  workspaceEntrySelectionKey,
  type WorkspaceEntry,
  type WorkspaceFileEntry,
} from "../src/workspaceEntries.ts";

const loadedFile: OpenMarkdownFileResult = {
  path: "/Notes/hello.md",
  notesPath: "/Notes/.hello.notes.json",
  title: "Hello",
  modifiedAt: 123,
  body: "# Hello",
  notes: [],
};

const localDirectory: OpenMarkdownDirectoryResult = {
  path: "/Notes",
  parentPath: "/",
  title: "Notes",
  entries: [
    {
      kind: "directory",
      path: "/Notes/Archive",
      title: "Archive",
      modifiedAt: 100,
      file: null,
    },
    {
      kind: "file",
      path: loadedFile.path,
      title: loadedFile.title,
      modifiedAt: loadedFile.modifiedAt,
      file: loadedFile,
    },
  ],
};

assert.deepEqual(documentFromLoadedFileResult(loadedFile), {
  id: "/Notes/hello.md",
  title: "Hello",
  path: "/Notes/hello.md",
  filePath: "/Notes/hello.md",
  notesPath: "/Notes/.hello.notes.json",
  updatedAt: "",
  modifiedAt: 123,
  body: "# Hello",
});
assert.deepEqual(
  workspaceEntriesFromOpenedDirectory(localDirectory, 2).map((entry) => ({
    kind: entry.kind,
    path: entry.path,
    depth: entry.depth,
    source: entry.source,
  })),
  [
    { kind: "directory", path: "/Notes/Archive", depth: 2, source: "local" },
    { kind: "file", path: "/Notes/hello.md", depth: 2, source: "local" },
  ],
);

const dropboxDirectory: OpenDropboxMarkdownDirectoryResult = {
  path: "/Cloud",
  parentPath: "",
  title: "Cloud",
  entries: [
    {
      kind: "directory",
      path: "/Cloud/Archive",
      title: "Archive",
      serverModified: "2026-08-01T10:00:00Z",
    },
    {
      kind: "file",
      path: "/Cloud/plan.md",
      title: "Plan",
      serverModified: "2026-08-02T10:00:00Z",
    },
  ],
};

const dropboxEntries = workspaceEntriesFromOpenedDropboxDirectory(dropboxDirectory, 3);
assert.deepEqual(
  dropboxEntries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    depth: entry.depth,
    source: entry.source,
    modifiedAt: entry.modifiedAt,
  })),
  [
    {
      id: "dropbox-directory:/Cloud/Archive",
      kind: "directory",
      depth: 3,
      source: "dropbox",
      modifiedAt: Date.parse("2026-08-01T10:00:00Z"),
    },
    {
      id: "dropbox-file:/Cloud/plan.md",
      kind: "file",
      depth: 3,
      source: "dropbox",
      modifiedAt: Date.parse("2026-08-02T10:00:00Z"),
    },
  ],
);
assert.equal(documentIsFromDropbox({ ...documentFromLoadedFileResult(loadedFile), id: "dropbox:/x" }), true);
assert.equal(workspaceEntryFromDocument(documentFromLoadedFileResult(loadedFile)).source, "local");

const directoryPickerNodes = dropboxPickerNodesFromOpenedDirectory(dropboxDirectory, "directory");
const filePickerNodes = dropboxPickerNodesFromOpenedDirectory(dropboxDirectory, "file");
assert.deepEqual(directoryPickerNodes.map((node) => node.path), ["/Cloud/Archive"]);
assert.deepEqual(filePickerNodes.map((node) => node.path), ["/Cloud/Archive", "/Cloud/plan.md"]);
assert.deepEqual(
  filePickerNodes.map((node) => [
    node.children.length,
    node.isExpanded,
    node.isLoaded,
    node.isLoading,
    node.error,
  ]),
  [
    [0, false, false, false, ""],
    [0, false, false, false, ""],
  ],
);
assert.equal(firstDropboxMarkdownFileEntry(dropboxDirectory)?.path, "/Cloud/plan.md");

const pickerChild = dropboxPickerNodeFromEntry({
  kind: "directory",
  path: "/Cloud/Archive/2025",
  title: "2025",
});
const pickerRoot = {
  ...directoryPickerNodes[0],
  isExpanded: true,
  children: [pickerChild],
};
assert.deepEqual(
  flattenDropboxDirectoryPickerNodes([pickerRoot]).map(({ node, depth }) => [node.path, depth]),
  [
    ["/Cloud/Archive", 0],
    ["/Cloud/Archive/2025", 1],
  ],
);
const updatedPickerNodes = updateDropboxDirectoryPickerNode(
  [pickerRoot],
  pickerChild.path,
  (node) => ({ ...node, error: "updated" }),
);
assert.equal(pickerChild.error, "");
assert.equal(updatedPickerNodes[0].children[0].error, "updated");
assert.notEqual(updatedPickerNodes[0], pickerRoot);

const rootDirectory: WorkspaceEntry = {
  kind: "directory",
  id: "directory:/Notes",
  title: "Notes",
  path: "/Notes",
  depth: 1,
  source: "local",
};
const childDirectory: WorkspaceEntry = {
  kind: "directory",
  id: "directory:/Notes/Archive",
  title: "Archive",
  path: "/Notes/Archive",
  depth: 2,
  source: "local",
};
const archivedFile: WorkspaceFileEntry = {
  kind: "file",
  id: "file:/Notes/Archive/old.md",
  title: "Old",
  path: "/Notes/Archive/old.md",
  documentId: "/Notes/Archive/old.md",
  depth: 3,
  source: "local",
};
const siblingFile: WorkspaceFileEntry = {
  kind: "file",
  id: "file:/outside.md",
  title: "Outside",
  path: "/outside.md",
  documentId: "/outside.md",
  depth: 1,
  source: "local",
};
const treeEntries = [rootDirectory, childDirectory, archivedFile, siblingFile];

assert.equal(directoryTreeKey(childDirectory), "local:/Notes/Archive");
assert.equal(workspaceEntrySelectionKey(archivedFile), "file:local:/Notes/Archive/old.md");
assert.deepEqual(collectVisibleDescendantDirectoryKeys(treeEntries, rootDirectory), [
  "local:/Notes/Archive",
]);
assert.deepEqual(
  collapseWorkspaceDirectory(treeEntries, rootDirectory).map((entry) => entry.path),
  ["/Notes", "/outside.md"],
);
assert.deepEqual(
  insertWorkspaceDirectoryChildren(treeEntries, rootDirectory, [
    { ...childDirectory, path: "/Notes/New", id: "directory:/Notes/New", title: "New" },
  ]).map((entry) => entry.path),
  ["/Notes", "/Notes/New", "/outside.md"],
);

const renamedArchivedFile: WorkspaceFileEntry = {
  ...archivedFile,
  id: "file:/Notes/Archive/renamed.md",
  title: "Renamed",
  path: "/Notes/Archive/renamed.md",
  modifiedAt: 500,
};
const updatedEntries = insertOrUpdateWorkspaceFileEntry(
  treeEntries,
  renamedArchivedFile,
  "/Notes",
);
assert.deepEqual(updatedEntries[2], { ...renamedArchivedFile, depth: 3 });

const newNestedFile: WorkspaceFileEntry = {
  kind: "file",
  id: "file:/Notes/Archive/new.md",
  title: "New",
  path: "/Notes/Archive/new.md",
  documentId: "/Notes/Archive/new.md",
  source: "local",
};
assert.deepEqual(
  insertOrUpdateWorkspaceFileEntry(treeEntries, newNestedFile, "/Notes").map((entry) => [
    entry.path,
    entry.depth,
  ]),
  [
    ["/Notes", 1],
    ["/Notes/Archive", 2],
    ["/Notes/Archive/old.md", 3],
    ["/Notes/Archive/new.md", 3],
    ["/outside.md", 1],
  ],
);

const searchEntries: WorkspaceEntry[] = [
  rootDirectory,
  { ...childDirectory, title: "Travel" },
  {
    ...archivedFile,
    title: "Japan Plan",
    path: "/Notes/Archive/japan.md",
    id: "file:/Notes/Archive/japan.md",
    documentId: "/Notes/Archive/japan.md",
  },
  siblingFile,
];
assert.equal(filterWorkspaceEntriesForSearch(searchEntries, " "), searchEntries);
assert.deepEqual(
  filterWorkspaceEntriesForSearch(searchEntries, "japan plan").map((entry) => entry.path),
  ["/Notes", "/Notes/Archive", "/Notes/Archive/japan.md"],
);
assert.deepEqual(
  filterWorkspaceEntriesForSearch(searchEntries, "travel").map((entry) => entry.path),
  ["/Notes", "/Notes/Archive", "/Notes/Archive/japan.md"],
);

console.log("workspace entry transformations regression: PASS");
