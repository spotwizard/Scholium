import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { caretIsOnInlineCodeEdge } from "../src/milkdownInlineCodeVerticalMove.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
  marks: { inlineCode: {} },
});

// "ab" + code("cd") + "ef" occupies positions 1..7 inside the paragraph.
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("ab"),
    schema.text("cd", [schema.marks.inlineCode.create()]),
    schema.text("ef"),
  ]),
]);

function stateAt(anchor: number, head = anchor) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, anchor, head),
  });
}

test("the caret before and after an inline code span is on its edge", () => {
  assert.equal(caretIsOnInlineCodeEdge(stateAt(3)), true);
  assert.equal(caretIsOnInlineCodeEdge(stateAt(5)), true);
});

test("the caret in plain text or inside the span is not on its edge", () => {
  assert.equal(caretIsOnInlineCodeEdge(stateAt(1)), false);
  assert.equal(caretIsOnInlineCodeEdge(stateAt(4)), false);
  assert.equal(caretIsOnInlineCodeEdge(stateAt(7)), false);
});

test("a range selection is never treated as an edge", () => {
  assert.equal(caretIsOnInlineCodeEdge(stateAt(3, 5)), false);
});
