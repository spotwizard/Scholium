import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const noteIcon = readFileSync(new URL("../src/assets/note-mode.svg", import.meta.url), "utf8");
const glossaryIcon = readFileSync(
  new URL("../src/assets/glossary-mode.svg", import.meta.url),
  "utf8",
);
const notices = readFileSync(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /note-mode-switch__icon--note[\s\S]*?t\("mobileToolbar\.note"\)[\s\S]*?note-mode-switch__icon--glossary[\s\S]*?t\("mobileToolbar\.terms"\)/,
);
assert.match(
  css,
  /\.note-mode-switch \{[\s\S]*?min-width: 0;[\s\S]*?gap: 4px;[\s\S]*?padding: 0 6px;/,
);
assert.match(css, /\.note-mode-switch__icon \{[\s\S]*?width: 16px;[\s\S]*?height: 16px;/);
assert.match(css, /note-mode\.svg/);
assert.match(css, /glossary-mode\.svg/);
assert.match(noteIcon, /viewBox="0 0 300 300"/);
assert.match(glossaryIcon, /viewBox="0 0 300 300"/);
assert.match(notices, /memo-pad_9585401/);
assert.match(notices, /book-font_9083447/);

console.log("desktop annotation mode controls regression: PASS");
