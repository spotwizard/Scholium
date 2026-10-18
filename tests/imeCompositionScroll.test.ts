import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IME_SCROLL_DRIFT_MAX_PX,
  USER_SCROLL_GRACE_MS,
  imeScrollChangeIsDrift,
} from "../src/imeCompositionScroll.ts";

const idle = USER_SCROLL_GRACE_MS + 1;

test("one- or two-pixel scroll changes during composition count as drift", () => {
  assert.equal(imeScrollChangeIsDrift({ deltaY: 1, msSinceUserScroll: idle }), true);
  assert.equal(imeScrollChangeIsDrift({ deltaY: 2, msSinceUserScroll: idle }), true);
  assert.equal(imeScrollChangeIsDrift({ deltaY: -1, msSinceUserScroll: idle }), true);
  assert.equal(
    imeScrollChangeIsDrift({ deltaY: IME_SCROLL_DRIFT_MAX_PX, msSinceUserScroll: idle }),
    true,
  );
});

test("scrolling a whole new line into view is not drift", () => {
  assert.equal(
    imeScrollChangeIsDrift({ deltaY: IME_SCROLL_DRIFT_MAX_PX + 1, msSinceUserScroll: idle }),
    false,
  );
  assert.equal(imeScrollChangeIsDrift({ deltaY: 31, msSinceUserScroll: idle }), false);
  assert.equal(imeScrollChangeIsDrift({ deltaY: 0, msSinceUserScroll: idle }), false);
  assert.equal(imeScrollChangeIsDrift({ deltaY: Number.NaN, msSinceUserScroll: idle }), false);
});

test("small scroll changes right after the user scrolls are left alone", () => {
  assert.equal(imeScrollChangeIsDrift({ deltaY: 1, msSinceUserScroll: 0 }), false);
  assert.equal(
    imeScrollChangeIsDrift({ deltaY: 1, msSinceUserScroll: USER_SCROLL_GRACE_MS }),
    false,
  );
});

test("the preview editor installs the composition scroll guard", () => {
  const preview = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");
  assert.match(preview, /return installImeCompositionScrollGuard\(root\);/);
});
