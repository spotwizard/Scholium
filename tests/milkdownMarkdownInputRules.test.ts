import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(editor, /shouldInsertPlainEnterHardBreak/);
assert.doesNotMatch(editor, /insertPlainEnterHardBreak/);
assert.doesNotMatch(editor, /shouldLetMarkdownInputRuleHandleEnter/);
assert.match(editor, /function shouldSplitParagraphWithShiftEnter\(/);
assert.match(editor, /function createShiftEnterParagraphSplitPlugin\(\)/);
assert.match(editor, /function isolateSelectedSoftLine\(state: EditorState\)/);
assert.match(editor, /function createSoftLineBlockInputRulePlugin\(\)/);
assert.match(
  editor,
  /plugin\.spec\.key === milkdownSoftLineBlockInputRulePluginKey/,
);
assert.match(
  editor,
  /view\.dispatch\(isolation\.transaction\);\s*return runInputRule\(inputRulePlugin, view, isolatedFrom, isolatedTo\);/,
);
assert.match(
  editor,
  /handleKeyDown\(view, event\) \{\s*if \(!shouldSplitParagraphWithShiftEnter\(view, event\)\) return false;/,
);
assert.match(
  editor,
  /createTouchBlockSelectionPlugin\(\),\s*createSoftLineBlockInputRulePlugin\(\),\s*createInlineMarkdownLinkInputRule\(\),/,
);
assert.match(editor, /createShiftEnterParagraphSplitPlugin\(\),/);
assert.match(editor, /\[CrepeFeature\.ListItem\]: true/);
assert.match(editor, /\[CrepeFeature\.BlockEdit\]: true/);
assert.match(editor, /\[CrepeFeature\.LinkTooltip\]: true/);
assert.match(editor, /\[CrepeFeature\.Placeholder\]: true/);
assert.match(editor, /\[CrepeFeature\.Table\]: true/);

console.log("milkdown markdown input rules regression: PASS");
