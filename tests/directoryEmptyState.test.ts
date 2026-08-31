import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const toggleDirectoryStart = app.indexOf("async function toggleWorkspaceDirectory");
const toggleDirectoryEnd = app.indexOf("async function openDroppedMarkdownPaths", toggleDirectoryStart);

assert(toggleDirectoryStart >= 0 && toggleDirectoryEnd > toggleDirectoryStart);
const toggleWorkspaceDirectory = app.slice(toggleDirectoryStart, toggleDirectoryEnd);

assert.doesNotMatch(
  app,
  /setStorageError\(t\("(?:status\.noFoldersOrMarkdown|dropbox\.emptyFolder)"\)\)/,
  "empty folders should not use the global storage feedback surface",
);

assert.doesNotMatch(
  app,
  /transientStorageStatus/,
  "empty-folder feedback should no longer depend on a transient dismissal timer",
);

assert.doesNotMatch(
  toggleWorkspaceDirectory,
  /(?:status\.openingFolder|dropbox\.status\.openingFolder)/,
  "expanding a folder should never write folder-loading feedback to the global status surface",
);

assert.match(
  toggleWorkspaceDirectory,
  /setLoadingDirectoryKeys\(\(currentKeys\) => new Set\(currentKeys\)\.add\(entryKey\)\);\s*setStorageError\(""\);\s*try \{/,
  "folder expansion should use its row loading state while keeping the global status surface empty",
);

assert.match(
  toggleWorkspaceDirectory,
  /if \(entry\.source === "dropbox"\)[\s\S]*?listDropboxMarkdownDirectory[\s\S]*?else \{[\s\S]*?openMarkdownDirectory/,
  "the same no-global-loading invariant should cover Dropbox and local directory expansion",
);

assert.match(
  app,
  /if \(childEntries\.length === 0\) \{\s*setExpandedDirectoryKeys\(\(currentKeys\) => new Set\(currentKeys\)\.add\(entryKey\)\);\s*setStorageError\(""\);/,
  "an empty child directory should stay expanded without showing a global error",
);

assert.match(
  app,
  /const isExpandedDirectoryEmpty =[\s\S]*?isDirectory &&[\s\S]*?isExpanded &&[\s\S]*?!fileSearchActive/,
  "expanded empty directories should be identified inside the normal file list",
);

assert.match(
  app,
  /className="directory-empty-state" role="status"[\s\S]*?entry\.source === "dropbox"[\s\S]*?dropbox\.emptyFolder[\s\S]*?status\.noFoldersOrMarkdown/,
  "empty child directories should render their source-specific message in the file panel",
);

assert.match(
  app,
  /workspaceSource &&\s*workspaceEntries\.length === 0[\s\S]*?className="directory-empty-state is-root" role="status"/,
  "an empty workspace root should render its message in the file panel",
);

console.log("directory empty state regression: PASS");
