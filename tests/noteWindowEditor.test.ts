import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const milkdownSource = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const componentStart = appSource.indexOf("function NoteMarkdownEditor(");
const componentEnd = appSource.indexOf("\nfunction App()", componentStart);
const noteEditorSource = appSource.slice(componentStart, componentEnd);
const selectionEnterStart = appSource.indexOf("function handleSelectionEnter(");
const selectionEnterEnd = appSource.indexOf("\n  function showNoteViewer(", selectionEnterStart);
const selectionEnterSource = appSource.slice(selectionEnterStart, selectionEnterEnd);

assert.ok(componentStart >= 0 && componentEnd > componentStart);
assert.ok(selectionEnterStart >= 0 && selectionEnterEnd > selectionEnterStart);
assert.match(noteEditorSource, /<MarkdownPreview[\s\S]*?commitOnInput/);
assert.match(noteEditorSource, /readOnly=\{!isEditable\}/);
assert.match(noteEditorSource, /editingSurface === "source" && isEditable[\s\S]*?<textarea/);
assert.match(
  selectionEnterSource,
  /if \(!noteModeEnabled\) return false;[\s\S]*?selectionShouldSuppressNewAnnotation\(anchor\)/,
);
assert.doesNotMatch(selectionEnterSource, /setActiveDocumentModeState/);
assert.match(
  appSource,
  /function handlePreviewInput[\s\S]*?const previewElement = event\.currentTarget[\s\S]*?commitPendingPreviewInput\(previewElement\)/,
);
assert.match(
  appSource,
  /function previewTextFromNode[\s\S]*?node instanceof Text[\s\S]*?node instanceof HTMLBRElement[\s\S]*?previewTextFromNode\(child\)/,
);
assert.doesNotMatch(
  appSource,
  /function markdownFromEditedPreviewBlock[\s\S]*?element\.innerText/,
);
assert.match(
  appSource,
  /function markdownFromEditedPreviewBlockElements[\s\S]*?elements\.map\(previewTextFromNode\)\.join\("\\n"\)/,
);
assert.match(
  appSource,
  /function commitEditedPreviewBlocks[\s\S]*?editedBlockKeys[\s\S]*?dataset\.previewBlockKey === blockKey[\s\S]*?markdownFromEditedPreviewBlockElements\(currentBlock, elements\)/,
);
assert.doesNotMatch(appSource, /function handleNativePreview(?:BeforeInput|Input|Paste)/);
assert.doesNotMatch(
  appSource,
  /addEventListener\("(?:beforeinput|input|paste)", handleNativePreview/,
);
assert.match(
  appSource,
  /function handlePreviewPaste[\s\S]*?event\.clipboardData[\s\S]*?getData\("text\/plain"\)[\s\S]*?commitPreviewChange\(nextValue\)/,
);
assert.match(appSource, /onPaste=\{handlePreviewPaste\}/);
assert.match(
  appSource,
  /function selectAllPreviewContent[\s\S]*?range\.setStart\(firstBlock, 0\)[\s\S]*?range\.setEnd\(lastBlock, lastBlock\.childNodes\.length\)/,
);
assert.match(
  appSource,
  /shouldHandlePreviewSelectAllShortcut\(event\.nativeEvent, true, false\)[\s\S]*?selectAllPreviewContent\(previewElement\)/,
);
assert.match(
  appSource,
  /function handlePreviewInput[\s\S]*?window\.cancelAnimationFrame\(inputCommitFrameRef\.current\);[\s\S]*?inputCommitFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?commitPendingPreviewInput\(previewElement\)/,
);
assert.match(
  appSource,
  /function handlePreviewCompositionEnd[\s\S]*?const previewElement = event\.currentTarget[\s\S]*?commitPendingPreviewInput\(previewElement\)/,
);
assert.match(
  appSource,
  /function commitPreviewSoftBreak[\s\S]*?commitPendingPreviewInput\(previewElement\)[\s\S]*?selectionOffsetsWithInlineBreaksInElement[\s\S]*?const currentValue = previewValueRef\.current[\s\S]*?block\.kind === "code" \? "\\n" : "<br>"[\s\S]*?focusPreviewBlockTextOffset/,
);
assert.match(
  appSource,
  /function selectionOffsetsWithInlineBreaksInElement[\s\S]*?const nodeLength[\s\S]*?const pointOffset[\s\S]*?range\.startContainer[\s\S]*?range\.endContainer/,
);
assert.match(
  appSource,
  /function selectionOffsetsWithInlineBreaksInElement[\s\S]*?replace\(\/\\u200b\/g, ""\)[\s\S]*?function previewTextFocusFromSelection[\s\S]*?precedingTextLength[\s\S]*?textOffset: precedingTextLength \+ offsets\.to/,
);
assert.match(
  appSource,
  /function handlePreviewInput[\s\S]*?previewTextFocusFromSelection\(blockElement\)[\s\S]*?pendingPreviewTextFocusRef\.current = pendingFocus[\s\S]*?commitPendingPreviewInput\(previewElement\)/,
);
assert.match(
  appSource,
  /function appendInlineTextMap[\s\S]*?sourceEndOffset = sourceStart \+ index \+ token\.length/,
);
assert.match(
  appSource,
  /function sourcePositionForPreviewTextOffset[\s\S]*?clampedOffset === textMap\.sourceOffsets\.length[\s\S]*?return textMap\.sourceEndOffset/,
);
assert.match(
  appSource,
  /const precedingWhitespace =[\s\S]*?match\(\/\[ \\t\]\+\$\/\)[\s\S]*?const breakFrom = sourceRange\.from - precedingWhitespace\.length/,
);
assert.match(
  appSource,
  /useLayoutEffect\(\(\) => \{[\s\S]*?pendingPreviewTextFocusRef\.current[\s\S]*?applyPreviewBlockTextOffset\(pendingFocus\.blockKey, pendingFocus\.textOffset\);[\s\S]*?\}, \[value\]\)/,
);
assert.match(
  appSource,
  /function focusPreviewBlockTextOffset[\s\S]*?pendingPreviewTextFocusRef\.current = \{ blockKey, textOffset \};/,
);
assert.match(
  appSource,
  /textMap\.text\.endsWith\("\\n"\)[\s\S]*?data-preview-trailing-caret="true"[\s\S]*?"\\u200b"/,
);
assert.match(
  appSource,
  /node instanceof HTMLBRElement[\s\S]*?dataset\.previewTrailingCaret === "true"[\s\S]*?focusNode = trailingCaretText/,
);
assert.match(
  appSource,
  /const isSoftEnter =[\s\S]*?event\.shiftKey;[\s\S]*?isSoftEnter && commitOnInput && !event\.nativeEvent\.isComposing[\s\S]*?if \(!commitPreviewSoftBreak\(\)\)[\s\S]*?transientElement\.dataset\.previewSoftBreaks = "true";[\s\S]*?return;[\s\S]*?event\.preventDefault\(\)/,
);
assert.match(
  appSource,
  /const preserveSoftBreaks = transientEdit\.transientNodes\.some[\s\S]*?node\.dataset\.previewSoftBreaks === "true"[\s\S]*?join\("<br>"\)/,
);
assert.match(
  appSource,
  /function commitPreviewChange[\s\S]*?const previousValue = previewValueRef\.current[\s\S]*?previewValueRef\.current = nextValue;[\s\S]*?onChange\(nextValue, "user"/,
);
assert.match(
  appSource,
  /function handleDocumentPointerDown[\s\S]*?targetIsInsideNoteMarkdownEditor\(activeElement\)[\s\S]*?activeElement\.blur\(\);[\s\S]*?setActiveNoteEditorKey\(""\)/,
);
assert.match(
  appSource,
  /function flushActiveNoteMarkdownEditor[\s\S]*?document\.activeElement !== editableElement[\s\S]*?editableElement\.blur\(\);[\s\S]*?function closeNotePanel\(\) \{[\s\S]*?flushActiveNoteMarkdownEditor\(\)/,
);
assert.match(
  appSource,
  /className="floating-note-close-button"[\s\S]*?onPointerDown=\{flushActiveNoteMarkdownEditor\}[\s\S]*?onClick=\{closeNotePanel\}/,
);
assert.match(
  appSource,
  /ariaLabel=\{t\("glossary\.edit"\)\}[\s\S]*?editingSurface="source"/,
);
assert.match(
  milkdownSource,
  /if \(mobileBlockSelectionEnabledRef\.current\) \{\n      window\.getSelection\(\)\?\.removeAllRanges\(\);\n      onAnnotationClickRef\.current\(noteId\);\n      return;\n    \}/,
);
assert.match(
  milkdownSource,
  /allowClickWithSelection: \(\) => mobileBlockSelectionEnabledRef\.current/,
);

for (const surface of [
  "note-library-card__editor",
  "note-library-expanded-panel__editor",
  "floating-note-card__editor",
]) {
  assert.match(appSource, new RegExp(`className="${surface}"[\\s\\S]*?<NoteMarkdownEditor|<NoteMarkdownEditor[\\s\\S]*?className="${surface}"`));
}

console.log("note window rendered editing regression: PASS");
