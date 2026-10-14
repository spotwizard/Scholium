import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fileNameTextIsTruncated,
  fileNameTooltipPosition,
} from "../src/fileNameTooltip.ts";

assert.equal(fileNameTextIsTruncated({ clientWidth: 120, scrollWidth: 120 }), false);
assert.equal(fileNameTextIsTruncated({ clientWidth: 120, scrollWidth: 121 }), false);
assert.equal(fileNameTextIsTruncated({ clientWidth: 120, scrollWidth: 122 }), true);

const viewportRect = {
  bottom: 620,
  height: 600,
  left: 10,
  right: 810,
  top: 20,
  width: 800,
};

assert.deepEqual(
  fileNameTooltipPosition({
    anchorRect: { right: 200, top: 100 },
    tooltipRect: { height: 80, width: 360 },
    viewportRect,
  }),
  { left: 208, top: 100 },
);

assert.deepEqual(
  fileNameTooltipPosition({
    anchorRect: { right: 790, top: 590 },
    tooltipRect: { height: 80, width: 360 },
    viewportRect,
  }),
  { left: 442, top: 532 },
);

assert.deepEqual(
  fileNameTooltipPosition({
    anchorRect: { right: 200, top: 100 },
    tooltipRect: { height: 700, width: 900 },
    viewportRect,
  }),
  { left: 18, top: 28 },
);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(appSource, /const fileNameTooltipHoverDelayMs = 250;/);
assert.match(appSource, /role="tooltip"/);
assert.match(appSource, /aria-describedby=\{fileNameTooltipDescribedBy/);
assert.match(
  appSource,
  /isMobileViewport && fileContextMenu\.kind === "file"[\s\S]*?file-context-menu__target-title/,
);
assert.match(
  appSource,
  /clampNumber\(fileContextMenu\.left, 8, Math\.max\(8, window\.innerWidth - 214\)\)/,
);
assert.match(
  appSource,
  /const fileContextMenuViewportRect = currentFloatingNoteViewportRect\(\);/,
);
assert.match(
  appSource,
  /fileContextMenuViewportRect\.bottom -[\s\S]*?fileContextMenuTitleHeight/,
);
assert.ok(
  (appSource.match(/data-file-name-overflow/g) ?? []).length >= 5,
  "every file-title render site must expose its clipped text for measurement",
);
assert.match(
  appCss,
  /\.file-name-tooltip \{[\s\S]*?position: fixed;[\s\S]*?z-index: 79;[\s\S]*?pointer-events: none;/,
);
assert.match(
  appCss,
  /\.file-context-menu__target-title \{[\s\S]*?max-height: 96px;[\s\S]*?overflow-y: auto;/,
);

console.log("file name tooltip regression: PASS");
