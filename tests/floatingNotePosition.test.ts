import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anchoredFloatingNoteGeometry } from "../src/floatingNotePosition.ts";

const viewportRect = {
  bottom: 615,
  left: 0,
  right: 820,
  top: 0,
};

const centered = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 480,
    top: 450,
    targetBottom: 390,
    targetX: 410,
  },
  cardHeight: 100,
  cardWidth: 360,
  viewportMargin: 12,
  viewportRect,
});

assert.equal(centered.placement, "below");
assert.equal(centered.top, 498);
assert.ok(!("maxHeight" in centered));
assert.deepEqual(centered.connector, {
  angle: 90,
  left: 410,
  top: 480,
  width: 18,
});

const nearRightEdge = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 540,
    top: 510,
    targetBottom: 540,
    targetX: 790,
  },
  cardHeight: 260,
  cardWidth: 360,
  viewportMargin: 12,
  viewportRect,
});

assert.equal(nearRightEdge.placement, "below");
assert.equal(nearRightEdge.left, 448);
assert.equal(nearRightEdge.top, 558);
assert.ok(nearRightEdge.top + 260 > viewportRect.bottom);
assert.ok(nearRightEdge.connector.width > 0);

const mobileNearBottom = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 540,
    top: 510,
    targetBottom: 540,
    targetX: 410,
  },
  cardHeight: 260,
  cardWidth: 360,
  flipAboveWhenNeeded: true,
  viewportMargin: 32,
  viewportRect,
});

assert.equal(mobileNearBottom.placement, "above");
assert.equal(mobileNearBottom.top, 232);
assert.equal(mobileNearBottom.top + 260, 492);
assert.deepEqual(mobileNearBottom.connector, {
  angle: -90,
  left: 410,
  top: 510,
  width: 18,
});

const desktopNearBottom = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 590,
    top: 560,
    targetBottom: 590,
    targetX: 410,
  },
  cardHeight: 260,
  cardWidth: 420,
  flipAboveWhenNeeded: true,
  viewportMargin: 12,
  viewportRect,
});

assert.equal(desktopNearBottom.placement, "above");
assert.equal(desktopNearBottom.top, 282);
assert.equal(desktopNearBottom.top + 260, 542);

const desktopScrollPositions = [560, 500, 440, 380].map((anchorTop) =>
  anchoredFloatingNoteGeometry({
    anchorRect: {
      bottom: anchorTop + 30,
      top: anchorTop,
      targetBottom: anchorTop + 30,
      targetX: 410,
    },
    cardHeight: 260,
    cardWidth: 420,
    flipAboveWhenNeeded: true,
    lockedPlacement: desktopNearBottom.placement,
    panelEdgeOffset: desktopNearBottom.top + 260 - 560,
    viewportMargin: 12,
    viewportRect,
  }),
);

assert.deepEqual(
  desktopScrollPositions.map((position) => position.placement),
  ["above", "above", "above", "above"],
);
assert.deepEqual(
  desktopScrollPositions.map((position) => position.top),
  [282, 222, 162, 102],
);
assert.deepEqual(
  desktopScrollPositions.map((position, index) =>
    position.top + 260 - [560, 500, 440, 380][index],
  ),
  [-18, -18, -18, -18],
);

const mobileScrolledWithLockedAnchor = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 330,
    top: 300,
    targetBottom: 330,
    targetX: 410,
  },
  cardHeight: 260,
  cardWidth: 360,
  flipAboveWhenNeeded: true,
  lockedPlacement: mobileNearBottom.placement,
  panelEdgeOffset: mobileNearBottom.top + 260 - 510,
  viewportMargin: 32,
  viewportRect,
});

assert.equal(mobileScrolledWithLockedAnchor.placement, "above");
assert.equal(mobileScrolledWithLockedAnchor.top, 22);
assert.deepEqual(mobileScrolledWithLockedAnchor.connector, {
  angle: -90,
  left: 410,
  top: 300,
  width: 18,
});

const mobileToolbarBounded = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 230,
    top: 200,
    targetBottom: 230,
    targetX: 410,
  },
  cardHeight: 300,
  cardWidth: 360,
  flipAboveWhenNeeded: true,
  viewportMargin: 32,
  viewportRect: {
    ...viewportRect,
    bottom: 543,
  },
});

assert.equal(mobileToolbarBounded.placement, "above");
assert.ok(mobileToolbarBounded.top + 300 <= 543 - 32);

const mobileLockedPastViewport = anchoredFloatingNoteGeometry({
  anchorRect: {
    bottom: 700,
    top: 670,
    targetBottom: 700,
    targetX: 410,
  },
  cardHeight: 100,
  cardWidth: 360,
  flipAboveWhenNeeded: true,
  lockedPlacement: "below",
  panelEdgeOffset: 18,
  viewportMargin: 32,
  viewportRect: {
    ...viewportRect,
    bottom: 543,
  },
});

assert.equal(mobileLockedPastViewport.placement, "below");
assert.equal(mobileLockedPastViewport.top, 718);
assert.ok(mobileLockedPastViewport.top > 543);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(
  appSource,
  /function currentFloatingNoteViewportRect\(\)[\s\S]*?querySelector<HTMLElement>\("\.mobile-command-bar"\)[\s\S]*?height: Math\.max\(0, bottom - viewportRect\.top\)/,
);
assert.match(
  appSource,
  /floatingNotePanelExpanded \|\| isMobileViewport \? "is-passive" : ""/,
);
assert.match(
  appSource,
  /function handleDocumentClick[\s\S]*?if \(!isMobileViewport \|\| !notePanelModalActive\) return;[\s\S]*?handleNotePanelOutsideModalInteraction\(event\);/,
);
assert.match(
  appSource,
  /document\.addEventListener\("click", handleDocumentClick, true\)/,
);
assert.match(
  appSource,
  /const anchorLock =\s*floatingNoteAnchorLockRef\.current\?\.key === activeFloatingNoteKey/,
);
assert.match(appSource, /flipAboveWhenNeeded: true/);
assert.match(
  appSource,
  /if \(!anchorLock && activeFloatingNoteKey\) \{[\s\S]*?floatingNoteAnchorLockRef\.current = \{/,
);
assert.match(
  appSource,
  /const floatingNoteCard = floatingNoteCardRef\.current;[\s\S]*?resizeObserver\.observe\(floatingNoteCard\)/,
);
assert.match(
  appSource,
  /const cardRect = card\?\.getBoundingClientRect\(\);\s*const cardSize = \{\s*height: card\?\.offsetHeight \|\| cardRect\?\.height \|\| 0,\s*width: card\?\.offsetWidth \|\| cardRect\?\.width \|\| 0,\s*\};/,
);
assert.doesNotMatch(
  appSource,
  /if \(!card\) \{\s*setFloatingNotePanelPosition\(null\);\s*return;\s*\}/,
);
assert.match(
  appSource,
  /function updateFloatingNotePanelPosition\(\) \{\s*window\.cancelAnimationFrame\(floatingNotePanelPositionFrameRef\.current\);\s*floatingNotePanelPositionFrameRef\.current = window\.requestAnimationFrame\(\s*measureFloatingNotePanelPosition,\s*\);\s*\}\s*measureFloatingNotePanelPosition\(\);\s*window\.addEventListener\("resize", updateFloatingNotePanelPosition\);/,
);
assert.match(
  appSource,
  /function floatingNoteEditableFromTarget[\s\S]*?\.floating-note-panel:not\(\.is-expanded-sidebar\)/,
);
assert.match(
  appSource,
  /function captureFloatingNoteScrollPosition[\s\S]*?event\.type === "focusin" && floatingNoteScrollLock[\s\S]*?top: editorPane\.scrollTop/,
);
assert.match(
  appSource,
  /function restoreFloatingNoteScrollPosition[\s\S]*?lock\.editorPane\.scrollTop = lock\.top[\s\S]*?window\.scrollTo\(lock\.windowX, lock\.windowY\)/,
);
assert.match(
  appSource,
  /if \(floatingNoteScrollLock\) \{[\s\S]*?keepFloatingNoteScrollPosition\(\)/,
);
assert.match(
  appSource,
  /document\.addEventListener\("pointerdown", captureFloatingNoteScrollPosition, true\)[\s\S]*?document\.addEventListener\("focusin", captureFloatingNoteScrollPosition, true\)/,
);

console.log("floating note anchor position regression: PASS");
