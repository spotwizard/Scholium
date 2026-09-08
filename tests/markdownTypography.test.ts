import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appCss = readFileSync("src/App.css", "utf8");
const mermaidReadingCss = readFileSync("src/mermaidReading.css", "utf8");
const mermaidTs = readFileSync("src/mermaid.ts", "utf8");

function declarationsFor(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test("reading headings use the body font while code blocks keep monospace", () => {
  assert.match(appCss, /--scholium-body-font:\s*[\s\S]*?Inter[\s\S]*?sans-serif;/);
  assert.match(appCss, /--scholium-code-font:\s*[\s\S]*?SFMono-Regular[\s\S]*?monospace;/);
  assert.match(appCss, /--crepe-font-default:\s*var\(--scholium-body-font\);/);
  assert.match(appCss, /--crepe-font-title:\s*var\(--crepe-font-default\);/);
  assert.doesNotMatch(appCss, /--scholium-reading-font/);
  assert.doesNotMatch(declarationsFor(appCss, ".markdown-preview"), /font-family:/);
  assert.match(declarationsFor(appCss, ".markdown-preview code"), /font-family:\s*var\(--scholium-code-font\);/);
  assert.match(
    declarationsFor(appCss, ".milkdown-markdown-editor .ProseMirror code"),
    /font-family:\s*var\(--scholium-code-font\);/,
  );
  assert.match(
    declarationsFor(appCss, ".milkdown-markdown-editor .milkdown .milkdown-code-block .cm-scroller"),
    /font-family:\s*var\(--scholium-code-font\);/,
  );
});

test("flowchart renderers use the same body font stack", () => {
  assert.match(mermaidReadingCss, /font-family:\s*[\s\S]*?Inter[\s\S]*?var\(--scholium-body-cjk-font\)[\s\S]*?sans-serif;/);
  assert.match(mermaidTs, /fontFamily:\s*[\s\S]*?Inter[\s\S]*?PingFang TC[\s\S]*?sans-serif/);
});
