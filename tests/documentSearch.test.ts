import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  documentSearchMoveDeltaForKeyDown,
} from "../src/documentSearch.ts";

const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const milkdownEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const desktopSearchRule = appCss.match(/\.document-search \{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.match(
  desktopSearchRule,
  /top:\s*calc\(var\(--editor-document-title-top\) \+ 52px\);/,
);
assert.match(
  appCss,
  /\.scholium-shell\.has-document-tabs \.document-search \{\s*top:\s*calc\(\s*var\(--editor-document-title-top\) \+ 52px \+ var\(--document-tab-bar-occupied-height\)\s*\);/,
);

const candidateCommitEnter = {
  isComposing: true,
  key: "Enter",
  keyCode: 229,
  shiftKey: false,
};
const subsequentSearchEnter = {
  isComposing: false,
  key: "Enter",
  keyCode: 13,
  shiftKey: false,
};

assert.deepEqual(
  [candidateCommitEnter, subsequentSearchEnter].map(
    documentSearchMoveDeltaForKeyDown,
  ),
  [0, 1],
);
assert.equal(
  documentSearchMoveDeltaForKeyDown({
    ...candidateCommitEnter,
    isComposing: false,
  }),
  0,
);
assert.equal(
  documentSearchMoveDeltaForKeyDown({
    ...subsequentSearchEnter,
    shiftKey: true,
  }),
  -1,
);
assert.match(
  milkdownEditor,
  /function currentEditorView\(\): EditorView \| null \{[\s\S]*?candidate\?\.state && typeof candidate\.dispatch === "function"[\s\S]*?view = candidate;/,
);
assert.match(
  milkdownEditor,
  /function dispatchSearchUpdate\(\) \{\s*const view = currentEditorView\(\);\s*if \(!view\) return;\s*view\.dispatch/,
);

console.log("document search IME Enter regression: PASS");
