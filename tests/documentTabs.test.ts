import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  availableDocumentTabSession,
  createDocumentTabSession,
  documentTabIdsAfterClosingOthers,
  parseDocumentTabSession,
} from "../src/documentTabs.ts";

assert.deepEqual(
  documentTabIdsAfterClosingOthers(["first", "second", "third"], "second"),
  ["second"],
);
assert.deepEqual(documentTabIdsAfterClosingOthers(["first"], "missing"), ["first"]);

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

console.log("document tab close-others regression: PASS");
