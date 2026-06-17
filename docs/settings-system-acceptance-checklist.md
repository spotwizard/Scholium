# Scholium Settings System Acceptance Checklist

本檔是 `docs/settings-system-plan.md` 的執行檢核表。任何根據該 plan 的實作，必須先更新本檔，再開始改 code。

## 執行規則

- 不得只依口頭摘要實作；必須逐項對照 `settings-system-plan.md`。
- 開始改 code 前，每一項都要標明本次狀態：`本次實作`、`本次不做`、`需前置設計`。
- 若要把 `本次實作` 改成 `本次不做` 或 `需前置設計`，必須先在回覆中明確告知，不得默默縮小 scope。
- 完成回報必須逐項對照本檔，不得只列「我做了什麼」。
- 沒有接上實際 runtime 行為的設定，不得放進設定 UI。

## 來源解讀

`settings-system-plan.md` 同時包含兩層內容：

- 設定系統的長期分類：App、Editor、Project / Library、AI / API、Privacy / Advanced。
- 第一版實作範圍：只放已經接上實際 runtime 的設定。

因此，長期分類裡列出的項目不能直接當成第一版已承諾完成；但若本次不做，必須在本檔明確標出原因。

## Architecture Checklist

| 項目 | 狀態 | 完成條件 |
| --- | --- | --- |
| macOS menu entry | 本次實作 | `Scholium > 設定...` 存在，並送出 settings open event。 |
| Settings schema / registry | 本次實作 | 所有已實作設定都從集中式 definitions 宣告 type、default value、validation、category、runtime metadata。 |
| Settings store API | 本次實作 | 提供 `readSetting`、`writeSetting`、`resetSetting`、`resetSettings`、`readSettingsSnapshot`。 |
| Persistence wrapper | 本次實作 | UI 不直接呼叫 raw `localStorage` key；一般偏好可由 store 包裝 `localStorage`。 |
| i18n dictionary | 本次實作 | app UI、settings UI、主要狀態訊息與 native menu label 有統一翻譯來源，支援 English / 繁體中文 / 簡體中文。 |
| Runtime application boundary | 本次實作 | `App.tsx` 只讀取已驗證 setting value，並套用到 runtime state。 |
| No placeholder settings | 本次實作 | 沒有接上 runtime 行為的項目不得出現在 UI。 |

## UI Checklist

| 項目 | 狀態 | 完成條件 |
| --- | --- | --- |
| Preferences dialog | 本次實作 | 設定以 app-level preferences dialog 呈現，背景 app 降低干擾。 |
| Close affordance | 本次實作 | 設定為即時套用偏好，不使用「完成」作為唯一退出語意；提供明確關閉按鈕。 |
| Outside click dismissal | 本次實作 | 點擊 settings dialog 外部 backdrop 會關閉設定；dialog 內部互動不關閉。 |
| No active file browser in settings | 本次實作 | 設定開啟時，不保留可操作的檔案目錄。 |
| Category navigation | 本次實作 | 左側只做分類導覽，不顯示設定項目數量。 |
| Definition-driven controls | 本次實作 | 右側 controls 由 settings definitions render。 |
| Boolean control | 本次實作 | boolean 使用 switch 或 checkbox。 |
| Select control | 本次實作 | select 使用 segmented control 或 select menu。 |
| Number control | 本次實作 | number 使用 slider 搭配數值輸入，並由 definition 的 min/max/step 驗證。 |
| Reset single setting | 本次實作 | 每個已實作設定提供單項 reset。 |
| Reset all settings | 本次實作 | 全域 reset 只清除 settings store 管理的 key，並同步套用 runtime state。 |
| Restart badge | 本次實作 | `requiresRestart: true` 的設定要標示；若目前沒有此類設定，不能硬放假 badge。 |

## App Settings Checklist

| 設定 | 狀態 | 完成條件或不做原因 |
| --- | --- | --- |
| `app.restoreLastOpenedFile` | 本次實作 | 控制啟動時是否讀取上次開啟的 Markdown path，default 為 `true`。 |
| `app.directoryPaneOpen` | 本次實作 | 控制非全螢幕時目錄面板是否預設展開，default 為 `false`。 |
| 預設 app 顯示語言 | 本次實作 | 建立 i18n dictionary 與文字來源整理，支援 English / 繁體中文 / 簡體中文，並同步主要 UI、settings UI、狀態訊息與 native menu label。 |
| 主題 | 本次實作 | 提供跟隨系統、淺色、深色，並以 app theme tokens 套用 runtime 外觀。 |
| 字體縮放 | 本次實作 | 透過 `app.interfaceFontSize` 調整 app root typography scale。 |

## Editor Settings Checklist

| 設定 | 狀態 | 完成條件或不做原因 |
| --- | --- | --- |
| 預設閱讀 / 編輯模式 | 本次不做 | 這是 editor toolbar / shortcut 的即時工作流，不放進 preferences。 |
| 預設 editor font size | 本次實作 | 透過 editor surface CSS variables 同步套用到 CodeMirror、preview、Milkdown。 |
| 預設行距 | 本次實作 | 透過 editor surface CSS variables 同步套用到 CodeMirror、preview、Milkdown。 |
| Markdown / citation 顯示選項 | 需前置設計 | 需要先定義 preview / citation renderer 行為；不可先放無效選項。 |

## Project / Library Settings Checklist

| 設定 | 狀態 | 完成條件或不做原因 |
| --- | --- | --- |
| 預設開啟資料夾 | 本次不做 | plan 指出目前 project/library persistence 尚未獨立於 native menu recent/favorites。 |
| 預設儲存位置 | 本次不做 | 同上，需先有 project/library persistence 設計。 |
| 匯入 / 匯出偏好 | 本次不做 | 目前沒有對應 runtime workflow，不得放 placeholder。 |
| 最近開啟與常用目錄管理 | 本次不做 | 目前由 native menu recent/favorites 處理，尚未納入 settings system。 |

## AI / API Settings Checklist

| 設定 | 狀態 | 完成條件或不做原因 |
| --- | --- | --- |
| model | 本次不做 | plan 指出目前 app 尚無 AI runtime 行為。 |
| API key | 本次不做 | 需要 secure storage 或 macOS Keychain，不可存在一般 `localStorage`。 |
| context 長度 | 本次不做 | 目前 app 尚無 AI runtime 行為。 |
| 是否啟用特定 AI 功能 | 本次不做 | 目前 app 尚無 AI runtime 行為。 |

## Privacy / Advanced Settings Checklist

| 設定 | 狀態 | 完成條件或不做原因 |
| --- | --- | --- |
| telemetry | 本次不做 | 目前沒有 telemetry runtime；不得放 placeholder。 |
| cache | 本次不做 | 需先定義 cache 範圍與清除行為。 |
| debug log | 本次不做 | 需先定義 log location 與開關行為。 |
| reset settings | 本次實作 | 只重設 settings registry 管理的 key，避免清掉非設定資料。 |

## Completion Report Template

完成時必須使用以下格式回報：

```text
已完成：
- ...

未完成：
- ...

未完成原因：
- ...

驗證：
- ...

與 checklist 差異：
- 無 / 條列差異與原因
```
