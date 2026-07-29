import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { history, redo, undo } from "@milkdown/prose/history";
import { Schema } from "@milkdown/prose/model";
import { bulletList, listItem } from "@milkdown/prose/schema-list";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import {
  deleteAtListItemStart,
  sinkSingleListItem,
} from "../src/milkdownListIndent.ts";

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
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
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

const deletionDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("文章生成驅動方式", [
      item("篩選", [
        item("分析", [item("找出能代表該地點的亮點特色")]),
        item("篩除", [item("刪除重複的資料"), item("刪除")]),
      ]),
      item("文章結構"),
    ]),
  ]),
]);

let deletionCursorPosition = -1;
deletionDocument.descendants((node, position) => {
  if (node.isText && node.text === "分析") {
    deletionCursorPosition = position;
  }
});
assert.notEqual(deletionCursorPosition, -1);

let deletionState = EditorState.create({
  doc: deletionDocument,
  selection: TextSelection.create(deletionDocument, deletionCursorPosition),
  plugins: [history()],
});
const deletionBeforeBackspace = deletionState.doc.toJSON();
const deletionHandled = deleteAtListItemStart(
  schema.nodes.list_item,
  "backward",
)(
  deletionState,
  () => assert.fail("Backspace at the start of a non-empty item must not move it"),
);

assert.equal(deletionHandled, true);
assert.deepEqual(deletionState.doc.toJSON(), deletionBeforeBackspace);

const middleOfItemState = EditorState.create({
  doc: deletionDocument,
  selection: TextSelection.create(deletionDocument, deletionCursorPosition + 1),
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(middleOfItemState),
  false,
  "Backspace handling must only replace the unsafe list-item-start behavior",
);

const nestedDeletionDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("文章生成驅動方式", [
      item("篩選", [
        item("分析：", [item("找出能代表該地點的亮點特色")]),
        item("篩除：", [item("刪除重複的資料"), item("刪除")]),
      ]),
      item("文章結構"),
    ]),
  ]),
]);
let clearedItemTextPosition = -1;
nestedDeletionDocument.descendants((node, position) => {
  if (node.isText && node.text === "分析：") {
    clearedItemTextPosition = position;
  }
});
assert.notEqual(clearedItemTextPosition, -1);

const originalClearedItemDocument = nestedDeletionDocument.toJSON();
let clearedItemState = EditorState.create({
  doc: nestedDeletionDocument,
  plugins: [history()],
});
clearedItemState = clearedItemState.apply(
  clearedItemState.tr.delete(
    clearedItemTextPosition,
    clearedItemTextPosition + "分析：".length,
  ),
);

const topLevelList = clearedItemState.doc.firstChild;
assert.equal(topLevelList?.childCount, 1);
assert.equal(
  clearedItemState.doc.textContent,
  "文章生成驅動方式篩選找出能代表該地點的亮點特色篩除：刪除重複的資料刪除文章結構",
);

let emptyParentPosition = -1;
clearedItemState.doc.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.lastChild?.textContent === "找出能代表該地點的亮點特色"
  ) {
    emptyParentPosition = position + 2;
  }
});
assert.notEqual(emptyParentPosition, -1);

const emptyParentState = clearedItemState.apply(
  clearedItemState.tr.setSelection(
    TextSelection.create(clearedItemState.doc, emptyParentPosition),
  ),
);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    emptyParentState,
    () => assert.fail("An empty item that owns children must remain in place"),
  ),
  true,
);
assert.deepEqual(emptyParentState.doc.toJSON(), clearedItemState.doc.toJSON());

assert.equal(
  undo(clearedItemState, (transaction) => {
    clearedItemState = clearedItemState.apply(transaction);
  }),
  true,
);
assert.deepEqual(clearedItemState.doc.toJSON(), originalClearedItemDocument);

const siblingDeletionDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("篩選", [
      item(""),
      item("篩除：", [item("刪除重複的資料"), item("刪除")]),
    ]),
    item("文章結構"),
  ]),
]);
let emptySiblingPosition = -1;
siblingDeletionDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.childCount === 1
  ) {
    emptySiblingPosition = position + 2;
  }
});
assert.notEqual(emptySiblingPosition, -1);

let siblingDeletionState = EditorState.create({
  doc: siblingDeletionDocument,
  selection: TextSelection.create(siblingDeletionDocument, emptySiblingPosition),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    siblingDeletionState,
    (transaction) => {
      siblingDeletionState = siblingDeletionState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(siblingDeletionState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "篩選" }] },
            {
              type: "bullet_list",
              content: [
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "篩除：" }],
                    },
                    {
                      type: "bullet_list",
                      content: [
                        {
                          type: "list_item",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "刪除重複的資料" }],
                            },
                          ],
                        },
                        {
                          type: "list_item",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "刪除" }],
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
        },
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "文章結構" }],
            },
          ],
        },
      ],
    },
  ],
});
assert.equal(
  undo(siblingDeletionState, (transaction) => {
    siblingDeletionState = siblingDeletionState.apply(transaction);
  }),
  true,
);
assert.deepEqual(siblingDeletionState.doc.toJSON(), siblingDeletionDocument.toJSON());

let forwardDeletePosition = -1;
deletionDocument.descendants((node, position) => {
  if (node.isText && node.text === "篩除") {
    forwardDeletePosition = position;
  }
});
assert.notEqual(forwardDeletePosition, -1);
let forwardDeleteState = EditorState.create({
  doc: deletionDocument,
  selection: TextSelection.create(deletionDocument, forwardDeletePosition),
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "forward")(
    forwardDeleteState,
    (transaction) => {
      forwardDeleteState = forwardDeleteState.apply(transaction);
    },
  ),
  true,
);
assert.equal(forwardDeleteState.selection.$from.parent.textContent, "除");
assert.equal(
  forwardDeleteState.doc.textContent,
  deletionDocument.textContent.replace("篩除", "除"),
);

const editorSource = readFileSync(
  fileURLToPath(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url)),
  "utf8",
);
assert.match(editorSource, /event\.key\.toLowerCase\(\) !== "z"/);
assert.match(editorSource, /!event\.ctrlKey/);
assert.match(editorSource, /const command = shouldRedo \? redo : undo/);
assert.match(editorSource, /event\.inputType !== "historyUndo"/);
assert.match(editorSource, /event\.inputType === "historyRedo"/);
assert.match(editorSource, /createControlHistoryPlugin\(\),/);

console.log("milkdown list indentation and deletion regression: PASS");
