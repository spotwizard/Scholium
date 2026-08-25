import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const editor = fs.readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(
  css,
  /\.markdown-editor-host > \.cm-editor \.cm-selectionBackground \{\s*background: var\(--color-accent-selection\) !important;/,
);
assert.match(
  css,
  /\.cm-editor\.scholium-native-primary-selection\s+\.cm-line::selection[\s\S]*background: var\(--color-accent-selection\) !important;/,
);
assert.doesNotMatch(
  css,
  /\.milkdown-code-block \.cm-selectionBackground \{\s*background: Highlight !important;/,
);
assert.doesNotMatch(
  css,
  /\.milkdown-code-block\s+\.cm-selectionLayer \{\s*display: none;/,
);
assert.match(editor, /navigator\.vendor !== "Apple Computer, Inc\."/);
assert.match(editor, /view\.state\.selection\.ranges\.length === 1/);
assert.match(editor, /CodeMirrorEditorView\.editorAttributes\.of/);
assert.match(editor, /selectionLayer\?\.remove\(\)/);
assert.match(editor, /view\.scrollDOM\.append\(selectionLayer\)/);
assert.match(
  editor,
  /extensions: \[\s*\.\.\.previousConfig\.extensions,\s*\.\.\.webKitCodeBlockSelectionExtensions\(\),\s*\]/,
);

console.log("code block selection renderer structure: PASS");
