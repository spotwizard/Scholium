import type { Node as ProseMirrorNode, NodeType } from "@milkdown/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/prose/schema-list";
import { canJoin } from "@milkdown/prose/transform";
import {
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@milkdown/prose/state";

function nodeIsMarkdownList(node: ProseMirrorNode) {
  return (
    node.type.name === "bullet_list" ||
    node.type.name === "bulletList" ||
    node.type.name === "ordered_list" ||
    node.type.name === "orderedList"
  );
}

function nodeIsEmptyParagraph(node: ProseMirrorNode) {
  return (
    node.type.name === "paragraph" &&
    (node.content.size === 0 ||
      (node.childCount === 1 && node.firstChild?.type.name === "hardbreak"))
  );
}

export function normalizeAdjacentSerializedListItems(markdown: string) {
  return markdown.replace(
    /^([ \t]*(?:[-+]|\d+[.)])[ \t]+\S[^\n]*)\n\n(?=[ \t]*(?:[-+]|\d+[.)])[ \t]+\S)/gm,
    "$1\n",
  );
}

function countEmptyParagraphListBoundaries(doc: ProseMirrorNode) {
  let count = 0;

  const scanNode = (node: ProseMirrorNode) => {
    for (let index = 0; index < node.childCount; index += 1) {
      if (!nodeIsEmptyParagraph(node.child(index))) continue;

      const previousNode = index > 0 ? node.child(index - 1) : null;
      const nextNode = index + 1 < node.childCount ? node.child(index + 1) : null;
      if (
        (previousNode && nodeIsMarkdownList(previousNode)) ||
        (nextNode && nodeIsMarkdownList(nextNode))
      ) {
        count += 1;
      }
    }
  };

  scanNode(doc);
  doc.descendants(scanNode);

  return count;
}

export function preserveSerializedEmptyParagraphListBoundaries(
  markdown: string,
  doc: ProseMirrorNode,
) {
  let remaining = countEmptyParagraphListBoundaries(doc);
  if (remaining === 0) return markdown;

  return markdown.replace(
    /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\S[^\n]*)\n\n(?=[ \t]*(?:[-+*]|\d+[.)])[ \t]+\S)/gm,
    (match, listItemLine) => {
      if (remaining === 0) return match;
      remaining -= 1;
      return `${listItemLine}\n\n\n`;
    },
  );
}

export function mergeRemovedListMarkerLineBackward(
  itemType: NodeType,
): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const paragraph = $from.parent;
    const selectionAtEmptyParagraphStart =
      $from.parentOffset === 0 ||
      (nodeIsEmptyParagraph(paragraph) &&
        $from.parentOffset === paragraph.content.size);
    if (
      !(state.selection instanceof TextSelection) ||
      !state.selection.empty ||
      !selectionAtEmptyParagraphStart
    ) {
      return false;
    }

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
          nodeIsEmptyParagraph(paragraph)
            ? previousParagraph.content
            : previousParagraph.content.append(paragraph.content),
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
        const nextList =
          paragraphIndex + 1 < container.childCount
            ? container.child(paragraphIndex + 1)
            : null;
        const joinedNextList =
          nextList?.type === previousList.type ? nextList : null;
        const listItems: ProseMirrorNode[] = [];
        for (let index = 0; index < previousList.childCount - 1; index += 1) {
          listItems.push(previousList.child(index));
        }
        listItems.push(mergedItem);
        joinedNextList?.forEach((nextItem) => listItems.push(nextItem));
        const mergedList = previousList.type.create(
          previousList.attrs,
          listItems,
          previousList.marks,
        );
        const paragraphFrom = $from.before($from.depth);
        const listFrom = paragraphFrom - previousList.nodeSize;
        const tr = state.tr.replaceWith(
          listFrom,
          paragraphFrom + paragraph.nodeSize + (joinedNextList?.nodeSize ?? 0),
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
      const tr = nodeIsEmptyParagraph(paragraph)
        ? state.tr.delete(paragraphBoundary, paragraphBoundary + paragraph.nodeSize)
        : state.tr.join(paragraphBoundary);
      tr.setSelection(TextSelection.create(tr.doc, paragraphBoundary - 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function deleteEmptyParagraphAfterList(itemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const paragraph = $from.parent;
    if (
      !(state.selection instanceof TextSelection) ||
      !state.selection.empty ||
      !nodeIsEmptyParagraph(paragraph) ||
      $from.parentOffset !== paragraph.content.size
    ) {
      return false;
    }

    const containerDepth = $from.depth - 1;
    const paragraphIndex = $from.index(containerDepth);
    if (paragraphIndex === 0) return false;

    const previousList = $from.node(containerDepth).child(paragraphIndex - 1);
    const previousItem = previousList.lastChild;
    const previousParagraph = previousItem?.firstChild;
    if (
      !nodeIsMarkdownList(previousList) ||
      previousItem?.type !== itemType ||
      previousParagraph?.type !== paragraph.type
    ) {
      return false;
    }
    if (!dispatch) return true;

    const paragraphFrom = $from.before($from.depth);
    const listFrom = paragraphFrom - previousList.nodeSize;
    let previousParagraphEnd = -1;
    previousList.descendants((node, position) => {
      if (node === previousParagraph) {
        previousParagraphEnd =
          listFrom + position + 2 + previousParagraph.content.size;
      }
    });
    if (previousParagraphEnd < 0) return false;

    const tr = state.tr.delete(paragraphFrom, paragraphFrom + paragraph.nodeSize);
    if (tr.doc.resolve(paragraphFrom).nodeAfter?.type === previousList.type) {
      tr.join(paragraphFrom);
    }
    tr.setSelection(TextSelection.create(tr.doc, previousParagraphEnd));
    dispatch(tr.scrollIntoView());
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
    // Only Enter at the end of the item text reuses the empty item below; with
    // text after the caret, Enter has to split the item.
    if (selection.$from.parentOffset !== selection.$from.parent.content.size) {
      return false;
    }

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

export function insertEmptyFirstChildListItem(
  itemType: NodeType,
): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    const { $from } = selection;
    let itemDepth = $from.depth;
    while (itemDepth > 0 && $from.node(itemDepth).type !== itemType) {
      itemDepth -= 1;
    }
    if (itemDepth === 0) return false;

    const item = $from.node(itemDepth);
    const paragraph = $from.parent;
    if (
      item.firstChild !== paragraph ||
      paragraph.content.size === 0 ||
      $from.parentOffset !== paragraph.content.size
    ) {
      return false;
    }

    const parentList = $from.node(itemDepth - 1);
    if (
      (parentList.type.name !== "bullet_list" &&
        parentList.type.name !== "bulletList") ||
      item.attrs.checked != null ||
      item.childCount !== 2
    ) {
      return false;
    }

    const childList = item.child(1);
    if (
      childList.type !== parentList.type ||
      childList.childCount === 0
    ) {
      return false;
    }
    for (let index = 0; index < childList.childCount; index += 1) {
      const childItem = childList.child(index);
      if (childItem.type !== itemType || childItem.attrs.checked != null) {
        return false;
      }
    }

    const insertPosition = $from.after(itemDepth + 1) + 1;
    const firstChildItem = childList.firstChild;
    const firstChildParagraph = firstChildItem?.firstChild;
    if (
      firstChildItem?.type === itemType &&
      firstChildItem.childCount === 1 &&
      firstChildParagraph?.isTextblock &&
      firstChildParagraph.content.size === 0
    ) {
      if (dispatch) {
        dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, insertPosition + 2))
            .scrollIntoView(),
        );
      }
      return true;
    }

    const emptyItem = itemType.createAndFill(firstChildItem?.attrs);
    if (!emptyItem) return false;
    if (dispatch) {
      const tr = state.tr.insert(insertPosition, emptyItem);
      tr.setSelection(TextSelection.create(tr.doc, insertPosition + 2));
      dispatch(tr.scrollIntoView());
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
    return replaceItemWithBlocks(blocks, paragraph.content.size + 1, -1);
  };
}

// Tab only joins a sub-list of the same kind as the item's own list, so an
// item tabbed under one that already has a sub-list of the other kind (bullets
// under a numbered item, or the reverse) started a second sub-list of its own.
// It joins the existing sub-list and follows its kind instead.
function joinSunkItemIntoPreviousSubList(tr: Transaction, itemType: NodeType) {
  const { $from } = tr.selection;
  let itemDepth = $from.depth;
  while (itemDepth > 0 && $from.node(itemDepth).type !== itemType) {
    itemDepth -= 1;
  }
  if (itemDepth < 3) return;

  const listDepth = itemDepth - 1;
  const parentItemDepth = listDepth - 1;
  if ($from.node(parentItemDepth).type !== itemType || $from.index(listDepth) !== 0) return;

  const listIndex = $from.index(parentItemDepth);
  if (listIndex === 0) return;
  const list = $from.node(listDepth);
  const previousList = $from.node(parentItemDepth).child(listIndex - 1);
  if (!nodeIsMarkdownList(previousList) || previousList.type === list.type) return;

  const listPosition = $from.before(listDepth);
  tr.setNodeMarkup(listPosition, previousList.type, previousList.attrs);
  if (canJoin(tr.doc, listPosition)) tr.join(listPosition);
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
      joinSunkItemIntoPreviousSubList(combinedTransaction, itemType);
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
      joinSunkItemIntoPreviousSubList(combinedTransaction, itemType);
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
    joinSunkItemIntoPreviousSubList(combinedTransaction, itemType);
      dispatch(combinedTransaction.scrollIntoView());
    return true;
  };
}

// Milkdown draws each list item's marker from the item's own listType/label,
// so an item lifted out of a numbered sub-list into a bullet list (Shift+Tab)
// kept showing its old number. Items in a bullet list follow the list's first
// item; when that first item is numbered, Milkdown turns the whole list into a
// numbered list itself.
export function bulletListItemMarkerFix(
  state: EditorState,
  itemType: NodeType,
  bulletListType: NodeType,
): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.descendants((node, position) => {
    if (node.type !== bulletListType) return true;
    if (node.firstChild?.attrs.listType === "ordered") return true;

    node.forEach((item, offset) => {
      if (item.type !== itemType || item.attrs.listType !== "ordered") return;
      tr ??= state.tr;
      tr.setNodeMarkup(position + 1 + offset, undefined, {
        ...item.attrs,
        listType: "bullet",
        label: "•",
      });
    });
    return true;
  });
  return tr;
}
