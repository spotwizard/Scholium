import assert from "node:assert/strict";
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
    targetBottom: 390,
    targetX: 410,
  },
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
    targetBottom: 540,
    targetX: 790,
  },
  cardWidth: 360,
  viewportMargin: 12,
  viewportRect,
});

assert.equal(nearRightEdge.placement, "below");
assert.equal(nearRightEdge.left, 448);
assert.equal(nearRightEdge.top, 558);
assert.ok(nearRightEdge.top + 260 > viewportRect.bottom);
assert.ok(nearRightEdge.connector.width > 0);

console.log("floating note anchor position regression: PASS");
