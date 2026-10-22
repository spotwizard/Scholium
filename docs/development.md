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
npm ci
```

`npm ci` 會依 `package-lock.json` 安裝完全一致的版本，適合乾淨 checkout 與 CI；只有在刻意調整 dependencies 並更新 lockfile 時才使用 `npm install`。

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
npm run typecheck
```

檢查 App、`vite.config.ts` 與測試程式的 TypeScript 型別，不產生輸出檔；Vite config 由 `tsconfig.node.json` 單獨檢查。

```bash
npm test
```

用 Node.js 22 內建 test runner 執行全部 `tests/*.test.ts`。

```bash
npm run check
```

依序執行 TypeScript 型別檢查、前端測試、Rust 格式與 `clippy`、Rust 測試及 production frontend Build。這是本機與 GitHub Actions CI 共用的完整品質入口。

```bash
npm run preview
```

預覽 production frontend bundle。

```bash
npm run install:app
```

建立 Tauri macOS app、替換 `/Applications/Scholium.app`、驗證簽章、refresh LaunchServices，並重新啟動安裝版 app。這個指令包裝 repo root 的 `scripts/install-app.sh`；有效的 Build 簽章會被保留，只有不完整或無效的本機 Build 才會 fallback 到 ad-hoc signature。

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
  App.tsx                       # 主要 React app 與各領域模組的整合／UI orchestration
  MarkdownEditor.tsx            # CodeMirror editor 與 annotation rendering
  MilkdownMarkdownEditor.tsx    # Milkdown editor 與 ProseMirror plugins
  tauriGateway.ts               # 前端唯一的 typed Tauri IPC 邊界
  editorTypes.ts                # editor 與 annotation 共用型別
  documentTypes.ts              # notes 與 glossary 共用型別
  workspacePaths.ts             # Workspace path 與共用 Markdown extension／filename helpers
  workspaceEntries.ts           # workspace tree、Dropbox picker、search 與文件 mapping
  workspaceStorage.ts           # primary／secondary workspace storage keys 與首次 seed
  documentTabs.ts               # tab session／available／add-replace／close／click selection 純 transition
  draftDocuments.ts             # Draft ID／source／content 純判斷
  annotationAnchor.ts           # Unicode／context-aware annotation anchor 純邏輯
  loadedFileProjection.ts       # loaded document／note／glossary projection 與 sidecar hydration
  markdownPreview.ts            # 手寫 Markdown preview block／list parser
  milkdownSerialization.ts      # Milkdown lists、links、hard breaks 序列化正規化
  markdownInlineTextMap.ts      # Markdown inline 文字與 source offset 對照
  autosave.ts                   # dirty-state、snapshot reconciliation 與 autosave coordinator
  localRecoveryError.ts         # local recovery backend error 的穩定 i18n mapping
  pdfExport.ts                  # 僅在匯出 PDF 時載入的轉換邏輯
  fileLinkInsertion.ts          # 插入檔案連結的 href 編碼、`@` 觸發與篩選純邏輯
  App.css                       # 其餘 App layout 與 interaction styles
  SettingsView.css              # Settings 畫面樣式
src-tauri/
  src/lib.rs                    # Tauri commands 與尚未拆分的 file／Dropbox／menu 整合
  src/atomic_file.rs            # app-private 原子取代與共用 no-follow／identity-safe readers
  src/editor_context_menu.rs    # macOS WKWebView 右鍵選單加入「插入檔案…」
  src/dropbox_token_state.rs    # Dropbox token 連線代數與競態保護
  src/frontmatter_tags.rs       # Frontmatter tag parse／normalize 純邏輯
  src/local_save_recovery.rs    # Local 文件／notes／sidecar redo manifest 與 replay
  src/local_image.rs            # Local image path／MIME／size／data URL trust boundary
  src/markdown_path.rs          # Local／Dropbox 共用 Markdown path／name admission policy
  src/pdf_export.rs             # PDF path validation／writing 與 direct test
  tauri.conf.json               # Tauri app、CSP、dev server 與 bundle 設定
  capabilities/                 # Tauri permissions 白名單
.github/workflows/ci.yml        # push／PR 共用品質檢查；第三方 Actions 固定完整 commit SHA
package.json                    # frontend、Rust 與 Tauri CLI scripts
```

## 資料格式

Scholium 不會把筆記寫進 Markdown 內文。主要 notes store 位於 app data 目錄，以 Markdown path 的 hash 命名；這些 app-private JSON 用 same-directory temporary file、`sync_all` 及 rename 原子取代，避免暴露半份 JSON。

為了舊版相容與本機 Dropbox File Provider 鏡像，系統仍可讀取或維護與 Markdown 相鄰的 legacy sidecar：

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

`tests/fixtures/notes-v1-legacy.json` 固定舊版仍有效、但缺少 `glossaryTerms` 與 `glossaryBindings` 的 Notes v1。Rust 直接驗證缺少欄位時會安全補成空陣列、重新序列化會輸出目前 schema，且 missing／stale sidecar repair 使用同一份 fixture；production schema 與 command 沒有改變。最新完整 gate 為 55／55 Node tests、88／88 Rust tests、typecheck、rustfmt、clippy `-D warnings` 與 Vite production Build 全部通過。

刪除的 notes 會從下一次儲存後的 sidecar file 中排除。

建立 Markdown 檔案副本時，必須同步建立 sidecar notes 副本；副本中的 `note.id`、`glossaryTerms[].id`、`glossaryBindings[].id` 都必須重新產生，且 `glossaryBindings[].termId` 必須改指向副本內的新 glossary term id。不得讓正本與副本共用任何筆記或名詞 id，否則前端依 id 編輯筆記時會互相污染。

### Autosave concurrency 的目前界線

Autosave coordinator 的 queue 只保存 document id。每個排隊中的 target 真正開始儲存時，App 才從 `documentsRef` 取得最新 document，重新確認它仍為 dirty 且仍有 backing file，再於第一次非同步等待前 snapshot 本文與 sidecar 資料。這避免文件 A 儲存期間文件 B 又被編輯時，B 隨後仍寫入排隊當下的舊 body；two-target deferred case 保留於既有 `autosave.test.ts`。目前共有 48 個 TypeScript `.test.ts` files，最新 Node.js 22 run 為 55／55 PASS。

### Loaded-file projection 與 frontmatter parity

Local／Dropbox directory／file 載入現在共用 72 行的 `loadedFileProjection.ts` semantic module；note 與 glossary binding 的 sidecar hydration 也共用 anchor recovery 與 document-id rebinding，避免不同開啟、重載與 session restore 路徑各自維護相同轉換。Dropbox 仍保留既有 document id 與 rev 語意。`tests/loadedFileProjection.test.ts` 直接 import 並呼叫 semantic functions，不再以讀取 `App.tsx` source shape 代替行為；這些純邏輯測試仍不能取代安裝版 GUI 操作。

Frontmatter tags 的 TypeScript 與 200 行 Rust parser 現在共用 `tests/fixtures/frontmatter-tags.json`，固定 inline／block tags、legacy `tags :`、CRLF、quoted commas、column-0／indented YAML comment、case-insensitive deduplication、missing tags 與 unclosed frontmatter 的 parity。前端另直接驗證寫入時會把 legacy `tags :` 正規化成 `tags:`，同時保留其他 frontmatter 欄位與 Markdown body；CRLF frontmatter 的 body offset 依 original source newline 長度計算，避免 anchor 映射回原文時偏移。

Rust `lib.rs` 本輪另把測試用暫存目錄命名集中到 `test_directory`、用單一 menu-item closure 建立重複的 enabled menu items，並以 `validate_existing_markdown_file` 共用 open／duplicate／delete／rename 對既有 Markdown 檔案的檢查；latest-tree review 後再移除兩個 delegate-only aliases。這些是內部精簡；各 command 原本的「不是檔案」錯誤 context、Markdown extension 限制、Tauri command 名稱與 IPC payload 均保持不變。

### Workspace storage

四個既有 workspace／session storage keys 與 `currentWindowWorkspaceStorage` 現在位於 38 行的 `workspaceStorage.ts`。Primary window 直接使用既有 local storage，不碰 session storage；secondary window 第一次使用時才把四個 key 從 primary 複製到 session storage，來源缺少的 key 會移除 secondary 舊值。只有全部 copy／remove 成功才寫 seeded marker；任一 storage 操作失敗都不標記完成，所以下次仍可 retry。

`tests/workspaceStorage.test.ts` 直接覆蓋 primary、secondary first copy、missing remove、seed once 與 failure/retry 五組案例。`documentTabs.test.ts` 已移除對 helper 實作形狀的 regex，但保留 App 必須呼叫共用 helper 的 architecture contract。這些測試固定 storage 語意與 wiring；真實雙視窗 session 隔離仍需在安裝版 runtime 直接驗證。

### Document tab transitions 與 Markdown extension stripping

225 行的 `documentTabs.ts` 以 strict parity 提供 available-tab、add／replace、close、close-others 與既有 `documentTabClickSelection` 純 transition。Draft 載入涉及的 async、event 與 selection side effects 仍留在 `App.tsx`，避免把外部副作用包進看似純粹的 helper。既有 click 四案例分別固定 pointer 已完成 activation、pointer 尚未 activation、keyboard／assistive click，以及 non-pointer click 遇到 stale pointer id；tab 入口、click 次數與最後選取目的均不變。真實雙視窗與完整 GUI lifecycle 仍須直接驗證。

131 行的 `workspacePaths.ts` 現在集中 Markdown extension 與 filename helpers。App 的 workspace title／duplicate filename 與 PDF filename 共用單一 `fileNameFromPath`；App 保留不 trim path、PDF caller 保留先 trim 的既有差異。POSIX、Windows、mixed separator、trailing separator、whitespace、empty 與 `null` 都有直接測試；這不擴大可接受的檔案類型，也不改 PDF 或 workspace 的命名語意。

### Legacy MarkdownPreview 的目前界線

手寫 `MarkdownPreview` 已確認只有 `NoteMarkdownEditor` 一個 production caller。固定為 true 的 input commit／Tab indent／selected-text Enter 分支、不可達的 legacy annotation rendering 與 dead preview redo state 已移除；read-only Tab、Tab／Shift+Tab、paste／list、IME、undo、focus／blur 與 empty transient 行為仍由既有路徑保留。主 Milkdown annotation layer 未納入這次精簡。第 7 批最新 55／55 Node tests 與 Vite production Build 已通過；macOS optional-card fallback 後仍沒有可判讀的 direct visual screenshot，不能由內部或 Accessibility proxy 取代。

### 浮動筆記初次定位與 runtime 現況

浮動筆記 panel 的初次位置會在 `useLayoutEffect` 內同步計算。既有 `requestAnimationFrame` 更新仍保留，用於 anchor 尚未可量測時的 retry，以及 resize／scroll 後重新定位；另加入 optional-card fallback。這些修正不改變圈選、Enter 建立筆記、按鈕或資料語意。

2026-08-18 07:17:26–07:18:26 以既有安裝版與現有 `AGENTS.md` 成功建立 transient note；Accessibility tree 出現筆記面板 container、copy／expand／close／delete controls 與空白 editor，證明建立路徑成立。macOS 原生 `screencapture` 成功產生 `/private/tmp/scholium_floating_panel_final.png`（3456×2234，SHA-256 `b9736742cdd03325cb02bcefac1a240ee05e2276fc35e42b6475354610aa4bdf`），但影像中的 Scholium 整個 WebView body（包含原本文字）皆為白色，無法判斷 panel／connector 的肉眼可見狀態，因此仍不得宣稱 direct PASS。截止前已關閉 transient note、關閉 note mode，還原 `robbie-dev`／`AGENTS.md`，沒有保留或寫入筆記。

本輪「重做」第一次執行 `./scripts/install-app.sh` 時，`com.spotwizard.scholium` 位於前景，腳本 exit 2 並依工作階段保護機制安全跳過替換；這是歷史過程。PID 6935、11217、13656、18966、25448 與 26801 均保留為前六批歷史。第 7 批 installer 已移除任何同名 process fallback 與 `|| true`；只有精確 `/Applications/Scholium.app/Contents/MacOS/scholium` 存在才會成功，驗證當時 PID 為 34947。PID 只作歷史 launch evidence，不宣稱永久存活。

iOS 06:51:43 的早期 launch PASS 保留為歷史。最新 draft-logic follow-up IPA 6,503,784 bytes，SHA-256 `b254e25a185cc6240c6fc323b4bb61bd3bfb2f6c61bc4bcfc5ae5e5cf5f52586`；CoreDevice install success，version／build `0.1.0`，路徑 `file:///private/var/containers/Bundle/Application/220AF9E1-8C4F-45F1-A75F-4DF22B0D4471/Scholium.app/`。本項未 launch App 或操作手機畫面。

### Local 儲存 recovery 的目前界線

一般 local regular-path Markdown 儲存會先在 app-private 目錄建立 redo manifest，記錄本文、app-private notes 與需要維護的 local sidecar 在寫入前後的完整 snapshot 與 hash。App 中斷後重新開啟或執行 rename／duplicate／delete 前，Scholium 只會重播能證明仍處於 `Before` 的檔案；已是 `After` 的檔案會跳過，任何不符合兩者的 `Unknown` 狀態會阻擋操作，不會猜測性覆寫。Recovery conflict／invalid manifest 目前會映射成繁體中文、英文與簡體中文的穩定錯誤；conflict 明確說明 App 尚不能自動解除，invalid manifest 明確說明重新開啟不會自動修復。Process mutex 與 OS advisory lock 會協調同一台機器上的合作程序；獨立 child-process test 已直接驗證這個 lock。Recovery 目錄、lock 與 manifest 另有 durability 及 0700／0600 權限保護。

Final file／directory symlink delete 只移除 link，不刪除 target document 或其 private notes；dangling final symlink 也會沿 referent 建立 canonical document identity，既有 dangling link 會被視為 target collision，不會被當成空路徑覆寫，symlink cycle 則以穩定錯誤中止。Relative／`..` path 會正規化到同一 notes identity。當 private notes 邏輯上為空時會保留 tombstone 並移除 legacy sidecar，避免之後重新開啟時把舊 sidecar 復活。Symlink alias 進入 legacy mutation 前，也會先以 canonical document identity 恢復或阻擋既有 regular-path pending manifest。

Legacy 與 journal sidecar snapshot／writers 都不跟隨 symlink。Manifest 的 `before` snapshot 不會讀取 link referent，但會用 non-content empty sentinel 記錄 link entry 存在，避免把它誤當成檔案不存在；因此 after 為空時仍會 unlink link，且不碰 referent。Existing／dangling link 會被安全替換或移除，regular sidecar 仍採 in-place 更新以保留 inode，讀寫前後則比對已開啟 file descriptor 與目前 path 的 identity，遇到 path swap 會停止。Exact pending alias、sidecar helper、journal integration 與 journal empty-sidecar 各有直接 test。

Dropbox token、recent locations、private／legacy notes 與 recovery manifest 現在共用 `atomic_file.rs` 的 safe reader：Unix 會在 open-time 使用 no-follow／non-blocking flags，確認 opened object 為 regular file，比對開啟前後的 device／inode identity；private file 另拒絕 hardlink，並只在 mode 不是 0600 時收斂權限。這避免讀取或 chmod 到 final symlink referent，也避免 hardlink alias 讓另一個名稱共享的 inode 被改權限。Recovery／notes directory 以 0700 建立，app-controlled suffix 的 intermediate symlink 會被拒絕；store lock 同樣使用 no-follow、fd identity、hardlink 與 mode guards。

非空 tag-only search 會在整段 Markdown frontmatter 掃描期間取得同一 store guard，避免與 Scholium 的合作式 mutation 交錯；filename-only search 不讀本文內容，因此不持有這把 lock。這是同一 App／合作程序間的一致性機制，不是抵抗同一 UID 惡意程序刻意抓準時序 retarget 的完整 security boundary。

這仍是 `PARTIAL`，不能當成所有儲存來源都已具 transaction：

- 含 symlink 的實際 save／rename／duplicate mutation 仍走 legacy path，沒有自己的 crash journal；canonical pending gate 只處理既有 regular-path manifest。
- `Unknown` 只有安全阻擋，尚無讓使用者選擇版本的 resolve UI／API。
- Dropbox remote body／notes 沒有納入同一份 transaction manifest。
- Rename／delete 等 lifecycle mutation 本身不是 transaction；關閉 App、切換 workspace 與多視窗 lifecycle 也尚未與 autosave／recovery 形成單一 transaction。
- 不合作的外部 editor 仍可能在最後狀態檢查與 in-place truncate 間寫入，形成狹窄的 TOCTOU（檢查時間與使用時間之間競態）窗口。
- 現有 advisory lock 與 file identity checks 不保證抵抗同一 UID 惡意程序刻意抓準時序 retarget；這不是合作式桌面 App consistency contract 的完成條件，但仍是明確 security residual。

### PDF output path 安全

Automatic PDF output 的 unique-path 選擇會把 dangling symlink 視為已占用，directory autosave 並以 `create_new` 排他建立檔案，避免在檢查後被另一個程序搶先建立或寫穿 link；使用者在 save dialog 明確指定既有檔案時，原本的 overwrite 語意保持不變。

Rust 的 PDF path validation／writing 與 direct test 已搬至 185 行 `pdf_export.rs`，`lib.rs` 從上一批 5,987 降至 5,817 行。這是 module boundary 搬移：39 個 unique Tauri commands、request／response schema 與既有 error 文字均保持不變。

### Local image trust boundary

257 行的 `local_image.rs` 集中 local-image command 的 path decode、query／fragment 拒絕、MIME 判定、64 MiB 上限、data URL 組裝與四組直接測試。114 行的 `markdown_path.rs` 集中 local／Dropbox 共用 Markdown extension、path-name、existing-file 與 drop admission；drag-and-drop 的 `.md`-only 規則仍與一般 `md`／`markdown`／`mdown` 規則分離。`lib.rs` current line count 為 5,739。Source 與直接測試通過不等於 GUI 圖片 rendering 已直接驗收。

### Dropbox OAuth 多視窗 ownership

Dropbox OAuth sessions 現以 CSRF `state` 分別保存，並記錄發起的 Tauri window label。Desktop loopback callback 與 mobile deep link callback 都只會在 state 精確匹配時定向送到 owner；wrong／missing state 不會消耗其他 session，error 只清除自己的 state，completion 也再次驗證 owner。Mobile multi-scene 可各自保存 session；desktop 仍受固定 loopback port 限制，同時第二個 listener 會在 bind 階段明確失敗，但不覆寫第一筆 session。Frontend 已移除 app-wide connected event 的 Promise race，只等待 owner 發出的 completion command response。

## macOS code signing 與 Keychain

`scripts/install-app.sh` 最新 draft-logic run exit 0；Tauri release Build／bundle／覆蓋安裝與 codesign strict PASS，bundle id／version不變，exact-path gate 於驗證當時輸出 PID 48649 與 `/Applications/Scholium.app/Contents/MacOS/scholium`。PID 只作歷史 launch evidence。

最新安裝版實際仍是 ad-hoc signature，TeamIdentifier 未設定且沒有 entitlements；沒有穩定 Team ID、provisioning profile 或 Keychain access group，不可用來驗收長期 credential migration。

要把 Dropbox token 移入 data-protection Keychain 前，必須先將 macOS App 改為穩定的 Apple Development 或 Developer ID 簽署，確認實際 App entitlements 含有受 provisioning profile 授權的 application identifier，並驗證連續兩個 Build 的 designated requirement 不變。在這些前提未成立時，不得為了移除明文 token 而退回使用會綁定當次 ad-hoc binary、可能彈出授權對話框的舊式 file-based Keychain。

因此目前 `SEC-001` 的狀態是 `BLOCKED`，不是尚未分析：既定設計是 data-protection Keychain、service `com.spotwizard.scholium`、account `dropbox.oauth.tokens.v1`、整份 token JSON、non-synced，並採 secure-first migration（Keychain 寫入成功後才刪除 legacy file）。解除 blocker 前，Dropbox token 雖已有 atomic replace、0600 mode、open-time no-follow、fd identity 與 hardlink rejection，仍是明文 JSON；這些 file hardening 不能取代 credential migration。

## 筆記互動回歸保護

修改筆記模式、圈選段落、Markdown code block、Milkdown 或 CodeMirror 互動前，必須先制定開發/修改方案，並用方案推演相關既有功能是否會受損。若方案會破壞既有功能，必須先改方案，不得只針對單一現象硬改。

筆記模式必須保留各輸入裝置適用的圈選互動：

- 電腦版使用瀏覽器原生反白文字選取，選取後按 Enter 建立筆記；不得攔截 `selectstart` 或滑鼠拖曳來改畫矩形。單純點擊或沒有實際選到文字時不得建立筆記。
- 行動版不依賴原生反白選字，使用長按 2 秒後拖曳中空矩形建立筆記，避免跳出手機鍵盤。
- 電腦版與行動版必須共用文字 anchor、提交選取與筆記資料流程；行動版另保留段落／code 行命中、拖曳中預覽底色與 committed selection rect 邏輯。
- 行動版單純點擊、按住但未形成有效拖曳，或矩形未實際覆蓋文字時，不得建立筆記；既有筆記標記仍須可以點擊開啟。
- 行動版拖曳中必須同步用底色標示目前會被建立筆記的文字或 code 行，讓使用者清楚知道放開後會圈選哪些內容；底色必須比照電腦版正式圈選效果，跨行時連成一塊，不得呈現逐字或零碎小段底色。
- 行動版拖曳矩形只要已命中該段落的文字，後續應依拖曳矩形掃過的段落垂直範圍選取，不得因拖曳位置偏右而漏掉較短的文字行或段落。
- 行動版拖曳結束並開啟建立筆記視窗後，必須保留最終圈選底色；即使手機鍵盤彈出或使用者已輸入筆記內容，也不得提早清除。底色只能在該次選取取消、空白 transient note 被關閉、筆記刪除，或正式筆記標記以同一位置接手顯示後消失。
- 行動版最終圈選底色必須位於內文上方、浮動筆記視窗與其按鈕下方，不得蓋住筆記視窗、複製按鈕、展開按鈕、關閉按鈕或刪除按鈕。
- 行動版浮動筆記視窗、connector 與聚焦遮罩在手機鍵盤彈出、收起或 visual viewport 改變後，必須使用同一套 visual viewport 座標重新定位並維持在鍵盤上方的可視範圍內；不得因開始編輯筆記而跳到畫面外、嚴重偏離原位、遮罩跑位，或迫使用戶點擊視窗外尋找視窗。
- 行動版拖曳完成建立筆記時，浮動筆記視窗與 connector 的初始定位必須使用該次 committed selection rect；正式 annotation DOM 尚未完成量測前，不得沿用上一筆 floating anchor 或只用 pointerup 位置當主要定位來源。
- 行動版拖曳矩形必須實際覆蓋文字才可建立筆記；只覆蓋段落空白、code block 空白區或行尾空白時，必須視為取消選取，不得開啟建立筆記視窗。
- Code 區塊在電腦版必須可以透過原生文字反白建立筆記。
- Code 區塊在行動版必須可以透過拖曳矩形建立行級筆記。
- 已建立筆記的 code 區塊圈選段落必須可以點擊開啟筆記。
- 圈選標記不得蓋住 code 區塊文字，文字必須保持可讀。
- 修正 code 區塊內圈選或標記點擊問題時，不得用整個 code 區塊的 `pointerdown` / `mousedown` 全區 `preventDefault`；只能攔截已進入矩形拖曳的事件，避免阻斷複製按鈕、既有筆記標記點擊或另一種輸入裝置的拖曳圈選。

## 改善計畫的交付邊界

`docs/AI_IMPROVEMENT_PLAN.md` 是長期 roadmap，不代表每個重構批次都承諾一次完成所有 reducer、components、CSS、performance、安全與發布工作。每批 source 工作必須有自己的 acceptance；批次完成不等於長期 roadmap 完成。

- A／safe local：schema／serialization fixtures、共用純邏輯、tabs／workspace 與 Rust 領域模組化可直接繼續。單一 GUI 驗收未完成不得讓這些項目停工。
- B／product decision：dirty lifecycle、`Unknown` conflict、Dropbox 跨檔部分成功語意，以及是否把長期架構願景納入當前批次，必須先有明確產品或資料語意。
- C／external condition：macOS／iOS 人工互動、remote CI push 與 Apple signing／profile 只阻擋依賴它們的驗收或發布項目。

`QA-004` 也分成兩個狀態：regression contract 已建立完成；manual execution 仍是 `PARTIAL`。iOS launch smoke 不能代表完整行動版互動，source／AX controls／Build 也不能代表 macOS direct visual。

## 驗證

目前程式樹共有 48 個 TypeScript `.test.ts` 檔與 87 個 Rust `#[test]`。最新 gate 為 55／55 Node tests、87／87 Rust tests、App／`vite.config.ts`／tests typecheck、rustfmt、all-features clippy `-D warnings`、Vite production Build 與 `git diff --check` PASS。Markdown path admission parity 與既有 PDF、OAuth、recovery 回歸契約均通過；最新獨立 review P0／P1／P2 = 0。每次後續交付仍須以當次 quality gate 的 exit code為準，不能沿用這次結果。

最新 production Build main `index-BCwQ12aG.js` 為 2,292.68 kB raw／720.13 kB gzip。目前 source lines：`App.tsx` 17,250、`draftDocuments.ts` 25、`SettingsView.tsx` 241、`settings.ts` 269、`lib.rs` 5,739、`markdown_path.rs` 114；其餘主要模組行數不變。

固定 7 批與後續四個獨立 safe-local 項目的 source gate、independent review 與兩平台背景交付已完成：55／55 Node、87／87 Rust、typecheck、rustfmt、clippy、Vite Build、diff check PASS；最新 review P0／P1／P2 = 0。macOS PID 48649、iOS Build／install均通過；本項未做 GUI／iOS launch。Remote CI、Keychain、完整 DATA-002 與人工 matrix 邊界不變。

README 或文件類變更至少確認：

```bash
npm run build
```

若修改 Tauri file IO、menu 或 native integration，另外執行：

```bash
npm run tauri dev
```
