import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const editor = fs.readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const translations = fs.readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");

assert.match(app, /codeBlockCopyLabel=\{t\("codeBlock\.copy"\)\}/);
assert.match(editor, /copyText: codeBlockCopyLabelRef\.current/);
assert.match(
  editor,
  /button\.setAttribute\("aria-label", codeBlockCopyLabelRef\.current\)/,
);
assert.match(editor, /button\.setAttribute\("title", codeBlockCopyLabelRef\.current\)/);
assert.match(editor, /button\.classList\.add\("is-copy-success"\)/);
assert.match(editor, /const codeBlockCopyFeedbackDurationMs = 1500;/);
assert.match(
  css,
  /\.milkdown-code-block \.tools \.copy-button \{[\s\S]*?gap: 0;[\s\S]*?font-size: 0;/,
);
assert.match(translations, /"codeBlock\.copy": "複製程式碼"/);
assert.match(translations, /"codeBlock\.copy\.copied": "已複製"/);

console.log("code block icon-only copy regression: PASS");
