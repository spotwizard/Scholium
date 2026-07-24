import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const compactDesktopRule = css.match(
  /@media \(max-width: 1180px\)[\s\S]*?\.scholium-shell:not\(\.is-mobile-safe-layout\)\s+\.floating-note-panel:not\(\.is-expanded-sidebar\) \{([\s\S]*?)\n\s*\}/,
);

assert.ok(compactDesktopRule, "compact desktop floating-note rule must exist");

const compactWidth = Number(
  compactDesktopRule[1].match(/--floating-note-panel-collapsed-width:\s*(\d+)px/)?.[1],
);
const compactPreviewLines = Number(
  compactDesktopRule[1].match(
    /--floating-note-card-body-preview-height:\s*calc\((\d+) \* 1\.5em\)/,
  )?.[1],
);
const reportedCssViewportWidth = 1024 / 1.25;

assert.ok(compactWidth > 0);
assert.ok(compactWidth / reportedCssViewportWidth <= 0.45);
assert.ok(compactPreviewLines > 0 && compactPreviewLines <= 7);
assert.match(
  css,
  /width:\s*min\(var\(--floating-note-panel-collapsed-width\),\s*calc\(100vw - 24px\)\)/,
);
assert.match(
  css,
  /--note-markdown-editor-max-height:\s*var\(--floating-note-card-body-preview-height\)/,
);
assert.match(
  css,
  /\.floating-note-card__body-shell \{[\s\S]*?--floating-note-card-body-visible-height:\s*var\(--floating-note-card-body-preview-height\)/,
);
assert.match(
  css,
  /\.floating-note-card > \.bottom-note-body \{[\s\S]*?max-height:\s*var\(--floating-note-card-body-preview-height\)/,
);
assert.match(
  css,
  /\.floating-note-card \{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/,
);
assert.doesNotMatch(
  appSource,
  /has-floating-note-panel/,
);
assert.doesNotMatch(
  css,
  /\.scholium-shell\.has-floating-note-panel/,
);

assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout \.note-edit-backdrop \{[\s\S]*?z-index:\s*65;[\s\S]*?background:\s*transparent;/,
);
assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout\.is-note-panel-modal-active \.editor-content-frame::after \{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*65;[\s\S]*?background:\s*rgba\(33,\s*37,\s*43,\s*0\.32\);[\s\S]*?pointer-events:\s*none;/,
);
assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout\.is-note-panel-modal-active \.cm-annotation-layer,[\s\S]*?\.milkdown-annotation-layer,[\s\S]*?\{\s*z-index:\s*66;/,
);
assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout\.is-note-panel-modal-active[\s\S]*?\.milkdown-note-annotation\.is-focus-target \{[\s\S]*?z-index:\s*67;/,
);
assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout \.floating-note-connector \{[\s\S]*?z-index:\s*68;/,
);
assert.match(
  css,
  /\.scholium-shell\.is-mobile-safe-layout \.floating-note-panel:not\(\.is-expanded-sidebar\) \{[\s\S]*?z-index:\s*69;/,
);
assert.match(
  css,
  /\.mobile-editor-mode-toggle \{[\s\S]*?z-index:\s*74;/,
);
assert.match(
  css,
  /\.document-search \{[\s\S]*?z-index:\s*74;/,
);
assert.match(
  css,
  /\.mobile-command-bar \{[\s\S]*?z-index:\s*82;/,
);

console.log("floating note responsive regression: PASS");
