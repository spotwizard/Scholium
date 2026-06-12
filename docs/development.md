# Scholium 開發說明

這份文件給需要在本機修改、執行或驗證 Scholium 的開發者使用。一般功能介紹與操作方式請看 [README.md](../README.md)。

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

這台開發機目前使用 Homebrew `node@22` 與 Homebrew `rustup`。如果 shell 找不到 `node`、`npm`、`cargo` 或 `tauri`，先加上：

```bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
```

安裝 dependencies：

```bash
npm install
```

## 執行 app

啟動 macOS app 開發模式：

```bash
npm run tauri dev
```

只啟動 Vite frontend dev server：

```bash
npm run dev
```

Vite dev server 固定使用 `http://localhost:1420`，若 port 被佔用會直接失敗。

檔案開啟與儲存功能需要 Tauri macOS runtime。單獨跑 Vite web server 時可以檢視前端，但 native open/save 不會運作。

## Scripts

```bash
npm run dev
```

啟動 Vite frontend dev server。

```bash
npm run build
```

執行 TypeScript compile，並用 Vite 建立 frontend bundle。

```bash
npm run preview
```

預覽 production frontend bundle。

```bash
npm run install:app
```

建立 Tauri macOS app、替換 `/Applications/Scholium.app`、重新簽章、refresh LaunchServices，並重新啟動安裝版 app。這個指令包裝 repo root 的 `scripts/install-app.sh`。

```bash
npm run tauri dev
```

啟動 Tauri desktop app 的開發模式。

```bash
npm run tauri build
```

建立 macOS app 與 installer。常見輸出位置：

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

## 資料格式

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

## 驗證

README 或文件類變更至少確認：

```bash
npm run build
```

若修改 Tauri file IO、menu 或 native integration，另外執行：

```bash
npm run tauri dev
```
