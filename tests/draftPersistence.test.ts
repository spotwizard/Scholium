import assert from "node:assert/strict";
import fs from "node:fs";
import {
  draftDocumentCreatedAt,
  parseStoredDraftDocument,
  serializeStoredDraftDocument,
} from "../src/draftDocuments.ts";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const rust = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

const stored = serializeStoredDraftDocument({
  id: "draft:local:1700000000000:abc",
  title: "未命名",
  body: "morning work",
  notes: [{ id: "note-1" }],
  glossaryTerms: [],
  glossaryBindings: [],
});
assert.deepEqual(parseStoredDraftDocument(stored), {
  version: 1,
  id: "draft:local:1700000000000:abc",
  title: "未命名",
  body: "morning work",
  notes: [{ id: "note-1" }],
  glossaryTerms: [],
  glossaryBindings: [],
});
assert.equal(parseStoredDraftDocument("{broken"), null);
assert.equal(
  parseStoredDraftDocument(JSON.stringify({ version: 1, id: "/notes/a.md", title: "", body: "" })),
  null,
  "only unnamed drafts can be restored",
);
assert.equal(draftDocumentCreatedAt("draft:dropbox:1700000000123:xyz"), 1700000000123);

// Stored drafts are deleted only after "不新增", closing an empty unnamed tab, or creating the file.
const forgetCalls = [...app.matchAll(/forgetStoredDraftDocument\(([^)]*)\);/g)].map(
  (match) => match[1],
);
assert.deepEqual(forgetCalls.sort(), [
  "documentToLeave.id",
  "documentToSave.id",
  "documentToSave.id",
  "draftFileDialog.documentId",
]);
assert.match(
  app,
  /removeDocumentsFromWorkspace\(\[draftFileDialog\.documentId\]\);\n    forgetStoredDraftDocument\(draftFileDialog\.documentId\);/,
);
assert.match(
  app,
  /!draftDocumentHasContent\([\s\S]*?removeDocumentsFromWorkspace\(\[documentToLeave\.id\]\);\n      forgetStoredDraftDocument\(documentToLeave\.id\);/,
);
assert.match(
  app,
  /replaceDraftWithLoadedLocalFile\(documentToSave\.id, loaded\);\n      forgetStoredDraftDocument\(documentToSave\.id\);/,
);
assert.match(
  app,
  /replaceDraftWithLoadedDropboxFile\(documentToSave\.id, saved\);\n        forgetStoredDraftDocument\(documentToSave\.id\);/,
);

assert.match(
  app,
  /draftStoreTimerRef\.current = window\.setTimeout\(\(\) => \{\n      draftStoreTimerRef\.current = 0;\n      storeChangedDraftDocuments\(\);\n    \}, 300\);/,
  "unnamed file content is written to disk while the user types",
);
assert.match(
  app,
  /storedDraftsRestoredRef\.current = true;[\s\S]*?if \(getCurrentWindow\(\)\.label !== "main"\) return;\n    void restoreStoredDraftDocuments\(\);/,
  "the first window reopens stored unnamed files after startup",
);
assert.match(
  app,
  /function resetDocumentTabs\(documentId: string\) \{[\s\S]*?currentIds\.filter\(\n\s*\(currentId\) => currentId !== documentId && isDraftDocumentId\(currentId\),/,
  "opening another folder keeps unnamed tabs",
);
assert.match(app, /if \(!document \|\| isDraftDocumentId\(document\.id\)\) return \[\];/);
assert.match(rust, /const DRAFT_STORE_DIRECTORY: &str = "drafts";/);

console.log("draft persistence regression: PASS");
