import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(editor, /container\.addEventListener\("copy", handleMarkdownCopy, true\)/);
assert.doesNotMatch(editor, /markdownWithClipboardSyntaxInserted/);
assert.doesNotMatch(editor, /function handleMarkdownPaste/);
assert.doesNotMatch(editor, /function sourceOffsetFromEditorPosition/);
assert.doesNotMatch(editor, /function sourceRangeFromEditorSelection/);
assert.doesNotMatch(editor, /addEventListener\("paste"/);
assert.doesNotMatch(editor, /removeEventListener\("paste"/);

console.log("native markdown paste regression: PASS");
