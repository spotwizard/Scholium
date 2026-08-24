import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  shouldHandlePreviewSelectAllShortcut,
} from "../src/editorKeyboardShortcuts.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const milkdownEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

const shortcut = {
  altKey: false,
  code: "KeyA",
  ctrlKey: false,
  key: "a",
  metaKey: true,
  shiftKey: false,
};

assert.equal(shouldHandlePreviewSelectAllShortcut(shortcut, true, false), true);
assert.equal(
  shouldHandlePreviewSelectAllShortcut({ ...shortcut, metaKey: false, ctrlKey: true }, true, false),
  true,
);
assert.equal(shouldHandlePreviewSelectAllShortcut(shortcut, false, false), false);
assert.equal(shouldHandlePreviewSelectAllShortcut(shortcut, true, true), false);
assert.equal(
  shouldHandlePreviewSelectAllShortcut({ ...shortcut, shiftKey: true }, true, false),
  false,
);
assert.equal(
  shouldHandlePreviewSelectAllShortcut({ ...shortcut, code: "KeyB", key: "b" }, true, false),
  false,
);
assert.equal(
  shouldHandlePreviewSelectAllShortcut({ ...shortcut, key: "ㄇ" }, true, false),
  true,
);
assert.match(
  milkdownEditor,
  /const targetTextControl =[\s\S]*?targetElement instanceof HTMLInputElement \|\| targetElement instanceof HTMLTextAreaElement[\s\S]*?targetTextControl\.closest\("\.milkdown-link-edit"\)[\s\S]*?shouldHandlePreviewSelectAllShortcut\(event, true, false\)[\s\S]*?targetTextControl\.select\(\);[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/,
);
assert.match(
  milkdownEditor,
  /if \(target\.closest\("button, input, textarea, select"\)\) return true;\s*if \(root\.contains\(target\)\) return false;/,
);
assert.match(
  app,
  /function handleEditorSelectAllKeyUp\(event: KeyboardEvent\) \{\s*const activeElement = document\.activeElement;\s*if \(\s*activeElement instanceof HTMLInputElement \|\|\s*activeElement instanceof HTMLTextAreaElement\s*\) \{\s*return;/,
);
console.log("preview select-all shortcut regression: PASS");
