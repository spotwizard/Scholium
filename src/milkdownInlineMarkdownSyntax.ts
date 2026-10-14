import type { MarkType } from "@milkdown/prose/model";
import type { EditorState, Transaction } from "@milkdown/prose/state";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

const listItemInlineStrongPluginKey = "scholium-list-item-inline-strong";
const strongSyntaxPattern = /\*\*([^*\n]*?\S)([ \t]*)\*\*/g;

function positionIsInsideListItem(state: EditorState, position: number) {
  const resolvedPosition = state.doc.resolve(position);

  for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
    if (resolvedPosition.node(depth).type.name === "list_item") return true;
  }

  return false;
}

export function normalizeListItemInlineStrongSyntaxTransaction(
  state: EditorState,
): Transaction | null {
  const strongMarkType: MarkType | undefined = state.schema.marks.strong;
  if (!strongMarkType) return null;

  const matches: Array<{
    closingFrom: number;
    closingTo: number;
    contentLength: number;
    openingFrom: number;
    openingTo: number;
  }> = [];

  state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    if (!positionIsInsideListItem(state, position)) return;

    for (const match of node.text.matchAll(strongSyntaxPattern)) {
      const matchIndex = match.index ?? -1;
      const content = match[1] ?? "";
      const trailingWhitespace = match[2] ?? "";
      if (matchIndex < 0 || !content) continue;

      const openingFrom = position + matchIndex;
      const openingTo = openingFrom + 2;
      const closingFrom = openingTo + content.length + trailingWhitespace.length;

      matches.push({
        closingFrom,
        closingTo: closingFrom + 2,
        contentLength: content.length,
        openingFrom,
        openingTo,
      });
    }
  });

  if (matches.length === 0) return null;

  const transaction = state.tr;

  matches
    .sort((left, right) => right.openingFrom - left.openingFrom)
    .forEach((match) => {
      transaction.delete(match.closingFrom, match.closingTo);
      transaction.delete(match.openingFrom, match.openingTo);
      transaction.addMark(
        match.openingFrom,
        match.openingFrom + match.contentLength,
        strongMarkType.create({ marker: "*" }),
      );
    });

  return transaction.setMeta("addToHistory", false);
}

function dispatchListItemInlineStrongSyntax(view: EditorView) {
  const transaction = normalizeListItemInlineStrongSyntaxTransaction(view.state);
  if (transaction) view.dispatch(transaction);
}

export function createListItemInlineStrongSyntaxPlugin() {
  return new Plugin({
    appendTransaction: (_transactions, _oldState, newState) =>
      normalizeListItemInlineStrongSyntaxTransaction(newState),
    view: (view) => {
      window.setTimeout(() => {
        if (!view.isDestroyed) dispatchListItemInlineStrongSyntax(view);
      }, 0);

      return {};
    },
    key: new PluginKey(listItemInlineStrongPluginKey),
  });
}
