import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { history, redoNoScroll, undo, undoNoScroll } from "@milkdown/prose/history";
import { Schema } from "@milkdown/prose/model";
import { EditorState, Plugin, type Transaction } from "@milkdown/prose/state";
import { correctHistoryCaretAfterRestoredText } from "../src/milkdownHistory.ts";

test("diagram history restores text without requesting scroll to the outer document selection", () => {
  const source = readFileSync(new URL("../src/MilkdownMarkdownEditor.tsx", import.meta.url), "utf8");
  const adapter = source.slice(source.indexOf("const disposeReadingDiagrams ="), source.indexOf("const crepe = new Crepe"));
  assert.match(adapter, /\(shouldRedo \? redoNoScroll : undoNoScroll\)\(view\.state, view\.dispatch\)/);

  const schema = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { content: "text*", group: "block" }, code_block: { content: "text*", group: "block", code: true }, text: {} } });
  const definition = 'flowchart TD\nJ --> K{"是否趕不上訂位?"}';
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("圖表前的內文")), schema.node("code_block", null, schema.text(definition))]);
  let state = EditorState.create({ schema, doc, plugins: [history(), new Plugin({ appendTransaction: correctHistoryCaretAfterRestoredText })] });
  const from = doc.child(0).nodeSize + 1 + definition.indexOf("不上");
  state = state.apply(state.tr.delete(from, from + 2));
  const deleted = state.doc;
  const commands = [undoNoScroll, redoNoScroll, undoNoScroll, redoNoScroll];
  for (const [index, command] of commands.entries()) {
    let transaction: Transaction | undefined;
    assert.equal(command(state, tr => { transaction = tr; state = state.apply(tr); }), true);
    assert.equal(transaction?.scrolledIntoView, false);
    assert.ok(state.doc.eq(index % 2 === 0 ? doc : deleted));
  }

  // The normal document command still reveals its restored selection.
  let normalScroll = false;
  undo(state, transaction => { normalScroll = transaction.scrolledIntoView; });
  assert.equal(normalScroll, true);
  assert.match(source, /const command = shouldRedo \? redo : undo/);
});
