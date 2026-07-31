import assert from "node:assert/strict";
import {
  escapeListLeadingAsterisksForPreview,
  restoreListLeadingAsterisksFromPreview,
} from "../src/markdownListLiteral.ts";

const source = [
  '  - * 具體元素是為了讓讀者形成清楚認知',
  '      - 子項目',
].join("\n");
const previewMarkdown = [
  '  - \\* 具體元素是為了讓讀者形成清楚認知',
  '      - 子項目',
].join("\n");

assert.equal(escapeListLeadingAsterisksForPreview(source), previewMarkdown);
assert.equal(restoreListLeadingAsterisksFromPreview(previewMarkdown), source);
assert.equal(escapeListLeadingAsterisksForPreview("- *斜體*"), "- *斜體*");
assert.equal(
  escapeListLeadingAsterisksForPreview("- 父項目\n  * 子項目"),
  "- 父項目\n  * 子項目",
);
assert.equal(
  escapeListLeadingAsterisksForPreview("```\n- * 程式碼中的星號\n```"),
  "```\n- * 程式碼中的星號\n```",
);

console.log("markdown list-leading literal asterisk regression: PASS");
