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
