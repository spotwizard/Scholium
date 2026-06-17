import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { TranslationKey } from "./i18n";
import {
  settingCategoryLabelKeys,
  settingCategoryOrder,
  settingsDefinitions,
  type SettingCategory,
  type SettingDefinition,
  type SettingKey,
  type SettingValue,
  type SettingsSnapshot,
} from "./settings";

type SettingsViewProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  customSections?: Array<{
    category: SettingCategory;
    content: ReactNode;
  }>;
  initialCategory?: SettingCategory;
  t: (key: TranslationKey, replacements?: Record<string, string | number>) => string;
  values: SettingsSnapshot;
  onChange: (key: SettingKey, value: SettingValue) => void;
  onClose: () => void;
  onResetAllSettings: () => void;
  onResetSetting: (key: SettingKey) => void;
};

export function SettingsView({
  closeButtonRef,
  customSections = [],
  initialCategory = "app",
  t,
  values,
  onChange,
  onClose,
  onResetAllSettings,
  onResetSetting,
}: SettingsViewProps) {
  const customSectionsByCategory = useMemo(
    () =>
      new Map<SettingCategory, ReactNode>(
        customSections.map((section) => [section.category, section.content]),
      ),
    [customSections],
  );
  const activeCategories = useMemo(
    () =>
      settingCategoryOrder
        .map((category) => ({
          category,
          definitions: settingsDefinitions.filter((definition) => definition.category === category),
        }))
        .filter(
          (section) =>
            section.definitions.length > 0 || customSectionsByCategory.has(section.category),
        ),
    [customSectionsByCategory],
  );
  const [selectedCategory, setSelectedCategory] = useState<SettingCategory>(
    initialCategory,
  );

  useEffect(() => {
    setSelectedCategory(initialCategory);
  }, [initialCategory]);

  const selectedSection =
    activeCategories.find((section) => section.category === selectedCategory) ??
    activeCategories[0];
  const customSectionContent = selectedSection
    ? customSectionsByCategory.get(selectedSection.category)
    : null;

  function renderSettingControl(definition: SettingDefinition) {
    const value = values[definition.key];
    const label = t(definition.labelKey);

    if (definition.type === "boolean") {
      return (
        <label className="settings-view__switch">
          <input
            aria-label={label}
            checked={Boolean(value)}
            type="checkbox"
            onChange={(event) => onChange(definition.key, event.target.checked)}
          />
          <span aria-hidden="true" className="settings-view__toggle" />
        </label>
      );
    }

    if (definition.type === "number") {
      const numberValue = typeof value === "number" ? value : definition.defaultValue;

      return (
        <div className="settings-view__number-control">
          <input
            aria-label={label}
            className="settings-view__range"
            max={definition.max}
            min={definition.min}
            step={definition.step}
            type="range"
            value={numberValue}
            onChange={(event) => onChange(definition.key, Number(event.target.value))}
          />
          <label className="settings-view__number-field">
            <input
              aria-label={t("settings.numberValue", { label })}
              max={definition.max}
              min={definition.min}
              step={definition.step}
              type="number"
              value={numberValue}
              onChange={(event) => onChange(definition.key, Number(event.target.value))}
            />
            {definition.unit ? <span>{definition.unit}</span> : null}
          </label>
        </div>
      );
    }

    return (
      <div
        aria-label={label}
        className="settings-view__segmented"
        role="radiogroup"
      >
        {definition.options.map((option) => (
          <button
            aria-checked={value === option.value}
            className={value === option.value ? "is-selected" : ""}
            key={option.value}
            onClick={() => onChange(definition.key, option.value)}
            role="radio"
            type="button"
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
    );
  }

  function settingIsModified(definition: SettingDefinition) {
    return values[definition.key] !== definition.defaultValue;
  }

  return (
    <div className="settings-view-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="settings-view-title"
        aria-modal="true"
        className="settings-view"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="settings-view__header">
          <div>
            <h2 id="settings-view-title">{t("settings.title")}</h2>
          </div>
          <div className="settings-view__actions">
            <button
              aria-label={t("settings.close")}
              className="settings-view__close"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>

        <div className="settings-view__body">
          <nav aria-label={t("settings.categories")} className="settings-view__sidebar">
            {activeCategories.map(({ category }) => (
              <button
                aria-current={category === selectedSection?.category ? "page" : undefined}
                className={category === selectedSection?.category ? "is-active" : ""}
                key={category}
                onClick={() => setSelectedCategory(category)}
                type="button"
              >
                <span>{t(settingCategoryLabelKeys[category])}</span>
              </button>
            ))}
          </nav>

          <div className="settings-view__content">
            {selectedSection ? (
              <section
                className="settings-view__section"
                id={`settings-${selectedSection.category}`}
                key={selectedSection.category}
              >
                <h3>{t(settingCategoryLabelKeys[selectedSection.category])}</h3>
                {selectedSection.definitions.length > 0 ? (
                  <div className="settings-view__setting-list">
                    {selectedSection.definitions.map((definition) => {
                      return (
                        <div className="settings-view__setting-row" key={definition.key}>
                          <div className="settings-view__setting-copy">
                            <span className="settings-view__setting-label">
                              {t(definition.labelKey)}
                            </span>
                            {definition.descriptionKey ? (
                              <span className="settings-view__setting-description">
                                {t(definition.descriptionKey)}
                              </span>
                            ) : null}
                          </div>
                          <div className="settings-view__setting-control">
                            {renderSettingControl(definition)}
                          </div>
                          <div className="settings-view__setting-actions">
                            {definition.requiresRestart ? (
                              <span className="settings-view__restart-badge">
                                {t("settings.restartRequired")}
                              </span>
                            ) : null}
                            {settingIsModified(definition) ? (
                              <button
                                className="settings-view__reset"
                                onClick={() => onResetSetting(definition.key)}
                                type="button"
                              >
                                {t("settings.reset")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {customSectionContent}
              </section>
            ) : null}
            <div className="settings-view__footer">
              <button
                className="settings-view__reset-all"
                onClick={onResetAllSettings}
                type="button"
              >
                {t("settings.resetAll")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
