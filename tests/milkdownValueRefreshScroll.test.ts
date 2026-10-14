import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const valueRefreshEffect =
  editor.match(
    /useEffect\(\(\) => \{\s*const normalizedValue = normalizeMarkdownForScholium\(value\);[\s\S]*?\}, \[value\]\);/,
  )?.[0] ?? "";

assert.match(
  valueRefreshEffect,
  /root\.style\.minHeight = `\$\{root\.scrollHeight\}px`;[\s\S]*?scrollTop: scrollContainer\.scrollTop,[\s\S]*?setEditorRevision/,
);
assert.match(
  editor,
  /function restoreScrollAfterValueRefresh\(root: HTMLElement\) \{[\s\S]*?root\.style\.minHeight = "";[\s\S]*?snapshot\.scrollContainer\.scrollTop = snapshot\.scrollTop;/,
);
assert.match(
  editor,
  /\.then\(\(\) => \{\s*if \(disposed\) return;\s*restoreScrollAfterValueRefresh\(root\);\s*acceptsMarkdownUpdates = true;/,
);

console.log("Milkdown external value refresh scroll preservation: PASS");
