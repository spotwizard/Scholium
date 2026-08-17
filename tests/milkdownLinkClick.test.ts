import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);

assert.match(editor, /onLinkClick\?: \(href: string\) => void;/);
assert.match(editor, /const handleLinkClick = \(e: MouseEvent\) => \{/);
assert.match(editor, /target\?\.closest<HTMLAnchorElement>\("a\[href\]"\)/);
assert.match(editor, /link\?\.getAttribute\("href"\)\?\.trim\(\)/);
assert.match(editor, /if \(!href \|\| href\.startsWith\("#"\)\) return;/);
assert.match(
  editor,
  /e\.preventDefault\(\);\n\s*e\.stopPropagation\(\);\n\s*onLinkClickRef\.current\?\.\(href\);/,
);
assert.match(editor, /container\.addEventListener\("click", handleLinkClick, true\);/);
assert.match(editor, /container\.removeEventListener\("click", handleLinkClick, true\);/);

assert.match(app, /async function openMarkdownLink\(href: string\) \{/);
assert.match(app, /const target = resolveMarkdownLinkTarget\(/);
assert.match(app, /await openExternalUrl\(target\.href\);/);
assert.match(app, /await openDropboxMarkdownFilePath\(target\.path\);/);
assert.match(app, /invoke<OpenMarkdownFileResult>\("open_markdown_file", \{/);
assert.match(app, /onLinkClick=\{\(href\) => void openMarkdownLink\(href\)\}/);
assert.match(
  appStyles,
  /\.milkdown-markdown-editor \.ProseMirror a\[href\] \{\n  cursor: pointer;\n\}/,
);

console.log("milkdown link click regression: PASS");
