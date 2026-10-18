import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { wholePixelScrollPosition } from "../src/wholePixelScroll.ts";

test("a sub-pixel scroll toward the typing line still moves a whole pixel", () => {
  assert.equal(wholePixelScrollPosition(544, 0.875), 545);
  assert.equal(wholePixelScrollPosition(544, 0.1), 545);
  assert.equal(wholePixelScrollPosition(544, -0.875), 543);
});

test("scroll targets are whole pixels even from a fractional start", () => {
  assert.equal(wholePixelScrollPosition(544.5, 30.96), 576);
  assert.equal(wholePixelScrollPosition(544.4, -120.2), 423);
  assert.equal(wholePixelScrollPosition(0, 31), 31);
});

test("the preview editor scrolls the selection into view with whole pixels", () => {
  const preview = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");
  assert.match(preview, /handleScrollToSelection: scrollSelectionIntoViewWithWholePixels,/);

  const scroll = readFileSync(new URL("../src/wholePixelScroll.ts", import.meta.url), "utf8");
  assert.doesNotMatch(scroll, /\.scrollBy\(/);
});
