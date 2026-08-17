import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sourceEditor = readFileSync(new URL("../src/MarkdownEditor.tsx", import.meta.url), "utf8");
const previewEditor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

for (const [name, source] of [
  ["source editor", sourceEditor],
  ["preview editor", previewEditor],
] as const) {
  assert.match(
    source,
    /const handledSelectAllRequestKeyRef = useRef\(selectAllRequestKey\);/,
    `${name} must treat the initial select-all key as already handled`,
  );
  assert.match(
    source,
    /if \(handledSelectAllRequestKeyRef\.current === selectAllRequestKey\) return;\s+handledSelectAllRequestKeyRef\.current = selectAllRequestKey;/,
    `${name} must only select all for a new request key`,
  );
}

console.log("source mode select-all request regression: PASS");
