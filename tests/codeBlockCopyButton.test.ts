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
assert.match(app, /codeBlockDeleteLabel=\{t\("codeBlock\.delete"\)\}/);
assert.match(editor, /copyText: codeBlockCopyLabelRef\.current/);
assert.match(
  editor,
  /button\.setAttribute\("aria-label", codeBlockCopyLabelRef\.current\)/,
);
assert.match(editor, /button\.setAttribute\("title", codeBlockCopyLabelRef\.current\)/);
assert.match(editor, /button\.classList\.add\("is-copy-success"\)/);
assert.match(editor, /const codeBlockCopyFeedbackDurationMs = 1500;/);
assert.match(editor, /button\.className = "delete-button"/);
assert.match(editor, /deleteCodeBlockFromButton\(button\)/);
assert.match(editor, /const nodeDom = view\.nodeDOM\(position\)/);
assert.match(editor, /nodeDom instanceof HTMLElement && nodeDom\.contains\(button\)/);
assert.match(editor, /view\.state\.tr\.delete\(targetPosition, targetPosition \+ targetSize\)/);
assert.match(
  css,
  /\.milkdown-code-block \.tools \.copy-button,[\s\S]*?\.milkdown-code-block \.tools \.delete-button \{[\s\S]*?gap: 0;[\s\S]*?font-size: 0;/,
);
assert.match(css, /\.milkdown-code-block \.tools \.delete-button::before/);
assert.match(translations, /"codeBlock\.copy": "複製程式碼"/);
assert.match(translations, /"codeBlock\.copy\.copied": "已複製"/);
assert.match(translations, /"codeBlock\.delete": "刪除程式碼區塊"/);
assert.match(translations, /"codeBlock\.delete": "Delete code block"/);
assert.match(translations, /"codeBlock\.delete": "删除代码区块"/);

console.log("code block copy/delete controls regression: PASS");
