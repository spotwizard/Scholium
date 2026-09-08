import { Crepe, CrepeFeature } from "@milkdown/crepe";
import {
  Decoration as CodeMirrorDecoration,
  type DecorationSet as CodeMirrorDecorationSet,
  EditorView as CodeMirrorEditorView,
  type ViewUpdate as CodeMirrorViewUpdate,
  ViewPlugin as CodeMirrorViewPlugin,
} from "@codemirror/view";
import { syntaxHighlighting as codeMirrorSyntaxHighlighting } from "@codemirror/language";
import { languages as codeMirrorLanguages } from "@codemirror/language-data";
import { classHighlighter as codeMirrorClassHighlighter } from "@lezer/highlight";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { listItemBlockConfig } from "@milkdown/kit/component/list-item-block";
import {
  editorViewCtx,
  prosePluginsCtx,
  editorViewOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { hardbreakAttr, hardbreakSchema } from "@milkdown/kit/preset/commonmark";
import { splitBlock } from "@milkdown/prose/commands";
import { closeHistory, redo, redoNoScroll, undo, undoNoScroll } from "@milkdown/prose/history";
import { InputRule, inputRules } from "@milkdown/prose/inputrules";
import type { Node as ProseMirrorNode, ResolvedPos } from "@milkdown/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnnotationTone,
  EditorChangeSource,
  EditorSelectionHandle,
  EditorSelectionSnapshot,
  TextAnnotation,
  TextSelectionAnchor,
  TextSelectionEnterContext,
  TextSelectionViewportRect,
} from "./editorTypes";
import { makeAnchorFromRange } from "./annotationAnchor";
import {
  findNormalizedSearchMatchIndexes,
  normalizeDocumentSearchQuery,
  type DocumentSearchState,
} from "./documentSearch";
import { clearTouchButtonFocus } from "./touchPointer";
import { shouldHandlePreviewSelectAllShortcut } from "./editorKeyboardShortcuts";
import {
  frontmatterBodyOffsetFromFullSourceOffset,
  fullSourceOffsetFromFrontmatterBodyOffset,
  mergeMarkdownFrontmatter,
  splitMarkdownFrontmatter,
  stripMarkdownFrontmatter,
} from "./markdownFrontmatter";
import { scheduleEditorViewportRestore } from "./editorViewport";
import {
  fencedCodeBlockSelectionFromSource,
  sourceSelectionFromFencedCodeBlock,
} from "./fencedCodeBlockSelection";
import { serializeMarkedTextClipboardSlice } from "./markdownClipboard";
import { localMarkdownImageNeedsHydration } from "./markdownLinkTarget";
import { linkTooltipPositionWithinBounds } from "./linkTooltipPosition";
import {
  appendInlineMarkdownTextMap,
  appendTextMap,
  closestTextIndex,
  findNonOverlappingTextIndices,
  markdownLineStartOffsets,
  markdownListItemContentStartOffset,
  type MarkdownTextMap as MilkdownTextMap,
} from "./markdownInlineTextMap";
import { escapeListLeadingAsterisksForPreview } from "./markdownListLiteral";
import {
  deleteAtListItemStart,
  insertEmptyFirstChildListItem,
  mergeRemovedListMarkerLineBackward,
  moveToNextEmptyListItem,
  preserveSerializedEmptyParagraphListBoundaries,
  sinkSingleListItem,
} from "./milkdownListIndent";
import { createListItemInlineStrongSyntaxPlugin } from "./milkdownInlineMarkdownSyntax";
import { createPastedInlineMarkBoundaryPlugin } from "./milkdownPastedInlineMarkBoundary";
import { correctHistoryCaretAfterRestoredText } from "./milkdownHistory";
import {
  encodeEmptyParagraphsForMilkdown,
  normalizeMarkdownForScholium,
  normalizeSelectedText,
} from "./milkdownSerialization";
import { renderScholiumMermaid } from "./mermaid";
import { observeReadingDiagrams, retainDiagramTextEditor } from "./mermaidReading";
import { readMarkdownImageFile } from "./tauriGateway";
import { parseTextDiagramPreview } from "./textDiagramPreview";

type MilkdownMarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  documentFilePath?: string | null;
  focusRequestKey?: number;
  noteModeEnabled: boolean;
  readOnly?: boolean;
  mobileBlockSelectionEnabled?: boolean;
  mobileBlockSelectionHint: string;
  mobileSelectionKind?: "note" | "glossary";
  mobileCommittedSelectionKey?: string;
  mobileCommittedSelectionTone?: AnnotationTone;
  mobileSelectionToneForAnchor?: (anchor: TextSelectionAnchor) => AnnotationTone;
  search?: DocumentSearchState;
  selectionToRestore?: EditorSelectionSnapshot | null;
  selectAllRequestKey?: number;
  onFocusRequestHandled?: (requestKey: number) => void;
  onSearchMatchCountChange?: (count: number) => void;
  toolbarEnabled?: boolean;
  codeBlockCopyLabel: string;
  codeBlockCopiedLabel: string;
  codeBlockDeleteLabel: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (
    anchor: TextSelectionAnchor,
    context?: TextSelectionEnterContext,
  ) => boolean;
  onLinkClick?: (href: string) => void;
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
const milkdownShiftEnterParagraphSplitPluginKey = new PluginKey(
  "scholium-milkdown-shift-enter-paragraph-split",
);
const milkdownSoftLineBlockInputRulePluginKey = new PluginKey(
  "scholium-milkdown-soft-line-block-input-rule",
);
const milkdownPairedSymbolPluginKey = new PluginKey(
  "scholium-milkdown-paired-symbols",
);
const milkdownSingleListItemIndentPluginKey = new PluginKey(
  "scholium-milkdown-single-list-item-indent",
);
const milkdownControlHistoryPluginKey = new PluginKey(
  "scholium-milkdown-control-history",
);
const inlineMarkdownLinkPattern = /(^|[^!])\[([^\]\n]+)\]\(([^)\n]*)\)$/;
const markdownPairedSymbols: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "\"": "\"",
  "'": "'",
  "（": "）",
  "［": "］",
  "｛": "｝",
  "【": "】",
  "「": "」",
  "『": "』",
  "〈": "〉",
  "《": "》",
};
const markdownClosingSymbols = new Set(Object.values(markdownPairedSymbols));
const markdownSymmetricQuoteSymbols = new Set(["\"", "'"]);
const codeBlockCopyFeedbackDurationMs = 1500;
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
const milkdownTouchBlockLongPressMs = 2000;
const milkdownTouchGlossaryLongPressMs = 650;
const milkdownTouchBlockActivationMoveTolerancePx = 12;
const milkdownTouchBlockMinimumDragPx = 8;
const milkdownTouchBlockHintVisibleMs = 1200;
const milkdownTouchSelectionPublishSuppressionMs = 900;
const milkdownTouchSelectionDiagnosticKey =
  "scholium:mobile-selection-diagnostic";
const milkdownTouchBlockDomSelector =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, .milkdown-code-block";
const milkdownReadonlyFocusableSelector =
  ".ProseMirror, .cm-content[contenteditable], .cm-editor [contenteditable], [contenteditable='true'], [contenteditable='plaintext-only']";
const milkdownNoteModeCodeBlockFocusableSelector =
  ".milkdown-code-block .cm-content[contenteditable], .milkdown-code-block .cm-editor [contenteditable], .milkdown-code-block [contenteditable='true'], .milkdown-code-block [contenteditable='plaintext-only']";
const annotationClickDelayMs = 500;
const annotationFocusTargetPressSuppressionMs = annotationClickDelayMs + 350;
const imeSelectionSuppressionMs = 350;
const codeMirrorNativePrimarySelectionClass = "scholium-native-primary-selection";
const codeMirrorNativePrimarySelectionAttributes = CodeMirrorEditorView.editorAttributes.of(
  (view) =>
    view.state.selection.ranges.length === 1
      ? { class: codeMirrorNativePrimarySelectionClass }
      : null,
);
const codeMirrorNativePrimarySelection = CodeMirrorViewPlugin.define((view) => {
  const selectionLayer = Array.from(view.scrollDOM.children).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains("cm-selectionLayer"),
  );

  function syncSelectionRenderer() {
    const useNativeSelection = view.state.selection.ranges.length === 1;

    if (useNativeSelection) {
      selectionLayer?.remove();
    } else if (selectionLayer && selectionLayer.parentElement !== view.scrollDOM) {
      view.scrollDOM.append(selectionLayer);
    }
  }

  syncSelectionRenderer();

  return {
    update: syncSelectionRenderer,
  };
});

function codeMirrorBlockLanguage(view: CodeMirrorEditorView) {
  const languageButton = view.dom
    .closest<HTMLElement>(".milkdown-code-block")
    ?.querySelector<HTMLElement>(".language-button");

  return (
    Array.from(languageButton?.childNodes ?? []).find(
      (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
    )?.textContent ?? ""
  );
}

function buildCodeMirrorTextDiagramDecorations(view: CodeMirrorEditorView) {
  const codeBlock = view.dom.closest<HTMLElement>(".milkdown-code-block");
  const lines = parseTextDiagramPreview(codeMirrorBlockLanguage(view), view.state.doc.toString());
  codeBlock?.classList.toggle("is-text-diagram", Boolean(lines));
  if (!lines) return CodeMirrorDecoration.none;

  const decorations = lines.flatMap((line, index) => {
      const documentLine = view.state.doc.line(index + 1);
      const previousLine = lines[index - 1];
      const classes = ["text-diagram-line", `is-${line.kind}`];
      if (
        (line.kind === "node" || line.kind === "branch") &&
        (previousLine?.kind === "node" || previousLine?.kind === "branch")
      ) {
        classes.push("has-box-before");
      }
      const attributes: Record<string, string> = { class: classes.join(" ") };
      if (line.kind === "branch") {
        classes.push(`is-depth-${line.depth}`);
        attributes.class = classes.join(" ");
      }

      const lineDecoration = CodeMirrorDecoration.line({ attributes }).range(documentLine.from);
      if ((line.kind !== "node" && line.kind !== "branch") || !line.label) {
        return [lineDecoration];
      }

      const labelFrom = line.kind === "branch"
        ? documentLine.from + line.prefix.length
        : documentLine.from;
      return [
        lineDecoration,
        CodeMirrorDecoration.mark({ class: "text-diagram-label" }).range(
          labelFrom,
          documentLine.to,
        ),
      ];
    });

  return CodeMirrorDecoration.set(decorations, true);
}

const codeMirrorTextDiagramPreview = CodeMirrorViewPlugin.fromClass(
  class {
    decorations: CodeMirrorDecorationSet;
    codeBlock: HTMLElement | null;

    constructor(view: CodeMirrorEditorView) {
      this.codeBlock = view.dom.closest<HTMLElement>(".milkdown-code-block");
      this.decorations = buildCodeMirrorTextDiagramDecorations(view);
    }

    update(update: CodeMirrorViewUpdate) {
      this.codeBlock = update.view.dom.closest<HTMLElement>(".milkdown-code-block");
      this.decorations = buildCodeMirrorTextDiagramDecorations(update.view);
    }

    destroy() {
      this.codeBlock?.classList.remove("is-text-diagram");
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function webKitCodeBlockSelectionExtensions() {
  if (typeof navigator === "undefined" || navigator.vendor !== "Apple Computer, Inc.") {
    return [];
  }

  return [codeMirrorNativePrimarySelectionAttributes, codeMirrorNativePrimarySelection];
}

type SoftLineIsolation = {
  state: EditorState;
  transaction: Transaction;
};

function isolateSelectedSoftLine(state: EditorState): SoftLineIsolation | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;

  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;

  let previousHardbreakOffset: number | null = null;
  let nextHardbreakOffset: number | null = null;
  $from.parent.forEach((node, offset) => {
    if (node.type.name !== "hardbreak") return;

    if (offset < $from.parentOffset) {
      previousHardbreakOffset = offset;
    } else if (nextHardbreakOffset === null) {
      nextHardbreakOffset = offset;
    }
  });
  if (previousHardbreakOffset === null && nextHardbreakOffset === null) return null;

  const paragraphStart = $from.start();
  const tr = state.tr;
  if (nextHardbreakOffset !== null) {
    const nextHardbreakPosition = paragraphStart + nextHardbreakOffset;
    tr.delete(nextHardbreakPosition, nextHardbreakPosition + 1);
    tr.split(nextHardbreakPosition);
  }
  if (previousHardbreakOffset !== null) {
    const previousHardbreakPosition = paragraphStart + previousHardbreakOffset;
    tr.delete(previousHardbreakPosition, previousHardbreakPosition + 1);
    tr.split(previousHardbreakPosition);
  }

  tr.setSelection(
    TextSelection.create(
      tr.doc,
      tr.mapping.map(selection.from),
      tr.mapping.map(selection.to),
    ),
  );
  return { state: state.apply(tr), transaction: tr };
}

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

type ClientSelectionRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type MilkdownTouchBlockSelectionPreviewRect = {
  borderRadius: string;
  key: string;
  height: number;
  left: number;
  top: number;
  width: number;
};

type MilkdownTouchBlockSelectionOverlay = {
  hintPhase: "entering" | "visible" | "hiding";
  kind: "note" | "glossary";
  previewRects: MilkdownTouchBlockSelectionPreviewRect[];
  rect: ClientSelectionRect;
  tone: AnnotationTone;
};

type MilkdownTouchBlockCommittedSelectionOverlay = {
  from: number;
  kind: "note" | "glossary";
  previewRects: MilkdownTouchBlockSelectionPreviewRect[];
  to: number;
};

function viewportAnchorRectFromTouchBlockPreviewRects(
  previewRects: MilkdownTouchBlockSelectionPreviewRect[],
): TextSelectionViewportRect | null {
  const rects = previewRects
    .map((rect) => ({
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      top: rect.top,
      width: rect.width,
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const referenceMiddleX = left + (right - left) / 2;
  const linesCoveringMiddle = rects.filter(
    (rect) => rect.left <= referenceMiddleX && rect.right >= referenceMiddleX,
  );
  const targetLine = linesCoveringMiddle[linesCoveringMiddle.length - 1] ?? rects[rects.length - 1];

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    targetBottom: targetLine.bottom,
    targetTop: targetLine.top,
    targetX: targetLine.left + targetLine.width / 2,
    targetY: targetLine.top + targetLine.height / 2,
    top,
    width: right - left,
  };
}

type MilkdownTouchBlockSelectionSession = {
  active: boolean;
  blockFrom?: number;
  blockTo?: number;
  codeBlockIndex?: number;
  codeLineIndex?: number;
  currentClientX: number;
  currentClientY: number;
  currentFrom?: number;
  currentTo?: number;
  kind: "note" | "glossary";
  selecting: boolean;
  startClientX: number;
  startClientY: number;
  startFrom?: number;
  startTo?: number;
  target: EventTarget | null;
};

const localImageHydratedSrcAttribute = "data-scholium-local-image-src";
const localImageMarkdownPathAttribute = "data-scholium-local-markdown-path";
const localImageResolvedPathAttribute = "data-scholium-local-image-path";
const localImageLoadingAttribute = "data-scholium-local-image-loading";
const localImageErrorAttribute = "data-scholium-local-image-error";

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
  labels: { empty: string; error: string; loading: string },
) {
  const trimmedDefinition = definition.trim();
  if (!trimmedDefinition) {
    return renderMilkdownMermaidFrame(
      `<pre class="milkdown-mermaid-diagram__error">${escapeHtml(labels.empty)}</pre>`,
    );
  }

  applyPreview(
    renderMilkdownMermaidFrame(
      `<div class="milkdown-mermaid-diagram__loading">${escapeHtml(labels.loading)}</div>`,
    ),
  );

  const diagramId = `scholium-milkdown-mermaid-${++milkdownMermaidRenderIndex}`;
  void renderScholiumMermaid(diagramId, definition)
    .then(({ svg }) => {
      applyPreview(
        renderMilkdownMermaidFrame(
          `<div class="milkdown-mermaid-diagram__svg">${svg}</div>`,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      applyPreview(
        renderMilkdownMermaidFrame(
          `<pre class="milkdown-mermaid-diagram__error">${escapeHtml(labels.error)}</pre>`,
        ),
      );
    });
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

  const listItemContentStartOffset = markdownListItemContentStartOffset(remainingLine);
  if (listItemContentStartOffset > 0) {
    return startOffset + listItemContentStartOffset;
  }

  return startOffset;
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

function roundFrameValue(value: number) {
  return Math.round(value * 100) / 100;
}

function clientSelectionRectFromPoints(
  startClientX: number,
  startClientY: number,
  currentClientX: number,
  currentClientY: number,
): ClientSelectionRect {
  const left = Math.min(startClientX, currentClientX);
  const top = Math.min(startClientY, currentClientY);
  const right = Math.max(startClientX, currentClientX);
  const bottom = Math.max(startClientY, currentClientY);

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function clientSelectionRectHasDrag(rect: ClientSelectionRect) {
  return (
    rect.width >= milkdownTouchBlockMinimumDragPx ||
    rect.height >= milkdownTouchBlockMinimumDragPx
  );
}

function domRectOverlapsClientSelectionRect(
  domRect: DOMRect,
  selectionRect: ClientSelectionRect,
) {
  return (
    domRect.width > 0 &&
    domRect.height > 0 &&
    domRect.right >= selectionRect.left &&
    domRect.left <= selectionRect.right &&
    domRect.bottom >= selectionRect.top &&
    domRect.top <= selectionRect.bottom
  );
}

function elementBoxOverlapsClientSelectionRect(
  element: HTMLElement,
  selectionRect: ClientSelectionRect,
) {
  return Array.from(element.getClientRects()).some((rect) =>
    domRectOverlapsClientSelectionRect(rect, selectionRect),
  );
}

function elementTextNodeClientRects(element: HTMLElement) {
  const ownerDocument = element.ownerDocument;
  const ignoredTextSelector =
    ".tools, button, input, textarea, select, script, style, .milkdown-code-block-annotation-layer";
  const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentElement = node.parentElement;
      if (!parentElement || parentElement.closest(ignoredTextSelector)) {
        return NodeFilter.FILTER_REJECT;
      }

      return normalizeSelectedText(node.textContent ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const range = ownerDocument.createRange();
  const rects: DOMRect[] = [];

  try {
    let currentNode = walker.nextNode();
    while (currentNode) {
      range.selectNodeContents(currentNode);
      rects.push(
        ...Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        ),
      );
      currentNode = walker.nextNode();
    }
  } finally {
    range.detach();
  }

  return rects;
}

function mergedClientTextLineRects(rects: DOMRect[]) {
  const sortedRects = rects
    .slice()
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const lineRects: Array<{ bottom: number; left: number; right: number; top: number }> = [];

  sortedRects.forEach((rect) => {
    const existingLine = lineRects.find(
      (lineRect) =>
        rect.top <= lineRect.bottom + 1 && rect.bottom >= lineRect.top - 1,
    );

    if (existingLine) {
      existingLine.bottom = Math.max(existingLine.bottom, rect.bottom);
      existingLine.left = Math.min(existingLine.left, rect.left);
      existingLine.right = Math.max(existingLine.right, rect.right);
      existingLine.top = Math.min(existingLine.top, rect.top);
      return;
    }

    lineRects.push({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    });
  });

  return lineRects;
}

function elementTextOverlapsClientSelectionRect(
  element: HTMLElement,
  selectionRect: ClientSelectionRect,
) {
  return elementTextNodeClientRects(element).some((rect) =>
    domRectOverlapsClientSelectionRect(rect, selectionRect),
  );
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
  const normalizedTarget = normalizeSelectedText(target);
  if (!normalizedTarget) return [];

  const textPoints: Array<{ node: Text; offset: number } | null> = [];
  let text = "";
  let hasPendingWhitespace = false;

  function appendTextNode(node: Text) {
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset];
      if (/\s/.test(character)) {
        hasPendingWhitespace = true;
        continue;
      }

      if (hasPendingWhitespace && text.length > 0) {
        text += " ";
        textPoints.push(null);
      }

      text += character;
      textPoints.push({ node, offset });
      hasPendingWhitespace = false;
    }
  }

  function appendTextFrom(element: HTMLElement) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentElement = node.parentElement;
        if (
          parentElement?.closest(
            ".tools, button, input, textarea, select, .cm-gutters, .cm-lineNumbers, [aria-hidden='true']",
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let currentNode = walker.nextNode();

    while (currentNode) {
      appendTextNode(currentNode as Text);
      currentNode = walker.nextNode();
    }
  }

  const codeMirrorLines = root.matches(".cm-content")
    ? Array.from(root.querySelectorAll<HTMLElement>(":scope > .cm-line"))
    : [];
  if (codeMirrorLines.length > 0) {
    codeMirrorLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) hasPendingWhitespace = true;
      appendTextFrom(line);
    });
  } else {
    appendTextFrom(root);
  }

  const matchStart = indexOfOccurrence(text, normalizedTarget, Math.max(0, occurrence));
  if (matchStart < 0) return [];

  const matchEnd = matchStart + normalizedTarget.length;
  const startPoint = textPoints[matchStart];
  const endPoint = textPoints[matchEnd - 1];
  if (!startPoint || !endPoint) return [];

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset + 1);

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

function fencedCodeBlockContentLineSourceRange(
  markdown: string,
  codeBlockIndex: number,
  fromLineIndex: number,
  toLineIndex: number,
) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const lineStartOffsets = markdownLineStartOffsets(normalizedMarkdown);
  let openBlock:
    | {
        contentLineStart: number;
        fence: string;
        index: number;
      }
    | null = null;
  let currentCodeBlockIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const fenceMatch = line.match(/^ {0,3}(```|~~~)/);

    if (!openBlock) {
      if (fenceMatch) {
        openBlock = {
          contentLineStart: lineIndex + 1,
          fence: fenceMatch[1],
          index: currentCodeBlockIndex,
        };
      }
      continue;
    }

    const isClosingFence = Boolean(fenceMatch && fenceMatch[1] === openBlock.fence);
    if (!isClosingFence && lineIndex < lines.length - 1) {
      continue;
    }

    const contentLineEnd = isClosingFence ? lineIndex : lineIndex + 1;
    if (openBlock.index === codeBlockIndex) {
      const boundedFromLine = Math.max(0, fromLineIndex);
      const boundedToLine = Math.max(boundedFromLine, toLineIndex);
      const sourceFromLine = openBlock.contentLineStart + boundedFromLine;
      const sourceToLine = Math.min(openBlock.contentLineStart + boundedToLine, contentLineEnd);
      if (sourceFromLine >= sourceToLine) return null;

      const from = lineStartOffsets[sourceFromLine] ?? null;
      const toLineStart = lineStartOffsets[sourceToLine - 1] ?? null;
      const toLine = lines[sourceToLine - 1] ?? "";
      if (from === null || toLineStart === null) return null;

      return {
        from,
        to: toLineStart + toLine.length,
      };
    }

    currentCodeBlockIndex += 1;
    openBlock = null;
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
      if (sortedRects.length > 0) {
        sortedRects[sortedRects.length - 1].canExtendRight = false;
      }
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

function buildAnchor(
  markdown: string,
  selectedText: string,
  approximateVisibleStart = 0,
): TextSelectionAnchor | null {
  const normalizedSelection = normalizeSelectedText(selectedText);
  if (!normalizedSelection) return null;

  const exactIndex = closestTextIndex(
    findNonOverlappingTextIndices(markdown, selectedText),
    approximateVisibleStart,
  );
  if (exactIndex >= 0) {
    return makeAnchorFromRange(markdown, exactIndex, exactIndex + selectedText.length);
  }

  const markdownTextMap = buildMarkdownVisibleTextMap(markdown);
  const exactVisibleIndex = closestTextIndex(
    findNonOverlappingTextIndices(markdownTextMap.text, selectedText.trim()),
    approximateVisibleStart,
  );
  if (exactVisibleIndex >= 0) {
    const sourceRange = textMapSourceRange(
      markdownTextMap,
      exactVisibleIndex,
      exactVisibleIndex + selectedText.trim().length,
    );
    if (sourceRange) {
      return makeAnchorFromRange(markdown, sourceRange.from, sourceRange.to);
    }
  }

  const normalizedTextMap = normalizeTextMapForMatch(markdownTextMap);
  const normalizedIndex = closestTextIndex(
    findNonOverlappingTextIndices(normalizedTextMap.text, normalizedSelection),
    approximateVisibleStart,
  );
  if (normalizedIndex < 0) return null;

  const sourceRange = textMapSourceRange(
    normalizedTextMap,
    normalizedIndex,
    normalizedIndex + normalizedSelection.length,
  );
  if (!sourceRange) return null;

  return makeAnchorFromRange(markdown, sourceRange.from, sourceRange.to);
}

function editorMarkdownFromFullSource(markdown: string) {
  return escapeListLeadingAsterisksForPreview(stripMarkdownFrontmatter(markdown));
}

function sourceAnchorFromEditorAnchor(markdown: string, anchor: TextSelectionAnchor | null) {
  if (!anchor) return null;

  const from = fullSourceOffsetFromFrontmatterBodyOffset(markdown, anchor.from);
  const to = fullSourceOffsetFromFrontmatterBodyOffset(markdown, anchor.to);
  return makeAnchorFromRange(markdown, from, to);
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

function markdownSourceOffsetFromProsePosition(
  doc: ProseMirrorNode,
  markdown: string,
  position: number,
) {
  const frontmatter = splitMarkdownFrontmatter(markdown);
  const bodyStart = frontmatter?.bodyStart ?? 0;
  const body = frontmatter?.body ?? markdown.replace(/\r\n/g, "\n");
  const textMap = normalizeTextMapForMatch(buildMarkdownVisibleTextMap(body));
  const visiblePrefix = doc.textBetween(0, position, "\n");
  const visibleIndex = normalizeSelectedText(visiblePrefix).length;
  const mappedOffsets = textMap.sourceOffsets.filter(
    (offset): offset is number => offset !== null,
  );
  if (mappedOffsets.length === 0) return bodyStart;
  if (visibleIndex <= 0) return bodyStart + mappedOffsets[0];
  if (visibleIndex >= textMap.sourceOffsets.length) {
    return bodyStart + mappedOffsets[mappedOffsets.length - 1] + 1;
  }

  if (/\s/.test(textMap.text[visibleIndex] ?? "")) {
    const visibleTextIndex = buildNormalizedVisibleTextIndex(doc);
    const proseTextIndex = visibleTextIndex.positions.findIndex(
      (visiblePosition) => visiblePosition === position,
    );
    const isStartOfNextVisibleText =
      proseTextIndex >= 0 && visibleTextIndex.text[proseTextIndex] !== " ";

    if (!isStartOfNextVisibleText) {
      const previousOffset = textMap.sourceOffsets
        .slice(0, visibleIndex)
        .reverse()
        .find((offset): offset is number => offset !== null);
      if (previousOffset !== undefined) return bodyStart + previousOffset + 1;
    }

    const nextVisibleOffset = textMap.sourceOffsets
      .slice(visibleIndex + 1)
      .find((offset): offset is number => offset !== null);
    if (nextVisibleOffset !== undefined) return bodyStart + nextVisibleOffset;
  }

  const nextOffset = textMap.sourceOffsets
    .slice(visibleIndex)
    .find((offset): offset is number => offset !== null);
  return bodyStart + (nextOffset ?? mappedOffsets[mappedOffsets.length - 1] + 1);
}

function prosePositionFromMarkdownSourceOffset(
  doc: ProseMirrorNode,
  markdown: string,
  sourceOffset: number,
) {
  const frontmatter = splitMarkdownFrontmatter(markdown);
  const bodyStart = frontmatter?.bodyStart ?? 0;
  const body = frontmatter?.body ?? markdown.replace(/\r\n/g, "\n");
  const textMap = normalizeTextMapForMatch(buildMarkdownVisibleTextMap(body));
  const bodyOffset = Math.min(Math.max(sourceOffset - bodyStart, 0), body.length);
  const visibleIndex = textMap.sourceOffsets.findIndex(
    (offset) => offset !== null && offset >= bodyOffset,
  );
  const targetVisibleLength = visibleIndex >= 0 ? visibleIndex : textMap.text.length;

  let low = 0;
  let high = doc.content.size;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const visibleLength = normalizeSelectedText(doc.textBetween(0, middle, "\n")).length;
    if (visibleLength < targetVisibleLength) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function markdownSelectionFromProseSelection(
  doc: ProseMirrorNode,
  markdown: string,
  selection: EditorSelectionSnapshot,
) {
  return {
    anchor: markdownSourceOffsetFromProsePosition(doc, markdown, selection.anchor),
    head: markdownSourceOffsetFromProsePosition(doc, markdown, selection.head),
  };
}

function proseSelectionFromMarkdownSelection(
  doc: ProseMirrorNode,
  markdown: string,
  selection: EditorSelectionSnapshot,
) {
  return {
    anchor: prosePositionFromMarkdownSourceOffset(doc, markdown, selection.anchor),
    head: prosePositionFromMarkdownSourceOffset(doc, markdown, selection.head),
  };
}

function proseCodeBlockContentStartAtIndex(doc: ProseMirrorNode, codeBlockIndex: number) {
  let currentIndex = 0;
  let contentStart: number | null = null;

  doc.descendants((node, position) => {
    if (contentStart !== null) return false;
    if (node.type.name !== "code_block") return true;
    if (currentIndex === codeBlockIndex) {
      contentStart = position + 1;
      return false;
    }
    currentIndex += 1;
    return true;
  });

  return contentStart;
}

function buildProseNonWhitespaceTextIndex(doc: ProseMirrorNode) {
  const characters: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true;

    for (let offset = 0; offset < node.text.length; offset += 1) {
      if (!/\s/.test(node.text[offset])) {
        characters.push(node.text[offset]);
        positions.push(position + offset);
      }
    }

    return true;
  });

  return { positions, text: characters.join("") };
}

function proseRangeFromMarkdownSourceRange(
  doc: ProseMirrorNode,
  markdown: string,
  from: number,
  to: number,
) {
  const textMap = buildMarkdownVisibleTextMap(markdown);
  const sourceCharacters: string[] = [];
  let firstSourceIndex: number | null = null;
  let lastSourceIndex: number | null = null;

  for (let index = 0; index < textMap.text.length; index += 1) {
    const character = textMap.text[index];
    const sourceOffset = textMap.sourceOffsets[index];
    if (sourceOffset === null || /\s/.test(character)) continue;

    const sourceIndex = sourceCharacters.length;
    sourceCharacters.push(character);

    if (sourceOffset >= from && sourceOffset < to) {
      firstSourceIndex ??= sourceIndex;
      lastSourceIndex = sourceIndex;
    }
  }

  if (firstSourceIndex === null || lastSourceIndex === null) return null;

  const sourceText = sourceCharacters.join("");
  const target = sourceText.slice(firstSourceIndex, lastSourceIndex + 1);
  const sourceOccurrence = findNonOverlappingTextIndices(sourceText, target).indexOf(
    firstSourceIndex,
  );
  const proseTextIndex = buildProseNonWhitespaceTextIndex(doc);
  const matchedProseIndex =
    sourceOccurrence >= 0
      ? indexOfOccurrence(proseTextIndex.text, target, sourceOccurrence)
      : -1;
  const proseStartIndex = matchedProseIndex >= 0 ? matchedProseIndex : firstSourceIndex;
  const proseEndIndex =
    matchedProseIndex >= 0 ? matchedProseIndex + target.length - 1 : lastSourceIndex;

  const proseFrom = proseTextIndex.positions[proseStartIndex];
  const proseTo = proseTextIndex.positions[proseEndIndex];
  if (proseFrom === undefined || proseTo === undefined || proseTo < proseFrom) return null;

  return {
    from: proseFrom,
    to: proseTo + 1,
  };
}

function countOccurrencesBefore(markdown: string, annotation: TextAnnotation, target: string) {
  const normalizedTarget = normalizeSelectedText(target);
  if (!normalizedTarget) return 0;

  const beforeAnnotation = normalizeSelectedText(markdown.slice(0, annotation.from));
  let count = 0;
  let searchFrom = 0;

  while (searchFrom < beforeAnnotation.length) {
    const nextIndex = beforeAnnotation.indexOf(normalizedTarget, searchFrom);
    if (nextIndex < 0) break;
    count += 1;
    searchFrom = nextIndex + normalizedTarget.length;
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
  const annotationElement = targetElement?.closest<HTMLElement>(
    ".milkdown-note-annotation, .milkdown-annotation-frame[data-note-id]",
  );
  if (!annotationElement) return null;

  const sources = annotationSourcesFromElement(annotationElement, annotations);
  return (
    sources.sort(
      (left, right) =>
        milkdownAnnotationKindLayer(right.kind) - milkdownAnnotationKindLayer(left.kind),
    )[0] ?? null
  );
}

function targetIsMilkdownAnnotationFrame(target: EventTarget | null) {
  const targetElement =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return Boolean(
    targetElement?.closest<HTMLElement>(".milkdown-annotation-frame[data-note-id]"),
  );
}

function createAnnotationPlugin({
  allowClickWithSelection,
  getAnnotations,
  getMarkdown,
  onAnnotationClick,
  onAnnotationDoubleClick,
  onFocusTargetAnnotationPress,
}: {
  allowClickWithSelection: () => boolean;
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
          if (!source) return false;
          if (
            !allowClickWithSelection() &&
            !targetIsMilkdownAnnotationFrame(event.target) &&
            !window.getSelection()?.isCollapsed
          ) {
            return false;
          }

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

export const MilkdownMarkdownEditor = forwardRef<
  EditorSelectionHandle,
  MilkdownMarkdownEditorProps
>(function MilkdownMarkdownEditor(
  {
    value,
    annotations,
    documentFilePath = null,
    focusRequestKey = 0,
    noteModeEnabled,
    readOnly = false,
    mobileBlockSelectionEnabled = false,
    mobileBlockSelectionHint,
    mobileSelectionKind = "note",
    mobileCommittedSelectionKey = "",
    mobileCommittedSelectionTone = 0,
    mobileSelectionToneForAnchor,
    search = { activeIndex: 0, query: "" },
    selectionToRestore = null,
    selectAllRequestKey = 0,
    onFocusRequestHandled,
    onSearchMatchCountChange,
    toolbarEnabled = true,
    codeBlockCopyLabel,
    codeBlockCopiedLabel,
    codeBlockDeleteLabel,
    mermaidEmptyDefinitionLabel,
    mermaidErrorLabel,
    mermaidLoadingLabel,
    onChange,
    onSelectionChange,
    onSelectionEnter,
    onLinkClick,
    onAnnotationClick,
    onAnnotationDoubleClick,
    onFocusTargetAnnotationPress,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const valueRefreshScrollSnapshotRef = useRef<{
    scrollContainer: HTMLElement;
    scrollTop: number;
  } | null>(null);
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
  const mobileSelectionKindRef = useRef(mobileSelectionKind);
  const mobileCommittedSelectionKeyRef = useRef(mobileCommittedSelectionKey);
  const mobileSelectionToneForAnchorRef = useRef(mobileSelectionToneForAnchor);
  const onChangeRef = useRef(onChange);
  const codeBlockCopyLabelRef = useRef(codeBlockCopyLabel);
  const codeBlockCopiedLabelRef = useRef(codeBlockCopiedLabel);
  const codeBlockDeleteLabelRef = useRef(codeBlockDeleteLabel);
  const mermaidLabelsRef = useRef({
    empty: mermaidEmptyDefinitionLabel,
    error: mermaidErrorLabel,
    loading: mermaidLoadingLabel,
  });
  const pendingCodeBlockCopyButtonRef = useRef<HTMLElement | null>(null);
  const pendingCodeBlockCopyClearTimerRef = useRef(0);
  const codeBlockCopyFeedbackTimersRef = useRef(new Map<HTMLElement, number>());
  const onSearchMatchCountChangeRef = useRef(onSearchMatchCountChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const handledSelectAllRequestKeyRef = useRef(selectAllRequestKey);
  const onLinkClickRef = useRef(onLinkClick);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const onFocusTargetAnnotationPressRef = useRef(onFocusTargetAnnotationPress);
  const animationFrameRef = useRef(0);
  const annotationLayoutSettleTimersRef = useRef<number[]>([]);
  const selectionFrameRef = useRef(0);
  const selectionFallbackTimerRef = useRef(0);
  const touchBlockSelectionPublishSuppressedUntilRef = useRef(0);
  const touchBlockLongPressTimerRef = useRef(0);
  const touchBlockHintFrameRef = useRef(0);
  const touchBlockHintHideTimerRef = useRef(0);
  const touchBlockHintUnmountTimerRef = useRef(0);
  const touchBlockSelectionSessionRef =
    useRef<MilkdownTouchBlockSelectionSession | null>(null);
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
  const codeBlockAnnotationHoverBlockRef = useRef<HTMLElement | null>(null);
  const mouseSelectionStartedRef = useRef(false);
  const imeCompositionActiveRef = useRef(false);
  const imeSelectionSuppressedUntilRef = useRef(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [annotationFrames, setAnnotationFrames] = useState<MilkdownAnnotationFrame[]>([]);
  const [touchBlockSelectionOverlay, setTouchBlockSelectionOverlay] =
    useState<MilkdownTouchBlockSelectionOverlay | null>(null);
  const [touchBlockCommittedSelectionOverlay, setTouchBlockCommittedSelectionOverlay] =
    useState<MilkdownTouchBlockCommittedSelectionOverlay | null>(null);
  const searchSignature = `${search.query}\n${search.activeIndex}\n${search.scrollRequestKey ?? 0}`;
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

  useImperativeHandle(ref, () => ({
    getSelectionSnapshot() {
      const root = rootRef.current;
      const activeElement = document.activeElement;
      const codeMirrorElement =
        root && activeElement instanceof HTMLElement && root.contains(activeElement)
          ? activeElement.closest<HTMLElement>(".milkdown-code-block .cm-editor")
          : null;
      const codeMirrorView = codeMirrorElement
        ? CodeMirrorEditorView.findFromDOM(codeMirrorElement)
        : null;
      const codeBlock = codeMirrorElement?.closest<HTMLElement>(".milkdown-code-block");
      const codeBlockIndex =
        root && codeBlock
          ? Array.from(root.querySelectorAll<HTMLElement>(".milkdown-code-block")).indexOf(
              codeBlock,
            )
          : -1;
      const codeMirrorSelection = codeMirrorView?.state.selection.main;
      if (codeMirrorView && codeMirrorSelection && codeBlockIndex >= 0) {
        const bodySelection = sourceSelectionFromFencedCodeBlock(
          editorMarkdownRef.current,
          codeBlockIndex,
          codeMirrorSelection,
        );
        if (bodySelection) {
          return {
            association: codeMirrorSelection.assoc,
            anchor: fullSourceOffsetFromFrontmatterBodyOffset(
              currentMarkdownRef.current,
              bodySelection.anchor,
            ),
            head: fullSourceOffsetFromFrontmatterBodyOffset(
              currentMarkdownRef.current,
              bodySelection.head,
            ),
            viewportY: codeMirrorView.coordsAtPos(codeMirrorSelection.head)?.top ?? null,
          };
        }
      }

      const view = currentEditorView();
      if (!view) return null;

      const selection = markdownSelectionFromProseSelection(
        view.state.doc,
        currentMarkdownRef.current,
        view.state.selection,
      );
      return {
        ...selection,
        viewportY: view.coordsAtPos(view.state.selection.head).top,
      };
    },
  }));

  function clearCodeBlockCopyFeedbackTimers() {
    window.clearTimeout(pendingCodeBlockCopyClearTimerRef.current);
    pendingCodeBlockCopyClearTimerRef.current = 0;
    codeBlockCopyFeedbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    codeBlockCopyFeedbackTimersRef.current.clear();
  }

  function rememberPendingCodeBlockCopyButton(button: HTMLElement) {
    pendingCodeBlockCopyButtonRef.current = button;
    window.clearTimeout(pendingCodeBlockCopyClearTimerRef.current);
    pendingCodeBlockCopyClearTimerRef.current = window.setTimeout(() => {
      if (pendingCodeBlockCopyButtonRef.current === button) {
        pendingCodeBlockCopyButtonRef.current = null;
      }
      pendingCodeBlockCopyClearTimerRef.current = 0;
    }, codeBlockCopyFeedbackDurationMs);
  }

  function codeBlockCopyButtonTextNode(button: HTMLElement) {
    return (
      Array.from(button.childNodes).find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
      ) ?? null
    );
  }

  function syncCodeBlockCopyButtonLabels() {
    const root = rootRef.current;
    if (!root) return;

    root.querySelectorAll<HTMLElement>(".milkdown-code-block .copy-button").forEach((button) => {
      if (button.classList.contains("is-copy-success")) return;
      button.setAttribute("aria-label", codeBlockCopyLabelRef.current);
      button.setAttribute("title", codeBlockCopyLabelRef.current);
    });
  }

  function syncCodeBlockDeleteButtons() {
    const root = rootRef.current;
    if (!root) return;

    const disabled = readOnlyRef.current || noteModeEnabledRef.current;
    root.querySelectorAll<HTMLElement>(".milkdown-code-block .tools-button-group").forEach((group) => {
      let button = group.querySelector<HTMLButtonElement>(".delete-button");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "delete-button";
        group.querySelector(".copy-button")?.after(button);
      }

      if (button.textContent !== codeBlockDeleteLabelRef.current) {
        button.textContent = codeBlockDeleteLabelRef.current;
      }
      if (button.disabled !== disabled) {
        button.disabled = disabled;
      }
      if (button.getAttribute("aria-label") !== codeBlockDeleteLabelRef.current) {
        button.setAttribute("aria-label", codeBlockDeleteLabelRef.current);
      }
      if (button.getAttribute("title") !== codeBlockDeleteLabelRef.current) {
        button.setAttribute("title", codeBlockDeleteLabelRef.current);
      }
    });
  }

  function deleteCodeBlockFromButton(button: HTMLElement) {
    if (readOnlyRef.current || noteModeEnabledRef.current) return;

    const view = currentEditorView();
    if (!view) return;

    let targetPosition: number | null = null;
    let targetSize = 0;
    view.state.doc.descendants((node, position) => {
      const isCodeBlock = node.type.name === "code_block" || node.type.spec.code === true;
      if (!isCodeBlock) return true;

      const nodeDom = view.nodeDOM(position);
      if (nodeDom instanceof HTMLElement && nodeDom.contains(button)) {
        targetPosition = position;
        targetSize = node.nodeSize;
        return false;
      }
      return true;
    });

    if (targetPosition === null || targetSize <= 0) return;

    view.dispatch(view.state.tr.delete(targetPosition, targetPosition + targetSize).scrollIntoView());
  }

  function showCodeBlockCopyFeedback(button: HTMLElement) {
    const label = codeBlockCopiedLabelRef.current;
    const previousTimer = codeBlockCopyFeedbackTimersRef.current.get(button);
    if (previousTimer) {
      window.clearTimeout(previousTimer);
    }

    if (!button.hasAttribute("data-copy-original-aria-label")) {
      const originalAriaLabel = button.getAttribute("aria-label");
      if (originalAriaLabel !== null) {
        button.setAttribute("data-copy-original-aria-label", originalAriaLabel);
      }
    }

    if (!button.hasAttribute("data-copy-original-title")) {
      const originalTitle = button.getAttribute("title");
      if (originalTitle !== null) {
        button.setAttribute("data-copy-original-title", originalTitle);
      }
    }

    button.classList.add("is-copy-success");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    clearTouchButtonFocus(button);

    const textNode = codeBlockCopyButtonTextNode(button);
    if (textNode) {
      if (!button.hasAttribute("data-copy-original-text")) {
        button.setAttribute("data-copy-original-text", textNode.textContent ?? "");
      }
      textNode.textContent = label;
    }

    const timer = window.setTimeout(() => {
      button.classList.remove("is-copy-success");

      const restoredTextNode = codeBlockCopyButtonTextNode(button);
      const originalText = button.getAttribute("data-copy-original-text");
      if (restoredTextNode && originalText !== null) {
        restoredTextNode.textContent = originalText;
        button.removeAttribute("data-copy-original-text");
      }

      const originalAriaLabel = button.getAttribute("data-copy-original-aria-label");
      if (originalAriaLabel !== null) {
        button.setAttribute("aria-label", originalAriaLabel);
        button.removeAttribute("data-copy-original-aria-label");
      } else {
        button.removeAttribute("aria-label");
      }

      const originalTitle = button.getAttribute("data-copy-original-title");
      if (originalTitle !== null) {
        button.setAttribute("title", originalTitle);
        button.removeAttribute("data-copy-original-title");
      } else {
        button.removeAttribute("title");
      }

      codeBlockCopyFeedbackTimersRef.current.delete(button);
      clearTouchButtonFocus(button);
    }, codeBlockCopyFeedbackDurationMs);

    codeBlockCopyFeedbackTimersRef.current.set(button, timer);
  }

  useEffect(
    () => () => {
      window.clearTimeout(annotationClickTimerRef.current);
      clearCodeBlockCopyFeedbackTimers();
      clearTouchBlockSelectionSession();
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
        clearTouchButtonFocus(button);
      }
    };

    const handleCodeBlockCopyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLElement>(".milkdown-code-block .copy-button");
      if (!button) return;

      rememberPendingCodeBlockCopyButton(button);
    };

    const handleCodeBlockDeleteClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>(".milkdown-code-block .delete-button");
      if (!button || button.disabled) return;

      const codeBlock = button.closest<HTMLElement>(".milkdown-code-block");
      if (!codeBlock) return;

      e.preventDefault();
      e.stopPropagation();
      deleteCodeBlockFromButton(button);
    };

    const handleLinkClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target =
        e.target instanceof Element
          ? e.target
          : e.target instanceof Node
            ? e.target.parentElement
            : null;
      const link = target?.closest<HTMLAnchorElement>("a[href]");
      const href = link?.getAttribute("href")?.trim() ?? "";
      if (!href || href.startsWith("#")) return;

      e.preventDefault();
      e.stopPropagation();
      onLinkClickRef.current?.(href);
    };

    container.addEventListener("mousedown", preventFocus, { capture: true });
    container.addEventListener("touchstart", preventFocus, { capture: true, passive: false });
    container.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });
    container.addEventListener("click", handleLinkClick, true);
    container.addEventListener("click", handleCodeBlockCopyClick, true);
    container.addEventListener("click", handleCodeBlockDeleteClick, true);

    return () => {
      container.removeEventListener("mousedown", preventFocus, { capture: true });
      container.removeEventListener("touchstart", preventFocus, { capture: true });
      container.removeEventListener("touchend", handleTouchEnd, { capture: true });
      container.removeEventListener("click", handleLinkClick, true);
      container.removeEventListener("click", handleCodeBlockCopyClick, true);
      container.removeEventListener("click", handleCodeBlockDeleteClick, true);
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
    setTouchBlockCommittedSelectionOverlay((currentOverlay) =>
      currentOverlay &&
      editorAnnotationsRef.current.some(
        (annotation) =>
          annotation.kind === currentOverlay.kind &&
          annotation.from === currentOverlay.from &&
          annotation.to === currentOverlay.to,
      )
        ? null
        : currentOverlay,
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

      void readMarkdownImageFile({
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

  function createInlineMarkdownLinkInputRule() {
    return inputRules({
      rules: [
        new InputRule(
          inlineMarkdownLinkPattern,
          createInlineMarkdownLinkTransaction,
        ),
      ],
    });
  }

  function applyInputRuleToIsolatedSoftLine(
    view: EditorView,
    isolation: SoftLineIsolation,
    runInputRule: (
      plugin: Plugin,
      inputRuleView: EditorView,
      from: number,
      to: number,
    ) => boolean,
  ) {
    let matchedTransaction: Transaction | null = null;
    let matchedPlugin: Plugin | null = null;
    const isolatedFrom = isolation.state.selection.from;
    const isolatedTo = isolation.state.selection.to;

    for (const plugin of isolation.state.plugins) {
      if (
        plugin.spec.key === milkdownSoftLineBlockInputRulePluginKey ||
        !(plugin.spec as { isInputRules?: boolean }).isInputRules
      ) {
        continue;
      }

      const inputRuleView = Object.create(view) as EditorView;
      Object.defineProperties(inputRuleView, {
        composing: { value: false },
        dispatch: {
          value: (transaction: Transaction) => {
            matchedTransaction = transaction;
          },
        },
        state: { value: isolation.state },
      });
      if (!runInputRule(plugin, inputRuleView, isolatedFrom, isolatedTo)) continue;
      if (!matchedTransaction) continue;

      matchedPlugin = plugin;
      break;
    }
    const inputRuleTransaction = matchedTransaction as Transaction | null;
    const inputRulePlugin = matchedPlugin as Plugin | null;
    if (!inputRuleTransaction || !inputRulePlugin) return false;

    view.dispatch(isolation.transaction);
    return runInputRule(inputRulePlugin, view, isolatedFrom, isolatedTo);
  }

  function createSoftLineBlockInputRulePlugin() {
    return new Plugin({
      key: milkdownSoftLineBlockInputRulePluginKey,
      props: {
        handleTextInput(view, _from, _to, text) {
          if (
            view.composing ||
            readOnlyRef.current ||
            noteModeEnabledRef.current
          ) {
            return false;
          }

          const isolation = isolateSelectedSoftLine(view.state);
          if (!isolation) return false;

          return applyInputRuleToIsolatedSoftLine(
            view,
            isolation,
            (plugin, inputRuleView, from, to) => {
              const handler = plugin.props.handleTextInput;
              return (
                handler?.call(
                  plugin,
                  inputRuleView,
                  from,
                  to,
                  text,
                  () => inputRuleView.state.tr.insertText(text, from, to),
                ) ?? false
              );
            },
          );
        },
        handleKeyDown(view, event) {
          if (
            event.key !== "Enter" ||
            event.isComposing ||
            readOnlyRef.current ||
            noteModeEnabledRef.current
          ) {
            return false;
          }

          const isolation = isolateSelectedSoftLine(view.state);
          if (!isolation) return false;

          return applyInputRuleToIsolatedSoftLine(
            view,
            isolation,
            (plugin, inputRuleView) => {
              const handler = plugin.props.handleKeyDown;
              return handler?.call(plugin, inputRuleView, event) ?? false;
            },
          );
        },
      },
    });
  }

  function createInlineMarkdownLinkTransaction(
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number,
  ) {
    const prefix = match[1] ?? "";
    const label = match[2] ?? "";
    const href = match[3] ?? "";
    if (!label) return null;

    const linkMarkType = state.schema.marks.link;
    if (!linkMarkType) return null;

    const linkStart = start + prefix.length;
    const linkEnd = linkStart + label.length;
    const tr = state.tr.insertText(label, linkStart, end);

    tr.addMark(linkStart, linkEnd, linkMarkType.create({ href, title: null }));
    tr.removeStoredMark(linkMarkType);

    return tr;
  }

  function completedInlineMarkdownLinkBeforeClosingParenthesis(
    state: EditorState,
    cursorPosition: number,
  ) {
    const $cursor = state.doc.resolve(cursorPosition);
    const nextCharacter = state.doc.textBetween(cursorPosition, cursorPosition + 1);
    if (nextCharacter !== ")") return null;

    const textBeforeCursor = $cursor.parent.textBetween(
      0,
      $cursor.parentOffset,
      undefined,
      "\uFFFC",
    );
    const match = `${textBeforeCursor})`.match(inlineMarkdownLinkPattern);
    if (!match) return null;

    const start = $cursor.start() + (match.index ?? 0);
    return {
      end: cursorPosition + 1,
      linkStart: start + (match[1]?.length ?? 0),
      match,
      start,
    };
  }

  function createPairedSymbolPlugin() {
    return new Plugin({
      key: milkdownPairedSymbolPluginKey,
      appendTransaction(transactions, oldState, newState) {
        if (
          transactions.some((transaction) => transaction.docChanged) ||
          !transactions.some((transaction) => transaction.selectionSet) ||
          !oldState.selection.empty ||
          oldState.selection.eq(newState.selection)
        ) {
          return null;
        }

        const completedLink = completedInlineMarkdownLinkBeforeClosingParenthesis(
          oldState,
          oldState.selection.from,
        );
        if (!completedLink) return null;

        const selectionStayedInsideLink =
          newState.selection.from >= completedLink.linkStart &&
          newState.selection.to < completedLink.end;
        if (selectionStayedInsideLink) return null;

        return createInlineMarkdownLinkTransaction(
          newState,
          completedLink.match,
          completedLink.start,
          completedLink.end,
        );
      },
      props: {
        handleTextInput(view, from, to, text) {
          if (
            view.composing ||
            readOnlyRef.current ||
            noteModeEnabledRef.current
          ) {
            return false;
          }

          const closingSymbol = markdownPairedSymbols[text];
          if (!closingSymbol) return false;

          if (from === to && markdownSymmetricQuoteSymbols.has(text)) {
            const previousCharacter = view.state.doc.textBetween(
              Math.max(0, from - 1),
              from,
            );
            const nextCharacter = view.state.doc.textBetween(from, from + 1);
            if (/[\p{L}\p{N}]/u.test(previousCharacter + nextCharacter)) {
              return false;
            }
          }

          const tr = view.state.tr;

          if (from === to) {
            tr.insertText(`${text}${closingSymbol}`, from, to);
            tr.setSelection(TextSelection.create(tr.doc, from + text.length));
          } else {
            tr.insertText(closingSymbol, to);
            tr.insertText(text, from);
            tr.setSelection(
              TextSelection.create(tr.doc, from + text.length, to + text.length),
            );
          }

          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleDOMEvents: {
          compositionend(view, event) {
            const openingSymbol = event.data;
            const closingSymbol = markdownPairedSymbols[openingSymbol];
            if (!closingSymbol) return false;

            window.setTimeout(() => {
              if (
                readOnlyRef.current ||
                noteModeEnabledRef.current ||
                !view.dom.isConnected
              ) {
                return;
              }

              const { selection } = view.state;
              if (!selection.empty) return;

              const { $from } = selection;
              const previousCharacter = view.state.doc.textBetween(
                Math.max(0, $from.pos - openingSymbol.length),
                $from.pos,
              );
              const nextCharacter = view.state.doc.textBetween(
                $from.pos,
                $from.pos + closingSymbol.length,
              );
              if (
                previousCharacter !== openingSymbol ||
                nextCharacter === closingSymbol
              ) {
                return;
              }

              const tr = view.state.tr.insertText(closingSymbol, $from.pos);
              tr.setSelection(TextSelection.create(tr.doc, $from.pos));
              view.dispatch(tr.scrollIntoView());
            });

            return false;
          },
        },
        handleKeyDown(view, event) {
          if (
            event.isComposing ||
            imeCompositionActiveRef.current ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            readOnlyRef.current ||
            noteModeEnabledRef.current
          ) {
            return false;
          }

          const { selection } = view.state;
          if (!selection.empty) return false;

          const { $from } = selection;

          if (event.key === "Backspace") {
            const previousCharacter = view.state.doc.textBetween(
              Math.max(0, $from.pos - 1),
              $from.pos,
            );
            const nextCharacter = view.state.doc.textBetween($from.pos, $from.pos + 1);
            if (markdownPairedSymbols[previousCharacter] !== nextCharacter) {
              return false;
            }

            event.preventDefault();
            view.dispatch(
              view.state.tr
                .delete($from.pos - previousCharacter.length, $from.pos + nextCharacter.length)
                .scrollIntoView(),
            );
            return true;
          }

          if (!markdownClosingSymbols.has(event.key)) return false;

          const nextCharacter = view.state.doc.textBetween(
            $from.pos,
            $from.pos + event.key.length,
          );
          if (nextCharacter !== event.key) return false;

          if (event.key === ")") {
            const completedLink = completedInlineMarkdownLinkBeforeClosingParenthesis(
              view.state,
              $from.pos,
            );

            if (completedLink) {
              const tr = createInlineMarkdownLinkTransaction(
                view.state,
                completedLink.match,
                completedLink.start,
                completedLink.end,
              );

              if (tr) {
                event.preventDefault();
                view.dispatch(tr.scrollIntoView());
                return true;
              }
            }
          }

          event.preventDefault();
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, $from.pos + event.key.length))
              .scrollIntoView(),
          );
          return true;
        },
      },
    });
  }

  function createSingleListItemIndentPlugin() {
    return new Plugin({
      key: milkdownSingleListItemIndentPluginKey,
      props: {
        handleKeyDown(view, event) {
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.isComposing ||
            imeCompositionActiveRef.current ||
            readOnlyRef.current
          ) {
            return false;
          }

          const listItemType = view.state.schema.nodes.list_item;
          if (!listItemType) return false;

          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !noteModeEnabledRef.current
          ) {
            let insertedFirstChild = false;
            const handled =
              insertEmptyFirstChildListItem(listItemType)(
                view.state,
                (transaction) => {
                  insertedFirstChild = transaction.docChanged;
                  view.dispatch(transaction);
                },
                view,
              ) ||
              moveToNextEmptyListItem(listItemType)(
                view.state,
                (transaction) => view.dispatch(transaction),
                view,
              );
            if (handled) {
              if (insertedFirstChild) {
                view.dispatch(closeHistory(view.state.tr));
              }
              event.preventDefault();
              return true;
            }
          }

          if (event.key === "Backspace" || event.key === "Delete") {
            if (
              event.key === "Backspace" &&
              mergeRemovedListMarkerLineBackward(listItemType)(
                view.state,
                (transaction) => view.dispatch(transaction),
                view,
              )
            ) {
              event.preventDefault();
              return true;
            }

            const handled = deleteAtListItemStart(
              listItemType,
              event.key === "Delete" ? "forward" : "backward",
            )(
              view.state,
              (transaction) => view.dispatch(transaction),
              view,
            );
            if (!handled) return false;

            event.preventDefault();
            return true;
          }

          if (noteModeEnabledRef.current) return false;
          if (event.key !== "Tab" || event.shiftKey) return false;

          const handled = sinkSingleListItem(listItemType)(
            view.state,
            (transaction) => view.dispatch(transaction),
            view,
          );
          if (!handled) return false;

          event.preventDefault();
          return true;
        },
      },
    });
  }

  function createControlHistoryPlugin() {
    function runHistoryCommand(view: EditorView, shouldRedo: boolean) {
      const command = shouldRedo ? redo : undo;
      return command(
        view.state,
        (transaction) => view.dispatch(transaction),
        view,
      );
    }

    return new Plugin({
      appendTransaction: correctHistoryCaretAfterRestoredText,
      key: milkdownControlHistoryPluginKey,
      props: {
        handleDOMEvents: {
          beforeinput(view, event) {
            if (
              !(event instanceof InputEvent) ||
              (event.inputType !== "historyUndo" &&
                event.inputType !== "historyRedo") ||
              readOnlyRef.current ||
              noteModeEnabledRef.current
            ) {
              return false;
            }

            const handled = runHistoryCommand(
              view,
              event.inputType === "historyRedo",
            );
            if (!handled) return false;

            event.preventDefault();
            return true;
          },
        },
        handleKeyDown(view, event) {
          if (
            event.key.toLowerCase() !== "z" ||
            event.ctrlKey === event.metaKey ||
            event.altKey ||
            event.isComposing ||
            imeCompositionActiveRef.current ||
            readOnlyRef.current ||
            noteModeEnabledRef.current
          ) {
            return false;
          }

          const handled = runHistoryCommand(view, event.shiftKey);
          if (!handled) return false;

          event.preventDefault();
          return true;
        },
      },
    });
  }

  function createShiftEnterParagraphSplitPlugin() {
    return new Plugin({
      key: milkdownShiftEnterParagraphSplitPluginKey,
      props: {
        handleKeyDown(view, event) {
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
    const root = rootRef.current;
    if (!root || !(document.activeElement instanceof Node)) return;
    if (!root.contains(document.activeElement)) return;
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shouldBlur =
      readOnlyRef.current ||
      Boolean(noteModeEnabledRef.current && activeElement?.closest(".milkdown-code-block"));
    if (!shouldBlur) return;

    (document.activeElement as HTMLElement).blur();
  }

  function applyReadonlyDomFocusState() {
    if (!readOnlyRef.current && !noteModeEnabledRef.current) {
      restoreReadonlyDomFocusElements();
      return;
    }

    const root = rootRef.current;
    if (!root) return;
    const blockedFocusableSelector = readOnlyRef.current
      ? milkdownReadonlyFocusableSelector
      : milkdownNoteModeCodeBlockFocusableSelector;

    root
      .querySelectorAll<HTMLElement>(blockedFocusableSelector)
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
            const target = event.target as HTMLElement | null;
            if (
              !readOnlyRef.current &&
              !(noteModeEnabledRef.current && target?.closest(".milkdown-code-block"))
            ) {
              return false;
            }

            target?.blur();
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
    if (mobileBlockSelectionEnabledRef.current) {
      window.getSelection()?.removeAllRanges();
      onAnnotationClickRef.current(noteId);
      return;
    }

    annotationClickTimerRef.current = window.setTimeout(() => {
      annotationClickTimerRef.current = 0;
      if (focusTargetAnnotationPressIsSuppressed(noteId)) return;
      if (selectedMilkdownText()) return;

      onAnnotationClickRef.current(noteId);
    }, annotationClickDelayMs);
  }

  function codeBlockAnnotationHitFromPoint(clientX: number, clientY: number) {
    const root = rootRef.current;
    if (!root || !noteModeEnabledRef.current) return null;

    const frames = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".milkdown-code-block-annotation-layer .milkdown-annotation-frame[data-note-id]",
      ),
    );
    const hits = frames.filter((frame) => {
      const rect = frame.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    });
    if (hits.length === 0) return null;

    const hitSources = hits
      .flatMap((frame) =>
        annotationSourcesFromElement(frame, annotationsRef.current).map((source) => ({
          frame,
          source,
        })),
      )
      .sort(
        (left, right) =>
          milkdownAnnotationKindLayer(right.source.kind) -
            milkdownAnnotationKindLayer(left.source.kind) ||
          hits.indexOf(right.frame) - hits.indexOf(left.frame),
      );

    return hitSources[0] ?? null;
  }

  function clearCodeBlockAnnotationHover() {
    codeBlockAnnotationHoverBlockRef.current?.classList.remove("is-annotation-hit-hovered");
    codeBlockAnnotationHoverBlockRef.current = null;
  }

  function updateCodeBlockAnnotationHover(clientX: number, clientY: number) {
    const hit = codeBlockAnnotationHitFromPoint(clientX, clientY);
    const nextBlock =
      hit?.frame.closest<HTMLElement>(".milkdown-code-block") ?? null;
    if (codeBlockAnnotationHoverBlockRef.current === nextBlock) return;

    clearCodeBlockAnnotationHover();
    if (!nextBlock) return;

    nextBlock.classList.add("is-annotation-hit-hovered");
    codeBlockAnnotationHoverBlockRef.current = nextBlock;
  }

  function consumeCodeBlockAnnotationEvent(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function codeBlockContentTarget(target: EventTarget | null) {
    if (!noteModeEnabledRef.current) return null;

    const root = rootRef.current;
    const targetElement = elementFromEventTarget(target);
    if (!root || !targetElement || !root.contains(targetElement)) return null;
    if (targetElement.closest(".milkdown-code-block .tools button, .copy-button")) {
      return null;
    }

    const codeBlock = targetElement.closest<HTMLElement>(".milkdown-code-block");
    return codeBlock && root.contains(codeBlock) ? codeBlock : null;
  }

  function handleCodeBlockAnnotationPointerPress(event: MouseEvent | PointerEvent) {
    if (event.button !== 0) return;
    if (!codeBlockContentTarget(event.target)) return;

    const hit = codeBlockAnnotationHitFromPoint(event.clientX, event.clientY);
    if (!hit && event.detail <= 1) {
      scheduleReadonlyDomFocusSync();
      return;
    }

    consumeCodeBlockAnnotationEvent(event);
    mouseSelectionStartedRef.current = false;
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);

    if (hit?.source.isFocusTarget) {
      handleFocusTargetAnnotationPress(hit.source.noteId);
    }
  }

  function handleCodeBlockAnnotationPointerRelease(event: MouseEvent | PointerEvent) {
    if (event.button !== 0) return;
    if (!codeBlockContentTarget(event.target)) return;

    const hit = codeBlockAnnotationHitFromPoint(event.clientX, event.clientY);
    if (!hit && event.detail <= 1) {
      scheduleReadonlyDomFocusSync();
      return;
    }

    consumeCodeBlockAnnotationEvent(event);
    mouseSelectionStartedRef.current = false;
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
  }

  function handleCodeBlockAnnotationClick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (!codeBlockContentTarget(event.target)) return;

    const hit = codeBlockAnnotationHitFromPoint(event.clientX, event.clientY);
    if (!hit && event.detail <= 1) {
      scheduleReadonlyDomFocusSync();
      return;
    }

    consumeCodeBlockAnnotationEvent(event);
    mouseSelectionStartedRef.current = false;
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
    if (!hit) return;

    if (hit.source.isFocusTarget && handleFocusTargetAnnotationPress(hit.source.noteId)) {
      return;
    }

    queueAnnotationClick(hit.source.noteId);
  }

  function handleCodeBlockAnnotationDoubleClick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (!codeBlockContentTarget(event.target)) return;

    const hit = codeBlockAnnotationHitFromPoint(event.clientX, event.clientY);
    consumeCodeBlockAnnotationEvent(event);
    mouseSelectionStartedRef.current = false;
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
    clearQueuedAnnotationClick();
    if (!hit) return;

    onAnnotationDoubleClickRef.current(hit.source.noteId);
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      updateCodeBlockAnnotationHover(event.clientX, event.clientY);
    };

    root.addEventListener("pointermove", handlePointerMove, true);
    root.addEventListener("pointerdown", handleCodeBlockAnnotationPointerPress, true);
    root.addEventListener("mousedown", handleCodeBlockAnnotationPointerPress, true);
    root.addEventListener("pointerup", handleCodeBlockAnnotationPointerRelease, true);
    root.addEventListener("mouseup", handleCodeBlockAnnotationPointerRelease, true);
    root.addEventListener("click", handleCodeBlockAnnotationClick, true);
    root.addEventListener("dblclick", handleCodeBlockAnnotationDoubleClick, true);
    root.addEventListener("pointerleave", clearCodeBlockAnnotationHover, true);

    return () => {
      root.removeEventListener("pointermove", handlePointerMove, true);
      root.removeEventListener("pointerdown", handleCodeBlockAnnotationPointerPress, true);
      root.removeEventListener("mousedown", handleCodeBlockAnnotationPointerPress, true);
      root.removeEventListener("pointerup", handleCodeBlockAnnotationPointerRelease, true);
      root.removeEventListener("mouseup", handleCodeBlockAnnotationPointerRelease, true);
      root.removeEventListener("click", handleCodeBlockAnnotationClick, true);
      root.removeEventListener("dblclick", handleCodeBlockAnnotationDoubleClick, true);
      root.removeEventListener("pointerleave", clearCodeBlockAnnotationHover, true);
      clearCodeBlockAnnotationHover();
    };
  }, [editorRevision]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    codeBlockCopyLabelRef.current = codeBlockCopyLabel;
    syncCodeBlockCopyButtonLabels();
  }, [codeBlockCopyLabel]);

  useEffect(() => {
    codeBlockCopiedLabelRef.current = codeBlockCopiedLabel;
  }, [codeBlockCopiedLabel]);

  useEffect(() => {
    codeBlockDeleteLabelRef.current = codeBlockDeleteLabel;
    syncCodeBlockDeleteButtons();
  }, [codeBlockDeleteLabel]);

  useEffect(() => {
    mermaidLabelsRef.current = {
      empty: mermaidEmptyDefinitionLabel,
      error: mermaidErrorLabel,
      loading: mermaidLoadingLabel,
    };
  }, [mermaidEmptyDefinitionLabel, mermaidErrorLabel, mermaidLoadingLabel]);

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
    onLinkClickRef.current = onLinkClick;
  }, [onLinkClick]);

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
    syncCodeBlockDeleteButtons();
    scheduleReadonlyDomFocusSync();
    if (!noteModeEnabled) {
      clearTouchBlockSelectionSession();
      setTouchBlockCommittedSelectionOverlay(null);
      onSelectionChangeRef.current(null);
      setAnnotationFrames([]);
    } else {
      scheduleAnnotationFrameUpdate();
    }
  }, [noteModeEnabled]);

  useEffect(() => {
    mobileBlockSelectionEnabledRef.current = mobileBlockSelectionEnabled;
    if (!mobileBlockSelectionEnabled) {
      clearTouchBlockSelectionSession();
      setTouchBlockCommittedSelectionOverlay(null);
    }
  }, [mobileBlockSelectionEnabled]);

  useEffect(() => {
    mobileSelectionKindRef.current = mobileSelectionKind;
    clearTouchBlockSelectionSession();
    setTouchBlockCommittedSelectionOverlay(null);
  }, [mobileSelectionKind]);

  useEffect(() => {
    mobileCommittedSelectionKeyRef.current = mobileCommittedSelectionKey;
    if (!mobileCommittedSelectionKey) {
      setTouchBlockCommittedSelectionOverlay(null);
    }
  }, [mobileCommittedSelectionKey]);

  useEffect(() => {
    mobileSelectionToneForAnchorRef.current = mobileSelectionToneForAnchor;
  }, [mobileSelectionToneForAnchor]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    syncCodeBlockDeleteButtons();
    syncMilkdownReadOnlyState();
  }, [readOnly]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const observer = new MutationObserver(() => {
      syncCodeBlockCopyButtonLabels();
      syncCodeBlockDeleteButtons();
      if (readOnlyRef.current || noteModeEnabledRef.current) {
        scheduleReadonlyDomFocusSync();
      }
    });
    observer.observe(root, {
      attributeFilter: ["contenteditable", "tabindex"],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    syncCodeBlockCopyButtonLabels();
    syncCodeBlockDeleteButtons();
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

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const tooltipSelector = ".milkdown-link-preview, .milkdown-link-edit";
    const editorContentFrame = root.closest<HTMLElement>(".editor-content-frame");
    let positionFrame = 0;

    function syncLinkTooltipPositions() {
      positionFrame = 0;
      const currentRoot = rootRef.current;
      if (!currentRoot) return;
      const bounds = currentRoot.getBoundingClientRect();

      currentRoot.querySelectorAll<HTMLElement>(tooltipSelector).forEach((tooltip) => {
        if (tooltip.dataset.show !== "true") {
          delete tooltip.dataset.scholiumPositioned;
          return;
        }

        const maxWidth = Math.max(0, bounds.width - 16);
        const maxWidthStyle = `${maxWidth}px`;
        if (tooltip.style.maxWidth !== maxWidthStyle) {
          tooltip.style.maxWidth = maxWidthStyle;
        }

        const tooltipRect = tooltip.getBoundingClientRect();
        const position = linkTooltipPositionWithinBounds({ bounds, tooltip: tooltipRect });
        const currentLeft = Number.parseFloat(tooltip.style.left);
        const currentTop = Number.parseFloat(tooltip.style.top);

        if (!Number.isFinite(currentLeft) || !Number.isFinite(currentTop)) {
          delete tooltip.dataset.scholiumPositioned;
          return;
        }

        if (Math.abs(position.left - tooltipRect.left) > 0.5) {
          tooltip.style.left = `${currentLeft + position.left - tooltipRect.left}px`;
        }
        if (Math.abs(position.top - tooltipRect.top) > 0.5) {
          tooltip.style.top = `${currentTop + position.top - tooltipRect.top}px`;
        }
        tooltip.dataset.scholiumPositioned = "true";
      });
    }

    function scheduleLinkTooltipPositionSync() {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = window.requestAnimationFrame(syncLinkTooltipPositions);
    }

    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target = mutation.target;
        if (
          mutation.type === "attributes" &&
          target instanceof HTMLElement &&
          target.matches(tooltipSelector)
        ) {
          delete target.dataset.scholiumPositioned;
        }
      });
      scheduleLinkTooltipPositionSync();
    });
    mutationObserver.observe(root, {
      attributeFilter: ["data-show", "style"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const resizeObserver = new ResizeObserver(scheduleLinkTooltipPositionSync);
    resizeObserver.observe(root);
    editorContentFrame?.addEventListener("transitionend", scheduleLinkTooltipPositionSync);
    editorContentFrame?.addEventListener("transitioncancel", scheduleLinkTooltipPositionSync);
    window.addEventListener("resize", scheduleLinkTooltipPositionSync);
    window.addEventListener("scroll", scheduleLinkTooltipPositionSync, true);
    scheduleLinkTooltipPositionSync();

    return () => {
      window.cancelAnimationFrame(positionFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      editorContentFrame?.removeEventListener("transitionend", scheduleLinkTooltipPositionSync);
      editorContentFrame?.removeEventListener("transitioncancel", scheduleLinkTooltipPositionSync);
      window.removeEventListener("resize", scheduleLinkTooltipPositionSync);
      window.removeEventListener("scroll", scheduleLinkTooltipPositionSync, true);
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

    const root = rootRef.current;
    const scrollContainer = root?.closest<HTMLElement>(".editor-pane");
    if (root && scrollContainer) {
      root.style.minHeight = `${root.scrollHeight}px`;
      valueRefreshScrollSnapshotRef.current = {
        scrollContainer,
        scrollTop: scrollContainer.scrollTop,
      };
    }

    currentMarkdownRef.current = normalizedValue;
    editorMarkdownRef.current = editorMarkdownFromFullSource(normalizedValue);
    editorAnnotationsRef.current = annotationsForEditorSource(
      annotationsRef.current,
      normalizedValue,
    );
    setTouchBlockCommittedSelectionOverlay(null);
    setEditorRevision((revision) => revision + 1);
  }, [value]);

  function restoreScrollAfterValueRefresh(root: HTMLElement) {
    const snapshot = valueRefreshScrollSnapshotRef.current;
    root.style.minHeight = "";
    if (!snapshot) return;

    snapshot.scrollContainer.scrollTop = snapshot.scrollTop;
    valueRefreshScrollSnapshotRef.current = null;
  }

  function currentEditorView(): EditorView | null {
    const crepe = crepeRef.current;
    if (!crepe) return null;

    let view: EditorView | null = null;
    try {
      crepe.editor.action((ctx) => {
        const candidate = ctx.get(editorViewCtx) as EditorView | undefined;
        if (candidate?.state && typeof candidate.dispatch === "function") {
          view = candidate;
        }
      });
    } catch {
      return null;
    }

    return view;
  }

  function selectAllEditorContents(view: EditorView) {
    const selection = window.getSelection();
    if (!selection) return false;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-diagram-text]") && active.isContentEditable && rootRef.current?.contains(active)) {
      const editor = CodeMirrorEditorView.findFromDOM(active);
      if (!editor) return false;
      editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
      return true;
    }

    view.dom.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(view.dom);
    selection.removeAllRanges();
    selection.addRange(range);
    return !selection.isCollapsed;
  }

  useEffect(() => {
    if (handledSelectAllRequestKeyRef.current === selectAllRequestKey) return;
    handledSelectAllRequestKeyRef.current = selectAllRequestKey;

    const view = currentEditorView();
    if (!view) return;

    selectAllEditorContents(view);
  }, [selectAllRequestKey]);

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
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
  }

  function reportSearchMatchCount(view: EditorView | null = currentEditorView()) {
    const count = view
      ? buildMilkdownSearchRanges(view.state.doc, searchRef.current.query).length
      : 0;
    onSearchMatchCountChangeRef.current?.(count);
  }

  function scrollActiveSearchMatchIntoView() {
    window.setTimeout(() => {
      const activeMatch = rootRef.current?.querySelector<HTMLElement>(
        ".milkdown-document-search-match.is-active",
      );
      if (!activeMatch) return;

      const editorPane = activeMatch.closest<HTMLElement>(".editor-pane");
      const scrollContainer =
        editorPane && editorPane.scrollHeight > editorPane.clientHeight
          ? editorPane
          : document.scrollingElement;
      if (!scrollContainer) return;

      const matchRect = activeMatch.getBoundingClientRect();
      const viewportRect =
        scrollContainer === document.scrollingElement
          ? {
              height: window.visualViewport?.height ?? window.innerHeight,
              top: window.visualViewport?.offsetTop ?? 0,
            }
          : scrollContainer.getBoundingClientRect();
      scrollContainer.scrollTop +=
        matchRect.top -
        viewportRect.top -
        (viewportRect.height - matchRect.height) / 2;
    }, 0);
  }

  function dispatchSearchUpdate() {
    const view = currentEditorView();
    if (!view) return;

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

  function recordTouchBlockSelectionDiagnostic(
    stage: string,
    details: Record<string, unknown> = {},
  ) {
    try {
      const existingValue = window.localStorage.getItem(
        milkdownTouchSelectionDiagnosticKey,
      );
      const existingEntries = existingValue ? JSON.parse(existingValue) : [];
      const entries = Array.isArray(existingEntries) ? existingEntries : [];
      entries.push({
        at: Date.now(),
        details,
        stage,
      });
      window.localStorage.setItem(
        milkdownTouchSelectionDiagnosticKey,
        JSON.stringify(entries.slice(-40)),
      );
    } catch {
      // Diagnostics must never affect the selection interaction.
    }
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
    if (
      mobileSelectionKindRef.current !== "glossary" &&
      targetElement.closest(
        ".milkdown-note-annotation, .milkdown-annotation-frame[data-note-id]",
      )
    ) {
      return false;
    }
    if (targetElement.closest("button, input, textarea, select, a")) return false;

    const editorElement = targetElement.closest(".ProseMirror");
    return Boolean(editorElement && root.contains(editorElement));
  }

  function graphemeRangeAtOffset(text: string, offset: number) {
    let from = 0;
    const clampedOffset = Math.max(0, Math.min(offset, text.length));

    for (const character of Array.from(text)) {
      const to = from + character.length;
      if (clampedOffset < to || (clampedOffset === to && to === text.length)) {
        return { from, to };
      }
      from = to;
    }

    return null;
  }

  function graphemeBoundaryAtOrAfter(text: string, offset: number) {
    const clampedOffset = Math.max(0, Math.min(offset, text.length));
    if (clampedOffset === 0 || clampedOffset === text.length) return clampedOffset;

    let boundary = 0;
    for (const character of Array.from(text)) {
      boundary += character.length;
      if (boundary >= clampedOffset) return boundary;
    }

    return text.length;
  }

  function touchGlossaryTextBlockAtPosition(view: EditorView, position: number) {
    const safePosition = Math.max(0, Math.min(position, view.state.doc.content.size));
    const resolvedPosition = view.state.doc.resolve(safePosition);

    for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
      const node = resolvedPosition.node(depth);
      if (!node.isTextblock) continue;

      return {
        from: resolvedPosition.start(depth),
        text: node.textContent,
        to: resolvedPosition.end(depth),
      };
    }

    return null;
  }

  function touchGlossaryTextBlockAtHit(
    view: EditorView,
    hit: { inside: number; pos: number },
  ) {
    const resolvedBlock = touchGlossaryTextBlockAtPosition(view, hit.pos);
    if (resolvedBlock || hit.inside < 0) return resolvedBlock;

    const insideNode = view.state.doc.nodeAt(hit.inside);
    if (!insideNode?.isTextblock) return null;

    return {
      from: hit.inside + 1,
      text: insideNode.textContent,
      to: hit.inside + 1 + insideNode.content.size,
    };
  }

  function distanceFromPointToRect(clientX: number, clientY: number, rect: DOMRect) {
    const deltaX =
      clientX < rect.left
        ? rect.left - clientX
        : clientX > rect.right
          ? clientX - rect.right
          : 0;
    const deltaY =
      clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
          ? clientY - rect.bottom
          : 0;

    return deltaX * deltaX + deltaY * deltaY;
  }

  function touchGlossaryLineGraphemeAtPoint(
    lineElement: HTMLElement,
    clientX: number,
    clientY: number,
  ) {
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let lineOffset = 0;
    let bestMatch:
      | {
          distance: number;
          from: number;
          to: number;
        }
      | null = null;

    try {
      let currentNode = walker.nextNode();
      while (currentNode) {
        const textNode = currentNode as Text;
        let nodeOffset = 0;

        for (const character of Array.from(textNode.data)) {
          const nextOffset = nodeOffset + character.length;
          range.setStart(textNode, nodeOffset);
          range.setEnd(textNode, nextOffset);

          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width <= 0 || rect.height <= 0) continue;

            const distance = distanceFromPointToRect(clientX, clientY, rect);
            if (bestMatch && bestMatch.distance <= distance) continue;

            bestMatch = {
              distance,
              from: lineOffset + nodeOffset,
              to: lineOffset + nextOffset,
            };
          }
          nodeOffset = nextOffset;
        }

        lineOffset += textNode.data.length;
        currentNode = walker.nextNode();
      }
    } finally {
      range.detach();
    }

    return bestMatch;
  }

  function touchGlossaryCodeSelectionAtPoint(clientX: number, clientY: number) {
    const root = rootRef.current;
    const pointElement = document.elementFromPoint(clientX, clientY);
    const codeBlock = pointElement?.closest<HTMLElement>(".milkdown-code-block");
    if (!root || !codeBlock || !root.contains(codeBlock)) return null;

    const codeBlocks = Array.from(
      root.querySelectorAll<HTMLElement>(".milkdown-code-block"),
    );
    const codeBlockIndex = codeBlocks.indexOf(codeBlock);
    if (codeBlockIndex < 0) return null;

    const lineElements = Array.from(
      codeBlock.querySelectorAll<HTMLElement>(".cm-line"),
    );
    const lineElement = lineElements
      .slice()
      .sort(
        (left, right) =>
          distanceFromPointToRect(clientX, clientY, left.getBoundingClientRect()) -
          distanceFromPointToRect(clientX, clientY, right.getBoundingClientRect()),
      )[0];
    if (!lineElement) return null;

    const codeLineIndex = lineElements.indexOf(lineElement);
    const grapheme = touchGlossaryLineGraphemeAtPoint(
      lineElement,
      clientX,
      clientY,
    );
    if (!grapheme) return null;

    const lineSourceRange = fencedCodeBlockContentLineSourceRange(
      editorMarkdownRef.current,
      codeBlockIndex,
      codeLineIndex,
      codeLineIndex + 1,
    );
    if (!lineSourceRange) return null;

    const lineLength = lineSourceRange.to - lineSourceRange.from;
    const from = lineSourceRange.from + Math.min(grapheme.from, lineLength);
    const to = lineSourceRange.from + Math.min(grapheme.to, lineLength);
    if (to <= from) return null;

    const anchor = sourceAnchorFromEditorAnchor(
      currentMarkdownRef.current,
      makeAnchorFromRange(editorMarkdownRef.current, from, to),
    );
    if (!anchor || !normalizeSelectedText(anchor.selectedText)) return null;

    return {
      anchor,
      codeBlockIndex,
      codeLineIndex,
    };
  }

  function touchGlossaryCodeSelectionPreviewRects(from: number, to: number) {
    const container = containerRef.current;
    if (!container || to <= from) return [];

    const anchor = makeAnchorFromRange(currentMarkdownRef.current, from, to);
    const annotation: TextAnnotation = {
      ...anchor,
      id: "touch-glossary-selection",
      kind: "glossary",
      tone: 0,
    };

    return touchBlockSelectionPreviewRectsFromAnnotationRects(
      codeBlockAnnotationRects(
        container,
        annotation,
        currentMarkdownRef.current,
      ),
      "glossary",
      "glossary",
    );
  }

  function touchGlossarySelectionStartAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
  ) {
    const codeSelection = touchGlossaryCodeSelectionAtPoint(clientX, clientY);
    if (codeSelection) {
      return {
        blockFrom: codeSelection.anchor.from,
        blockTo: codeSelection.anchor.to,
        codeBlockIndex: codeSelection.codeBlockIndex,
        codeLineIndex: codeSelection.codeLineIndex,
        from: codeSelection.anchor.from,
        to: codeSelection.anchor.to,
      };
    }

    const hit = view.posAtCoords({ left: clientX, top: clientY });
    if (!hit) return null;

    const block = touchGlossaryTextBlockAtHit(view, hit);
    if (!block?.text) return null;

    const position = Math.max(block.from, Math.min(hit.pos, block.to));
    let relativeOffset = Math.max(0, Math.min(position - block.from, block.text.length));
    try {
      if (clientX < view.coordsAtPos(position).left && relativeOffset > 0) {
        relativeOffset -= 1;
      }
    } catch {
      // Use the position reported by ProseMirror when DOM coordinates are unavailable.
    }

    const grapheme = graphemeRangeAtOffset(block.text, relativeOffset);
    if (!grapheme) return null;

    const from = block.from + grapheme.from;
    const to = block.from + grapheme.to;
    if (!view.state.doc.textBetween(from, to, " ").trim()) return null;

    return {
      blockFrom: block.from,
      blockTo: block.to,
      from,
      to,
    };
  }

  function touchGlossaryCodeSelectionEndAtPoint(
    session: MilkdownTouchBlockSelectionSession,
  ) {
    if (
      session.codeBlockIndex == null ||
      session.codeLineIndex == null ||
      session.startFrom == null ||
      session.startTo == null
    ) {
      return null;
    }

    const codeSelection = touchGlossaryCodeSelectionAtPoint(
      session.currentClientX,
      session.currentClientY,
    );
    if (
      !codeSelection ||
      codeSelection.codeBlockIndex !== session.codeBlockIndex ||
      codeSelection.codeLineIndex !== session.codeLineIndex ||
      codeSelection.anchor.from < session.startFrom
    ) {
      return null;
    }

    return {
      from: session.startFrom,
      to: Math.max(session.startTo, codeSelection.anchor.to),
    };
  }

  function touchGlossarySelectionEndAtPoint(
    view: EditorView,
    session: MilkdownTouchBlockSelectionSession,
  ) {
    if (
      session.blockFrom == null ||
      session.blockTo == null ||
      session.startFrom == null ||
      session.startTo == null
    ) {
      return null;
    }

    const hit = view.posAtCoords({
      left: session.currentClientX,
      top: session.currentClientY,
    });
    if (!hit) return null;

    const blockText = view.state.doc.textBetween(session.blockFrom, session.blockTo, "");
    const position = Math.max(session.blockFrom, Math.min(hit.pos, session.blockTo));
    const relativeOffset = Math.max(
      0,
      Math.min(position - session.blockFrom, blockText.length),
    );
    const to = Math.max(
      session.startTo,
      session.blockFrom + graphemeBoundaryAtOrAfter(blockText, relativeOffset),
    );

    if (hit.pos < session.startFrom) {
      return null;
    }

    return {
      from: session.startFrom,
      to: Math.min(to, session.blockTo),
    };
  }

  function sourceAnchorFromProseRange(view: EditorView, from: number, to: number) {
    if (to <= from) return null;

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

  function touchGlossarySelectionPreviewRects(
    view: EditorView,
    from: number,
    to: number,
  ) {
    if (to <= from) return [];

    const range = document.createRange();
    try {
      const start = view.domAtPos(from);
      const end = view.domAtPos(to);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      const annotationRects = mergedClientTextLineRects(
        Array.from(range.getClientRects()),
      ).map((rect) => ({
        bottom: rect.bottom,
        canExtendRight: false,
        left: rect.left,
        lineRight: rect.right,
        right: rect.right,
        top: rect.top,
      }));

      return touchBlockSelectionPreviewRectsFromAnnotationRects(
        annotationRects,
        "glossary",
        "glossary",
      );
    } catch {
      return [];
    } finally {
      range.detach();
    }
  }

  function clientSelectionRectFromPreviewRects(
    previewRects: MilkdownTouchBlockSelectionPreviewRect[],
  ) {
    const anchorRect = viewportAnchorRectFromTouchBlockPreviewRects(previewRects);
    if (!anchorRect) return null;

    return {
      bottom: anchorRect.bottom,
      height: anchorRect.height,
      left: anchorRect.left,
      right: anchorRect.right,
      top: anchorRect.top,
      width: anchorRect.width,
    };
  }

  function visibleTextFromTouchBlockElement(blockElement: HTMLElement) {
    const clone = blockElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(
        ".tools, button, input, textarea, select, .milkdown-code-block-annotation-layer",
      )
      .forEach((element) => element.remove());

    return clone.innerText.replace(/\u00a0/g, " ");
  }

  function sourceAnchorFromTouchBlockElement(view: EditorView, blockElement: HTMLElement) {
    const selectedText = visibleTextFromTouchBlockElement(blockElement);
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

  function sourceAnchorFromCodeBlockLineSelection(
    codeBlockIndex: number,
    lineIndexes: number[],
  ) {
    const firstLineIndex = Math.min(...lineIndexes);
    const lastLineIndex = Math.max(...lineIndexes);
    const sourceRange = fencedCodeBlockContentLineSourceRange(
      editorMarkdownRef.current,
      codeBlockIndex,
      firstLineIndex,
      lastLineIndex + 1,
    );
    if (!sourceRange) return null;

    const selectedText = editorMarkdownRef.current.slice(sourceRange.from, sourceRange.to);
    if (!normalizeSelectedText(selectedText)) return null;

    return sourceAnchorFromEditorAnchor(
      currentMarkdownRef.current,
      makeAnchorFromRange(editorMarkdownRef.current, sourceRange.from, sourceRange.to),
    );
  }

  function sourceAnchorsFromCodeBlockSelectionRect(selectionRect: ClientSelectionRect) {
    const root = rootRef.current;
    const view = currentEditorView();
    if (!root || !view) return [];

    const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>(".milkdown-code-block"));
    return codeBlocks.flatMap((codeBlock, codeBlockIndex) => {
      if (!domRectOverlapsClientSelectionRect(codeBlock.getBoundingClientRect(), selectionRect)) {
        return [];
      }
      if (!elementTextOverlapsClientSelectionRect(codeBlock, selectionRect)) {
        return [];
      }

      const lineElements = Array.from(codeBlock.querySelectorAll<HTMLElement>(".cm-line"));
      const selectedLineIndexes = lineElements
        .map((lineElement, lineIndex) =>
          elementTextNodeClientRects(lineElement).length > 0 &&
          elementBoxOverlapsClientSelectionRect(lineElement, selectionRect)
            ? lineIndex
            : null,
        )
        .filter((lineIndex): lineIndex is number => lineIndex !== null);

      if (selectedLineIndexes.length > 0) {
        const lineAnchor = sourceAnchorFromCodeBlockLineSelection(
          codeBlockIndex,
          selectedLineIndexes,
        );
        return lineAnchor ? [lineAnchor] : [];
      }

      const fallbackAnchor = sourceAnchorFromTouchBlockElement(view, codeBlock);
      return fallbackAnchor ? [fallbackAnchor] : [];
    });
  }

  function touchBlockElementsFromSelectionRect(selectionRect: ClientSelectionRect) {
    const root = rootRef.current;
    if (!root) return [];
    if (!elementTextOverlapsClientSelectionRect(root, selectionRect)) return [];

    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(milkdownTouchBlockDomSelector),
    ).filter((element) => {
      if (element.closest(".milkdown-code-block")) return false;
      if (!normalizeSelectedText(visibleTextFromTouchBlockElement(element))) return false;

      return elementBoxOverlapsClientSelectionRect(element, selectionRect);
    });

    return candidates
      .filter(
        (element) =>
          !candidates.some(
            (candidate) => candidate !== element && candidate.contains(element),
          ),
      )
      .sort((left, right) =>
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1,
      );
  }

  function sourceAnchorsFromTouchBlockSelectionRect(
    view: EditorView,
    selectionRect: ClientSelectionRect,
  ) {
    const blockAnchors = touchBlockElementsFromSelectionRect(selectionRect)
      .map((blockElement) => sourceAnchorFromTouchBlockElement(view, blockElement))
      .filter((anchor): anchor is TextSelectionAnchor => Boolean(anchor));
    const codeAnchors = sourceAnchorsFromCodeBlockSelectionRect(selectionRect);

    return [...blockAnchors, ...codeAnchors]
      .filter((anchor) => normalizeSelectedText(anchor.selectedText))
      .sort((left, right) => left.from - right.from || left.to - right.to);
  }

  function touchBlockSelectionPreviewBoundsForElement(element: HTMLElement) {
    const viewportBounds = {
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
      top: 0,
    };
    const clipElements = [
      containerRef.current,
      element.closest<HTMLElement>(".cm-scroller"),
      element.closest<HTMLElement>(".codemirror-host"),
      element.closest<HTMLElement>(".milkdown-code-block-preview"),
      element.closest<HTMLElement>(".milkdown-code-block"),
    ].filter((clipElement): clipElement is HTMLElement => Boolean(clipElement));

    return clipElements.reduce((bounds, clipElement) => {
      const clipRect = clipElement.getBoundingClientRect();
      return {
        bottom: Math.min(bounds.bottom, clipRect.bottom),
        left: Math.max(bounds.left, clipRect.left),
        right: Math.min(bounds.right, clipRect.right),
        top: Math.max(bounds.top, clipRect.top),
      };
    }, viewportBounds);
  }

  function touchBlockSelectionPreviewLineMetrics(
    scope: HTMLElement,
    rect: { bottom: number; right: number; top: number },
    bounds: { bottom: number; left: number; right: number; top: number },
  ) {
    const range = scope.ownerDocument.createRange();
    try {
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
          lineRight: Math.min(rect.right, bounds.right),
        };
      }

      const lineRight = Math.min(
        bounds.right,
        Math.max(...lineRects.map((lineRect) => lineRect.right)),
      );

      return {
        canExtendRight: rect.right >= lineRight - milkdownAnnotationLineEndTolerance,
        lineRight,
      };
    } finally {
      range.detach();
    }
  }

  function touchBlockSelectionAnnotationRectsFromElement(element: HTMLElement) {
    const bounds = touchBlockSelectionPreviewBoundsForElement(element);
    return mergedClientTextLineRects(elementTextNodeClientRects(element))
      .map((domRect): MilkdownAnnotationRect | null => {
        const left = Math.max(domRect.left, bounds.left);
        const top = Math.max(domRect.top, bounds.top);
        const right = Math.min(domRect.right, bounds.right);
        const bottom = Math.min(domRect.bottom, bounds.bottom);

        if (right <= left || bottom <= top) return null;

        const lineMetrics = touchBlockSelectionPreviewLineMetrics(
          element,
          { bottom, right, top },
          bounds,
        );

        return {
          canExtendRight: lineMetrics.canExtendRight,
          clipLeft: bounds.left,
          clipRight: bounds.right,
          left,
          lineRight: Math.max(right, lineMetrics.lineRight),
          top,
          right,
          bottom,
        };
      })
      .filter((rect): rect is MilkdownAnnotationRect => Boolean(rect));
  }

  function touchBlockSelectionPreviewRectsFromAnnotationRects(
    rects: MilkdownAnnotationRect[],
    keyPrefix: string,
    kind: "note" | "glossary" = "note",
  ): MilkdownTouchBlockSelectionPreviewRect[] {
    const sortedRects = rects
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
      .sort((left, right) => left.top - right.top || left.left - right.left);

    if (sortedRects.length > 0) {
      sortedRects[sortedRects.length - 1].canExtendRight = false;
    }

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

    return sortedRects.flatMap((rect, rectIndex) => {
      const framePadding = milkdownAnnotationFramePaddingForKind(kind);
      const frameHorizontalPadding = milkdownAnnotationFrameHorizontalPaddingForKind(kind);
      let top = rect.top - framePadding;
      let bottom = rect.bottom + framePadding;
      const previousRect = sortedRects[rectIndex - 1];
      const nextRect = sortedRects[rectIndex + 1];

      if (previousRect) {
        const previousGap = rect.top - previousRect.bottom;
        if (previousGap >= 0 && previousGap <= milkdownAnnotationLineJoinMaxGap) {
          top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
        }
      }

      if (nextRect) {
        const nextGap = nextRect.top - rect.bottom;
        if (nextGap >= 0 && nextGap <= milkdownAnnotationLineJoinMaxGap) {
          bottom = Math.max(bottom, rect.bottom + nextGap / 2 + 1);
        }
      }

      const frameLeft = Math.max(
        rect.clipLeft ?? 0,
        rect.left - frameHorizontalPadding,
      );
      const frameRight = Math.min(
        rect.clipRight ?? window.innerWidth,
        (extensionRightByRect.get(rect) ?? rect.right) + frameHorizontalPadding,
      );
      const frameTop = Math.max(0, top);
      const frameBottom = Math.min(window.innerHeight, bottom);

      if (frameRight <= frameLeft || frameBottom <= frameTop) return [];

      return {
        borderRadius: borderRadiusByRect.get(rect) ?? milkdownAnnotationFrameCornerRadius,
        key: `${keyPrefix}:${rectIndex}:${roundFrameValue(frameLeft)}:${roundFrameValue(
          frameTop,
        )}`,
        height: roundFrameValue(frameBottom - frameTop),
        left: roundFrameValue(frameLeft),
        top: roundFrameValue(frameTop),
        width: roundFrameValue(frameRight - frameLeft),
      };
    });
  }

  function touchBlockSelectionPreviewRectsFromElement(
    element: HTMLElement,
    keyPrefix: string,
  ): MilkdownTouchBlockSelectionPreviewRect[] {
    return touchBlockSelectionPreviewRectsFromAnnotationRects(
      touchBlockSelectionAnnotationRectsFromElement(element),
      keyPrefix,
    );
  }

  function touchBlockSelectionPreviewRectsFromSelectionRect(
    selectionRect: ClientSelectionRect,
  ): MilkdownTouchBlockSelectionPreviewRect[] {
    if (!clientSelectionRectHasDrag(selectionRect)) return [];

    const blockPreviewRects = touchBlockSelectionPreviewRectsFromAnnotationRects(
      touchBlockElementsFromSelectionRect(selectionRect).flatMap((blockElement) =>
        touchBlockSelectionAnnotationRectsFromElement(blockElement),
      ),
      "block",
    );
    const root = rootRef.current;
    if (!root) return blockPreviewRects;

    const codePreviewRects = Array.from(
      root.querySelectorAll<HTMLElement>(".milkdown-code-block"),
    ).flatMap((codeBlock, codeBlockIndex) => {
      if (!domRectOverlapsClientSelectionRect(codeBlock.getBoundingClientRect(), selectionRect)) {
        return [];
      }
      if (!elementTextOverlapsClientSelectionRect(codeBlock, selectionRect)) {
        return [];
      }

      const linePreviewRects = Array.from(
        codeBlock.querySelectorAll<HTMLElement>(".cm-line"),
      ).flatMap((lineElement, lineIndex) =>
        elementTextNodeClientRects(lineElement).length > 0 &&
        elementBoxOverlapsClientSelectionRect(lineElement, selectionRect)
          ? touchBlockSelectionPreviewRectsFromElement(
              lineElement,
              `code:${codeBlockIndex}:${lineIndex}`,
            )
          : [],
      );
      if (linePreviewRects.length > 0) return linePreviewRects;

      return touchBlockSelectionPreviewRectsFromElement(codeBlock, `code:${codeBlockIndex}`);
    });

    return [...blockPreviewRects, ...codePreviewRects];
  }

  function anchorFromTouchBlockSelectionRect(
    view: EditorView,
    selectionRect: ClientSelectionRect,
  ) {
    if (!clientSelectionRectHasDrag(selectionRect)) return null;

    const anchors = sourceAnchorsFromTouchBlockSelectionRect(view, selectionRect);
    if (anchors.length === 0) return null;

    const from = Math.min(...anchors.map((anchor) => anchor.from));
    const to = Math.max(...anchors.map((anchor) => anchor.to));
    if (to <= from) return null;

    const anchor = makeAnchorFromRange(currentMarkdownRef.current, from, to);
    return normalizeSelectedText(anchor.selectedText) ? anchor : null;
  }

  function completeTouchSelection(
    anchor: TextSelectionAnchor,
    previewRects: MilkdownTouchBlockSelectionPreviewRect[],
    kind: "note" | "glossary",
    event?: Event,
  ) {
    const handled = onSelectionEnterRef.current(anchor, {
      anchorRect: viewportAnchorRectFromTouchBlockPreviewRects(previewRects),
      source: "touch-block",
    });
    if (!handled) return false;

    event?.preventDefault();
    event?.stopPropagation();
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
    suppressSelectionPublishAfterTouchBlockSelection();
    const containerRect = containerRef.current?.getBoundingClientRect();
    const committedPreviewRects = containerRect
      ? previewRects.map((rect) => ({
          ...rect,
          left: roundFrameValue(rect.left - containerRect.left),
          top: roundFrameValue(rect.top - containerRect.top),
        }))
      : previewRects;
    setTouchBlockCommittedSelectionOverlay(
      committedPreviewRects.length > 0
        ? {
            from: anchor.from,
            kind,
            previewRects: committedPreviewRects,
            to: anchor.to,
          }
        : null,
    );
    blurReadonlyEditorFocus();
    scheduleAnnotationFrameUpdate();
    return true;
  }

  function completeTouchBlockSelection(
    view: EditorView,
    selectionRect: ClientSelectionRect,
    event?: Event,
  ) {
    const anchor = anchorFromTouchBlockSelectionRect(view, selectionRect);
    if (!anchor) return false;

    return completeTouchSelection(
      anchor,
      touchBlockSelectionPreviewRectsFromSelectionRect(selectionRect),
      "note",
      event,
    );
  }

  function completeTouchGlossarySelection(
    view: EditorView,
    session: MilkdownTouchBlockSelectionSession,
    event?: Event,
  ) {
    if (session.currentFrom == null || session.currentTo == null) return false;

    const anchor =
      session.codeBlockIndex == null
        ? sourceAnchorFromProseRange(view, session.currentFrom, session.currentTo)
        : makeAnchorFromRange(
            currentMarkdownRef.current,
            session.currentFrom,
            session.currentTo,
          );
    if (!anchor) return false;

    return completeTouchSelection(
      anchor,
      session.codeBlockIndex == null
        ? touchGlossarySelectionPreviewRects(
            view,
            session.currentFrom,
            session.currentTo,
          )
        : touchGlossaryCodeSelectionPreviewRects(
            session.currentFrom,
            session.currentTo,
          ),
      "glossary",
      event,
    );
  }

  function clearTouchBlockHintTimers() {
    window.cancelAnimationFrame(touchBlockHintFrameRef.current);
    window.clearTimeout(touchBlockHintHideTimerRef.current);
    window.clearTimeout(touchBlockHintUnmountTimerRef.current);
    touchBlockHintFrameRef.current = 0;
    touchBlockHintHideTimerRef.current = 0;
    touchBlockHintUnmountTimerRef.current = 0;
  }

  function hideTouchBlockSelectionHint() {
    window.cancelAnimationFrame(touchBlockHintFrameRef.current);
    window.clearTimeout(touchBlockHintHideTimerRef.current);
    touchBlockHintFrameRef.current = 0;
    touchBlockHintHideTimerRef.current = 0;
    setTouchBlockSelectionOverlay((currentOverlay) =>
      currentOverlay ? { ...currentOverlay, hintPhase: "hiding" } : currentOverlay,
    );
  }

  function touchSelectionRectFromSession(session: MilkdownTouchBlockSelectionSession) {
    return clientSelectionRectFromPoints(
      session.startClientX,
      session.startClientY,
      session.currentClientX,
      session.currentClientY,
    );
  }

  function updateTouchBlockSelectionOverlayRect(
    session: MilkdownTouchBlockSelectionSession,
  ) {
    if (session.kind === "glossary") {
      const view = currentEditorView();
      if (!view) return false;

      const selection =
        session.codeBlockIndex == null
          ? touchGlossarySelectionEndAtPoint(view, session)
          : touchGlossaryCodeSelectionEndAtPoint(session);
      if (!selection) return false;

      session.currentFrom = selection.from;
      session.currentTo = selection.to;
      const previewRects =
        session.codeBlockIndex == null
          ? touchGlossarySelectionPreviewRects(
              view,
              selection.from,
              selection.to,
            )
          : touchGlossaryCodeSelectionPreviewRects(
              selection.from,
              selection.to,
            );
      const rect = clientSelectionRectFromPreviewRects(previewRects);
      if (!rect) return false;

      setTouchBlockSelectionOverlay((currentOverlay) =>
        currentOverlay
          ? { ...currentOverlay, kind: "glossary", previewRects, rect, tone: 0 }
          : {
              hintPhase: "entering",
              kind: "glossary",
              previewRects,
              rect,
              tone: 0,
            },
      );
      return true;
    }

    const rect = touchSelectionRectFromSession(session);
    const previewRects = touchBlockSelectionPreviewRectsFromSelectionRect(rect);
    const view = currentEditorView();
    const anchor = view ? anchorFromTouchBlockSelectionRect(view, rect) : null;
    const tone = anchor ? (mobileSelectionToneForAnchorRef.current?.(anchor) ?? 0) : 0;
    setTouchBlockSelectionOverlay((currentOverlay) =>
      currentOverlay
        ? { ...currentOverlay, kind: "note", previewRects, rect, tone }
        : { hintPhase: "entering", kind: "note", previewRects, rect, tone },
    );
    return true;
  }

  function showTouchBlockSelectionOverlay(session: MilkdownTouchBlockSelectionSession) {
    clearTouchBlockHintTimers();
    if (session.kind === "glossary") {
      const view = currentEditorView();
      if (
        !view ||
        session.currentFrom == null ||
        session.currentTo == null
      ) {
        recordTouchBlockSelectionDiagnostic("glossary-preview-state-missed", {
          hasEditorView: Boolean(view),
          hasFrom: session.currentFrom != null,
          hasTo: session.currentTo != null,
        });
        clearTouchBlockSelectionSession();
        return;
      }

      const previewRects =
        session.codeBlockIndex == null
          ? touchGlossarySelectionPreviewRects(
              view,
              session.currentFrom,
              session.currentTo,
            )
          : touchGlossaryCodeSelectionPreviewRects(
              session.currentFrom,
              session.currentTo,
            );
      const rect = clientSelectionRectFromPreviewRects(previewRects);
      if (!rect) {
        recordTouchBlockSelectionDiagnostic("glossary-preview-rect-missed", {
          previewRectCount: previewRects.length,
        });
        clearTouchBlockSelectionSession();
        return;
      }

      setTouchBlockSelectionOverlay({
        hintPhase: "entering",
        kind: "glossary",
        previewRects,
        rect,
        tone: 0,
      });
    } else {
      setTouchBlockSelectionOverlay({
        hintPhase: "entering",
        kind: "note",
        previewRects: [],
        rect: touchSelectionRectFromSession(session),
        tone: 0,
      });
    }
    touchBlockHintFrameRef.current = window.requestAnimationFrame(() => {
      touchBlockHintFrameRef.current = window.requestAnimationFrame(() => {
        touchBlockHintFrameRef.current = 0;
        setTouchBlockSelectionOverlay((currentOverlay) =>
          currentOverlay ? { ...currentOverlay, hintPhase: "visible" } : currentOverlay,
        );
      });
    });
    touchBlockHintHideTimerRef.current = window.setTimeout(
      hideTouchBlockSelectionHint,
      milkdownTouchBlockHintVisibleMs,
    );
  }

  function clearTouchBlockSelectionSession() {
    window.clearTimeout(touchBlockLongPressTimerRef.current);
    touchBlockLongPressTimerRef.current = 0;
    clearTouchBlockHintTimers();
    touchBlockSelectionSessionRef.current = null;
    setTouchBlockSelectionOverlay(null);
  }

  function activateTouchBlockSelection() {
    const session = touchBlockSelectionSessionRef.current;
    recordTouchBlockSelectionDiagnostic("long-press-timer-fired", {
      hasSession: Boolean(session),
      sessionActive: Boolean(session?.active),
    });
    if (!session || session.active) return;

    const enabled = touchBlockSelectionEnabled();
    const targetSupported = targetSupportsTouchBlockSelection(session.target);
    if (!enabled || !targetSupported) {
      recordTouchBlockSelectionDiagnostic("activation-rejected", {
        enabled,
        targetSupported,
      });
      clearTouchBlockSelectionSession();
      return;
    }

    if (session.kind === "glossary") {
      const view = currentEditorView();
      const start = view
        ? touchGlossarySelectionStartAtPoint(
            view,
            session.startClientX,
            session.startClientY,
          )
        : null;
      if (!start) {
        recordTouchBlockSelectionDiagnostic("glossary-start-missed", {
          hasEditorView: Boolean(view),
        });
        clearTouchBlockSelectionSession();
        return;
      }

      session.blockFrom = start.blockFrom;
      session.blockTo = start.blockTo;
      session.codeBlockIndex = start.codeBlockIndex;
      session.codeLineIndex = start.codeLineIndex;
      session.currentFrom = start.from;
      session.currentTo = start.to;
      session.startFrom = start.from;
      session.startTo = start.to;
    }

    session.active = true;
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
    suppressSelectionPublishAfterTouchBlockSelection();
    applyReadonlyDomFocusState();
    blurReadonlyEditorFocus();
    showTouchBlockSelectionOverlay(session);
    recordTouchBlockSelectionDiagnostic("selection-overlay-requested", {
      kind: session.kind,
    });
  }

  function touchMovedBeyondActivationTolerance(
    touch: Touch,
    session: MilkdownTouchBlockSelectionSession,
  ) {
    return (
      Math.abs(touch.clientX - session.startClientX) >
        milkdownTouchBlockActivationMoveTolerancePx ||
      Math.abs(touch.clientY - session.startClientY) >
        milkdownTouchBlockActivationMoveTolerancePx
    );
  }

  function createTouchBlockSelectionPlugin() {
    return new Plugin({
      key: milkdownTouchBlockSelectionPluginKey,
      props: {
        handleDOMEvents: {
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
            setTimeout(() => {
              window.getSelection()?.removeAllRanges();
            }, 0);
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
    const selectionRoot = root;

    function diagnosticTarget(target: EventTarget | null, selectionRoot: HTMLElement) {
      const element = elementFromEventTarget(target);
      return {
        className:
          typeof element?.className === "string" ? element.className.slice(0, 160) : "",
        rootContainsTarget: Boolean(
          target instanceof Node && selectionRoot.contains(target),
        ),
        tagName: element?.tagName ?? "",
      };
    }

    function handleDocumentTouchStart(event: TouchEvent) {
      recordTouchBlockSelectionDiagnostic("document-touchstart", {
        kind: mobileSelectionKindRef.current,
        ...diagnosticTarget(event.target, selectionRoot),
      });
    }

    function handleTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      const enabled = touchBlockSelectionEnabled();
      const targetSupported = targetSupportsTouchBlockSelection(event.target);
      const codeBlockAnnotationHit = touch
        ? Boolean(codeBlockAnnotationHitFromPoint(touch.clientX, touch.clientY))
        : false;
      recordTouchBlockSelectionDiagnostic("root-touchstart", {
        codeBlockAnnotationHit,
        enabled,
        kind: mobileSelectionKindRef.current,
        mobileBlockSelectionEnabled: mobileBlockSelectionEnabledRef.current,
        noteModeEnabled: noteModeEnabledRef.current,
        targetSupported,
        touchCount: event.touches.length,
        ...diagnosticTarget(event.target, selectionRoot),
      });
      if (
        !touch ||
        event.touches.length !== 1 ||
        !enabled ||
        !targetSupported ||
        codeBlockAnnotationHit
      ) {
        recordTouchBlockSelectionDiagnostic("touchstart-rejected");
        clearTouchBlockSelectionSession();
        return;
      }

      clearTouchBlockSelectionSession();
      touchBlockSelectionSessionRef.current = {
        active: false,
        currentClientX: touch.clientX,
        currentClientY: touch.clientY,
        kind: mobileSelectionKindRef.current,
        selecting: false,
        startClientX: touch.clientX,
        startClientY: touch.clientY,
        target: event.target,
      };
      recordTouchBlockSelectionDiagnostic("long-press-timer-started", {
        delay:
          mobileSelectionKindRef.current === "glossary"
            ? milkdownTouchGlossaryLongPressMs
            : milkdownTouchBlockLongPressMs,
      });
      applyReadonlyDomFocusState();
      blurReadonlyEditorFocus();
      touchBlockLongPressTimerRef.current = window.setTimeout(
        activateTouchBlockSelection,
        mobileSelectionKindRef.current === "glossary"
          ? milkdownTouchGlossaryLongPressMs
          : milkdownTouchBlockLongPressMs,
      );
    }

    function handleTouchMove(event: TouchEvent) {
      const session = touchBlockSelectionSessionRef.current;
      if (!session) return;

      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) {
        clearTouchBlockSelectionSession();
        return;
      }

      session.currentClientX = touch.clientX;
      session.currentClientY = touch.clientY;

      if (!session.active) {
        if (touchMovedBeyondActivationTolerance(touch, session)) {
          recordTouchBlockSelectionDiagnostic("pre-activation-move-cancelled", {
            deltaX: touch.clientX - session.startClientX,
            deltaY: touch.clientY - session.startClientY,
          });
          clearTouchBlockSelectionSession();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (session.kind === "glossary") {
        const deltaX = session.currentClientX - session.startClientX;
        if (!session.selecting) {
          if (deltaX <= -milkdownTouchBlockActivationMoveTolerancePx) {
            clearTouchBlockSelectionSession();
            return;
          }
          if (deltaX < milkdownTouchBlockActivationMoveTolerancePx) {
            return;
          }
          session.selecting = true;
        }

        if (!updateTouchBlockSelectionOverlayRect(session)) {
          clearTouchBlockSelectionSession();
          return;
        }
        hideTouchBlockSelectionHint();
        return;
      }

      updateTouchBlockSelectionOverlayRect(session);

      if (clientSelectionRectHasDrag(touchSelectionRectFromSession(session))) {
        hideTouchBlockSelectionHint();
      }
    }

    function handleTouchEnd(event: TouchEvent) {
      const session = touchBlockSelectionSessionRef.current;
      if (!session) return;

      const touch = event.changedTouches[0];
      if (touch && event.changedTouches.length === 1) {
        session.currentClientX = touch.clientX;
        session.currentClientY = touch.clientY;
      }
      const wasActive = session.active;
      const selectionRect = touchSelectionRectFromSession(session);
      if (!wasActive || (session.kind === "glossary" && !session.selecting)) {
        clearTouchBlockSelectionSession();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const view = currentEditorView();
      if (!view) {
        clearTouchBlockSelectionSession();
        return;
      }

      const selectionUpdated =
        session.kind !== "glossary" || updateTouchBlockSelectionOverlayRect(session);
      const handled =
        selectionUpdated &&
        (session.kind === "glossary"
          ? completeTouchGlossarySelection(view, session, event)
          : completeTouchBlockSelection(view, selectionRect, event));
      clearTouchBlockSelectionSession();
      if (handled) {
        event.stopImmediatePropagation();
      }
    }

    function handleTouchCancel() {
      recordTouchBlockSelectionDiagnostic("touchcancel");
      clearTouchBlockSelectionSession();
    }

    document.addEventListener("touchstart", handleDocumentTouchStart, {
      capture: true,
      passive: true,
    });
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
    recordTouchBlockSelectionDiagnostic("listeners-attached", {
      kind: mobileSelectionKindRef.current,
      mobileBlockSelectionEnabled: mobileBlockSelectionEnabledRef.current,
      noteModeEnabled: noteModeEnabledRef.current,
    });

    return () => {
      document.removeEventListener("touchstart", handleDocumentTouchStart, true);
      root.removeEventListener("touchstart", handleTouchStart, true);
      root.removeEventListener("touchmove", handleTouchMove, true);
      root.removeEventListener("touchend", handleTouchEnd, true);
      root.removeEventListener("touchcancel", handleTouchCancel, true);
      clearTouchBlockSelectionSession();
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
    let acceptsMarkdownUpdates = false;
    root.innerHTML = "";
    function diagramBlock(diagram: HTMLElement) {
      const view = currentEditorView();
      if (!view) return null;
      let found: { position: number; node: ProseMirrorNode } | null = null;
      view.state.doc.descendants((node, position) => {
        if (node.type.name !== "code_block") return true;
        const dom = view.nodeDOM(position);
        if (dom instanceof HTMLElement && dom.contains(diagram)) found = { position, node };
        return false;
      });
      return found as { position: number; node: ProseMirrorNode } | null;
    }
    let lastDiagramField: Element | null = null;
    const disposeReadingDiagrams = observeReadingDiagrams(root, {
      canEdit: () => !readOnlyRef.current && !noteModeEnabledRef.current,
      change: (diagram, previous, next) => {
        const view = currentEditorView(), block = diagramBlock(diagram);
        if (!view || !block || block.node.textContent !== previous || readOnlyRef.current || noteModeEnabledRef.current) return false;
        let from = 0, end = previous.length, nextEnd = next.length;
        while (from < end && from < nextEnd && previous[from] === next[from]) from++;
        while (end > from && nextEnd > from && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
        let transaction = view.state.tr;
        if (lastDiagramField !== document.activeElement) transaction = closeHistory(transaction);
        lastDiagramField = document.activeElement;
        view.dispatch(transaction.insertText(next.slice(from, nextEnd), block.position + 1 + from, block.position + 1 + end));
        return diagramBlock(diagram)?.node.textContent === next;
      },
      history: (diagram, shouldRedo) => {
        const view = currentEditorView();
        if (!view || readOnlyRef.current || noteModeEnabledRef.current) return undefined;
        // The caret belongs to the inline diagram editor, not the outer code block.
        (shouldRedo ? redoNoScroll : undoNoScroll)(view.state, view.dispatch);
        return diagramBlock(diagram)?.node.textContent;
      },
    });

    const crepe = new Crepe({
      root,
      defaultValue: encodeEmptyParagraphsForMilkdown(editorMarkdownRef.current),
      featureConfigs: {
        [CrepeFeature.Cursor]: {
          virtual: false,
        },
      },
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.LinkTooltip]: true,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.Placeholder]: true,
        [CrepeFeature.Table]: true,
        [CrepeFeature.Toolbar]: toolbarEnabled,
        [CrepeFeature.TopBar]: false,
      },
    });
    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        clipboardTextSerializer: (slice, view) =>
          serializeMarkedTextClipboardSlice(slice, view, ctx.get(serializerCtx)) ??
          prev.clipboardTextSerializer?.(slice, view) ??
          "",
        scrollThreshold: { top: 120, right: 0, bottom: 40, left: 0 },
        scrollMargin: { top: 120, right: 0, bottom: 40, left: 0 },
      }));

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
        languages: codeMirrorLanguages,
        extensions: [
          ...previousConfig.extensions,
          codeMirrorTextDiagramPreview,
          codeMirrorSyntaxHighlighting(codeMirrorClassHighlighter),
          ...webKitCodeBlockSelectionExtensions(),
        ],
        copyText: codeBlockCopyLabelRef.current,
        onCopy: (code) => {
          previousConfig.onCopy?.(code);
          const button = pendingCodeBlockCopyButtonRef.current;
          pendingCodeBlockCopyButtonRef.current = null;
          window.clearTimeout(pendingCodeBlockCopyClearTimerRef.current);
          pendingCodeBlockCopyClearTimerRef.current = 0;
          if (button && document.documentElement.contains(button)) {
            showCodeBlockCopyFeedback(button);
          }
        },
        previewOnlyByDefault: true,
        renderPreview: (language, content, applyPreview) => {
          if (isMermaidLanguage(language)) {
            if (retainDiagramTextEditor(root, content)) return undefined;
            return renderMilkdownMermaidPreview(content, applyPreview, mermaidLabelsRef.current);
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
        createSoftLineBlockInputRulePlugin(),
        createInlineMarkdownLinkInputRule(),
        createPastedInlineMarkBoundaryPlugin(),
        createPairedSymbolPlugin(),
        createSingleListItemIndentPlugin(),
        createListItemInlineStrongSyntaxPlugin(),
        createControlHistoryPlugin(),
        createShiftEnterParagraphSplitPlugin(),
        createReadonlyGuardPlugin(),
        ...plugins,
        createAnnotationPlugin({
          allowClickWithSelection: () => mobileBlockSelectionEnabledRef.current,
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
        const normalizedMarkdownWithoutEmptyListParagraphs =
          normalizeMarkdownForScholium(markdown);
        const view = currentEditorView();
        const normalizedEditorMarkdown = view
          ? preserveSerializedEmptyParagraphListBoundaries(
              normalizedMarkdownWithoutEmptyListParagraphs,
              view.state.doc,
            )
          : normalizedMarkdownWithoutEmptyListParagraphs;
        const normalizedMarkdown = mergeMarkdownFrontmatter(
          currentMarkdownRef.current,
          normalizedEditorMarkdown,
        );
        if (
          disposed ||
          !acceptsMarkdownUpdates ||
          normalizedMarkdown === currentMarkdownRef.current
        ) {
          return;
        }
        if (readOnlyRef.current || noteModeEnabledRef.current) return;

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
        if (disposed) return;
        restoreScrollAfterValueRefresh(root);
        acceptsMarkdownUpdates = true;
        syncMilkdownReadOnlyState();
        const view = currentEditorView();
        if (view && focusRequestKey > 0) {
          let codeBlockFocusScheduled = false;
          if (selectionToRestore) {
            const bodySelection = {
              anchor: frontmatterBodyOffsetFromFullSourceOffset(
                currentMarkdownRef.current,
                selectionToRestore.anchor,
              ),
              head: frontmatterBodyOffsetFromFullSourceOffset(
                currentMarkdownRef.current,
                selectionToRestore.head,
              ),
            };
            const codeBlockSelection = fencedCodeBlockSelectionFromSource(
              editorMarkdownRef.current,
              bodySelection,
            );
            const codeBlockContentStart = codeBlockSelection
              ? proseCodeBlockContentStartAtIndex(
                  view.state.doc,
                  codeBlockSelection.index,
                )
              : null;

            if (codeBlockSelection && codeBlockContentStart !== null) {
              codeBlockFocusScheduled = true;
              const anchor = codeBlockContentStart + codeBlockSelection.selection.anchor;
              const head = codeBlockContentStart + codeBlockSelection.selection.head;
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.create(view.state.doc, anchor, head))
                  .scrollIntoView(),
              );

              const restoreCodeBlockFocus = (attempt = 0) => {
                if (disposed) return;
                const codeBlockElement = root.querySelectorAll<HTMLElement>(
                  ".milkdown-code-block",
                )[codeBlockSelection.index];
                const codeMirrorElement =
                  codeBlockElement?.querySelector<HTMLElement>(".cm-editor");
                const codeMirrorView = codeMirrorElement
                  ? CodeMirrorEditorView.findFromDOM(codeMirrorElement)
                  : null;
                if (codeBlockElement && !codeMirrorView && attempt === 0) {
                  codeBlockElement.scrollIntoView({ block: "nearest" });
                }
                if ((!codeBlockElement || !codeMirrorView) && attempt < 40) {
                  window.setTimeout(() => restoreCodeBlockFocus(attempt + 1), 25);
                  return;
                }

                if (codeMirrorView) {
                  codeMirrorView.dispatch({ selection: codeBlockSelection.selection });
                  codeMirrorView.focus();
                  scheduleEditorViewportRestore(
                    codeMirrorView.dom,
                    selectionToRestore.viewportY,
                    () => codeMirrorView.coordsAtPos(codeMirrorView.state.selection.main.head)?.top,
                  );
                } else {
                  view.dom.focus({ preventScroll: true });
                }
                onFocusRequestHandled?.(focusRequestKey);
              };
              restoreCodeBlockFocus();
            } else {
              const { anchor, head } = proseSelectionFromMarkdownSelection(
                view.state.doc,
                currentMarkdownRef.current,
                selectionToRestore,
              );
              try {
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)),
                );
              } catch {
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.near(view.state.doc.resolve(head), head < anchor ? -1 : 1),
                  ),
                );
              }
            }
          }
          if (!codeBlockFocusScheduled) {
            view.dom.focus({ preventScroll: true });
            if (selectionToRestore) {
              scheduleEditorViewportRestore(
                view.dom,
                selectionToRestore.viewportY,
                () => view.coordsAtPos(view.state.selection.head).top,
              );
            }
            onFocusRequestHandled?.(focusRequestKey);
          }
        }
        hydrateLocalMarkdownImages();
        scheduleAnnotationFrameUpdate();
        dispatchSearchUpdate();
      })
      .catch((error: unknown) => {
        if (!disposed) restoreScrollAfterValueRefresh(root);
        console.error("failed to create Milkdown editor", error);
      });

    return () => {
      disposed = true;
      disposeReadingDiagrams();
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
    function targetShouldKeepOwnKeyboardShortcut(target: EventTarget | null) {
      const root = rootRef.current;
      if (!root || !(target instanceof Element)) return false;

      if (target.closest("button, input, textarea, select")) return true;
      if (root.contains(target)) return false;

      return target instanceof HTMLElement && target.isContentEditable;
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      const root = rootRef.current;
      if (!root) return;

      const targetElement = elementFromEventTarget(event.target);
      const targetTextControl =
        targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement
          ? targetElement
          : null;
      if (
        targetTextControl &&
        targetTextControl.closest(".milkdown-link-edit") &&
        shouldHandlePreviewSelectAllShortcut(event, true, false)
      ) {
        targetTextControl.select();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const targetIsNestedEditor = Boolean(
        targetElement?.closest(".milkdown-code-block .cm-editor"),
      );
      const targetKeepsOwnShortcut = targetShouldKeepOwnKeyboardShortcut(event.target);
      const selection = window.getSelection();
      const activeElement = document.activeElement;
      const editorHasFocus = activeElement instanceof Node && root.contains(activeElement);
      const targetIsInEditor = event.target instanceof Node && root.contains(event.target);
      const selectionIsInEditor =
        selectionBelongsToRoot(root, selection) ||
        selectionVisuallyOverlapsRoot(root, selection);

      if (
        shouldHandlePreviewSelectAllShortcut(
          event,
          !targetKeepsOwnShortcut &&
            (targetIsInEditor || editorHasFocus || selectionIsInEditor),
          targetIsNestedEditor,
        )
      ) {
        const view = currentEditorView();
        if (!view) return;

        selectAllEditorContents(view);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const isPlainEnter =
        event.key === "Enter" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;
      if (!isPlainEnter) return;

      if (!root || targetKeepsOwnShortcut) return;

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
    noteModeEnabled ? "is-note-mode" : "",
    readOnly ? "is-readonly" : "",
    noteModeEnabled && mobileBlockSelectionEnabled ? "is-block-note-selection" : "",
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
  const touchBlockSelectionRect = touchBlockSelectionOverlay?.rect ?? null;
  const touchSelectionKind =
    touchBlockSelectionOverlay?.kind ??
    touchBlockCommittedSelectionOverlay?.kind ??
    mobileSelectionKind;
  const touchBlockPreviewRects = touchBlockSelectionRect
    ? (touchBlockSelectionOverlay?.previewRects ?? [])
    : (touchBlockCommittedSelectionOverlay?.previewRects ?? []);
  const touchBlockSelectionHintStyle = touchBlockSelectionRect
    ? {
        left: Math.min(
          Math.max(touchBlockSelectionRect.left + touchBlockSelectionRect.width / 2, 18),
          window.innerWidth - 18,
        ),
        top: Math.max(12, touchBlockSelectionRect.top - 48),
      }
    : undefined;

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
      {touchBlockSelectionRect || touchBlockPreviewRects.length > 0 ? (
        <div
          className={`milkdown-touch-block-selection-overlay ${
            touchBlockSelectionRect ? "is-dragging" : "is-committed"
          } ${touchSelectionKind === "glossary" ? "is-glossary" : ""}`}
          data-annotation-kind={touchSelectionKind}
          data-note-tone={
            touchBlockSelectionRect
              ? (touchBlockSelectionOverlay?.tone ?? 0)
              : mobileCommittedSelectionTone
          }
          aria-hidden="true"
        >
          {touchBlockPreviewRects.map((previewRect) => (
            <div
              className="milkdown-touch-block-selection-preview"
              key={previewRect.key}
              style={{
                borderRadius: previewRect.borderRadius,
                height: previewRect.height,
                left: previewRect.left,
                top: previewRect.top,
                width: previewRect.width,
              }}
            />
          ))}
          {touchBlockSelectionRect ? (
            <>
              {touchSelectionKind === "note" ? (
                <div
                  className="milkdown-touch-block-selection-rect"
                  style={{
                    height: Math.max(1, touchBlockSelectionRect.height),
                    left: touchBlockSelectionRect.left,
                    top: touchBlockSelectionRect.top,
                    width: Math.max(1, touchBlockSelectionRect.width),
                  }}
                />
              ) : null}
              <div
                className={`milkdown-touch-block-selection-hint is-${
                  touchBlockSelectionOverlay?.hintPhase ?? "hiding"
                }`}
                style={touchBlockSelectionHintStyle}
              >
                {mobileBlockSelectionHint}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
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
});
