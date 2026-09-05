import assert from "node:assert/strict";
import { history, redo, undo } from "@milkdown/prose/history";
import { Schema } from "@milkdown/prose/model";
import { EditorState, Plugin, TextSelection } from "@milkdown/prose/state";
import { correctHistoryCaretAfterRestoredText } from "../src/milkdownHistory.ts";
import { parseMarkdownPreviewBlocks, removeSelectedPreviewSoftLine, replaceMarkdownBlock } from "../src/markdownPreview.ts";
import {
  createNoteEditorHistory,
  noteEditorHistoryGroupDelayMs,
  recordNoteEditorChange,
  takeNoteEditorRedo,
  takeNoteEditorUndo,
} from "../src/noteEditorHistory.ts";

let noteHistory = createNoteEditorHistory();
let noteValue = "復原文字";
for (const [index, character] of Array.from("甲乙丙").entries()) {
  const nextValue = noteValue + character;
  noteHistory = recordNoteEditorChange(noteHistory, noteValue, nextValue, {
    input: true,
    timestamp: index * 100,
  });
  noteValue = nextValue;
}

const groupedTypingUndo = takeNoteEditorUndo(noteHistory, noteValue);
assert.equal(groupedTypingUndo.snapshot?.value, "復原文字");
assert.equal(groupedTypingUndo.snapshot?.caretSourcePosition, "復原文字".length);
assert.equal(groupedTypingUndo.history.undoStack.length, 0);
const groupedTypingRedo = takeNoteEditorRedo(
  groupedTypingUndo.history,
  groupedTypingUndo.snapshot?.value ?? "",
);
assert.equal(groupedTypingRedo.snapshot?.value, "復原文字甲乙丙");
assert.equal(
  groupedTypingRedo.snapshot?.caretSourcePosition,
  "復原文字甲乙丙".length,
);

let pausedHistory = createNoteEditorHistory();
pausedHistory = recordNoteEditorChange(pausedHistory, "原文", "原文甲", {
  input: true,
  timestamp: 0,
});
pausedHistory = recordNoteEditorChange(pausedHistory, "原文甲", "原文甲乙", {
  input: true,
  timestamp: noteEditorHistoryGroupDelayMs + 1,
});
assert.equal(pausedHistory.undoStack.length, 2);

let deletionHistory = createNoteEditorHistory();
let deletionValue = "前復原文字";
for (let index = 0; index < 4; index += 1) {
  const nextValue = deletionValue.slice(0, -1);
  deletionHistory = recordNoteEditorChange(
    deletionHistory,
    deletionValue,
    nextValue,
    { input: true, timestamp: index * 100 },
  );
  deletionValue = nextValue;
}
const groupedDeletionUndo = takeNoteEditorUndo(deletionHistory, deletionValue);
assert.equal(groupedDeletionUndo.snapshot?.value, "前復原文字");
assert.equal(groupedDeletionUndo.snapshot?.caretSourcePosition, "前復原文字".length);
const groupedDeletionRedo = takeNoteEditorRedo(
  groupedDeletionUndo.history,
  groupedDeletionUndo.snapshot?.value ?? "",
);
assert.equal(groupedDeletionRedo.snapshot?.value, "前");
assert.equal(groupedDeletionRedo.snapshot?.caretSourcePosition, "前".length);

const fullLineBefore = "前段內容\n\n禁止用迎合人類的模式回覆\n\n後段內容";
const fullLineBlock = parseMarkdownPreviewBlocks(fullLineBefore)[1];
const fullLineAfter = replaceMarkdownBlock(fullLineBefore, fullLineBlock, "");
assert.equal(fullLineAfter, "前段內容\n\n\n\n後段內容");
const fullLinePrefixLength = "前段內容\n\n".length;
const fullLineHistory = recordNoteEditorChange(
  createNoteEditorHistory(),
  fullLineBefore,
  fullLineAfter,
);
const fullLineUndo = takeNoteEditorUndo(fullLineHistory, fullLineAfter);
assert.equal(fullLineUndo.snapshot?.value, fullLineBefore);
assert.equal(
  fullLineUndo.snapshot?.caretSourcePosition,
  fullLinePrefixLength + "禁止用迎合人類的模式回覆".length,
);
const fullLineRedo = takeNoteEditorRedo(
  fullLineUndo.history,
  fullLineUndo.snapshot?.value ?? "",
);
assert.equal(fullLineRedo.snapshot?.value, fullLineAfter);
assert.equal(fullLineRedo.snapshot?.caretSourcePosition, fullLinePrefixLength);
const restoredEmptyBlock = parseMarkdownPreviewBlocks(fullLineRedo.snapshot!.value, {
  preserveEmptyParagraphs: true,
}).find((block) => block.key === fullLineBlock.key);
assert.deepEqual(restoredEmptyBlock, {
  kind: "paragraph", key: fullLineBlock.key, startLine: 2, endLine: 2, text: "",
});
const typedAfterRedo = replaceMarkdownBlock(fullLineRedo.snapshot!.value, restoredEmptyBlock!, "重新輸入");
assert.equal(typedAfterRedo, "前段內容\n\n重新輸入\n\n後段內容");

const fullLineWithBoundaryAfter = "前段內容\n\n後段內容";
const fullLineWithBoundaryHistory = recordNoteEditorChange(
  createNoteEditorHistory(),
  fullLineBefore,
  fullLineWithBoundaryAfter,
);
const fullLineWithBoundaryUndo = takeNoteEditorUndo(
  fullLineWithBoundaryHistory,
  fullLineWithBoundaryAfter,
);
assert.equal(fullLineWithBoundaryUndo.snapshot?.value, fullLineBefore);
const fullLineWithBoundaryRedo = takeNoteEditorRedo(
  fullLineWithBoundaryUndo.history,
  fullLineWithBoundaryUndo.snapshot?.value ?? "",
);
assert.equal(fullLineWithBoundaryRedo.snapshot?.value, fullLineWithBoundaryAfter);

const cutBefore = "前段內容<br>💡 建議：<br>後段內容";
const cutText = "💡 建議：";
const cutFrom = cutBefore.indexOf(cutText);
const cutRenderedBefore = "前段內容\n💡 建議：\n後段內容";
const cutRenderedLineFrom = "前段內容\n".length;
const cutRenderedLineTo = cutRenderedLineFrom + cutText.length;
const cutRenderedAfter = removeSelectedPreviewSoftLine({
  from: cutRenderedLineFrom - 1,
  selectedText: cutText,
  text: cutRenderedBefore,
  to: cutRenderedLineTo,
});
assert.deepEqual(cutRenderedAfter, {
  caretOffset: cutRenderedLineFrom,
  text: "前段內容\n\n後段內容",
});
const cutAfter = cutBefore.slice(0, cutFrom) + cutBefore.slice(cutFrom + cutText.length);
const cutHistory = recordNoteEditorChange(
  createNoteEditorHistory(),
  cutBefore,
  cutAfter,
);
assert.equal(cutAfter, "前段內容<br><br>後段內容");
const cutUndo = takeNoteEditorUndo(cutHistory, cutAfter);
assert.equal(cutUndo.snapshot?.value, cutBefore);
assert.equal(cutUndo.snapshot?.caretSourcePosition, cutFrom + cutText.length);
const cutRedo = takeNoteEditorRedo(
  cutUndo.history,
  cutUndo.snapshot?.value ?? "",
);
assert.equal(cutRedo.snapshot?.value, cutAfter);
assert.equal(cutRedo.snapshot?.caretSourcePosition, cutFrom);

for (const [emptyLineBefore, emptyLineAfter] of [
  ["前段內容<br>\n\n後段內容", "前段內容\n\n後段內容"],
  ["前段內容\n\n<br>\n\n後段內容", "前段內容\n\n\n\n後段內容"],
] as const) {
  const emptyLineHistory = recordNoteEditorChange(
    createNoteEditorHistory(),
    emptyLineBefore,
    emptyLineAfter,
  );
  const emptyLineUndo = takeNoteEditorUndo(emptyLineHistory, emptyLineAfter);
  assert.equal(emptyLineUndo.snapshot?.value, emptyLineBefore);
  const emptyLineRedo = takeNoteEditorRedo(
    emptyLineUndo.history,
    emptyLineUndo.snapshot?.value ?? "",
  );
  assert.equal(emptyLineRedo.snapshot?.value, emptyLineAfter);
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: { strong: {} },
});
const restoredText = "前復原文字後";
const restoredDocument = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, schema.text(restoredText)),
]);
const restoredFrom = 2;
const restoredTo = restoredFrom + "復原文字".length;
const historyCaretPlugin = new Plugin({
  appendTransaction: correctHistoryCaretAfterRestoredText,
});
let restoredState = EditorState.create({
  doc: restoredDocument,
  selection: TextSelection.create(restoredDocument, restoredFrom, restoredTo),
  plugins: [history(), historyCaretPlugin],
});
restoredState = restoredState.apply(restoredState.tr.deleteSelection());
assert.equal(
  undo(restoredState, (transaction) => {
    restoredState = restoredState.applyTransaction(transaction).state;
  }),
  true,
);
assert.equal(restoredState.doc.textContent, restoredText);
assert.equal(restoredState.selection.empty, true);
assert.equal(restoredState.selection.$from.parentOffset, "前復原文字".length);

let caretDeletionState = EditorState.create({
  doc: restoredDocument,
  selection: TextSelection.create(restoredDocument, restoredFrom),
  plugins: [history(), historyCaretPlugin],
});
caretDeletionState = caretDeletionState.apply(
  caretDeletionState.tr.delete(restoredFrom, restoredTo),
);
assert.equal(
  undo(caretDeletionState, (transaction) => {
    caretDeletionState = caretDeletionState.applyTransaction(transaction).state;
  }),
  true,
);
assert.equal(caretDeletionState.doc.textContent, restoredText);
assert.equal(caretDeletionState.selection.empty, true);
assert.equal(
  caretDeletionState.selection.$from.parentOffset,
  "前復原文字".length,
);

const insertedDocument = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create(null, schema.text("前後")),
]);
let insertedState = EditorState.create({
  doc: insertedDocument,
  selection: TextSelection.create(insertedDocument, restoredFrom),
  plugins: [history(), historyCaretPlugin],
});
insertedState = insertedState.apply(
  insertedState.tr.insertText("新增文字", restoredFrom),
);
assert.equal(
  undo(insertedState, (transaction) => {
    insertedState = insertedState.applyTransaction(transaction).state;
  }),
  true,
);
assert.equal(insertedState.doc.textContent, "前後");
assert.equal(
  redo(insertedState, (transaction) => {
    insertedState = insertedState.applyTransaction(transaction).state;
  }),
  true,
);
assert.equal(insertedState.doc.textContent, "前新增文字後");
assert.equal(insertedState.selection.empty, true);
assert.equal(insertedState.selection.$from.parentOffset, "前新增文字".length);

let formattedState = EditorState.create({
  doc: restoredDocument,
  selection: TextSelection.create(restoredDocument, restoredFrom, restoredTo),
  plugins: [history(), historyCaretPlugin],
});
formattedState = formattedState.apply(
  formattedState.tr.addMark(restoredFrom, restoredTo, schema.marks.strong.create()),
);
assert.equal(
  undo(formattedState, (transaction) => {
    formattedState = formattedState.applyTransaction(transaction).state;
  }),
  true,
);
assert.equal(formattedState.selection.empty, false);
assert.equal(formattedState.selection.from, restoredFrom);
assert.equal(formattedState.selection.to, restoredTo);

console.log("editor undo behavior regression: PASS");
