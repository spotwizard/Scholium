import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sortWorkspaceEntriesForDirectory } from "../src/workspaceSort.ts";

const entries = [
  { kind: "directory" as const, path: "/z", title: "Zeta", modifiedAt: 300, depth: 1 },
  { kind: "file" as const, path: "/z/b.md", title: "Beta", modifiedAt: 400, depth: 2 },
  { kind: "file" as const, path: "/z/a.md", title: "Alpha", modifiedAt: 200, depth: 2 },
  { kind: "directory" as const, path: "/a", title: "Alpha", modifiedAt: 100, depth: 1 },
  { kind: "file" as const, path: "/new.md", title: "Newest", modifiedAt: 500, depth: 1 },
  { kind: "file" as const, path: "/old.md", title: "Oldest", modifiedAt: 50, depth: 1 },
];

assert.deepEqual(
  sortWorkspaceEntriesForDirectory(entries).map((entry) => entry.path),
  ["/a", "/z", "/z/a.md", "/z/b.md", "/new.md", "/old.md"],
  "name must be the default while preserving directory hierarchy and directory-first grouping",
);

assert.deepEqual(
  sortWorkspaceEntriesForDirectory(entries, "modified").map((entry) => entry.path),
  ["/z", "/z/b.md", "/z/a.md", "/a", "/new.md", "/old.md"],
  "modified mode must sort newest first within each entry kind",
);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(
  appSource,
  /useState<WorkspaceSortMode>\("name"\)/,
  "the visible workspace sort must default to name",
);
assert.match(
  appSource,
  /className="workspace-sort-control"[\s\S]*?<option value="name">[\s\S]*?<option value="modified">/,
  "the left sidebar must expose both requested sort choices",
);
assert.match(
  appSource,
  /setWorkspaceEntries\(\(entries\) =>\s*sortWorkspaceEntriesForDirectory\(entries, nextMode\)/,
  "changing the selector must immediately reorder the visible workspace",
);

console.log("workspace sort regression: PASS");
