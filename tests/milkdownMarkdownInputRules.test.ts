import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(
  editor,
  /function shouldLetMarkdownInputRuleHandleEnter\([\s\S]*?\^\s\{0,3\}\(\?:```\[A-Za-z0-9_-\]\*\|---\|___\|\\\*\\\*\\\*\)\$/,
);
assert.match(
  editor,
  /if \(event\.key === "Enter" && shouldLetMarkdownInputRuleHandleEnter\(view\)\) \{[\s\S]*?return false;/,
);
assert.match(editor, /\[CrepeFeature\.ListItem\]: true/);
assert.match(editor, /\[CrepeFeature\.BlockEdit\]: true/);
assert.match(editor, /\[CrepeFeature\.LinkTooltip\]: true/);
assert.match(editor, /\[CrepeFeature\.Placeholder\]: true/);
assert.match(editor, /\[CrepeFeature\.Table\]: true/);

console.log("milkdown markdown input rules regression: PASS");
