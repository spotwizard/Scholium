import assert from "node:assert/strict";
import { parseMarkdownTableAt } from "../src/markdownTable.ts";

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
assert.equal(parseMarkdownTableAt(["一般段落 | 仍是一般段落"], 0), null);
assert.deepEqual(
  parseMarkdownTableAt(["| 名稱 | 意思 |", "| --- | --- |", "| Grok \\| Build | 工具 |"], 0)
    ?.table.rows,
  [["Grok | Build", "工具"]],
);

console.log("markdown table regression: PASS");
