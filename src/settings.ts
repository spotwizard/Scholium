export type SettingCategory = "app" | "editor" | "project" | "ai" | "privacy";

export type SettingsValueMap = {
  "app.interfaceFontSize": number;
  "app.theme": "system" | "light" | "dark";
  "app.restoreLastOpenedFile": boolean;
  "app.directoryPaneOpen": boolean;
  "editor.fontSize": number;
  "editor.lineHeight": number;
};

export type SettingKey = keyof SettingsValueMap;
export type SettingValue = SettingsValueMap[SettingKey];
export type SettingsSnapshot = { [Key in SettingKey]: SettingsValueMap[Key] };

type BooleanSettingKey = {
  [Key in SettingKey]: SettingsValueMap[Key] extends boolean ? Key : never;
}[SettingKey];

type NumberSettingKey = {
  [Key in SettingKey]: SettingsValueMap[Key] extends number ? Key : never;
}[SettingKey];

type SelectSettingKey = Exclude<SettingKey, BooleanSettingKey | NumberSettingKey>;

type BaseSettingDefinition<Key extends SettingKey> = {
  key: Key;
  category: SettingCategory;
  label: string;
  description?: string;
  requiresRestart: boolean;
};

export type BooleanSettingDefinition = BaseSettingDefinition<BooleanSettingKey> & {
  type: "boolean";
  defaultValue: boolean;
};

export type NumberSettingDefinition = BaseSettingDefinition<NumberSettingKey> & {
  type: "number";
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type SelectSettingDefinition = BaseSettingDefinition<SelectSettingKey> & {
  type: "select";
  defaultValue: Extract<SettingsValueMap[SelectSettingKey], string>;
  options: Array<{
    label: string;
    value: Extract<SettingsValueMap[SelectSettingKey], string>;
  }>;
};

export type SettingDefinition =
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | SelectSettingDefinition;

export const settingCategoryLabels: Record<SettingCategory, string> = {
  app: "一般",
  editor: "編輯器",
  project: "專案 / 資料庫",
  ai: "AI / API",
  privacy: "隱私 / 進階",
};

export const settingCategoryOrder: SettingCategory[] = [
  "app",
  "editor",
  "project",
  "ai",
  "privacy",
];

export const settingsDefinitions: SettingDefinition[] = [
  {
    key: "app.interfaceFontSize",
    category: "app",
    type: "number",
    label: "介面字體大小",
    description: "調整 Scholium 工具列、目錄、設定與面板文字大小。",
    defaultValue: 18,
    min: 15,
    max: 22,
    step: 1,
    unit: "px",
    requiresRestart: false,
  },
  {
    key: "app.theme",
    category: "app",
    type: "select",
    label: "主題",
    description: "控制 Scholium 的整體明暗外觀。",
    defaultValue: "system",
    options: [
      { label: "跟隨系統", value: "system" },
      { label: "淺色", value: "light" },
      { label: "深色", value: "dark" },
    ],
    requiresRestart: false,
  },
  {
    key: "app.restoreLastOpenedFile",
    category: "app",
    type: "boolean",
    label: "啟動時重新開啟上次的檔案",
    description: "關閉後，Scholium 啟動時不會自動載入上次開啟的 Markdown 檔案。",
    defaultValue: true,
    requiresRestart: false,
  },
  {
    key: "app.directoryPaneOpen",
    category: "app",
    type: "boolean",
    label: "啟動時顯示目錄面板",
    description: "控制 app 啟動後左側目錄面板的預設展開狀態。",
    defaultValue: true,
    requiresRestart: false,
  },
  {
    key: "editor.fontSize",
    category: "editor",
    type: "number",
    label: "編輯器字體大小",
    description: "調整 Markdown 編輯與閱讀內容的本文字級。",
    defaultValue: 18,
    min: 14,
    max: 28,
    step: 1,
    unit: "px",
    requiresRestart: false,
  },
  {
    key: "editor.lineHeight",
    category: "editor",
    type: "number",
    label: "編輯器行距",
    description: "調整 Markdown 編輯與閱讀內容的本文行高。",
    defaultValue: 1.72,
    min: 1.3,
    max: 2.2,
    step: 0.05,
    requiresRestart: false,
  },
];

const settingsStoragePrefix = "scholium:settings:";
const settingDefinitionsByKey = Object.fromEntries(
  settingsDefinitions.map((definition) => [definition.key, definition]),
) as Record<SettingKey, SettingDefinition>;

function storageKeyForSetting(key: SettingKey) {
  return `${settingsStoragePrefix}${key}`;
}

function readRawSetting(key: SettingKey) {
  try {
    return window.localStorage.getItem(storageKeyForSetting(key));
  } catch {
    return null;
  }
}

function writeRawSetting(key: SettingKey, value: string) {
  try {
    window.localStorage.setItem(storageKeyForSetting(key), value);
  } catch {
    // Settings persistence is best-effort only.
  }
}

function removeRawSetting(key: SettingKey) {
  try {
    window.localStorage.removeItem(storageKeyForSetting(key));
  } catch {
    // Settings persistence is best-effort only.
  }
}

function coerceSettingValue(definition: SettingDefinition, value: unknown): SettingValue {
  if (definition.type === "boolean") {
    return typeof value === "boolean" ? value : definition.defaultValue;
  }

  if (definition.type === "number") {
    const numericValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numericValue)) return definition.defaultValue;

    return Math.min(definition.max, Math.max(definition.min, numericValue));
  }

  if (
    typeof value === "string" &&
    definition.options.some((option) => option.value === value)
  ) {
    return value as SettingValue;
  }

  return definition.defaultValue;
}

function parseStoredSettingValue(definition: SettingDefinition, rawValue: string | null) {
  if (rawValue === null) return definition.defaultValue;

  if (definition.type === "boolean") {
    if (rawValue === "true") return true;
    if (rawValue === "false") return false;
    return definition.defaultValue;
  }

  if (definition.type === "number") {
    return coerceSettingValue(definition, Number(rawValue));
  }

  return coerceSettingValue(definition, rawValue);
}

export function readSetting<Key extends SettingKey>(key: Key): SettingsValueMap[Key] {
  const definition = settingDefinitionsByKey[key];
  return parseStoredSettingValue(definition, readRawSetting(key)) as SettingsValueMap[Key];
}

export function writeSetting(key: SettingKey, value: SettingValue) {
  const definition = settingDefinitionsByKey[key];
  const coercedValue = coerceSettingValue(definition, value);
  writeRawSetting(key, String(coercedValue));
  return coercedValue;
}

export function resetSetting(key: SettingKey) {
  removeRawSetting(key);
  return readSetting(key);
}

export function resetSettings() {
  settingsDefinitions.forEach((definition) => removeRawSetting(definition.key));
  return readSettingsSnapshot();
}

export function readSettingsSnapshot(): SettingsSnapshot {
  return {
    "app.interfaceFontSize": readSetting("app.interfaceFontSize"),
    "app.theme": readSetting("app.theme"),
    "app.restoreLastOpenedFile": readSetting("app.restoreLastOpenedFile"),
    "app.directoryPaneOpen": readSetting("app.directoryPaneOpen"),
    "editor.fontSize": readSetting("editor.fontSize"),
    "editor.lineHeight": readSetting("editor.lineHeight"),
  };
}
