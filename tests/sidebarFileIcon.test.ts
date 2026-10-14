import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const inactiveBook = fs.readFileSync(new URL("../src/assets/file-glyph.png", import.meta.url));
const activeBook = fs.readFileSync(new URL("../src/assets/file-selected-glyph.png", import.meta.url));
const notices = fs.readFileSync(
  new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  "utf8",
);

assert.match(app, /import fileGlyphUrl from "\.\/assets\/file-glyph\.png";/);
assert.match(app, /import fileSelectedGlyphUrl from "\.\/assets\/file-selected-glyph\.png";/);
assert.match(
  app,
  /kind === "file"[\s\S]*?selected \? fileSelectedGlyphUrl : fileGlyphUrl[\s\S]*?document-icon__flaticon-book/,
);
assert.equal(
  createHash("sha256").update(inactiveBook).digest("hex"),
  "347dfe393d27aeb011fbdd33096ce3d52b7d87f0b0d37db4c724ffc4e640bdbe",
);
assert.equal(
  createHash("sha256").update(activeBook).digest("hex"),
  "7d653022e3c6885a94f4b2f2a86a93a6c8e0a7aeac2111f5f1b718625691b934",
);
assert.match(notices, /book_4613095/);
assert.match(notices, /open-book_4613052/);
assert.match(notices, /authors\/freepik/);

console.log("Flaticon closed/open sidebar book icon pair regression: PASS");
