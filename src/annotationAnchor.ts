import type { TextSelectionAnchor } from "./editorTypes";

const anchorContextLength = 48;

export type MarkdownTextEdit = {
  from: number;
  to: number;
  insert: string;
};

export function makeAnchorFromRange(
  body: string,
  from: number,
  to: number,
  selectedText = body.slice(from, to),
): TextSelectionAnchor {
  return {
    from,
    to,
    selectedText,
    prefix: body.slice(Math.max(0, from - anchorContextLength), from),
    suffix: body.slice(to, Math.min(body.length, to + anchorContextLength)),
  };
}

export function refreshAnchor(body: string, anchor: TextSelectionAnchor): TextSelectionAnchor {
  return {
    ...anchor,
    prefix: body.slice(Math.max(0, anchor.from - anchorContextLength), anchor.from),
    suffix: body.slice(anchor.to, Math.min(body.length, anchor.to + anchorContextLength)),
  };
}

export function hasRenderableAnchor(anchor: TextSelectionAnchor) {
  return anchor.to > anchor.from;
}

export function normalizeSelectionTextForComparison(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function anchorMatchesBodyText(body: string, anchor: TextSelectionAnchor) {
  if (!hasRenderableAnchor(anchor)) return false;

  const anchorText = normalizeSelectionTextForComparison(anchor.selectedText);
  if (!anchorText) return true;

  return normalizeSelectionTextForComparison(body.slice(anchor.from, anchor.to)) === anchorText;
}

export function textSelectionAnchorsMatch(
  left: TextSelectionAnchor,
  right: TextSelectionAnchor,
) {
  return (
    left.from === right.from &&
    left.to === right.to &&
    normalizeSelectionTextForComparison(left.selectedText) ===
      normalizeSelectionTextForComparison(right.selectedText)
  );
}

function transformTextPositionWithEdits(
  position: number,
  affinity: "start" | "end",
  edits: MarkdownTextEdit[],
) {
  let delta = 0;

  for (const edit of edits) {
    const deletedLength = edit.to - edit.from;
    const insertedLength = edit.insert.length;

    if (deletedLength === 0) {
      if (position > edit.from || (position === edit.from && affinity === "start")) {
        delta += insertedLength;
      }
      continue;
    }

    if (position < edit.from) {
      continue;
    }

    if (position <= edit.to) {
      return edit.from + delta;
    }

    delta += insertedLength - deletedLength;
  }

  return position + delta;
}

export function transformAnchorRangeWithTextEdits(
  anchor: TextSelectionAnchor,
  nextBodyLength: number,
  edits: MarkdownTextEdit[],
): TextSelectionAnchor {
  const nextFrom = Math.min(
    Math.max(transformTextPositionWithEdits(anchor.from, "start", edits), 0),
    nextBodyLength,
  );
  const nextTo = Math.min(
    Math.max(transformTextPositionWithEdits(anchor.to, "end", edits), nextFrom),
    nextBodyLength,
  );

  return {
    ...anchor,
    from: nextFrom,
    to: nextTo,
  };
}

export function textEditFromBodyChange(
  previousBody: string,
  nextBody: string,
): MarkdownTextEdit | null {
  if (previousBody === nextBody) return null;

  const minLength = Math.min(previousBody.length, nextBody.length);
  let prefixLength = 0;
  while (
    prefixLength < minLength &&
    previousBody[prefixLength] === nextBody[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffixIndex = previousBody.length;
  let nextSuffixIndex = nextBody.length;
  while (
    previousSuffixIndex > prefixLength &&
    nextSuffixIndex > prefixLength &&
    previousBody[previousSuffixIndex - 1] === nextBody[nextSuffixIndex - 1]
  ) {
    previousSuffixIndex -= 1;
    nextSuffixIndex -= 1;
  }

  return {
    from: prefixLength,
    to: previousSuffixIndex,
    insert: nextBody.slice(prefixLength, nextSuffixIndex),
  };
}
