import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/prose/state";
import { closeHistory, redo, undo } from "@milkdown/prose/history";
import { configureLinkBoundary } from "../src/milkdownLinkBoundary";
import { previewFileInsertion, siblingFileLink } from "../src/fileInsertion";
export { preserveEditorContextMenuSelection } from "../src/contextMenuSelection";

export async function testLinkBoundary() {
  function check(condition: unknown, label: string): asserts condition {
    if (!condition) throw new Error(label);
  }
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const crepe = new Crepe({ root, defaultValue: "- 根據 ", features: { [CrepeFeature.Toolbar]: false } });
  crepe.editor.config(configureLinkBoundary);
  await crepe.create();
  try {
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const file = siblingFileLink("應付單據-匯款給廠商.mov");
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dispatch(previewFileInsertion(view.state, file)!);
    view.dispatch(closeHistory(view.state.tr));
    const linkEnd = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, linkEnd - 1)));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, linkEnd)));
    view.focus();
    check(document.execCommand("insertText", false, "   影片"), "native text insertion accepted");
    await new Promise((resolve) => setTimeout(resolve, 30));
    check(root.querySelector("a")?.textContent === file.name, "native typing must not extend the link");
    const suffix = view.state.selection.$from.parent.lastChild!;
    // WebKit uses nonbreaking spaces to preserve consecutive spaces in contenteditable.
    check(/^[ \u00a0]{3}影片$/.test(suffix.textContent), "all three typed spaces and text remain");
    check(!view.state.schema.marks.link.isInSet(suffix.marks), "suffix is plain text");
    check(view.dom.textContent?.endsWith(suffix.textContent), "suffix is present in the editor DOM");
    check(!document.getSelection()?.anchorNode?.parentElement?.closest("a"), "caret is outside the link");
    check(crepe.getMarkdown().includes(`](${file.href})${suffix.textContent}`), "saved Markdown places suffix outside the link");
    check(undo(view.state, view.dispatch), "undo suffix");
    check(!view.dom.textContent?.endsWith("影片"), "undo removed suffix only");
    check(root.querySelector("a")?.textContent === file.name, "undo retains original link");
    check(redo(view.state, view.dispatch), "redo suffix");
    check(root.querySelector("a")?.textContent === file.name, "redo retains link boundary");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, linkEnd - 1)));
    view.focus();
    check(document.execCommand("insertText", false, "X"), "edit inside link");
    await new Promise((resolve) => setTimeout(resolve, 30));
    check(root.querySelector("a")?.textContent?.includes("X"), "inner editing remains part of link");
    check(root.querySelector("a")?.getAttribute("href") === file.href, "link destination unchanged");
    return true;
  } finally {
    await crepe.destroy();
  }
}
