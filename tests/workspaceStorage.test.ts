import assert from "node:assert/strict";
import {
  currentWindowWorkspaceStorage,
  workspaceStorageKeys,
} from "../src/workspaceStorage.ts";

const secondarySeededKey = "scholium:secondary-workspace-seeded";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

for (const search of ["", "?scholium-window=primary", "?scholium-window=secondary-view"]) {
  const primaryStorage = memoryStorage();
  const primaryWindow = {
    location: { search },
    localStorage: primaryStorage,
    get sessionStorage(): Storage {
      throw new Error("primary windows must not access session storage");
    },
  };
  assert.equal(currentWindowWorkspaceStorage(primaryWindow), primaryStorage);
}

const primaryStorage = memoryStorage();
const secondaryStorage = memoryStorage();
const storageWindow = {
  location: { search: "?unrelated=1&scholium-window=secondary" },
  localStorage: primaryStorage,
  sessionStorage: secondaryStorage,
};
const keys = Object.values(workspaceStorageKeys);
keys.forEach((key, index) => primaryStorage.setItem(key, `local-${index}`));
const missingKey = workspaceStorageKeys.lastOpenedMarkdownRootDirectory;
primaryStorage.removeItem(missingKey);
secondaryStorage.setItem(missingKey, "stale");

assert.equal(currentWindowWorkspaceStorage(storageWindow), secondaryStorage);
keys.forEach((key, index) =>
  assert.equal(secondaryStorage.getItem(key), key === missingKey ? null : `local-${index}`),
);
assert.equal(secondaryStorage.getItem(secondarySeededKey), "true");

primaryStorage.setItem(workspaceStorageKeys.lastOpenedMarkdownPath, "changed-primary");
secondaryStorage.setItem(workspaceStorageKeys.lastOpenedMarkdownPath, "independent-secondary");
secondaryStorage.setItem(missingKey, "independent-missing");
currentWindowWorkspaceStorage(storageWindow);
assert.equal(
  secondaryStorage.getItem(workspaceStorageKeys.lastOpenedMarkdownPath),
  "independent-secondary",
);
assert.equal(secondaryStorage.getItem(missingKey), "independent-missing");

const retryPrimaryStorage = memoryStorage(
  Object.fromEntries(keys.map((key, index) => [key, `retry-${index}`])),
);
const retrySecondaryStorage = memoryStorage();
const originalGetItem = retryPrimaryStorage.getItem.bind(retryPrimaryStorage);
let shouldFail = true;
retryPrimaryStorage.getItem = (key) => {
  if (shouldFail && key === workspaceStorageKeys.lastOpenedDropboxWorkspace) {
    throw new Error("storage unavailable");
  }
  return originalGetItem(key);
};
const retryWindow = {
  location: { search: "?scholium-window=secondary" },
  localStorage: retryPrimaryStorage,
  sessionStorage: retrySecondaryStorage,
};

assert.throws(() => currentWindowWorkspaceStorage(retryWindow), /storage unavailable/);
assert.equal(retrySecondaryStorage.getItem(secondarySeededKey), null);
shouldFail = false;
assert.equal(currentWindowWorkspaceStorage(retryWindow), retrySecondaryStorage);
keys.forEach((key, index) =>
  assert.equal(retrySecondaryStorage.getItem(key), `retry-${index}`),
);
assert.equal(retrySecondaryStorage.getItem(secondarySeededKey), "true");

console.log("workspace storage regression: PASS");
