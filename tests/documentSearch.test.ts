import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  documentSearchMoveDeltaForKeyDown,
} from "../src/documentSearch.ts";

const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const milkdownEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const milkdownScrollFunction =
  milkdownEditor.match(
    /function scrollActiveSearchMatchIntoView\(\) \{[\s\S]*?\n  \}\n\n  function dispatchSearchUpdate/,
  )?.[0] ?? "";
const desktopSearchRule = appCss.match(/\.document-search \{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.match(
  desktopSearchRule,
  /position:\s*fixed;/,
);
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
assert.match(
  milkdownScrollFunction,
  /function scrollActiveSearchMatchIntoView\(\) \{\s*window\.setTimeout\(\(\) => \{/,
);
assert.match(
  milkdownScrollFunction,
  /rootRef\.current\?\.querySelector<HTMLElement>\(\s*"\.milkdown-document-search-match\.is-active"/,
);
assert.match(
  milkdownScrollFunction,
  /const scrollContainer =\s*editorPane && editorPane\.scrollHeight > editorPane\.clientHeight\s*\? editorPane\s*:\s*document\.scrollingElement;/,
);
assert.match(
  milkdownScrollFunction,
  /scrollContainer\.scrollTop \+=\s*matchRect\.top -\s*viewportRect\.top -\s*\(viewportRect\.height - matchRect\.height\) \/ 2;/,
);
assert.doesNotMatch(
  milkdownScrollFunction,
  /domAtPos|coordsAtPos|\.scrollIntoView\(/,
);
assert.match(
  app,
  /function updateDocumentSearchQuery\(value: string\) \{\s*setDocumentSearchQuery\(value\);\s*setDocumentSearchActiveIndex\(0\);\s*if \(value\.trim\(\)\) \{\s*setDocumentSearchScrollRequestKey\(\(requestKey\) => requestKey \+ 1\);/,
);
assert.match(
  milkdownEditor,
  /const searchSignature = `\$\{search\.query\}\\n\$\{search\.activeIndex\}\\n\$\{search\.scrollRequestKey \?\? 0\}`;/,
);
assert.match(
  app,
  /function moveDocumentSearch\(delta: number\) \{\s*if \(documentSearchMatchCount <= 0\) return;\s*setDocumentSearchScrollRequestKey\(\(requestKey\) => requestKey \+ 1\);\s*setDocumentSearchActiveIndex/,
);

console.log("document search input, paste, and stable scroll regression: PASS");
