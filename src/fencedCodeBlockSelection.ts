export type OffsetSelection = {
  anchor: number;
  head: number;
};

type FencedCodeBlockContentRange = {
  from: number;
  index: number;
  to: number;
};

function fencedCodeBlockContentRanges(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const ranges: FencedCodeBlockContentRange[] = [];
  let lineStart = 0;
  let openBlock: { fence: string; from: number; index: number } | null = null;
  let codeBlockIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const lineEnd = lineStart + line.length;
    const fence = line.match(/^ {0,3}(```|~~~)/)?.[1] ?? null;

    if (!openBlock && fence) {
      openBlock = {
        fence,
        from: lineIndex < lines.length - 1 ? lineEnd + 1 : lineEnd,
        index: codeBlockIndex,
      };
    } else if (openBlock && fence === openBlock.fence) {
      ranges.push({
        from: openBlock.from,
        index: openBlock.index,
        to: Math.max(openBlock.from, lineStart - 1),
      });
      codeBlockIndex += 1;
      openBlock = null;
    }

    lineStart = lineEnd + 1;
  }

  if (openBlock) {
    ranges.push({
      from: openBlock.from,
      index: openBlock.index,
      to: normalizedMarkdown.length,
    });
  }

  return ranges;
}

export function sourceSelectionFromFencedCodeBlock(
  markdown: string,
  codeBlockIndex: number,
  selection: OffsetSelection,
) {
  const range = fencedCodeBlockContentRanges(markdown).find(
    (candidate) => candidate.index === codeBlockIndex,
  );
  if (!range) return null;

  const contentLength = range.to - range.from;
  return {
    anchor: range.from + Math.min(Math.max(selection.anchor, 0), contentLength),
    head: range.from + Math.min(Math.max(selection.head, 0), contentLength),
  };
}

export function fencedCodeBlockSelectionFromSource(
  markdown: string,
  selection: OffsetSelection,
) {
  const selectionFrom = Math.min(selection.anchor, selection.head);
  const selectionTo = Math.max(selection.anchor, selection.head);
  const range = fencedCodeBlockContentRanges(markdown).find(
    (candidate) => selectionFrom >= candidate.from && selectionTo <= candidate.to,
  );
  if (!range) return null;

  return {
    index: range.index,
    selection: {
      anchor: selection.anchor - range.from,
      head: selection.head - range.from,
    },
  };
}
