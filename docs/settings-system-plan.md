# Scholium Settings System 規劃

這份文件定義 Scholium 設定功能的目標架構與第一版實作範圍。設定功能應該先建立一個可擴充的 Settings system，而不是只做一個薄版設定入口。

## 目標

- 從 macOS app menu 的 `Scholium > 設定...` 進入設定功能。
- 所有設定項目由集中式 schema/registry 定義。
- UI 不直接散落讀寫 `localStorage`、檔案或 Tauri commands。
- 每個設定都要有明確的 type、default value、validation、category 與 runtime 行為。
- 第一版只放已經接上實際行為的設定，不放無作用的 placeholder。

## 設定分類

### App settings

管理 app 層級偏好：

- 啟動時重新開啟上次的 Markdown 檔案
- 啟動時是否顯示目錄面板
- 預設 app 顯示語言
- 主題
- 字體縮放

第一版只實作已能直接接到目前 runtime 的項目：啟動復原、目錄面板、語言、主題與介面字體縮放。語言設定必須建立 i18n dictionary 與文字來源整理，不能只放無效下拉選單。

### Editor settings

管理 editor 與 preview 偏好：

- 預設 editor font size
- 預設行距
- Markdown / citation 顯示選項

第一版實作 editor font size 與 line height。font size 與 line height 必須透過 editor surface 的 styling contract 同步套用到 CodeMirror、preview 與 Milkdown，不可只補單一 CSS selector。閱讀/編輯模式屬於文件工作流的即時切換，不放進 preferences。citation 顯示需要先整理 renderer 行為，第一版不放。

### Project / Library settings

管理 workspace 與資料位置：

- 預設開啟資料夾
- 預設儲存位置
- 匯入/匯出偏好
- 最近開啟與常用目錄管理

第一版先不放，因為目前 project/library persistence 尚未獨立於 native menu recent/favorites。

### AI / API settings

管理未來 AI 功能：

- model
- API key
- context 長度
- 是否啟用特定 AI 功能

第一版不放，因為目前 app 尚無 AI runtime 行為。未來 API key 必須走 secure storage 或 Keychain，不可存在一般 `localStorage`。

### Privacy / Advanced settings

管理資料與除錯：

- telemetry
- cache
- debug log
- reset settings

第一版只放 `Reset settings`，但必須等 settings store 與 registry 完成後再做，避免 reset 只清掉一部分資料。

## Settings Schema

每個設定項目必須集中定義，不允許 UI component 自行發明 storage key。

建議型別：

```ts
type SettingCategory = "app" | "editor" | "project" | "ai" | "privacy";

type BooleanSettingDefinition = {
  key: string;
  category: SettingCategory;
  type: "boolean";
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  defaultValue: boolean;
  requiresRestart: boolean;
};

type NumberSettingDefinition = {
  key: string;
  category: SettingCategory;
  type: "number";
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  requiresRestart: boolean;
};

type SelectSettingDefinition<T extends string = string> = {
  key: string;
  category: SettingCategory;
  type: "select";
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  defaultValue: T;
  options: Array<{ labelKey: TranslationKey; value: T }>;
  requiresRestart: boolean;
};

type SettingDefinition =
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | SelectSettingDefinition;
```

第一版 registry 範例：

```ts
export const settingsDefinitions = [
  {
    key: "app.language",
    category: "app",
    type: "select",
    labelKey: "settings.app.language.label",
    defaultValue: "zh-Hant",
    options: [
      { labelKey: "settings.app.language.option.english", value: "en" },
      { labelKey: "settings.app.language.option.traditionalChinese", value: "zh-Hant" },
      { labelKey: "settings.app.language.option.simplifiedChinese", value: "zh-Hans" },
    ],
    requiresRestart: false,
  },
  {
    key: "app.interfaceFontSize",
    category: "app",
    type: "number",
    labelKey: "settings.app.interfaceFontSize.label",
    defaultValue: 18,
    min: 15,
    max: 22,
    step: 1,
    requiresRestart: false,
  },
  {
    key: "app.theme",
    category: "app",
    type: "select",
    labelKey: "settings.app.theme.label",
    defaultValue: "system",
    options: [
      { labelKey: "settings.app.theme.option.system", value: "system" },
      { labelKey: "settings.app.theme.option.light", value: "light" },
      { labelKey: "settings.app.theme.option.dark", value: "dark" },
    ],
    requiresRestart: false,
  },
  {
    key: "app.restoreLastOpenedFile",
    category: "app",
    type: "boolean",
    labelKey: "settings.app.restoreLastOpenedFile.label",
    defaultValue: true,
    requiresRestart: false,
  },
  {
    key: "app.directoryPaneOpen",
    category: "app",
    type: "boolean",
    labelKey: "settings.app.directoryPaneOpen.label",
    defaultValue: true,
    requiresRestart: false,
  },
  {
    key: "editor.fontSize",
    category: "editor",
    type: "number",
    labelKey: "settings.editor.fontSize.label",
    defaultValue: 18,
    min: 14,
    max: 28,
    step: 1,
    requiresRestart: false,
  },
  {
    key: "editor.lineHeight",
    category: "editor",
    type: "number",
    labelKey: "settings.editor.lineHeight.label",
    defaultValue: 1.72,
    min: 1.3,
    max: 2.2,
    step: 0.05,
    requiresRestart: false,
  },
] satisfies SettingDefinition[];
```

## Settings Store API

UI 與 feature code 都應該透過 store API 讀寫設定。

必備 API：

```ts
readSetting(key)
writeSetting(key, value)
resetSetting(key)
resetSettings()
readSettingsSnapshot()
```

責任分工：

- `settingsDefinitions`：宣告 schema、default、category、translation key、validation。
- `i18n dictionary`：集中管理 app UI、settings UI、native menu label 與狀態訊息的 English / 繁體中文 / 簡體中文文案。
- `settingsStore`：負責 persistence、validation、migration、reset。
- `SettingsView`：根據 definitions render controls，透過 translator 顯示文案，不直接碰 storage key。
- `App.tsx`：只訂閱或讀取已驗證的 setting value，並套用到 runtime state 與 frontend 文案。
- `src-tauri` native menu：由 app language 設定刷新 menu label，避免 menu 與 app 內容語言不一致。

## Persistence 策略

第一版可使用 `localStorage` 作為一般偏好 persistence，但必須包在 `settingsStore` 內。

未來分層：

- 一般偏好：app config store 或 localStorage wrapper。
- sensitive settings：macOS Keychain 或 secure storage。
- project-specific settings：寫入 project metadata，不混入 global app settings。
- runtime-only flags：保留在 React state，不寫入永久設定。

## Settings UI

第一版 UI 必須具備：

- 從 `Scholium > 設定...` 開啟。
- 使用 app-level preferences dialog：背景 app 降低干擾，dialog 內承載完整設定導覽與內容。
- 設定為即時套用偏好，不使用「完成」作為唯一退出語意；必須提供明確關閉按鈕。
- 點擊 dialog 外部 backdrop 應關閉設定，dialog 內部互動不關閉，與筆記視窗的外部互動 dismissal model 對齊。
- dialog 左側只放 category navigation，不顯示設定項目數量等無操作價值的資訊。
- dialog 右側顯示對應設定內容。
- 右側/內容區根據 schema render controls。
- boolean 使用 switch/checkbox。
- select 使用 segmented control 或 select menu。
- 每個設定項要顯示 label。
- 需要 restart 的項目要標示。
- 提供 reset 單一設定；全域 reset 可在 store 完成後加入。

不應該：

- UI 直接 `localStorage.setItem(...)`。
- 為了填滿畫面放尚未接上 runtime 的假設定。
- 用單一 ad hoc toggle 當作 settings system。
- 進入設定時仍露出或保留可操作的檔案目錄，讓使用者誤以為設定與目前檔案綁定。

## 第一版實作範圍

第一版只實作以下可立即接到 runtime 的設定：

- `app.interfaceFontSize`
  - 控制 Scholium app 介面字體縮放。
  - default: `18`

- `app.language`
  - 控制 Scholium app 顯示語言。
  - 支援 `en`、`zh-Hant`、`zh-Hans`。
  - 必須同步 settings UI、主要 app UI、狀態訊息與 native menu label。
  - default: `zh-Hant`

- `app.theme`
  - 控制 app 主題為跟隨系統、淺色或深色。
  - default: `system`

- `app.restoreLastOpenedFile`
  - 控制啟動時是否讀取上次開啟的 Markdown path。
  - default: `true`

- `app.directoryPaneOpen`
  - 控制 app 啟動時目錄面板是否展開。
  - default: `true`

- `editor.fontSize`
  - 控制 Markdown 編輯與閱讀內容的本文字級。
  - default: `18`

- `editor.lineHeight`
  - 控制 Markdown 編輯與閱讀內容的本文行距。
  - default: `1.72`

## 第一版不做

- AI / API settings。
- API key storage。
- project-specific settings。
- default editor mode；閱讀/編輯模式應由 editor toolbar / shortcut 即時切換，不放進 preferences。
- citation 顯示選項，除非先定義 preview / citation renderer 行為。
- telemetry / debug log。
- settings migration UI。

## Acceptance Checklist

實作完成前必須逐項確認：

- [ ] `Scholium > 設定...` menu item 存在，並送出 settings open event。
- [ ] 設定 schema/registry 存在，且所有設定項從 registry 定義。
- [ ] Settings store 提供 read/write/reset/snapshot API。
- [ ] UI 不直接讀寫 raw storage key。
- [ ] Settings view 由 definitions render controls，並以 app-level preferences dialog 呈現。
- [ ] Settings dialog 提供明確關閉按鈕，不以「完成」作為唯一退出語意。
- [ ] Settings dialog 點擊外部 backdrop 會關閉，內部互動不關閉。
- [ ] Settings dialog 開啟時不保留可操作的檔案目錄。
- [ ] 左側設定分類不顯示設定項目數量。
- [ ] `app.language` 支援 English、繁體中文、簡體中文，並統一 app 主要 UI、settings UI、狀態訊息與 native menu label。
- [ ] `app.interfaceFontSize` 實際影響 app 介面字體縮放。
- [ ] `app.theme` 實際影響 app 主題外觀。
- [ ] `app.restoreLastOpenedFile` 實際影響啟動復原行為。
- [ ] `app.directoryPaneOpen` 實際影響啟動時目錄面板狀態。
- [ ] `editor.fontSize` 實際影響 Markdown 編輯與閱讀內容。
- [ ] `editor.lineHeight` 實際影響 Markdown 編輯與閱讀內容。
- [ ] 不存在尚未接上 runtime 的假設定。
- [ ] 完成回報時逐項對照本 checklist。

## 操作規範

若需要操作 GUI、切換 app、截圖、關閉 app、重啟 app、或執行安裝版 app 驗證，必須先知會使用者。
