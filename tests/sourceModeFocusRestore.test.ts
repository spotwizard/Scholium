import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sourceEditor = readFileSync(new URL("../src/MarkdownEditor.tsx", import.meta.url), "utf8");
const previewEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /function toggleEditorMode\([\s\S]*?restoreEditorFocus = false[\s\S]*?const shouldRestoreEditorFocus = Boolean\(event\) \|\| Boolean\(restoreEditorFocus && activeEditor\);[\s\S]*?if \(shouldRestoreEditorFocus\)[\s\S]*?const currentSelection = activeDocumentEditorRef\.current\?\.getSelectionSnapshot\(\);[\s\S]*?setEditorFocusRequest\(\{[\s\S]*?documentId: selectedDocumentIdRef\.current,[\s\S]*?mode: nextEditorMode,[\s\S]*?selection: currentSelection \?\? null,/,
  "toolbar clicks and focused-editor shortcuts must pass the current cursor to the target editor",
);
assert.match(
  app,
  /closeNotePanel\(\);\s*toggleEditorMode\(undefined, true\);/,
  "Cmd+/ must request editor focus restoration",
);
assert.ok(
  (app.match(/onClick=\{toggleEditorMode\}/g) ?? []).length >= 2,
  "desktop and mobile mode buttons must share the cursor-preserving mode switch",
);
assert.ok(
  (app.match(/onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/g) ?? []).length >= 2,
  "desktop and mobile mode buttons must preserve the active editor until its cursor is captured",
);

for (const [name, source] of [
  ["source editor", sourceEditor],
  ["preview editor", previewEditor],
] as const) {
  assert.match(source, /focusRequestKey\?: number;/, `${name} must accept a one-shot focus request`);
  assert.match(
    source,
    /selectionToRestore\?: EditorSelectionSnapshot \| null;/,
    `${name} must accept the mode's previous cursor position`,
  );
  assert.match(
    source,
    /onFocusRequestHandled\?\.\(focusRequestKey\);/,
    `${name} must consume the focus request after restoring the cursor`,
  );
}

assert.match(
  sourceEditor,
  /EditorSelection\.range\([\s\S]*?anchor,[\s\S]*?head,[\s\S]*?selectionToRestore\.association[\s\S]*?view\.focus\(\);/,
  "source mode must restore the CodeMirror selection before focusing",
);
assert.match(
  previewEditor,
  /proseSelectionFromMarkdownSelection\([\s\S]*?currentMarkdownRef\.current,[\s\S]*?selectionToRestore,[\s\S]*?TextSelection\.create\(view\.state\.doc, anchor, head\)[\s\S]*?view\.dom\.focus\(\{ preventScroll: true \}\);/,
  "preview mode must convert the source position back to Milkdown before focusing",
);
assert.match(
  sourceEditor,
  /useImperativeHandle\(ref, \(\) => \(\{[\s\S]*?getSelectionSnapshot\(\)[\s\S]*?viewRef\.current[\s\S]*?state\.selection\.main/,
  "source mode must expose its current Markdown cursor before unmount",
);
assert.match(
  previewEditor,
  /useImperativeHandle\(ref, \(\) => \(\{[\s\S]*?getSelectionSnapshot\(\)[\s\S]*?markdownSelectionFromProseSelection\([\s\S]*?currentMarkdownRef\.current,[\s\S]*?view\.state\.selection/,
  "preview mode must convert its cursor to a Markdown position before unmount",
);
assert.match(
  previewEditor,
  /const visiblePrefix = doc\.textBetween\(0, position, "\\n"\);[\s\S]*?\/\\s\/\.test\(textMap\.text\[visibleIndex\][\s\S]*?visibleTextIndex\.positions\.findIndex\([\s\S]*?visiblePosition === position[\s\S]*?visibleTextIndex\.text\[proseTextIndex\] !== " "[\s\S]*?previousOffset \+ 1[\s\S]*?slice\(visibleIndex \+ 1\)/,
  "preview mode must preserve which side of a visible line boundary owns the cursor",
);
assert.match(
  previewEditor,
  /activeElement\.closest<HTMLElement>\("\.milkdown-code-block \.cm-editor"\)[\s\S]*?CodeMirrorEditorView\.findFromDOM\(codeMirrorElement\)[\s\S]*?sourceSelectionFromFencedCodeBlock\([\s\S]*?codeMirrorSelection[\s\S]*?codeMirrorView\.coordsAtPos\(codeMirrorSelection\.head\)/,
  "preview mode must read the active embedded code editor instead of a stale outer cursor",
);
assert.match(
  previewEditor,
  /fencedCodeBlockSelectionFromSource\([\s\S]*?proseCodeBlockContentStartAtIndex\([\s\S]*?codeBlockSelection\.selection\.anchor[\s\S]*?codeBlockSelection\.selection\.head[\s\S]*?TextSelection\.create\(view\.state\.doc, anchor, head\)[\s\S]*?codeBlockElement\?\.querySelector<HTMLElement>\("\.cm-editor"\)[\s\S]*?CodeMirrorEditorView\.findFromDOM\(codeMirrorElement\)/,
  "preview mode must restore a source cursor into the matching embedded code editor",
);
assert.match(
  previewEditor,
  /codeBlockElement && !codeMirrorView && attempt === 0[\s\S]*?codeBlockElement\.scrollIntoView\(\{ block: "nearest" \}\)[\s\S]*?attempt < 40[\s\S]*?window\.setTimeout\(\(\) => restoreCodeBlockFocus\(attempt \+ 1\), 25\)/,
  "preview mode must reveal a lazy code block and wait for its real editor before restoring the viewport",
);
for (const [name, source] of [
  ["source editor", sourceEditor],
  ["preview editor", previewEditor],
] as const) {
  assert.match(
    source,
    /scheduleEditorViewportRestore\(/,
    `${name} must preserve the cursor's viewport position during a mode switch`,
  );
}

console.log("source mode focus and cursor restoration regression: PASS");
