import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  containWheelInPanel,
  panelScrollTargetCanConsumeWheel,
} from "../src/expandedPanelWheel.ts";

function wheelEvent(deltaY: number) {
  let defaultPrevented = false;
  let propagationStopped = false;

  return {
    event: {
      deltaMode: 0,
      deltaX: 0,
      deltaY,
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      },
    },
    state: () => ({ defaultPrevented, propagationStopped }),
  };
}

const scrollablePanel = {
  clientHeight: 300,
  clientWidth: 400,
  scrollHeight: 900,
  scrollLeft: 0,
  scrollTop: 120,
  scrollWidth: 400,
};
const scrolling = wheelEvent(80);

containWheelInPanel(scrolling.event, scrollablePanel);

assert.equal(scrollablePanel.scrollTop, 200);
assert.deepEqual(scrolling.state(), {
  defaultPrevented: true,
  propagationStopped: true,
});

const nonOverflowingPanel = {
  clientHeight: 300,
  clientWidth: 400,
  scrollHeight: 300,
  scrollLeft: 0,
  scrollTop: 0,
  scrollWidth: 400,
};
const containedAtBoundary = wheelEvent(80);

containWheelInPanel(containedAtBoundary.event, nonOverflowingPanel);

assert.equal(nonOverflowingPanel.scrollTop, 0);
assert.deepEqual(containedAtBoundary.state(), {
  defaultPrevented: true,
  propagationStopped: true,
});

const overflowingButNotScrollable = {
  ...scrollablePanel,
  scrollTop: 0,
};
const targetSelectionWheel = wheelEvent(80);

assert.equal(
  panelScrollTargetCanConsumeWheel(targetSelectionWheel.event, overflowingButNotScrollable, {
    overflowX: "visible",
    overflowY: "visible",
  }),
  false,
  "overflowing content with overflow: visible is not a scroll container",
);
assert.equal(
  panelScrollTargetCanConsumeWheel(targetSelectionWheel.event, overflowingButNotScrollable, {
    overflowX: "hidden",
    overflowY: "auto",
  }),
  true,
  "the actual overflow-y: auto panel body must receive the wheel",
);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

assert.match(
  appSource,
  /addEventListener\("wheel",\s*handleExpandedFloatingNoteWheel,\s*\{ passive: false \}\)/,
  "expanded floating note must use a non-passive native wheel listener",
);

const floatingBodyScrollResetDependencies = appSource.match(
  /useEffect\(\(\) => \{[\s\S]*?bodyShell\.scrollTop = 0;[\s\S]*?\}, \[([^\]]+)\]\);/,
)?.[1];

assert.ok(
  floatingBodyScrollResetDependencies,
  "floating note body may reset to the top only when its content changes",
);
assert.match(floatingBodyScrollResetDependencies, /activeFloatingNoteKey/);
assert.doesNotMatch(
  floatingBodyScrollResetDependencies,
  /floatingNotePanelExpanded/,
  "collapsing or reopening the same note must preserve its internal scroll position",
);

console.log("expanded panel wheel containment regression: PASS");
