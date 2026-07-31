import assert from "node:assert/strict";
import { markdownCopyTextFromRange } from "../src/markdownClipboard.ts";

const nestedListSource = "    - 樹林\n      - 林景？綠意？\n    - 山中";
const nestedListCopy = markdownCopyTextFromRange(
  nestedListSource,
  nestedListSource.indexOf("樹林"),
  nestedListSource.indexOf("綠意？") + "綠意？".length,
);
assert.equal(nestedListCopy, "- 樹林\n  - 林景？綠意？");

console.log("markdown nested-list copy regression: PASS");
