import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appCss = readFileSync("src/App.css", "utf8");
const mermaidReadingCss = readFileSync("src/mermaidReading.css", "utf8");
const mermaidTs = readFileSync("src/mermaid.ts", "utf8");
const pdfExportTs = readFileSync("src/pdfExport.ts", "utf8");

function declarationsFor(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test("reading content, headings, and code use the same English font", () => {
  assert.match(appCss, /--scholium-english-font:\s*[\s\S]*?-apple-system[\s\S]*?Arial;/);
  assert.match(appCss, /--scholium-body-font:\s*[\s\S]*?var\(--scholium-english-font\)[\s\S]*?sans-serif;/);
  assert.match(appCss, /--scholium-code-font:\s*var\(--scholium-body-font\);/);
  assert.match(appCss, /--crepe-font-default:\s*var\(--scholium-body-font\);/);
  assert.match(appCss, /--crepe-font-title:\s*var\(--crepe-font-default\);/);
  assert.doesNotMatch(appCss, /--scholium-reading-font/);
  assert.match(declarationsFor(appCss, ".markdown-preview"), /font-family:\s*var\(--scholium-body-font\);/);
  assert.match(
    declarationsFor(
      appCss,
      ".markdown-preview h1,\n.markdown-preview h2,\n.markdown-preview h3,\n.markdown-preview h4,\n.markdown-preview h5,\n.markdown-preview h6",
    ),
    /font-family:\s*var\(--scholium-body-font\);/,
  );
  assert.match(declarationsFor(appCss, ".markdown-preview code"), /font-family:\s*var\(--scholium-code-font\);/);
  assert.match(
    declarationsFor(appCss, ".milkdown-markdown-editor .ProseMirror code"),
    /font-family:\s*var\(--scholium-code-font\);/,
  );
  assert.match(
    declarationsFor(appCss, ".milkdown-markdown-editor .milkdown .milkdown-code-block .cm-scroller"),
    /font-family:\s*var\(--scholium-code-font\);/,
  );
  assert.match(
    declarationsFor(
      appCss,
      ".milkdown-markdown-editor\n  .milkdown\n  .milkdown-code-block.is-text-diagram\n  .cm-scroller",
    ),
    /font-family:\s*var\(--scholium-body-font\);/,
  );
});

test("flowchart renderers use the same body font stack", () => {
  assert.match(mermaidReadingCss, /font-family:\s*var\(--scholium-body-font\);/);
  assert.match(mermaidTs, /scholiumMermaidFontFamily\s*=[\s\S]*?-apple-system[\s\S]*?PingFang TC[\s\S]*?sans-serif/);
  assert.match(mermaidTs, /fontFamily:\s*scholiumMermaidFontFamily/);
});

test("PDF export uses the same English font for body and code", () => {
  assert.match(
    pdfExportTs,
    /pdfBodyFontFamily\s*=[\s\S]*?-apple-system[\s\S]*?SF Pro Text[\s\S]*?PingFang TC[\s\S]*?sans-serif/,
  );
  assert.match(pdfExportTs, /const pdfMonoFontFamily = pdfBodyFontFamily;/);
});
