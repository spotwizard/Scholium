import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const icon = fs.readFileSync(
  new URL("../src/assets/source-mode-code.svg", import.meta.url),
  "utf8",
);
const notices = fs.readFileSync(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /function SourceModeIcon[\s\S]*?return <span aria-hidden="true" className=\{className\} \/>;/,
);
assert.equal(app.match(/<SourceModeIcon \/>/g)?.length, 2);
assert.match(
  css,
  /\.editor-mode-toggle__icon \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?source-mode-code\.svg/,
);
assert.match(
  css,
  /\.mobile-editor-mode-toggle \.editor-mode-toggle__icon \{[\s\S]*?width: 22px;[\s\S]*?height: 22px;/,
);
assert.match(icon, /viewBox="0 0 300 300"/);
assert.match(icon, /translate\(0 300\) scale\(1 -1\)/);
assert.match(notices, /display-code_8778036/);

console.log("Flaticon source mode icon regression: PASS");
