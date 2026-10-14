import assert from "node:assert/strict";
import {
  fencedCodeBlockSelectionFromSource,
  sourceSelectionFromFencedCodeBlock,
} from "../src/fencedCodeBlockSelection.ts";

const markdown = [
  "# 文件",
  "",
  "```text",
  "第一行",
  "圖內目標",
  "```",
  "",
  "段落",
  "",
  "```text",
  "第二張圖",
  "```",
].join("\n");
const targetOffset = "第一行\n".length + 1;
const sourceSelection = sourceSelectionFromFencedCodeBlock(markdown, 0, {
  anchor: targetOffset,
  head: targetOffset,
});

assert.ok(sourceSelection, "the first embedded editor must map into the first source fence");
assert.equal(markdown.slice(sourceSelection.head), "內目標\n```\n\n段落\n\n```text\n第二張圖\n```");
assert.deepEqual(fencedCodeBlockSelectionFromSource(markdown, sourceSelection), {
  index: 0,
  selection: { anchor: targetOffset, head: targetOffset },
});

const secondBlockSelection = sourceSelectionFromFencedCodeBlock(markdown, 1, {
  anchor: 2,
  head: 2,
});
assert.ok(secondBlockSelection);
assert.equal(markdown.slice(secondBlockSelection.head), "張圖\n```");

console.log("fenced code block cursor mapping regression: PASS");
