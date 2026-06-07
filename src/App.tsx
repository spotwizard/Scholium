import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  createElement,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./App.css";
import {
  EditorChangeSource,
  MarkdownEditor,
  TextAnnotation,
  TextSelectionAnchor,
} from "./MarkdownEditor";

type NoteStatus = "active" | "orphaned" | "deleted";

type MarkdownDocument = {
  id: string;
  title: string;
  path: string;
  filePath: string | null;
  notesPath: string | null;
  updatedAt: string;
  body: string;
};

type SelectionNote = {
  id: string;
  documentId: string;
  status: NoteStatus;
  selectedText: string;
  anchor: TextSelectionAnchor;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type OpenMarkdownFileResult = {
  path: string;
  notesPath: string;
  title: string;
  body: string;
  notes: SelectionNote[];
};

type OpenDirectoryEntryResult =
  | {
      kind: "directory";
      path: string;
      title: string;
      file: null;
    }
  | {
      kind: "file";
      path: string;
      title: string;
      file: OpenMarkdownFileResult;
    };

type OpenMarkdownDirectoryResult = {
  path: string;
  title: string;
  entries: OpenDirectoryEntryResult[];
};

type OpenMarkdownFileContextResult = {
  selectedFile: OpenMarkdownFileResult;
  directory: OpenMarkdownDirectoryResult;
};

type SaveMarkdownFileResult = {
  path: string;
  notesPath: string;
};

type WorkspaceEntry =
  | {
      kind: "directory";
      id: string;
      title: string;
      path: string;
    }
  | {
      kind: "file";
      id: string;
      title: string;
      path: string;
      documentId: string;
    };

type DirtyDocumentState = {
  body: boolean;
  notes: boolean;
};

type EditorMode = "edit" | "preview";
type ActiveNoteMode = "view" | "edit";

type PreviewAnnotationFrame = {
  noteId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type PreviewTextMap = {
  text: string;
  sourceOffsets: Array<number | null>;
};

type PreviewAnnotationTextRange = {
  note: SelectionNote;
  start: number;
  end: number;
};

type MarkdownPreviewBlock =
  | {
      kind: "heading";
      key: string;
      startLine: number;
      endLine: number;
      level: number;
      text: string;
    }
  | {
      kind: "paragraph";
      key: string;
      startLine: number;
      endLine: number;
      text: string;
    }
  | {
      kind: "quote";
      key: string;
      startLine: number;
      endLine: number;
      text: string;
    }
  | {
      kind: "code";
      key: string;
      startLine: number;
      endLine: number;
      text: string;
    }
  | {
      kind: "unordered-list" | "ordered-list";
      key: string;
      startLine: number;
      endLine: number;
      items: string[];
    }
  | {
      kind: "rule";
      key: string;
      startLine: number;
      endLine: number;
    };

const markdownFilters = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown"],
  },
];

const previewAnnotationFramePadding = 4;
const bottomNotePanelAnimationMs = 180;
const annotationOpenDelayMs = 1000;

const documentsSeed: MarkdownDocument[] = [
  {
    id: "roadmap",
    title: "Scholium Roadmap",
    path: "workspace/roadmap.md",
    filePath: null,
    notesPath: null,
    updatedAt: "Today",
    body: `# Scholium Roadmap

Scholium is a Markdown writing space for reading, drafting, and keeping text-bound notes beside the source material.

## MVP Scope

The first product surface keeps documents, the editor, and notes visible at the same time.

## Selection Notes

Readers can highlight a passage, attach a note, and return later to see a thin marked range around the annotated text.`,
  },
  {
    id: "research",
    title: "Research Notes",
    path: "workspace/research.md",
    filePath: null,
    notesPath: null,
    updatedAt: "Yesterday",
    body: `# Research Notes

Markdown users often want plain files, fast editing, and a clean reading surface.

## Annotation Pattern

The note sidebar should show the context of each note without forcing the document to become a database.

## Storage Direction

The Markdown file can stay untouched while annotations live in a sidecar JSON file.`,
  },
  {
    id: "meeting",
    title: "Planning Meeting",
    path: "workspace/meeting.md",
    filePath: null,
    notesPath: null,
    updatedAt: "Jun 3",
    body: `# Planning Meeting

Define the first release around a calm editor, reliable local files, and notes that attach to selected text.

## Decisions

- Build the shell with Tauri
- Keep the first editor simple
- Let users rebind notes when edited text no longer matches`,
  },
];

function makeAnchor(body: string, selectedText: string): TextSelectionAnchor {
  const from = body.indexOf(selectedText);
  const safeFrom = from >= 0 ? from : 0;
  const safeTo = from >= 0 ? from + selectedText.length : selectedText.length;

  return {
    from: safeFrom,
    to: safeTo,
    selectedText,
    prefix: body.slice(Math.max(0, safeFrom - 48), safeFrom),
    suffix: body.slice(safeTo, Math.min(body.length, safeTo + 48)),
  };
}

const notesSeed: SelectionNote[] = [
  {
    id: "note-1",
    documentId: "roadmap",
    status: "active",
    selectedText: "text-bound notes",
    anchor: makeAnchor(documentsSeed[0].body, "text-bound notes"),
    body: "This wording should stay central to the product positioning.",
    createdAt: "09:40",
    updatedAt: "09:40",
    deletedAt: null,
  },
  {
    id: "note-2",
    documentId: "research",
    status: "active",
    selectedText: "sidecar JSON file",
    anchor: makeAnchor(documentsSeed[1].body, "sidecar JSON file"),
    body: "Sidecar storage keeps the Markdown file portable for other tools.",
    createdAt: "10:15",
    updatedAt: "10:15",
    deletedAt: null,
  },
];

function nowLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refreshAnchor(body: string, anchor: TextSelectionAnchor): TextSelectionAnchor {
  return {
    ...anchor,
    prefix: body.slice(Math.max(0, anchor.from - 48), anchor.from),
    suffix: body.slice(anchor.to, Math.min(body.length, anchor.to + 48)),
  };
}

function reconcileNote(note: SelectionNote, nextBody: string): SelectionNote {
  if (note.status !== "active") return note;

  const exactText = nextBody.slice(note.anchor.from, note.anchor.to);
  if (exactText === note.selectedText) {
    return {
      ...note,
      anchor: refreshAnchor(nextBody, note.anchor),
    };
  }

  const nextIndex = nextBody.indexOf(note.selectedText);
  if (nextIndex >= 0) {
    const nextAnchor = makeAnchor(nextBody, note.selectedText);
    return {
      ...note,
      anchor: {
        ...nextAnchor,
        from: nextIndex,
        to: nextIndex + note.selectedText.length,
      },
    };
  }

  return {
    ...note,
    status: "orphaned",
    updatedAt: nowLabel(),
  };
}

function hasNativeStorageAccess() {
  return "__TAURI_INTERNALS__" in window;
}

function ensureMarkdownExtension(path: string) {
  return /\.(md|markdown|mdown)$/i.test(path) ? path : `${path}.md`;
}

function workspaceEntryFromDocument(document: MarkdownDocument): WorkspaceEntry {
  return {
    kind: "file",
    id: `file:${document.id}`,
    title: document.title,
    path: document.path,
    documentId: document.id,
  };
}

function savedBodiesFromDocuments(documents: MarkdownDocument[]) {
  return Object.fromEntries(documents.map((document) => [document.id, document.body]));
}

function hasDirtyState(state: DirtyDocumentState | undefined) {
  return Boolean(state?.body || state?.notes);
}

function isSafeLink(href: string) {
  return /^(https?:|mailto:)/i.test(href);
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-inline-${tokenIndex}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch && isSafeLink(linkMatch[2])) {
        nodes.push(
          <a href={linkMatch[2]} key={key} rel="noreferrer" target="_blank">
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    lastIndex = index + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function getLineStartOffsets(markdown: string) {
  const offsets = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function getBlockRange(markdown: string, block: MarkdownPreviewBlock) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const start = lineStartOffsets[block.startLine] ?? 0;
  const endLine = lines[block.endLine] ?? "";
  const end = (lineStartOffsets[block.endLine] ?? markdown.length) + endLine.length;

  return { start, end };
}

function trimRange(text: string, from: number, to: number) {
  let nextFrom = Math.max(0, Math.min(from, text.length));
  let nextTo = Math.max(nextFrom, Math.min(to, text.length));

  while (nextFrom < nextTo && /\s/.test(text[nextFrom])) {
    nextFrom += 1;
  }

  while (nextTo > nextFrom && /\s/.test(text[nextTo - 1])) {
    nextTo -= 1;
  }

  return { from: nextFrom, to: nextTo };
}

function getBlockSemanticRange(markdown: string, block: MarkdownPreviewBlock) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const blockRange = getBlockRange(markdown, block);

  if (block.kind === "rule") return null;

  if (block.kind === "heading") {
    const line = lines[block.startLine] ?? "";
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match || match.index === undefined) return trimRange(markdown, blockRange.start, blockRange.end);

    const contentStart = blockRange.start + match[1].length + (line[match[1].length] === " " ? 1 : 0);
    return trimRange(markdown, contentStart, blockRange.end);
  }

  if (block.kind === "code" && block.endLine > block.startLine) {
    const openingLine = lines[block.startLine] ?? "";
    const contentStart = (lineStartOffsets[block.startLine] ?? 0) + openingLine.length + 1;
    const contentEnd = Math.max(contentStart, (lineStartOffsets[block.endLine] ?? blockRange.end) - 1);
    return trimRange(markdown, contentStart, contentEnd);
  }

  return trimRange(markdown, blockRange.start, blockRange.end);
}

function getLineContentStart(line: string) {
  const match = line.match(/\S/);
  return match?.index ?? 0;
}

function appendTextMap(target: PreviewTextMap, text: string, sourceStart: number | null) {
  target.text += text;
  target.sourceOffsets.push(
    ...Array.from({ length: text.length }, (_, index) =>
      sourceStart === null ? null : sourceStart + index,
    ),
  );
}

function appendTextMapSeparator(target: PreviewTextMap, separator: string) {
  appendTextMap(target, separator, null);
}

function getHeadingTextMap(markdown: string, block: Extract<MarkdownPreviewBlock, { kind: "heading" }>) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const line = lines[block.startLine] ?? "";
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  const markerLength = match ? match[1].length + (line[match[1].length] === " " ? 1 : 0) : 0;
  const sourceStart = (lineStartOffsets[block.startLine] ?? 0) + markerLength;

  return {
    text: block.text,
    sourceOffsets: Array.from({ length: block.text.length }, (_, index) => sourceStart + index),
  };
}

function getParagraphTextMap(
  markdown: string,
  block: Extract<MarkdownPreviewBlock, { kind: "paragraph" }>,
) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const textMap: PreviewTextMap = { text: "", sourceOffsets: [] };

  for (let lineIndex = block.startLine; lineIndex <= block.endLine; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    if (lineIndex > block.startLine) {
      appendTextMapSeparator(textMap, " ");
    }

    appendTextMap(
      textMap,
      trimmed,
      (lineStartOffsets[lineIndex] ?? 0) + getLineContentStart(line),
    );
  }

  return textMap;
}

function getQuoteLineTextMap(
  markdown: string,
  block: Extract<MarkdownPreviewBlock, { kind: "quote" }>,
  quoteIndex: number,
) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const lineIndex = block.startLine + quoteIndex;
  const line = lines[lineIndex] ?? "";
  const marker = line.match(/^>\s?/)?.[0] ?? "";
  const text = line.slice(marker.length);

  return {
    text,
    sourceOffsets: Array.from(
      { length: text.length },
      (_, index) => (lineStartOffsets[lineIndex] ?? 0) + marker.length + index,
    ),
  };
}

function getListItemTextMap(
  markdown: string,
  block: Extract<MarkdownPreviewBlock, { kind: "unordered-list" | "ordered-list" }>,
  itemIndex: number,
) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const lineIndex = block.startLine + itemIndex;
  const line = lines[lineIndex] ?? "";
  const marker =
    block.kind === "unordered-list"
      ? line.match(/^[-*]\s+/)?.[0] ?? ""
      : line.match(/^\d+\.\s+/)?.[0] ?? "";
  const text = line.slice(marker.length);

  return {
    text,
    sourceOffsets: Array.from(
      { length: text.length },
      (_, index) => (lineStartOffsets[lineIndex] ?? 0) + marker.length + index,
    ),
  };
}

function getCodeTextMap(markdown: string, block: Extract<MarkdownPreviewBlock, { kind: "code" }>) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const textMap: PreviewTextMap = { text: "", sourceOffsets: [] };

  for (let lineIndex = block.startLine + 1; lineIndex < block.endLine; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (lineIndex > block.startLine + 1) {
      appendTextMap(textMap, "\n", (lineStartOffsets[lineIndex] ?? 0) - 1);
    }
    appendTextMap(textMap, line, lineStartOffsets[lineIndex] ?? 0);
  }

  return textMap;
}

function getPreviewBlockTextMap(markdown: string, block: MarkdownPreviewBlock): PreviewTextMap {
  if (block.kind === "heading") return getHeadingTextMap(markdown, block);
  if (block.kind === "paragraph") return getParagraphTextMap(markdown, block);
  if (block.kind === "code") return getCodeTextMap(markdown, block);
  if (block.kind === "quote") {
    return block.text.split("\n").reduce<PreviewTextMap>(
      (textMap, _quoteLine, quoteIndex) => {
        if (quoteIndex > 0) appendTextMapSeparator(textMap, "\n");
        const quoteLineTextMap = getQuoteLineTextMap(markdown, block, quoteIndex);
        appendTextMap(textMap, quoteLineTextMap.text, quoteLineTextMap.sourceOffsets[0] ?? null);
        return textMap;
      },
      { text: "", sourceOffsets: [] },
    );
  }
  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    return block.items.reduce<PreviewTextMap>(
      (textMap, _item, itemIndex) => {
        if (itemIndex > 0) appendTextMapSeparator(textMap, "\n");
        const itemTextMap = getListItemTextMap(markdown, block, itemIndex);
        appendTextMap(textMap, itemTextMap.text, itemTextMap.sourceOffsets[0] ?? null);
        return textMap;
      },
      { text: "", sourceOffsets: [] },
    );
  }

  return { text: "", sourceOffsets: [] };
}

function isSelectionCompleteMarkdownBlock(markdown: string, anchor: TextSelectionAnchor) {
  const selection = trimRange(markdown, anchor.from, anchor.to);
  if (selection.from === selection.to) return true;

  const blocks = parseMarkdownPreviewBlocks(markdown)
    .map((block) => ({
      block,
      sourceRange: getBlockRange(markdown, block),
      semanticRange: getBlockSemanticRange(markdown, block),
    }))
    .filter((block) => block.semanticRange);
  const intersectedBlocks = blocks.filter(
    ({ sourceRange }) => selection.to > sourceRange.start && selection.from < sourceRange.end,
  );

  if (intersectedBlocks.length === 0) return true;

  return intersectedBlocks.every(({ semanticRange }) => {
    if (!semanticRange) return true;

    return selection.from <= semanticRange.from && selection.to >= semanticRange.to;
  });
}

function makeAnchorFromRange(
  body: string,
  from: number,
  to: number,
  selectedText: string,
): TextSelectionAnchor {
  return {
    from,
    to,
    selectedText,
    prefix: body.slice(Math.max(0, from - 48), from),
    suffix: body.slice(to, Math.min(body.length, to + 48)),
  };
}

function normalizeTextMapForMatch(textMap: PreviewTextMap): PreviewTextMap {
  const normalized: PreviewTextMap = { text: "", sourceOffsets: [] };
  let pendingWhitespaceOffset: number | null = null;
  let hasPendingWhitespace = false;

  Array.from(textMap.text).forEach((character, index) => {
    const sourceOffset = textMap.sourceOffsets[index] ?? null;

    if (/\s/.test(character)) {
      hasPendingWhitespace = true;
      if (pendingWhitespaceOffset === null && sourceOffset !== null) {
        pendingWhitespaceOffset = sourceOffset;
      }
      return;
    }

    if (hasPendingWhitespace && normalized.text.length > 0) {
      normalized.text += " ";
      normalized.sourceOffsets.push(pendingWhitespaceOffset);
    }

    normalized.text += character;
    normalized.sourceOffsets.push(sourceOffset);
    hasPendingWhitespace = false;
    pendingWhitespaceOffset = null;
  });

  return normalized;
}

function getPreviewSourceProjection(markdown: string) {
  return parseMarkdownPreviewBlocks(markdown).reduce<PreviewTextMap>(
    (projection, block, blockIndex) => {
      if (blockIndex > 0 && projection.text.length > 0) {
        appendTextMapSeparator(projection, "\n\n");
      }

      const blockTextMap = getPreviewBlockTextMap(markdown, block);
      projection.text += blockTextMap.text;
      projection.sourceOffsets.push(...blockTextMap.sourceOffsets);
      return projection;
    },
    { text: "", sourceOffsets: [] },
  );
}

function sourceRangeFromTextMapMatch(textMap: PreviewTextMap, start: number, end: number) {
  const sourceOffsets = textMap.sourceOffsets
    .slice(start, end)
    .filter((offset): offset is number => offset !== null);

  if (sourceOffsets.length === 0) return null;

  return {
    from: Math.min(...sourceOffsets),
    to: Math.max(...sourceOffsets) + 1,
  };
}

function makePreviewAnchor(body: string, selectedText: string) {
  const normalizedSelection = selectedText.replace(/\s+/g, " ").trim();
  if (!normalizedSelection) return null;

  const projection = normalizeTextMapForMatch(getPreviewSourceProjection(body));
  const projectionIndex = projection.text.indexOf(normalizedSelection);

  if (projectionIndex >= 0) {
    const sourceRange = sourceRangeFromTextMapMatch(
      projection,
      projectionIndex,
      projectionIndex + normalizedSelection.length,
    );

    if (sourceRange) {
      return makeAnchorFromRange(
        body,
        sourceRange.from,
        sourceRange.to,
        body.slice(sourceRange.from, sourceRange.to),
      );
    }
  }

  const fallbackIndex = body.indexOf(normalizedSelection);
  if (fallbackIndex < 0) return null;

  return makeAnchorFromRange(
    body,
    fallbackIndex,
    fallbackIndex + normalizedSelection.length,
    body.slice(fallbackIndex, fallbackIndex + normalizedSelection.length),
  );
}

function getNotesForPreviewBlock(
  markdown: string,
  block: MarkdownPreviewBlock,
  notes: SelectionNote[],
) {
  const blockRange = getBlockRange(markdown, block);

  return notes.filter(
    (note) =>
      note.status === "active" &&
      note.anchor.to > blockRange.start &&
      note.anchor.from < blockRange.end,
  );
}

function getAnnotationRangesForTextMap(textMap: PreviewTextMap, notes: SelectionNote[]) {
  const ranges: PreviewAnnotationTextRange[] = [];

  notes.forEach((note) => {
    let rangeStart: number | null = null;

    textMap.sourceOffsets.forEach((sourceOffset, index) => {
      const isMarked =
        sourceOffset !== null && sourceOffset >= note.anchor.from && sourceOffset < note.anchor.to;

      if (isMarked && rangeStart === null) {
        rangeStart = index;
      }

      if (!isMarked && rangeStart !== null) {
        ranges.push({ note, start: rangeStart, end: index });
        rangeStart = null;
      }
    });

    if (rangeStart !== null) {
      ranges.push({ note, start: rangeStart, end: textMap.text.length });
    }
  });

  return ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function renderAnnotatedPlainText(
  textMap: PreviewTextMap,
  keyPrefix: string,
  notes: SelectionNote[],
  onAnnotationClick: (noteId: string) => void,
  onAnnotationDoubleClick: (noteId: string) => void,
) {
  const ranges = getAnnotationRangesForTextMap(textMap, notes);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, rangeIndex) => {
    if (range.start < cursor) return;

    if (range.start > cursor) {
      nodes.push(textMap.text.slice(cursor, range.start));
    }

    nodes.push(
      <span
        className="preview-note-annotation"
        data-note-id={range.note.id}
        key={`${keyPrefix}-note-${rangeIndex}`}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onAnnotationClick(range.note.id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAnnotationDoubleClick(range.note.id);
        }}
      >
        {textMap.text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < textMap.text.length) {
    nodes.push(textMap.text.slice(cursor));
  }

  return nodes;
}

function renderPreviewInline(
  textMap: PreviewTextMap,
  keyPrefix: string,
  notes: SelectionNote[],
  onAnnotationClick: (noteId: string) => void,
  onAnnotationDoubleClick: (noteId: string) => void,
) {
  if (notes.length === 0) {
    return renderInlineMarkdown(textMap.text, keyPrefix);
  }

  const ranges = getAnnotationRangesForTextMap(textMap, notes);

  if (ranges.length === 0) {
    return renderInlineMarkdown(textMap.text, keyPrefix);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, rangeIndex) => {
    if (range.start < cursor) return;

    if (range.start > cursor) {
      nodes.push(
        ...renderInlineMarkdown(
          textMap.text.slice(cursor, range.start),
          `${keyPrefix}-before-${rangeIndex}`,
        ),
      );
    }

    nodes.push(
      <span
        className="preview-note-annotation"
        data-note-id={range.note.id}
        key={`${keyPrefix}-note-${rangeIndex}`}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onAnnotationClick(range.note.id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAnnotationDoubleClick(range.note.id);
        }}
      >
        {renderInlineMarkdown(
          textMap.text.slice(range.start, range.end),
          `${keyPrefix}-marked-${rangeIndex}`,
        )}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < textMap.text.length) {
    nodes.push(...renderInlineMarkdown(textMap.text.slice(cursor), `${keyPrefix}-after`));
  }

  return nodes;
}

function roundPreviewFrameValue(value: number) {
  return Math.round(value * 100) / 100;
}

function measurePreviewAnnotationFrames(container: HTMLDivElement): PreviewAnnotationFrame[] {
  const containerRect = container.getBoundingClientRect();
  const rectsByNoteId = new Map<string, DOMRect[]>();

  container
    .querySelectorAll<HTMLElement>(".preview-note-annotation[data-note-id]")
    .forEach((annotation) => {
      const noteId = annotation.dataset.noteId;
      if (!noteId) return;

      const annotationRects = Array.from(annotation.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (annotationRects.length === 0) return;

      rectsByNoteId.set(noteId, [...(rectsByNoteId.get(noteId) ?? []), ...annotationRects]);
    });

  return Array.from(rectsByNoteId.entries())
    .map(([noteId, rects]) => {
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));

      return {
        noteId,
        left: roundPreviewFrameValue(
          Math.max(0, left - containerRect.left + container.scrollLeft - previewAnnotationFramePadding),
        ),
        top: roundPreviewFrameValue(
          Math.max(0, top - containerRect.top + container.scrollTop - previewAnnotationFramePadding),
        ),
        width: roundPreviewFrameValue(right - left + previewAnnotationFramePadding * 2),
        height: roundPreviewFrameValue(bottom - top + previewAnnotationFramePadding * 2),
      };
    })
    .sort(
      (left, right) =>
        left.top - right.top || left.left - right.left || left.noteId.localeCompare(right.noteId),
    );
}

function arePreviewAnnotationFramesEqual(
  leftFrames: PreviewAnnotationFrame[],
  rightFrames: PreviewAnnotationFrame[],
) {
  if (leftFrames.length !== rightFrames.length) return false;

  return leftFrames.every((leftFrame, index) => {
    const rightFrame = rightFrames[index];

    return (
      leftFrame.noteId === rightFrame.noteId &&
      leftFrame.left === rightFrame.left &&
      leftFrame.top === rightFrame.top &&
      leftFrame.width === rightFrame.width &&
      leftFrame.height === rightFrame.height
    );
  });
}

function isMarkdownBlockStart(line: string) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^```/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
  );
}

function parseMarkdownPreviewBlocks(markdown: string): MarkdownPreviewBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownPreviewBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const key = `markdown-block-${index}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const startLine = index;
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      blocks.push({
        kind: "code",
        key,
        startLine,
        endLine: index,
        text: codeLines.join("\n"),
      });
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        key,
        startLine: index,
        endLine: index,
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({
        kind: "rule",
        key,
        startLine: index,
        endLine: index,
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      const startLine = index;

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({
        kind: "quote",
        key,
        startLine,
        endLine: index - 1,
        text: quoteLines.join("\n"),
      });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      const startLine = index;

      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push({
        kind: "unordered-list",
        key,
        startLine,
        endLine: index - 1,
        items,
      });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const startLine = index;

      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push({
        kind: "ordered-list",
        key,
        startLine,
        endLine: index - 1,
        items,
      });
      continue;
    }

    const paragraphLines: string[] = [];
    const startLine = index;

    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({
      kind: "paragraph",
      key,
      startLine,
      endLine: index - 1,
      text: paragraphLines.join(" "),
    });
  }

  return blocks;
}

function markdownFromPreviewBlock(block: MarkdownPreviewBlock, text: string) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trimEnd());

  if (block.kind === "heading") {
    return `${"#".repeat(block.level)} ${lines.join(" ").trim() || "Untitled"}`;
  }

  if (block.kind === "quote") {
    return lines.map((line) => `> ${line}`).join("\n");
  }

  if (block.kind === "unordered-list") {
    return lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
  }

  if (block.kind === "ordered-list") {
    return lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");
  }

  if (block.kind === "code") {
    return `\`\`\`\n${text.replace(/\n+$/, "")}\n\`\`\``;
  }

  if (block.kind === "rule") {
    return "---";
  }

  return lines.join("\n").trim();
}

function replaceMarkdownBlock(markdown: string, block: MarkdownPreviewBlock, nextBlock: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nextLines = nextBlock ? nextBlock.split("\n") : [""];

  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...nextLines);

  return lines.join("\n");
}

function markEditableBlockChanged(event: FormEvent<HTMLElement>) {
  event.currentTarget.dataset.edited = "true";
}

function MarkdownPreviewBlockView({
  block,
  markdown,
  notes,
  onChange,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  block: MarkdownPreviewBlock;
  markdown: string;
  notes: SelectionNote[];
  onChange: (block: MarkdownPreviewBlock, text: string) => void;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
}) {
  const blockNotes = getNotesForPreviewBlock(markdown, block, notes);

  function commitEditableBlock(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.dataset.edited !== "true") return;

    delete event.currentTarget.dataset.edited;
    onChange(block, event.currentTarget.innerText);
  }

  const editableProps = {
    contentEditable: true,
    suppressContentEditableWarning: true,
    "data-preview-block-key": block.key,
    onBlur: commitEditableBlock,
    onInput: markEditableBlockChanged,
  };

  if (block.kind === "heading") {
    const tagName = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const textMap = getPreviewBlockTextMap(markdown, block);

    return createElement(
      tagName,
      {
        ...editableProps,
        className: "markdown-preview-editable",
      },
      renderPreviewInline(
        textMap,
        `${block.key}-heading`,
        blockNotes,
        onAnnotationClick,
        onAnnotationDoubleClick,
      ),
    );
  }

  if (block.kind === "quote") {
    return (
      <blockquote
        {...editableProps}
        className="markdown-preview-editable"
        key={block.key}
      >
        {block.text.split("\n").map((_quoteLine, quoteIndex) => (
          <p key={`${block.key}-quote-${quoteIndex}`}>
            {renderPreviewInline(
              getQuoteLineTextMap(markdown, block, quoteIndex),
              `${block.key}-quote-${quoteIndex}`,
              blockNotes,
              onAnnotationClick,
              onAnnotationDoubleClick,
            )}
          </p>
        ))}
      </blockquote>
    );
  }

  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    const ListTag = block.kind === "unordered-list" ? "ul" : "ol";

    return (
      <ListTag {...editableProps} className="markdown-preview-editable" key={block.key}>
        {block.items.map((_item, itemIndex) => (
          <li key={`${block.key}-item-${itemIndex}`}>
            {renderPreviewInline(
              getListItemTextMap(markdown, block, itemIndex),
              `${block.key}-item-${itemIndex}`,
              blockNotes,
              onAnnotationClick,
              onAnnotationDoubleClick,
            )}
          </li>
        ))}
      </ListTag>
    );
  }

  if (block.kind === "code") {
    return (
      <pre {...editableProps} className="markdown-preview-editable" key={block.key}>
        <code>
          {renderAnnotatedPlainText(
            getPreviewBlockTextMap(markdown, block),
            `${block.key}-code`,
            blockNotes,
            onAnnotationClick,
            onAnnotationDoubleClick,
          )}
        </code>
      </pre>
    );
  }

  if (block.kind === "rule") {
    return <hr data-preview-block-key={block.key} key={block.key} />;
  }

  if (block.kind === "paragraph") {
    return (
      <p {...editableProps} className="markdown-preview-editable" key={block.key}>
        {renderPreviewInline(
          getPreviewBlockTextMap(markdown, block),
          `${block.key}-paragraph`,
          blockNotes,
          onAnnotationClick,
          onAnnotationDoubleClick,
        )}
      </p>
    );
  }

  return null;
}

function MarkdownPreview({
  value,
  notes,
  onChange,
  onSelectionChange,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  value: string;
  notes: SelectionNote[];
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
}) {
  const blocks = parseMarkdownPreviewBlocks(value);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [annotationFrames, setAnnotationFrames] = useState<PreviewAnnotationFrame[]>([]);

  useLayoutEffect(() => {
    const previewElement = previewRef.current;
    if (!previewElement) return;

    let animationFrame = 0;
    const updateAnnotationFrames = () => {
      const nextFrames = measurePreviewAnnotationFrames(previewElement);

      setAnnotationFrames((currentFrames) =>
        arePreviewAnnotationFramesEqual(currentFrames, nextFrames) ? currentFrames : nextFrames,
      );
    };
    const scheduleAnnotationFrameUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateAnnotationFrames);
    };

    updateAnnotationFrames();

    const resizeObserver = new ResizeObserver(scheduleAnnotationFrameUpdate);
    resizeObserver.observe(previewElement);
    window.addEventListener("resize", scheduleAnnotationFrameUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleAnnotationFrameUpdate);
    };
  }, [notes, value]);

  function handlePreviewSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";

    if (!selection || selection.isCollapsed || !selectedText.trim()) {
      onSelectionChange(null);
      return;
    }

    onSelectionChange(makePreviewAnchor(value, selectedText));
  }

  function handlePreviewMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    handlePreviewSelection();
  }

  function updatePreviewBlock(block: MarkdownPreviewBlock, text: string) {
    const nextBlock = markdownFromPreviewBlock(block, text);
    const nextValue = replaceMarkdownBlock(value, block, nextBlock);

    onChange(nextValue, "user");
  }

  return (
    <div
      className="markdown-preview"
      ref={previewRef}
      onKeyUp={handlePreviewSelection}
      onMouseUp={handlePreviewMouseUp}
    >
      {blocks.map((block) => (
        <MarkdownPreviewBlockView
          block={block}
          key={block.key}
          markdown={value}
          notes={notes}
          onAnnotationClick={onAnnotationClick}
          onAnnotationDoubleClick={onAnnotationDoubleClick}
          onChange={updatePreviewBlock}
        />
      ))}
      <div aria-hidden="true" className="preview-annotation-layer">
        {annotationFrames.map((frame) => (
          <span
            className="preview-annotation-frame"
            key={frame.noteId}
            style={{
              height: frame.height,
              left: frame.left,
              top: frame.top,
              width: frame.width,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [workspaceTitle, setWorkspaceTitle] = useState("Scholium");
  const [workspacePath, setWorkspacePath] = useState("Workspace");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(() =>
    documentsSeed.map(workspaceEntryFromDocument),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0].id);
  const [notes, setNotes] = useState(notesSeed);
  const [pendingAnchor, setPendingAnchor] = useState<TextSelectionAnchor | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [activeNoteId, setActiveNoteId] = useState("");
  const [activeNoteMode, setActiveNoteMode] = useState<ActiveNoteMode>("view");
  const [isNotePanelClosing, setIsNotePanelClosing] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [dirtyDocumentStates, setDirtyDocumentStates] = useState<
    Record<string, DirtyDocumentState>
  >({});
  const [savedDocumentBodies, setSavedDocumentBodies] = useState<Record<string, string>>(() =>
    savedBodiesFromDocuments(documentsSeed),
  );
  const [storageError, setStorageError] = useState("");
  const [isSavingFile, setIsSavingFile] = useState(false);
  const notePanelCloseTimerRef = useRef(0);
  const pendingAnnotationOpenTimerRef = useRef(0);
  const notePanelHasContentRef = useRef(false);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];

  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const nativeStorageAvailable = hasNativeStorageAccess();
  const activeNotes = documentNotes.filter((note) => note.status === "active");
  const activeNote = documentNotes.find((note) => note.id === activeNoteId);
  const selectedDocumentIsDirty = hasDirtyState(dirtyDocumentStates[selectedDocument.id]);

  const annotations: TextAnnotation[] = activeNotes.map((note) => ({
    id: note.id,
    from: note.anchor.from,
    to: note.anchor.to,
  }));
  const pendingAnchorIsCompleteBlock = Boolean(
    pendingAnchor && isSelectionCompleteMarkdownBlock(selectedDocument.body, pendingAnchor),
  );
  const canSaveSelectionNote = Boolean(
    pendingAnchor && pendingAnchorIsCompleteBlock && noteDraft.trim(),
  );
  const activeNoteIsEditing = Boolean(activeNote && activeNoteMode === "edit");
  const canSaveActiveNote = Boolean(activeNoteIsEditing && noteDraft.trim());
  const notePanelHasContent = Boolean(pendingAnchor || activeNote);
  const notePanelShouldRender = notePanelHasContent || isNotePanelClosing;

  useEffect(() => {
    notePanelHasContentRef.current = notePanelHasContent;
  }, [notePanelHasContent]);

  useEffect(() => {
    return () => {
      window.clearTimeout(notePanelCloseTimerRef.current);
      window.clearTimeout(pendingAnnotationOpenTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let unlistenNewFile: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    let unlistenOpenFolder: (() => void) | null = null;

    void Promise.all([
      listen("scholium-new-file", () => {
        void newMarkdownFile();
      }),
      listen("scholium-open-file", () => {
        void openMarkdownFileFromPicker();
      }),
      listen("scholium-open-folder", () => {
        void openMarkdownFolder();
      }),
    ]).then(([newFileListener, openFileListener, openFolderListener]) => {
      unlistenNewFile = newFileListener;
      unlistenOpenFile = openFileListener;
      unlistenOpenFolder = openFolderListener;
    });

    return () => {
      unlistenNewFile?.();
      unlistenOpenFile?.();
      unlistenOpenFolder?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    function handleModeShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;

      event.preventDefault();
      closeNotePanel();
      setEditorMode((currentMode) => (currentMode === "preview" ? "edit" : "preview"));
    }

    window.addEventListener("keydown", handleModeShortcut);

    return () => {
      window.removeEventListener("keydown", handleModeShortcut);
    };
  }, [closeNotePanel]);

  function updateDocumentDirtyState(documentId: string, patch: Partial<DirtyDocumentState>) {
    setDirtyDocumentStates((currentStates) => {
      const currentState = currentStates[documentId] ?? { body: false, notes: false };
      const nextState = {
        ...currentState,
        ...patch,
      };
      const nextStates = { ...currentStates };

      if (hasDirtyState(nextState)) {
        nextStates[documentId] = nextState;
      } else {
        delete nextStates[documentId];
      }

      return nextStates;
    });
  }

  function markDocumentBodyDirty(documentId: string, isDirty: boolean) {
    updateDocumentDirtyState(documentId, { body: isDirty });
  }

  function markDocumentNotesDirty(documentId = selectedDocument.id) {
    updateDocumentDirtyState(documentId, { notes: true });
  }

  function markDocumentClean(documentId: string, body: string) {
    setDirtyDocumentStates((currentStates) => {
      const nextStates = { ...currentStates };
      delete nextStates[documentId];
      return nextStates;
    });
    setSavedDocumentBodies((currentBodies) => ({
      ...currentBodies,
      [documentId]: body,
    }));
  }

  function markLoadedDocumentsClean(loadedDocuments: MarkdownDocument[]) {
    const loadedDocumentIds = new Set(loadedDocuments.map((document) => document.id));

    setDirtyDocumentStates((currentStates) => {
      const nextStates = { ...currentStates };
      loadedDocumentIds.forEach((documentId) => {
        delete nextStates[documentId];
      });
      return nextStates;
    });
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies = { ...currentBodies };
      loadedDocuments.forEach((document) => {
        nextBodies[document.id] = document.body;
      });
      return nextBodies;
    });
  }

  function documentFromLoadedFile(loaded: OpenMarkdownFileResult): MarkdownDocument {
    return {
      id: loaded.path,
      title: loaded.title,
      path: loaded.path,
      filePath: loaded.path,
      notesPath: loaded.notesPath,
      updatedAt: "",
      body: loaded.body,
    };
  }

  function applyLoadedFiles(loadedFiles: OpenMarkdownFileResult[]) {
    if (loadedFiles.length === 0) {
      setStorageError("No Markdown files found in the selected folder.");
      return;
    }

    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedDocumentIds = new Set(loadedDocuments.map((document) => document.id));
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => ({
        ...note,
        documentId: loadedFile.path,
      })),
    );
    const firstDocument = loadedDocuments[0];

    setDocuments((currentDocuments) => [
      ...loadedDocuments,
      ...currentDocuments.filter((document) => !loadedDocumentIds.has(document.id)),
    ]);
    setWorkspaceEntries((currentEntries) => [
      ...loadedDocuments.map(workspaceEntryFromDocument),
      ...currentEntries.filter(
        (entry) => entry.kind !== "file" || !loadedDocumentIds.has(entry.documentId),
      ),
    ]);
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => !loadedDocumentIds.has(note.documentId)),
    ]);
    setSelectedDocumentId(firstDocument.id);
    setPendingAnchor(null);
    setNoteDraft("");
    setActiveNoteId("");
    setActiveNoteMode("view");
    clearPendingAnnotationOpenTimer();
    markLoadedDocumentsClean(loadedDocuments);
  }

  function applyOpenedDirectory(openedDirectory: OpenMarkdownDirectoryResult, selectedPath?: string) {
    const loadedFiles = openedDirectory.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : [],
    );
    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedDocumentIds = new Set(loadedDocuments.map((document) => document.id));
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => ({
        ...note,
        documentId: loadedFile.path,
      })),
    );
    const nextEntries = openedDirectory.entries.map((entry): WorkspaceEntry => {
      if (entry.kind === "directory") {
        return {
          kind: "directory",
          id: `directory:${entry.path}`,
          title: entry.title,
          path: entry.path,
        };
      }

      return workspaceEntryFromDocument(documentFromLoadedFile(entry.file));
    });
    const firstDocument = loadedDocuments[0];
    const selectedDocument = selectedPath
      ? loadedDocuments.find((document) => document.id === selectedPath)
      : firstDocument;
    const documentToSelect = selectedDocument ?? firstDocument;

    setDocuments((currentDocuments) => [
      ...loadedDocuments,
      ...currentDocuments.filter((document) => !loadedDocumentIds.has(document.id)),
    ]);
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => !loadedDocumentIds.has(note.documentId)),
    ]);
    setWorkspaceTitle(openedDirectory.title);
    setWorkspacePath(openedDirectory.path);
    setWorkspaceEntries(nextEntries);
    setPendingAnchor(null);
    setNoteDraft("");
    clearPendingAnnotationOpenTimer();
    markLoadedDocumentsClean(loadedDocuments);

    if (documentToSelect) {
      setSelectedDocumentId(documentToSelect.id);
    }
    setActiveNoteId("");
    setActiveNoteMode("view");

    if (nextEntries.length === 0) {
      setStorageError("No folders or Markdown files found in the selected folder.");
    }
  }

  async function openDirectoryPath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("");

    try {
      const openedDirectory = await invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", {
        path,
      });
      applyOpenedDirectory(openedDirectory);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMarkdownFolder() {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("");

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
      });
      if (!selectedPath || Array.isArray(selectedPath)) return;

      await openDirectoryPath(selectedPath);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMarkdownFileFromPicker() {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("Opening file...");

    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: markdownFilters,
      });
      if (!selectedPath || Array.isArray(selectedPath)) {
        setStorageError("");
        return;
      }

      const context = await invoke<OpenMarkdownFileContextResult>("open_markdown_file_context", {
        path: selectedPath,
      });
      const selectedFileEntryExists = context.directory.entries.some(
        (entry) => entry.kind === "file" && entry.file.path === context.selectedFile.path,
      );
      const directory = selectedFileEntryExists
        ? context.directory
        : {
            ...context.directory,
            entries: [
              ...context.directory.entries,
              {
                kind: "file" as const,
                path: context.selectedFile.path,
                title: context.selectedFile.title,
                file: context.selectedFile,
              },
            ],
          };

      applyOpenedDirectory(directory, context.selectedFile.path);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function newMarkdownFile() {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setIsSavingFile(true);
    setStorageError("");

    try {
      const selectedPath = await save({
        defaultPath: "Untitled.md",
        filters: markdownFilters,
      });
      if (!selectedPath) return;

      const path = ensureMarkdownExtension(selectedPath);
      const body = "# Untitled\n";
      const saved = await invoke<SaveMarkdownFileResult>("save_markdown_file", {
        path,
        body,
        notes: [],
      });
      const loaded = await invoke<OpenMarkdownFileResult>("open_markdown_file", {
        path: saved.path,
      });

      applyLoadedFiles([loaded]);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingFile(false);
    }
  }

  async function saveSelectedDocument() {
    if (!selectedDocument.filePath) {
      setStorageError("This document is sample content. Open a local .md file before saving.");
      return;
    }
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setIsSavingFile(true);
    setStorageError("");

    try {
      const saved = await invoke<SaveMarkdownFileResult>("save_markdown_file", {
        path: selectedDocument.filePath,
        body: selectedDocument.body,
        notes: notes.filter((note) => note.documentId === selectedDocument.id),
      });

      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === selectedDocument.id
            ? {
                ...document,
                path: saved.path,
                notesPath: saved.notesPath,
                updatedAt: `Saved ${nowLabel()}`,
              }
            : document,
        ),
      );
      markDocumentClean(selectedDocument.id, selectedDocument.body);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingFile(false);
    }
  }

  function updateSelectedDocumentBody(body: string, source: EditorChangeSource) {
    if (body === selectedDocument.body) return;

    const documentId = selectedDocument.id;
    const savedBody = savedDocumentBodies[documentId] ?? selectedDocument.body;

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === documentId ? { ...document, body } : document,
      ),
    );
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.documentId === documentId ? reconcileNote(note, body) : note,
      ),
    );
    markDocumentBodyDirty(documentId, !(source === "undo" && body === savedBody));
  }

  function selectDocument(documentId: string) {
    const nextDocument = documents.find((document) => document.id === documentId);
    if (!nextDocument) return;

    setSelectedDocumentId(documentId);
    setPendingAnchor(null);
    setNoteDraft("");
    setStorageError("");
    setActiveNoteId("");
    setActiveNoteMode("view");
    clearPendingAnnotationOpenTimer();
  }

  function clearPendingAnnotationOpenTimer() {
    window.clearTimeout(pendingAnnotationOpenTimerRef.current);
    pendingAnnotationOpenTimerRef.current = 0;
  }

  function clearNotePanelCloseTimer() {
    window.clearTimeout(notePanelCloseTimerRef.current);
    notePanelCloseTimerRef.current = 0;
  }

  function closeNotePanel() {
    clearPendingAnnotationOpenTimer();
    clearNotePanelCloseTimer();

    if (!notePanelHasContentRef.current) {
      setIsNotePanelClosing(false);
      return;
    }

    setIsNotePanelClosing(true);
    notePanelCloseTimerRef.current = window.setTimeout(() => {
      setPendingAnchor(null);
      setActiveNoteId("");
      setActiveNoteMode("view");
      setNoteDraft("");
      setIsNotePanelClosing(false);
      notePanelHasContentRef.current = false;
      notePanelCloseTimerRef.current = 0;
    }, bottomNotePanelAnimationMs);
  }

  function handleSelectionChange(anchor: TextSelectionAnchor | null) {
    if (!anchor) {
      if (pendingAnchor) {
        closeNotePanel();
      }
      return;
    }

    clearPendingAnnotationOpenTimer();
    clearNotePanelCloseTimer();
    setIsNotePanelClosing(false);
    setPendingAnchor(anchor);
    setActiveNoteId("");
    setActiveNoteMode("view");
    setNoteDraft("");
    notePanelHasContentRef.current = true;
  }

  function showNoteViewer(noteId: string) {
    const note = notes.find((candidate) => candidate.id === noteId && candidate.status !== "deleted");
    if (!note) return;

    clearNotePanelCloseTimer();
    setIsNotePanelClosing(false);
    setPendingAnchor(null);
    setActiveNoteId(noteId);
    setActiveNoteMode("view");
    setNoteDraft(note.body);
    notePanelHasContentRef.current = true;
  }

  function scheduleNoteViewer(noteId: string) {
    clearPendingAnnotationOpenTimer();
    pendingAnnotationOpenTimerRef.current = window.setTimeout(() => {
      showNoteViewer(noteId);
      pendingAnnotationOpenTimerRef.current = 0;
    }, annotationOpenDelayMs);
  }

  function openNoteEditor(noteId: string) {
    const note = notes.find((candidate) => candidate.id === noteId && candidate.status !== "deleted");
    if (!note) return;

    clearPendingAnnotationOpenTimer();
    clearNotePanelCloseTimer();
    setIsNotePanelClosing(false);
    setPendingAnchor(null);
    setActiveNoteId(noteId);
    setActiveNoteMode("edit");
    setNoteDraft(note.body);
    notePanelHasContentRef.current = true;
  }

  function createNoteFromSelection() {
    const body = noteDraft.trim();
    if (!canSaveSelectionNote || !pendingAnchor) return;

    const note: SelectionNote = {
      id: crypto.randomUUID(),
      documentId: selectedDocument.id,
      status: "active",
      selectedText: pendingAnchor.selectedText,
      anchor: pendingAnchor,
      body,
      createdAt: nowLabel(),
      updatedAt: nowLabel(),
      deletedAt: null,
    };

    setNotes((currentNotes) => [note, ...currentNotes]);
    closeNotePanel();
    markDocumentNotesDirty();
  }

  function saveActiveNote() {
    if (!activeNote || !canSaveActiveNote) return;

    updateNoteBody(activeNote.id, noteDraft.trim());
    closeNotePanel();
  }

  function updateNoteBody(noteId: string, body: string) {
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              body,
              updatedAt: nowLabel(),
            }
          : note,
      ),
    );
    markDocumentNotesDirty();
  }

  function deleteNote(noteId: string) {
    clearNotePanelCloseTimer();
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              status: "deleted",
              deletedAt: new Date().toISOString(),
              updatedAt: nowLabel(),
            }
          : note,
      ),
    );
    if (activeNoteId === noteId) {
      setPendingAnchor(null);
      setActiveNoteId("");
      setActiveNoteMode("view");
      setNoteDraft("");
      setIsNotePanelClosing(false);
      notePanelHasContentRef.current = false;
    }
    markDocumentNotesDirty();
  }

  function togglePreviewMode() {
    clearPendingAnnotationOpenTimer();
    closeNotePanel();
    setEditorMode((currentMode) => (currentMode === "preview" ? "edit" : "preview"));
  }

  return (
    <main className={`scholium-shell ${notePanelShouldRender ? "has-bottom-note-panel" : ""}`}>
      <aside className="document-pane" aria-label="Documents">
        <div className="pane-header">
          <div>
            <p className="eyebrow">{workspacePath}</p>
            <h1>{workspaceTitle}</h1>
          </div>
        </div>

        <div className="document-list">
          {workspaceEntries.map((entry) => {
            const isSelected = entry.kind === "file" && entry.documentId === selectedDocument.id;

            return (
              <button
                className={`document-row ${entry.kind === "directory" ? "is-folder" : ""} ${
                  isSelected ? "is-selected" : ""
                }`}
                key={entry.id}
                onClick={() => {
                  if (entry.kind === "directory") {
                    void openDirectoryPath(entry.path);
                    return;
                  }

                  selectDocument(entry.documentId);
                }}
                type="button"
              >
                <span className="document-icon" aria-hidden="true" />
                <span className="document-title">{entry.title}</span>
              </button>
            );
          })}
        </div>

        {storageError ? <p className="storage-error">{storageError}</p> : null}
      </aside>

      <section className="editor-pane" aria-label="Markdown editor">
        <header className="editor-header">
          <div>
            <p className="eyebrow">{selectedDocument.path}</p>
            <h2>{selectedDocument.title}</h2>
          </div>
          <div className="editor-actions" aria-label="Editor actions">
            <span className={`save-state ${selectedDocumentIsDirty ? "is-dirty" : ""}`}>
              {selectedDocumentIsDirty ? "Unsaved" : "Saved"}
            </span>
            <button
              className={editorMode === "preview" ? "is-active" : ""}
              type="button"
              aria-pressed={editorMode === "preview"}
              onClick={togglePreviewMode}
              title="Toggle Source/Preview (Cmd/Ctrl+Shift+P)"
            >
              {editorMode === "preview" ? "Source" : "Preview"}
            </button>
            <button
              type="button"
              onClick={saveSelectedDocument}
              disabled={!selectedDocument.filePath || !selectedDocumentIsDirty || isSavingFile}
            >
              {isSavingFile ? "Saving" : "Save"}
            </button>
          </div>
        </header>

        <div className="editor-grid">
          <div className="editor-surface">
            {editorMode === "preview" ? (
              <MarkdownPreview
                notes={activeNotes}
                value={selectedDocument.body}
                onAnnotationClick={scheduleNoteViewer}
                onAnnotationDoubleClick={openNoteEditor}
                onChange={updateSelectedDocumentBody}
                onSelectionChange={handleSelectionChange}
              />
            ) : (
              <MarkdownEditor
                annotations={annotations}
                value={selectedDocument.body}
                onAnnotationClick={scheduleNoteViewer}
                onAnnotationDoubleClick={openNoteEditor}
                onChange={updateSelectedDocumentBody}
                onSelectionChange={handleSelectionChange}
              />
            )}
          </div>
        </div>
      </section>

      {notePanelShouldRender ? (
        <section
          className={`bottom-note-panel ${isNotePanelClosing ? "is-closing" : "is-open"}`}
          aria-label={
            activeNote
              ? activeNoteIsEditing
                ? "Edit selection note"
                : "View selection note"
              : "Create selection note"
          }
        >
          <div className="bottom-note-card">
            <div className="bottom-note-context">
              <p className="eyebrow">
                {activeNote ? (activeNoteIsEditing ? "Edit note" : "Note") : "Selection note"}
              </p>
              {pendingAnchor && !pendingAnchorIsCompleteBlock ? (
                <p className="selection-warning">請選取完整段落後再新增筆記。</p>
              ) : null}
            </div>

            {activeNote && !activeNoteIsEditing ? (
              <p className="bottom-note-body">{activeNote.body}</p>
            ) : null}

            {activeNoteIsEditing || pendingAnchorIsCompleteBlock ? (
              <textarea
                aria-label={activeNoteIsEditing ? "Edit note" : "Selection note"}
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.currentTarget.value)}
                placeholder="Add a note..."
              />
            ) : null}

            <div className="note-actions bottom-note-actions">
              {activeNote && activeNoteIsEditing ? (
                <button
                  className="is-danger"
                  type="button"
                  onClick={() => deleteNote(activeNote.id)}
                >
                  Delete
                </button>
              ) : null}
              <button type="button" onClick={closeNotePanel}>
                {activeNote && !activeNoteIsEditing ? "Close" : "Cancel"}
              </button>
              {activeNote && activeNoteIsEditing ? (
                <button
                  className="is-primary"
                  type="button"
                  onClick={saveActiveNote}
                  disabled={!canSaveActiveNote}
                >
                  Done
                </button>
              ) : pendingAnchor ? (
                <button
                  className="is-primary"
                  type="button"
                  onClick={createNoteFromSelection}
                  disabled={!canSaveSelectionNote}
                >
                  Save note
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
