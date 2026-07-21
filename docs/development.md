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

建立 Markdown 檔案副本時，必須同步建立 sidecar notes 副本；副本中的 `note.id`、`glossaryTerms[].id`、`glossaryBindings[].id` 都必須重新產生，且 `glossaryBindings[].termId` 必須改指向副本內的新 glossary term id。不得讓正本與副本共用任何筆記或名詞 id，否則前端依 id 編輯筆記時會互相污染。

## 筆記互動回歸保護

修改筆記模式、圈選段落、Markdown code block、Milkdown 或 CodeMirror 互動前，必須先制定開發/修改方案，並用方案推演相關既有功能是否會受損。若方案會破壞既有功能，必須先改方案，不得只針對單一現象硬改。

筆記模式必須保留跨輸入裝置的矩形圈選互動：

- 電腦版使用滑鼠左鍵按住後拖曳中空細框建立筆記；開始拖曳時立即顯示矩形與命中段落底色，放開後提交選取。筆記模式外仍保留原生文字選取。
- 行動版不依賴原生反白選字，使用長按 2 秒後拖曳中空矩形建立筆記，避免跳出手機鍵盤。
- 電腦版與行動版必須共用段落／code 行命中、拖曳中預覽底色、提交選取與 committed selection rect 邏輯；只允許輸入裝置的啟動方式不同。
- 單純點擊、按住但未形成有效拖曳，或矩形未實際覆蓋文字時，不得建立筆記；既有筆記標記仍須可以點擊開啟。
- 行動版拖曳中必須同步用底色標示目前會被建立筆記的文字或 code 行，讓使用者清楚知道放開後會圈選哪些內容；底色必須比照電腦版正式圈選效果，跨行時連成一塊，不得呈現逐字或零碎小段底色。
- 行動版拖曳矩形只要已命中該段落的文字，後續應依拖曳矩形掃過的段落垂直範圍選取，不得因拖曳位置偏右而漏掉較短的文字行或段落。
- 行動版拖曳結束並開啟建立筆記視窗後，必須保留最終圈選底色；即使手機鍵盤彈出或使用者已輸入筆記內容，也不得提早清除。底色只能在該次選取取消、空白 transient note 被關閉、筆記刪除，或正式筆記標記以同一位置接手顯示後消失。
- 行動版最終圈選底色必須位於內文上方、浮動筆記視窗與其按鈕下方，不得蓋住筆記視窗、複製按鈕、展開按鈕、關閉按鈕或刪除按鈕。
- 行動版浮動筆記視窗、connector 與聚焦遮罩在手機鍵盤彈出、收起或 visual viewport 改變後，必須使用同一套 visual viewport 座標重新定位並維持在鍵盤上方的可視範圍內；不得因開始編輯筆記而跳到畫面外、嚴重偏離原位、遮罩跑位，或迫使用戶點擊視窗外尋找視窗。
- 行動版拖曳完成建立筆記時，浮動筆記視窗與 connector 的初始定位必須使用該次 committed selection rect；正式 annotation DOM 尚未完成量測前，不得沿用上一筆 floating anchor 或只用 pointerup 位置當主要定位來源。
- 行動版拖曳矩形必須實際覆蓋文字才可建立筆記；只覆蓋段落空白、code block 空白區或行尾空白時，必須視為取消選取，不得開啟建立筆記視窗。
- Code 區塊在電腦版必須可以透過滑鼠矩形建立行級筆記。
- Code 區塊在行動版必須可以透過拖曳矩形建立行級筆記。
- 已建立筆記的 code 區塊圈選段落必須可以點擊開啟筆記。
- 圈選標記不得蓋住 code 區塊文字，文字必須保持可讀。
- 修正 code 區塊內圈選或標記點擊問題時，不得用整個 code 區塊的 `pointerdown` / `mousedown` 全區 `preventDefault`；只能攔截已進入矩形拖曳的事件，避免阻斷複製按鈕、既有筆記標記點擊或另一種輸入裝置的拖曳圈選。

## 驗證

README 或文件類變更至少確認：

```bash
npm run build
```

若修改 Tauri file IO、menu 或 native integration，另外執行：

```bash
npm run tauri dev
```
