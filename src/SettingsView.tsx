import { useMemo, useState, type RefObject } from "react";
import {
  settingCategoryLabels,
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
  values: SettingsSnapshot;
  onChange: (key: SettingKey, value: SettingValue) => void;
  onClose: () => void;
  onResetAllSettings: () => void;
  onResetSetting: (key: SettingKey) => void;
};

export function SettingsView({
  closeButtonRef,
  values,
  onChange,
  onClose,
  onResetAllSettings,
  onResetSetting,
}: SettingsViewProps) {
  const activeCategories = useMemo(
    () =>
      settingCategoryOrder
        .map((category) => ({
          category,
          definitions: settingsDefinitions.filter((definition) => definition.category === category),
        }))
        .filter((section) => section.definitions.length > 0),
    [],
  );
  const [selectedCategory, setSelectedCategory] = useState<SettingCategory>(
    activeCategories[0]?.category ?? "app",
  );
  const selectedSection =
    activeCategories.find((section) => section.category === selectedCategory) ??
    activeCategories[0];

  function renderSettingControl(definition: SettingDefinition) {
    const value = values[definition.key];

    if (definition.type === "boolean") {
      return (
        <label className="settings-view__switch">
          <input
            aria-label={definition.label}
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
            aria-label={definition.label}
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
              aria-label={`${definition.label}數值`}
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
        aria-label={definition.label}
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
            {option.label}
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
            <h2 id="settings-view-title">設定</h2>
          </div>
          <div className="settings-view__actions">
            <button
              aria-label="關閉設定"
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
          <nav aria-label="設定分類" className="settings-view__sidebar">
            {activeCategories.map(({ category }) => (
              <button
                aria-current={category === selectedSection?.category ? "page" : undefined}
                className={category === selectedSection?.category ? "is-active" : ""}
                key={category}
                onClick={() => setSelectedCategory(category)}
                type="button"
              >
                <span>{settingCategoryLabels[category]}</span>
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
                <h3>{settingCategoryLabels[selectedSection.category]}</h3>
                <div className="settings-view__setting-list">
                  {selectedSection.definitions.map((definition) => {
                    return (
                      <div className="settings-view__setting-row" key={definition.key}>
                        <div className="settings-view__setting-copy">
                          <span className="settings-view__setting-label">
                            {definition.label}
                          </span>
                          {definition.description ? (
                            <span className="settings-view__setting-description">
                              {definition.description}
                            </span>
                          ) : null}
                        </div>
                        <div className="settings-view__setting-control">
                          {renderSettingControl(definition)}
                        </div>
                        <div className="settings-view__setting-actions">
                          {definition.requiresRestart ? (
                            <span className="settings-view__restart-badge">需重啟</span>
                          ) : null}
                          {settingIsModified(definition) ? (
                            <button
                              className="settings-view__reset"
                              onClick={() => onResetSetting(definition.key)}
                              type="button"
                            >
                              重設
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <div className="settings-view__footer">
              <button
                className="settings-view__reset-all"
                onClick={onResetAllSettings}
                type="button"
              >
                全部重設
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
