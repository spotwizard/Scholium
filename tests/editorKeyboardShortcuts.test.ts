import assert from "node:assert/strict";
import {
  shouldHandlePreviewSelectAllShortcut,
} from "../src/editorKeyboardShortcuts.ts";

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
console.log("preview select-all shortcut regression: PASS");
