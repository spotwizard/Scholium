import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(
  css,
  /\.mobile-feedback-backdrop \{[\s\S]*?background: rgba\(32, 35, 41, 0\.32\);/,
  "central feedback must share the established gray backdrop",
);
assert.match(
  app,
  /mobileNoteSelectionHintVisible && !noteModeSourceBlockedNoticePosition[\s\S]*?className="mobile-feedback-backdrop"/,
  "the centered note-mode hint must render the shared backdrop",
);
assert.match(
  app,
  /className="mobile-feedback-backdrop mobile-storage-loading-overlay"[\s\S]*?storageLoading \? "is-loading"/,
  "every global storage message must render inside the shared backdrop",
);

console.log("feedback backdrop regression: PASS");
