import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  documentSearchHistoryAction,
  documentSearchMoveDeltaForKeyDown,
  isDocumentSearchSelectAllShortcut,
} from "../src/documentSearch.ts";

const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const milkdownEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const sourceEditor = readFileSync(
  new URL("../src/MarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const milkdownScrollFunction =
  milkdownEditor.match(
    /function scrollActiveSearchMatchIntoView\(\) \{[\s\S]*?\n  \}\n\n  function dispatchSearchUpdate/,
  )?.[0] ?? "";
const desktopSearchRule = appCss.match(/\.document-search \{([\s\S]*?)\n\}/)?.[1] ?? "";
const editorPaneIndex = app.indexOf('<section className="editor-pane"');
const editorGridIndex = app.indexOf('<div className="editor-grid">', editorPaneIndex);
const documentSearchIndex = app.indexOf('className="document-search"', editorPaneIndex);

assert.match(
  desktopSearchRule,
  /position:\s*fixed;/,
);
assert.ok(documentSearchIndex > editorPaneIndex);
assert.ok(
  documentSearchIndex < editorGridIndex,
  "document search must stay outside the scrollable editor surface",
);
assert.match(
  desktopSearchRule,
  /top:\s*0;/,
);
assert.match(
  desktopSearchRule,
  /right:\s*0;[\s\S]*?left:\s*0;[\s\S]*?z-index:\s*90;[\s\S]*?width:\s*100%;/,
);
assert.doesNotMatch(
  desktopSearchRule,
  /\+ 52px/,
);
assert.match(
  appCss,
  /--editor-content-gutter:\s*56px;/,
);
assert.match(
  appCss,
  /--editor-content-top-gutter:\s*20px;/,
);
assert.doesNotMatch(
  appCss,
  /editor-document-title/,
);
assert.doesNotMatch(
  app,
  /editor-document-title/,
);
assert.match(
  appCss,
  /@media \(max-width: 640px\) \{[\s\S]*?--editor-content-top-gutter:\s*96px;/,
);
assert.match(
  appCss,
  /@media \(max-width: 640px\) \{[\s\S]*?\.document-search \{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*calc\(var\(--mobile-safe-area-top\) \+ 12px\);[\s\S]*?right:\s*16px;[\s\S]*?left:\s*auto;/,
);
assert.match(
  appCss,
  /\.editor-pane \{[\s\S]*?position:\s*relative;/,
);
assert.match(
  app,
  /const documentSearchVisible =\s*hasOpenDocument && !settingsViewOpen && \(isMobileViewport \|\| documentSearchOpen\);/,
);
assert.match(
  app,
  /function closeDocumentSearch\(\) \{\s*setDocumentSearchOpen\(false\);\s*if \(!isMobileViewport\) \{\s*setDocumentSearchQuery\(""\);\s*setDocumentSearchActiveIndex\(0\);\s*setDocumentSearchMatchCount\(0\);/,
);

const selectAllShortcut = {
  altKey: false,
  code: "KeyA",
  ctrlKey: true,
  key: "a",
  metaKey: false,
  shiftKey: false,
};

assert.equal(isDocumentSearchSelectAllShortcut(selectAllShortcut), true);
assert.equal(isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, key: "ㄇ" }), true);
assert.equal(
  isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, ctrlKey: false, metaKey: true }),
  true,
);
assert.equal(isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, metaKey: true }), false);
assert.equal(isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, shiftKey: true }), false);
assert.equal(isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, altKey: true }), false);
assert.equal(
  isDocumentSearchSelectAllShortcut({ ...selectAllShortcut, code: "KeyB", key: "b" }),
  false,
);
assert.match(
  app,
  /if \(isDocumentSearchSelectAllShortcut\(event\.nativeEvent\)\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*event\.currentTarget\.select\(\);/,
);

const undoShortcut = {
  altKey: false,
  code: "KeyZ",
  ctrlKey: true,
  key: "z",
  metaKey: false,
  shiftKey: false,
};
assert.equal(documentSearchHistoryAction(undoShortcut), "undo");
assert.equal(documentSearchHistoryAction({ ...undoShortcut, shiftKey: true }), "redo");
assert.equal(
  documentSearchHistoryAction({ ...undoShortcut, code: "KeyY", key: "y" }),
  "redo",
);
assert.equal(
  documentSearchHistoryAction({ ...undoShortcut, ctrlKey: false, metaKey: true }),
  "undo",
);
assert.equal(documentSearchHistoryAction({ ...undoShortcut, metaKey: true }), null);
assert.equal(documentSearchHistoryAction({ ...undoShortcut, altKey: true }), null);
assert.match(
  app,
  /const historyAction = documentSearchHistoryAction\(event\.nativeEvent\);\s*if \(historyAction\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*document\.execCommand\(historyAction\);\s*return;/,
);
assert.match(
  sourceEditor,
  /\{ key: "Mod-Shift-z", run: redo, preventDefault: true \}[\s\S]*?\.\.\.historyKeymap/,
);
assert.match(
  milkdownEditor,
  /const shouldRedo =[\s\S]*?key === "z" && event\.shiftKey[\s\S]*?key === "y" && event\.ctrlKey && !event\.metaKey && !event\.shiftKey[\s\S]*?runHistoryCommand\(view, shouldRedo\)/,
);
assert.match(
  app,
  /function undoPreviewChange\(\)[\s\S]*?focusPreviewSourcePosition\([\s\S]*?undo\.snapshot\.caretSourcePosition,[\s\S]*?true,[\s\S]*?function redoPreviewChange\(\)[\s\S]*?focusPreviewSourcePosition\([\s\S]*?redo\.snapshot\.caretSourcePosition,[\s\S]*?true,/,
);
assert.match(
  app,
  /if \(shouldScrollIntoView\) \{\s*blockElement\.scrollIntoView\(\{ block: "center", inline: "nearest" \}\);/,
);
assert.match(
  app,
  /if \(!documentSearchOpen\) return;\s*function handleDocumentPointerDown\(event: globalThis\.PointerEvent\) \{\s*if \(targetIsInsideDocumentSearch\(event\.target\)\) return;\s*documentSearchInputRef\.current\?\.blur\(\);[\s\S]*?document\.addEventListener\("pointerdown", handleDocumentPointerDown, true\);[\s\S]*?document\.removeEventListener\("pointerdown", handleDocumentPointerDown, true\);/,
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
  /const activeElement = document\.activeElement;\s*if \(!\(activeElement instanceof Element && activeElement\.closest\("\.document-search"\)\)\) \{\s*return;/,
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
  sourceEditor,
  /function applySearchState[\s\S]*?const activeElement = document\.activeElement;[\s\S]*?!shouldScroll \|\|[\s\S]*?!\(activeElement instanceof Element && activeElement\.closest\("\.document-search"\)\)[\s\S]*?return;[\s\S]*?EditorView\.scrollIntoView/,
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
