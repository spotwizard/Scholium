import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const announcementRule = css.match(
  /\.markdown-editor-host > \.cm-editor > \.cm-announced \{[\s\S]*?\}/,
)?.[0];

assert.ok(announcementRule, "the source editor must keep CodeMirror announcements off-screen");
assert.match(announcementRule, /position:\s*fixed\s*!important;/);
assert.match(announcementRule, /top:\s*-10000px\s*!important;/);
assert.doesNotMatch(
  announcementRule,
  /display:\s*none/,
  "screen readers must still receive CodeMirror accessibility announcements",
);

console.log("source mode accessibility announcement regression: PASS");
