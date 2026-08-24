import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkTooltipPositionWithinBounds } from "../src/linkTooltipPosition.ts";

const bounds = {
  bottom: 700,
  height: 600,
  left: 300,
  right: 900,
  top: 100,
  width: 600,
};

assert.deepEqual(
  linkTooltipPositionWithinBounds({
    bounds,
    tooltip: { bottom: 340, height: 40, left: 400, right: 740, top: 300, width: 340 },
  }),
  { left: 400, maxWidth: 584, top: 300 },
);
assert.deepEqual(
  linkTooltipPositionWithinBounds({
    bounds,
    tooltip: { bottom: 340, height: 40, left: 200, right: 540, top: 300, width: 340 },
  }),
  { left: 308, maxWidth: 584, top: 300 },
);
assert.deepEqual(
  linkTooltipPositionWithinBounds({
    bounds,
    tooltip: { bottom: 740, height: 40, left: 850, right: 1190, top: 700, width: 340 },
  }),
  { left: 552, maxWidth: 584, top: 652 },
);
assert.deepEqual(
  linkTooltipPositionWithinBounds({
    bounds,
    tooltip: { bottom: 150, height: 40, left: 400, right: 1100, top: 110, width: 700 },
  }),
  { left: 308, maxWidth: 584, top: 110 },
);

const editor = readFileSync(
  new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url),
  "utf8",
);
const appStyles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(
  editor,
  /const tooltipSelector = "\.milkdown-link-preview, \.milkdown-link-edit";/,
);
assert.match(
  editor,
  /const bounds = currentRoot\.getBoundingClientRect\(\);[\s\S]*?currentRoot\.querySelectorAll<HTMLElement>\(tooltipSelector\)[\s\S]*?linkTooltipPositionWithinBounds\(\{ bounds, tooltip: tooltipRect \}\)[\s\S]*?tooltip\.style\.left[\s\S]*?tooltip\.style\.top/,
);
assert.match(
  editor,
  /new MutationObserver\(\(mutations\) => \{[\s\S]*?delete target\.dataset\.scholiumPositioned;[\s\S]*?scheduleLinkTooltipPositionSync\(\);/,
);
assert.match(
  editor,
  /tooltip\.style\.left[\s\S]*?tooltip\.style\.top[\s\S]*?tooltip\.dataset\.scholiumPositioned = "true";/,
);
assert.match(
  appStyles,
  /\.milkdown-markdown-editor \.milkdown-link-preview > \.link-preview,[\s\S]*?\.milkdown-markdown-editor \.milkdown-link-edit > \.link-edit \{\s*max-width: 100%;/,
);
assert.match(
  appStyles,
  /\.milkdown-link-preview\[data-show="true"\]:not\(\[data-scholium-positioned="true"\]\),[\s\S]*?\.milkdown-link-edit\[data-show="true"\]:not\(\[data-scholium-positioned="true"\]\) \{\s*visibility: hidden;/,
);

console.log("link tooltip editor-bound positioning regression: PASS");
