import assert from "node:assert/strict";
import { EditorState as SourceState } from "@codemirror/state";
import { history as sourceHistory, undo as sourceUndo, redo as sourceRedo } from "@codemirror/commands";
import { Schema } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { closeHistory, history, undo, redo } from "@milkdown/prose/history";
import { fileInsertionRange, fileLinkMarkdown, previewFileInsertion, siblingFileLink, sourceFileInsertion } from "../src/fileInsertion.ts";
import { resolveMarkdownLinkTarget } from "../src/markdownLinkTarget.ts";
import { Ctx, Container, Clock } from "@milkdown/kit/ctx";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { configureLinkBoundary } from "../src/milkdownLinkBoundary.ts";

const file = siblingFileLink("中文 [規格](1) #100%.md");
for (const source of ["local", "dropbox"] as const) {
  assert.deepEqual(resolveMarkdownLinkTarget(file.href, "/notes/current.md", source), {
    kind: "document", path: "/notes/中文 [規格](1) #100%.md",
  });
}
assert.equal(siblingFileLink("https:example.md").href, "https%3Aexample.md");
assert.equal(fileLinkMarkdown(siblingFileLink("[one]*two*.md")), "[\\[one\\]\\*two\\*.md](%5Bone%5D%2Atwo%2A.md)");

let source = SourceState.create({ doc: "before after", selection: { anchor: 7 }, extensions: [sourceHistory()] });
const beforeMenuSelection = source.selection;
const deferredRange = fileInsertionRange(source.selection.main, 12);
assert.equal(source.selection, beforeMenuSelection, "opening a menu must not move the caret");
assert.deepEqual(deferredRange, { from: 12, to: 12 });
assert.equal(sourceFileInsertion(source, file, deferredRange).state.doc.toString(), `before after${fileLinkMarkdown(file)}`);
assert.deepEqual(fileInsertionRange({ from: 2, to: 5 }, 3), { from: 2, to: 5 });
assert.deepEqual(fileInsertionRange({ from: 2, to: 5 }, 10), { from: 10, to: 10 });
source = source.update(sourceFileInsertion(source, file)).state;
assert.equal(source.doc.toString(), `before ${fileLinkMarkdown(file)}after`);
assert.equal(source.selection.main.head, 7 + fileLinkMarkdown(file).length);
const sourceTarget = { get state() { return source; }, dispatch: (tr: ReturnType<SourceState["update"]>) => { source = tr.state; } };
assert.ok(sourceUndo(sourceTarget));
assert.equal(source.doc.toString(), "before after");
assert.ok(sourceRedo(sourceTarget));
assert.equal(source.doc.toString(), `before ${fileLinkMarkdown(file)}after`);

const ctx = new Ctx(new Container(), new Clock());
ctx.inject(linkSchema.key);
configureLinkBoundary(ctx);
const schema = new Schema({
  nodes: { doc: { content: "block+" }, paragraph: { content: "inline*", group: "block" }, text: { group: "inline" }, code_block: { content: "text*", group: "block", marks: "", code: true } },
  marks: { link: ctx.get(linkSchema.key)(ctx) },
});
let state = EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("before after"))]), plugins: [history()] });
state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)));
const previewSelection = state.selection;
const deferredSelection = TextSelection.create(state.doc, 13);
assert.equal(previewFileInsertion(state, file, deferredSelection)!.doc.textContent, `before after${file.name}`);
assert.equal(state.selection, previewSelection, "preparing insertion must preserve the current selection");
state = state.apply(previewFileInsertion(state, file)!);
state = state.apply(closeHistory(state.tr));
assert.equal(state.doc.textContent, `before ${file.name}after`);
assert.equal(state.doc.child(0).child(1).marks[0].attrs.href, file.href);
assert.deepEqual(state.storedMarks, []);
const dispatch = (tr: Parameters<EditorState["apply"]>[0]) => { state = state.apply(tr); };
assert.ok(undo(state, dispatch));
assert.equal(state.doc.textContent, "before after");
assert.equal(state.selection.head, 8);
assert.ok(redo(state, dispatch));
assert.equal(state.doc.textContent, `before ${file.name}after`);
state = state.apply(state.tr.insertText("X"));
assert.equal(state.doc.child(0).child(2).marks.length, 0, "typing after insertion must not extend the link");
const codeState = EditorState.create({ doc: schema.node("doc", null, [schema.node("code_block", null, schema.text("literal"))]) });
assert.equal(previewFileInsertion(codeState, file), null);

console.log("file insertion, encoded relative links, caret and undo/redo: PASS");
