import assert from "node:assert/strict";
import test from "node:test";
import { Schema, type Node as ProseMirrorNode } from "@milkdown/prose/model";
import { liftListItem } from "@milkdown/prose/schema-list";
import { EditorState, Plugin, TextSelection } from "@milkdown/prose/state";
import { bulletListItemMarkerFix } from "../src/milkdownListIndent.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    bullet_list: { content: "list_item+", group: "block" },
    ordered_list: { content: "list_item+", group: "block", attrs: { order: { default: 1 } } },
    list_item: {
      content: "paragraph block*",
      attrs: { label: { default: "•" }, listType: { default: "bullet" } },
    },
  },
});
const { bullet_list, ordered_list, list_item, paragraph } = schema.nodes;
const bulletItem = (text: string, children: ProseMirrorNode[] = []) =>
  list_item.create(null, [paragraph.create(null, schema.text(text)), ...children]);
const orderedItem = (text: string, index: number) =>
  list_item.create({ label: `${index}.`, listType: "ordered" }, [
    paragraph.create(null, schema.text(text)),
  ]);

const markerPlugin = new Plugin({
  appendTransaction: (_transactions, _oldState, newState) =>
    bulletListItemMarkerFix(newState, list_item, bullet_list),
});

function textPosition(doc: ProseMirrorNode, text: string) {
  let found = -1;
  doc.descendants((node, position) => {
    if (node.isText && node.text === text) found = position;
  });
  assert.notEqual(found, -1);
  return found;
}

test("an item lifted out of a numbered sub-list into a bullet list shows a bullet", () => {
  const doc = schema.nodes.doc.create(null, [
    bullet_list.create(null, [
      bulletItem("用流程圖建立尾牙抽獎發放流程", [
        ordered_list.create(null, [
          orderedItem("取得中獎名單", 1),
          orderedItem("登錄中獎名單的獨立發放資料", 2),
          orderedItem("交付銀行", 3),
        ]),
      ]),
    ]),
  ]);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, textPosition(doc, "交付銀行")),
    plugins: [markerPlugin],
  });

  assert.equal(liftListItem(list_item)(state, (tr) => (state = state.apply(tr))), true);

  const bulletList = state.doc.child(0);
  assert.equal(bulletList.childCount, 2);
  assert.equal(bulletList.child(1).textContent, "交付銀行");
  assert.deepEqual({ ...bulletList.child(1).attrs }, { label: "•", listType: "bullet" });
  const subList = bulletList.child(0).child(1);
  assert.equal(subList.type, ordered_list);
  assert.equal(subList.child(1).attrs.listType, "ordered");
});

test("a bullet list whose first item is numbered is left for Milkdown to renumber", () => {
  const doc = schema.nodes.doc.create(null, [
    bullet_list.create(null, [orderedItem("第一列", 1), orderedItem("第二列", 2)]),
  ]);
  const state = EditorState.create({ doc });
  assert.equal(bulletListItemMarkerFix(state, list_item, bullet_list), null);
});
