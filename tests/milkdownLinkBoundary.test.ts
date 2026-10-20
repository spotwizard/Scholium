import assert from "node:assert/strict";
import { Ctx, Container, Clock } from "@milkdown/kit/ctx";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { Schema } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { closeHistory, history, redo, undo } from "@milkdown/prose/history";
import { configureLinkBoundary } from "../src/milkdownLinkBoundary.ts";
import { previewFileInsertion, siblingFileLink } from "../src/fileInsertion.ts";

const ctx = new Ctx(new Container(), new Clock());
ctx.inject(linkSchema.key);
configureLinkBoundary(ctx);
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block" },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*" },
    text: { group: "inline" },
  },
  marks: { link: ctx.get(linkSchema.key)(ctx) },
});
const file = siblingFileLink("應付單據-匯款給廠商.mov");
const isLink = (node: ReturnType<typeof schema.text>) => Boolean(schema.marks.link.isInSet(node.marks));

for (const layout of ["paragraph", "heading", "list"] as const) {
  const paragraph = schema.node(layout === "heading" ? "heading" : "paragraph", null, schema.text("根據 "));
  const block = layout === "list" ? schema.node("bullet_list", null, [schema.node("list_item", null, [paragraph])]) : paragraph;
  let state = EditorState.create({ doc: schema.node("doc", null, [block]), plugins: [history()] });
  const dispatch = (transaction: Parameters<EditorState["apply"]>[0]) => { state = state.apply(transaction); };
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  state = state.apply(previewFileInsertion(state, file)!);
  state = state.apply(closeHistory(state.tr));
  const linkedDocument = state.doc.toJSON();
  const linkEnd = state.selection.from;

  // Returning to the end clears transient stored marks, just like native caret updates.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, linkEnd - 1)));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, linkEnd)));
  state = state.apply(state.tr.insertText("   影片"));
  let tail = state.selection.$from.parent.lastChild!;
  assert.equal(tail.text, "   影片", layout);
  assert.equal(isLink(tail), false, layout);
  assert.ok(undo(state, dispatch));
  assert.deepEqual(state.doc.toJSON(), linkedDocument);
  assert.ok(redo(state, dispatch));
  assert.equal(isLink(state.selection.$from.parent.lastChild!), false);

  // Reloading an existing file must use the same permanent boundary behavior.
  state = EditorState.create({ schema, doc: schema.nodeFromJSON(linkedDocument) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, linkEnd)));
  state = state.apply(state.tr.insertText(" "));
  assert.equal(isLink(state.selection.$from.parent.lastChild!), false);

  // Editing inside the link preserves both its mark and destination.
  state = EditorState.create({ schema, doc: schema.nodeFromJSON(linkedDocument) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, linkEnd - 1)));
  state = state.apply(state.tr.insertText("X"));
  tail = state.selection.$from.parent.lastChild!;
  assert.equal(isLink(tail), true);
  assert.equal(tail.marks[0].attrs.href, file.href);
}

console.log("actual Milkdown link schema: boundary spaces, caret return, reload, undo/redo and inner editing: PASS");
