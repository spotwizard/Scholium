import { isAppLanguage, type AppLanguage, type TranslationKey } from "./i18n.ts";

export type SettingCategory = "app" | "editor" | "cloud";

export type SettingsValueMap = {
  "app.language": AppLanguage;
  "app.interfaceFontSize": number;
  "app.theme": "system" | "light" | "dark";
  "app.restoreLastOpenedFile": boolean;
  "app.directoryPaneOpen": boolean;
  "app.noteModeEnabledByDefault": boolean;
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
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
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
    labelKey: TranslationKey;
    value: Extract<SettingsValueMap[SelectSettingKey], string>;
  }>;
};

export type SettingDefinition =
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | SelectSettingDefinition;

export const settingCategoryLabelKeys: Record<SettingCategory, TranslationKey> = {
  app: "settings.category.app",
  editor: "settings.category.editor",
  cloud: "settings.category.cloud",
};

export const settingCategoryOrder: SettingCategory[] = ["app", "editor", "cloud"];

export const settingsDefinitions: SettingDefinition[] = [
  {
    key: "app.language",
    category: "app",
    type: "select",
    labelKey: "settings.app.language.label",
    descriptionKey: "settings.app.language.description",
    defaultValue: "zh-Hant",
    options: [
      { labelKey: "settings.app.language.option.english", value: "en" },
      { labelKey: "settings.app.language.option.traditionalChinese", value: "zh-Hant" },
      { labelKey: "settings.app.language.option.simplifiedChinese", value: "zh-Hans" },
    ],
  },
  {
    key: "app.interfaceFontSize",
    category: "app",
    type: "number",
    labelKey: "settings.app.interfaceFontSize.label",
    descriptionKey: "settings.app.interfaceFontSize.description",
    defaultValue: 18,
    min: 15,
    max: 22,
    step: 1,
    unit: "px",
  },
  {
    key: "app.theme",
    category: "app",
    type: "select",
    labelKey: "settings.app.theme.label",
    descriptionKey: "settings.app.theme.description",
    defaultValue: "light",
    options: [
      { labelKey: "settings.app.theme.option.system", value: "system" },
      { labelKey: "settings.app.theme.option.light", value: "light" },
      { labelKey: "settings.app.theme.option.dark", value: "dark" },
    ],
  },
  {
    key: "app.restoreLastOpenedFile",
    category: "app",
    type: "boolean",
    labelKey: "settings.app.restoreLastOpenedFile.label",
    descriptionKey: "settings.app.restoreLastOpenedFile.description",
    defaultValue: true,
  },
  {
    key: "app.directoryPaneOpen",
    category: "app",
    type: "boolean",
    labelKey: "settings.app.directoryPaneOpen.label",
    descriptionKey: "settings.app.directoryPaneOpen.description",
    defaultValue: false,
  },
  {
    key: "app.noteModeEnabledByDefault",
    category: "app",
    type: "boolean",
    labelKey: "settings.app.noteModeEnabledByDefault.label",
    descriptionKey: "settings.app.noteModeEnabledByDefault.description",
    defaultValue: false,
  },
  {
    key: "editor.fontSize",
    category: "editor",
    type: "number",
    labelKey: "settings.editor.fontSize.label",
    descriptionKey: "settings.editor.fontSize.description",
    defaultValue: 18,
    min: 14,
    max: 28,
    step: 1,
    unit: "px",
  },
  {
    key: "editor.lineHeight",
    category: "editor",
    type: "number",
    labelKey: "settings.editor.lineHeight.label",
    descriptionKey: "settings.editor.lineHeight.description",
    defaultValue: 1.72,
    min: 1.3,
    max: 2.2,
    step: 0.05,
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

  if (definition.key === "app.language") {
    return isAppLanguage(value) ? value : definition.defaultValue;
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
    "app.language": readSetting("app.language"),
    "app.interfaceFontSize": readSetting("app.interfaceFontSize"),
    "app.theme": readSetting("app.theme"),
    "app.restoreLastOpenedFile": readSetting("app.restoreLastOpenedFile"),
    "app.directoryPaneOpen": readSetting("app.directoryPaneOpen"),
    "app.noteModeEnabledByDefault": readSetting("app.noteModeEnabledByDefault"),
    "editor.fontSize": readSetting("editor.fontSize"),
    "editor.lineHeight": readSetting("editor.lineHeight"),
  };
}
