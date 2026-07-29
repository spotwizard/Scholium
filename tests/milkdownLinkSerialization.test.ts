import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");

assert.match(
  editor,
  /function restoreSerializedInlineLinks\(markdown: string\) \{/,
);
assert.ok(editor.includes("line.replace(/\\\\\\[([^\\]\\n]*)\\]\\\\\\(([^)\\n]*)\\)/g"));
assert.ok(editor.includes('line[offset - 1] === "!" ? match : `[${label}](${href})`'));
assert.match(
  editor,
  /if \(inFencedCodeBlock\) \{[\s\S]*?normalizedLines\.push\(line\);[\s\S]*?continue;/,
);
assert.match(
  editor,
  /return restoreSerializedInlineLinks\(\n\s*normalizeSerializedHardBreaks\(normalizeSerializedEmptyParagraphBreaks\(markdown\)\),\n\s*\)/,
);

console.log("milkdown link serialization regression: PASS");
