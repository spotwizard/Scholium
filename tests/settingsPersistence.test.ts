import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSettingsSnapshot } from "../src/settings.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/settings-storage-v1.json", import.meta.url), "utf8"),
) as Record<string, string>;

const storedValues = new Map(Object.entries(fixture));
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem(key: string) {
        return storedValues.get(key) ?? null;
      },
      removeItem(key: string) {
        storedValues.delete(key);
      },
      setItem(key: string, value: string) {
        storedValues.set(key, value);
      },
    },
  },
});

assert.deepEqual(readSettingsSnapshot(), {
  "app.language": "zh-Hant",
  "app.interfaceFontSize": 20,
  "app.theme": "dark",
  "app.restoreLastOpenedFile": false,
  "app.directoryPaneOpen": true,
  "app.noteModeEnabledByDefault": true,
  "editor.fontSize": 22,
  "editor.lineHeight": 1.8,
});

Reflect.deleteProperty(globalThis, "window");

console.log("settings persistence fixture: PASS");
