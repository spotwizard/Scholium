import type { NodeType } from "@milkdown/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/prose/schema-list";
import {
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from "@milkdown/prose/state";

export function deleteAtListItemStart(
  itemType: NodeType,
  direction: "backward" | "forward",
): Command {
  return (state, dispatch, view) => {
    const { selection } = state;
    if (
      !(selection instanceof TextSelection) ||
      !selection.empty ||
      selection.$from.parentOffset !== 0
    ) {
      return false;
    }

    let itemDepth = selection.$from.depth;
    while (itemDepth > 0 && selection.$from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }
    if (itemDepth === 0) return false;

    const item = selection.$from.node(itemDepth);
    const paragraph = selection.$from.parent;
    if (item.firstChild !== paragraph) return false;

    if (paragraph.content.size > 0) {
      if (direction === "backward") return true;

      const firstInlineNode = paragraph.firstChild;
      if (!firstInlineNode) return true;
      const deleteSize = firstInlineNode.isText
        ? (Array.from(firstInlineNode.text ?? "")[0]?.length ?? 1)
        : firstInlineNode.nodeSize;

      if (dispatch) {
        dispatch(
          state.tr
            .delete(selection.from, selection.from + deleteSize)
            .scrollIntoView(),
        );
      }
      return true;
    }

    // Keep an empty parent item when it still owns nested content.
    if (item.childCount > 1) return true;

    const listDepth = itemDepth - 1;
    const list = selection.$from.node(listDepth);
    if (list.childCount === 1) {
      return liftListItem(itemType)(state, dispatch, view);
    }

    if (dispatch) {
      const itemFrom = selection.$from.before(itemDepth);
      const tr = state.tr.delete(itemFrom, itemFrom + item.nodeSize);
      const selectionPosition = Math.min(itemFrom, tr.doc.content.size);
      tr.setSelection(
        Selection.near(
          tr.doc.resolve(selectionPosition),
          direction === "forward" ? 1 : -1,
        ),
      );
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function sinkSingleListItem(itemType: NodeType): Command {
  return (state, dispatch, view) => {
    if (!state.selection.empty) return false;

    let sinkTransaction: Transaction | null = null;
    if (
      !sinkListItem(itemType)(
        state,
        (transaction) => {
          sinkTransaction = transaction;
        },
        view,
      )
    ) {
      return false;
    }

    if (!dispatch || !sinkTransaction) return true;

    const combinedTransaction = sinkTransaction as Transaction;
    const sunkState = state.apply(combinedTransaction);
    const { $from } = sunkState.selection;
    let itemDepth = $from.depth;
    while (itemDepth > 0 && $from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }

    const selectedItem = itemDepth > 0 ? $from.node(itemDepth) : null;
    const childList = selectedItem?.lastChild;
    if (!childList || childList.firstChild?.type !== itemType) {
      dispatch(combinedTransaction.scrollIntoView());
      return true;
    }

    const childListPosition = $from.end(itemDepth) - childList.nodeSize;
    const firstChildPosition = childListPosition + 1;
    let lastChildPosition = firstChildPosition;
    for (let index = 0; index < childList.childCount - 1; index += 1) {
      lastChildPosition += childList.child(index).nodeSize;
    }

    const childSelection = TextSelection.create(
      sunkState.doc,
      firstChildPosition + 2,
      lastChildPosition + 2,
    );
    const childState = sunkState.apply(sunkState.tr.setSelection(childSelection));
    let liftTransaction: Transaction | null = null;
    if (
      !liftListItem(itemType)(
        childState,
        (transaction) => {
          liftTransaction = transaction;
        },
        view,
      ) ||
      !liftTransaction
    ) {
      dispatch(combinedTransaction.scrollIntoView());
      return true;
    }

    const originalSelection = sunkState.selection;
    for (const step of (liftTransaction as Transaction).steps) {
      combinedTransaction.step(step);
    }
    combinedTransaction.setSelection(
      TextSelection.create(
        combinedTransaction.doc,
        originalSelection.from,
        originalSelection.to,
      ),
    );
    dispatch(combinedTransaction.scrollIntoView());
    return true;
  };
}
