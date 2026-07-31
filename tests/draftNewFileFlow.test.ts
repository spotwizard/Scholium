import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
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
assert.doesNotMatch(newMarkdownFileBody, /await save\(|create_dropbox_markdown_file|openCreateEntryDialog/);

const createDropboxMarkdownFileBody = functionBody("createDropboxMarkdownFile");
assert.match(createDropboxMarkdownFileBody, /setActiveDocumentModeState\(\{\s*editorMode:\s*"preview"\s*\}\)/);
assert.doesNotMatch(createDropboxMarkdownFileBody, /setActiveDocumentModeState\(\{\s*editorMode:\s*"edit"\s*\}\)/);

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
assert.match(app, /Promise<"saved" \| "cancelled" \| "failed">/);
assert.match(saveDraftDocumentBody, /await save\(/);
assert.match(saveDraftDocumentBody, /window\.prompt\(\s*t\("newFile\.namePrompt"\)/);
assert.match(saveDraftDocumentBody, /if \(fileName === null\) return "cancelled"/);
assert.match(saveDraftDocumentBody, /if \(!selectedPath\) return "cancelled"/);
assert.match(saveDraftDocumentBody, /save_markdown_file/);
assert.match(saveDraftDocumentBody, /save_dropbox_markdown_file/);

assert.match(
  app,
  /function confirmDiscardDraftDocument[\s\S]*?window\.confirm\(t\("confirm\.discardDraftFile"\)\)[\s\S]*?removeDocumentsFromWorkspace\(\[documentId\]\)/,
);
assert.match(app, /function draftDocumentHasContent[\s\S]*?document\.body\.trim\(\)/);
assert.match(app, /window\.confirm\(t\("confirm\.saveDraftFile"\)\)/);
assert.match(
  app,
  /if \(saveResult === "cancelled"\) \{[\s\S]*?confirmDiscardDraftDocument\(documentToLeave\.id\)/,
);
assert.match(app, /event\.key\.toLowerCase\(\) === "s"[\s\S]*?saveDraftDocument\(documentToSave\)/);
assert.match(
  app,
  /const hasBackingFile = Boolean\(document\.filePath\) \|\| documentIsFromDropbox\(document\);[\s\S]*?return hasBackingFile && hasDirtyState/,
);
assert.match(translations, /"confirm\.saveDraftFile": "這份未命名內容尚未存成檔案，要先存檔嗎？"/);
assert.match(translations, /"confirm\.discardDraftFile": "要放棄建立這份未命名檔案嗎？/);

console.log("draft new file flow regression: PASS");
