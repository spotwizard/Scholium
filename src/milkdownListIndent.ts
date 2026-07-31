import type { Node as ProseMirrorNode, NodeType } from "@milkdown/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/prose/schema-list";
import {
  TextSelection,
  type Command,
  type Transaction,
} from "@milkdown/prose/state";

export function mergeRemovedListMarkerLineBackward(
  itemType: NodeType,
): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (
      !(state.selection instanceof TextSelection) ||
      !state.selection.empty ||
      $from.parentOffset !== 0
    ) {
      return false;
    }

    const paragraph = $from.parent;
    const containerDepth = $from.depth - 1;
    const paragraphIndex = $from.index(containerDepth);
    const container = $from.node(containerDepth);
    if (paragraphIndex > 0) {
      const previousList = container.child(paragraphIndex - 1);
      const previousItem = previousList.lastChild;
      const previousParagraph = previousItem?.firstChild;
      if (
        previousItem?.type === itemType &&
        previousParagraph?.type === paragraph.type
      ) {
        if (!dispatch) return true;

        const mergedParagraph = previousParagraph.copy(
          previousParagraph.content.append(paragraph.content),
        );
        const itemBlocks: ProseMirrorNode[] = [mergedParagraph];
        for (let index = 1; index < previousItem.childCount; index += 1) {
          itemBlocks.push(previousItem.child(index));
        }
        const mergedItem = previousItem.type.create(
          previousItem.attrs,
          itemBlocks,
          previousItem.marks,
        );
        const listItems: ProseMirrorNode[] = [];
        for (let index = 0; index < previousList.childCount - 1; index += 1) {
          listItems.push(previousList.child(index));
        }
        listItems.push(mergedItem);
        const mergedList = previousList.type.create(
          previousList.attrs,
          listItems,
          previousList.marks,
        );
        const paragraphFrom = $from.before($from.depth);
        const listFrom = paragraphFrom - previousList.nodeSize;
        const tr = state.tr.replaceWith(
          listFrom,
          paragraphFrom + paragraph.nodeSize,
          mergedList,
        );
        let mergedParagraphPosition = -1;
        mergedList.descendants((node, position) => {
          if (node === mergedParagraph) {
            mergedParagraphPosition =
              listFrom + position + 2 + previousParagraph.content.size;
          }
        });
        if (mergedParagraphPosition < 0) return false;
        tr.setSelection(TextSelection.create(tr.doc, mergedParagraphPosition));
        dispatch(tr.scrollIntoView());
        return true;
      }
    }

    let itemDepth = $from.depth;
    while (itemDepth > 0 && $from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }
    if (itemDepth === 0) return false;

    const item = $from.node(itemDepth);
    const itemParagraphIndex = $from.index(itemDepth);
    const canMergeInsideItem =
      itemParagraphIndex > 0 &&
      item.child(itemParagraphIndex - 1).type === paragraph.type &&
      itemParagraphIndex < item.childCount - 1 &&
      item.child(itemParagraphIndex + 1).firstChild?.type === itemType;
    if (!canMergeInsideItem) return false;
    if (dispatch) {
      const paragraphBoundary = $from.before($from.depth);
      const tr = state.tr.join(paragraphBoundary);
      tr.setSelection(TextSelection.create(tr.doc, paragraphBoundary - 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function moveToNextEmptyListItem(itemType: NodeType): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    let itemDepth = selection.$from.depth;
    while (itemDepth > 0 && selection.$from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }
    if (itemDepth === 0) return false;

    const item = selection.$from.node(itemDepth);
    if (item.childCount !== 1 || item.firstChild !== selection.$from.parent) return false;

    const listDepth = itemDepth - 1;
    const list = selection.$from.node(listDepth);
    const itemIndex = selection.$from.index(listDepth);
    if (itemIndex >= list.childCount - 1) return false;

    const nextItem = list.child(itemIndex + 1);
    const nextParagraph = nextItem.firstChild;
    if (
      nextItem.type !== itemType ||
      nextItem.childCount !== 1 ||
      !nextParagraph?.isTextblock ||
      nextParagraph.content.size !== 0
    ) {
      return false;
    }

    if (dispatch) {
      let nextItemPosition = selection.$from.start(listDepth);
      for (let index = 0; index <= itemIndex; index += 1) {
        nextItemPosition += list.child(index).nodeSize;
      }
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, nextItemPosition + 2))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

export function deleteAtListItemStart(
  itemType: NodeType,
  direction: "backward" | "forward",
): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (
      !(selection instanceof TextSelection) ||
      !selection.empty
    ) {
      return false;
    }

    const paragraph = selection.$from.parent;
    const paragraphContainsOnlyHardbreak =
      paragraph.childCount === 1 &&
      paragraph.firstChild?.type.name === "hardbreak";
    if (
      selection.$from.parentOffset !== 0 &&
      !(
        paragraphContainsOnlyHardbreak &&
        selection.$from.parentOffset === paragraph.content.size
      )
    ) {
      return false;
    }

    let itemDepth = selection.$from.depth;
    while (itemDepth > 0 && selection.$from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }
    if (itemDepth === 0) return false;

    const item = selection.$from.node(itemDepth);
    if (item.firstChild !== paragraph) return false;

    const listDepth = itemDepth - 1;
    const list = selection.$from.node(listDepth);
    const itemIndex = selection.$from.index(listDepth);
    const listFrom = selection.$from.before(listDepth);
    const createListSegment = (
      fromIndex: number,
      toIndex: number,
      orderAdjustment = 0,
    ) => {
      if (fromIndex >= toIndex) return null;

      const items: ProseMirrorNode[] = [];
      for (let index = fromIndex; index < toIndex; index += 1) {
        items.push(list.child(index));
      }
      const attrs = { ...list.attrs };
      if (typeof attrs.order === "number" && fromIndex > 0) {
        attrs.order += fromIndex + orderAdjustment;
      }
      return list.type.create(attrs, items);
    };
    const replaceItemWithBlocks = (
      blocks: ProseMirrorNode[],
      selectionOffset: number,
      afterListOrderAdjustment = 0,
    ) => {
      if (dispatch) {
        const beforeList = createListSegment(0, itemIndex);
        const afterList = createListSegment(
          itemIndex + 1,
          list.childCount,
          afterListOrderAdjustment,
        );
        const replacement = [
          ...(beforeList ? [beforeList] : []),
          ...blocks,
          ...(afterList ? [afterList] : []),
        ];
        const blockFrom = listFrom + (beforeList?.nodeSize ?? 0);
        const tr = state.tr.replaceWith(
          listFrom,
          listFrom + list.nodeSize,
          replacement,
        );
        tr.setSelection(
          TextSelection.create(tr.doc, blockFrom + selectionOffset),
        );
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    const mergeItemIntoPrevious = () => {
      if (itemIndex === 0) return false;
      if (!dispatch) return true;

      const mergedItem = list.child(itemIndex - 1).copy(
        list.child(itemIndex - 1).content.append(item.content),
      );
      const items: ProseMirrorNode[] = [];
      for (let index = 0; index < list.childCount; index += 1) {
        if (index === itemIndex - 1) {
          items.push(mergedItem);
        } else if (index !== itemIndex) {
          items.push(list.child(index));
        }
      }

      const replacementList = list.type.create(list.attrs, items);
      let paragraphPosition = -1;
      replacementList.descendants((node, position) => {
        if (node === paragraph) {
          paragraphPosition = listFrom + position + 2;
        }
      });
      if (paragraphPosition < 0) return false;

      const tr = state.tr.replaceWith(
        listFrom,
        listFrom + list.nodeSize,
        replacementList,
      );
      tr.setSelection(TextSelection.create(tr.doc, paragraphPosition));
      dispatch(tr.scrollIntoView());
      return true;
    };
    const paragraphIsEmpty =
      paragraph.content.size === 0 ||
      paragraphContainsOnlyHardbreak;

    if (!paragraphIsEmpty) {
      if (direction === "backward") {
        if (item.childCount > 1 && itemIndex > 0) {
          return mergeItemIntoPrevious();
        }
        const blocks: ProseMirrorNode[] = [];
        item.forEach((block) => blocks.push(block));
        return replaceItemWithBlocks(blocks, 1, -1);
      }

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

    if (item.childCount > 1) {
      const childList = item.childCount === 2 ? item.child(1) : null;
      if (
        childList &&
        childList.firstChild?.type === itemType &&
        childList.type === list.type
      ) {
        if (!dispatch) return true;
        const itemFrom = selection.$from.before(itemDepth);
        const tr = state.tr.replaceWith(
          itemFrom,
          itemFrom + item.nodeSize,
          childList.content,
        );
        tr.setSelection(TextSelection.create(tr.doc, itemFrom + 2));
        dispatch(tr.scrollIntoView());
        return true;
      }

      if (childList && childList.firstChild?.type === itemType) {
        return replaceItemWithBlocks([childList], 2);
      }
    }

    const blocks: ProseMirrorNode[] = [];
    item.forEach((block) => blocks.push(block));
    return replaceItemWithBlocks(blocks, 1);
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
