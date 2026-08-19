import assert from "node:assert/strict";
import {
  parseMarkdownListLine,
  parseMarkdownPreviewBlocks,
  parseNoteMarkdownPreviewBlocks,
} from "../src/markdownPreview.ts";

assert.deepEqual(parseMarkdownListLine("\t12) item"), {
  indent: 4,
  kind: "ordered-list",
  markerLength: 5,
  text: "item",
});
assert.deepEqual(parseMarkdownListLine("  + item"), {
  indent: 2,
  kind: "unordered-list",
  markerLength: 4,
  text: "item",
});
assert.equal(parseMarkdownListLine("plain text"), null);

const basicMarkdown = [
  "",
  "# Heading",
  "",
  "first line",
  "second line",
  "",
  "> quote one",
  ">quote two",
  "",
  "---",
  "",
].join("\n");
assert.deepEqual(parseMarkdownPreviewBlocks(basicMarkdown), [
  {
    kind: "heading",
    key: "markdown-block-1",
    startLine: 1,
    endLine: 1,
    level: 1,
    text: "Heading",
  },
  {
    kind: "paragraph",
    key: "markdown-block-3",
    startLine: 3,
    endLine: 4,
    text: "first line\nsecond line",
  },
  {
    kind: "quote",
    key: "markdown-block-6",
    startLine: 6,
    endLine: 7,
    text: "quote one\nquote two",
  },
  {
    kind: "rule",
    key: "markdown-block-9",
    startLine: 9,
    endLine: 9,
  },
]);

const listLines = ["- Parent", "\t1. Child one", "\t2) Child two", "- Sibling"];
assert.deepEqual(parseMarkdownPreviewBlocks(listLines.join("\n")), [
  {
    kind: "unordered-list",
    key: "markdown-block-0",
    startLine: 0,
    endLine: 3,
    items: ["Parent", "Child one", "Child two", "Sibling"],
    rawLines: listLines,
    list: {
      kind: "unordered-list",
      items: [
        {
          children: [
            {
              kind: "ordered-list",
              items: [
                {
                  children: [],
                  flatIndex: 1,
                  key: "markdown-block-0-item-1",
                  text: "Child one",
                },
                {
                  children: [],
                  flatIndex: 2,
                  key: "markdown-block-0-item-2",
                  text: "Child two",
                },
              ],
            },
          ],
          flatIndex: 0,
          key: "markdown-block-0-item-0",
          text: "Parent",
        },
        {
          children: [],
          flatIndex: 3,
          key: "markdown-block-0-item-3",
          text: "Sibling",
        },
      ],
    },
  },
]);

const fencedMarkdown = [
  "```TypeScript title=demo",
  "const x = 1",
  "",
  "```",
  "```mermaid",
  "graph TD",
  "```",
].join("\n");
assert.deepEqual(parseMarkdownPreviewBlocks(fencedMarkdown), [
  {
    kind: "code",
    key: "markdown-block-0",
    startLine: 0,
    endLine: 3,
    info: "TypeScript title=demo",
    language: "typescript",
    text: "const x = 1\n",
  },
  {
    kind: "code",
    key: "markdown-block-4",
    startLine: 4,
    endLine: 6,
    info: "mermaid",
    language: "mermaid",
    text: "graph TD",
  },
]);

const tableMarkdown = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
assert.deepEqual(parseMarkdownPreviewBlocks(tableMarkdown), [
  {
    kind: "paragraph",
    key: "markdown-block-0",
    startLine: 0,
    endLine: 2,
    text: tableMarkdown,
  },
]);

const noteMarkdown = [
  "# Before",
  "",
  "| A | B |",
  "| :--- | ---: |",
  "| 1 | 2 |",
  "",
  "```md",
  "| not | table |",
  "| --- | --- |",
  "```",
  "",
  "After",
].join("\n");
assert.deepEqual(parseNoteMarkdownPreviewBlocks(noteMarkdown), [
  {
    kind: "heading",
    key: "note-0-markdown-block-0",
    startLine: 0,
    endLine: 0,
    level: 1,
    text: "Before",
  },
  {
    kind: "table",
    key: "note-table-2",
    table: {
      alignments: ["left", "right"],
      header: ["A", "B"],
      rows: [["1", "2"]],
    },
  },
  {
    kind: "code",
    key: "note-5-markdown-block-1",
    startLine: 1,
    endLine: 4,
    info: "md",
    language: "md",
    text: "| not | table |\n| --- | --- |",
  },
  {
    kind: "paragraph",
    key: "note-5-markdown-block-6",
    startLine: 6,
    endLine: 6,
    text: "After",
  },
]);

assert.deepEqual(
  parseMarkdownPreviewBlocks("---\r\ntitle: Hidden\r\n---\r\n\r\n## Visible"),
  [
    {
      kind: "heading",
      key: "markdown-block-4",
      startLine: 4,
      endLine: 4,
      level: 2,
      text: "Visible",
    },
  ],
);

console.log("markdown preview parser behavior: PASS");
