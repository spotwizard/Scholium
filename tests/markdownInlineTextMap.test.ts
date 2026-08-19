import assert from "node:assert/strict";
import {
  appendInlineMarkdownTextMap,
  closestTextIndex,
  findNonOverlappingTextIndices,
  markdownLineStartOffsets,
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

assert.equal(closestTextIndex([], 10), -1);
assert.equal(closestTextIndex([2, 8, 14], 10), 8);
assert.equal(closestTextIndex([2, 8, 14], 12), 14);
assert.equal(closestTextIndex([8, 14], 11), 8, "equal distances keep the first index");

assert.deepEqual(findNonOverlappingTextIndices("text", ""), []);
assert.deepEqual(findNonOverlappingTextIndices("one two one one", "one"), [0, 8, 12]);
assert.deepEqual(findNonOverlappingTextIndices("aaaaa", "aa"), [0, 2]);

assert.deepEqual(markdownLineStartOffsets(""), [0]);
assert.deepEqual(markdownLineStartOffsets("alpha\nbeta\n"), [0, 6, 11]);
assert.deepEqual(
  markdownLineStartOffsets("😀\r\n\tbeta"),
  [0, 4],
  "line offsets stay in JavaScript UTF-16 coordinates and only split on LF",
);

console.log("markdown inline text map regression: PASS");
