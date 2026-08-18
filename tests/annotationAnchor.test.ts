import assert from "node:assert/strict";
import {
  anchorMatchesBodyText,
  hasRenderableAnchor,
  makeAnchorFromRange,
  normalizeSelectionTextForComparison,
  refreshAnchor,
  textEditFromBodyChange,
  textSelectionAnchorsMatch,
  transformAnchorRangeWithTextEdits,
} from "../src/annotationAnchor.ts";
import type { TextSelectionAnchor } from "../src/editorTypes.ts";

const unicodeBody = `${"a".repeat(60)}😀e\u0301${"b".repeat(60)}`;
const unicodeAnchor = makeAnchorFromRange(unicodeBody, 60, 64);
assert.deepEqual(unicodeAnchor, {
  from: 60,
  to: 64,
  selectedText: "😀e\u0301",
  prefix: "a".repeat(48),
  suffix: "b".repeat(48),
});
assert.equal(makeAnchorFromRange("target-tail", 0, 6).prefix, "");
assert.equal(makeAnchorFromRange("head-target", 5, 11).suffix, "");
assert.equal(makeAnchorFromRange("abc", 1, 2, "explicit").selectedText, "explicit");
assert.deepEqual(
  refreshAnchor(unicodeBody, { ...unicodeAnchor, prefix: "stale", suffix: "stale" }),
  unicodeAnchor,
);

const splitSurrogateContext = makeAnchorFromRange(`😀${"a".repeat(47)}target`, 49, 55);
assert.equal(splitSurrogateContext.prefix.length, 48);
assert.equal(splitSurrogateContext.prefix.charCodeAt(0), 0xde00);

assert.equal(normalizeSelectionTextForComparison("  one\u00a0 two\nthree  "), "one two three");
assert.equal(hasRenderableAnchor(unicodeAnchor), true);
assert.equal(hasRenderableAnchor({ ...unicodeAnchor, to: unicodeAnchor.from }), false);
assert.equal(anchorMatchesBodyText("a\n\tb", makeAnchorFromRange("a\n\tb", 0, 4, "a b")), true);
assert.equal(anchorMatchesBodyText("x", makeAnchorFromRange("x", 0, 1, " \n")), true);
assert.equal(
  anchorMatchesBodyText("x", makeAnchorFromRange("x", 0, 0, "")),
  false,
);

assert.equal(
  textSelectionAnchorsMatch(
    { from: 1, to: 4, selectedText: "a\nb", prefix: "left", suffix: "context" },
    { from: 1, to: 4, selectedText: "a b", prefix: "other", suffix: "values" },
  ),
  true,
);
assert.equal(
  textSelectionAnchorsMatch(
    { from: 1, to: 4, selectedText: "a b", prefix: "", suffix: "" },
    { from: 2, to: 4, selectedText: "a b", prefix: "", suffix: "" },
  ),
  false,
);

assert.equal(textEditFromBodyChange("abc", "abc"), null);
assert.deepEqual(textEditFromBodyChange("abc", "abXc"), { from: 2, to: 2, insert: "X" });
assert.deepEqual(textEditFromBodyChange("abc", "ac"), { from: 1, to: 2, insert: "" });
assert.deepEqual(textEditFromBodyChange("abc", "aXc"), { from: 1, to: 2, insert: "X" });

const emojiEdit = textEditFromBodyChange("A😀B", "A😃B");
assert.deepEqual(emojiEdit, { from: 2, to: 3, insert: "\ude03" });
assert.ok(emojiEdit);
assert.equal(`A😀B`.slice(0, emojiEdit.from) + emojiEdit.insert + `A😀B`.slice(emojiEdit.to), "A😃B");

const baseAnchor: TextSelectionAnchor = {
  from: 2,
  to: 5,
  selectedText: "cde",
  prefix: "ab",
  suffix: "fg",
};
const transformedRange = (edit: { from: number; to: number; insert: string }) => {
  const nextBodyLength = 7 - (edit.to - edit.from) + edit.insert.length;
  const transformed = transformAnchorRangeWithTextEdits(baseAnchor, nextBodyLength, [edit]);
  return [transformed.from, transformed.to];
};

assert.deepEqual(transformedRange({ from: 1, to: 1, insert: "X" }), [3, 6]);
assert.deepEqual(transformedRange({ from: 2, to: 2, insert: "X" }), [3, 6]);
assert.deepEqual(transformedRange({ from: 3, to: 3, insert: "X" }), [2, 6]);
assert.deepEqual(transformedRange({ from: 5, to: 5, insert: "X" }), [2, 5]);
assert.deepEqual(transformedRange({ from: 6, to: 6, insert: "X" }), [2, 5]);
assert.deepEqual(transformedRange({ from: 1, to: 3, insert: "" }), [1, 3]);
assert.deepEqual(transformedRange({ from: 2, to: 5, insert: "XY" }), [2, 2]);

const multipleEdits = transformAnchorRangeWithTextEdits(
  { ...baseAnchor, from: 4, to: 8 },
  10,
  [
    { from: 1, to: 1, insert: "XY" },
    { from: 5, to: 7, insert: "" },
  ],
);
assert.deepEqual([multipleEdits.from, multipleEdits.to], [6, 8]);

const markerAnchor = makeAnchorFromRange("word", 0, 4);
const markedAnchor = transformAnchorRangeWithTextEdits(markerAnchor, 8, [
  { from: 0, to: 0, insert: "**" },
  { from: 4, to: 4, insert: "**" },
]);
assert.deepEqual([markedAnchor.from, markedAnchor.to], [2, 6]);
const unmarkedAnchor = transformAnchorRangeWithTextEdits(
  makeAnchorFromRange("**word**", 2, 6),
  4,
  [
    { from: 0, to: 2, insert: "" },
    { from: 6, to: 8, insert: "" },
  ],
);
assert.deepEqual([unmarkedAnchor.from, unmarkedAnchor.to], [0, 4]);

const previousBody = "before target after";
const nextBody = "new before target after";
const bodyEdit = textEditFromBodyChange(previousBody, nextBody);
assert.ok(bodyEdit);
const bodyAnchor = makeAnchorFromRange(
  previousBody,
  previousBody.indexOf("target"),
  previousBody.indexOf("target") + "target".length,
);
const transformedBodyAnchor = transformAnchorRangeWithTextEdits(bodyAnchor, nextBody.length, [
  bodyEdit,
]);
assert.deepEqual(
  [transformedBodyAnchor.from, transformedBodyAnchor.to],
  [nextBody.indexOf("target"), nextBody.indexOf("target") + "target".length],
);

console.log("annotation anchor behavior: PASS");
