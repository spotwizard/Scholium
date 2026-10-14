import assert from "node:assert/strict";
import {
  encodeEmptyParagraphsForMilkdown,
  normalizeMarkdownForScholium,
  normalizeSelectedText,
} from "../src/milkdownSerialization.ts";

assert.equal(normalizeSelectedText("  one\u00a0 two\nthree  "), "one two three");

assert.equal(
  normalizeMarkdownForScholium("before \\[label]\\(https://example.com) after"),
  "before [label](https://example.com) after",
);
assert.equal(
  normalizeMarkdownForScholium("!\\[alt]\\(image.png)"),
  "!\\[alt]\\(image.png)",
);

const fencedMarkdown = [
  "```md",
  "\\[literal]\\(target)",
  "line\\",
  "<br />",
  "```",
].join("\n");
assert.equal(normalizeMarkdownForScholium(fencedMarkdown), fencedMarkdown);

assert.equal(normalizeMarkdownForScholium("- <br />\n1. <br>"), "-\n1.");
assert.equal(normalizeMarkdownForScholium("first\\\nsecond"), "first\nsecond");
assert.equal(
  normalizeMarkdownForScholium(`first${"\\".repeat(3)}\nsecond`),
  `first${"\\".repeat(2)}\nsecond`,
);

const serializedLiteralBackslashList = `* 前\n* ${"\\".repeat(2)}\n* 後\n`;
const normalizedLiteralBackslashList = normalizeMarkdownForScholium(
  serializedLiteralBackslashList,
);
assert.equal(
  normalizedLiteralBackslashList,
  `- 前\n- ${"\\".repeat(2)}\n- 後\n`,
);
assert.equal(
  normalizeMarkdownForScholium(normalizedLiteralBackslashList),
  normalizedLiteralBackslashList,
);

const punctuationSymbols = [
  ...Array.from({ length: 15 }, (_, index) => String.fromCharCode(33 + index)),
  ...Array.from({ length: 7 }, (_, index) => String.fromCharCode(58 + index)),
  ...Array.from({ length: 6 }, (_, index) => String.fromCharCode(91 + index)),
  ...Array.from({ length: 4 }, (_, index) => String.fromCharCode(123 + index)),
  ...Array.from("（）［］｛｝【】「」『』〈〉《》、。，！？：；＃＊＋－＿～｜＠＆％＄＝＜＞＾｀／＼"),
].filter((symbol, index, symbols) => symbols.indexOf(symbol) === index);

for (const symbol of punctuationSymbols) {
  for (const candidate of [symbol, `\\${symbol}`]) {
    const initial = `- 前\n- ${candidate}\n- 後`;
    const normalized = normalizeMarkdownForScholium(initial);
    assert.equal(
      normalizeMarkdownForScholium(normalized),
      normalized,
      `normalization should be idempotent for ${JSON.stringify(candidate)}`,
    );
  }
}

assert.equal(
  normalizeMarkdownForScholium("* **label **value\n\n* \\* literal"),
  "- **label** value\n- * literal",
);

const consecutiveEmptyParagraphs = "first\n\n\nlast";
const encodedEmptyParagraphs = "first\n\n<br />\n\nlast";
assert.equal(
  encodeEmptyParagraphsForMilkdown(consecutiveEmptyParagraphs),
  encodedEmptyParagraphs,
);
assert.equal(
  normalizeMarkdownForScholium(encodedEmptyParagraphs),
  consecutiveEmptyParagraphs,
);

const fencedEmptyParagraphs = "```text\nfirst\n\n\nlast\n```";
assert.equal(encodeEmptyParagraphsForMilkdown(fencedEmptyParagraphs), fencedEmptyParagraphs);

console.log("milkdown link serialization regression: PASS");
