# Scholium

Scholium 是一個 macOS Markdown 閱讀與寫作 app。它用 Tauri 2、React、TypeScript 與 CodeMirror 建成，重點是讓使用者在閱讀或編輯 Markdown 時，能把筆記直接綁在選取的文字範圍上。

Scholium 目前是 local-first desktop app：Markdown 內容存回原始 `.md` 檔，選取文字筆記存成同資料夾的 sidecar JSON 檔。

## 目前功能

- 開啟單一 Markdown 檔案，支援 `.md`、`.markdown`、`.mdown`
- 開啟資料夾並在左側 workspace 瀏覽目前層級的 Markdown 檔與子資料夾
- Preview mode 顯示 Markdown 內容，支援 heading、paragraph、blockquote、list、code block、horizontal rule，以及基本 inline Markdown
- Edit mode 使用 CodeMirror 編輯原始 Markdown
- 在 preview 中可直接編輯單一 Markdown block，離開焦點時寫回 Markdown 內容
- 選取完整句子或段落後建立 selection note
- 點選標記文字可查看 note，note 內容可編輯或刪除
- 內容與 notes 變更後自動儲存，預設 debounce 為 1 秒
- 記住上次開啟的 Markdown 檔案，重新啟動 app 時會嘗試還原

## 資料儲存

Scholium 不會把筆記寫進 Markdown 內文。每個 Markdown 檔案會有一個相鄰的 sidecar notes file：

```text
article.md
article.md.notes.json
```

Sidecar JSON 目前使用 `version: 1`，大致格式如下：

```json
{
  "version": 1,
  "markdownPath": "/path/to/article.md",
  "notes": [
    {
      "id": "note-...",
      "documentId": "/path/to/article.md",
      "status": "active",
      "selectedText": "selected passage",
      "anchor": {
        "from": 42,
        "to": 58,
        "selectedText": "selected passage",
        "prefix": "...",
        "suffix": "..."
      },
      "body": "note body",
      "createdAt": "2026-06-09T00:00:00.000Z",
      "updatedAt": "Today",
      "deletedAt": null
    }
  ]
}
```

刪除的 notes 會從下一次儲存後的 sidecar file 中排除。

## 操作方式

macOS app menu 提供：

- `File > 新增檔案`：`Cmd+N`
- `File > 開啟檔案`：`Cmd+O`
- `File > 開啟目錄`：`Cmd+Shift+O`

鍵盤操作：

- `Cmd+/`：切換 Preview mode 與 Edit mode
- `Escape`：關閉目前的 note panel
- Note editor 內按 `Enter`：回到閱覽狀態
- Note editor 內按 `Shift+Enter`：換行

檔案開啟與儲存功能需要 Tauri macOS runtime。單獨跑 Vite web server 時可以檢視前端，但 native open/save 不會運作。

## 技術棧

- Tauri 2
- React 19
- TypeScript
- Vite 7
- CodeMirror 6
- Rust 2021
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-opener`

## 開發環境

需要安裝：

- macOS
- Xcode Command Line Tools
- Node.js 22
- npm
- Rust stable toolchain，建議透過 `rustup`

這台開發機目前使用 Homebrew `node@22` 與 Homebrew `rustup`。如果你的 shell 找不到 `node`、`npm`、`cargo` 或 `tauri`，先加上：

```bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
```

安裝 dependencies：

```bash
npm install
```

啟動 macOS app 開發模式：

```bash
npm run tauri dev
```

只啟動 Vite frontend dev server：

```bash
npm run dev
```

Vite dev server 固定使用 `http://localhost:1420`，若 port 被佔用會直接失敗。

## Scripts

```bash
npm run dev
```

啟動 Vite frontend dev server。

```bash
npm run build
```

執行 TypeScript compile，並用 Vite 建出 frontend bundle。

```bash
npm run preview
```

預覽 production frontend bundle。

```bash
npm run tauri dev
```

啟動 Tauri desktop app 的開發模式。

```bash
npm run tauri build
```

建置 macOS app 與 installer。常見輸出位置：

- `src-tauri/target/release/bundle/macos/Scholium.app`
- `src-tauri/target/release/bundle/dmg/Scholium_0.1.0_aarch64.dmg`

實際檔名會依 version、architecture 與 Tauri bundle target 而定。

## 專案結構

```text
src/
  App.tsx              # 主要 React app、workspace、preview、notes 與 autosave
  MarkdownEditor.tsx   # CodeMirror editor 與 annotation rendering
  App.css              # App layout 與 interaction styles
src-tauri/
  src/lib.rs           # Tauri commands、file IO、menu events
  tauri.conf.json      # Tauri app、dev server 與 bundle 設定
  capabilities/        # Tauri permissions
package.json           # frontend 與 Tauri CLI scripts
```

## 驗證

README 或文件類變更至少確認：

```bash
npm run build
```

若修改 Tauri file IO、menu 或 native integration，另外執行：

```bash
npm run tauri dev
```
