import assert from "node:assert/strict";
import { Fragment, Schema, Slice, type Mark } from "@milkdown/prose/model";
import { EditorState } from "@milkdown/prose/state";
import { createPastedInlineMarkBoundaryPlugin } from "../src/milkdownPastedInlineMarkBoundary.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    text: { group: "inline" },
  },
  marks: {
    link: {
      attrs: { href: {} },
      parseDOM: [],
      toDOM: (mark) => ["a", { href: mark.attrs.href }, 0],
    },
    inlineCode: {
      code: true,
      parseDOM: [],
      toDOM: () => ["code", 0],
    },
  },
});

function pasteThenType(mark: Mark) {
  const plugin = createPastedInlineMarkBoundaryPlugin();
  let state = EditorState.create({ schema, plugins: [plugin] });

  plugin.props.handlePaste?.call(
    plugin,
    { state } as never,
    {} as ClipboardEvent,
    Slice.empty,
  );
  const pasted = state.applyTransaction(
    state.tr.replaceSelection(new Slice(Fragment.from(schema.text("X", [mark])), 0, 0)),
  );
  state = pasted.state.apply(pasted.state.tr.insertText("Y"));

  const paragraph = state.doc.firstChild;
  assert.ok(paragraph);
  assert.equal(paragraph.childCount, 2);
  assert.equal(paragraph.child(0).text, "X");
  assert.ok(mark.type.isInSet(paragraph.child(0).marks));
  assert.equal(paragraph.child(1).text, "Y");
  assert.equal(mark.type.isInSet(paragraph.child(1).marks), undefined);
}

pasteThenType(schema.marks.link.create({ href: "https://example.com" }));
pasteThenType(schema.marks.inlineCode.create());

console.log("milkdown pasted inline mark boundary regression: PASS");
