import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { typingLineBottomMargin } from "../src/editorTypingLine.ts";

test("the typing line stays above the lower third of the window", () => {
  assert.equal(typingLineBottomMargin(900), 300);
  assert.equal(typingLineBottomMargin(800), 267);
  assert.equal(typingLineBottomMargin(0), 0);
  assert.equal(typingLineBottomMargin(Number.NaN), 0);
});

test("both document editors keep the typing line away from the bottom edge", () => {
  const preview = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/MarkdownEditor.tsx", import.meta.url), "utf8");

  for (const option of ["scrollThreshold", "scrollMargin"]) {
    assert.match(
      preview,
      new RegExp(`${option}: \\{[^}]*get bottom\\(\\) \\{\\s*return currentTypingLineBottomMargin\\(\\);`),
    );
  }
  assert.match(
    source,
    /EditorView\.scrollMargins\.of\(\(\) => \(\{ bottom: currentTypingLineBottomMargin\(\) \}\)\)/,
  );
});

test("the blank space after the document is editor padding, not Markdown content", () => {
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  const room = css.match(/--editor-end-scroll-room:\s*(\d+)vh;/);
  assert.ok(room, "the end room is defined relative to the window height");
  // The last line can only reach the typing line when the room is taller than its margin.
  assert.ok(Number(room[1]) / 100 > 1 / 3);

  const rule = css.match(
    /\.editor-content-frame > \.markdown-editor-host > \.cm-editor \.cm-content,\s*\.editor-content-frame > \.milkdown-markdown-editor-shell \.milkdown \.ProseMirror\s*\{([^}]*)\}/,
  );
  assert.ok(rule, "both document editors share the end room rule");
  assert.match(rule[1], /padding-bottom: var\(--editor-end-scroll-room\);/);
});
