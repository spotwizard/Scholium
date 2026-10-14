import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../src/tauriGateway.ts", import.meta.url), "utf8");
const rust = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const translations = fs.readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");

assert.match(
  rust,
  /let open_path = menu_item\(MENU_OPEN_PATH, "openPath", Some\("CmdOrCtrl\+Alt\+O"\)\)\?;/,
  "the File menu offers Go to Path with Option-Command-O",
);
assert.match(rust, /&open_file,\n\s*&open_folder,\n\s*&open_path,/);
assert.match(
  rust,
  /event_id == MENU_OPEN_PATH \{\n\s*let _ = emit_to_target_webview_window\(app, "scholium-open-path", \(\)\);/,
);
assert.match(
  gateway,
  /export function resolveTypedMarkdownPath\(args: ResolveTypedMarkdownPathArgs\) \{\n  return invoke<DroppedMarkdownPathResult>\("resolve_typed_markdown_path", args\);\n\}/,
);

assert.match(
  app,
  /appWindow\.listen\("scholium-open-path", \(\) => \{\n\s*openPathHandlerRef\.current\(\);/,
);

const submitBody = app.match(
  /async function submitOpenPathDialog\([^)]*\) \{([\s\S]*?)\n  \}/,
)?.[1];
assert.ok(submitBody, "submitOpenPathDialog should exist");
assert.match(submitBody, /location = await resolveTypedMarkdownPath\(\{ path: openPathDialog\.path \}\);/);
assert.match(
  submitBody,
  /error: t\(typedPathErrorTranslationKeys\[message\] \?\? "error\.openFileFailed"\)/,
  "a path that cannot be opened keeps the dialog open with a reason",
);
assert.match(
  submitBody,
  /setOpenPathDialog\(null\);\n    if \(location\.kind === "directory"\) \{\n      await openDirectoryPath\(location\.path\);\n    \} else \{\n      await openMarkdownFilePath\(location\.path\);\n    \}/,
  "a typed folder opens as the workspace and a typed file opens with its folder",
);

for (const message of [
  "typed path is empty",
  "typed path must be absolute",
  "typed path does not exist",
  "typed file is not a Markdown file",
]) {
  assert.ok(app.includes(`"${message}": "openPath.error.`), `${message} should be translated`);
  assert.ok(rust.includes(message) || fs.readFileSync(
    new URL("../src-tauri/src/markdown_path.rs", import.meta.url),
    "utf8",
  ).includes(message));
}

assert.match(translations, /"openPath\.title": "前往路徑"/);
assert.match(translations, /"openPath\.error\.notFound": "找不到這個檔案或資料夾。"/);

console.log("open path regression: PASS");
