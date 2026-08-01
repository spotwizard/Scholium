import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(editor, /function createInlineMarkdownLinkInputRule\(\)/);
assert.ok(editor.includes("new InputRule("));
assert.ok(editor.includes("/(^|[^!])\\[([^\\]\\n]+)\\]\\(([^)\\n]*)\\)$/"));
assert.match(editor, /const linkMarkType = state\.schema\.marks\.link;/);
assert.match(editor, /if \(!linkMarkType\) return null;/);
assert.match(editor, /const linkStart = start \+ prefix\.length;/);
assert.match(editor, /state\.tr\.insertText\(label, linkStart, end\)/);
assert.match(editor, /tr\.addMark\(linkStart, linkEnd, linkMarkType\.create\(\{ href, title: null \}\)\)/);
assert.match(
  editor,
  /createInlineMarkdownLinkInputRule\(\),\n\s*createPastedLinkBoundaryPlugin\(\),\n\s*createPairedSymbolPlugin\(\),\n\s*createSingleListItemIndentPlugin\(\),\n\s*createListItemInlineStrongSyntaxPlugin\(\),\n\s*createControlHistoryPlugin\(\),\n\s*createShiftEnterParagraphSplitPlugin\(\),/,
);
assert.match(editor, /function createPastedLinkBoundaryPlugin\(\)/);
assert.match(editor, /transaction\.getMeta\("paste"\) === true/);
assert.match(editor, /transaction\.getMeta\("uiEvent"\) === "paste"/);
assert.match(editor, /const linkBeforeCursor = textRangeHasMark\(/);
assert.match(editor, /const linkAfterCursor = textRangeHasMark\(/);
assert.match(editor, /if \(!linkBeforeCursor \|\| linkAfterCursor\) return null;/);
assert.match(editor, /\.removeStoredMark\(linkMarkType\)/);
assert.match(editor, /let acceptsMarkdownUpdates = false;/);
assert.match(editor, /disposed \|\|\n\s*!acceptsMarkdownUpdates \|\|/);
assert.match(editor, /if \(disposed\) return;\n\s*acceptsMarkdownUpdates = true;/);

console.log("milkdown inline link input rule regression: PASS");
