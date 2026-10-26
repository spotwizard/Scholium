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
assert.doesNotMatch(
  appSource,
  /savedLocationRemoved/,
  "removing an unreadable saved location must not show a message",
);
assert.match(
  rustSource,
  /load_dropbox_tokens\(app\.handle\(\), dropbox_tokens\)[\s\S]*?check_saved_locations_in_background\(app\.handle\(\)\.clone\(\)\);/,
  "saved locations must be checked when the app starts, once Dropbox can be reached",
);
assert.match(
  rustSource,
  /fn check_saved_locations_in_background\(app_handle: tauri::AppHandle\) \{\n    std::thread::spawn\(move \|\| \{/,
  "the launch check must run off the main thread so opening files is never blocked",
);
assert.match(
  rustSource,
  /&PredefinedMenuItem::fullscreen\(app_handle, None\)\?\],\n            \)\?,\n            &removed_locations,/,
  "the removed list must be its own top-level menu after View",
);

console.log("saved location pruning regression: PASS");
