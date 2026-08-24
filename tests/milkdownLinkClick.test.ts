import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const gateway = readFileSync(new URL("../src/tauriGateway.ts", import.meta.url), "utf8");

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

assert.match(gateway, /export type OpenMarkdownFileArgs = \{ path: string \};/);
assert.match(
  gateway,
  /export function openMarkdownFile\(args: OpenMarkdownFileArgs\) \{\n  return invoke<OpenMarkdownFileResult>\("open_markdown_file", args\);\n\}/,
);
const openMarkdownLink = app.match(
  /async function openMarkdownLink\(href: string\) \{[\s\S]*?\n  \}\n\n  function handleDocumentTabPointerDown/,
)?.[0];
assert.ok(openMarkdownLink, "Markdown link opening flow should exist");
assert.match(
  openMarkdownLink,
  /const target = resolveMarkdownLinkTarget\([\s\S]*?await openExternalUrl\(target\.href\);[\s\S]*?await openDropboxMarkdownFilePath\(target\.path\);[\s\S]*?const loaded = await openMarkdownFile\(\{\n        path: target\.path,\n      \}\);[\s\S]*?mergeLoadedFilesIntoDocumentState\(\[loaded\]\);[\s\S]*?selectDocument\(loaded\.path\);[\s\S]*?rememberLastOpenedMarkdownPath\(loaded\.path\);/,
  "external, Dropbox, and local Markdown targets must keep their established call order",
);
assert.match(app, /onLinkClick=\{\(href\) => void openMarkdownLink\(href\)\}/);
assert.match(
  appStyles,
  /\.milkdown-markdown-editor \.ProseMirror a\[href\] \{\n  cursor: pointer;\n\}/,
);
assert.doesNotMatch(appStyles, /milkdown-link-(?:preview|edit)[\s\S]*?z-index: 91;/);

console.log("milkdown link click regression: PASS");
