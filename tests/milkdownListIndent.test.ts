import assert from "node:assert/strict";
import { Schema } from "@milkdown/prose/model";
import { bulletList, listItem } from "@milkdown/prose/schema-list";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { sinkSingleListItem } from "../src/milkdownListIndent.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: { ...listItem, content: "paragraph block*" },
  },
});

const paragraph = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
const item = (text: string, children: ReturnType<typeof item>[] = []) =>
  schema.nodes.list_item.create(
    null,
    children.length > 0
      ? [paragraph(text), schema.nodes.bullet_list.create(null, children)]
      : [paragraph(text)],
  );

const document = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("型態"),
    item("採用旅遊報導", [item("參考真實旅遊雜誌")]),
    item("參考資料範圍", [item("使用者輸入"), item("不得自行搜尋")]),
  ]),
]);

let cursorPosition = -1;
document.descendants((node, position) => {
  if (node.isText && node.text === "採用旅遊報導") {
    cursorPosition = position + 1;
  }
});
assert.notEqual(cursorPosition, -1);

const state = EditorState.create({
  doc: document,
  selection: TextSelection.create(document, cursorPosition),
});
let nextState = state;
const handled = sinkSingleListItem(schema.nodes.list_item)(
  state,
  (transaction) => {
    nextState = state.apply(transaction);
  },
);

assert.equal(handled, true);
assert.equal(nextState.selection.$from.parent.textContent, "採用旅遊報導");
assert.deepEqual(nextState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "型態" }] },
            {
              type: "bullet_list",
              content: [
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "採用旅遊報導" }],
                    },
                  ],
                },
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "參考真實旅遊雜誌" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "參考資料範圍" }],
            },
            {
              type: "bullet_list",
              content: [
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "使用者輸入" }],
                    },
                  ],
                },
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "不得自行搜尋" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
