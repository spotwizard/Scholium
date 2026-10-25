import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

// An empty item with a sub-list is a line the writer kept (Tab moves the next
// line under it), so its bullet and empty line stay visible.
assert.doesNotMatch(
  styles,
  /\.milkdown-list-item-block:has\([\s\S]*?p:first-child[\s\S]*?br\.ProseMirror-trailingBreak:only-child/,
);

console.log("Milkdown empty parent bullet regression: PASS");
