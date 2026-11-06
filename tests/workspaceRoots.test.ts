import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { WorkspaceEntry } from "../src/workspaceEntries.ts";
import {
  activateWorkspaceRootInList,
  liveWorkspaceRoot,
  mergeRestoredWorkspaceRoots,
  parseStoredWorkspaceRoots,
  removeWorkspaceRootFromList,
  setWorkspaceRootCollapsed,
  snapshotWorkspaceRoot,
  sortWorkspaceRootSnapshots,
  storedWorkspaceRootsFromOpenRoots,
  upsertActiveWorkspaceRoot,
  workspaceRootAfterRemoval,
  workspaceRootContainingPath,
  workspaceRootKey,
  workspaceRootListingFile,
  type OpenWorkspaceRoot,
} from "../src/workspaceRoots.ts";

function fileEntry(path: string, depth = 1): WorkspaceEntry {
  return {
    kind: "file",
    id: `file:${path}`,
    title: path.split("/").pop() ?? path,
    path,
    documentId: path,
    depth,
    source: "local",
  };
}

assert.equal(workspaceRootKey("local", "/notes/"), workspaceRootKey("local", "/notes"));
assert.notEqual(workspaceRootKey("local", "/notes"), workspaceRootKey("dropbox", "/notes"));

// Opening a second folder keeps the first one, with its tree stored, above the new current folder.
let roots = upsertActiveWorkspaceRoot([], { path: "/a", title: "a", source: "local" });
assert.equal(liveWorkspaceRoot(roots)?.path, "/a");
const aSnapshot = { entries: [fileEntry("/a/one.md")], expandedDirectoryKeys: ["local:/a/sub"] };
roots = snapshotWorkspaceRoot(roots, workspaceRootKey("local", "/a"), aSnapshot);
roots = upsertActiveWorkspaceRoot(roots, { path: "/b", title: "b", source: "local" });
assert.deepEqual(
  roots.map((root) => [root.path, root.snapshot !== null]),
  [
    ["/a", true],
    ["/b", false],
  ],
);
assert.equal(liveWorkspaceRoot(roots)?.path, "/b");

// A snapshot only replaces the live tree, never an older stored one.
const unchanged = snapshotWorkspaceRoot(roots, workspaceRootKey("local", "/a"), {
  entries: [],
  expandedDirectoryKeys: [],
});
assert.equal(unchanged[0].snapshot, aSnapshot);

// Reopening a listed folder refreshes it in place instead of adding it twice.
const reopened = upsertActiveWorkspaceRoot(roots, { path: "/a/", title: "a2", source: "local" });
assert.deepEqual(
  reopened.map((root) => [root.path, root.title, root.snapshot === null]),
  [
    ["/a/", "a2", true],
    ["/b", "b", true],
  ],
);

// Collapsing survives making a folder current again.
roots = setWorkspaceRootCollapsed(roots, workspaceRootKey("local", "/a"), true);
const activated = activateWorkspaceRootInList(roots, workspaceRootKey("local", "/a"));
assert.equal(activated[0].snapshot, null);
assert.equal(activated[0].collapsed, true);

// Removing the current folder hands over to the next folder, else the previous one.
const three: OpenWorkspaceRoot[] = ["/a", "/b", "/c"].map((path) => ({
  key: workspaceRootKey("local", path),
  path,
  title: path.slice(1),
  source: "local",
  collapsed: false,
  snapshot: null,
}));
assert.equal(workspaceRootAfterRemoval(three, workspaceRootKey("local", "/b"))?.path, "/c");
assert.equal(workspaceRootAfterRemoval(three, workspaceRootKey("local", "/c"))?.path, "/b");
assert.equal(workspaceRootAfterRemoval(three, "missing"), null);
assert.deepEqual(
  removeWorkspaceRootFromList(three, workspaceRootKey("local", "/b")).map((root) => root.path),
  ["/a", "/c"],
);

// A file belongs to the deepest listed folder that contains it.
const nested: OpenWorkspaceRoot[] = [
  { ...three[0], path: "/notes", key: workspaceRootKey("local", "/notes") },
  { ...three[1], path: "/notes/work", key: workspaceRootKey("local", "/notes/work") },
];
assert.equal(workspaceRootContainingPath(nested, "/notes/work/plan.md")?.path, "/notes/work");
assert.equal(workspaceRootContainingPath(nested, "/notes/home.md")?.path, "/notes");
assert.equal(workspaceRootContainingPath(nested, "/elsewhere/file.md"), null);
assert.equal(workspaceRootContainingPath(nested, "/notesx/file.md"), null);

// A file already listed in a folder's tree is found in the live tree and in stored trees.
const listing: OpenWorkspaceRoot[] = [
  { ...three[0], snapshot: { entries: [fileEntry("/a/one.md")], expandedDirectoryKeys: [] } },
  { ...three[1], snapshot: null },
];
assert.equal(workspaceRootListingFile(listing, [fileEntry("/b/two.md")], "/a/one.md")?.path, "/a");
assert.equal(workspaceRootListingFile(listing, [fileEntry("/b/two.md")], "/b/two.md")?.path, "/b");
assert.equal(workspaceRootListingFile(listing, [], "/b/three.md"), null);

// Changing the sort order reorders the stored trees as well.
const sorted = sortWorkspaceRootSnapshots(listing, (entries) => [...entries].reverse());
assert.notEqual(sorted[0].snapshot, listing[0].snapshot);
assert.equal(sorted[1], listing[1]);

// Only local folders are remembered, in order, with their collapsed state.
assert.deepEqual(
  storedWorkspaceRootsFromOpenRoots([
    { ...three[0], collapsed: true },
    { ...three[1], source: "dropbox" },
  ]),
  [{ path: "/a", title: "a", collapsed: true }],
);
assert.deepEqual(parseStoredWorkspaceRoots(null), []);
assert.deepEqual(parseStoredWorkspaceRoots("not json"), []);
assert.deepEqual(parseStoredWorkspaceRoots('{"path":"/a"}'), []);
assert.deepEqual(
  parseStoredWorkspaceRoots(
    JSON.stringify([
      { path: "/a", title: "a", collapsed: true },
      { path: "/a/" },
      { path: "" },
      { title: "missing path" },
      { path: "/b" },
    ]),
  ),
  [
    { path: "/a", title: "a", collapsed: true },
    { path: "/b", title: "/b", collapsed: false },
  ],
);

// Restored folders return to their saved places around the folder that opened first.
const currentAfterStartup: OpenWorkspaceRoot[] = [{ ...three[1], snapshot: null }];
const restored = mergeRestoredWorkspaceRoots(
  currentAfterStartup,
  [
    { path: "/a", title: "a", collapsed: false },
    { path: "/b", title: "b", collapsed: true },
    { path: "/c", title: "c", collapsed: false },
  ],
  [
    { ...three[0], snapshot: { entries: [], expandedDirectoryKeys: [] } },
    { ...three[2], snapshot: { entries: [], expandedDirectoryKeys: [] } },
  ],
);
assert.deepEqual(
  restored.map((root) => [root.path, root.collapsed, root.snapshot === null]),
  [
    ["/a", false, false],
    ["/b", true, true],
    ["/c", false, false],
  ],
);
// A folder opened while the others loaded stays listed after them.
const withNewFolder = mergeRestoredWorkspaceRoots(
  [{ ...three[1], snapshot: { entries: [], expandedDirectoryKeys: [] } }, { ...three[2] }],
  [{ path: "/b", title: "b", collapsed: false }],
  [],
);
assert.deepEqual(
  withNewFolder.map((root) => root.path),
  ["/b", "/c"],
);

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
function functionBody(name: string) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const end = app.indexOf("\n  }\n", start);
  return app.slice(start, end);
}

assert.match(
  functionBody("shouldAddWorkspaceRoot"),
  /!isMobileViewport &&\s*workspaceSourceRef\.current === "local" &&\s*workspaceRootPathRef\.current !== null/,
  "only desktop adds a local folder next to an open local folder",
);
assert.match(
  functionBody("openDirectoryPath"),
  /const addAsWorkspaceRoot = shouldAddWorkspaceRoot\(\);[\s\S]*applyOpenedDirectory\(openedDirectory, undefined, \{ addAsWorkspaceRoot \}\)/,
  "opening a folder keeps the folders already in the side panel",
);
assert.match(
  functionBody("openMarkdownFilePath"),
  /workspaceRootListingFile\([\s\S]*activateWorkspaceRoot\(listingRoot\.key\)[\s\S]*selectDocument\(listedDocument\.id, \{ tabBehavior: "add" \}\)/,
  "a file already listed in the side panel opens in its folder instead of adding the folder again",
);
const applyOpenedDirectoryBody = functionBody("applyOpenedDirectory");
assert.match(
  applyOpenedDirectoryBody,
  /if \(addAsWorkspaceRoot\) \{[\s\S]*?!knownDocumentIds\.has\(loadedFile\.path\)[\s\S]*?upsertActiveWorkspaceRoot\(openWorkspaceRootsWithLiveSnapshot\(\), nextRoot\)/,
  "an added folder keeps already open files, including unsaved edits, and stores the previous folder's tree",
);
assert.match(
  applyOpenedDirectoryBody,
  /if \(addAsWorkspaceRoot\) \{\s*addDocumentTab\(documentToSelect\.id\);/,
  "an added folder opens its file in a new tab, keeping the tabs of the other folders",
);
assert.match(
  functionBody("applyOpenedDropboxDirectory"),
  /commitOpenWorkspaceRoots\(\[\]\);/,
  "Dropbox shows one folder at a time",
);
assert.match(
  app,
  /className=\{`document-row workspace-root-row[\s\S]*?onClick=\{\(\) => toggleWorkspaceRootCollapsed\(root\.key\)\}[\s\S]*?onContextMenu=\{\(event\) => openWorkspaceRootContextMenu\(root, event\)\}/,
  "each folder header collapses or expands its tree on click and offers removal on right click",
);
assert.match(
  app,
  /\{root\.collapsed\s*\? null\s*: rootEntries\.map\(\(entry, entryIndex\) =>\s*renderWorkspaceEntryRow\(entry, entryIndex, rootEntries, root\),/,
  "a collapsed folder hides its rows",
);
assert.match(
  app,
  /if \(root && rootSnapshot\) \{\s*openEntryInWorkspaceRoot\(root, entry, event\);/,
  "clicking a row of another folder makes that folder current first",
);

console.log("workspace roots regression: PASS");
