import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const translations = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");

assert.match(app, /label: t\("directory\.delete"\)[\s\S]*?tone: "danger"/);
assert.match(app, /window\.confirm\([\s\S]*?confirm\.deleteDropboxDirectory[\s\S]*?confirm\.deleteDirectory/);
assert.match(app, /delete_dropbox_markdown_directory[\s\S]*?delete_markdown_directory/);
assert.match(app, /removeDocumentsFromWorkspace\(deletedDocumentIds\)/);
assert.match(app, /workspacePathIsInsideDirectory\(entry\.path, target\.path, source\)/);
assert.match(rust, /target_path == root_path \|\| !target_path\.starts_with\(&root_path\)/);
assert.match(rust, /fs::remove_dir_all\(&directory_path\)/);
assert.match(translations, /"directory\.delete": "刪除目錄"/);
assert.match(translations, /且無法復原/);

console.log("directory delete regression: PASS");
