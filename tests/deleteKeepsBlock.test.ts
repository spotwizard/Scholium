import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { deleteSelectionKeepingBlock } from "../src/milkdownDeleteKeepsBlock.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function paragraphs(...texts: string[]) {
  return schema.node(
    "doc",
    null,
    texts.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : [])),
  );
}

function stateWithSelection(doc: ReturnType<typeof paragraphs>, from: number, to: number) {
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
}

test("deleting whole paragraphs leaves an empty paragraph where they were", () => {
  // "one" 1..4, "two" 6..9, "three" 11..16
  const state = stateWithSelection(paragraphs("one", "two", "three", "four"), 6, 16);
  const transaction = deleteSelectionKeepingBlock(state);
  assert.ok(transaction);
  const texts: string[] = [];
  transaction.doc.forEach((node) => texts.push(node.textContent));
  assert.deepEqual(texts, ["one", "", "four"]);
  assert.equal(transaction.selection.from, 6);
});

test("a selection inside one paragraph is left to the default delete", () => {
  const state = stateWithSelection(paragraphs("hello"), 2, 4);
  assert.equal(deleteSelectionKeepingBlock(state), null);
});

test("a collapsed caret is not handled", () => {
  const state = stateWithSelection(paragraphs("one", "two"), 2, 2);
  assert.equal(deleteSelectionKeepingBlock(state), null);
});
