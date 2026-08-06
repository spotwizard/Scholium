import assert from "node:assert/strict";
import {
  escapeListLeadingAsterisksForPreview,
  normalizeSerializedBulletMarkers,
  normalizeListItemStrongTrailingWhitespace,
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
assert.equal(
  normalizeSerializedBulletMarkers("* 父項目\n*\n  * 子項目\n* 後項"),
  "- 父項目\n-\n  - 子項目\n- 後項",
);
assert.equal(
  normalizeSerializedBulletMarkers("*   保留既有單一空格格式\n\t*\t子項目"),
  "- 保留既有單一空格格式\n\t- 子項目",
);
assert.equal(normalizeSerializedBulletMarkers("***\n*斜體*"), "***\n*斜體*");
assert.equal(
  normalizeListItemStrongTrailingWhitespace("- **plugins/marketplace.json： **定義"),
  "- **plugins/marketplace.json：** 定義",
);
assert.equal(
  normalizeListItemStrongTrailingWhitespace("1. 說明 **重點 **內容"),
  "1. 說明 **重點** 內容",
);
assert.equal(
  normalizeListItemStrongTrailingWhitespace("**一般段落： **定義"),
  "**一般段落： **定義",
);
assert.equal(
  normalizeListItemStrongTrailingWhitespace("```\n- **code： **literal\n```"),
  "```\n- **code： **literal\n```",
);

console.log("markdown list-leading literal asterisk regression: PASS");
