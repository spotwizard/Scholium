import assert from "node:assert/strict";
import { appendInlineMarkdownTextMap } from "../src/markdownInlineTextMap.ts";

const source = "**Autopilot:** freeze\\_and\\_run after `omg accept`.";
const textMap = { text: "", sourceOffsets: [] as (number | null)[] };

appendInlineMarkdownTextMap(textMap, source, 0);

assert.equal(textMap.text, "Autopilot: freeze_and_run after omg accept.");
assert.equal(
  textMap.sourceOffsets[textMap.text.indexOf("_")],
  source.indexOf("\\_") + 1,
);
console.log("markdown inline text map regression: PASS");
