import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { invoke } from "@tauri-apps/api/core";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { listItemBlockConfig } from "@milkdown/kit/component/list-item-block";
import { editorViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import { hardbreakAttr, hardbreakSchema } from "@milkdown/kit/preset/commonmark";
import { splitBlock } from "@milkdown/prose/commands";
import type { Node as ProseMirrorNode, ResolvedPos } from "@milkdown/prose/model";
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
import {
  findNormalizedSearchMatchIndexes,
  normalizeDocumentSearchQuery,
  type DocumentSearchState,
} from "./documentSearch";
import {
  fullSourceOffsetFromFrontmatterBodyOffset,
  mergeMarkdownFrontmatter,
  splitMarkdownFrontmatter,
  stripMarkdownFrontmatter,
} from "./markdownFrontmatter";
import { loadScholiumMermaid } from "./mermaid";

type MilkdownMarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  documentFilePath?: string | null;
  noteModeEnabled: boolean;
  readOnly?: boolean;
  mobileBlockSelectionEnabled?: boolean;
  search?: DocumentSearchState;
  onSearchMatchCountChange?: (count: number) => void;
  toolbarEnabled?: boolean;
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
  onFocusTargetAnnotationPress?: (noteId: string) => void;
};

const milkdownAnnotationPluginKey = new PluginKey<DecorationSet>(
  "scholium-milkdown-annotations",
);
const milkdownSearchPluginKey = new PluginKey<DecorationSet>("scholium-milkdown-search");
const milkdownTouchBlockSelectionPluginKey = new PluginKey(
  "scholium-milkdown-touch-block-selection",
);
const milkdownReadonlyGuardPluginKey = new PluginKey(
  "scholium-milkdown-readonly-guard",
);
const milkdownPlainEnterHardBreakPluginKey = new PluginKey(
  "scholium-milkdown-plain-enter-hard-break",
);
const milkdownStructuredTextAncestorNames = new Set([
  "list_item",
  "listItem",
  "bullet_list",
  "bulletList",
  "ordered_list",
  "orderedList",
  "table",
  "table_row",
  "tableRow",
  "table_cell",
  "tableCell",
  "table_header",
  "tableHeader",
]);
const milkdownAnnotationFramePadding = 4;
const milkdownAnnotationFrameHorizontalPadding = 12;
const milkdownAnnotationLineJoinMaxGap = 20;
const milkdownAnnotationLineEndTolerance = 2;
const milkdownAnnotationFrameCornerRadius = "4px";
const milkdownAnnotationClassPrefix = "scholium-milkdown-annotation-";
const milkdownSelectionFallbackMs = 220;
const milkdownTouchTapMaxMovePx = 10;
const milkdownTouchTapMaxDurationMs = 520;
const milkdownTouchSelectionPublishSuppressionMs = 900;
const milkdownTouchBlockDomSelector =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, .milkdown-code-block";
const milkdownReadonlyFocusableSelector =
  ".ProseMirror, .cm-content[contenteditable], .cm-editor [contenteditable], [contenteditable='true'], [contenteditable='plaintext-only']";
const annotationClickDelayMs = 500;
const annotationFocusTargetPressSuppressionMs = annotationClickDelayMs + 350;
const imeSelectionSuppressionMs = 350;

type ReadonlyDomFocusSnapshot = {
  ariaReadonly: string | null;
  contenteditable: string | null;
  inputmode: string | null;
  tabindex: string | null;
};
const annotationLayoutSettleDelaysMs = [80, 180, 360, 720];
const escapeListLabelHtml = (label: string) =>
  label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const scholiumBulletListLabel = '<span class="scholium-list-bullet" aria-hidden="true"></span>';
let milkdownMermaidRenderIndex = 0;

function milkdownAnnotationFramePaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : milkdownAnnotationFramePadding;
}

function milkdownAnnotationFrameHorizontalPaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : milkdownAnnotationFrameHorizontalPadding;
}

type MilkdownCodeBlockApplyPreview = (value: null | string | HTMLElement) => void;

type MilkdownAnnotationFrame = {
  borderRadius: string;
  frameKey: string;
  isFocusTarget?: boolean;
  layer: "background" | "foreground";
  noteId: string;
  kind: "note" | "glossary";
  tone: AnnotationTone;
  left: number;
  top: number;
  width: number;
  height: number;
};

type MilkdownAnnotationRect = {
  canExtendRight: boolean;
  clipLeft?: number;
  clipRight?: number;
  left: number;
  lineRight: number;
  top: number;
  right: number;
  bottom: number;
};

type MilkdownCodeBlockAnnotationRect = MilkdownAnnotationRect & {
  codeBlock: HTMLElement;
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

type MarkdownImageFileResult = {
  path: string;
  mimeType: string;
  dataUrl: string;
};

const markdownUnorderedListMarkerPattern = /^ {0,3}[-*+]\s+/;
const markdownOrderedListMarkerPattern = /^ {0,3}\d+[.)]\s+/;
const standaloneHtmlBreakPattern = /^<br\s*\/?>$/i;
const localImageHydratedSrcAttribute = "data-scholium-local-image-src";
const localImageMarkdownPathAttribute = "data-scholium-local-markdown-path";
const localImageResolvedPathAttribute = "data-scholium-local-image-path";
const localImageLoadingAttribute = "data-scholium-local-image-loading";
const localImageErrorAttribute = "data-scholium-local-image-error";

function localMarkdownImageNeedsHydration(src: string) {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) return false;

  return !/^(https?:|data:|blob:|asset:|tauri:|ipc:|\/\/)/i.test(trimmedSrc);
}

function normalizeSelectedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isStandaloneSerializedBreakLine(line: string) {
  return standaloneHtmlBreakPattern.test(line.trim());
}

function normalizeSerializedEmptyParagraphBreaks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    if (!inFencedCodeBlock && isStandaloneSerializedBreakLine(line)) {
      normalizedLines.push("");

      if (
        normalizedLines.length >= 2 &&
        !normalizedLines[normalizedLines.length - 2]?.trim() &&
        !(lines[index + 1] ?? "").trim()
      ) {
        index += 1;
      }

      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

function normalizeSerializedHardBreaks(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalizedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    if (!inFencedCodeBlock && index < lines.length - 1 && line.endsWith("\\")) {
      normalizedLines.push(line.slice(0, -1));
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

function normalizeMarkdownForScholium(markdown: string) {
  return normalizeSerializedHardBreaks(normalizeSerializedEmptyParagraphBreaks(markdown))
    .replace(/^(\s*)\*\s+/gm, "$1- ")
    .replace(
      /^(\s*(?:[-+]|\d+[.)])\s+\S[^\n]*)\n\n(?=\s*(?:[-+]|\d+[.)])\s+\S)/gm,
      "$1\n",
    );
}

function encodeEmptyParagraphsForMilkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const encodedLines: string[] = [];
  let inFencedCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFencedCodeBlock = !inFencedCodeBlock;
      encodedLines.push(line);
      continue;
    }

    if (!inFencedCodeBlock && !line.trim()) {
      let blankEnd = index;
      while (blankEnd < lines.length && !(lines[blankEnd] ?? "").trim()) {
        blankEnd += 1;
      }

      const blankCount = blankEnd - index;
      const hasPreviousContent = encodedLines.some((candidate) => candidate.trim());
      const hasNextContent = lines.slice(blankEnd).some((candidate) => candidate.trim());

      if (hasPreviousContent && hasNextContent) {
        encodedLines.push("");
        for (let blankIndex = 1; blankIndex < blankCount; blankIndex += 1) {
          encodedLines.push("<br />", "");
        }
      } else {
        for (let blankIndex = 0; blankIndex < blankCount; blankIndex += 1) {
          encodedLines.push("");
        }
      }

      index = blankEnd - 1;
      continue;
    }

    encodedLines.push(line);
  }

  return encodedLines.join("\n");
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

function textRangeRectsForMatch(root: HTMLElement, target: string, occurrence = 0) {
  if (!target) return [];

  const textNodes: Array<{ node: Text; from: number; to: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const element = node.parentElement;
      if (
        element?.closest(
          ".tools, button, input, textarea, select, .cm-gutters, .cm-lineNumbers, [aria-hidden='true']",
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  let currentNode = walker.nextNode();

  while (currentNode) {
    const node = currentNode as Text;
    const from = text.length;
    text += node.data;
    textNodes.push({ node, from, to: text.length });
    currentNode = walker.nextNode();
  }

  const matchStart = indexOfOccurrence(text, target, Math.max(0, occurrence));
  if (matchStart < 0) return [];

  const matchEnd = matchStart + target.length;
  const startNode = textNodes.find(
    (entry) => matchStart >= entry.from && matchStart <= entry.to,
  );
  const endNode = textNodes.find(
    (entry) => matchEnd >= entry.from && matchEnd <= entry.to,
  );
  if (!startNode || !endNode) return [];

  const range = document.createRange();
  range.setStart(startNode.node, Math.max(0, matchStart - startNode.from));
  range.setEnd(endNode.node, Math.max(0, matchEnd - endNode.from));

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  range.detach();
  return rects;
}

function fencedCodeBlockIndexForSourceRange(markdown: string, from: number, to: number) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const lineStartOffsets = markdownLineStartOffsets(normalizedMarkdown);
  let openBlock:
    | {
        contentStart: number;
        fence: string;
        index: number;
      }
    | null = null;
  let codeBlockIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineEnd = lineStart + line.length;
    const fenceMatch = line.match(/^ {0,3}(```|~~~)/);

    if (!openBlock) {
      if (fenceMatch) {
        openBlock = {
          contentStart: lineEnd + 1,
          fence: fenceMatch[1],
          index: codeBlockIndex,
        };
      }
      continue;
    }

    if (from >= openBlock.contentStart && to <= lineEnd) {
      return {
        contentStart: openBlock.contentStart,
        index: openBlock.index,
      };
    }

    if (fenceMatch && fenceMatch[1] === openBlock.fence) {
      codeBlockIndex += 1;
      openBlock = null;
    }
  }

  if (openBlock && from >= openBlock.contentStart && to <= normalizedMarkdown.length) {
    return {
      contentStart: openBlock.contentStart,
      index: openBlock.index,
    };
  }

  return null;
}

function textRootsFromCodeBlock(codeBlock: HTMLElement) {
  const roots = Array.from(
    codeBlock.querySelectorAll<HTMLElement>(
      [
        ".codemirror-host:not(.hidden) .cm-content",
        ".milkdown-code-block-preview code",
        "pre",
        "code",
      ].join(", "),
    ),
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  return roots.length > 0 ? roots : [codeBlock];
}

function codeBlockTextVisibleBounds(
  container: HTMLDivElement,
  codeBlock: HTMLElement,
  codeRoot: HTMLElement,
) {
  const containerRect = container.getBoundingClientRect();
  const codeBlockRect = codeBlock.getBoundingClientRect();
  const clipElement =
    codeRoot.closest<HTMLElement>(".cm-scroller") ??
    codeRoot.closest<HTMLElement>(".codemirror-host") ??
    codeRoot.closest<HTMLElement>(".milkdown-code-block-preview") ??
    codeBlock;
  const clipRect = clipElement.getBoundingClientRect();

  return {
    left: Math.max(containerRect.left, codeBlockRect.left, clipRect.left),
    top: Math.max(containerRect.top, codeBlockRect.top, clipRect.top),
    right: Math.min(containerRect.right, codeBlockRect.right, clipRect.right),
    bottom: Math.min(containerRect.bottom, codeBlockRect.bottom, clipRect.bottom),
  };
}

function clipTextRectToBounds(
  rect: DOMRect,
  bounds: { left: number; top: number; right: number; bottom: number },
): MilkdownAnnotationRect | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);

  if (right <= left || bottom <= top) return null;

  return {
    canExtendRight: false,
    clipLeft: bounds.left,
    clipRight: bounds.right,
    left,
    lineRight: right,
    top,
    right,
    bottom,
  };
}

function codeBlockAnnotationRects(
  container: HTMLDivElement,
  annotation: TextAnnotation,
  markdown: string,
) {
  const target = annotation.selectedText?.trim();
  if (!target) return [];

  const codeBlocks = Array.from(container.querySelectorAll<HTMLElement>(".milkdown-code-block"));
  const sourceCodeBlock = fencedCodeBlockIndexForSourceRange(
    markdown,
    annotation.from,
    annotation.to,
  );
  const candidateCodeBlocks =
    sourceCodeBlock && codeBlocks[sourceCodeBlock.index]
      ? [codeBlocks[sourceCodeBlock.index]]
      : codeBlocks;
  const occurrenceInCodeBlock = sourceCodeBlock
    ? countOccurrencesBefore(
        markdown.slice(sourceCodeBlock.contentStart),
        {
          ...annotation,
          from: annotation.from - sourceCodeBlock.contentStart,
          to: annotation.to - sourceCodeBlock.contentStart,
        },
        target,
      )
    : 0;

  for (const codeBlock of candidateCodeBlocks) {
    for (const codeRoot of textRootsFromCodeBlock(codeBlock)) {
      const rects = textRangeRectsForMatch(codeRoot, target, occurrenceInCodeBlock);
      const visibleBounds = codeBlockTextVisibleBounds(container, codeBlock, codeRoot);
      const clippedRects = rects
        .map((rect) => clipTextRectToBounds(rect, visibleBounds))
        .filter((rect): rect is MilkdownAnnotationRect => Boolean(rect))
        .map((rect): MilkdownCodeBlockAnnotationRect => ({ ...rect, codeBlock }));
      if (clippedRects.length > 0) return clippedRects;
    }
  }

  return [];
}

function clearMilkdownCodeBlockAnnotationLayers(container: HTMLDivElement) {
  container
    .querySelectorAll<HTMLElement>(".milkdown-code-block-annotation-layer")
    .forEach((layer) => {
      layer.remove();
    });
}

function createMilkdownCodeBlockAnnotationFrame({
  annotation,
  codeBlock,
  rect,
  rectIndex,
}: {
  annotation: TextAnnotation;
  codeBlock: HTMLElement;
  rect: MilkdownCodeBlockAnnotationRect;
  rectIndex: number;
}) {
  const codeBlockRect = codeBlock.getBoundingClientRect();
  const kind = annotation.kind === "glossary" ? "glossary" : "note";
  const framePadding = milkdownAnnotationFramePaddingForKind(kind);
  const frameHorizontalPadding = milkdownAnnotationFrameHorizontalPaddingForKind(kind);
  const frameLeft = Math.max(0, rect.left - codeBlockRect.left - frameHorizontalPadding);
  const frameRight = Math.min(
    codeBlockRect.width,
    rect.right - codeBlockRect.left + frameHorizontalPadding,
  );
  const frameTop = Math.max(0, rect.top - codeBlockRect.top - framePadding);
  const frameBottom = Math.min(codeBlockRect.height, rect.bottom - codeBlockRect.top + framePadding);

  if (frameRight <= frameLeft || frameBottom <= frameTop) return null;

  const frame = document.createElement("div");
  frame.className = [
    "milkdown-annotation-frame",
    "is-code-block-frame",
    annotation.isFocusTarget ? "is-focus-target" : "",
  ]
    .filter(Boolean)
    .join(" ");
  frame.dataset.annotationKind = kind;
  frame.dataset.focusTarget = annotation.isFocusTarget ? "true" : "false";
  frame.dataset.noteId = annotation.id;
  frame.dataset.noteTone = String(annotation.tone ?? 0);
  frame.style.borderRadius = milkdownAnnotationFrameCornerRadius;
  frame.style.height = `${roundFrameValue(frameBottom - frameTop)}px`;
  frame.style.left = `${roundFrameValue(frameLeft)}px`;
  frame.style.top = `${roundFrameValue(frameTop)}px`;
  frame.style.width = `${roundFrameValue(frameRight - frameLeft)}px`;
  frame.setAttribute("data-frame-key", `code:${annotation.id}:${rectIndex}`);

  return frame;
}

function syncMilkdownCodeBlockAnnotationLayers(
  container: HTMLDivElement,
  markdown: string,
  annotations: TextAnnotation[],
  renderedNoteIds: Set<string>,
) {
  clearMilkdownCodeBlockAnnotationLayers(container);

  const framesByCodeBlock = new Map<HTMLElement, HTMLElement[]>();
  annotations.forEach((annotation) => {
    if (renderedNoteIds.has(annotation.id)) return;

    const codeRects = codeBlockAnnotationRects(container, annotation, markdown);
    codeRects.forEach((rect, rectIndex) => {
      const frame = createMilkdownCodeBlockAnnotationFrame({
        annotation,
        codeBlock: rect.codeBlock,
        rect,
        rectIndex,
      });
      if (!frame) return;

      framesByCodeBlock.set(rect.codeBlock, [
        ...(framesByCodeBlock.get(rect.codeBlock) ?? []),
        frame,
      ]);
    });
  });

  framesByCodeBlock.forEach((frames, codeBlock) => {
    if (frames.length === 0) return;

    const layer = document.createElement("div");
    layer.className = "milkdown-code-block-annotation-layer";
    layer.setAttribute("aria-hidden", "true");
    frames.forEach((frame) => layer.append(frame));
    codeBlock.insertBefore(layer, codeBlock.firstChild);
  });
}

function measureMilkdownAnnotationFrames(
  container: HTMLDivElement,
  markdown: string,
  annotations: TextAnnotation[],
): MilkdownAnnotationFrame[] {
  const containerRect = container.getBoundingClientRect();
  const rectsByNoteId = new Map<string, MilkdownAnnotationRect[]>();
  const tonesByNoteId = new Map<string, AnnotationTone>();
  const kindsByNoteId = new Map<string, "note" | "glossary">();
  const focusByNoteId = new Map<string, boolean>();

  function annotationLineScope(annotation: HTMLElement) {
    return (
      annotation.closest<HTMLElement>(
        "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th",
      ) ?? annotation.parentElement
    );
  }

  function annotationLineMetrics(annotation: HTMLElement, rect: DOMRect) {
    const scope = annotationLineScope(annotation);
    if (!scope) {
      return {
        canExtendRight: true,
        lineRight: rect.right,
      };
    }

    const range = document.createRange();
    range.selectNodeContents(scope);
    const rectMidY = (rect.top + rect.bottom) / 2;
    const lineRects = Array.from(range.getClientRects()).filter(
      (lineRect) =>
        lineRect.width > 0 &&
        lineRect.height > 0 &&
        rectMidY >= lineRect.top - 1 &&
        rectMidY <= lineRect.bottom + 1,
    );

    if (lineRects.length === 0) {
      return {
        canExtendRight: true,
        lineRight: Math.min(rect.right, containerRect.right),
      };
    }

    const lineRight = Math.max(...lineRects.map((lineRect) => lineRect.right));

    return {
      canExtendRight: rect.right >= lineRight - milkdownAnnotationLineEndTolerance,
      lineRight,
    };
  }

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
          const right = rect.right;
          const bottom = Math.min(rect.bottom, containerRect.bottom);
          const lineMetrics = annotationLineMetrics(annotation, rect);

          return {
            canExtendRight: lineMetrics.canExtendRight,
            left,
            lineRight: lineMetrics.lineRight,
            top,
            right,
            bottom,
          };
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

  syncMilkdownCodeBlockAnnotationLayers(
    container,
    markdown,
    annotations,
    new Set(rectsByNoteId.keys()),
  );

  return Array.from(rectsByNoteId.entries())
    .flatMap(([noteId, rects]) => {
      const kind = kindsByNoteId.get(noteId) ?? "note";
      const tone = tonesByNoteId.get(noteId) ?? 0;
      const isFocusTarget = focusByNoteId.get(noteId) ?? false;
      const sortedRects = rects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );
      const extensionRightByRect = new Map<MilkdownAnnotationRect, number>();
      const borderRadiusByRect = new Map<MilkdownAnnotationRect, string>();
      let rectGroup: MilkdownAnnotationRect[] = [];

      function flushRectGroup() {
        if (rectGroup.length === 0) return;

        const extendableLineRights = rectGroup
          .filter((rect) => rect.canExtendRight)
          .map((rect) => Math.max(rect.right, rect.lineRight));
        if (extendableLineRights.length > 0) {
          const targetRight = Math.max(...extendableLineRights);
          rectGroup.forEach((rect) => {
            extensionRightByRect.set(
              rect,
              rect.canExtendRight ? Math.max(rect.right, targetRight) : rect.right,
            );
          });
        }

        rectGroup.forEach((rect, groupIndex) => {
          const isFirstRect = groupIndex === 0;
          const isLastRect = groupIndex === rectGroup.length - 1;
          borderRadiusByRect.set(
            rect,
            [
              isFirstRect ? milkdownAnnotationFrameCornerRadius : "0",
              isFirstRect ? milkdownAnnotationFrameCornerRadius : "0",
              isLastRect ? milkdownAnnotationFrameCornerRadius : "0",
              isLastRect ? milkdownAnnotationFrameCornerRadius : "0",
            ].join(" "),
          );
        });
        rectGroup = [];
      }

      if (kind !== "glossary") {
        sortedRects.forEach((rect) => {
          const previousRect = rectGroup[rectGroup.length - 1];
          const lineGap = previousRect ? rect.top - previousRect.bottom : 0;
          if (
            previousRect &&
            (lineGap < 0 || lineGap > milkdownAnnotationLineJoinMaxGap)
          ) {
            flushRectGroup();
          }

          rectGroup.push(rect);
        });
        flushRectGroup();
      }

      return sortedRects.flatMap((rect, rectIndex) => {
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

        const frameLeft = Math.max(
          containerRect.left,
          rect.clipLeft ?? containerRect.left,
          rect.left - frameHorizontalPadding,
        );
        const frameRight = Math.min(
          containerRect.right,
          rect.clipRight ?? containerRect.right,
          (extensionRightByRect.get(rect) ?? rect.right) + frameHorizontalPadding,
        );
        const frameTop = Math.max(containerRect.top, top);
        const frameBottom = Math.min(containerRect.bottom, bottom);

        if (frameRight <= frameLeft || frameBottom <= frameTop) return [];

        return {
          borderRadius: borderRadiusByRect.get(rect) ?? milkdownAnnotationFrameCornerRadius,
          frameKey: `${kind}:${noteId}:milkdown:${rectIndex}`,
          isFocusTarget,
          layer: "background" as const,
          noteId,
          kind,
          tone,
          left: roundFrameValue(frameLeft - containerRect.left),
          top: roundFrameValue(frameTop - containerRect.top),
          width: roundFrameValue(frameRight - frameLeft),
          height: roundFrameValue(frameBottom - frameTop),
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
      leftFrame.borderRadius === rightFrame.borderRadius &&
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

function editorMarkdownFromFullSource(markdown: string) {
  return stripMarkdownFrontmatter(markdown);
}

function sourceAnchorFromEditorAnchor(markdown: string, anchor: TextSelectionAnchor | null) {
  if (!anchor) return null;

  const from = fullSourceOffsetFromFrontmatterBodyOffset(markdown, anchor.from);
  const to = fullSourceOffsetFromFrontmatterBodyOffset(markdown, anchor.to);
  return makeAnchorFromSourceRange(markdown, from, to);
}

function annotationForEditorSource(annotation: TextAnnotation, markdown: string) {
  const frontmatter = splitMarkdownFrontmatter(markdown);
  if (!frontmatter) return annotation;
  if (annotation.to <= frontmatter.bodyStart) return null;

  return {
    ...annotation,
    from: Math.max(0, annotation.from - frontmatter.bodyStart),
    to: Math.max(0, annotation.to - frontmatter.bodyStart),
  };
}

function annotationsForEditorSource(annotations: TextAnnotation[], markdown: string) {
  return annotations
    .map((annotation) => annotationForEditorSource(annotation, markdown))
    .filter((annotation): annotation is TextAnnotation => Boolean(annotation));
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

function selectionVisuallyOverlapsRoot(root: HTMLElement, selection: Selection | null) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;

  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return false;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const rects = Array.from(range.getClientRects());

    for (const rect of rects) {
      const overlaps =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right >= rootRect.left &&
        rect.left <= rootRect.right &&
        rect.bottom >= rootRect.top &&
        rect.top <= rootRect.bottom;

      if (overlaps) return true;
    }
  }

  return false;
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

function buildMilkdownSearchRanges(doc: ProseMirrorNode, query: string) {
  const normalizedQuery = normalizeDocumentSearchQuery(query);
  if (!normalizedQuery) return [];

  const { positions, text } = buildNormalizedVisibleTextIndex(doc);
  return findNormalizedSearchMatchIndexes(text.toLocaleLowerCase(), normalizedQuery)
    .map((match) => {
      const from = positions[match.fromIndex];
      const lastPosition = positions[match.toIndex - 1];

      if (from === undefined || lastPosition === undefined) return null;

      return {
        from,
        to: lastPosition + 1,
      };
    })
    .filter((match): match is { from: number; to: number } =>
      Boolean(match && match.to > match.from),
    );
}

function buildSearchDecorations(doc: ProseMirrorNode, search: DocumentSearchState) {
  const decorations = buildMilkdownSearchRanges(doc, search.query).map((match, index) =>
    Decoration.inline(
      match.from,
      match.to,
      {
        class: [
          "milkdown-document-search-match",
          index === search.activeIndex ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        inclusiveEnd: false,
        inclusiveStart: false,
      },
    ),
  );

  return DecorationSet.create(doc, decorations);
}

function visibleTextIndexFromProsePosition(doc: ProseMirrorNode, position: number) {
  const visibleTextIndex = buildNormalizedVisibleTextIndex(doc);
  const index = visibleTextIndex.positions.findIndex(
    (visiblePosition) => visiblePosition >= position,
  );

  return index >= 0 ? index : visibleTextIndex.text.length;
}

function textBlockRangeFromResolvedPosition($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!node.isTextblock) continue;

    const from = $pos.start(depth);
    const to = $pos.end(depth);
    if (to > from) return { from, to };
  }

  return null;
}

function textBlockRangeAroundProsePosition(doc: ProseMirrorNode, position: number) {
  const boundedPosition = Math.max(0, Math.min(position, doc.content.size));
  const candidatePositions = Array.from(
    new Set([
      boundedPosition,
      boundedPosition - 1,
      boundedPosition + 1,
      boundedPosition - 2,
      boundedPosition + 2,
    ]),
  ).filter((candidate) => candidate >= 0 && candidate <= doc.content.size);

  for (const candidatePosition of candidatePositions) {
    const range = textBlockRangeFromResolvedPosition(doc.resolve(candidatePosition));
    if (range) return range;
  }

  const nearbyRanges: { distance: number; from: number; to: number }[] = [];
  doc.descendants((node, nodePosition) => {
    if (!node.isTextblock) return true;

    const from = nodePosition + 1;
    const to = nodePosition + node.nodeSize - 1;
    if (to <= from) return false;

    const distance =
      boundedPosition < from
        ? from - boundedPosition
        : boundedPosition > to
          ? boundedPosition - to
          : 0;

    nearbyRanges.push({ distance, from, to });

    return false;
  });

  const nearestRange = nearbyRanges.sort((left, right) => left.distance - right.distance)[0];
  if (!nearestRange || nearestRange.distance > 2) return null;

  return {
    from: nearestRange.from,
    to: nearestRange.to,
  };
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

function annotationSourceFromAnnotationTarget(
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
    )[0] ?? null
  );
}

function createAnnotationPlugin({
  getAnnotations,
  getMarkdown,
  onAnnotationClick,
  onAnnotationDoubleClick,
  onFocusTargetAnnotationPress,
}: {
  getAnnotations: () => TextAnnotation[];
  getMarkdown: () => string;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
  onFocusTargetAnnotationPress: (noteId: string) => boolean;
}) {
  return new Plugin<DecorationSet>({
    key: milkdownAnnotationPluginKey,
    props: {
      decorations(state) {
        return milkdownAnnotationPluginKey.getState(state) ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        mousedown(_view, event) {
          const source = annotationSourceFromAnnotationTarget(event.target, getAnnotations());
          if (!source?.isFocusTarget) return false;
          if (!onFocusTargetAnnotationPress(source.noteId)) return false;

          event.preventDefault();
          event.stopPropagation();
          return true;
        },
        pointerdown(_view, event) {
          const source = annotationSourceFromAnnotationTarget(event.target, getAnnotations());
          if (!source?.isFocusTarget) return false;
          if (!onFocusTargetAnnotationPress(source.noteId)) return false;

          event.preventDefault();
          event.stopPropagation();
          return true;
        },
        click(_view, event) {
          const source = annotationSourceFromAnnotationTarget(event.target, getAnnotations());
          if (!source || !window.getSelection()?.isCollapsed) return false;

          event.preventDefault();
          if (source.isFocusTarget && onFocusTargetAnnotationPress(source.noteId)) {
            return true;
          }

          onAnnotationClick(source.noteId);
          return true;
        },
        dblclick(_view, event) {
          const source = annotationSourceFromAnnotationTarget(event.target, getAnnotations());
          if (!source) return false;

          onAnnotationDoubleClick(source.noteId);
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

function createSearchPlugin({ getSearch }: { getSearch: () => DocumentSearchState }) {
  return new Plugin<DecorationSet>({
    key: milkdownSearchPluginKey,
    props: {
      decorations(state) {
        return milkdownSearchPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
    state: {
      init(_, state) {
        return buildSearchDecorations(state.doc, getSearch());
      },
      apply(transaction, decorations) {
        const mappedDecorations = decorations.map(transaction.mapping, transaction.doc);
        if (!transaction.docChanged && !transaction.getMeta(milkdownSearchPluginKey)) {
          return mappedDecorations;
        }

        return buildSearchDecorations(transaction.doc, getSearch());
      },
    },
  });
}

export function MilkdownMarkdownEditor({
  value,
  annotations,
  documentFilePath = null,
  noteModeEnabled,
  readOnly = false,
  mobileBlockSelectionEnabled = false,
  search = { activeIndex: 0, query: "" },
  onSearchMatchCountChange,
  toolbarEnabled = true,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
  onAnnotationDoubleClick,
  onFocusTargetAnnotationPress,
}: MilkdownMarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const currentMarkdownRef = useRef(normalizeMarkdownForScholium(value));
  const editorMarkdownRef = useRef(editorMarkdownFromFullSource(currentMarkdownRef.current));
  const annotationsRef = useRef(annotations);
  const editorAnnotationsRef = useRef(
    annotationsForEditorSource(annotations, currentMarkdownRef.current),
  );
  const searchRef = useRef(search);
  const documentFilePathRef = useRef(documentFilePath);
  const noteModeEnabledRef = useRef(noteModeEnabled);
  const readOnlyRef = useRef(readOnly);
  const mobileBlockSelectionEnabledRef = useRef(mobileBlockSelectionEnabled);
  const onChangeRef = useRef(onChange);
  const onSearchMatchCountChangeRef = useRef(onSearchMatchCountChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const onFocusTargetAnnotationPressRef = useRef(onFocusTargetAnnotationPress);
  const animationFrameRef = useRef(0);
  const annotationLayoutSettleTimersRef = useRef<number[]>([]);
  const selectionFrameRef = useRef(0);
  const selectionFallbackTimerRef = useRef(0);
  const touchBlockSelectionPublishSuppressedUntilRef = useRef(0);
  const readonlyDomFocusFrameRef = useRef(0);
  const readonlyDomFocusSnapshotsRef = useRef(
    new WeakMap<HTMLElement, ReadonlyDomFocusSnapshot>(),
  );
  const readonlyDomFocusElementsRef = useRef(new Set<HTMLElement>());
  const annotationClickTimerRef = useRef(0);
  const suppressedFocusTargetAnnotationPressRef = useRef<{
    noteId: string;
    until: number;
  } | null>(null);
  const mouseSelectionStartedRef = useRef(false);
  const imeCompositionActiveRef = useRef(false);
  const imeSelectionSuppressedUntilRef = useRef(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [annotationFrames, setAnnotationFrames] = useState<MilkdownAnnotationFrame[]>([]);
  const searchSignature = `${search.query}\n${search.activeIndex}`;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      const button = target.closest(".milkdown-code-block .tools button") as HTMLButtonElement | null;
      if (button) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest(".milkdown-code-block .tools button") as HTMLButtonElement | null;
      if (button) {
        e.preventDefault();
        button.click();
      }
    };

    container.addEventListener("mousedown", preventFocus, { capture: true });
    container.addEventListener("touchstart", preventFocus, { capture: true, passive: false });
    container.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });

    return () => {
      container.removeEventListener("mousedown", preventFocus, { capture: true });
      container.removeEventListener("touchstart", preventFocus, { capture: true });
      container.removeEventListener("touchend", handleTouchEnd, { capture: true });
    };
  }, []);

  function updateAnnotationFrames() {
    const container = containerRef.current;
    if (!container) return;

    if (!noteModeEnabledRef.current) {
      clearMilkdownCodeBlockAnnotationLayers(container);
      setAnnotationFrames((currentFrames) => (currentFrames.length === 0 ? currentFrames : []));
      return;
    }

    const nextFrames = measureMilkdownAnnotationFrames(
      container,
      currentMarkdownRef.current,
      editorAnnotationsRef.current,
    );
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

  function clearAnnotationLayoutSettleTimers() {
    annotationLayoutSettleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    annotationLayoutSettleTimersRef.current = [];
  }

  function scheduleSettledAnnotationFrameUpdate() {
    scheduleAnnotationFrameUpdate();
    clearAnnotationLayoutSettleTimers();
    annotationLayoutSettleTimersRef.current = annotationLayoutSettleDelaysMs.map((delay) =>
      window.setTimeout(scheduleAnnotationFrameUpdate, delay),
    );
  }

  function hydrateLocalMarkdownImages() {
    const root = rootRef.current;
    const markdownPath = documentFilePathRef.current?.trim();
    if (!root || !markdownPath) return;

    root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
      const originalSrc =
        image.getAttribute(localImageHydratedSrcAttribute) ??
        image.getAttribute("src") ??
        "";
      if (!localMarkdownImageNeedsHydration(originalSrc)) return;

      const loadingKey = `${markdownPath}\n${originalSrc}`;
      if (image.getAttribute(localImageLoadingAttribute) === loadingKey) return;
      if (
        image.getAttribute(localImageHydratedSrcAttribute) === originalSrc &&
        image.getAttribute(localImageMarkdownPathAttribute) === markdownPath &&
        image.getAttribute(localImageResolvedPathAttribute) &&
        image.getAttribute("src")?.startsWith("data:")
      ) {
        return;
      }

      image.setAttribute(localImageHydratedSrcAttribute, originalSrc);
      image.setAttribute(localImageMarkdownPathAttribute, markdownPath);
      image.setAttribute(localImageLoadingAttribute, loadingKey);
      image.removeAttribute(localImageErrorAttribute);

      void invoke<MarkdownImageFileResult>("read_markdown_image_file", {
        markdownPath,
        imageSrc: originalSrc,
      })
        .then((result) => {
          if (
            image.getAttribute(localImageHydratedSrcAttribute) !== originalSrc ||
            image.getAttribute(localImageMarkdownPathAttribute) !== markdownPath
          ) {
            return;
          }

          image.src = result.dataUrl;
          image.setAttribute(localImageResolvedPathAttribute, result.path);
          image.removeAttribute(localImageErrorAttribute);
        })
        .catch(() => {
          if (
            image.getAttribute(localImageHydratedSrcAttribute) !== originalSrc ||
            image.getAttribute(localImageMarkdownPathAttribute) !== markdownPath
          ) {
            return;
          }

          image.setAttribute(localImageErrorAttribute, "true");
        })
        .finally(() => {
          if (image.getAttribute(localImageLoadingAttribute) === loadingKey) {
            image.removeAttribute(localImageLoadingAttribute);
          }
        });
    });
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

  function selectionPublishSuppressedByIme() {
    return (
      imeCompositionActiveRef.current ||
      Date.now() < imeSelectionSuppressedUntilRef.current
    );
  }

  function suppressSelectionPublishForIme() {
    imeSelectionSuppressedUntilRef.current = Date.now() + imeSelectionSuppressionMs;
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    mouseSelectionStartedRef.current = false;
  }

  function handleImeCompositionStart() {
    imeCompositionActiveRef.current = true;
    suppressSelectionPublishForIme();
    onSelectionChangeRef.current(null);
  }

  function handleImeCompositionEnd() {
    imeCompositionActiveRef.current = false;
    suppressSelectionPublishForIme();
    onSelectionChangeRef.current(null);
  }

  function keyboardEventIsComposing(
    event: KeyboardEvent | ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const nativeIsComposing =
      "nativeEvent" in event ? event.nativeEvent.isComposing : event.isComposing;

    return nativeIsComposing || selectionPublishSuppressedByIme();
  }

  function resolvedPositionHasAncestor(
    $from: ResolvedPos,
    nodeTypeNames: Set<string>,
  ) {
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if (nodeTypeNames.has($from.node(depth).type.name)) return true;
    }

    return false;
  }

  function shouldInsertPlainEnterHardBreak(view: EditorView, event: KeyboardEvent) {
    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter) return false;
    if (keyboardEventIsComposing(event)) return false;
    if (readOnlyRef.current) return false;

    const { selection, schema } = view.state;
    if (!selection.empty) return false;

    const { $from } = selection;
    const parent = $from.parent;
    if (!parent.isTextblock || parent.content.size === 0) return false;
    if (parent.type.name === "code_block" || parent.type.name === "heading") {
      return false;
    }
    if (resolvedPositionHasAncestor($from, milkdownStructuredTextAncestorNames)) {
      return false;
    }

    const hardbreakType = schema.nodes.hardbreak;
    if (!hardbreakType) return false;

    return parent.canReplaceWith($from.index(), $from.index(), hardbreakType);
  }

  function insertPlainEnterHardBreak(view: EditorView) {
    const hardbreakType = view.state.schema.nodes.hardbreak;
    if (!hardbreakType) return false;

    view.dispatch(
      view.state.tr
        .setMeta("hardbreak", true)
        .replaceSelectionWith(hardbreakType.create())
        .scrollIntoView(),
    );

    return true;
  }

  function shouldSplitParagraphWithShiftEnter(view: EditorView, event: KeyboardEvent) {
    const isShiftEnter =
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;
    if (!isShiftEnter) return false;
    if (keyboardEventIsComposing(event)) return false;
    if (readOnlyRef.current) return false;

    const { selection } = view.state;
    if (!selection.empty) return false;

    const { $from } = selection;
    const parent = $from.parent;
    if (!parent.isTextblock || parent.type.name !== "paragraph") return false;
    if (resolvedPositionHasAncestor($from, milkdownStructuredTextAncestorNames)) {
      return false;
    }

    return true;
  }

  function splitParagraphWithShiftEnter(view: EditorView) {
    return splitBlock(view.state, (transaction) => view.dispatch(transaction), view);
  }

  function createPlainEnterHardBreakPlugin() {
    return new Plugin({
      key: milkdownPlainEnterHardBreakPluginKey,
      props: {
        handleKeyDown(view, event) {
          if (shouldInsertPlainEnterHardBreak(view, event)) {
            event.preventDefault();
            return insertPlainEnterHardBreak(view);
          }

          if (!shouldSplitParagraphWithShiftEnter(view, event)) return false;

          event.preventDefault();
          return splitParagraphWithShiftEnter(view);
        },
      },
    });
  }

  function setDomAttribute(
    element: HTMLElement,
    name: keyof ReadonlyDomFocusSnapshot,
    value: string | null,
  ) {
    const attributeName = name === "ariaReadonly" ? "aria-readonly" : name;

    if (value === null) {
      element.removeAttribute(attributeName);
      return;
    }

    element.setAttribute(attributeName, value);
  }

  function setDomAttributeIfChanged(
    element: HTMLElement,
    name: string,
    value: string,
  ) {
    if (element.getAttribute(name) === value) return;

    element.setAttribute(name, value);
  }

  function rememberReadonlyDomFocusElement(element: HTMLElement) {
    if (!readonlyDomFocusSnapshotsRef.current.has(element)) {
      readonlyDomFocusSnapshotsRef.current.set(element, {
        ariaReadonly: element.getAttribute("aria-readonly"),
        contenteditable: element.getAttribute("contenteditable"),
        inputmode: element.getAttribute("inputmode"),
        tabindex: element.getAttribute("tabindex"),
      });
    }

    readonlyDomFocusElementsRef.current.add(element);
  }

  function restoreReadonlyDomFocusElements() {
    readonlyDomFocusElementsRef.current.forEach((element) => {
      const snapshot = readonlyDomFocusSnapshotsRef.current.get(element);
      if (!snapshot) return;

      setDomAttribute(element, "ariaReadonly", snapshot.ariaReadonly);
      if (element.classList.contains("ProseMirror") || element.classList.contains("cm-content")) {
        element.setAttribute("contenteditable", "true");
      } else {
        setDomAttribute(element, "contenteditable", snapshot.contenteditable);
      }
      setDomAttribute(element, "inputmode", snapshot.inputmode);
      setDomAttribute(element, "tabindex", snapshot.tabindex);
      readonlyDomFocusSnapshotsRef.current.delete(element);
    });

    readonlyDomFocusElementsRef.current.clear();
  }

  function blurReadonlyEditorFocus() {
    if (!readOnlyRef.current) return;

    const root = rootRef.current;
    if (!root || !(document.activeElement instanceof Node)) return;
    if (!root.contains(document.activeElement)) return;

    (document.activeElement as HTMLElement).blur();
  }

  function applyReadonlyDomFocusState() {
    if (!readOnlyRef.current) {
      restoreReadonlyDomFocusElements();
      return;
    }

    const root = rootRef.current;
    if (!root) return;

    root
      .querySelectorAll<HTMLElement>(milkdownReadonlyFocusableSelector)
      .forEach((element) => {
        rememberReadonlyDomFocusElement(element);
        setDomAttributeIfChanged(element, "contenteditable", "false");
        setDomAttributeIfChanged(element, "inputmode", "none");
        setDomAttributeIfChanged(element, "aria-readonly", "true");
        setDomAttributeIfChanged(element, "tabindex", "-1");
      });

    blurReadonlyEditorFocus();
  }

  function scheduleReadonlyDomFocusSync() {
    window.cancelAnimationFrame(readonlyDomFocusFrameRef.current);
    readonlyDomFocusFrameRef.current = window.requestAnimationFrame(() => {
      readonlyDomFocusFrameRef.current = 0;
      applyReadonlyDomFocusState();
    });
  }

  function createReadonlyGuardPlugin() {
    function contentMutationBlocked() {
      return readOnlyRef.current || noteModeEnabledRef.current;
    }

    function blockReadonlyDomMutation(event: Event) {
      if (!contentMutationBlocked()) return false;

      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    return new Plugin({
      key: milkdownReadonlyGuardPluginKey,
      props: {
        attributes() {
          if (!readOnlyRef.current) return {} as Record<string, string>;

          return {
            "aria-readonly": "true",
            inputmode: "none",
            tabindex: "-1",
          } as Record<string, string>;
        },
        editable() {
          return !readOnlyRef.current;
        },
        handleDOMEvents: {
          beforeinput(_view, event) {
            return blockReadonlyDomMutation(event);
          },
          compositionstart(_view, event) {
            return blockReadonlyDomMutation(event);
          },
          cut(_view, event) {
            return blockReadonlyDomMutation(event);
          },
          drop(_view, event) {
            return blockReadonlyDomMutation(event);
          },
          focus(_view, event) {
            if (!readOnlyRef.current) return false;

            (event.target as HTMLElement | null)?.blur();
            return true;
          },
          input(_view, event) {
            return blockReadonlyDomMutation(event);
          },
          paste(_view, event) {
            return blockReadonlyDomMutation(event);
          },
        },
      },
      filterTransaction(transaction) {
        return !(contentMutationBlocked() && transaction.docChanged);
      },
    });
  }

  function readonlyDomEventShouldBeBlocked(event: Event) {
    if (!readOnlyRef.current && !noteModeEnabledRef.current) return false;

    const root = rootRef.current;
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) {
      return false;
    }

    const targetElement = elementFromEventTarget(event.target);
    if (!targetElement) return false;
    if (targetElement.closest(".copy-button, .tools button")) return false;

    return Boolean(targetElement.closest(".ProseMirror, .milkdown-code-block, .cm-editor"));
  }

  function blockReadonlyDomEvent(event: Event) {
    if (!readonlyDomEventShouldBeBlocked(event)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.cancelBubble !== true) {
      event.stopImmediatePropagation();
    }
    applyReadonlyDomFocusState();
    blurReadonlyEditorFocus();
  }

  function clearQueuedAnnotationClick() {
    window.clearTimeout(annotationClickTimerRef.current);
    annotationClickTimerRef.current = 0;
  }

  function annotationIsFocusTarget(noteId: string) {
    return annotationsRef.current.some(
      (annotation) => annotation.id === noteId && annotation.isFocusTarget,
    );
  }

  function suppressFocusTargetAnnotationPress(noteId: string) {
    suppressedFocusTargetAnnotationPressRef.current = {
      noteId,
      until: Date.now() + annotationFocusTargetPressSuppressionMs,
    };
  }

  function focusTargetAnnotationPressIsSuppressed(noteId: string) {
    const suppressedPress = suppressedFocusTargetAnnotationPressRef.current;
    if (!suppressedPress) return false;

    if (Date.now() > suppressedPress.until) {
      suppressedFocusTargetAnnotationPressRef.current = null;
      return false;
    }

    return suppressedPress.noteId === noteId;
  }

  function handleFocusTargetAnnotationPress(noteId: string) {
    if (!annotationIsFocusTarget(noteId) && !focusTargetAnnotationPressIsSuppressed(noteId)) {
      return false;
    }

    clearQueuedAnnotationClick();

    if (!focusTargetAnnotationPressIsSuppressed(noteId)) {
      suppressFocusTargetAnnotationPress(noteId);
      onFocusTargetAnnotationPressRef.current?.(noteId);
    }

    return true;
  }

  function queueAnnotationClick(noteId: string) {
    clearQueuedAnnotationClick();
    annotationClickTimerRef.current = window.setTimeout(() => {
      annotationClickTimerRef.current = 0;
      if (focusTargetAnnotationPressIsSuppressed(noteId)) return;
      if (selectedMilkdownText()) return;

      onAnnotationClickRef.current(noteId);
    }, annotationClickDelayMs);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSearchMatchCountChangeRef.current = onSearchMatchCountChange;
  }, [onSearchMatchCountChange]);

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
    onFocusTargetAnnotationPressRef.current = onFocusTargetAnnotationPress;
  }, [onFocusTargetAnnotationPress]);

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
    mobileBlockSelectionEnabledRef.current = mobileBlockSelectionEnabled;
  }, [mobileBlockSelectionEnabled]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    syncMilkdownReadOnlyState();
  }, [readOnly]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const observer = new MutationObserver(() => {
      if (readOnlyRef.current) {
        scheduleReadonlyDomFocusSync();
      }
    });
    observer.observe(root, {
      attributeFilter: ["contenteditable", "tabindex"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    scheduleReadonlyDomFocusSync();

    const blockedEvents = ["beforeinput", "input", "compositionstart", "cut", "paste", "drop"];
    blockedEvents.forEach((eventName) => {
      root.addEventListener(eventName, blockReadonlyDomEvent, {
        capture: true,
      });
    });

    return () => {
      observer.disconnect();
      blockedEvents.forEach((eventName) => {
        root.removeEventListener(eventName, blockReadonlyDomEvent, true);
      });
      window.cancelAnimationFrame(readonlyDomFocusFrameRef.current);
      readonlyDomFocusFrameRef.current = 0;
      restoreReadonlyDomFocusElements();
    };
  }, [editorRevision]);

  useEffect(() => {
    annotationsRef.current = annotations;
    editorAnnotationsRef.current = annotationsForEditorSource(
      annotations,
      currentMarkdownRef.current,
    );
    scheduleAnnotationFrameUpdate();
  }, [annotations]);

  useEffect(() => {
    searchRef.current = search;
    dispatchSearchUpdate();
  }, [editorRevision, searchSignature, search]);

  useEffect(() => {
    documentFilePathRef.current = documentFilePath;
    hydrateLocalMarkdownImages();
  }, [documentFilePath]);

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

    const editorContentFrame = container.closest<HTMLElement>(".editor-content-frame");
    const resizeObserver = new ResizeObserver(scheduleSettledAnnotationFrameUpdate);
    resizeObserver.observe(container);
    if (rootRef.current) {
      resizeObserver.observe(rootRef.current);
    }
    if (editorContentFrame) {
      resizeObserver.observe(editorContentFrame);
      editorContentFrame.addEventListener("transitionend", scheduleSettledAnnotationFrameUpdate);
      editorContentFrame.addEventListener("transitioncancel", scheduleSettledAnnotationFrameUpdate);
    }

    window.addEventListener("resize", scheduleSettledAnnotationFrameUpdate);
    scheduleSettledAnnotationFrameUpdate();

    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      clearAnnotationLayoutSettleTimers();
      resizeObserver.disconnect();
      editorContentFrame?.removeEventListener(
        "transitionend",
        scheduleSettledAnnotationFrameUpdate,
      );
      editorContentFrame?.removeEventListener(
        "transitioncancel",
        scheduleSettledAnnotationFrameUpdate,
      );
      window.removeEventListener("resize", scheduleSettledAnnotationFrameUpdate);
    };
  }, [editorRevision]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    hydrateLocalMarkdownImages();

    const mutationObserver = new MutationObserver(hydrateLocalMarkdownImages);
    mutationObserver.observe(root, {
      attributeFilter: ["src"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
    };
  }, [editorRevision]);

  useEffect(() => {
    const normalizedValue = normalizeMarkdownForScholium(value);
    if (normalizedValue === currentMarkdownRef.current) return;

    currentMarkdownRef.current = normalizedValue;
    editorMarkdownRef.current = editorMarkdownFromFullSource(normalizedValue);
    editorAnnotationsRef.current = annotationsForEditorSource(
      annotationsRef.current,
      normalizedValue,
    );
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

  function syncMilkdownReadOnlyState() {
    const readOnlyState = readOnlyRef.current;
    if (readOnlyState) {
      applyReadonlyDomFocusState();
    }

    crepeRef.current?.setReadonly(readOnlyState);

    const view = currentEditorView();
    if (view) {
      view.setProps({
        editable: () => !readOnlyRef.current,
      });
    }

    applyReadonlyDomFocusState();

    if (!readOnlyState) return;

    blurReadonlyEditorFocus();
    window.getSelection()?.removeAllRanges();
  }

  function reportSearchMatchCount(view: EditorView | null = currentEditorView()) {
    const count = view
      ? buildMilkdownSearchRanges(view.state.doc, searchRef.current.query).length
      : 0;
    onSearchMatchCountChangeRef.current?.(count);
  }

  function scrollActiveSearchMatchIntoView() {
    window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>(".milkdown-document-search-match.is-active")
        ?.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
    });
  }

  function dispatchSearchUpdate() {
    const view = currentEditorView();
    if (!view) {
      onSearchMatchCountChangeRef.current?.(0);
      return;
    }

    view.dispatch(view.state.tr.setMeta(milkdownSearchPluginKey, true));
    reportSearchMatchCount(view);
    scrollActiveSearchMatchIntoView();
  }

  function anchorFromEditorSelection() {
    const view = currentEditorView();
    if (!view || view.state.selection.empty) return null;

    const { from, to } = view.state.selection;
    const selectedText = view.state.doc.textBetween(from, to, " ");
    return sourceAnchorFromEditorAnchor(
      currentMarkdownRef.current,
      buildAnchor(
        editorMarkdownRef.current,
        selectedText,
        visibleTextIndexFromProsePosition(view.state.doc, from),
      ),
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
      return sourceAnchorFromEditorAnchor(
        currentMarkdownRef.current,
        buildAnchor(
          editorMarkdownRef.current,
          selectedText,
          visibleTextIndexFromProsePosition(view.state.doc, from),
        ),
      );
    } catch {
      return null;
    }
  }

  function anchorFromCurrentSelection() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !nonCollapsedSelectionInRoot(root, selection)) {
      const selectedText = selection?.toString() ?? "";
      if (
        root &&
        selectedText.trim() &&
        selectionVisuallyOverlapsRoot(root, selection)
      ) {
        return sourceAnchorFromEditorAnchor(
          currentMarkdownRef.current,
          buildAnchor(editorMarkdownRef.current, selectedText),
        );
      }

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
      sourceAnchorFromEditorAnchor(
        currentMarkdownRef.current,
        buildAnchor(editorMarkdownRef.current, selection.toString(), approximateVisibleStart),
      ) ??
      anchorFromEditorSelection()
    );
  }

  function touchBlockSelectionEnabled() {
    return (
      noteModeEnabledRef.current &&
      mobileBlockSelectionEnabledRef.current &&
      !selectionPublishSuppressedByIme()
    );
  }

  function touchBlockSelectionPublishSuppressed() {
    return Date.now() < touchBlockSelectionPublishSuppressedUntilRef.current;
  }

  function suppressSelectionPublishAfterTouchBlockSelection() {
    touchBlockSelectionPublishSuppressedUntilRef.current =
      Date.now() + milkdownTouchSelectionPublishSuppressionMs;
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = 0;
    mouseSelectionStartedRef.current = false;
  }

  function elementFromEventTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  }

  function targetSupportsTouchBlockSelection(target: EventTarget | null) {
    const root = rootRef.current;
    if (!root || !(target instanceof Node) || !root.contains(target)) return false;

    const targetElement = elementFromEventTarget(target);
    if (!targetElement) return false;
    if (targetElement.closest(".milkdown-note-annotation")) return false;
    if (targetElement.closest("button, input, textarea, select, a")) return false;

    const editorElement = targetElement.closest(".ProseMirror");
    return Boolean(editorElement && root.contains(editorElement));
  }

  function anchorFromTouchBlockAtCoords(view: EditorView, clientX: number, clientY: number) {
    const position = view.posAtCoords({ left: clientX, top: clientY });
    if (!position) return null;

    const positionCandidates = Array.from(
      new Set(
        [position.pos, position.inside].filter(
          (candidate) => candidate >= 0 && candidate <= view.state.doc.content.size,
        ),
      ),
    );
    const range =
      positionCandidates
        .map((candidate) => textBlockRangeAroundProsePosition(view.state.doc, candidate))
        .find((candidate): candidate is { from: number; to: number } => Boolean(candidate)) ??
      null;
    if (!range) return null;

    const selectedText = view.state.doc.textBetween(range.from, range.to, " ");
    if (!normalizeSelectedText(selectedText)) return null;

    return sourceAnchorFromEditorAnchor(
      currentMarkdownRef.current,
      buildAnchor(
        editorMarkdownRef.current,
        selectedText,
        visibleTextIndexFromProsePosition(view.state.doc, range.from),
      ),
    );
  }

  function anchorFromTouchBlockDomFallback(
    view: EditorView,
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ) {
    const root = rootRef.current;
    if (!root) return null;

    const targetElement =
      elementFromEventTarget(target) ??
      (document.elementFromPoint(clientX, clientY) as HTMLElement | null);
    if (!targetElement || !root.contains(targetElement)) return null;

    const blockElement = targetElement.closest<HTMLElement>(milkdownTouchBlockDomSelector);
    if (!blockElement || !root.contains(blockElement)) return null;

    const clone = blockElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(".tools, button, input, textarea, select")
      .forEach((element) => element.remove());
    const selectedText = clone.innerText.replace(/\u00a0/g, " ");
    if (!normalizeSelectedText(selectedText)) return null;

    let approximateVisibleStart = 0;
    try {
      approximateVisibleStart = visibleTextIndexFromProsePosition(
        view.state.doc,
        view.posAtDOM(blockElement, 0),
      );
    } catch {
      approximateVisibleStart = 0;
    }

    return sourceAnchorFromEditorAnchor(
      currentMarkdownRef.current,
      buildAnchor(editorMarkdownRef.current, selectedText, approximateVisibleStart),
    );
  }

  function anchorFromTouchBlock(
    view: EditorView,
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ) {
    return (
      anchorFromTouchBlockAtCoords(view, clientX, clientY) ??
      anchorFromTouchBlockDomFallback(view, target, clientX, clientY)
    );
  }

  function completeTouchBlockSelection(
    view: EditorView,
    target: EventTarget | null,
    clientX: number,
    clientY: number,
    event?: Event,
  ) {
    const anchor = anchorFromTouchBlock(view, target, clientX, clientY);
    if (!anchor) return false;

    event?.preventDefault();
    event?.stopPropagation();
    window.getSelection()?.removeAllRanges();
    suppressSelectionPublishAfterTouchBlockSelection();
    onSelectionEnterRef.current(anchor);
    blurReadonlyEditorFocus();
    scheduleAnnotationFrameUpdate();
    return true;
  }

  function createTouchBlockSelectionPlugin() {
    let touchStart:
      | {
          clientX: number;
          clientY: number;
          moved: boolean;
          startedAt: number;
          target: EventTarget | null;
        }
      | null = null;

    function resetTouchStart() {
      touchStart = null;
    }

    function touchMovedFromStart(touch: Touch, start = touchStart) {
      if (!start) return true;

      return (
        Math.abs(touch.clientX - start.clientX) > milkdownTouchTapMaxMovePx ||
        Math.abs(touch.clientY - start.clientY) > milkdownTouchTapMaxMovePx
      );
    }

    return new Plugin({
      key: milkdownTouchBlockSelectionPluginKey,
      props: {
        handleDOMEvents: {
          touchstart(_view, event) {
            const touchEvent = event as TouchEvent;
            const touch = touchEvent.touches[0];
            if (
              !touch ||
              touchEvent.touches.length !== 1 ||
              !touchBlockSelectionEnabled() ||
              !targetSupportsTouchBlockSelection(touchEvent.target)
            ) {
              resetTouchStart();
              return false;
            }

            touchStart = {
              clientX: touch.clientX,
              clientY: touch.clientY,
              moved: false,
              startedAt: Date.now(),
              target: touchEvent.target,
            };
            applyReadonlyDomFocusState();
            blurReadonlyEditorFocus();
            return false;
          },
          touchmove(_view, event) {
            if (!touchStart) return false;

            const touchEvent = event as TouchEvent;
            const touch = touchEvent.touches[0];
            if (!touch || touchEvent.touches.length !== 1 || touchMovedFromStart(touch)) {
              touchStart.moved = true;
            }

            return false;
          },
          touchend(view, event) {
            const start = touchStart;
            resetTouchStart();
            if (!start || !touchBlockSelectionEnabled()) return false;

            const touchEvent = event as TouchEvent;
            const touch = touchEvent.changedTouches[0];
            if (!touch || touchEvent.changedTouches.length !== 1) return false;
            if (start.moved || touchMovedFromStart(touch, start)) return false;
            if (Date.now() - start.startedAt > milkdownTouchTapMaxDurationMs) return false;
            if (!targetSupportsTouchBlockSelection(start.target)) return false;

            return completeTouchBlockSelection(
              view,
              start.target,
              touch.clientX,
              touch.clientY,
              touchEvent,
            );
          },
          touchcancel() {
            resetTouchStart();
            return false;
          },
          selectstart(_view, event) {
            if (
              !touchBlockSelectionEnabled() ||
              !targetSupportsTouchBlockSelection(event.target)
            ) {
              return false;
            }

            event.preventDefault();
            return true;
          },
          contextmenu(_view, event) {
            if (
              !touchBlockSelectionEnabled() ||
              !targetSupportsTouchBlockSelection(event.target)
            ) {
              return false;
            }

            event.preventDefault();
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();
            suppressSelectionPublishAfterTouchBlockSelection();
            return true;
          },
        },
      },
    });
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let touchStart:
      | {
          clientX: number;
          clientY: number;
          moved: boolean;
          startedAt: number;
          target: EventTarget | null;
        }
      | null = null;

    function resetTouchStart() {
      touchStart = null;
    }

    function touchMovedFromStart(touch: Touch, start = touchStart) {
      if (!start) return true;

      return (
        Math.abs(touch.clientX - start.clientX) > milkdownTouchTapMaxMovePx ||
        Math.abs(touch.clientY - start.clientY) > milkdownTouchTapMaxMovePx
      );
    }

    function handleTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (
        !touch ||
        event.touches.length !== 1 ||
        !touchBlockSelectionEnabled() ||
        !targetSupportsTouchBlockSelection(event.target)
      ) {
        resetTouchStart();
        return;
      }

      touchStart = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        moved: false,
        startedAt: Date.now(),
        target: event.target,
      };
      applyReadonlyDomFocusState();
      blurReadonlyEditorFocus();
    }

    function handleTouchMove(event: TouchEvent) {
      if (!touchStart) return;

      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || touchMovedFromStart(touch)) {
        touchStart.moved = true;
      }
    }

    function handleTouchEnd(event: TouchEvent) {
      const start = touchStart;
      resetTouchStart();
      if (!start || !touchBlockSelectionEnabled()) return;

      const touch = event.changedTouches[0];
      if (!touch || event.changedTouches.length !== 1) return;
      if (start.moved || touchMovedFromStart(touch, start)) return;
      if (Date.now() - start.startedAt > milkdownTouchTapMaxDurationMs) return;
      if (!targetSupportsTouchBlockSelection(start.target)) return;

      const view = currentEditorView();
      if (!view) return;

      if (
        completeTouchBlockSelection(
          view,
          start.target,
          touch.clientX,
          touch.clientY,
          event,
        )
      ) {
        event.stopImmediatePropagation();
      }
    }

    function handleTouchCancel() {
      resetTouchStart();
    }

    root.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: false,
    });
    root.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    root.addEventListener("touchend", handleTouchEnd, {
      capture: true,
      passive: false,
    });
    root.addEventListener("touchcancel", handleTouchCancel, true);

    return () => {
      root.removeEventListener("touchstart", handleTouchStart, true);
      root.removeEventListener("touchmove", handleTouchMove, true);
      root.removeEventListener("touchend", handleTouchEnd, true);
      root.removeEventListener("touchcancel", handleTouchCancel, true);
    };
  }, [editorRevision]);

  function publishSelectionAfterSelectionComplete() {
    if (!noteModeEnabledRef.current) {
      mouseSelectionStartedRef.current = false;
      return;
    }
    if (selectionPublishSuppressedByIme()) return;
    if (touchBlockSelectionPublishSuppressed()) {
      mouseSelectionStartedRef.current = false;
      return;
    }

    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      if (selectionPublishSuppressedByIme()) return;

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
    if (!noteModeEnabledRef.current) return;
    if (selectionPublishSuppressedByIme()) return;
    if (touchBlockSelectionPublishSuppressed()) return;

    window.clearTimeout(selectionFallbackTimerRef.current);
    selectionFallbackTimerRef.current = window.setTimeout(() => {
      if (selectionPublishSuppressedByIme()) return;
      if (mouseSelectionStartedRef.current) return;

      publishSelectionAfterSelectionComplete();
    }, milkdownSelectionFallbackMs);
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function handleSelectionPointerDown(event: MouseEvent | PointerEvent) {
      if (event.button !== 0) return;
      if ("pointerType" in event && event.pointerType === "touch" && touchBlockSelectionEnabled()) {
        mouseSelectionStartedRef.current = false;
        return;
      }
      if (!noteModeEnabledRef.current) return;
      if (selectionPublishSuppressedByIme()) return;

      mouseSelectionStartedRef.current = true;
    }

    function handleSelectionPointerUp(event: MouseEvent | PointerEvent) {
      if (event.button !== 0) return;
      if ("pointerType" in event && event.pointerType === "touch" && touchBlockSelectionEnabled()) {
        mouseSelectionStartedRef.current = false;
        return;
      }
      if (!noteModeEnabledRef.current) {
        mouseSelectionStartedRef.current = false;
        return;
      }
      if (selectionPublishSuppressedByIme()) return;

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
    root.addEventListener("compositionstart", handleImeCompositionStart, true);
    root.addEventListener("compositionend", handleImeCompositionEnd, true);
    window.addEventListener("mouseup", handleSelectionPointerUp, true);
    window.addEventListener("pointerup", handleSelectionPointerUp, true);

    return () => {
      window.cancelAnimationFrame(selectionFrameRef.current);
      window.clearTimeout(selectionFallbackTimerRef.current);
      root.removeEventListener("mousedown", handleSelectionPointerDown, true);
      root.removeEventListener("pointerdown", handleSelectionPointerDown, true);
      root.removeEventListener("compositionstart", handleImeCompositionStart, true);
      root.removeEventListener("compositionend", handleImeCompositionEnd, true);
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
      defaultValue: encodeEmptyParagraphsForMilkdown(editorMarkdownRef.current),
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
      ctx.update(hardbreakSchema.key, (previousSchema) => (schemaCtx) => {
        const schema = previousSchema(schemaCtx);

        return {
          ...schema,
          parseDOM: [
            {
              tag: "br[data-is-inline=\"true\"]",
              getAttrs: () => ({ isInline: true }),
            },
            ...(schema.parseDOM ?? []),
          ],
          toDOM: (node) => ["br", schemaCtx.get(hardbreakAttr.key)(node)],
        };
      });

      ctx.update(codeBlockConfig.key, (previousConfig) => ({
        ...previousConfig,
        previewOnlyByDefault: false,
        renderPreview: (language, content, applyPreview) => {
          if (isMermaidLanguage(language)) {
            return renderMilkdownMermaidPreview(content, applyPreview);
          }

          return previousConfig.renderPreview(language, content, applyPreview);
        },
      }));

      ctx.update(listItemBlockConfig.key, (previousConfig) => ({
        ...previousConfig,
        renderLabel: (props) => {
          if (props.checked == null) {
            if (props.listType === "bullet") {
              return scholiumBulletListLabel;
            }

            return `<span class="scholium-list-number">${escapeListLabelHtml(props.label)}</span>`;
          }

          return previousConfig.renderLabel(props);
        },
      }));

      ctx.update(prosePluginsCtx, (plugins) => [
        createTouchBlockSelectionPlugin(),
        createPlainEnterHardBreakPlugin(),
        createReadonlyGuardPlugin(),
        ...plugins,
        createAnnotationPlugin({
          getAnnotations: () => editorAnnotationsRef.current,
          getMarkdown: () => editorMarkdownRef.current,
          onAnnotationClick: queueAnnotationClick,
          onAnnotationDoubleClick: clearQueuedAnnotationClick,
          onFocusTargetAnnotationPress: handleFocusTargetAnnotationPress,
        }),
        createSearchPlugin({
          getSearch: () => searchRef.current,
        }),
      ]);
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const normalizedEditorMarkdown = normalizeMarkdownForScholium(markdown);
        const normalizedMarkdown = mergeMarkdownFrontmatter(
          currentMarkdownRef.current,
          normalizedEditorMarkdown,
        );
        if (disposed || normalizedMarkdown === currentMarkdownRef.current) return;
        if (readOnlyRef.current) return;

        currentMarkdownRef.current = normalizedMarkdown;
        editorMarkdownRef.current = normalizedEditorMarkdown;
        editorAnnotationsRef.current = annotationsForEditorSource(
          annotationsRef.current,
          normalizedMarkdown,
        );
        onChangeRef.current(normalizedMarkdown, "user");
        scheduleAnnotationFrameUpdate();
        dispatchSearchUpdate();
      });

      listener.selectionUpdated(() => {
        if (selectionPublishSuppressedByIme()) {
          scheduleAnnotationFrameUpdate();
          return;
        }

        scheduleSelectionPublishFromDom();
        scheduleAnnotationFrameUpdate();
      });
    });

    crepeRef.current = crepe;
    syncMilkdownReadOnlyState();
    void crepe
      .create()
      .then(() => {
        syncMilkdownReadOnlyState();
        hydrateLocalMarkdownImages();
        scheduleAnnotationFrameUpdate();
        dispatchSearchUpdate();
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
    if (keyboardEventIsComposing(event)) return;

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
      const selectionIsInEditor =
        selectionBelongsToRoot(root, selection) ||
        selectionVisuallyOverlapsRoot(root, selection);
      if (!selectionIsInEditor && !editorHasFocus) return;

      handleSelectionEnterKeyDown(event);
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [editorRevision]);

  const shellClassName = [
    "milkdown-markdown-editor-shell",
    readOnly ? "is-readonly" : "",
    noteModeEnabled && mobileBlockSelectionEnabled ? "is-touch-note-selection" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const backgroundAnnotationFrames = annotationFrames.filter(
    (frame) => frame.layer === "background",
  );
  const foregroundAnnotationFrames = annotationFrames.filter(
    (frame) => frame.layer === "foreground",
  );

  function renderAnnotationFrame(frame: MilkdownAnnotationFrame) {
    return (
      <div
        className={`milkdown-annotation-frame ${
          frame.isFocusTarget ? "is-focus-target" : ""
        } ${frame.layer === "foreground" ? "is-code-block-frame" : ""}`}
        data-annotation-kind={frame.kind}
        data-focus-target={frame.isFocusTarget ? "true" : "false"}
        data-note-id={frame.noteId}
        data-note-tone={frame.tone}
        key={frame.frameKey}
        style={{
          borderRadius: frame.borderRadius,
          height: frame.height,
          left: frame.left,
          top: frame.top,
          width: frame.width,
        }}
      />
    );
  }

  return (
    <div className={shellClassName} ref={containerRef}>
      <div aria-hidden="true" className="milkdown-annotation-layer">
        {backgroundAnnotationFrames.map(renderAnnotationFrame)}
      </div>
      <div
        aria-hidden="true"
        className="milkdown-annotation-layer milkdown-annotation-layer--foreground"
      >
        {foregroundAnnotationFrames.map(renderAnnotationFrame)}
      </div>
      <div
        className="milkdown-markdown-editor"
        onKeyDownCapture={handleKeyDown}
        onKeyUp={publishSelectionAfterSelectionComplete}
        onMouseUp={publishSelectionAfterSelectionComplete}
        onPointerDownCapture={(e) => {
          const target = e.target as HTMLElement;
          if (readOnlyRef.current && e.pointerType === "touch") {
            applyReadonlyDomFocusState();
            blurReadonlyEditorFocus();
          }
          if (target.closest(".copy-button")) {
            e.preventDefault();
          }
        }}
        ref={rootRef}
      />
    </div>
  );
}
