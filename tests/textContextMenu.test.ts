import assert from "node:assert/strict";
import { createTextContextMenu } from "../src/textContextMenu.ts";
import type { InsertableFile } from "../src/fileInsertion.ts";

let inEditor = true;
Object.defineProperty(globalThis, "document", { configurable: true, value: { elementFromPoint: () => ({ closest: () => inEditor }) } });
let current = { id: "one", path: "/notes/one.md" as string | null, source: "local" as const };
let inserted: InsertableFile | null = null;
let error = "";
let editable = true;
let resolveNames: (names: string[]) => void = () => {};
const menu = createTextContextMenu(
  () => current,
  () => ({ getSelectionSnapshot: () => null, prepareFileInsertion: () => editable ? (file) => { inserted = file; return true; } : null }),
  () => new Promise((resolve) => { resolveNames = resolve; }),
  (message) => { error = message; },
);
inEditor = false;
assert.equal(menu.prepare(0, 0), null);
inEditor = true;
const ready = menu.prepare(0, 0)!;
assert.equal(ready.canInsert, true);
const loading = menu.files(ready.request);
resolveNames(["中文.md", "image.png"]);
assert.deepEqual((await loading).names, ["中文.md", "image.png"]);
menu.insert(ready.request, 0);
assert.deepEqual(inserted, { name: "中文.md", href: "%E4%B8%AD%E6%96%87.md" });
inserted = null;
menu.insert(ready.request, 1);
assert.equal(inserted, null, "the same menu cannot insert twice");
const stale = menu.prepare(0, 0)!;
const staleLoading = menu.files(stale.request);
current = { ...current, id: "two" };
resolveNames(["wrong.md"]);
assert.equal((await staleLoading).names.length, 0);
menu.insert(stale.request, 0);
assert.equal(inserted, null);
current = { ...current, path: null };
assert.equal(menu.prepare(0, 0)!.message, "請先儲存目前檔案");
current = { ...current, path: "/notes/two.md" };
editable = false;
assert.equal(menu.prepare(0, 0)!.canInsert, false);
assert.equal(error, "");
delete (globalThis as { document?: unknown }).document;
console.log("text context menu scope, loading, drafts, readonly and stale requests: PASS");
