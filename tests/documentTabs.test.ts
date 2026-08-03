import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  availableDocumentTabSession,
  createDocumentTabSession,
  documentTabIdsAfterClosingOthers,
  documentTabIdAtPoint,
  parseDocumentTabSession,
} from "../src/documentTabs.ts";

assert.deepEqual(
  documentTabIdsAfterClosingOthers(["first", "second", "third"], "second"),
  ["second"],
);
assert.deepEqual(documentTabIdsAfterClosingOthers(["first"], "missing"), ["first"]);

const tabHitTargets = [
  { documentId: "first", left: 0, right: 100, top: 0, bottom: 30 },
  { documentId: "second", left: 103, right: 203, top: 0, bottom: 30 },
  { documentId: "third", left: 206, right: 306, top: 0, bottom: 30 },
];
assert.equal(documentTabIdAtPoint(tabHitTargets, 150, 15, "first"), "second");
assert.equal(documentTabIdAtPoint(tabHitTargets, 204, 15, "first"), "first");

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
const workspaceStorageHelper = appSource.match(
  /function currentWindowWorkspaceStorage\(\) \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(workspaceStorageHelper, "window workspace storage helper should exist");
assert.match(workspaceStorageHelper, /new URLSearchParams\(window\.location\.search\)/);
assert.match(workspaceStorageHelper, /if \(!isSecondaryWindow\) return window\.localStorage/);
assert.match(workspaceStorageHelper, /workspaceStorageKeys\.forEach/);
assert.match(workspaceStorageHelper, /window\.localStorage\.getItem\(key\)/);
assert.match(workspaceStorageHelper, /window\.sessionStorage\.setItem\(key, value\)/);
assert.match(workspaceStorageHelper, /return window\.sessionStorage/);
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
  /documentsRef\.current = loadedDocuments;\n    setDocuments\(loadedDocuments\);/,
  "workspace documents must be available before the restored tab session is merged",
);
assert.match(
  appSource,
  /if \(tabSession\) \{\n      const sessionRestored = await restoreDropboxDocumentTabSession\(tabSession\);[\s\S]*?rememberDocumentTabSession\(null\);/,
);
assert.match(
  appSource,
  /const loaded = await invoke<OpenDropboxMarkdownFileResult>\("open_dropbox_markdown_file",[\s\S]*?if \(options\.openedDirectory\) \{\n        applyOpenedDropboxDirectory\(options\.openedDirectory\);\n      \}\n      applyLoadedDropboxFile\(loaded, \{\n        replaceDocuments: Boolean\(options\.openedDirectory\),/,
);
assert.match(
  appSource,
  /const filePath =\n        location\.kind === "file"[\s\S]*?if \(filePath\) \{\n        await openDropboxMarkdownFilePath\(filePath, \{\n          allowPendingConnection: connected,\n          openedDirectory,\n        \}\);\n      \} else \{\n        applyOpenedDropboxDirectory\(openedDirectory\);\n      \}/,
);
assert.match(
  appSource,
  /documentTabIdAtPoint\([\s\S]*?getBoundingClientRect\(\)[\s\S]*?event\.clientX[\s\S]*?event\.clientY/,
  "desktop tab activation must resolve the document from the visible tab bounds",
);
assert.match(
  appSource,
  /const pointerActivatedDocumentId = documentTabPointerActivationRef\.current;[\s\S]*?if \(pointerActivatedDocumentId\) \{[\s\S]*?selectedDocumentIdRef\.current !== pointerActivatedDocumentId[\s\S]*?selectDocument\(pointerActivatedDocumentId/,
  "the follow-up click must not replace the pointer-resolved document with a stale hit target",
);

console.log("document tab close-others regression: PASS");
