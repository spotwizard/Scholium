import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const translations = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");
const milkdown = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

const selectionEnterStart = app.indexOf("function handleSelectionEnter(");
const selectionEnterEnd = app.indexOf("\n  function showNoteViewer(", selectionEnterStart);
const selectionEnter = app.slice(selectionEnterStart, selectionEnterEnd);
const existingSelectionStart = app.indexOf(
  "function openExistingAnnotationForSelection(",
);
const existingSelectionEnd = app.indexOf(
  "\n  function handleSelectionEnter(",
  existingSelectionStart,
);
const existingSelection = app.slice(existingSelectionStart, existingSelectionEnd);

assert.ok(selectionEnterStart >= 0 && selectionEnterEnd > selectionEnterStart);
assert.ok(existingSelectionStart >= 0 && existingSelectionEnd > existingSelectionStart);

assert.match(
  app,
  /function isGlossarySelectionCandidate\([\s\S]*?!\/\[\\r\\n\]\/[\s\S]*?\/\[\\p\{L\}\\p\{N\}\]\/u/,
);
assert.doesNotMatch(app, /glossaryTermWordCount/);
assert.match(
  selectionEnter,
  /if \(glossaryModeActive && !isGlossarySelectionCandidate\(selectionAnchor\)\)[\s\S]*?if \(glossaryModeActive\) \{[\s\S]*?startGlossaryFlowForAnchor\(selectionAnchor/,
);
assert.match(
  existingSelection,
  /if \(glossaryModeActive\) \{[\s\S]*?activeGlossaryBindingOverlappingSelection[\s\S]*?return false;[\s\S]*?activeNoteOverlappingSelection/,
);

assert.match(
  app,
  /mobileSelectionKind=\{glossaryModeActive \? "glossary" : "note"\}/,
);
assert.match(
  app,
  /function toggleGlossaryMode\([\s\S]*?nextGlossaryModeEnabled[\s\S]*?setNoteLibraryOpen\(false\)[\s\S]*?setFocusedLibraryNoteId\(""\)/,
);
assert.match(milkdown, /const milkdownTouchBlockLongPressMs = 2000;/);
assert.match(milkdown, /const milkdownTouchGlossaryLongPressMs = 650;/);
assert.match(
  milkdown,
  /mobileSelectionKindRef\.current === "glossary"[\s\S]*?\? milkdownTouchGlossaryLongPressMs[\s\S]*?: milkdownTouchBlockLongPressMs/,
);
assert.match(
  milkdown,
  /mobileSelectionKindRef\.current !== "glossary" &&[\s\S]*?targetElement\.closest\([\s\S]*?\.milkdown-note-annotation/,
);
assert.match(
  milkdown,
  /function touchGlossaryTextBlockAtHit\([\s\S]*?touchGlossaryTextBlockAtPosition\(view, hit\.pos\)[\s\S]*?view\.state\.doc\.nodeAt\(hit\.inside\)[\s\S]*?insideNode\?\.isTextblock[\s\S]*?from: hit\.inside \+ 1/,
);
assert.match(
  milkdown,
  /function touchGlossarySelectionStartAtPoint\([\s\S]*?touchGlossaryTextBlockAtHit\(view, hit\)/,
);
assert.match(
  milkdown,
  /function touchGlossaryCodeSelectionAtPoint\([\s\S]*?\.milkdown-code-block[\s\S]*?\.cm-line[\s\S]*?touchGlossaryLineGraphemeAtPoint[\s\S]*?fencedCodeBlockContentLineSourceRange[\s\S]*?sourceAnchorFromEditorAnchor/,
);
assert.match(
  milkdown,
  /function touchGlossarySelectionStartAtPoint\([\s\S]*?touchGlossaryCodeSelectionAtPoint\(clientX, clientY\)[\s\S]*?codeBlockIndex: codeSelection\.codeBlockIndex/,
);
assert.match(
  milkdown,
  /function touchGlossaryCodeSelectionPreviewRects\([\s\S]*?codeBlockAnnotationRects\([\s\S]*?"glossary",[\s\S]*?"glossary"/,
);
assert.match(
  milkdown,
  /session\.codeBlockIndex == null[\s\S]*?touchGlossarySelectionEndAtPoint\(view, session\)[\s\S]*?touchGlossaryCodeSelectionEndAtPoint\(session\)/,
);
assert.match(
  milkdown,
  /if \(session\.kind === "glossary"\) \{[\s\S]*?deltaX <= -milkdownTouchBlockActivationMoveTolerancePx[\s\S]*?deltaX < milkdownTouchBlockActivationMoveTolerancePx[\s\S]*?session\.selecting = true/,
);
assert.match(
  milkdown,
  /function touchGlossarySelectionEndAtPoint\([\s\S]*?Math\.min\(hit\.pos, session\.blockTo\)[\s\S]*?if \(hit\.pos < session\.startFrom\) \{[\s\S]*?return null;/,
);
assert.match(
  milkdown,
  /session\.kind === "glossary" && !session\.selecting[\s\S]*?completeTouchGlossarySelection/,
);
assert.match(
  milkdown,
  /setTouchBlockCommittedSelectionOverlay\(\(currentOverlay\) =>[\s\S]*?annotation\.kind === currentOverlay\.kind[\s\S]*?annotation\.from === currentOverlay\.from[\s\S]*?annotation\.to === currentOverlay\.to[\s\S]*?\? null/,
);

assert.match(
  css,
  /\.milkdown-touch-block-selection-overlay\.is-glossary[\s\S]*?--color-glossary-surface/,
);
assert.match(
  translations,
  /"selection\.mobileGlossaryModeHint": "向右滑動選擇名詞；向左滑動取消"/,
);

console.log("mobile glossary selection regression: PASS");
