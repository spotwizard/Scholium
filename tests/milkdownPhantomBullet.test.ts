import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(
  styles,
  /\.milkdown-list-item-block:has\([\s\S]*?p:first-child:not\(\.is-empty-list-line-with-caret\)[\s\S]*?br\.ProseMirror-trailingBreak:only-child[\s\S]*?\):has\(> \.list-item > \.children > \.content-dom > :is\(ul, ol\)\)[\s\S]*?> \.label-wrapper:has\(\.label\.bullet\) \{\s*visibility: hidden;/,
);
assert.match(
  styles,
  /\.milkdown-list-item-block:has\([\s\S]*?p:first-child:not\(\.is-empty-list-line-with-caret\)[\s\S]*?br\.ProseMirror-trailingBreak:only-child[\s\S]*?\):has\(> \.list-item > \.children > \.content-dom > :is\(ul, ol\)\)[\s\S]*?> \.content-dom[\s\S]*?> p:first-child \{\s*display: none;/,
);

console.log("Milkdown phantom bullet regression: PASS");
