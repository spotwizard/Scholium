import assert from "node:assert/strict";
import { Schema, type Node as ProseMirrorNode } from "@milkdown/prose/model";
import { bulletList, listItem } from "@milkdown/prose/schema-list";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { serializeMarkedTextClipboardSlice } from "../src/markdownClipboard.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: { ...listItem, content: "paragraph block*" },
  },
  marks: {
    inlineCode: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
  },
});

const paragraph = (...content: ReturnType<typeof schema.text>[]) =>
  schema.nodes.paragraph.create(null, content);
const item = (
  content: ReturnType<typeof schema.text>[],
  children: ProseMirrorNode[] = [],
): ProseMirrorNode =>
  schema.nodes.list_item.create(
    null,
    children.length > 0
      ? [
          paragraph(...content),
          schema.nodes.bullet_list.create(null, children),
        ]
      : [paragraph(...content)],
  );
const inlineCode = schema.marks.inlineCode.create();
const serializeJson = (node: Parameters<typeof JSON.stringify>[0]) =>
  JSON.stringify((node as { toJSON: () => unknown }).toJSON());
const editorViewForState = (state: EditorState) => ({ state }) as EditorView;

const documentWithFormattedItem = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item([
      schema.text("研讀 "),
      schema.text("data", [inlineCode]),
      schema.text(" 目錄"),
    ]),
    item([schema.text("不該被複製")]),
  ]),
]);
let codePosition = -1;
documentWithFormattedItem.descendants((node, position) => {
  if (node.isText && node.text === "data") codePosition = position;
});
assert.notEqual(codePosition, -1);

const codeSelectionState = EditorState.create({
  doc: documentWithFormattedItem,
  selection: TextSelection.create(
    documentWithFormattedItem,
    codePosition,
    codePosition + "data".length,
  ),
});
const codeOnlyDocument = JSON.parse(
  serializeMarkedTextClipboardSlice(
    codeSelectionState.selection.content(),
    editorViewForState(codeSelectionState),
    serializeJson,
  ) ?? "null",
);
assert.deepEqual(codeOnlyDocument, {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "inlineCode" }],
          text: "data",
        },
      ],
    },
  ],
});
assert.equal(
  serializeMarkedTextClipboardSlice(
    codeSelectionState.selection.content(),
    editorViewForState(codeSelectionState),
    () => "`data`\n",
  ),
  "`data`",
);

let formattedEndPosition = -1;
documentWithFormattedItem.descendants((node, position) => {
  if (node.isText && node.text === " 目錄") {
    formattedEndPosition = position + node.nodeSize;
  }
});
const partialFormattedState = EditorState.create({
  doc: documentWithFormattedItem,
  selection: TextSelection.create(
    documentWithFormattedItem,
    codePosition,
    formattedEndPosition,
  ),
});
const partialFormattedCopy =
  serializeMarkedTextClipboardSlice(
    partialFormattedState.selection.content(),
    editorViewForState(partialFormattedState),
    serializeJson,
  ) ?? "";
assert.match(partialFormattedCopy, /"text":"data"/);
assert.match(partialFormattedCopy, /"text":" 目錄"/);
assert.doesNotMatch(partialFormattedCopy, /研讀|不該被複製|bullet_list/);

const documentWithCodeParent = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item([schema.text("data", [inlineCode])], [item([schema.text("子項目")])]),
    item([schema.text("後續項目")]),
  ]),
]);
let codeParentPosition = -1;
documentWithCodeParent.descendants((node, position) => {
  if (node.isText && node.text === "data") codeParentPosition = position;
});
const codeParentState = EditorState.create({
  doc: documentWithCodeParent,
  selection: TextSelection.create(
    documentWithCodeParent,
    codeParentPosition,
    codeParentPosition + "data".length,
  ),
});
const codeParentCopy =
  serializeMarkedTextClipboardSlice(
    codeParentState.selection.content(),
    editorViewForState(codeParentState),
    serializeJson,
  ) ?? "";
assert.match(codeParentCopy, /"type":"bullet_list"/);
assert.match(codeParentCopy, /"text":"data"/);
assert.doesNotMatch(codeParentCopy, /子項目|後續項目/);
assert.equal(
  serializeMarkedTextClipboardSlice(
    codeParentState.selection.content(),
    editorViewForState(codeParentState),
    () => "* `data`\n",
  ),
  "* `data`\n",
);

const plainTextState = EditorState.create({
  doc: documentWithFormattedItem,
  selection: TextSelection.create(documentWithFormattedItem, 3, 5),
});
assert.equal(
  serializeMarkedTextClipboardSlice(
    plainTextState.selection.content(),
    editorViewForState(plainTextState),
    serializeJson,
  ),
  null,
);

console.log("markdown clipboard selection boundary regression: PASS");
