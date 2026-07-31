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
  /container\.addEventListener\("copy", handleMarkdownCopy, true\)/,
);
assert.match(
  milkdown,
  /event\.clipboardData\.setData\("text\/plain", copyText\)/,
);
assert.match(
  milkdown,
  /return stripMarkdownFrontmatter\(currentMarkdownRef\.current\);/,
);
assert.match(
  milkdown,
  /function markdownCopyTextFromAnchor[\s\S]*markdownCopyTextFromRange\(markdown, anchor\.from, anchor\.to\)/,
);

console.log("markdown copy syntax regression: PASS");
