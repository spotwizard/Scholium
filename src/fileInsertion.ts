import { isolateHistory } from "@codemirror/commands";
import type { EditorState as SourceState } from "@codemirror/state";
import { closeHistory } from "@milkdown/prose/history";
import { TextSelection, type EditorState } from "@milkdown/prose/state";

export type InsertableFile = { name: string; href: string };

export function siblingFileLink(name: string): InsertableFile {
  // Encode the entire filename, including colons, so it cannot become a URL scheme.
  return { name, href: encodeURIComponent(name).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`) };
}

export function fileLinkMarkdown(file: InsertableFile) {
  const label = file.name.replace(/[\\`*_{}\[\]<>!|~]/g, "\\$&").replace(/[\r\n]/g, " ");
  return `[${label}](${file.href})`;
}

export function fileInsertionRange(selection: { from: number; to: number }, position: number) {
  return position < selection.from || position > selection.to || selection.from === selection.to
    ? { from: position, to: position }
    : { from: selection.from, to: selection.to };
}

export function sourceFileInsertion(state: SourceState, file: InsertableFile, range: { from: number; to: number } = state.selection.main) {
  const { from, to } = range;
  const insert = fileLinkMarkdown(file);
  return state.update({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.insert",
    scrollIntoView: true,
  });
}

export function previewFileInsertion(state: EditorState, file: InsertableFile, selection = state.selection) {
  const { schema } = state;
  if (!selection.$from.parent.type.allowsMarkType(schema.marks.link)) return null;
  const link = schema.text(file.name.replace(/[\r\n]/g, " "), [schema.marks.link.create({ href: file.href })]);
  const transaction = closeHistory(state.tr).setSelection(selection).replaceSelectionWith(link, false);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to)));
  transaction.setStoredMarks([]);
  return transaction.scrollIntoView();
}
