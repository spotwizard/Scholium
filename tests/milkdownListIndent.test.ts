import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeHistory, history, undo } from "@milkdown/prose/history";
import { Schema, type Node as ProseMirrorNode } from "@milkdown/prose/model";
import {
  bulletList,
  liftListItem,
  listItem,
  orderedList,
  splitListItem,
} from "@milkdown/prose/schema-list";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/prose/state";
import {
  deleteEmptyParagraphAfterList,
  deleteAtListItemStart,
  insertEmptyFirstChildListItem,
  liftListItemBesideSiblingLists,
  mergeRemovedListMarkerLineBackward,
  moveToNextEmptyListItem,
  normalizeAdjacentSerializedListItems,
  preserveSerializedEmptyParagraphListBoundaries,
  sinkSingleListItem,
} from "../src/milkdownListIndent.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    hardbreak: { inline: true, group: "inline", selectable: false },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    ordered_list: { ...orderedList, content: "list_item+", group: "block" },
    list_item: { ...listItem, content: "paragraph block*" },
  },
});

const paragraph = (text: string) =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const item = (text: string, children: ProseMirrorNode[] = []): ProseMirrorNode =>
  schema.nodes.list_item.create(
    null,
    children.length > 0
      ? [paragraph(text), schema.nodes.bullet_list.create(null, children)]
      : [paragraph(text)],
  );
const orderedItem = (
  text: string,
  children: ProseMirrorNode[] = [],
): ProseMirrorNode =>
  schema.nodes.list_item.create(
    null,
    children.length > 0
      ? [paragraph(text), schema.nodes.ordered_list.create(null, children)]
      : [paragraph(text)],
  );

assert.equal(
  normalizeAdjacentSerializedListItems("- 第一項\n\n- 第二項"),
  "- 第一項\n- 第二項",
);
assert.equal(
  normalizeAdjacentSerializedListItems("- 第一項\n\n\n- 第二項"),
  "- 第一項\n\n\n- 第二項",
);

const enterBeforeEmptyDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("保留這一項"),
    item(""),
  ]),
]);
let enterBeforeEmptyPosition = -1;
enterBeforeEmptyDocument.descendants((node, position) => {
  if (node.isText && node.text === "保留這一項") {
    enterBeforeEmptyPosition = position + node.nodeSize;
  }
});
assert.notEqual(enterBeforeEmptyPosition, -1);
const enterBeforeEmptyState = EditorState.create({
  doc: enterBeforeEmptyDocument,
  selection: TextSelection.create(
    enterBeforeEmptyDocument,
    enterBeforeEmptyPosition,
  ),
});
let movedToEmptyState = enterBeforeEmptyState;
assert.equal(
  moveToNextEmptyListItem(schema.nodes.list_item)(
    enterBeforeEmptyState,
    (transaction) => {
      movedToEmptyState = enterBeforeEmptyState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(movedToEmptyState.doc.toJSON(), enterBeforeEmptyDocument.toJSON());
assert.equal(movedToEmptyState.selection.$from.parent.textContent, "");
assert.equal(movedToEmptyState.selection.$from.parentOffset, 0);

// Enter in the middle of the item text splits it even when the next item is empty.
const enterMidTextBeforeEmptyDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("執行方式：", [item("修改完程式後，用英文編撰 commit message"), item("")]),
  ]),
]);
let enterMidTextBeforeEmptyPosition = -1;
enterMidTextBeforeEmptyDocument.descendants((node, position) => {
  if (node.isText && node.text?.startsWith("修改完")) {
    enterMidTextBeforeEmptyPosition = position + "修改完".length;
  }
});
assert.notEqual(enterMidTextBeforeEmptyPosition, -1);
const enterMidTextBeforeEmptyState = EditorState.create({
  doc: enterMidTextBeforeEmptyDocument,
  selection: TextSelection.create(
    enterMidTextBeforeEmptyDocument,
    enterMidTextBeforeEmptyPosition,
  ),
});
assert.equal(
  moveToNextEmptyListItem(schema.nodes.list_item)(enterMidTextBeforeEmptyState),
  false,
);
let splitMidTextBeforeEmptyState = enterMidTextBeforeEmptyState;
assert.equal(
  splitListItem(schema.nodes.list_item)(
    enterMidTextBeforeEmptyState,
    (transaction) => {
      splitMidTextBeforeEmptyState = enterMidTextBeforeEmptyState.apply(transaction);
    },
  ),
  true,
);
const splitChildItems: string[] = [];
splitMidTextBeforeEmptyState.doc.firstChild!.firstChild!.child(1).forEach((childItem) => {
  splitChildItems.push(childItem.textContent);
});
assert.deepEqual(splitChildItems, ["修改完", "程式後，用英文編撰 commit message", ""]);
assert.equal(
  splitMidTextBeforeEmptyState.selection.$from.parent.textContent,
  "程式後，用英文編撰 commit message",
);
assert.equal(splitMidTextBeforeEmptyState.selection.$from.parentOffset, 0);

const enterAtFirstItemStartDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("可否轉移給瀚荃"),
    orderedItem(""),
  ]),
]);
let enterAtFirstItemStartPosition = -1;
enterAtFirstItemStartDocument.descendants((node, position) => {
  if (node.isText && node.text === "可否轉移給瀚荃") {
    enterAtFirstItemStartPosition = position;
  }
});
assert.notEqual(enterAtFirstItemStartPosition, -1);
const enterAtFirstItemStartState = EditorState.create({
  doc: enterAtFirstItemStartDocument,
  selection: TextSelection.create(
    enterAtFirstItemStartDocument,
    enterAtFirstItemStartPosition,
  ),
});
assert.equal(
  moveToNextEmptyListItem(schema.nodes.list_item)(enterAtFirstItemStartState),
  false,
);
let splitAtFirstItemStartState = enterAtFirstItemStartState;
assert.equal(
  splitListItem(schema.nodes.list_item)(
    enterAtFirstItemStartState,
    (transaction) => {
      splitAtFirstItemStartState = enterAtFirstItemStartState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(
  splitAtFirstItemStartState.doc.toJSON(),
  schema.nodes.doc
    .create(null, [
      schema.nodes.ordered_list.create(null, [
        orderedItem(""),
        orderedItem("可否轉移給瀚荃"),
        orderedItem(""),
      ]),
    ])
    .toJSON(),
);
assert.equal(
  splitAtFirstItemStartState.selection.$from.parent.textContent,
  "可否轉移給瀚荃",
);
assert.equal(splitAtFirstItemStartState.selection.$from.parentOffset, 0);
assert.equal(
  splitAtFirstItemStartState.selection.$from.index(
    splitAtFirstItemStartState.selection.$from.depth - 2,
  ),
  1,
);

const enterBeforeContentDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("保留這一項"),
    item("下一項有內容"),
  ]),
]);
let enterBeforeContentPosition = -1;
enterBeforeContentDocument.descendants((node, position) => {
  if (node.isText && node.text === "保留這一項") {
    enterBeforeContentPosition = position + 2;
  }
});
assert.equal(
  moveToNextEmptyListItem(schema.nodes.list_item)(
    EditorState.create({
      doc: enterBeforeContentDocument,
      selection: TextSelection.create(
        enterBeforeContentDocument,
        enterBeforeContentPosition,
      ),
    }),
  ),
  false,
);

const enterAfterParentWithChildrenDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("父項目", [item("子項目")]),
    item("下一個同層項目"),
  ]),
]);
let enterAfterParentWithChildrenPosition = -1;
enterAfterParentWithChildrenDocument.descendants((node, position) => {
  if (node.isText && node.text === "父項目") {
    enterAfterParentWithChildrenPosition = position + node.nodeSize;
  }
});
assert.notEqual(enterAfterParentWithChildrenPosition, -1);
let enterAfterParentWithChildrenState = EditorState.create({
  doc: enterAfterParentWithChildrenDocument,
  selection: TextSelection.create(
    enterAfterParentWithChildrenDocument,
    enterAfterParentWithChildrenPosition,
  ),
  plugins: [history()],
});
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    enterAfterParentWithChildrenState,
    (transaction) => {
      enterAfterParentWithChildrenState =
        enterAfterParentWithChildrenState.apply(transaction);
    },
  ),
  true,
);
const listAfterParentEnter = enterAfterParentWithChildrenState.doc.firstChild;
assert.equal(listAfterParentEnter?.childCount, 2);
assert.equal(listAfterParentEnter?.child(0).firstChild?.textContent, "父項目");
const nestedListAfterParentEnter = listAfterParentEnter?.child(0).child(1);
assert.equal(nestedListAfterParentEnter?.type, schema.nodes.bullet_list);
assert.equal(nestedListAfterParentEnter?.childCount, 2);
assert.equal(
  nestedListAfterParentEnter?.child(0).firstChild?.textContent,
  "",
);
assert.equal(
  nestedListAfterParentEnter?.child(1).firstChild?.textContent,
  "子項目",
);
assert.equal(
  listAfterParentEnter?.child(1).firstChild?.textContent,
  "下一個同層項目",
);
assert.equal(enterAfterParentWithChildrenState.selection.$from.parent.textContent, "");
assert.equal(enterAfterParentWithChildrenState.selection.$from.parentOffset, 0);
assert.equal(
  undo(enterAfterParentWithChildrenState, (transaction) => {
    enterAfterParentWithChildrenState =
      enterAfterParentWithChildrenState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  enterAfterParentWithChildrenState.doc.toJSON(),
  enterAfterParentWithChildrenDocument.toJSON(),
);

let enterThenDeleteState = EditorState.create({
  doc: enterAfterParentWithChildrenDocument,
  selection: TextSelection.create(
    enterAfterParentWithChildrenDocument,
    enterAfterParentWithChildrenPosition,
  ),
  plugins: [history()],
});
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    enterThenDeleteState,
    (transaction) => {
      enterThenDeleteState = enterThenDeleteState.apply(transaction);
    },
  ),
  true,
);
const documentAfterParentEnter = enterThenDeleteState.doc.toJSON();
enterThenDeleteState = enterThenDeleteState.apply(
  closeHistory(enterThenDeleteState.tr),
);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    enterThenDeleteState,
    (transaction) => {
      enterThenDeleteState = enterThenDeleteState.apply(transaction);
    },
  ),
  true,
);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    enterThenDeleteState,
    (transaction) => {
      enterThenDeleteState = enterThenDeleteState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(
  enterThenDeleteState.doc.toJSON(),
  enterAfterParentWithChildrenDocument.toJSON(),
);

let enterThenNodeDeleteState = EditorState.create({
  doc: enterAfterParentWithChildrenDocument,
  selection: TextSelection.create(
    enterAfterParentWithChildrenDocument,
    enterAfterParentWithChildrenPosition,
  ),
  plugins: [history()],
});
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    enterThenNodeDeleteState,
    (transaction) => {
      enterThenNodeDeleteState = enterThenNodeDeleteState.apply(transaction);
    },
  ),
  true,
);
const documentBeforeNodeDelete = enterThenNodeDeleteState.doc.toJSON();
enterThenNodeDeleteState = enterThenNodeDeleteState.apply(
  closeHistory(enterThenNodeDeleteState.tr),
);
enterThenNodeDeleteState = enterThenNodeDeleteState.apply(
  enterThenNodeDeleteState.tr
    .setSelection(
      NodeSelection.create(
        enterThenNodeDeleteState.doc,
        enterThenNodeDeleteState.selection.from - 2,
      ),
    )
    .deleteSelection(),
);
assert.equal(
  undo(enterThenNodeDeleteState, (transaction) => {
    enterThenNodeDeleteState = enterThenNodeDeleteState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  enterThenNodeDeleteState.doc.toJSON(),
  documentBeforeNodeDelete,
  "Undo must restore a whole item deleted through a node selection",
);
assert.equal(
  undo(enterThenNodeDeleteState, (transaction) => {
    enterThenNodeDeleteState = enterThenNodeDeleteState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  enterThenNodeDeleteState.doc.toJSON(),
  enterAfterParentWithChildrenDocument.toJSON(),
);
assert.equal(
  undo(enterThenDeleteState, (transaction) => {
    enterThenDeleteState = enterThenDeleteState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  enterThenDeleteState.doc.toJSON(),
  documentAfterParentEnter,
  "Undo after deleting the new whole item must restore that item first",
);
assert.equal(
  undo(enterThenDeleteState, (transaction) => {
    enterThenDeleteState = enterThenDeleteState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  enterThenDeleteState.doc.toJSON(),
  enterAfterParentWithChildrenDocument.toJSON(),
);
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    EditorState.create({
      doc: enterAfterParentWithChildrenDocument,
      selection: TextSelection.create(
        enterAfterParentWithChildrenDocument,
        enterAfterParentWithChildrenPosition - 1,
      ),
    }),
  ),
  false,
);
const leafListItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [item("一般項目")]),
]);
let leafListItemEndPosition = -1;
leafListItemDocument.descendants((node, position) => {
  if (node.isText && node.text === "一般項目") {
    leafListItemEndPosition = position + node.nodeSize;
  }
});
assert.notEqual(leafListItemEndPosition, -1);
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    EditorState.create({
      doc: leafListItemDocument,
      selection: TextSelection.create(
        leafListItemDocument,
        leafListItemEndPosition,
      ),
    }),
  ),
  false,
);

const orderedParentWithChildrenDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create({ order: 1 }, [
    orderedItem("父項目", [orderedItem("子項目")]),
  ]),
]);
let orderedParentWithChildrenPosition = -1;
orderedParentWithChildrenDocument.descendants((node, position) => {
  if (node.isText && node.text === "父項目") {
    orderedParentWithChildrenPosition = position + node.nodeSize;
  }
});
assert.notEqual(orderedParentWithChildrenPosition, -1);
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    EditorState.create({
      doc: orderedParentWithChildrenDocument,
      selection: TextSelection.create(
        orderedParentWithChildrenDocument,
        orderedParentWithChildrenPosition,
      ),
    }),
  ),
  false,
);

const enterAfterParentBeforeEmptyDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("父項目", [item(""), item("子項目")]),
    item("下一個同層項目"),
  ]),
]);
let enterAfterParentBeforeEmptyPosition = -1;
enterAfterParentBeforeEmptyDocument.descendants((node, position) => {
  if (node.isText && node.text === "父項目") {
    enterAfterParentBeforeEmptyPosition = position + node.nodeSize;
  }
});
assert.notEqual(enterAfterParentBeforeEmptyPosition, -1);
let enterAfterParentBeforeEmptyState = EditorState.create({
  doc: enterAfterParentBeforeEmptyDocument,
  selection: TextSelection.create(
    enterAfterParentBeforeEmptyDocument,
    enterAfterParentBeforeEmptyPosition,
  ),
});
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    enterAfterParentBeforeEmptyState,
    (transaction) => {
      enterAfterParentBeforeEmptyState =
        enterAfterParentBeforeEmptyState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(
  enterAfterParentBeforeEmptyState.doc.toJSON(),
  enterAfterParentBeforeEmptyDocument.toJSON(),
);
assert.equal(enterAfterParentBeforeEmptyState.selection.$from.parent.textContent, "");
assert.equal(enterAfterParentBeforeEmptyState.selection.$from.parentOffset, 0);

const parentBeforeOuterEmptyDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("父項目", [item("子項目")]),
    item(""),
  ]),
]);
let parentBeforeOuterEmptyPosition = -1;
parentBeforeOuterEmptyDocument.descendants((node, position) => {
  if (node.isText && node.text === "父項目") {
    parentBeforeOuterEmptyPosition = position + node.nodeSize;
  }
});
assert.notEqual(parentBeforeOuterEmptyPosition, -1);
let parentBeforeOuterEmptyState = EditorState.create({
  doc: parentBeforeOuterEmptyDocument,
  selection: TextSelection.create(
    parentBeforeOuterEmptyDocument,
    parentBeforeOuterEmptyPosition,
  ),
});
assert.equal(
  insertEmptyFirstChildListItem(schema.nodes.list_item)(
    parentBeforeOuterEmptyState,
    (transaction) => {
      parentBeforeOuterEmptyState =
        parentBeforeOuterEmptyState.apply(transaction);
    },
  ),
  true,
);
const listBeforeOuterEmptyAfterEnter = parentBeforeOuterEmptyState.doc.firstChild;
const nestedListBeforeOuterEmptyAfterEnter =
  listBeforeOuterEmptyAfterEnter?.child(0).child(1);
assert.equal(listBeforeOuterEmptyAfterEnter?.childCount, 2);
assert.equal(nestedListBeforeOuterEmptyAfterEnter?.childCount, 2);
assert.equal(
  nestedListBeforeOuterEmptyAfterEnter?.child(0).firstChild?.textContent,
  "",
);
assert.equal(
  nestedListBeforeOuterEmptyAfterEnter?.child(1).firstChild?.textContent,
  "子項目",
);
assert.equal(listBeforeOuterEmptyAfterEnter?.child(1).firstChild?.textContent, "");
assert.equal(
  parentBeforeOuterEmptyState.selection.$from.parent,
  nestedListBeforeOuterEmptyAfterEnter?.child(0).firstChild,
);

const taskListItemAttrs = {
  label: "•",
  listType: "bullet",
  spread: false,
  checked: true,
};
const taskListSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: {
      ...listItem,
      attrs: {
        label: { default: "•" },
        listType: { default: "bullet" },
        spread: { default: true },
        checked: { default: null },
      },
      content: "paragraph block*",
    },
  },
});
const taskParagraph = (text: string) =>
  taskListSchema.nodes.paragraph.create(null, taskListSchema.text(text));
const taskParentWithChildrenDocument = taskListSchema.nodes.doc.create(null, [
  taskListSchema.nodes.bullet_list.create(null, [
    taskListSchema.nodes.list_item.create(taskListItemAttrs, [
      taskParagraph("已完成父項目"),
      taskListSchema.nodes.bullet_list.create(null, [
        taskListSchema.nodes.list_item.create(null, [taskParagraph("子項目")]),
      ]),
    ]),
  ]),
]);
let taskParentWithChildrenPosition = -1;
taskParentWithChildrenDocument.descendants((node, position) => {
  if (node.isText && node.text === "已完成父項目") {
    taskParentWithChildrenPosition = position + node.nodeSize;
  }
});
assert.notEqual(taskParentWithChildrenPosition, -1);
let taskParentWithChildrenState = EditorState.create({
  doc: taskParentWithChildrenDocument,
  selection: TextSelection.create(
    taskParentWithChildrenDocument,
    taskParentWithChildrenPosition,
  ),
});
assert.equal(
  insertEmptyFirstChildListItem(taskListSchema.nodes.list_item)(
    taskParentWithChildrenState,
    (transaction) => {
      taskParentWithChildrenState =
        taskParentWithChildrenState.apply(transaction);
    },
  ),
  false,
);
assert.deepEqual(
  taskParentWithChildrenState.doc.toJSON(),
  taskParentWithChildrenDocument.toJSON(),
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
  (transaction) => {
    deletionState = deletionState.apply(transaction);
  },
);

assert.equal(deletionHandled, true);
assert.equal(deletionState.doc.textContent, deletionDocument.textContent);
assert.equal(deletionState.selection.$from.parent.textContent, "分析");
assert.equal(deletionState.selection.$from.parentOffset, 0);
const remainingListItemLabels: string[] = [];
const filterOutItem: { current: ProseMirrorNode | null } = { current: null };
deletionState.doc.descendants((node) => {
  if (node.type !== schema.nodes.list_item) return;

  const label = node.firstChild?.textContent ?? "";
  remainingListItemLabels.push(label);
  if (label === "篩除") filterOutItem.current = node;
});
assert.equal(remainingListItemLabels.includes("分析"), false);
assert.equal(remainingListItemLabels.includes("找出能代表該地點的亮點特色"), true);
assert.equal(remainingListItemLabels.includes("篩除"), true);
assert.equal(
  filterOutItem.current?.lastChild?.textContent,
  "刪除重複的資料刪除",
);
assert.equal(
  undo(deletionState, (transaction) => {
    deletionState = deletionState.apply(transaction);
  }),
  true,
);
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

let emptyParentState = EditorState.create({
  doc: clearedItemState.doc,
  selection: TextSelection.create(clearedItemState.doc, emptyParentPosition),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    emptyParentState,
    (transaction) => {
      emptyParentState = emptyParentState.apply(transaction);
    },
  ),
  true,
);
assert.equal(emptyParentState.doc.textContent, clearedItemState.doc.textContent);
const promotedTopLevelItem = emptyParentState.doc.firstChild?.firstChild;
const promotedFirstLevelList = promotedTopLevelItem?.child(1);
const promotedFilterItem = promotedFirstLevelList?.firstChild;
const promotedFilterList = promotedFilterItem?.child(1);
assert.equal(promotedFilterList?.childCount, 2);
assert.equal(
  promotedFilterList?.child(0).firstChild?.textContent,
  "找出能代表該地點的亮點特色",
);
assert.equal(promotedFilterList?.child(1).firstChild?.textContent, "篩除：");
assert.equal(
  promotedFilterList?.child(1).lastChild?.textContent,
  "刪除重複的資料刪除",
);
assert.equal(
  emptyParentState.selection.$from.parent.textContent,
  "找出能代表該地點的亮點特色",
);
assert.equal(emptyParentState.selection.$from.parentOffset, 0);

assert.equal(
  undo(emptyParentState, (transaction) => {
    emptyParentState = emptyParentState.apply(transaction);
  }),
  true,
);
assert.deepEqual(emptyParentState.doc.toJSON(), clearedItemState.doc.toJSON());

const phantomParentItem = schema.nodes.list_item.create(null, [
  schema.nodes.paragraph.create(null, schema.nodes.hardbreak.create()),
  schema.nodes.bullet_list.create(null, [
    item("必須採用以下文章結構："),
  ]),
]);
const phantomBulletDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("禁止使用純記錄的方式描述"),
    item("不要刻意提及店名、地區、街道和門牌號"),
    phantomParentItem,
    item("文章標題：代表整篇文章"),
  ]),
]);
let phantomBulletPosition = -1;
phantomBulletDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.childCount === 2
  ) {
    phantomBulletPosition = position + 3;
  }
});
assert.notEqual(phantomBulletPosition, -1);

let phantomBulletState = EditorState.create({
  doc: phantomBulletDocument,
  selection: TextSelection.create(phantomBulletDocument, phantomBulletPosition),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    phantomBulletState,
    (transaction) => {
      phantomBulletState = phantomBulletState.apply(transaction);
    },
  ),
  true,
);
const normalizedBulletList = phantomBulletState.doc.firstChild;
assert.equal(normalizedBulletList?.childCount, 4);
assert.deepEqual(
  Array.from({ length: normalizedBulletList?.childCount ?? 0 }, (_, index) =>
    normalizedBulletList?.child(index).firstChild?.textContent,
  ),
  [
    "禁止使用純記錄的方式描述",
    "不要刻意提及店名、地區、街道和門牌號",
    "必須採用以下文章結構：",
    "文章標題：代表整篇文章",
  ],
);
assert.equal(
  phantomBulletState.selection.$from.parent.textContent,
  "必須採用以下文章結構：",
);
assert.equal(phantomBulletState.selection.$from.parentOffset, 0);
assert.equal(
  undo(phantomBulletState, (transaction) => {
    phantomBulletState = phantomBulletState.apply(transaction);
  }),
  true,
);
assert.deepEqual(phantomBulletState.doc.toJSON(), phantomBulletDocument.toJSON());

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
assert.equal(siblingDeletionState.doc.textContent, siblingDeletionDocument.textContent);
const siblingTopList = siblingDeletionState.doc.firstChild;
const siblingFilterItem = siblingTopList?.firstChild;
assert.equal(siblingTopList?.childCount, 2);
assert.equal(siblingFilterItem?.childCount, 3);
assert.equal(siblingFilterItem?.child(0).textContent, "篩選");
assert.equal(siblingFilterItem?.child(1).type, schema.nodes.paragraph);
assert.equal(siblingFilterItem?.child(1).textContent, "");
assert.equal(siblingFilterItem?.child(2).type, schema.nodes.bullet_list);
assert.equal(siblingFilterItem?.child(2).firstChild?.firstChild?.textContent, "篩除：");
assert.equal(
  siblingFilterItem?.child(2).firstChild?.lastChild?.textContent,
  "刪除重複的資料刪除",
);
assert.equal(siblingDeletionState.selection.$from.parent.type, schema.nodes.paragraph);
assert.equal(siblingDeletionState.selection.$from.parent.textContent, "");
assert.equal(siblingDeletionState.selection.$from.parentOffset, 0);
assert.equal(
  undo(siblingDeletionState, (transaction) => {
    siblingDeletionState = siblingDeletionState.apply(transaction);
  }),
  true,
);
assert.deepEqual(siblingDeletionState.doc.toJSON(), siblingDeletionDocument.toJSON());

const protectedInsertionLineDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("撰寫咖啡館報導散文", [
      item("形式為真實旅遊報導文章", [
        item("非業配文"),
        item("非網路行銷文"),
        item("Test"),
      ]),
      item("大致上分五部分：", [item("文章標題")]),
    ]),
  ]),
]);
let protectedInsertionLinePosition = -1;
protectedInsertionLineDocument.descendants((node, position) => {
  if (node.isText && node.text === "Test") {
    protectedInsertionLinePosition = position + node.nodeSize;
  }
});
assert.notEqual(protectedInsertionLinePosition, -1);
let protectedInsertionLineState = EditorState.create({
  doc: protectedInsertionLineDocument,
  selection: TextSelection.create(
    protectedInsertionLineDocument,
    protectedInsertionLinePosition,
  ),
  plugins: [history()],
});
for (let character = 0; character < "Test".length; character += 1) {
  protectedInsertionLineState = protectedInsertionLineState.apply(
    protectedInsertionLineState.tr.delete(
      protectedInsertionLineState.selection.from - 1,
      protectedInsertionLineState.selection.from,
    ),
  );
}
assert.equal(protectedInsertionLineState.selection.$from.parent.textContent, "");
assert.equal(protectedInsertionLineState.selection.$from.parentOffset, 0);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    protectedInsertionLineState,
    (transaction) => {
      protectedInsertionLineState =
        protectedInsertionLineState.apply(transaction);
    },
  ),
  true,
);
const protectedInsertionLineAfterMarkerDelete =
  protectedInsertionLineState.doc.toJSON();
assert.equal(
  protectedInsertionLineState.selection.$from.parent.type,
  schema.nodes.paragraph,
);
assert.equal(protectedInsertionLineState.selection.$from.parent.childCount, 0);
assert.equal(protectedInsertionLineState.selection.$from.parentOffset, 0);
assert.match(
  preserveSerializedEmptyParagraphListBoundaries(
    "    - 非業配文\n    - 非網路行銷文\n\n  - 大致上分五部分：",
    protectedInsertionLineState.doc,
  ),
  /非網路行銷文\n\n\n  - 大致上分五部分：/,
  "The nested insertion line must survive the controlled Markdown writeback",
);
const protectedPlainTextState = protectedInsertionLineState.apply(
  protectedInsertionLineState.tr.insertText("插入純文字"),
);
assert.equal(protectedPlainTextState.selection.$from.parent.textContent, "插入純文字");
assert.equal(protectedPlainTextState.selection.$from.parent.childCount, 1);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    protectedInsertionLineState,
    (transaction) => {
      protectedInsertionLineState =
        protectedInsertionLineState.apply(transaction);
    },
  ),
  true,
);
assert.notDeepEqual(
  protectedInsertionLineState.doc.toJSON(),
  protectedInsertionLineAfterMarkerDelete,
  "A second Backspace must delete the empty insertion line",
);
assert.equal(
  protectedInsertionLineState.selection.$from.parent.textContent,
  "非網路行銷文",
);
assert.equal(
  protectedInsertionLineState.selection.$from.parentOffset,
  "非網路行銷文".length,
);
assert.equal(
  undo(protectedInsertionLineState, (transaction) => {
    protectedInsertionLineState =
      protectedInsertionLineState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  protectedInsertionLineState.doc.toJSON(),
  protectedInsertionLineDocument.toJSON(),
  "Undo after marker deletion must restore the empty list item",
);

const topLevelEmptyItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("使用者提供地點"),
    item("根據 search.md 中的規則進行搜尋資料的程序"),
    item(""),
  ]),
]);
let topLevelEmptyItemPosition = -1;
topLevelEmptyItemDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.childCount === 1
  ) {
    topLevelEmptyItemPosition = position + 2;
  }
});
assert.notEqual(topLevelEmptyItemPosition, -1);

let topLevelEmptyItemState = EditorState.create({
  doc: topLevelEmptyItemDocument,
  selection: TextSelection.create(
    topLevelEmptyItemDocument,
    topLevelEmptyItemPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    topLevelEmptyItemState,
    (transaction) => {
      topLevelEmptyItemState = topLevelEmptyItemState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(topLevelEmptyItemState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "使用者提供地點" }],
            },
          ],
        },
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "根據 search.md 中的規則進行搜尋資料的程序",
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "paragraph" },
  ],
});
assert.equal(topLevelEmptyItemState.selection.$from.parent.type, schema.nodes.paragraph);
assert.equal(topLevelEmptyItemState.selection.$from.parent.textContent, "");
assert.equal(topLevelEmptyItemState.selection.$from.parentOffset, 0);
assert.equal(
  undo(topLevelEmptyItemState, (transaction) => {
    topLevelEmptyItemState = topLevelEmptyItemState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  topLevelEmptyItemState.doc.toJSON(),
  topLevelEmptyItemDocument.toJSON(),
);

const topLevelHardbreakEmptyItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("使用者提供地點"),
    item("根據 search.md 中的規則進行搜尋資料的程序"),
    schema.nodes.list_item.create(null, [
      schema.nodes.paragraph.create(null, schema.nodes.hardbreak.create()),
    ]),
  ]),
]);
let topLevelHardbreakEmptyItemPosition = -1;
topLevelHardbreakEmptyItemDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.childCount === 1 &&
    node.firstChild.firstChild?.type === schema.nodes.hardbreak
  ) {
    topLevelHardbreakEmptyItemPosition = position + 3;
  }
});
assert.notEqual(topLevelHardbreakEmptyItemPosition, -1);

let topLevelHardbreakEmptyItemState = EditorState.create({
  doc: topLevelHardbreakEmptyItemDocument,
  selection: TextSelection.create(
    topLevelHardbreakEmptyItemDocument,
    topLevelHardbreakEmptyItemPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "forward")(
    topLevelHardbreakEmptyItemState,
    (transaction) => {
      topLevelHardbreakEmptyItemState =
        topLevelHardbreakEmptyItemState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(topLevelHardbreakEmptyItemState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "使用者提供地點" }],
            },
          ],
        },
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "根據 search.md 中的規則進行搜尋資料的程序",
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "paragraph", content: [{ type: "hardbreak" }] },
  ],
});
assert.equal(
  topLevelHardbreakEmptyItemState.selection.$from.parent.type,
  schema.nodes.paragraph,
);
assert.equal(topLevelHardbreakEmptyItemState.selection.$from.parent.textContent, "");
assert.equal(
  topLevelHardbreakEmptyItemState.selection.$from.parentOffset,
  1,
  "Delete after a list must place the caret on the final editable line below the list",
);
assert.equal(
  undo(topLevelHardbreakEmptyItemState, (transaction) => {
    topLevelHardbreakEmptyItemState =
      topLevelHardbreakEmptyItemState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  topLevelHardbreakEmptyItemState.doc.toJSON(),
  topLevelHardbreakEmptyItemDocument.toJSON(),
);

const paragraphAfterListDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("使用者提供地點"),
    item("根據 search.md 中的規則進行搜尋資料的程序"),
    item("其他合併目標不予執行。"),
  ]),
  schema.nodes.paragraph.create(null, schema.nodes.hardbreak.create()),
]);
let paragraphAfterListPosition = -1;
paragraphAfterListDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.paragraph &&
    node.childCount === 1 &&
    node.firstChild?.type === schema.nodes.hardbreak
  ) {
    paragraphAfterListPosition = position + 2;
  }
});
assert.notEqual(paragraphAfterListPosition, -1);

let paragraphAfterListState = EditorState.create({
  doc: paragraphAfterListDocument,
  selection: TextSelection.create(
    paragraphAfterListDocument,
    paragraphAfterListPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteEmptyParagraphAfterList(schema.nodes.list_item)(
    paragraphAfterListState,
    (transaction) => {
      paragraphAfterListState = paragraphAfterListState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(paragraphAfterListState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "使用者提供地點" }],
            },
          ],
        },
        {
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "根據 search.md 中的規則進行搜尋資料的程序",
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
              content: [{ type: "text", text: "其他合併目標不予執行。" }],
            },
          ],
        },
      ],
    },
  ],
});
assert.equal(
  paragraphAfterListState.selection.$from.parent.textContent,
  "其他合併目標不予執行。",
);
assert.equal(
  paragraphAfterListState.selection.$from.parentOffset,
  "其他合併目標不予執行。".length,
  "Delete in the blank line after a list must move the caret to the final list row",
);
assert.equal(
  undo(paragraphAfterListState, (transaction) => {
    paragraphAfterListState = paragraphAfterListState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  paragraphAfterListState.doc.toJSON(),
  paragraphAfterListDocument.toJSON(),
);

const orderedTextDeletionDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("第一列"),
    orderedItem("第二列"),
    orderedItem("第三列"),
  ]),
]);
let orderedTextDeletionPosition = -1;
orderedTextDeletionDocument.descendants((node, position) => {
  if (node.isText && node.text === "第二列") {
    orderedTextDeletionPosition = position;
  }
});
assert.notEqual(orderedTextDeletionPosition, -1);

let orderedTextDeletionState = EditorState.create({
  doc: orderedTextDeletionDocument,
});
orderedTextDeletionState = orderedTextDeletionState.apply(
  orderedTextDeletionState.tr.delete(
    orderedTextDeletionPosition,
    orderedTextDeletionPosition + "第二列".length,
  ),
);
const orderedListAfterTextDeletion = orderedTextDeletionState.doc.firstChild;
assert.equal(orderedListAfterTextDeletion?.type, schema.nodes.ordered_list);
assert.equal(orderedListAfterTextDeletion?.childCount, 3);
assert.equal(
  orderedListAfterTextDeletion?.child(1).firstChild?.textContent,
  "",
);

const orderedEmptyItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("第一列"),
    orderedItem(""),
    orderedItem("第三列"),
  ]),
]);
let orderedEmptyItemPosition = -1;
orderedEmptyItemDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.childCount === 1
  ) {
    orderedEmptyItemPosition = position + 2;
  }
});
assert.notEqual(orderedEmptyItemPosition, -1);

let orderedEmptyItemState = EditorState.create({
  doc: orderedEmptyItemDocument,
  selection: TextSelection.create(
    orderedEmptyItemDocument,
    orderedEmptyItemPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    orderedEmptyItemState,
    (transaction) => {
      orderedEmptyItemState = orderedEmptyItemState.apply(transaction);
    },
  ),
  true,
);
assert.equal(orderedEmptyItemState.doc.childCount, 3);
assert.equal(orderedEmptyItemState.doc.child(0).type, schema.nodes.ordered_list);
assert.equal(orderedEmptyItemState.doc.child(0).textContent, "第一列");
assert.equal(orderedEmptyItemState.doc.child(1).type, schema.nodes.paragraph);
assert.equal(orderedEmptyItemState.doc.child(1).textContent, "");
assert.equal(orderedEmptyItemState.doc.child(2).type, schema.nodes.ordered_list);
assert.equal(orderedEmptyItemState.doc.child(2).textContent, "第三列");
assert.equal(orderedEmptyItemState.doc.child(2).attrs.order, 2);
assert.equal(
  orderedEmptyItemState.selection.$from.parent.type,
  schema.nodes.paragraph,
);
assert.equal(orderedEmptyItemState.selection.$from.parentOffset, 0);
assert.equal(
  undo(orderedEmptyItemState, (transaction) => {
    orderedEmptyItemState = orderedEmptyItemState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  orderedEmptyItemState.doc.toJSON(),
  orderedEmptyItemDocument.toJSON(),
);

const removedMiddleItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("授權到期日"),
    orderedItem(""),
    orderedItem("可否轉移給瀚荃"),
    orderedItem("第四項"),
  ]),
]);
let removedMiddleItemPosition = -1;
removedMiddleItemDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === ""
  ) {
    removedMiddleItemPosition = position + 2;
  }
});
assert.notEqual(removedMiddleItemPosition, -1);
let removedMiddleItemState = EditorState.create({
  doc: removedMiddleItemDocument,
  selection: TextSelection.create(
    removedMiddleItemDocument,
    removedMiddleItemPosition,
  ),
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    removedMiddleItemState,
    (transaction) => {
      removedMiddleItemState = removedMiddleItemState.apply(transaction);
    },
  ),
  true,
);
assert.equal(removedMiddleItemState.doc.child(2).attrs.order, 2);
const removedMarkerLineState = removedMiddleItemState;
const expectedJoinedListAfterRemovedItem = schema.nodes.doc
  .create(null, [
    schema.nodes.ordered_list.create(null, [
      orderedItem("授權到期日"),
      orderedItem("可否轉移給瀚荃"),
      orderedItem("第四項"),
    ]),
  ])
  .toJSON();
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    removedMiddleItemState,
    (transaction) => {
      removedMiddleItemState = removedMiddleItemState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(
  removedMiddleItemState.doc.toJSON(),
  expectedJoinedListAfterRemovedItem,
);
assert.equal(
  removedMiddleItemState.selection.$from.parent.textContent,
  "授權到期日",
);
assert.equal(
  removedMiddleItemState.selection.$from.parentOffset,
  "授權到期日".length,
);
let forwardRemovedMarkerLineState = removedMarkerLineState;
assert.equal(
  deleteEmptyParagraphAfterList(schema.nodes.list_item)(
    forwardRemovedMarkerLineState,
    (transaction) => {
      forwardRemovedMarkerLineState =
        forwardRemovedMarkerLineState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(
  forwardRemovedMarkerLineState.doc.toJSON(),
  expectedJoinedListAfterRemovedItem,
);
assert.equal(
  forwardRemovedMarkerLineState.selection.$from.parent.textContent,
  "授權到期日",
);
assert.equal(
  forwardRemovedMarkerLineState.selection.$from.parentOffset,
  "授權到期日".length,
);

const orderedMarkerDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create({ order: 4 }, [
    orderedItem("第四列"),
    orderedItem("第五列"),
    orderedItem("第六列"),
  ]),
]);
let orderedMarkerPosition = -1;
orderedMarkerDocument.descendants((node, position) => {
  if (node.isText && node.text === "第五列") {
    orderedMarkerPosition = position;
  }
});
assert.notEqual(orderedMarkerPosition, -1);

let orderedMarkerState = EditorState.create({
  doc: orderedMarkerDocument,
  selection: TextSelection.create(orderedMarkerDocument, orderedMarkerPosition),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    orderedMarkerState,
    (transaction) => {
      orderedMarkerState = orderedMarkerState.apply(transaction);
    },
  ),
  true,
);
assert.equal(orderedMarkerState.doc.childCount, 3);
assert.equal(orderedMarkerState.doc.child(0).type, schema.nodes.ordered_list);
assert.equal(orderedMarkerState.doc.child(0).attrs.order, 4);
assert.equal(orderedMarkerState.doc.child(0).textContent, "第四列");
assert.equal(orderedMarkerState.doc.child(1).type, schema.nodes.paragraph);
assert.equal(orderedMarkerState.doc.child(1).textContent, "第五列");
assert.equal(orderedMarkerState.doc.child(2).type, schema.nodes.ordered_list);
assert.equal(orderedMarkerState.doc.child(2).attrs.order, 5);
assert.equal(orderedMarkerState.doc.child(2).textContent, "第六列");
assert.equal(orderedMarkerState.selection.$from.parent.textContent, "第五列");
assert.equal(orderedMarkerState.selection.$from.parentOffset, 0);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    orderedMarkerState,
    (transaction) => {
      orderedMarkerState = orderedMarkerState.apply(transaction);
    },
  ),
  true,
);
assert.equal(orderedMarkerState.doc.childCount, 1);
assert.equal(orderedMarkerState.doc.child(0).type, schema.nodes.ordered_list);
assert.equal(orderedMarkerState.doc.child(0).attrs.order, 4);
assert.equal(orderedMarkerState.doc.child(0).childCount, 2);
assert.equal(orderedMarkerState.doc.child(0).child(0).textContent, "第四列第五列");
assert.equal(orderedMarkerState.doc.child(0).child(1).textContent, "第六列");
assert.equal(
  orderedMarkerState.selection.$from.parent.textContent,
  "第四列第五列",
);
assert.equal(orderedMarkerState.selection.$from.parentOffset, "第四列".length);
assert.equal(
  undo(orderedMarkerState, (transaction) => {
    orderedMarkerState = orderedMarkerState.apply(transaction);
  }),
  true,
);
assert.deepEqual(orderedMarkerState.doc.toJSON(), orderedMarkerDocument.toJSON());

const orderedMarkerWithChildrenDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create({ order: 4 }, [
    orderedItem("第四列"),
    orderedItem("第五列", [
      orderedItem("第一個子項目", [orderedItem("孫項目")]),
      orderedItem("第二個子項目"),
    ]),
    orderedItem("第六列"),
  ]),
]);
let orderedMarkerWithChildrenPosition = -1;
orderedMarkerWithChildrenDocument.descendants((node, position) => {
  if (node.isText && node.text === "第五列") {
    orderedMarkerWithChildrenPosition = position;
  }
});
assert.notEqual(orderedMarkerWithChildrenPosition, -1);

let orderedMarkerWithChildrenState = EditorState.create({
  doc: orderedMarkerWithChildrenDocument,
  selection: TextSelection.create(
    orderedMarkerWithChildrenDocument,
    orderedMarkerWithChildrenPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    orderedMarkerWithChildrenState,
    (transaction) => {
      orderedMarkerWithChildrenState =
        orderedMarkerWithChildrenState.apply(transaction);
    },
  ),
  true,
);
assert.equal(orderedMarkerWithChildrenState.doc.childCount, 1);
const orderedListWithPreservedChildren =
  orderedMarkerWithChildrenState.doc.child(0);
assert.equal(orderedListWithPreservedChildren.type, schema.nodes.ordered_list);
assert.equal(orderedListWithPreservedChildren.attrs.order, 4);
assert.equal(orderedListWithPreservedChildren.childCount, 2);
const orderedItemWithPreservedChildren =
  orderedListWithPreservedChildren.child(0);
assert.equal(orderedItemWithPreservedChildren.childCount, 3);
assert.equal(
  orderedItemWithPreservedChildren.child(0).textContent,
  "第四列",
);
assert.equal(
  orderedItemWithPreservedChildren.child(1).textContent,
  "第五列",
);
const preservedOrderedChildren = orderedItemWithPreservedChildren.child(2);
assert.equal(preservedOrderedChildren.type, schema.nodes.ordered_list);
assert.equal(preservedOrderedChildren.attrs.order, 1);
assert.equal(preservedOrderedChildren.childCount, 2);
assert.equal(
  preservedOrderedChildren.child(0).firstChild?.textContent,
  "第一個子項目",
);
assert.equal(preservedOrderedChildren.child(0).childCount, 2);
assert.equal(
  preservedOrderedChildren.child(0).child(1).firstChild?.firstChild?.textContent,
  "孫項目",
);
assert.equal(
  preservedOrderedChildren.child(1).firstChild?.textContent,
  "第二個子項目",
);
assert.equal(
  orderedListWithPreservedChildren.child(1).firstChild?.textContent,
  "第六列",
);
assert.equal(
  orderedMarkerWithChildrenState.selection.$from.parent.textContent,
  "第五列",
);
assert.equal(orderedMarkerWithChildrenState.selection.$from.parentOffset, 0);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    orderedMarkerWithChildrenState,
    (transaction) => {
      orderedMarkerWithChildrenState =
        orderedMarkerWithChildrenState.apply(transaction);
    },
  ),
  true,
);
const orderedListAfterTextMerge = orderedMarkerWithChildrenState.doc.child(0);
assert.equal(orderedListAfterTextMerge.type, schema.nodes.ordered_list);
assert.equal(orderedListAfterTextMerge.childCount, 2);
assert.equal(
  orderedListAfterTextMerge.child(0).firstChild?.textContent,
  "第四列第五列",
);
assert.equal(orderedListAfterTextMerge.child(0).childCount, 2);
assert.equal(
  orderedListAfterTextMerge.child(0).child(1).firstChild?.firstChild?.textContent,
  "第一個子項目",
);
assert.equal(
  orderedMarkerWithChildrenState.selection.$from.parentOffset,
  "第四列".length,
);
assert.equal(
  undo(orderedMarkerWithChildrenState, (transaction) => {
    orderedMarkerWithChildrenState =
      orderedMarkerWithChildrenState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  orderedMarkerWithChildrenState.doc.toJSON(),
  orderedMarkerWithChildrenDocument.toJSON(),
);

const bulletMarkerWithChildrenDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("第一列"),
    item("第二列", [item("子項目")]),
    item("第三列"),
  ]),
]);
let bulletMarkerWithChildrenPosition = -1;
bulletMarkerWithChildrenDocument.descendants((node, position) => {
  if (node.isText && node.text === "第二列") {
    bulletMarkerWithChildrenPosition = position;
  }
});
assert.notEqual(bulletMarkerWithChildrenPosition, -1);

let bulletMarkerWithChildrenState = EditorState.create({
  doc: bulletMarkerWithChildrenDocument,
  selection: TextSelection.create(
    bulletMarkerWithChildrenDocument,
    bulletMarkerWithChildrenPosition,
  ),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    bulletMarkerWithChildrenState,
    (transaction) => {
      bulletMarkerWithChildrenState =
        bulletMarkerWithChildrenState.apply(transaction);
    },
  ),
  true,
);
assert.equal(bulletMarkerWithChildrenState.doc.childCount, 1);
const bulletListWithPreservedChildren =
  bulletMarkerWithChildrenState.doc.child(0);
assert.equal(bulletListWithPreservedChildren.type, schema.nodes.bullet_list);
assert.equal(bulletListWithPreservedChildren.childCount, 2);
const bulletItemWithPreservedChildren = bulletListWithPreservedChildren.child(0);
assert.equal(bulletItemWithPreservedChildren.childCount, 3);
assert.equal(bulletItemWithPreservedChildren.child(0).textContent, "第一列");
assert.equal(bulletItemWithPreservedChildren.child(1).textContent, "第二列");
const preservedBulletChildren = bulletItemWithPreservedChildren.child(2);
assert.equal(preservedBulletChildren.type, schema.nodes.bullet_list);
assert.equal(preservedBulletChildren.childCount, 1);
assert.equal(
  preservedBulletChildren.firstChild?.firstChild?.textContent,
  "子項目",
);
assert.equal(
  bulletListWithPreservedChildren.child(1).firstChild?.textContent,
  "第三列",
);
assert.equal(
  bulletMarkerWithChildrenState.selection.$from.parent.textContent,
  "第二列",
);
assert.equal(bulletMarkerWithChildrenState.selection.$from.parentOffset, 0);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    bulletMarkerWithChildrenState,
    (transaction) => {
      bulletMarkerWithChildrenState =
        bulletMarkerWithChildrenState.apply(transaction);
    },
  ),
  true,
);
const bulletListAfterTextMerge = bulletMarkerWithChildrenState.doc.child(0);
assert.equal(bulletListAfterTextMerge.type, schema.nodes.bullet_list);
assert.equal(bulletListAfterTextMerge.childCount, 2);
assert.equal(
  bulletListAfterTextMerge.child(0).firstChild?.textContent,
  "第一列第二列",
);
assert.equal(bulletListAfterTextMerge.child(0).childCount, 2);
assert.equal(
  bulletListAfterTextMerge.child(0).child(1).firstChild?.firstChild?.textContent,
  "子項目",
);
assert.equal(
  bulletMarkerWithChildrenState.selection.$from.parentOffset,
  "第一列".length,
);
assert.equal(
  undo(bulletMarkerWithChildrenState, (transaction) => {
    bulletMarkerWithChildrenState =
      bulletMarkerWithChildrenState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  bulletMarkerWithChildrenState.doc.toJSON(),
  bulletMarkerWithChildrenDocument.toJSON(),
);

const phantomNumberDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("第一列"),
    orderedItem("", [orderedItem("原本的子項目")]),
    orderedItem("第三列"),
  ]),
]);
let phantomNumberPosition = -1;
phantomNumberDocument.descendants((node, position) => {
  if (
    node.type === schema.nodes.list_item &&
    node.firstChild?.textContent === "" &&
    node.childCount === 2
  ) {
    phantomNumberPosition = position + 2;
  }
});
assert.notEqual(phantomNumberPosition, -1);

let phantomNumberState = EditorState.create({
  doc: phantomNumberDocument,
  selection: TextSelection.create(phantomNumberDocument, phantomNumberPosition),
  plugins: [history()],
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    phantomNumberState,
    (transaction) => {
      phantomNumberState = phantomNumberState.apply(transaction);
    },
  ),
  true,
);
const normalizedNumberList = phantomNumberState.doc.firstChild;
assert.equal(normalizedNumberList?.type, schema.nodes.ordered_list);
assert.equal(normalizedNumberList?.childCount, 3);
assert.deepEqual(
  Array.from({ length: normalizedNumberList?.childCount ?? 0 }, (_, index) =>
    normalizedNumberList?.child(index).firstChild?.textContent,
  ),
  ["第一列", "原本的子項目", "第三列"],
);
assert.equal(
  phantomNumberState.selection.$from.parent.textContent,
  "原本的子項目",
);
assert.equal(phantomNumberState.selection.$from.parentOffset, 0);
assert.equal(
  undo(phantomNumberState, (transaction) => {
    phantomNumberState = phantomNumberState.apply(transaction);
  }),
  true,
);
assert.deepEqual(phantomNumberState.doc.toJSON(), phantomNumberDocument.toJSON());

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

const forwardDeleteAfterSelectionDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("第一列"),
    item("第二列"),
    item("第三列"),
  ]),
]);
let forwardDeleteSelectionFrom = -1;
forwardDeleteAfterSelectionDocument.descendants((node, position) => {
  if (node.isText && node.text === "第二列") {
    forwardDeleteSelectionFrom = position;
  }
});
assert.notEqual(forwardDeleteSelectionFrom, -1);
let forwardDeleteAfterSelectionState = EditorState.create({
  doc: forwardDeleteAfterSelectionDocument,
  selection: TextSelection.create(
    forwardDeleteAfterSelectionDocument,
    forwardDeleteSelectionFrom,
    forwardDeleteSelectionFrom + "第二列".length,
  ),
  plugins: [history()],
});
forwardDeleteAfterSelectionState = forwardDeleteAfterSelectionState.apply(
  forwardDeleteAfterSelectionState.tr.deleteSelection(),
);
assert.equal(
  forwardDeleteAfterSelectionState.selection.$from.parent.textContent,
  "",
);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "forward")(
    forwardDeleteAfterSelectionState,
    (transaction) => {
      forwardDeleteAfterSelectionState =
        forwardDeleteAfterSelectionState.apply(transaction);
    },
  ),
  true,
);
assert.deepEqual(forwardDeleteAfterSelectionState.doc.toJSON(), {
  type: "doc",
  content: [
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "第一列" }] },
          ],
        },
      ],
    },
    { type: "paragraph" },
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "第三列" }] },
          ],
        },
      ],
    },
  ],
});
assert.equal(
  forwardDeleteAfterSelectionState.selection.$from.parent.type,
  schema.nodes.paragraph,
);
assert.equal(
  forwardDeleteAfterSelectionState.selection.$from.parent.textContent,
  "",
);
assert.equal(forwardDeleteAfterSelectionState.selection.$from.parentOffset, 0);
assert.equal(
  undo(forwardDeleteAfterSelectionState, (transaction) => {
    forwardDeleteAfterSelectionState =
      forwardDeleteAfterSelectionState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  forwardDeleteAfterSelectionState.doc.toJSON(),
  forwardDeleteAfterSelectionDocument.toJSON(),
  "Deleting selected item text and its marker must remain one undo event",
);

const nestedOrderedMarkerDocument = schema.nodes.doc.create(null, [
  schema.nodes.ordered_list.create(null, [
    orderedItem("第一層", [
      orderedItem("第二層上一項"),
      orderedItem("第二層目標"),
      orderedItem("第二層下一項"),
    ]),
  ]),
]);
let nestedOrderedMarkerPosition = -1;
nestedOrderedMarkerDocument.descendants((node, position) => {
  if (node.isText && node.text === "第二層目標") {
    nestedOrderedMarkerPosition = position;
  }
});
assert.notEqual(nestedOrderedMarkerPosition, -1);
let nestedOrderedMarkerState = EditorState.create({
  doc: nestedOrderedMarkerDocument,
  selection: TextSelection.create(
    nestedOrderedMarkerDocument,
    nestedOrderedMarkerPosition,
  ),
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    nestedOrderedMarkerState,
    (transaction) => {
      nestedOrderedMarkerState =
        nestedOrderedMarkerState.apply(transaction);
    },
  ),
  true,
);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    nestedOrderedMarkerState,
    (transaction) => {
      nestedOrderedMarkerState =
        nestedOrderedMarkerState.apply(transaction);
    },
  ),
  true,
);
const nestedOrderedOuterItem =
  nestedOrderedMarkerState.doc.firstChild?.firstChild;
assert.equal(nestedOrderedOuterItem?.childCount, 2);
assert.equal(nestedOrderedOuterItem?.child(1).type, schema.nodes.ordered_list);
assert.equal(nestedOrderedOuterItem?.child(1).childCount, 2);
assert.equal(
  nestedOrderedOuterItem?.child(1).child(0).firstChild?.textContent,
  "第二層上一項第二層目標",
);
assert.equal(
  nestedOrderedOuterItem?.child(1).child(1).firstChild?.textContent,
  "第二層下一項",
);
assert.equal(
  nestedOrderedMarkerState.selection.$from.parentOffset,
  "第二層上一項".length,
);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    nestedOrderedMarkerState,
  ),
  false,
);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    nestedOrderedMarkerState,
  ),
  false,
);

const deeplyNestedBulletMarkerDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("第一層", [
      item("第二層", [
        item("第三層上一項"),
        item("第三層目標"),
        item("第三層下一項"),
      ]),
    ]),
  ]),
]);
let deeplyNestedBulletMarkerPosition = -1;
deeplyNestedBulletMarkerDocument.descendants((node, position) => {
  if (node.isText && node.text === "第三層目標") {
    deeplyNestedBulletMarkerPosition = position;
  }
});
assert.notEqual(deeplyNestedBulletMarkerPosition, -1);
let deeplyNestedBulletMarkerState = EditorState.create({
  doc: deeplyNestedBulletMarkerDocument,
  selection: TextSelection.create(
    deeplyNestedBulletMarkerDocument,
    deeplyNestedBulletMarkerPosition,
  ),
});
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    deeplyNestedBulletMarkerState,
    (transaction) => {
      deeplyNestedBulletMarkerState =
        deeplyNestedBulletMarkerState.apply(transaction);
    },
  ),
  true,
);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    deeplyNestedBulletMarkerState,
    (transaction) => {
      deeplyNestedBulletMarkerState =
        deeplyNestedBulletMarkerState.apply(transaction);
    },
  ),
  true,
);
const secondLevelBulletItem =
  deeplyNestedBulletMarkerState.doc.firstChild?.firstChild?.child(1).firstChild;
assert.equal(secondLevelBulletItem?.childCount, 2);
assert.equal(secondLevelBulletItem?.child(1).childCount, 2);
assert.equal(
  secondLevelBulletItem?.child(1).child(0).firstChild?.textContent,
  "第三層上一項第三層目標",
);
assert.equal(
  secondLevelBulletItem?.child(1).child(1).firstChild?.textContent,
  "第三層下一項",
);
assert.equal(
  deeplyNestedBulletMarkerState.selection.$from.parentOffset,
  "第三層上一項".length,
);
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    deeplyNestedBulletMarkerState,
  ),
  false,
);
assert.equal(
  deleteAtListItemStart(schema.nodes.list_item, "backward")(
    deeplyNestedBulletMarkerState,
  ),
  false,
);

const editorSource = readFileSync(
  fileURLToPath(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url)),
  "utf8",
);
assert.match(
  editorSource,
  /const key = event\.key\.toLowerCase\(\);[\s\S]*?const shouldRedo =[\s\S]*?key === "z" && event\.shiftKey[\s\S]*?key === "y" && event\.ctrlKey/,
);
assert.match(editorSource, /event\.ctrlKey === event\.metaKey/);
assert.match(editorSource, /const command = shouldRedo \? redo : undo/);
assert.match(editorSource, /event\.inputType !== "historyUndo"/);
assert.match(editorSource, /event\.inputType === "historyRedo"/);
assert.match(editorSource, /createControlHistoryPlugin\(\),/);
assert.match(
  editorSource,
  /event\.key === "Backspace"[\s\S]*?mergeRemovedListMarkerLineBackward\(listItemType\)/,
);
assert.match(
  editorSource,
  /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?deleteEmptyParagraphAfterList\(listItemType\)/,
);
assert.match(
  editorSource,
  /event\.key === "Enter"[\s\S]*?insertEmptyFirstChildListItem\(listItemType\)[\s\S]*?moveToNextEmptyListItem\(listItemType\)/,
);
assert.match(
  editorSource,
  /insertedFirstChild = transaction\.docChanged[\s\S]*?view\.dispatch\(closeHistory\(view\.state\.tr\)\)/,
);
const singleListItemIndentPluginStart = editorSource.indexOf(
  "function createSingleListItemIndentPlugin()",
);
const singleListItemIndentPluginEnd = editorSource.indexOf(
  "function createControlHistoryPlugin()",
  singleListItemIndentPluginStart,
);
assert.ok(
  singleListItemIndentPluginStart >= 0 &&
    singleListItemIndentPluginEnd > singleListItemIndentPluginStart,
);
const singleListItemIndentPluginSource = editorSource.slice(
  singleListItemIndentPluginStart,
  singleListItemIndentPluginEnd,
);
assert.match(
  singleListItemIndentPluginSource,
  /event\.key === "Enter"[\s\S]*?!noteModeEnabledRef\.current[\s\S]*?moveToNextEmptyListItem\(listItemType\)/,
);
assert.ok(
  singleListItemIndentPluginSource.indexOf(
    'if (event.key === "Backspace" || event.key === "Delete")',
  ) <
    singleListItemIndentPluginSource.indexOf(
      "if (noteModeEnabledRef.current) return false;",
    ),
  "Note mode must still allow Backspace/Delete to remove empty list markers",
);

console.log("milkdown list indentation and deletion regression: PASS");

const tabUnderOtherKindSubListDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [
      paragraph("用流程圖建立尾牙抽獎發放流程"),
      schema.nodes.ordered_list.create(null, [
        orderedItem("取得中獎名單"),
        orderedItem("登錄中獎名單的獨立發放資料"),
      ]),
    ]),
    item("交付銀行"),
  ]),
]);
let tabUnderOtherKindPosition = -1;
tabUnderOtherKindSubListDocument.descendants((node, position) => {
  if (node.isText && node.text === "交付銀行") tabUnderOtherKindPosition = position;
});
assert.notEqual(tabUnderOtherKindPosition, -1);
let tabUnderOtherKindState = EditorState.create({
  doc: tabUnderOtherKindSubListDocument,
  selection: TextSelection.create(tabUnderOtherKindSubListDocument, tabUnderOtherKindPosition),
});
assert.equal(
  sinkSingleListItem(schema.nodes.list_item)(tabUnderOtherKindState, (transaction) => {
    tabUnderOtherKindState = tabUnderOtherKindState.apply(transaction);
  }),
  true,
);
const tabbedParentItem = tabUnderOtherKindState.doc.child(0).child(0);
assert.equal(tabUnderOtherKindState.doc.child(0).childCount, 1);
assert.equal(tabbedParentItem.childCount, 2);
assert.equal(tabbedParentItem.child(1).type, schema.nodes.ordered_list);
assert.equal(tabbedParentItem.child(1).childCount, 3);
assert.equal(tabbedParentItem.child(1).child(2).textContent, "交付銀行");
assert.equal(tabUnderOtherKindState.selection.$from.parent.textContent, "交付銀行");

const lineAfterNestedListDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [
      paragraph("用流程圖建立尾牙抽獎發放流程"),
      schema.nodes.ordered_list.create(null, [orderedItem("取得中獎名單")]),
    ]),
  ]),
  paragraph("登錄中獎名單的獨立發放資料"),
  schema.nodes.ordered_list.create(null, [orderedItem("建立應付單據")]),
]);
let lineAfterNestedListPosition = -1;
lineAfterNestedListDocument.descendants((node, position) => {
  if (node.isText && node.text === "登錄中獎名單的獨立發放資料") {
    lineAfterNestedListPosition = position;
  }
});
assert.notEqual(lineAfterNestedListPosition, -1);
let lineAfterNestedListState = EditorState.create({
  doc: lineAfterNestedListDocument,
  selection: TextSelection.create(lineAfterNestedListDocument, lineAfterNestedListPosition),
  plugins: [history()],
});
assert.equal(
  mergeRemovedListMarkerLineBackward(schema.nodes.list_item)(
    lineAfterNestedListState,
    (transaction) => {
      lineAfterNestedListState = lineAfterNestedListState.apply(transaction);
    },
  ),
  true,
);
assert.equal(lineAfterNestedListState.doc.childCount, 2);
const bulletAfterNestedMerge = lineAfterNestedListState.doc.child(0).child(0);
assert.equal(bulletAfterNestedMerge.child(0).textContent, "用流程圖建立尾牙抽獎發放流程");
assert.equal(
  bulletAfterNestedMerge.child(1).child(0).textContent,
  "取得中獎名單登錄中獎名單的獨立發放資料",
);
assert.equal(lineAfterNestedListState.doc.child(1).type, schema.nodes.ordered_list);
assert.equal(lineAfterNestedListState.doc.child(1).textContent, "建立應付單據");
assert.equal(
  lineAfterNestedListState.selection.$from.parent.textContent,
  "取得中獎名單登錄中獎名單的獨立發放資料",
);
assert.equal(lineAfterNestedListState.selection.$from.parentOffset, "取得中獎名單".length);
assert.equal(
  undo(lineAfterNestedListState, (transaction) => {
    lineAfterNestedListState = lineAfterNestedListState.apply(transaction);
  }),
  true,
);
assert.deepEqual(lineAfterNestedListState.doc.toJSON(), lineAfterNestedListDocument.toJSON());

// Shift+Tab on an item whose parent item holds a second list after its own
// (a numbered list next to a bullet sub-list).
const listAfterNumberedListDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [
      paragraph("上層項目 B"),
      schema.nodes.ordered_list.create(null, [
        orderedItem("編號項目 1"),
        orderedItem("編號項目 2"),
        orderedItem("編號項目 3"),
      ]),
      schema.nodes.bullet_list.create(null, [item("子項目 X")]),
    ]),
    item("項目 C"),
  ]),
]);
function listAfterNumberedListState(itemText: string, offset: number) {
  let position = -1;
  listAfterNumberedListDocument.descendants((node, nodePosition) => {
    if (node.isText && node.text === itemText) position = nodePosition + offset;
  });
  assert.notEqual(position, -1);
  return EditorState.create({
    doc: listAfterNumberedListDocument,
    selection: TextSelection.create(listAfterNumberedListDocument, position),
  });
}

let liftMiddleState = listAfterNumberedListState("編號項目 2", 2);
assert.equal(liftListItem(schema.nodes.list_item)(liftMiddleState, () => {}), false);
assert.equal(
  liftListItemBesideSiblingLists(schema.nodes.list_item)(liftMiddleState, (transaction) => {
    liftMiddleState = liftMiddleState.apply(transaction);
  }),
  true,
);
const liftedTopList = liftMiddleState.doc.child(0);
assert.equal(liftedTopList.childCount, 3);
const liftedParent = liftedTopList.child(0);
assert.equal(liftedParent.childCount, 2);
assert.equal(liftedParent.child(1).type, schema.nodes.ordered_list);
assert.equal(liftedParent.child(1).textContent, "編號項目 1");
const liftedItem = liftedTopList.child(1);
assert.equal(liftedItem.childCount, 3);
assert.equal(liftedItem.child(0).textContent, "編號項目 2");
assert.equal(liftedItem.child(1).type, schema.nodes.ordered_list);
assert.equal(liftedItem.child(1).textContent, "編號項目 3");
assert.equal(liftedItem.child(2).type, schema.nodes.bullet_list);
assert.equal(liftedItem.child(2).textContent, "子項目 X");
assert.equal(liftedTopList.child(2).textContent, "項目 C");
assert.equal(liftMiddleState.doc.textContent, listAfterNumberedListDocument.textContent);
assert.equal(liftMiddleState.selection.$from.parent.textContent, "編號項目 2");
assert.equal(liftMiddleState.selection.$from.parentOffset, 2);

let liftFirstState = listAfterNumberedListState("編號項目 1", 0);
assert.equal(
  liftListItemBesideSiblingLists(schema.nodes.list_item)(liftFirstState, (transaction) => {
    liftFirstState = liftFirstState.apply(transaction);
  }),
  true,
);
assert.equal(liftFirstState.doc.child(0).child(0).childCount, 1);
const firstLiftedItem = liftFirstState.doc.child(0).child(1);
assert.equal(firstLiftedItem.child(0).textContent, "編號項目 1");
assert.equal(firstLiftedItem.child(1).textContent, "編號項目 2編號項目 3");
assert.equal(firstLiftedItem.child(2).textContent, "子項目 X");
assert.equal(liftFirstState.selection.$from.parent.textContent, "編號項目 1");

// The last bullet item before a numbered list at the same level takes that list
// along as its children, instead of moving below it.
const itemBeforeNumberedListDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [
      paragraph("上層項目 A"),
      schema.nodes.bullet_list.create(null, [
        item("子項目 1"),
        item("子項目 2", [item("子項目 2-1")]),
      ]),
      schema.nodes.ordered_list.create(null, [
        orderedItem("編號項目 4"),
        orderedItem("編號項目 5"),
      ]),
      schema.nodes.bullet_list.create(null, [item("子項目 3")]),
    ]),
  ]),
]);
let itemBeforeNumberedListPosition = -1;
itemBeforeNumberedListDocument.descendants((node, position) => {
  if (node.isText && node.text === "子項目 2") {
    itemBeforeNumberedListPosition = position;
  }
});
let itemBeforeNumberedListState = EditorState.create({
  doc: itemBeforeNumberedListDocument,
  selection: TextSelection.create(itemBeforeNumberedListDocument, itemBeforeNumberedListPosition),
});
assert.equal(liftListItem(schema.nodes.list_item)(itemBeforeNumberedListState, () => {}), false);
assert.equal(
  liftListItemBesideSiblingLists(schema.nodes.list_item)(
    itemBeforeNumberedListState,
    (transaction) => {
      itemBeforeNumberedListState = itemBeforeNumberedListState.apply(transaction);
    },
  ),
  true,
);
const numberedListOwner = itemBeforeNumberedListState.doc.child(0);
assert.equal(numberedListOwner.childCount, 2);
assert.equal(numberedListOwner.child(0).childCount, 2);
assert.equal(numberedListOwner.child(0).child(1).textContent, "子項目 1");
const itemWithNumberedList = numberedListOwner.child(1);
assert.equal(itemWithNumberedList.childCount, 4);
assert.equal(itemWithNumberedList.child(0).textContent, "子項目 2");
assert.equal(itemWithNumberedList.child(1).type, schema.nodes.bullet_list);
assert.equal(itemWithNumberedList.child(1).textContent, "子項目 2-1");
assert.equal(itemWithNumberedList.child(2).type, schema.nodes.ordered_list);
assert.equal(itemWithNumberedList.child(2).textContent, "編號項目 4編號項目 5");
assert.equal(itemWithNumberedList.child(3).textContent, "子項目 3");
assert.equal(
  itemBeforeNumberedListState.doc.textContent,
  itemBeforeNumberedListDocument.textContent,
);
assert.equal(
  itemBeforeNumberedListState.selection.$from.parent.textContent,
  "子項目 2",
);

// Left to liftListItem when it can lift the item itself.
const plainNestedDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [item("上層", [item("下層")])]),
]);
let plainNestedPosition = -1;
plainNestedDocument.descendants((node, position) => {
  if (node.isText && node.text === "下層") plainNestedPosition = position;
});
const plainNestedState = EditorState.create({
  doc: plainNestedDocument,
  selection: TextSelection.create(plainNestedDocument, plainNestedPosition),
});
assert.equal(liftListItem(schema.nodes.list_item)(plainNestedState, () => {}), true);
assert.equal(
  liftListItemBesideSiblingLists(schema.nodes.list_item)(plainNestedState, () => {
    assert.fail("liftListItem already handles this item");
  }),
  false,
);

// Tab on the line below an empty item moves only that line under the empty
// item; the empty item stays a line of its own.
const tabUnderEmptyItemDocument = schema.nodes.doc.create(null, [
  schema.nodes.bullet_list.create(null, [
    item("資料來源應附在文章結尾"),
    item(""),
    item("僅須附資料來源即可"),
    item("嚴禁將蒐集資料過程作為報告內容"),
  ]),
]);
let tabUnderEmptyItemPosition = -1;
tabUnderEmptyItemDocument.descendants((node, position) => {
  if (node.isText && node.text === "僅須附資料來源即可") {
    tabUnderEmptyItemPosition = position;
  }
});
assert.notEqual(tabUnderEmptyItemPosition, -1);
let tabUnderEmptyItemState = EditorState.create({
  doc: tabUnderEmptyItemDocument,
  selection: TextSelection.create(tabUnderEmptyItemDocument, tabUnderEmptyItemPosition),
});
assert.equal(
  sinkSingleListItem(schema.nodes.list_item)(tabUnderEmptyItemState, (transaction) => {
    tabUnderEmptyItemState = tabUnderEmptyItemState.apply(transaction);
  }),
  true,
);
assert.deepEqual(
  tabUnderEmptyItemState.doc.toJSON(),
  schema.nodes.doc
    .create(null, [
      schema.nodes.bullet_list.create(null, [
        item("資料來源應附在文章結尾"),
        item("", [item("僅須附資料來源即可")]),
        item("嚴禁將蒐集資料過程作為報告內容"),
      ]),
    ])
    .toJSON(),
);
assert.equal(
  tabUnderEmptyItemState.selection.$from.parent.textContent,
  "僅須附資料來源即可",
);
// The empty item's own line is not a blank line between lists, so the
// writeback adds no blank lines elsewhere in the document.
assert.equal(
  preserveSerializedEmptyParagraphListBoundaries(
    "- 前一段清單\n\n- 後一段清單",
    tabUnderEmptyItemState.doc,
  ),
  "- 前一段清單\n\n- 後一段清單",
);
