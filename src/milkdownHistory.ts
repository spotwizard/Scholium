import { isHistoryTransaction } from "@milkdown/prose/history";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/prose/state";

export function correctHistoryCaretAfterRestoredText(
  transactions: readonly Transaction[],
  previousState: EditorState,
  nextState: EditorState,
) {
  const historyTransaction = transactions.find(isHistoryTransaction);
  if (
    !historyTransaction ||
    historyTransaction.doc.content.size <= previousState.doc.content.size
  ) {
    return null;
  }

  let restoredTo = Number.NEGATIVE_INFINITY;
  historyTransaction.steps.forEach((step, stepIndex) => {
    const remainingMapping = historyTransaction.mapping.slice(stepIndex + 1);
    step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      if (newTo <= newFrom) return;
      restoredTo = Math.max(restoredTo, remainingMapping.map(newTo, -1));
    });
  });

  if (!Number.isFinite(restoredTo)) return null;

  const resolvedCaret = nextState.doc.resolve(restoredTo);
  const selection =
    resolvedCaret.parent.inlineContent
      ? TextSelection.create(nextState.doc, restoredTo)
      : TextSelection.near(resolvedCaret, -1);

  if (selection.eq(nextState.selection)) return null;

  return nextState.tr.setSelection(selection);
}
