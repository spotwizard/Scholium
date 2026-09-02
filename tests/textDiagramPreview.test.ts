import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languages as codeMirrorLanguages } from "@codemirror/language-data";
import {
  parseTextDiagramPreview,
  textDiagramPreviewSource,
} from "../src/textDiagramPreview.ts";

const diagram = [
  "Expo Router routes",
  "        │",
  "        ▼",
  "Feature screens",
  "        │",
  "        ├── React local state：輸入、選取、Modal、未儲存草稿",
  "        │       │",
  "        │       ├── Supabase Client：口袋名單、旅程、帳號資料",
  "        │       └── Edge Functions Client：Places、Planner",
  "        └── SQLite KV：登入 Session、最後同步行程 Snapshot",
].join("\n");

const parsed = parseTextDiagramPreview("text", diagram);
assert.ok(parsed);
assert.equal(textDiagramPreviewSource(parsed), diagram);
assert.equal(parsed.filter((line) => line.kind === "node").length, 2);
assert.equal(parsed.filter((line) => line.kind === "connector").length, 4);
assert.deepEqual(
  parsed.filter((line) => line.kind === "branch").map((line) => line.depth),
  [1, 2, 2, 1],
);

assert.equal(parseTextDiagramPreview("typescript", diagram), null);
assert.equal(parseTextDiagramPreview("text", "const value = 1;"), null);
assert.equal(parseTextDiagramPreview("text", "root\n└── only child"), null);

const typescriptLanguage = codeMirrorLanguages.find((language) => language.alias.includes("ts"));
assert.ok(typescriptLanguage);
assert.ok(await typescriptLanguage.load());

const compactTree = [
  "features/pocket/",
  "├── api.ts",
  "├── queries.ts",
  "├── types.ts",
  "├── PocketScreen.tsx",
  "└── components/",
].join("\n");
const parsedCompactTree = parseTextDiagramPreview("text", compactTree);
assert.ok(parsedCompactTree);
assert.equal(textDiagramPreviewSource(parsedCompactTree), compactTree);
assert.equal(parsedCompactTree.filter((line) => line.kind === "branch").length, 5);

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
assert.match(editor, /CodeMirrorDecoration\.line\(\{ attributes \}\)/);
assert.match(editor, /codeMirrorTextDiagramPreview/);
assert.match(editor, /classHighlighter as codeMirrorClassHighlighter/);
assert.match(editor, /codeMirrorSyntaxHighlighting\(codeMirrorClassHighlighter\)/);
assert.match(editor, /\.\.\.previousConfig,\s*languages: codeMirrorLanguages,\s*extensions:/);
assert.match(editor, /--text-diagram-label-offset:\$\{Math\.max\(0, line\.prefix\.length - 1\)\}ch/);
assert.match(styles, /\.milkdown-code-block\.is-text-diagram \{/);
assert.match(styles, /--code-block-toolbar-reserved-space: 34px/);
assert.match(styles, /--code-block-content-bottom-space: 14px/);
assert.match(
  styles,
  /\.milkdown-code-block \{[\s\S]*?padding: var\(--code-block-toolbar-reserved-space\) 12px\s+var\(--code-block-content-bottom-space\)/,
);
assert.match(
  styles,
  /\.milkdown-code-block\.is-text-diagram \{[\s\S]*?padding: var\(--code-block-toolbar-reserved-space\) 20px\s+var\(--code-block-content-bottom-space\)/,
);
assert.match(
  styles,
  /@media \(max-width: 640px\)[\s\S]*?\.milkdown-code-block \{[\s\S]*?padding: var\(--code-block-toolbar-reserved-space\) 10px\s+var\(--code-block-content-bottom-space\)/,
);
assert.match(
  styles,
  /@media \(max-width: 640px\)[\s\S]*?\.milkdown-code-block\.is-text-diagram \{[\s\S]*?padding: var\(--code-block-toolbar-reserved-space\) 12px\s+var\(--code-block-content-bottom-space\)/,
);
assert.match(styles, /inset: 0 0 0 var\(--text-diagram-label-offset, 0\)/);
assert.match(styles, /\.cm-line\.text-diagram-line\.is-depth-2::before/);
assert.match(styles, /\.tok-keyword/);
assert.match(styles, /\.tok-string/);
assert.match(styles, /\.tok-number/);

console.log("text diagram preview regression: PASS");
