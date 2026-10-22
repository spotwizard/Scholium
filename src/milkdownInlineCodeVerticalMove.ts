import type { EditorState } from "@milkdown/prose/state";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

const MAX_LINE_PROBES = 8;

// True when the caret sits exactly on the edge of an inline code span, so the
// DOM position the browser reports (inside the code element) and the one
// ProseMirror writes back (end of the text before it) are different places.
export function caretIsOnInlineCodeEdge(state: EditorState) {
  const inlineCodeType = state.schema.marks.inlineCode;
  const { selection } = state;
  if (!inlineCodeType || !(selection instanceof TextSelection) || !selection.empty) {
    return false;
  }

  const { $from } = selection;
  if ($from.textOffset !== 0) return false;

  const beforeIsCode = Boolean(
    $from.nodeBefore && inlineCodeType.isInSet($from.nodeBefore.marks),
  );
  const afterIsCode = Boolean($from.nodeAfter && inlineCodeType.isInSet($from.nodeAfter.marks));
  return beforeIsCode !== afterIsCode;
}

function positionOnAdjacentLine(view: EditorView, direction: 1 | -1, goalX: number) {
  const origin = view.coordsAtPos(view.state.selection.from);
  const lineHeight = Math.max(origin.bottom - origin.top, 8);

  for (let probe = 1; probe <= MAX_LINE_PROBES; probe += 1) {
    const top =
      direction > 0
        ? origin.bottom + (lineHeight / 2) * probe
        : origin.top - (lineHeight / 2) * probe;
    const hit = view.posAtCoords({ left: goalX, top });
    if (!hit) return null;

    const target = view.coordsAtPos(hit.pos);
    const movedLines =
      direction > 0 ? target.top - origin.top : origin.top - target.top;
    if (movedLines <= lineHeight / 2) continue;

    // The probe may have landed in the gap above the line, where the nearest
    // position is the start of the block; ask again at the middle of the line.
    const lineMiddle = (target.top + target.bottom) / 2;
    return view.posAtCoords({ left: goalX, top: lineMiddle })?.pos ?? hit.pos;
  }

  return null;
}

// ArrowUp / ArrowDown with the caret on the edge of an inline code span: the
// browser moves the DOM caret into the code element, ProseMirror then writes
// it back to the end of the text before the span, and the next key press
// starts from there again, so the caret never leaves the line. Move to the
// neighbouring line ourselves in that one situation, including when that line
// belongs to the next or previous block.
export function createInlineCodeVerticalMovePlugin(isBlocked: () => boolean) {
  let goalX: number | null = null;
  let lastMovedTo = -1;

  return new Plugin({
    key: new PluginKey("scholium-inline-code-vertical-move"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
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

        if (!caretIsOnInlineCodeEdge(view.state)) return false;

        const direction = event.key === "ArrowDown" ? 1 : -1;

        const { from } = view.state.selection;
        if (goalX === null || from !== lastMovedTo) {
          goalX = view.coordsAtPos(from).left;
        }

        const target = positionOnAdjacentLine(view, direction, goalX);
        if (target === null) return false;

        const { doc } = view.state;
        if (!doc.resolve(target).parent.inlineContent) return false;

        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(doc, target))
            .scrollIntoView(),
        );
        lastMovedTo = target;
        return true;
      },
    },
  });
}
