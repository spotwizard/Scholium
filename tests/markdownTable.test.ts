import assert from "node:assert/strict";
import { markdownHasTable, parseMarkdownTableAt } from "../src/markdownTable.ts";

const markdown = [
  "| 名稱 | 意思 |",
  "| :--- | ---: |",
  "| Grok | AI 模型 |",
  "| Grok Build | 程式開發工具 |",
];
const parsed = parseMarkdownTableAt(markdown, 0);

assert.deepEqual(parsed, {
  startLine: 0,
  endLine: 3,
  table: {
    alignments: ["left", "right"],
    header: ["名稱", "意思"],
    rows: [
      ["Grok", "AI 模型"],
      ["Grok Build", "程式開發工具"],
    ],
  },
});
assert.equal(markdownHasTable(markdown.join("\n")), true);
assert.equal(markdownHasTable("一般段落 | 仍是一般段落"), false);
assert.equal(
  markdownHasTable("| 名稱 | 意思 |\n| --- | --- |\n| Grok \\| Build | 工具 |"),
  true,
);

console.log("markdown table regression: PASS");
