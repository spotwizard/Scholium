import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const milkdownSource = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const componentStart = appSource.indexOf("function NoteMarkdownEditor(");
const componentEnd = appSource.indexOf("\nfunction App()", componentStart);
const noteEditorSource = appSource.slice(componentStart, componentEnd);
const markdownPreviewStart = appSource.indexOf("function MarkdownPreview(");
const markdownPreviewEnd = appSource.indexOf(
  "\nfunction MarkdownPreviewContentBlock(",
  markdownPreviewStart,
);
const markdownPreviewSource = appSource.slice(markdownPreviewStart, markdownPreviewEnd);
const selectionEnterStart = appSource.indexOf("function handleSelectionEnter(");
const selectionEnterEnd = appSource.indexOf("\n  function showNoteViewer(", selectionEnterStart);
const selectionEnterSource = appSource.slice(selectionEnterStart, selectionEnterEnd);
const glossaryEditorAriaLabel = appSource.indexOf('ariaLabel={t("glossary.edit")}');
const glossaryEditorStart = appSource.lastIndexOf("<NoteMarkdownEditor", glossaryEditorAriaLabel);
const glossaryEditorEnd = appSource.indexOf(
  "\n              {!pendingAnchor && activeGlossaryTerm ? (\n                <div\n                  aria-hidden",
  glossaryEditorStart,
);
const glossaryEditorSource = appSource.slice(glossaryEditorStart, glossaryEditorEnd);

assert.ok(componentStart >= 0 && componentEnd > componentStart);
assert.ok(markdownPreviewStart >= 0 && markdownPreviewEnd > markdownPreviewStart);
assert.ok(selectionEnterStart >= 0 && selectionEnterEnd > selectionEnterStart);
assert.ok(glossaryEditorStart >= 0 && glossaryEditorEnd > glossaryEditorStart);
assert.equal(appSource.match(/<MarkdownPreview\b/g)?.length, 1);
assert.match(
  noteEditorSource,
  /<MarkdownPreview[\s\S]*?readOnly=\{!isEditable\}[\s\S]*?value=\{value\}[\s\S]*?onChange=\{\(nextValue\) => onChange\(nextValue\)\}[\s\S]*?\/>/,
);
assert.match(noteEditorSource, /readOnly=\{!isEditable\}/);
assert.match(noteEditorSource, /value\.length === 0 \? "is-empty" : ""/);
assert.doesNotMatch(
  markdownPreviewSource,
  /\b(?:annotations|allowSelectedTextEnterEdit|commitOnInput|enableTabIndent|onAnnotationClick|onSelectionChange|onSelectionEnter)\b/,
);
assert.doesNotMatch(
  appSource,
  /preview-(?:note-annotation|annotation-frame|annotation-layer)/,
);
assert.doesNotMatch(
  appCss,
  /preview-(?:note-annotation|annotation-frame|annotation-layer)/,
);
assert.match(appSource, /<MilkdownMarkdownEditor[\s\S]*?annotations=\{annotations\}/);
assert.match(
  milkdownSource,
  /className=\{`milkdown-annotation-frame[\s\S]*?className="milkdown-annotation-layer/,
);
assert.match(noteEditorSource, /editingSurface === "source" && isEditable[\s\S]*?<textarea/);
assert.doesNotMatch(
  appSource,
  /function MarkdownPreviewContent\([\s\S]*?onClick\?: \(\) => void;/,
);
assert.match(
  selectionEnterSource,
  /if \(!noteModeEnabled\) return false;[\s\S]*?selectionShouldSuppressNewAnnotation\(selectionAnchor\)/,
);
assert.doesNotMatch(selectionEnterSource, /setActiveDocumentModeState/);
assert.match(
  appSource,
  /function handlePreviewInput[\s\S]*?const previewElement = event\.currentTarget[\s\S]*?commitPendingPreviewInput\(previewElement, true\)/,
);
assert.match(
  markdownPreviewSource,
  /function handlePreviewTabIndent[\s\S]*?event\.key !== "Tab"[\s\S]*?event\.shiftKey[\s\S]*?commitPreviewListOutdent\(blockElement\) \|\| commitPreviewLineOutdent\(blockElement\)[\s\S]*?commitPreviewListIndent\(blockElement\)[\s\S]*?insertPlainPreviewText\("  "\)/,
);
assert.match(
  markdownPreviewSource,
  /function handlePreviewBeforeInput[\s\S]*?nativeEvent\.inputType === "insertLineBreak" && !nativeEvent\.isComposing[\s\S]*?commitPreviewSoftBreak\(\)/,
);
assert.match(
  markdownPreviewSource,
  /if \(readOnly\) \{\s*if \(\s*event\.key === "Tab" &&[\s\S]*?\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
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
assert.match(
  appSource,
  /function handlePreviewPaste[\s\S]*?if \(!selectedRange && selection\.isCollapsed && previewValueRef\.current\.length === 0\)[\s\S]*?selectedRange = \{ from: 0, to: 0 \};/,
);
assert.match(
  appSource,
  /function handlePreviewPaste[\s\S]*?sourceRangeForPreviewTextOffsets\([\s\S]*?getPreviewBlockTextMap\(previewValueRef\.current, block\),[\s\S]*?offsets\.from,[\s\S]*?offsets\.to,/,
);
assert.match(
  appSource,
  /function handlePlainTextCopy[\s\S]*?clipboardData\.setData\("text\/plain", selectedText\)/,
);
assert.doesNotMatch(appSource, /function markdownPreviewCopyTextFromSelection/);
assert.match(
  appSource,
  /function previewTextOffsetForSourcePosition\([\s\S]*?sourceOffset !== null && sourceOffset >= sourcePosition[\s\S]*?return textMap\.text\.length;/,
);
assert.match(
  appSource,
  /function handlePreviewPaste[\s\S]*?const caretSourcePosition = selectedRange\.from \+ pastedText\.length;[\s\S]*?focusPreviewSourcePosition\(nextValue, caretSourcePosition\);[\s\S]*?commitPreviewChange\(nextValue\)/,
);
assert.doesNotMatch(
  appSource,
  /function handlePreviewPaste[\s\S]*?focusPreviewBlockEnd\(focusBlock\.key\)/,
);
assert.match(
  appSource,
  /function undoPreviewChange\(\)[\s\S]*?takeNoteEditorUndo\([\s\S]*?previewValueRef\.current[\s\S]*?focusPreviewSourcePosition\([\s\S]*?caretSourcePosition/,
);
assert.match(
  appSource,
  /function redoPreviewChange\(\)[\s\S]*?takeNoteEditorRedo\([\s\S]*?previewValueRef\.current[\s\S]*?focusPreviewSourcePosition\([\s\S]*?caretSourcePosition[\s\S]*?onChange\(redo\.snapshot\.value, "user"\)/,
);
assert.match(
  appSource,
  /function isRedoKeyboardShortcut\([\s\S]*?event\.key\.toLowerCase\(\) === "z"[\s\S]*?event\.shiftKey/,
);
assert.match(
  appSource,
  /function flushPendingPreviewHistoryInput\(\)[\s\S]*?cancelAnimationFrame\(inputCommitFrameRef\.current\)[\s\S]*?commitPendingPreviewInput\(previewElement, true\)/,
);
assert.match(
  appSource,
  /const shouldRedo = isRedoKeyboardShortcut\(event\);[\s\S]*?flushPendingPreviewHistoryInput\(\);[\s\S]*?shouldRedo \? redoPreviewChange\(\) : undoPreviewChange\(\)/,
);
assert.match(
  appSource,
  /function commitPreviewChange[\s\S]*?recordNoteEditorChange\([\s\S]*?input: previewInputCommitRef\.current/,
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
  /function handlePreviewInput[\s\S]*?window\.cancelAnimationFrame\(inputCommitFrameRef\.current\);[\s\S]*?inputCommitFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?commitPendingPreviewInput\(previewElement, true\)/,
);
assert.match(
  appSource,
  /function handlePreviewCompositionEnd[\s\S]*?const previewElement = event\.currentTarget[\s\S]*?commitPendingPreviewInput\(previewElement, true\)/,
);
assert.match(
  appSource,
  /function commitPreviewSoftBreak[\s\S]*?commitPendingPreviewInput\(previewElement, true\)[\s\S]*?selectionOffsetsWithInlineBreaksInElement[\s\S]*?const currentValue = previewValueRef\.current[\s\S]*?block\.kind === "code" \? "\\n" : "<br>"[\s\S]*?focusPreviewBlockTextOffset/,
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
  /function handlePreviewInput[\s\S]*?previewTextFocusFromSelection\(blockElement\)[\s\S]*?pendingPreviewTextFocusRef\.current = pendingFocus[\s\S]*?commitPendingPreviewInput\(previewElement, true\)/,
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
  /const isSoftEnter =[\s\S]*?event\.shiftKey;[\s\S]*?isSoftEnter && !event\.nativeEvent\.isComposing[\s\S]*?if \(!commitPreviewSoftBreak\(\)\)[\s\S]*?transientElement\.dataset\.previewSoftBreaks = "true";[\s\S]*?return;[\s\S]*?event\.preventDefault\(\)/,
);
assert.match(
  markdownPreviewSource,
  /blockForPreviewElement\(blockElement\)\?\.kind === "paragraph" &&[\s\S]*?commitPreviewSoftBreak\(\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?if \(transientPreviewElementFromSelection\(\)\) return;/,
);
assert.match(
  markdownPreviewSource,
  /if \(!selection \|\| selection\.isCollapsed \|\| !selectedText\.trim\(\)\) \{[\s\S]*?\n    \}\n\n    event\.preventDefault\(\);\n    event\.stopPropagation\(\);\n  \}/,
);
assert.match(
  appSource,
  /function commitPreviewListEnter[\s\S]*?const nextListItem = listItem\.nextElementSibling;[\s\S]*?!nextListLine\.text\.trim\(\)[\s\S]*?focusPreviewListItem\(block\.key, itemIndex \+ 1\);[\s\S]*?return true;/,
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
  /function handleDocumentPointerDown[\s\S]*?\.floating-note-panel-toggle-button[\s\S]*?return;[\s\S]*?activeElement\.blur\(\)/,
);
assert.match(
  appSource,
  /className=\{`floating-note-panel-toggle-button[\s\S]*?onPointerDown=\{\(event\) => event\.preventDefault\(\)\}[\s\S]*?onClick=\{toggleFloatingNotePanelExpanded\}/,
);
assert.match(
  appSource,
  /function flushActiveNoteMarkdownEditor[\s\S]*?document\.activeElement !== editableElement[\s\S]*?editableElement\.blur\(\);[\s\S]*?function closeNotePanel\(\) \{[\s\S]*?flushActiveNoteMarkdownEditor\(\)/,
);
assert.match(
  appSource,
  /className="floating-note-close-button"[\s\S]*?onPointerDown=\{flushActiveNoteMarkdownEditor\}[\s\S]*?onClick=\{closeNotePanel\}/,
);
assert.doesNotMatch(glossaryEditorSource, /editingSurface="source"/);
assert.match(glossaryEditorSource, /<NoteMarkdownEditor/);
assert.match(
  glossaryEditorSource,
  /className="floating-note-card__editor floating-note-card__editor--glossary"[\s\S]*?editing=\{activeGlossaryIsEditing\}[\s\S]*?onRequestEdit=\{\(\) => openGlossaryEditor\(activeGlossaryTerm\.id\)\}/,
);
assert.doesNotMatch(
  appSource,
  /activeGlossaryTerm && !activeGlossaryIsEditing[\s\S]*?<MarkdownPreviewContent/,
);
assert.match(
  appSource,
  /aria-hidden=\{activeGlossaryIsEditing \|\| undefined\}[\s\S]*?activeGlossaryIsEditing \? "is-layout-placeholder" : ""/,
);
assert.match(
  appCss,
  /\.floating-note-card \.note-markdown-editor\.floating-note-card__editor--glossary\s*\{[\s\S]*?--note-edit-focus-ring-inline-padding: 0px;/,
);
assert.match(
  appCss,
  /\.floating-note-card__editor--glossary \.markdown-preview > :last-child\s*\{\s*margin-bottom: 0;/,
);
assert.match(
  appCss,
  /\.bottom-note-actions\.is-layout-placeholder\s*\{[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/,
);
assert.match(
  appCss,
  /\.floating-note-panel\.is-expanded-sidebar \.floating-note-card__editor\.is-empty,[\s\S]*?\.floating-note-card__editor\.is-empty[\s\S]*?\.markdown-preview\s*\{[\s\S]*?min-height: 100%;/,
);
assert.match(
  appCss,
  /\.floating-note-panel\.is-expanded-sidebar \.floating-note-card__body-measure\s*\{[\s\S]*?height: 100%;[\s\S]*?min-height: 100%;/,
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
