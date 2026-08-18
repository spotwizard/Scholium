import assert from "node:assert/strict";
import {
  localMarkdownImageNeedsHydration,
  resolveMarkdownLinkTarget,
} from "../src/markdownLinkTarget.ts";

assert.deepEqual(
  resolveMarkdownLinkTarget("search.md", "/notes/AGENTS.md", "local"),
  { kind: "document", path: "/notes/search.md" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("../shared/file%20name.md#section", "/notes/work/AGENTS.md", "local"),
  { kind: "document", path: "/notes/work/../shared/file name.md" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("C:\\notes\\search.md", "C:\\notes\\AGENTS.md", "local"),
  { kind: "document", path: "C:\\notes\\search.md" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("../shared.md", "/notes/work/AGENTS.md", "dropbox"),
  { kind: "document", path: "/notes/shared.md" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("tauri://localhost/search.md", "/notes/AGENTS.md", "local"),
  { kind: "document", path: "/notes/search.md" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("https://example.com/guide", "/notes/AGENTS.md", "local"),
  { kind: "external", href: "https://example.com/guide" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("mailto:editor@example.com", "/notes/AGENTS.md", "local"),
  { kind: "external", href: "mailto:editor@example.com" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("#section", "/notes/AGENTS.md", "local"),
  { kind: "fragment", href: "#section" },
);
assert.deepEqual(
  resolveMarkdownLinkTarget("javascript:alert(1)", "/notes/AGENTS.md", "local"),
  { kind: "unsupported" },
);

assert.equal(localMarkdownImageNeedsHydration("images/photo.png"), true);
assert.equal(localMarkdownImageNeedsHydration(" ../photo.png "), true);
assert.equal(localMarkdownImageNeedsHydration("https://example.com/photo.png"), false);
assert.equal(localMarkdownImageNeedsHydration("data:image/png;base64,AAAA"), false);
assert.equal(localMarkdownImageNeedsHydration("//cdn.example.com/photo.png"), false);
assert.equal(localMarkdownImageNeedsHydration("   "), false);

console.log("markdown link target regression: PASS");
