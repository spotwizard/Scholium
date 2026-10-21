import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");

test("text typed right after inline code is not added to the code span", () => {
  // A non-inclusive mark keeps a caret at the end of inline code outside the
  // span, so typing after `main` stays plain text in paragraphs and headings.
  assert.match(
    editor,
    /ctx\.update\(inlineCodeSchema\.key, \(previousSchema\) => \(schemaCtx\) => \(\{\s*\.\.\.previousSchema\(schemaCtx\),\s*inclusive: false,\s*\}\)\);/,
  );
});

test("text typed right after a link is not added to the link", () => {
  assert.match(
    editor,
    /ctx\.update\(linkSchema\.key, \(previousSchema\) => \(schemaCtx\) => \(\{\s*\.\.\.previousSchema\(schemaCtx\),\s*inclusive: false,\s*\}\)\);/,
  );
});
