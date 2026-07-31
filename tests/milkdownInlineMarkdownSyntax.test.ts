import assert from "node:assert/strict";
import { Schema } from "@milkdown/prose/model";
import { bulletList, listItem } from "@milkdown/prose/schema-list";
import { EditorState } from "@milkdown/prose/state";
import { normalizeListItemInlineStrongSyntaxTransaction } from "../src/milkdownInlineMarkdownSyntax.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: { ...listItem, content: "paragraph block*" },
  },
  marks: {
    strong: {
      attrs: { marker: { default: "*" } },
      parseDOM: [{ tag: "strong" }],
      toDOM: () => ["strong", 0],
    },
  },
});

const listItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [
      schema.nodes.paragraph.create(null, schema.text("**README.md： **專案首頁")),
    ]),
  ]),
]);
const listItemState = EditorState.create({ doc: listItemDocument, schema });
const listItemTransaction =
  normalizeListItemInlineStrongSyntaxTransaction(listItemState);

assert.ok(listItemTransaction);
const listItemNextState = listItemState.apply(listItemTransaction);
const listItemParagraph = listItemNextState.doc.child(0).child(0).child(0);
assert.equal(listItemParagraph.textContent, "README.md： 專案首頁");
assert.equal(listItemParagraph.child(0).text, "README.md：");
assert.equal(listItemParagraph.child(0).marks[0]?.type.name, "strong");
assert.equal(listItemParagraph.child(1).text, " 專案首頁");
assert.equal(listItemParagraph.child(1).marks.length, 0);

const paragraphDocument = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, schema.text("**README.md：** 專案首頁")),
]);
const paragraphState = EditorState.create({ doc: paragraphDocument, schema });

assert.equal(
  normalizeListItemInlineStrongSyntaxTransaction(paragraphState),
  null,
);

console.log("milkdown list item inline markdown syntax regression: PASS");
