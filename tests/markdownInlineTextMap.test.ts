import assert from "node:assert/strict";
import {
  appendInlineMarkdownTextMap,
  markdownListItemContentStartOffset,
} from "../src/markdownInlineTextMap.ts";

const source = "**Autopilot:** freeze\\_and\\_run after `omg accept`.";
const textMap = { text: "", sourceOffsets: [] as (number | null)[] };

appendInlineMarkdownTextMap(textMap, source, 0);

assert.equal(textMap.text, "Autopilot: freeze_and_run after omg accept.");
assert.equal(
  textMap.sourceOffsets[textMap.text.indexOf("_")],
  source.indexOf("\\_") + 1,
);

const nestedListLines = ["- root", "    - child", "        12. grandchild"];
assert.deepEqual(
  nestedListLines.map((line) => line.slice(markdownListItemContentStartOffset(line))),
  ["root", "child", "grandchild"],
);
assert.equal(markdownListItemContentStartOffset("plain paragraph"), 0);

console.log("markdown inline text map regression: PASS");
