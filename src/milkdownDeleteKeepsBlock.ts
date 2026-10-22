import type { EditorState, Transaction } from "@milkdown/prose/state";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";

// ProseMirror's own selection delete (Selection.replace -> replaceRange)
// removes every block the selection covers from its first to its last
// character, so the text after the selection moves up into the vacated spot.
// A plain replace of the same range removes only the content: the block the
// selection started in stays, empty, where the selection began.
export function deleteSelectionKeepingBlock(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  if (selection.$from.sameParent(selection.$to)) return null;

  const { from, to } = selection;
  const transaction = state.tr.delete(from, to);
  if (!transaction.docChanged) return null;

  return transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(transaction.mapping.map(from))),
  );
}

export function createDeleteKeepsBlockPlugin(isBlocked: () => boolean) {
  return new Plugin({
    key: new PluginKey("scholium-delete-keeps-block"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Backspace" && event.key !== "Delete") return false;
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          event.isComposing ||
          isBlocked()
        ) {
          return false;
        }

        const transaction = deleteSelectionKeepingBlock(view.state);
        if (!transaction) return false;

        view.dispatch(transaction.scrollIntoView());
        return true;
      },
    },
  });
}
