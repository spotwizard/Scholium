import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gatewaySource = readFileSync(new URL("../src/tauriGateway.ts", import.meta.url), "utf8");
const rustSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(
  gatewaySource,
  /export function forgetSavedLocation\(args: ForgetSavedLocationArgs\) \{\n  return invoke<void>\("forget_saved_location", args\);/,
  "the webview must be able to drop a saved location from the native menus",
);
assert.match(
  appSource,
  /async function openNativeMenuLocation\([\s\S]*?forgetSavedLocation\([\s\S]*?\.then\(refreshSavedLocations\)[\s\S]*?openDropboxLocation\(location, \{ onNotFound: forgetUnavailableLocation \}\)[\s\S]*?openDirectoryPath\(location\.path, \{ onOpenFailed: forgetUnavailableLocation \}\)[\s\S]*?openMarkdownFilePath\(location\.path, \{ onOpenFailed: forgetUnavailableLocation \}\)/,
  "a recent or favorite location that fails to open must be forgotten for every source",
);
assert.match(
  appSource,
  /if \(openSelectionRevision !== manualDocumentSelectionRevisionRef\.current\) return false;\n\n      setStorageError\(translatedError\(error, "error\.openFolderFailed"\)\);\n      options\.onOpenFailed\?\.\(\);/,
  "a folder open superseded by another open must not forget the saved folder",
);
assert.match(
  appSource,
  /if \(openSelectionRevision !== manualDocumentSelectionRevisionRef\.current\) return false;\n\n      setStorageError\(translatedError\(error, "error\.openFileFailed"\)\);\n      options\.onOpenFailed\?\.\(\);/,
  "a file open superseded by another open must not forget the saved file",
);
assert.match(
  rustSource,
  /store\.recent\.retain\(saved_location_exists\);\n    store\.favorite_directories\.retain\(saved_location_exists\);/,
  "missing local locations must leave both Recent and Favorite Folders",
);
assert.match(
  rustSource,
  /fn remember_recent_location_entry\([\s\S]*?prune_missing_saved_locations\(&mut store\);[\s\S]*?store\.recent\.truncate\(MAX_RECENT_LOCATIONS\);/,
  "missing locations must be dropped before the recent list is cut to its limit",
);

console.log("saved location pruning regression: PASS");
