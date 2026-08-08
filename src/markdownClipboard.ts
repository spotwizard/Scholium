import type { Node as ProseMirrorNode, Slice } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

type MarkdownSerializer = (node: ProseMirrorNode) => string;

function sliceHasMarkedText(slice: Slice) {
  let hasMarkedText = false;

  slice.content.descendants((node) => {
    if (node.isText && node.marks.length > 0) {
      hasMarkedText = true;
      return false;
    }

    return !hasMarkedText;
  });

  return hasMarkedText;
}

export function serializeMarkedTextClipboardSlice(
  slice: Slice,
  view: EditorView,
  serializeMarkdown: MarkdownSerializer,
) {
  if (!sliceHasMarkedText(slice)) return null;

  const { $from, $to } = view.state.selection;
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null;

  const selectsWholeTextBlock =
    $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
  const selectedContent = selectsWholeTextBlock
    ? slice.content
    : $from.parent.cut($from.parentOffset, $to.parentOffset);
  const selectedDocument = view.state.schema.topNodeType.createAndFill(
    undefined,
    selectedContent,
  );

  if (!selectedDocument) return null;

  const markdown = serializeMarkdown(selectedDocument);
  return selectsWholeTextBlock ? markdown : markdown.replace(/\n$/, "");
}
