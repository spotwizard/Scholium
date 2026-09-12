import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languages as codeMirrorLanguages } from "@codemirror/language-data";
import {
  isCommentedFileTreeCodeBlock,
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

const boxedFlow = [
  "┌──────────────────────────────┐",
  "│ 第一層：功能規格 (What & Why) │",
  "└──────────────┬───────────────┘",
  "               │ 雙向追溯",
  "               ▼",
  "┌──────────────────────────────┐",
  "│ 第二層：系統架構              │",
  "└──────────────┬───────────────┘",
  "               ▼",
  "┌──────────────────────────────┐",
  "│ 第三層：技術設計 (How)        │",
  "└──────────────────────────────┘",
].join("\n");
// Box borders are geometry, not tree branches or red title labels.
assert.equal(parseTextDiagramPreview("Text", boxedFlow), null);
assert.equal(parseTextDiagramPreview("text", boxedFlow.replace(/\n/g, "\r\n")), null);
assert.equal(parseTextDiagramPreview("text", `${diagram}\n${boxedFlow}`), null);

const linearFlow = [
  "搜尋地點",
  "→ 確認正確地點",
  "→ 加入口袋名單",
  "→ 建立旅程與日期",
  "→ 從口袋名單加入地點",
  "→ 手動調整順序",
  "├── 手動完成：儲存使用者排列的順序",
  "└── 需要系統協助：取得安排建議",
  "↓",
  "更新可離線查看的行程摘要",
].join("\n");
const parsedLinearFlow = parseTextDiagramPreview("text", linearFlow);
assert.ok(parsedLinearFlow);
assert.equal(textDiagramPreviewSource(parsedLinearFlow), linearFlow);
assert.equal(parsedLinearFlow[1]?.kind, "branch");
assert.equal(parsedLinearFlow[1]?.prefix, "→ ");
assert.equal(parsedLinearFlow[8]?.kind, "connector");
assert.equal(parsedLinearFlow[8]?.prefix, "↓");

const horizontalArrows = [
  "使用者",
  "  ├──────────► Supabase Data API",
  "  │",
  "  ├──────────► PostgreSQL 資料庫函式",
  "  │",
  "  └──────────► Supabase Edge Functions",
].join("\n");
const parsedHorizontalArrows = parseTextDiagramPreview("text", horizontalArrows);
assert.ok(parsedHorizontalArrows);
assert.equal(textDiagramPreviewSource(parsedHorizontalArrows), horizontalArrows);
assert.equal(parsedHorizontalArrows[1]?.prefix, "  ├──────────► ");
assert.equal(parsedHorizontalArrows[1]?.label, "Supabase Data API");

const continuedHorizontalArrows = `${horizontalArrows}\n  │              儲存帳號、口袋名單與旅程`;
const parsedContinuedHorizontalArrows = parseTextDiagramPreview(
  "text",
  continuedHorizontalArrows,
);
assert.ok(parsedContinuedHorizontalArrows);
assert.equal(textDiagramPreviewSource(parsedContinuedHorizontalArrows), continuedHorizontalArrows);
assert.equal(parsedContinuedHorizontalArrows.at(-1)?.kind, "branch");
assert.equal(parsedContinuedHorizontalArrows.at(-1)?.prefix, "  │              ");
assert.equal(parsedContinuedHorizontalArrows.at(-1)?.label, "儲存帳號、口袋名單與旅程");

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

const commentedFileTree = [
  "sample-app/",
  "├── app/",
  "│   └── Http/Controllers/HealthController.php # 系統健康度端點 (供 CD 檢驗)",
  "├── database/",
  "│   └── migrations/                          # 資料庫遷移腳本",
  "├── routes/",
  "│   ├── api.php                              # API 路由",
  "│   └── web.php                              # Web 首頁路由",
  "├── composer.json                            # 依賴套件設定檔",
  "├── phpunit.xml                              # SQLite In-memory 測試環境配置",
  "└── scripts/",
  "    ├── deploy.sh                            # Linux 伺服器端原子化軟連結部署腳本",
  "    └── rollback.sh                          # 緊急秒級回滾腳本",
].join("\n");
assert.equal(parseTextDiagramPreview("text", commentedFileTree), null);
assert.equal(parseTextDiagramPreview("text", commentedFileTree.replace(/\n/g, "\r\n")), null);
assert.equal(isCommentedFileTreeCodeBlock("text", commentedFileTree), true);
assert.equal(isCommentedFileTreeCodeBlock("typescript", commentedFileTree), false);

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(editor, /CodeMirrorDecoration\.line\(\{ attributes \}\)/);
assert.match(editor, /CodeMirrorDecoration\.mark\(\{ class: "text-diagram-label" \}\)/);
assert.match(editor, /previousLine\?\.kind === "node" \|\| previousLine\?\.kind === "branch"/);
assert.match(editor, /classes\.push\("has-box-before"\)/);
assert.match(editor, /codeMirrorTextDiagramPreview/);
assert.match(editor, /classList\.toggle\(\s*"is-commented-file-tree"/);
assert.match(editor, /classList\.remove\("is-commented-file-tree"\)/);
assert.match(app, /isCommentedFileTreeCodeBlock\(block\.language, block\.text\)/);
assert.match(editor, /classHighlighter as codeMirrorClassHighlighter/);
assert.match(editor, /codeMirrorSyntaxHighlighting\(codeMirrorClassHighlighter\)/);
assert.match(editor, /\.\.\.previousConfig,\s*languages: codeMirrorLanguages,\s*extensions:/);
assert.doesNotMatch(editor, /--text-diagram-label-offset/);
assert.match(styles, /--scholium-monospace-font:\s*"SFMono-Regular"/);
assert.match(styles, /\.milkdown-code-block\.is-text-diagram \{/);
assert.match(styles, /\.milkdown-code-block\.is-commented-file-tree\s+\.cm-scroller \{[\s\S]*?font-family:\s*var\(--scholium-monospace-font\);/);
assert.match(styles, /\.markdown-preview pre\.is-commented-file-tree code \{[\s\S]*?font-family:\s*var\(--scholium-monospace-font\);/);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.milkdown-code-block\.is-commented-file-tree[\s\S]*?white-space: pre;/);
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
assert.match(
  styles,
  /\.milkdown-code-block\.is-text-diagram\s+\.cm-content \{\s*line-height: 1\.45;/,
);
const textDiagramLineStyles = styles.match(
  /\.cm-line\.text-diagram-line \{([^}]*)\}/s,
)?.[1];
const textDiagramNodeStyles = styles.match(
  /\.cm-line\.text-diagram-line\.is-node\s+\.text-diagram-label \{([^}]*)\}/s,
)?.[1];
const textDiagramBranchStyles = styles.match(
  /\.cm-line\.text-diagram-line\.is-branch\s+\.text-diagram-label \{([^}]*)\}/s,
)?.[1];
const textDiagramConnectorStyles = styles.match(
  /\.cm-line\.text-diagram-line\.is-connector \{([^}]*)\}/s,
)?.[1];
assert.ok(textDiagramLineStyles);
assert.ok(textDiagramNodeStyles);
assert.ok(textDiagramBranchStyles);
assert.ok(textDiagramConnectorStyles);
assert.doesNotMatch(textDiagramLineStyles, /^\s*(?:min-height|line-height|margin|border):/m);
assert.match(textDiagramNodeStyles, /padding: 8px 22px;/);
assert.doesNotMatch(textDiagramNodeStyles, /^\s*(?:margin|line-height):/m);
assert.match(textDiagramBranchStyles, /padding: 4px 18px;/);
assert.doesNotMatch(textDiagramBranchStyles, /^\s*(?:margin|line-height):/m);
assert.match(styles, /\.cm-line\.text-diagram-line\s+\.text-diagram-label \{[\s\S]*?margin: 1px 0;/);
assert.match(styles, /\.cm-line\.text-diagram-line\.has-box-before\s+\.text-diagram-label \{[\s\S]*?margin-top: 7px;/);
assert.doesNotMatch(textDiagramConnectorStyles, /^\s*line-height:/m);
assert.doesNotMatch(styles, /\.cm-line\.text-diagram-line\.is-blank \{/);
assert.doesNotMatch(styles, /\.cm-line\.text-diagram-line\.is-(?:node|branch)::before/);
assert.match(styles, /\.cm-line\.text-diagram-line\.is-depth-2\s+\.text-diagram-label/);
assert.match(styles, /\.tok-keyword/);
assert.match(styles, /\.tok-string/);
assert.match(styles, /\.tok-number/);

console.log("text diagram preview regression: PASS");
