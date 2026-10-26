import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  availableDocumentTabIds,
  availableDocumentTabSession,
  createDocumentTabSession,
  documentTabClickSelection,
  documentTabIdsAfterOpening,
  documentTabIdAtPoint,
  documentTabsAfterClosing,
  documentTabsAfterClosingOthers,
  parseDocumentTabSession,
} from "../src/documentTabs.ts";

const availableTabIds = ["first", "second", "third", "fourth"];
const unchangedAvailableIds = ["first", "second"];
const filteredAvailableIds = availableDocumentTabIds(
  unchangedAvailableIds,
  availableTabIds,
);
assert.deepEqual(filteredAvailableIds, unchangedAvailableIds);
assert.notEqual(
  filteredAvailableIds,
  unchangedAvailableIds,
  "availability filtering must preserve its existing fresh-array behavior",
);
assert.deepEqual(
  availableDocumentTabIds(
    ["first", "missing", "first", "second"],
    availableTabIds,
  ),
  ["first", "second"],
);

const addExistingTabIds = ["first", "second"];
const addExistingResult = documentTabIdsAfterOpening(
  addExistingTabIds,
  "first",
  "second",
  "add",
  availableTabIds,
);
assert.deepEqual(addExistingResult, addExistingTabIds);
assert.notEqual(
  addExistingResult,
  addExistingTabIds,
  "add mode must preserve its existing fresh-array behavior",
);
assert.deepEqual(
  documentTabIdsAfterOpening(
    ["first", "second"],
    "first",
    "third",
    "add",
    availableTabIds,
  ),
  ["first", "second", "third"],
);
assert.deepEqual(
  documentTabIdsAfterOpening(
    ["first", "missing"],
    "first",
    "unavailable",
    "add",
    availableTabIds,
  ),
  ["first"],
);

const replaceExistingTabIds = ["first", "second"];
assert.equal(
  documentTabIdsAfterOpening(
    replaceExistingTabIds,
    "first",
    "second",
    "replace",
    availableTabIds,
  ),
  replaceExistingTabIds,
  "replace mode must retain the current array when the target is already open",
);
assert.deepEqual(
  documentTabIdsAfterOpening(
    ["first", "second", "third"],
    "second",
    "fourth",
    "replace",
    availableTabIds,
  ),
  ["first", "fourth", "third"],
);
assert.deepEqual(
  documentTabIdsAfterOpening(
    ["first", "second"],
    "missing",
    "third",
    "replace",
    availableTabIds,
  ),
  ["third", "first", "second"],
);
assert.deepEqual(
  documentTabIdsAfterOpening([], "missing", "third", "replace", availableTabIds),
  ["third"],
);
assert.deepEqual(
  documentTabIdsAfterOpening(
    ["first", "second"],
    "first",
    "unavailable",
    "replace",
    availableTabIds,
  ),
  ["second"],
);

const missingCloseTabIds = ["first", "second"];
const missingCloseResult = documentTabsAfterClosing(
  missingCloseTabIds,
  "first",
  "missing",
);
assert.equal(missingCloseResult.openDocumentTabIds, missingCloseTabIds);
assert.deepEqual(missingCloseResult, { openDocumentTabIds: missingCloseTabIds });
assert.deepEqual(
  documentTabsAfterClosing(["first", "second", "third"], "first", "third"),
  { openDocumentTabIds: ["first", "second"] },
);
assert.deepEqual(
  documentTabsAfterClosing(["first", "second", "third"], "second", "second"),
  {
    openDocumentTabIds: ["first", "third"],
    nextActiveDocumentId: "third",
  },
);
assert.deepEqual(
  documentTabsAfterClosing(["first", "second", "third"], "first", "first"),
  {
    openDocumentTabIds: ["second", "third"],
    nextActiveDocumentId: "second",
  },
);
assert.deepEqual(
  documentTabsAfterClosing(["first", "second", "third"], "third", "third"),
  {
    openDocumentTabIds: ["first", "second"],
    nextActiveDocumentId: "second",
  },
);
assert.deepEqual(documentTabsAfterClosing(["first"], "first", "first"), {
  openDocumentTabIds: [],
  nextActiveDocumentId: null,
});

const missingCloseOthersTabIds = ["first", "second"];
const missingCloseOthersResult = documentTabsAfterClosingOthers(
  missingCloseOthersTabIds,
  "first",
  "missing",
);
assert.equal(missingCloseOthersResult.openDocumentTabIds, missingCloseOthersTabIds);
assert.deepEqual(missingCloseOthersResult, {
  openDocumentTabIds: missingCloseOthersTabIds,
});
assert.deepEqual(
  documentTabsAfterClosingOthers(
    ["first", "second", "third"],
    "first",
    "second",
  ),
  {
    openDocumentTabIds: ["second"],
    nextActiveDocumentId: "second",
  },
);
assert.deepEqual(
  documentTabsAfterClosingOthers(
    ["first", "second", "third"],
    "second",
    "second",
  ),
  { openDocumentTabIds: ["second"] },
);
const singleCloseOthersTabIds = ["second"];
const singleCloseOthersResult = documentTabsAfterClosingOthers(
  singleCloseOthersTabIds,
  "second",
  "second",
);
assert.deepEqual(singleCloseOthersResult, { openDocumentTabIds: ["second"] });
assert.notEqual(
  singleCloseOthersResult.openDocumentTabIds,
  singleCloseOthersTabIds,
  "an existing close-others target must preserve its existing fresh-array behavior",
);

const tabHitTargets = [
  { documentId: "first", left: 0, right: 100, top: 0, bottom: 30 },
  { documentId: "second", left: 103, right: 203, top: 0, bottom: 30 },
  { documentId: "third", left: 206, right: 306, top: 0, bottom: 30 },
];
assert.equal(documentTabIdAtPoint(tabHitTargets, 150, 15, "first"), "second");
assert.equal(documentTabIdAtPoint(tabHitTargets, 204, 15, "first"), "first");

assert.deepEqual(documentTabClickSelection("second", "first", true), {
  documentId: "second",
  shouldSelect: false,
});
assert.deepEqual(documentTabClickSelection("second", "first", false), {
  documentId: "first",
  shouldSelect: true,
});
assert.deepEqual(documentTabClickSelection("", "first", true), {
  documentId: "first",
  shouldSelect: true,
});
assert.deepEqual(documentTabClickSelection("", "first", false), {
  documentId: "first",
  shouldSelect: true,
});

const savedSession = createDocumentTabSession(
  "local",
  "/workspace",
  ["/workspace/first.md", "/workspace/second.md", "/workspace/first.md"],
  "/workspace/second.md",
);
assert.deepEqual(savedSession, {
  version: 1,
  source: "local",
  workspacePath: "/workspace",
  openDocumentPaths: ["/workspace/first.md", "/workspace/second.md"],
  activeDocumentPath: "/workspace/second.md",
});
assert.deepEqual(parseDocumentTabSession(JSON.stringify(savedSession)), savedSession);
const tabSessionFixture = readFileSync(
  new URL("./fixtures/document-tab-session-v1.json", import.meta.url),
  "utf8",
);
assert.deepEqual(parseDocumentTabSession(tabSessionFixture), {
  version: 1,
  source: "local",
  workspacePath: "/fixtures/workspace",
  openDocumentPaths: [
    "/fixtures/workspace/first.md",
    "/fixtures/workspace/second.md",
  ],
  activeDocumentPath: "/fixtures/workspace/second.md",
});
assert.equal(
  JSON.stringify(parseDocumentTabSession(tabSessionFixture)),
  JSON.stringify(JSON.parse(tabSessionFixture)),
);
assert.equal(parseDocumentTabSession("{invalid"), null);
assert.equal(parseDocumentTabSession(JSON.stringify({ version: 1, source: "local" })), null);

assert.deepEqual(
  availableDocumentTabSession(savedSession!, ["/workspace/first.md"]),
  {
    openDocumentPaths: ["/workspace/first.md"],
    activeDocumentPath: "/workspace/first.md",
  },
);
assert.deepEqual(
  availableDocumentTabSession(savedSession!, []),
  {
    openDocumentPaths: [],
    activeDocumentPath: "",
  },
);
const deletedActiveSession = createDocumentTabSession(
  "local",
  "/workspace",
  [
    "/workspace/first.md",
    "/workspace/second.md",
    "/workspace/deleted-active.md",
  ],
  "/workspace/deleted-active.md",
);
assert.deepEqual(
  availableDocumentTabSession(deletedActiveSession!, [
    "/workspace/second.md",
    "/workspace/first.md",
  ]),
  {
    openDocumentPaths: ["/workspace/first.md", "/workspace/second.md"],
    activeDocumentPath: "/workspace/first.md",
  },
);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gatewaySource = readFileSync(
  new URL("../src/tauriGateway.ts", import.meta.url),
  "utf8",
);
assert.match(
  appSource,
  /const appWindow = getCurrentWindow\(\);[\s\S]*?appWindow\.listen<OpenLocationEventPayload>\("scholium-open-location"/,
  "desktop menu events must be scoped to the current Scholium window",
);

const tauriSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
assert.match(
  tauriSource,
  /window_config\.url =\s*tauri::WebviewUrl::App\("index\.html\?scholium-window=secondary"\.into\(\)\);/,
  "new desktop windows must carry an explicit independent-workspace marker",
);
assert.match(
  tauriSource,
  /struct FocusedWindowState\(Mutex<Option<String>>\);/,
  "desktop menu routing must remember the last focused Scholium window",
);
assert.doesNotMatch(
  tauriSource,
  /#\[cfg\(desktop\)\]\s*#\[derive\(Default\)\]\s*struct FocusedWindowState/,
  "shared window state must remain available when the mobile builder registers it",
);
assert.match(
  tauriSource,
  /last_focused_label\.or_else\(\|\| webview_windows\.keys\(\)\.next\(\)\.cloned\(\)\)/,
  "desktop menu routing must prefer the remembered window while the app menu owns focus",
);

const workspacePersistenceHelpers = appSource.slice(
  appSource.indexOf("function readLastOpenedMarkdownPath()"),
  appSource.indexOf("function browserAppearsOffline()"),
);
assert.match(workspacePersistenceHelpers, /currentWindowWorkspaceStorage\(\)/);
assert.doesNotMatch(
  workspacePersistenceHelpers,
  /window\.(?:localStorage|sessionStorage)/,
  "workspace and open-file state must use storage isolated to the current window",
);
const sessionPersistenceEffect = appSource.match(
  /useEffect\(\(\) => \{\n    if \(\n      !nativeStorageAvailable \|\|\n      !documentTabSessionRestoreCompleted[\s\S]*?\n  \}, \[\n    documents,\n    documentTabSessionRestoreCompleted,[\s\S]*?\n  \]\);/,
)?.[0];
assert.ok(sessionPersistenceEffect, "document tab session persistence effect should exist");
assert.match(sessionPersistenceEffect, /rememberDocumentTabSession\(/);
assert.doesNotMatch(sessionPersistenceEffect, /beforeunload|pagehide|visibilitychange/);
assert.match(
  appSource,
  /const loadedTabSession = tabSession[\s\S]*?restoredSelectedPath = loadedTabSession[\s\S]*?applyOpenedDirectory/,
);
assert.match(
  appSource,
  /const nextDocuments = \[\.\.\.loadedDocuments, \.\.\.draftState\.documents\];\n\n    documentsRef\.current = nextDocuments;\n    setDocuments\(nextDocuments\);/,
  "workspace documents must be available before the restored tab session is merged",
);
assert.match(
  appSource,
  /async function closeAllDocumentTabs\(\) \{[\s\S]*?prepareDraftDocumentForLeaving\(currentId\);\n      if \(result\.status === "blocked"\) return;[\s\S]*?openDocumentTabIdsRef\.current = \[\];[\s\S]*?setOpenDocumentTabIds\(\[\]\);[\s\S]*?clearActiveDocumentSelection\(\);/,
);
assert.match(
  appSource,
  /id: "close-other-tabs",[\s\S]*?id: "close-all-tabs",[\s\S]*?label: t\("documentTab\.closeAll"\),[\s\S]*?void closeAllDocumentTabs\(\);[\s\S]*?id: "open-in-new-window",/,
);
assert.match(
  appSource,
  /if \(tabSession\) \{\n      const sessionRestored = await restoreDropboxDocumentTabSession\(tabSession\);[\s\S]*?rememberDocumentTabSession\(null\);/,
);
assert.match(
  gatewaySource,
  /export type OpenDropboxMarkdownFileArgs = \{ path: string \};[\s\S]*?export function openDropboxMarkdownFile\(args: OpenDropboxMarkdownFileArgs\) \{\n  return invoke<OpenDropboxMarkdownFileResult>\("open_dropbox_markdown_file", args\);\n\}/,
  "Dropbox file opening must retain its exact Tauri command and path argument contract",
);
assert.match(
  appSource,
  /const loaded = await openDropboxMarkdownFile\(\{\n        path,\n      \}\);[\s\S]*?if \(options\.openedDirectory\) \{\n        applyOpenedDropboxDirectory\(options\.openedDirectory\);\n      \}\n      applyLoadedDropboxFile\(loaded, \{\n        replaceDocuments: Boolean\(options\.openedDirectory\),/,
  "Dropbox file loading must still precede directory and document state application",
);
assert.match(
  appSource,
  /const filePath =\n        location\.kind === "file"[\s\S]*?if \(filePath\) \{\n        await openDropboxMarkdownFilePath\(filePath, \{\n          allowPendingConnection: connected,\n          onNotFound: [^\n]+\n          openedDirectory,\n        \}\);\n      \} else \{\n        applyOpenedDropboxDirectory\(openedDirectory\);\n      \}/,
);
assert.match(
  appSource,
  /documentTabIdAtPoint\([\s\S]*?getBoundingClientRect\(\)[\s\S]*?event\.clientX[\s\S]*?event\.clientY/,
  "desktop tab activation must resolve the document from the visible tab bounds",
);
console.log("document tab close-others regression: PASS");
