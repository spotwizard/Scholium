import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { editorViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnnotationTone,
  EditorChangeSource,
  TextAnnotation,
  TextSelectionAnchor,
} from "./MarkdownEditor";
import { loadScholiumMermaid } from "./mermaid";

type MilkdownMarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  noteModeEnabled: boolean;
  readOnly?: boolean;
  toolbarEnabled?: boolean;
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
};

const milkdownAnnotationPluginKey = new PluginKey<DecorationSet>(
  "scholium-milkdown-annotations",
);
const milkdownAnnotationFramePadding = 4;
const milkdownAnnotationFrameHorizontalPadding = 12;
const milkdownAnnotationLineJoinMaxGap = 20;
const milkdownAnnotationClassPrefix = "scholium-milkdown-annotation-";
const milkdownSelectionFallbackMs = 220;
const annotationClickDelayMs = 500;
let milkdownMermaidRenderIndex = 0;

function milkdownAnnotationFramePaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : milkdownAnnotationFramePadding;
}

function milkdownAnnotationFrameHorizontalPaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : milkdownAnnotationFrameHorizontalPadding;
}

type MilkdownCodeBlockApplyPreview = (value: null | string | HTMLElement) => void;

type MilkdownAnnotationFrame = {
  frameKey: string;
  isFocusTarget?: boolean;
  noteId: string;
  kind: "note" | "glossary";
  tone: AnnotationTone;
  left: number;
  top: number;
  width: number;
  height: number;
};

type MilkdownAnnotationRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type MilkdownAnnotationSource = {
  noteId: string;
  isFocusTarget?: boolean;
  kind: "note" | "glossary";
  tone: AnnotationTone;
};

type MilkdownTextMap = {
  text: string;
  sourceOffsets: (number | null)[];
};

const markdownUnorderedListMarkerPattern = /^ {0,3}[-*+]\s+/;
const markdownOrderedListMarkerPattern = /^ {0,3}\d+[.)]\s+/;

function normalizeSelectedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMarkdownForScholium(markdown: string) {
  return markdown
    .replace(/^(\s*)\*\s+/gm, "$1- ")
    .replace(
      /^(\s*(?:[-+]|\d+[.)])\s+\S[^\n]*)\n\n(?=\s*(?:[-+]|\d+[.)])\s+\S)/gm,
      "$1\n",
    );
}

function isMermaidLanguage(language: string) {
  return language.trim().toLowerCase() === "mermaid";
}

function escapeHtml(text: string) {
  const element = document.createElement("div");
  element.textContent = text;
  return element.innerHTML;
}

function renderMilkdownMermaidFrame(content: string) {
  return `<figure class="milkdown-mermaid-diagram">${content}</figure>`;
}

function renderMilkdownMermaidPreview(
  definition: string,
  applyPreview: MilkdownCodeBlockApplyPreview,
) {
  const trimmedDefinition = definition.trim();
  if (!trimmedDefinition) {
    return renderMilkdownMermaidFrame(
      '<pre class="milkdown-mermaid-diagram__error">Mermaid diagram is empty.</pre>',
    );
  }

  applyPreview(
    renderMilkdownMermaidFrame(
      '<div class="milkdown-mermaid-diagram__loading">Rendering diagram...</div>',
    ),
  );

  const diagramId = `scholium-milkdown-mermaid-${++milkdownMermaidRenderIndex}`;
  void loadScholiumMermaid()
    .then((mermaid) => mermaid.render(diagramId, trimmedDefinition))
    .then(({ svg }) => {
      applyPreview(
        renderMilkdownMermaidFrame(
          `<div class="milkdown-mermaid-diagram__svg">${svg}</div>`,
        ),
      );
    })
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to render Mermaid diagram.";
      applyPreview(
        renderMilkdownMermaidFrame(
          `<pre class="milkdown-mermaid-diagram__error">${escapeHtml(errorMessage)}</pre>`,
        ),
      );
    });
}

function appendTextMap(target: MilkdownTextMap, text: string, sourceStart: number | null) {
  target.text += text;
  for (let index = 0; index < text.length; index += 1) {
    target.sourceOffsets.push(sourceStart === null ? null : sourceStart + index);
  }
}

function appendInlineMarkdownTextMap(
  target: MilkdownTextMap,
  text: string,
  sourceStart: number,
) {
  let index = 0;

  while (index < text.length) {
    const twoCharacterMarker = text.slice(index, index + 2);

    if (twoCharacterMarker === "**" || twoCharacterMarker === "__") {
      const endIndex = text.indexOf(twoCharacterMarker, index + 2);
      if (endIndex > index + 2) {
        appendInlineMarkdownTextMap(
          target,
          text.slice(index + 2, endIndex),
          sourceStart + index + 2,
        );
        index = endIndex + 2;
        continue;
      }
    }

    const character = text[index];

    if (character === "*" || character === "_") {
      const endIndex = text.indexOf(character, index + 1);
      if (endIndex > index + 1) {
        appendInlineMarkdownTextMap(
          target,
          text.slice(index + 1, endIndex),
          sourceStart + index + 1,
        );
        index = endIndex + 1;
        continue;
      }
    }

    if (character === "`") {
      const endIndex = text.indexOf("`", index + 1);
      if (endIndex > index + 1) {
        appendTextMap(target, text.slice(index + 1, endIndex), sourceStart + index + 1);
        index = endIndex + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEndIndex = text.indexOf("](", index + 1);
      if (labelEndIndex > index + 1) {
        const linkEndIndex = text.indexOf(")", labelEndIndex + 2);
        if (linkEndIndex > labelEndIndex + 2) {
          appendInlineMarkdownTextMap(
            target,
            text.slice(index + 1, labelEndIndex),
            sourceStart + index + 1,
          );
          index = linkEndIndex + 1;
          continue;
        }
      }
    }

    appendTextMap(target, character, sourceStart + index);
    index += 1;
  }
}

function lineVisibleStartOffset(line: string) {
  let startOffset = 0;
  const quoteMatch = line.match(/^ {0,3}>\s?/);
  if (quoteMatch) {
    startOffset += quoteMatch[0].length;
  }

  const remainingLine = line.slice(startOffset);
  const headingMatch = remainingLine.match(/^#{1,6}\s+/);
  if (headingMatch) return startOffset + headingMatch[0].length;

  const unorderedListMatch = remainingLine.match(markdownUnorderedListMarkerPattern);
  if (unorderedListMatch) return startOffset + unorderedListMatch[0].length;

  const orderedListMatch = remainingLine.match(markdownOrderedListMarkerPattern);
  if (orderedListMatch) return startOffset + orderedListMatch[0].length;

  return startOffset;
}

function markdownLineStartOffsets(markdown: string) {
  const offsets = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function buildMarkdownVisibleTextMap(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const lineStartOffsets = markdownLineStartOffsets(normalizedMarkdown);
  const textMap: MilkdownTextMap = { text: "", sourceOffsets: [] };
  let inFencedCodeBlock = false;

  lines.forEach((line, lineIndex) => {
    const fenceMatch = line.match(/^ {0,3}(```|~~~)/);
    if (fenceMatch) {
      inFencedCodeBlock = !inFencedCodeBlock;
      return;
    }

    if (textMap.text.length > 0) {
      appendTextMap(textMap, "\n", lineStartOffsets[lineIndex] ?? null);
    }

    if (inFencedCodeBlock) {
      appendTextMap(textMap, line, lineStartOffsets[lineIndex] ?? 0);
      return;
    }

    const visibleStartOffset = lineVisibleStartOffset(line);
    appendInlineMarkdownTextMap(
      textMap,
      line.slice(visibleStartOffset),
      (lineStartOffsets[lineIndex] ?? 0) + visibleStartOffset,
    );
  });

  return textMap;
}

function normalizeTextMapForMatch(textMap: MilkdownTextMap) {
  const normalizedTextMap: MilkdownTextMap = { text: "", sourceOffsets: [] };
  let hasPendingWhitespace = false;
  let pendingWhitespaceOffset: number | null = null;

  for (let index = 0; index < textMap.text.length; index += 1) {
    const character = textMap.text[index];
    const sourceOffset = textMap.sourceOffsets[index] ?? null;

    if (/\s/.test(character)) {
      hasPendingWhitespace = true;
      if (pendingWhitespaceOffset === null && sourceOffset !== null) {
        pendingWhitespaceOffset = sourceOffset;
      }
      continue;
    }

    if (hasPendingWhitespace && normalizedTextMap.text.length > 0) {
      appendTextMap(normalizedTextMap, " ", pendingWhitespaceOffset);
    }

    appendTextMap(normalizedTextMap, character, sourceOffset);
    hasPendingWhitespace = false;
    pendingWhitespaceOffset = null;
  }

  return normalizedTextMap;
}

function textMapSourceRange(textMap: MilkdownTextMap, from: number, to: number) {
  const sourceOffsets = textMap.sourceOffsets
    .slice(from, to)
    .filter((offset): offset is number => offset !== null);
  if (sourceOffsets.length === 0) return null;

  return {
    from: Math.min(...sourceOffsets),
    to: Math.max(...sourceOffsets) + 1,
  };
}

function textIndices(text: string, query: string) {
  const indices: number[] = [];
  if (!query) return indices;

  let index = text.indexOf(query);
  while (index >= 0) {
    indices.push(index);
    index = text.indexOf(query, index + query.length);
  }

  return indices;
}

function closestTextIndex(indices: number[], approximateIndex: number) {
  if (indices.length === 0) return -1;

  return indices.reduce((closestIndex, index) =>
    Math.abs(index - approximateIndex) < Math.abs(closestIndex - approximateIndex)
      ? index
      : closestIndex,
  );
}

function roundFrameValue(value: number) {
  return Math.round(value * 100) / 100;
}

function milkdownAnnotationKindLayer(kind: "note" | "glossary") {
  return kind === "glossary" ? 1 : 0;
}

function milkdownAnnotationClassName(index: number) {
  return `${milkdownAnnotationClassPrefix}${index}`;
}

function milkdownAnnotationIndexFromClassName(className: string) {
  if (!className.startsWith(milkdownAnnotationClassPrefix)) return null;

  const index = Number(className.slice(milkdownAnnotationClassPrefix.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function milkdownAnnotationSource(annotation: TextAnnotation): MilkdownAnnotationSource {
  return {
    noteId: annotation.id,
    isFocusTarget: annotation.isFocusTarget,
    kind: annotation.kind === "glossary" ? "glossary" : "note",
    tone: annotation.tone ?? 0,
  };
}

function annotationSourcesFromElement(
  element: HTMLElement,
  annotations: TextAnnotation[],
): MilkdownAnnotationSource[] {
  const sources: MilkdownAnnotationSource[] = [];

  element.classList.forEach((className) => {
    const annotationIndex = milkdownAnnotationIndexFromClassName(className);
    if (annotationIndex === null) return;

    const annotation = annotations[annotationIndex];
    if (!annotation) return;
    sources.push(milkdownAnnotationSource(annotation));
  });

  if (sources.length > 0) return sources;

  const noteId = element.dataset.noteId;
  if (!noteId) return [];
  const kind: "note" | "glossary" =
    element.dataset.annotationKind === "glossary" ? "glossary" : "note";
  const tone: AnnotationTone = element.dataset.noteTone === "1" ? 1 : 0;
  const isFocusTarget = element.dataset.focusTarget === "true";

  return [
    {
      noteId,
      isFocusTarget,
      kind,
      tone,
    },
  ];
}

function measureMilkdownAnnotationFrames(
  container: HTMLDivElement,
  annotations: TextAnnotation[],
): MilkdownAnnotationFrame[] {
  const containerRect = container.getBoundingClientRect();
  const rectsByNoteId = new Map<string, MilkdownAnnotationRect[]>();
  const tonesByNoteId = new Map<string, AnnotationTone>();
  const kindsByNoteId = new Map<string, "note" | "glossary">();
  const focusByNoteId = new Map<string, boolean>();

  function annotationListAdjustedRect(
    annotation: HTMLElement,
    rect: MilkdownAnnotationRect,
    kind: "note" | "glossary",
  ) {
    if (kind === "glossary") {
      return rect;
    }

    const listItem = annotation.closest<HTMLLIElement>("li");
    const list = listItem?.closest<HTMLOListElement | HTMLUListElement>("ol, ul") ?? null;
    if (!listItem || !list || !container.contains(list)) {
      return rect;
    }

    const listRect = list.getBoundingClientRect();
    const listItemRect = listItem.getBoundingClientRect();

    return {
      ...rect,
      left: Math.max(containerRect.left, Math.min(listRect.left, listItemRect.left, rect.left)),
    };
  }

  container
    .querySelectorAll<HTMLElement>(".milkdown-note-annotation")
    .forEach((annotation) => {
      const sources = annotationSourcesFromElement(annotation, annotations);
      if (sources.length === 0) return;

      const annotationRects = Array.from(annotation.getClientRects())
        .map((rect) => {
          const left = Math.max(rect.left, containerRect.left);
          const top = Math.max(rect.top, containerRect.top);
          const right = Math.min(rect.right, containerRect.right);
          const bottom = Math.min(rect.bottom, containerRect.bottom);

          return { left, top, right, bottom };
        })
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
      if (annotationRects.length === 0) return;

      sources.forEach((source) => {
        const sourceAnnotationRects = annotationRects.map((rect) =>
          annotationListAdjustedRect(annotation, rect, source.kind),
        );

        tonesByNoteId.set(source.noteId, source.tone);
        kindsByNoteId.set(source.noteId, source.kind);
        focusByNoteId.set(source.noteId, Boolean(source.isFocusTarget));

        rectsByNoteId.set(source.noteId, [
          ...(rectsByNoteId.get(source.noteId) ?? []),
          ...sourceAnnotationRects,
        ]);
      });
    });

  return Array.from(rectsByNoteId.entries())
    .flatMap(([noteId, rects]) => {
      const kind = kindsByNoteId.get(noteId) ?? "note";
      const tone = tonesByNoteId.get(noteId) ?? 0;
      const isFocusTarget = focusByNoteId.get(noteId) ?? false;
      const sortedRects = rects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );

      return sortedRects.map((rect, rectIndex) => {
        const framePadding = milkdownAnnotationFramePaddingForKind(kind);
        const frameHorizontalPadding = milkdownAnnotationFrameHorizontalPaddingForKind(kind);
        const shouldJoinFrameLines = kind !== "glossary";
        let top = rect.top - framePadding;
        let bottom = rect.bottom + framePadding;
        const previousRect = sortedRects[rectIndex - 1];
        const nextRect = sortedRects[rectIndex + 1];

        if (shouldJoinFrameLines && previousRect) {
          const previousGap = rect.top - previousRect.bottom;
          if (previousGap >= 0 && previousGap <= milkdownAnnotationLineJoinMaxGap) {
            top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
          }
        }

        if (shouldJoinFrameLines && nextRect) {
          const nextGap = nextRect.top - rect.bottom;
          if (nextGap >= 0 && nextGap <= milkdownAnnotationLineJoinMaxGap) {
            bottom = Math.max(bottom, rect.bottom + nextGap / 2 + 1);
          }
        }

        return {
          frameKey: `${kind}:${noteId}:milkdown:${rectIndex}`,
          isFocusTarget,
          noteId,
          kind,
          tone,
          left: roundFrameValue(rect.left - containerRect.left - frameHorizontalPadding),
          top: roundFrameValue(Math.max(0, top - containerRect.top)),
          width: roundFrameValue(rect.right - rect.left + frameHorizontalPadding * 2),
          height: roundFrameValue(bottom - top),
        };
      });
    })
    .sort(
      (left, right) =>
        left.top - right.top ||
        left.left - right.left ||
        milkdownAnnotationKindLayer(left.kind) - milkdownAnnotationKindLayer(right.kind) ||
        left.frameKey.localeCompare(right.frameKey),
    );
}

function milkdownAnnotationFramesAreEqual(
  leftFrames: MilkdownAnnotationFrame[],
  rightFrames: MilkdownAnnotationFrame[],
) {
  if (leftFrames.length !== rightFrames.length) return false;

  return leftFrames.every((leftFrame, index) => {
    const rightFrame = rightFrames[index];

    return (
      leftFrame.frameKey === rightFrame.frameKey &&
      leftFrame.isFocusTarget === rightFrame.isFocusTarget &&
      leftFrame.noteId === rightFrame.noteId &&
      leftFrame.kind === rightFrame.kind &&
      leftFrame.tone === rightFrame.tone &&
      leftFrame.left === rightFrame.left &&
      leftFrame.top === rightFrame.top &&
      leftFrame.width === rightFrame.width &&
      leftFrame.height === rightFrame.height
    );
  });
}

function makeAnchorFromSourceRange(markdown: string, from: number, to: number) {
  return {
    from,
    to,
    selectedText: markdown.slice(from, to),
    prefix: markdown.slice(Math.max(0, from - 48), from),
    suffix: markdown.slice(to, Math.min(markdown.length, to + 48)),
  };
}

function buildAnchor(
  markdown: string,
  selectedText: string,
  approximateVisibleStart = 0,
): TextSelectionAnchor | null {
  const normalizedSelection = normalizeSelectedText(selectedText);
  if (!normalizedSelection) return null;

  const exactIndex = closestTextIndex(textIndices(markdown, selectedText), approximateVisibleStart);
  if (exactIndex >= 0) {
    return makeAnchorFromSourceRange(markdown, exactIndex, exactIndex + selectedText.length);
  }

  const markdownTextMap = buildMarkdownVisibleTextMap(markdown);
  const exactVisibleIndex = closestTextIndex(
    textIndices(markdownTextMap.text, selectedText.trim()),
    approximateVisibleStart,
  );
  if (exactVisibleIndex >= 0) {
    const sourceRange = textMapSourceRange(
      markdownTextMap,
      exactVisibleIndex,
      exactVisibleIndex + selectedText.trim().length,
    );
    if (sourceRange) {
      return makeAnchorFromSourceRange(markdown, sourceRange.from, sourceRange.to);
    }
  }

  const normalizedTextMap = normalizeTextMapForMatch(markdownTextMap);
  const normalizedIndex = closestTextIndex(
    textIndices(normalizedTextMap.text, normalizedSelection),
    approximateVisibleStart,
  );
  if (normalizedIndex < 0) return null;

  const sourceRange = textMapSourceRange(
    normalizedTextMap,
    normalizedIndex,
    normalizedIndex + normalizedSelection.length,
  );
  if (!sourceRange) return null;

  return makeAnchorFromSourceRange(markdown, sourceRange.from, sourceRange.to);
}

function selectionBelongsToRoot(root: HTMLElement, selection: Selection | null) {
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      selection.focusNode &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode),
  );
}

function nonCollapsedSelectionInRoot(
  root: HTMLElement,
  selection: Selection | null,
): selection is Selection & { anchorNode: Node; focusNode: Node } {
  return selectionBelongsToRoot(root, selection);
}

function buildNormalizedVisibleTextIndex(doc: ProseMirrorNode) {
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true;

    for (let offset = 0; offset < node.text.length; offset += 1) {
      const char = node.text[offset];
      const prosePosition = position + offset;
      if (/\s/.test(char)) {
        if (chars.length > 0 && chars[chars.length - 1] !== " ") {
          chars.push(" ");
          positions.push(prosePosition);
        }
        continue;
      }

      chars.push(char);
      positions.push(prosePosition);
    }

    return true;
  });

  return { positions, text: chars.join("") };
}

function visibleTextIndexFromProsePosition(doc: ProseMirrorNode, position: number) {
  const visibleTextIndex = buildNormalizedVisibleTextIndex(doc);
  const index = visibleTextIndex.positions.findIndex(
    (visiblePosition) => visiblePosition >= position,
  );

  return index >= 0 ? index : visibleTextIndex.text.length;
}

function buildProseNonWhitespacePositionIndex(doc: ProseMirrorNode) {
  const positions: number[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true;

    for (let offset = 0; offset < node.text.length; offset += 1) {
      if (!/\s/.test(node.text[offset])) {
        positions.push(position + offset);
      }
    }

    return true;
  });

  return positions;
}

function proseRangeFromMarkdownSourceRange(
  doc: ProseMirrorNode,
  markdown: string,
  from: number,
  to: number,
) {
  const textMap = buildMarkdownVisibleTextMap(markdown);
  let firstVisibleOrdinal: number | null = null;
  let lastVisibleOrdinal: number | null = null;
  let visibleOrdinal = 0;

  for (let index = 0; index < textMap.text.length; index += 1) {
    const character = textMap.text[index];
    const sourceOffset = textMap.sourceOffsets[index];
    if (sourceOffset === null || /\s/.test(character)) continue;

    if (sourceOffset >= from && sourceOffset < to) {
      firstVisibleOrdinal ??= visibleOrdinal;
      lastVisibleOrdinal = visibleOrdinal;
    }

    visibleOrdinal += 1;
  }

  if (firstVisibleOrdinal === null || lastVisibleOrdinal === null) return null;

  const prosePositions = buildProseNonWhitespacePositionIndex(doc);
  const proseFrom = prosePositions[firstVisibleOrdinal];
  const proseTo = prosePositions[lastVisibleOrdinal];
  if (proseFrom === undefined || proseTo === undefined || proseTo < proseFrom) return null;

  return {
    from: proseFrom,
    to: proseTo + 1,
  };
}

function countOccurrencesBefore(markdown: string, annotation: TextAnnotation, target: string) {
  if (!target) return 0;

  const beforeAnnotation = normalizeSelectedText(markdown.slice(0, annotation.from));
  let count = 0;
  let searchFrom = 0;

  while (searchFrom < beforeAnnotation.length) {
    const nextIndex = beforeAnnotation.indexOf(target, searchFrom);
    if (nextIndex < 0) break;
    count += 1;
    searchFrom = nextIndex + target.length;
  }

  return count;
}

function indexOfOccurrence(text: string, target: string, occurrence: number) {
  let searchFrom = 0;
  let currentOccurrence = 0;

  while (searchFrom <= text.length) {
    const nextIndex = text.indexOf(target, searchFrom);
    if (nextIndex < 0) return -1;
    if (currentOccurrence === occurrence) return nextIndex;

    currentOccurrence += 1;
    searchFrom = nextIndex + target.length;
  }

  return -1;
}

function buildAnnotationDecorations(
  doc: ProseMirrorNode,
  markdown: string,
  annotations: TextAnnotation[],
) {
  const { positions, text } = buildNormalizedVisibleTextIndex(doc);
  const decorations = annotations.flatMap((annotation, annotationIndex) => {
    const decorationAttributes = {
      class: [
        "milkdown-note-annotation",
        annotation.kind === "glossary" ? "milkdown-glossary-annotation" : "",
        annotation.isFocusTarget ? "is-focus-target" : "",
        milkdownAnnotationClassName(annotationIndex),
      ]
        .filter(Boolean)
        .join(" "),
      "data-annotation-kind": annotation.kind ?? "note",
      "data-focus-target": annotation.isFocusTarget ? "true" : "false",
      "data-note-id": annotation.id,
      "data-note-tone": String(annotation.tone ?? 0),
    };
    const proseSourceRange = proseRangeFromMarkdownSourceRange(
      doc,
      markdown,
      annotation.from,
      annotation.to,
    );
    if (proseSourceRange) {
      return [
        Decoration.inline(
          proseSourceRange.from,
          proseSourceRange.to,
          decorationAttributes,
        ),
      ];
    }

    const target = normalizeSelectedText(
      annotation.selectedText || markdown.slice(annotation.from, annotation.to),
    );
    if (!target) return [];

    const occurrence = countOccurrencesBefore(markdown, annotation, target);
    const normalizedIndex = indexOfOccurrence(text, target, occurrence);
    if (normalizedIndex < 0) return [];

    const start = positions[normalizedIndex];
    const end = positions[normalizedIndex + target.length - 1] + 1;
    if (start === undefined || end === undefined || end <= start) return [];

    return Decoration.inline(start, end, decorationAttributes);
  });

  return DecorationSet.create(doc, decorations);
}

function noteIdFromAnnotationTarget(
  target: EventTarget | null,
  annotations: TextAnnotation[],
) {
  const targetElement =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const annotationElement = targetElement?.closest<HTMLElement>(".milkdown-note-annotation");
  if (!annotationElement) return null;

  const sources = annotationSourcesFromElement(annotationElement, annotations);
  return (
    sources.sort(
      (left, right) =>
        milkdownAnnotationKindLayer(right.kind) - milkdownAnnotationKindLayer(left.kind),
    )[0]?.noteId ?? null
  );
}

function createAnnotationPlugin({
  getAnnotations,
  getMarkdown,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  getAnnotations: () => TextAnnotation[];
  getMarkdown: () => string;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
}) {
  return new Plugin<DecorationSet>({
    key: milkdownAnnotationPluginKey,
    props: {
      decorations(state) {
        return milkdownAnnotationPluginKey.getState(state) ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        click(_view, event) {
          const noteId = noteIdFromAnnotationTarget(event.target, getAnnotations());
          if (!noteId || !window.getSelection()?.isCollapsed) return false;

          event.preventDefault();
          onAnnotationClick(noteId);
          return true;
        },
        dblclick(_view, event) {
          const noteId = noteIdFromAnnotationTarget(event.target, getAnnotations());
          if (!noteId) return false;

          onAnnotationDoubleClick(noteId);
          return false;
        },
      },
    },
    state: {
      init(_, state) {
        return buildAnnotationDecorations(state.doc, getMarkdown(), getAnnotations());
      },
      apply(transaction, decorations) {
        const mappedDecorations = decorations.map(transaction.mapping, transaction.doc);
        if (!transaction.getMeta(milkdownAnnotationPluginKey)) return mappedDecorations;

        return buildAnnotationDecorations(transaction.doc, getMarkdown(), getAnnotations());
      },
    },
  });
}

export function MilkdownMarkdownEditor({
  value,
  annotations,
  noteModeEnabled,
  readOnly = false,
  toolbarEnabled = true,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: MilkdownMarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const annotationsRef = useRef(annotations);
  const noteModeEnabledRef = useRef(noteModeEnabled);
  const readOnlyRef = useRef(readOnly);
  const currentMarkdownRef = useRef(normalizeMarkdownForScholium(value));
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const animationFrameRef = useRef(0);
  const selectionFrameRef = useRef(0);
  const selectionFallbackTimerRef = useRef(0);
  const annotationClickTimerRef = useRef(0);
  const mouseSelectionStartedRef = useRef(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [annotationFrames, setAnnotationFrames] = useState<MilkdownAnnotationFrame[]>([]);
  const annotationSignature = useMemo(
    () =>
      annotations
        .map(
          (annotation) =>
            `${annotation.id}:${annotation.from}:${annotation.to}:${annotation.selectedText ?? ""}:${
              annotation.tone ?? 0
            }:${annotation.kind ?? "note"}:${annotation.isFocusTarget ? 1 : 0}`,
        )
        .join("|"),
    [annotations],
  );

  useEffect(
    () => () => {
      window.clearTimeout(annotationClickTimerRef.current);
    },
    [],
  );

  function updateAnnotationFrames() {
    const container = containerRef.current;
    if (!container) return;

    if (!noteModeEnabledRef.current) {
      setAnnotationFrames((currentFrames) => (currentFrames.length === 0 ? currentFrames : []));
      return;
    }

    const nextFrames = measureMilkdownAnnotationFrames(container, annotationsRef.current);
    setAnnotationFrames((currentFrames) =>
      milkdownAnnotationFramesAreEqual(currentFrames, nextFrames)
        ? currentFrames
        : nextFrames,
    );
  }

  function scheduleAnnotationFrameUpdate() {
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = window.requestAnimationFrame(updateAnnotationFrames);
  }

  function selectedMilkdownText() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (root && selectionBelongsToRoot(root, selection)) {
      return selection?.toString().trim() ?? "";
    }

    const view = currentEditorView();
    if (!view || view.state.selection.empty) return "";

    const { from, to } = view.state.selection;
    return view.state.doc.textBetween(from, to, " ").trim();
  }

  function clearQueuedAnnotationClick() {
    window.clearTimeout(annotationClickTimerRef.current);
    annotationClickTimerRef.current = 0;
  }

  function queueAnnotationClick(noteId: string) {
    clearQueuedAnnotationClick();
    annotationClickTimerRef.current = window.setTimeout(() => {
      annotationClickTimerRef.current = 0;
      if (selectedMilkdownText()) return;

      onAnnotationClickRef.current(noteId);
    }, annotationClickDelayMs);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onSelectionEnterRef.current = onSelectionEnter;
  }, [onSelectionEnter]);

  useEffect(() => {
    onAnnotationClickRef.current = onAnnotationClick;
  }, [onAnnotationClick]);

  useEffect(() => {
    onAnnotationDoubleClickRef.current = onAnnotationDoubleClick;
  }, [onAnnotationDoubleClick]);

  useEffect(() => {
    noteModeEnabledRef.current = noteModeEnabled;
    if (!noteModeEnabled) {
      onSelectionChangeRef.current(null);
      setAnnotationFrames([]);
    } else {
      scheduleAnnotationFrameUpdate();
    }
  }, [noteModeEnabled]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    crepeRef.current?.setReadonly(readOnly);

    if (!readOnly) return;

    const root = rootRef.current;
    if (root && document.activeElement instanceof Node && root.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    window.getSelection()?.removeAllRanges();
  }, [readOnly]);

  useEffect(() => {
    annotationsRef.current = annotations;
    scheduleAnnotationFrameUpdate();
  }, [annotations]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;

    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(milkdownAnnotationPluginKey, true));
      });
      scheduleAnnotationFrameUpdate();
    } catch {
      // The editor can still be mounting when the first annotation props arrive.
    }
  }, [annotationSignature]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(scheduleAnnotationFrameUpdate);
    resizeObserver.observe(container);
    if (rootRef.current) {
      resizeObserver.observe(rootRef.current);
    }

    window.addEventListener("resize", scheduleAnnotationFrameUpdate);
    scheduleAnnotationFrameUpdate();

    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleAnnotationFrameUpdate);
    };
  }, [editorRevision]);

  useEffect(() => {
    const normalizedValue = normalizeMarkdownForScholium(value);
    if (normalizedValue === currentMarkdownRef.current) return;

    currentMarkdownRef.current = normalizedValue;
    setEditorRevision((revision) => revision + 1);
  }, [value]);

  function currentEditorView(): EditorView | null {
    const crepe = crepeRef.current;
    if (!crepe) return null;

    let view: EditorView | null = null;
    try {
      crepe.editor.action((ctx) => {
        view = ctx.get(editorViewCtx) as EditorView;
      });
    } catch {
      return null;
    }

    return view;
  }

  function anchorFromEditorSelection() {
    const view = currentEditorView();
    if (!view || view.state.selection.empty) return null;

    const { from, to } = view.state.selection;
    const selectedText = view.state.doc.textBetween(from, to, " ");
    return buildAnchor(
      currentMarkdownRef.current,
      selectedText,
      visibleTextIndexFromProsePosition(view.state.doc, from),
    );
  }

  function anchorFromDomSelection(selection: Selection & { anchorNode: Node; focusNode: Node }) {
    const view = currentEditorView();
    if (!view) return null;

    try {
      const anchorPosition = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      const focusPosition = view.posAtDOM(selection.focusNode, selection.focusOffset);
      const from = Math.min(anchorPosition, focusPosition);
      const to = Math.max(anchorPosition, focusPosition);
      if (from === to) return null;

      const selectedText = view.state.doc.textBetween(from, to, " ");
      return buildAnchor(
        currentMarkdownRef.current,
        selectedText,
        visibleTextIndexFromProsePosition(view.state.doc, from),
      );
    } catch {
      return null;
    }
  }

  function anchorFromCurrentSelection() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !nonCollapsedSelectionInRoot(root, selection)) {
      return anchorFromEditorSelection();
    }

    const domAnchor = anchorFromDomSelection(selection);
    if (domAnchor) return domAnchor;

    const view = currentEditorView();
    let approximateVisibleStart = 0;
    if (view) {
      try {
        const anchorPosition = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
        const focusPosition = view.posAtDOM(selection.focusNode, selection.focusOffset);
        approximateVisibleStart = visibleTextIndexFromProsePosition(
          view.state.doc,
          Math.min(anchorPosition, focusPosition),
        );
      } catch {
        approximateVisibleStart = 0;
      }
    }

    return (
      buildAnchor(currentMarkdownRef.current, selection.toString(), approximateVisibleStart) ??
      anchorFromEditorSelection()
    );
  }

  function publishSelectionAfterSelectionComplete() {
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      const selection = window.getSelection();
      const anchor =
        readOnlyRef.current && root && !selectionBelongsToRoot(root, selection)
          ? null
          : anchorFromCurrentSelection();

      mouseSelectionStartedRef.current = false;
      onSelectionChangeRef.current(anchor);
      selectionFrameRef.current = 0;
    });
  }

  function scheduleSelectionPublishFromDom() {
    window.clearTimeout(selectionFallbackTimerRef.current);
    selectionFallbackTimerRef.current = window.setTimeout(() => {
      if (mouseSelectionStartedRef.current) return;

      publishSelectionAfterSelectionComplete();
    }, milkdownSelectionFallbackMs);
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function handleSelectionPointerDown(event: MouseEvent | PointerEvent) {
      if (event.button !== 0) return;

      mouseSelectionStartedRef.current = true;
    }

    function handleSelectionPointerUp(event: MouseEvent | PointerEvent) {
      if (event.button !== 0) return;

      const currentRoot = rootRef.current;
      if (!currentRoot) return;

      const targetIsInEditor = event.target instanceof Node && currentRoot.contains(event.target);
      const selectionIsInEditor = selectionBelongsToRoot(currentRoot, window.getSelection());
      const activeElement = document.activeElement;
      const editorHasFocus = activeElement instanceof Node && currentRoot.contains(activeElement);

      if (
        !mouseSelectionStartedRef.current &&
        !targetIsInEditor &&
        !selectionIsInEditor &&
        !editorHasFocus
      ) {
        return;
      }

      mouseSelectionStartedRef.current = false;
      publishSelectionAfterSelectionComplete();
    }

    root.addEventListener("mousedown", handleSelectionPointerDown, true);
    root.addEventListener("pointerdown", handleSelectionPointerDown, true);
    window.addEventListener("mouseup", handleSelectionPointerUp, true);
    window.addEventListener("pointerup", handleSelectionPointerUp, true);

    return () => {
      window.cancelAnimationFrame(selectionFrameRef.current);
      window.clearTimeout(selectionFallbackTimerRef.current);
      root.removeEventListener("mousedown", handleSelectionPointerDown, true);
      root.removeEventListener("pointerdown", handleSelectionPointerDown, true);
      window.removeEventListener("mouseup", handleSelectionPointerUp, true);
      window.removeEventListener("pointerup", handleSelectionPointerUp, true);
    };
  }, [editorRevision]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    root.innerHTML = "";

    const crepe = new Crepe({
      root,
      defaultValue: currentMarkdownRef.current,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.Toolbar]: toolbarEnabled,
        [CrepeFeature.TopBar]: false,
      },
    });
    crepe.editor.config((ctx) => {
      ctx.update(codeBlockConfig.key, (previousConfig) => ({
        ...previousConfig,
        previewOnlyByDefault: true,
        renderPreview: (language, content, applyPreview) => {
          if (isMermaidLanguage(language)) {
            return renderMilkdownMermaidPreview(content, applyPreview);
          }

          return previousConfig.renderPreview(language, content, applyPreview);
        },
      }));

      ctx.update(prosePluginsCtx, (plugins) => [
        ...plugins,
        new Plugin({
          filterTransaction(transaction) {
            return !(readOnlyRef.current && transaction.docChanged);
          },
        }),
        createAnnotationPlugin({
          getAnnotations: () => annotationsRef.current,
          getMarkdown: () => currentMarkdownRef.current,
          onAnnotationClick: queueAnnotationClick,
          onAnnotationDoubleClick: clearQueuedAnnotationClick,
        }),
      ]);
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const normalizedMarkdown = normalizeMarkdownForScholium(markdown);
        if (disposed || normalizedMarkdown === currentMarkdownRef.current) return;
        if (readOnlyRef.current) return;

        currentMarkdownRef.current = normalizedMarkdown;
        onChangeRef.current(normalizedMarkdown, "user");
        scheduleAnnotationFrameUpdate();
      });

      listener.selectionUpdated(() => {
        scheduleSelectionPublishFromDom();
        scheduleAnnotationFrameUpdate();
      });
    });

    crepeRef.current = crepe;
    crepe.setReadonly(readOnlyRef.current);
    void crepe
      .create()
      .then(() => {
        crepe.setReadonly(readOnlyRef.current);
        scheduleAnnotationFrameUpdate();
      })
      .catch((error: unknown) => {
        console.error("failed to create Milkdown editor", error);
      });

    return () => {
      disposed = true;
      crepeRef.current = null;
      setAnnotationFrames([]);
      void crepe.destroy();
      root.innerHTML = "";
    };
  }, [editorRevision, toolbarEnabled]);

  function handleSelectionEnterKeyDown(
    event: KeyboardEvent | ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter) return;

    const anchor = anchorFromCurrentSelection();
    if (!anchor) return;

    const handled = onSelectionEnterRef.current(anchor);
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleSelectionEnterKeyDown(event);
    if (event.defaultPrevented) return;

    if (readOnlyRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  useEffect(() => {
    function targetShouldKeepEnter(target: EventTarget | null) {
      const root = rootRef.current;
      if (!root || !(target instanceof Element)) return false;
      if (root.contains(target)) return false;

      return Boolean(
        target.closest("button, input, textarea, select") ||
          (target instanceof HTMLElement && target.isContentEditable),
      );
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const isPlainEnter =
        event.key === "Enter" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;
      if (!isPlainEnter) return;

      const root = rootRef.current;
      if (!root || targetShouldKeepEnter(event.target)) return;

      const selection = window.getSelection();
      const activeElement = document.activeElement;
      const editorHasFocus = activeElement instanceof Node && root.contains(activeElement);
      if (!selectionBelongsToRoot(root, selection) && !editorHasFocus) return;

      handleSelectionEnterKeyDown(event);
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [editorRevision]);

  return (
    <div className="milkdown-markdown-editor-shell" ref={containerRef}>
      <div aria-hidden="true" className="milkdown-annotation-layer">
        {annotationFrames.map((frame) => (
          <div
            className={`milkdown-annotation-frame ${
              frame.isFocusTarget ? "is-focus-target" : ""
            }`}
            data-annotation-kind={frame.kind}
            data-focus-target={frame.isFocusTarget ? "true" : "false"}
            data-note-id={frame.noteId}
            data-note-tone={frame.tone}
            key={frame.frameKey}
            style={{
              height: frame.height,
              left: frame.left,
              top: frame.top,
              width: frame.width,
            }}
          />
        ))}
      </div>
      <div
        className="milkdown-markdown-editor"
        onKeyDownCapture={handleKeyDown}
        onKeyUp={publishSelectionAfterSelectionComplete}
        onMouseUp={publishSelectionAfterSelectionComplete}
        ref={rootRef}
      />
    </div>
  );
}
