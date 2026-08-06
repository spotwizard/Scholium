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
  /return restoreListLeadingAsterisksFromPreview\(\s*normalizeListItemStrongTrailingWhitespace\(\s*normalizeSerializedBulletMarkers\(\s*restoreSerializedInlineLinks\(\s*normalizeSerializedHardBreaks\(normalizeSerializedEmptyParagraphBreaks\(markdown\)\),\s*\),\s*\)/,
);
assert.ok(
  editor.includes("/^(\\s*(?:[-+*]|\\d+[.)]))\\s+<br\\s*\\/?>\\s*$/i"),
);
assert.match(
  editor,
  /normalizedLines\.push\(emptyListItemBreak\[1\] \?\? line\);/,
);

console.log("milkdown link serialization regression: PASS");
