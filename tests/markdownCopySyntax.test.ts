import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const milkdown = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /selectionElements\.some\(\(element\) => element\.closest\("\.milkdown-markdown-editor"\)\)/,
);
assert.match(
  milkdown,
  /clipboardTextSerializer: \(slice, view\) =>[\s\S]*?serializeMarkedTextClipboardSlice\(slice, view, ctx\.get\(serializerCtx\)\)/,
);
assert.match(
  milkdown,
  /prev\.clipboardTextSerializer\?\.\(slice, view\) \?\?\s*""/,
);
assert.doesNotMatch(milkdown, /addEventListener\("copy"/);
assert.doesNotMatch(milkdown, /removeEventListener\("copy"/);
assert.doesNotMatch(milkdown, /function handleMarkdownCopy/);
assert.doesNotMatch(milkdown, /markdownCopyTextFromRange/);

console.log("markdown copy syntax regression: PASS");
