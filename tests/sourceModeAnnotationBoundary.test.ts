import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const sourceEditor = readFileSync(
  new URL("../src/MarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /function normalizeDocumentModeState[\s\S]*?editorMode:\s*modeState\.noteModeEnabled\s*\?\s*"preview"\s*:\s*modeState\.editorMode/,
);
assert.match(
  app,
  /function toggleEditorMode\(\s*event\?: MouseEvent<HTMLButtonElement>,\s*restoreEditorFocus = false,\s*\) \{\s*if \(noteModeEnabledRef\.current\) \{\s*showNoteModeSourceBlockedNotice\(event\?\.currentTarget\);\s*return;/,
);
assert.match(
  app,
  /function toggleNoteMode\(\)[\s\S]*?editorMode:\s*nextNoteModeEnabled\s*\?\s*"preview"\s*:\s*editorModeRef\.current/,
);
assert.match(
  app,
  /event\.preventDefault\(\);\s*if \(noteModeEnabled\) \{\s*event\.stopPropagation\(\);\s*showNoteModeSourceBlockedNotice\(\);\s*return;\s*\}\s*closeNotePanel\(\);\s*toggleEditorMode\(undefined, true\);/,
);

const disabledSourceModeControls = app.match(/aria-disabled=\{noteModeEnabled\}/g) ?? [];
assert.ok(
  disabledSourceModeControls.length >= 2,
  "desktop and mobile source-mode controls must expose their disabled state in note mode",
);
assert.doesNotMatch(
  app,
  /(?<!aria-)disabled=\{noteModeEnabled\}/,
  "source-mode controls must receive clicks so they can explain why editing is unavailable",
);
assert.match(
  app,
  /noteModeSourceBlockedNoticePosition\s*\?\s*t\("toolbar\.sourceMode\.blockedByNoteMode"\)/,
);
assert.match(
  css,
  /\.editor-mode-toggle\[aria-disabled="true"\][\s\S]*?cursor:\s*not-allowed;/,
);
assert.match(
  app,
  /const noticeWidth = Math\.min\(320, window\.innerWidth - 32\);[\s\S]*?const noticeLeft = Math\.min\([\s\S]*?Math\.max\(16, buttonRect\.left \+ buttonRect\.width \/ 2 - noticeWidth \/ 2\),[\s\S]*?window\.innerWidth - 16 - noticeWidth,[\s\S]*?setNoteModeSourceBlockedNoticePosition\(\{\s*top:\s*Math\.round\(buttonRect\.bottom \+ 12\),\s*left:\s*Math\.round\(noticeLeft\),\s*\}\)/,
);
assert.match(
  css,
  /\.mobile-note-selection-hint\.is-source-mode-blocked\s*\{[\s\S]*?width:\s*min\(320px,\s*calc\(100vw - 32px\)\);[\s\S]*?transform:\s*none;/,
);

const sourceEditorRender = app.match(/<MarkdownEditor\s+[\s\S]*?\/>/)?.[0] ?? "";
assert.ok(sourceEditorRender, "source editor render must exist");
assert.doesNotMatch(
  sourceEditorRender,
  /annotations=|noteModeEnabled=|onAnnotation|onSelectionChange=|onSelectionEnter/,
);
assert.match(sourceEditorRender, /onChange=\{updateSelectedDocumentBody\}/);

assert.doesNotMatch(
  sourceEditor,
  /setAnnotationsEffect|cm-note-annotation|cm-annotation-frame|noteModeEnabled|onAnnotation|onSelectionEnter/,
);
assert.doesNotMatch(
  app,
  /cm-note-annotation|cm-annotation-frame|cm-annotation-layer|cm-glossary-annotation/,
);
assert.doesNotMatch(
  css,
  /cm-note-annotation|cm-annotation-frame|cm-annotation-layer|cm-glossary-annotation/,
);

assert.match(
  app,
  /<MilkdownMarkdownEditor[\s\S]*?annotations=\{annotations\}[\s\S]*?noteModeEnabled=\{noteModeEnabled\}[\s\S]*?onAnnotationClick=\{showAnnotationViewer\}[\s\S]*?onSelectionEnter=\{handleSelectionEnter\}/,
);

console.log("source mode annotation boundary regression: PASS");
