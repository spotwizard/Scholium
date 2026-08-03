import type { MarkType, Node as ProseMirrorNode } from "@milkdown/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";

const milkdownPastedInlineMarkBoundaryPluginKey = new PluginKey(
  "scholium-milkdown-pasted-inline-mark-boundary",
);

function textRangeHasMark(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  markType: MarkType,
) {
  let hasMark = false;
  doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node) => {
    if (node.isText && markType.isInSet(node.marks)) {
      hasMark = true;
      return false;
    }

    return !hasMark;
  });
  return hasMark;
}

export function createPastedInlineMarkBoundaryPlugin() {
  let pastePending = false;

  return new Plugin({
    key: milkdownPastedInlineMarkBoundaryPluginKey,
    props: {
      handlePaste() {
        pastePending = true;
        queueMicrotask(() => {
          pastePending = false;
        });
        return false;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      const pasted =
        pastePending ||
        transactions.some(
          (transaction) =>
            transaction.getMeta("paste") === true ||
            transaction.getMeta("uiEvent") === "paste",
        );
      if (!pasted) return null;
      pastePending = false;

      if (!(newState.selection instanceof TextSelection) || !newState.selection.empty) {
        return null;
      }

      const cursorPosition = newState.selection.from;
      const boundaryMarkTypes = [
        newState.schema.marks.link,
        newState.schema.marks.inlineCode,
      ].filter(
        (markType): markType is MarkType =>
          Boolean(
            markType &&
              textRangeHasMark(
                newState.doc,
                cursorPosition - 1,
                cursorPosition,
                markType,
              ) &&
              !textRangeHasMark(
                newState.doc,
                cursorPosition,
                cursorPosition + 1,
                markType,
              ),
          ),
      );
      if (boundaryMarkTypes.length === 0) return null;

      const transaction = newState.tr.setMeta("addToHistory", false);
      boundaryMarkTypes.forEach((markType) => transaction.removeStoredMark(markType));
      return transaction;
    },
  });
}
