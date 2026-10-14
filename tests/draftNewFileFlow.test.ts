import assert from "node:assert/strict";
import fs from "node:fs";
import {
  draftDocumentHasContent,
  draftDocumentId,
  draftDocumentSource,
  isDraftDocumentId,
} from "../src/draftDocuments.ts";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../src/tauriGateway.ts", import.meta.url), "utf8");
const translations = fs.readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");

function functionBody(name: string) {
  const match = app.match(
    new RegExp(`async function ${name}\\([^)]*\\)(?::[^\\{]+)? \\{([\\s\\S]*?)\\n  \\}`),
  );
  assert.ok(match, `${name} should exist`);
  return match[1];
}

const newMarkdownFileBody = functionBody("newMarkdownFile");
assert.match(newMarkdownFileBody, /createDraftMarkdownDocument\(/);
assert.match(
  newMarkdownFileBody,
  /if \(isMobileViewport && workspaceSource && workspaceRootPath !== null\) \{[\s\S]*?openCreateEntryDialog\("file"\);[\s\S]*?return;/,
  "desktop new files open as unnamed tabs; only mobile asks for a name first",
);
assert.doesNotMatch(newMarkdownFileBody, /window\.prompt/);

const createLocalMarkdownFileBody = functionBody("createLocalMarkdownFile");
assert.match(createLocalMarkdownFileBody, /workspaceSource !== "local" \|\| workspaceRootPath === null/);
assert.match(createLocalMarkdownFileBody, /setStorageError\(t\("error\.fileNameNoFolders"\)\)/);
assert.match(createLocalMarkdownFileBody, /await openMarkdownFile\(\{\s*path\s*\}\);[\s\S]*?setStorageError\(t\("error\.fileExists"\)\);/);
assert.match(
  createLocalMarkdownFileBody,
  /const saved = await saveMarkdownFile\(\{\s*path,\s*body: "",\s*notes: \[\],\s*glossaryTerms: \[\],\s*glossaryBindings: \[\],\s*\}\);/,
);
assert.match(createLocalMarkdownFileBody, /applyLoadedFiles\(\[loaded\], \{ sortEntries: true \}\)/);

const createDropboxMarkdownFileBody = functionBody("createDropboxMarkdownFile");
assert.match(createDropboxMarkdownFileBody, /setActiveDocumentModeState\(\{\s*editorMode:\s*"preview"\s*\}\)/);
assert.doesNotMatch(createDropboxMarkdownFileBody, /setActiveDocumentModeState\(\{\s*editorMode:\s*"edit"\s*\}\)/);

const openCreateEntryDialogBody = app.match(
  /function openCreateEntryDialog\([^)]*\) \{([\s\S]*?)\n  \}/,
)?.[1];
assert.ok(openCreateEntryDialogBody, "openCreateEntryDialog should exist");
assert.match(
  openCreateEntryDialogBody,
  /setCreateEntryDialog\(\{\s*kind,\s*name: kind === "file" \? stripMarkdownExtension\(t\("app\.untitledFile"\)\) : "",\s*isSubmitting: false,\s*\}\)/,
);
assert.doesNotMatch(openCreateEntryDialogBody, /void newMarkdownFile\(\)/);

const submitCreateEntryBody = functionBody("submitCreateEntry");
assert.match(
  submitCreateEntryBody,
  /createEntryDialog\.kind === "file"\s*\?\s*workspaceSource === "dropbox"\s*\?\s*await createDropboxMarkdownFile\(createEntryDialog\.name\)\s*:\s*await createLocalMarkdownFile\(createEntryDialog\.name\)\s*:\s*await createWorkspaceFolder\(createEntryDialog\.name\)/,
);

const createDraftMarkdownDocumentBody = app.match(
  /function createDraftMarkdownDocument\([^)]*\) \{([\s\S]*?)\n  \}/,
)?.[1];
assert.ok(createDraftMarkdownDocumentBody, "createDraftMarkdownDocument should exist");
assert.match(
  createDraftMarkdownDocumentBody,
  /setActiveDocumentModeState\(\{\s*editorMode:\s*"preview"\s*\}\)/,
);
assert.doesNotMatch(
  createDraftMarkdownDocumentBody,
  /setActiveDocumentModeState\(\{\s*editorMode:\s*"edit"\s*\}\)/,
);

const saveDraftDocumentBody = functionBody("saveDraftDocument");
assert.match(app, /type DraftDocumentSaveResult =/);
assert.doesNotMatch(saveDraftDocumentBody, /window\.prompt/);
assert.match(saveDraftDocumentBody, /return \{ status: "failed", message: t\("error\.fileNameRequired"\) \}/);
assert.match(saveDraftDocumentBody, /return \{ status: "failed", message: t\("error\.fileNameNoFolders"\) \}/);
assert.match(
  saveDraftDocumentBody,
  /if \(workspaceSource === "local" && workspaceRootPath !== null\) \{\n        path = filePathInDirectory\(workspaceRootPath, markdownFileName\);[\s\S]*?await openMarkdownFile\(\{ path \}\);\n          return \{ status: "failed", message: t\("error\.fileExists"\) \};/,
  "a named draft in an open local folder is created there without overwriting an existing file",
);
assert.match(
  saveDraftDocumentBody,
  /const selectedPath = await save\(\{\n          defaultPath: markdownFileName,[\s\S]*?if \(!selectedPath\) return \{ status: "cancelled" \};/,
);
assert.match(
  saveDraftDocumentBody,
  /const created = await createDropboxMarkdownFileRequest\(\{\s*parentPath: workspaceRootPath,\s*fileName: trimmedFileName,\s*\}\);/,
);
assert.match(
  saveDraftDocumentBody,
  /const saved = await saveDropboxMarkdownFile\(\{\s*path: created\.path,\s*body: documentToSave\.body,\s*rev: created\.rev \?\? null,\s*notes: notesToSave,\s*glossaryTerms: glossaryTermsToSave,\s*glossaryBindings: glossaryBindingsToSave,\s*\}\);/,
);
assert.match(
  saveDraftDocumentBody,
  /const saved = await saveMarkdownFile\(\{\s*path,\s*body: documentToSave\.body,\s*notes: notesToSave,\s*glossaryTerms: glossaryTermsToSave,\s*glossaryBindings: glossaryBindingsToSave,\s*\}\);/,
);
assert.match(
  gateway,
  /export function createDropboxMarkdownFile\(args: CreateMarkdownFileArgs\) \{\n  return invoke<OpenDropboxMarkdownFileResult>\("create_dropbox_markdown_file", args\);\n\}/,
);
assert.match(
  gateway,
  /export function saveDropboxMarkdownFile\(args: SaveDropboxMarkdownFileArgs\) \{\n  return invoke<OpenDropboxMarkdownFileResult>\("save_dropbox_markdown_file", args\);\n\}/,
);
assert.match(
  gateway,
  /export function saveMarkdownFile\(args: SaveMarkdownFileArgs\) \{\n  return invoke<SaveMarkdownFileResult>\("save_markdown_file", args\);\n\}/,
);

const localDraftId = draftDocumentId(null);
const dropboxDraftId = draftDocumentId("dropbox");
assert.equal(isDraftDocumentId(localDraftId), true);
assert.equal(isDraftDocumentId(dropboxDraftId), true);
assert.equal(isDraftDocumentId("/notes/file.md"), false);
assert.equal(draftDocumentSource(localDraftId), "local");
assert.equal(draftDocumentSource(dropboxDraftId), "dropbox");
assert.equal(draftDocumentHasContent("   ", 0, 0), false);
assert.equal(draftDocumentHasContent("content", 0, 0), true);
assert.equal(draftDocumentHasContent("", 1, 0), true);
assert.equal(draftDocumentHasContent("", 0, 1), true);
assert.doesNotMatch(app, /confirm\.saveDraftFile|confirm\.discardDraftFile/);

const prepareDraftBody = functionBody("prepareDraftDocumentForLeaving");
assert.match(
  prepareDraftBody,
  /if \(\n      !draftDocumentHasContent\([\s\S]*?removeDocumentsFromWorkspace\(\[documentToLeave\.id\]\);\n      forgetStoredDraftDocument\(documentToLeave\.id\);\n      return \{ status: "discarded" \};/,
  "an empty unnamed file closes without asking",
);
assert.match(prepareDraftBody, /await requestDraftFileDecision\(documentToLeave\.id, "close"\)/);
assert.match(
  prepareDraftBody,
  /decision\.action === "created"\) \{\n      return \{ status: "saved", documentId: decision\.documentId \};/,
);
assert.match(
  prepareDraftBody,
  /return \{ status: decision\.action === "discarded" \? "discarded" : "blocked" \};/,
);

assert.match(
  app,
  /event\.key\.toLowerCase\(\) === "s"[\s\S]*?if \(documentToSave && isDraftDocumentId\(documentToSave\.id\)\) \{[\s\S]*?void requestDraftFileDecision\(documentToSave\.id, "save"\);/,
  "the save shortcut asks for a name instead of saving an unnamed file directly",
);

const cancelDraftDialogBody = app.match(/function cancelDraftFileDialog\(\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(cancelDraftDialogBody);
assert.match(cancelDraftDialogBody, /finishDraftFileDialog\(\{ action: "cancelled" \}\)/);
assert.doesNotMatch(cancelDraftDialogBody, /removeDocumentsFromWorkspace/);

const discardDraftDialogBody = app.match(
  /function discardDraftFileDialogDocument\(\) \{([\s\S]*?)\n  \}/,
)?.[1];
assert.ok(discardDraftDialogBody);
assert.match(
  discardDraftDialogBody,
  /removeDocumentsFromWorkspace\(\[draftFileDialog\.documentId\]\);\n    forgetStoredDraftDocument\(draftFileDialog\.documentId\);\n    finishDraftFileDialog\(\{ action: "discarded" \}\);/,
);

const submitDraftDialogBody = functionBody("submitDraftFileDialog");
assert.match(
  submitDraftDialogBody,
  /const result = await saveDraftDocument\(documentToSave, draftFileDialog\.name\);\n    if \(result\.status === "saved"\) \{\n      finishDraftFileDialog\(\{ action: "created", documentId: result\.documentId \}\);/,
);
assert.match(
  app,
  /onClick=\{cancelDraftFileDialog\}[\s\S]*?\{t\("duplicate\.cancel"\)\}[\s\S]*?onClick=\{discardDraftFileDialogDocument\}[\s\S]*?\{t\("draftFile\.discard"\)\}[\s\S]*?type="submit"[\s\S]*?t\("duplicate\.submit"\)/,
  "the naming dialog offers cancel, don't add and create",
);

assert.match(
  app,
  /getCurrentWindow\(\)\n      \.onCloseRequested\(async \(event\) => \{[\s\S]*?await windowCloseRequestHandlerRef\.current\(\);[\s\S]*?if \(!canClose\) \{\n          event\.preventDefault\(\);/,
  "closing the window asks about unnamed files first",
);
const windowCloseBody = functionBody("resolveDraftDocumentsBeforeWindowClose");
assert.match(
  windowCloseBody,
  /const result = await prepareDraftDocumentForLeaving\(documentId\);\n      if \(result\.status === "blocked"\) return false;/,
);
assert.match(
  app,
  /isDraftDocumentId\(selectedDocumentIdRef\.current\) \? "add" : "replace"/,
  "opening another file keeps the unnamed file's tab",
);
assert.match(
  app,
  /const hasBackingFile = Boolean\(document\.filePath\) \|\| documentIsFromDropbox\(document\);[\s\S]*?return hasBackingFile && hasDirtyState/,
);
assert.match(translations, /"draftFile\.title": "替新檔案命名"/);
assert.match(translations, /"draftFile\.discard": "捨棄"/);
assert.match(translations, /"error\.fileNameNoFolders": "檔名不能包含資料夾位置。"/);
assert.match(translations, /"error\.fileExists": "已有同名檔案，請換一個檔名。"/);

console.log("draft new file flow regression: PASS");
