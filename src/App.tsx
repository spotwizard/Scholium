import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  createElement,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./App.css";
import { MilkdownMarkdownEditor } from "./MilkdownMarkdownEditor";
import {
  MarkdownEditor,
  type AnnotationTone,
  type EditorChangeSource,
  type TextAnnotation,
  type TextSelectionAnchor,
} from "./MarkdownEditor";
import dictionaryRestIcon from "./assets/dictionary-rest.svg";
import dictionarySelectedIcon from "./assets/dictionary-selected.svg";
import fileGlyphSvg from "./assets/file-glyph.svg?raw";
import folderGlyphSvg from "./assets/folder-glyph.svg?raw";
import noteLibraryRestIcon from "./assets/note-library-rest.svg";
import noteLibrarySelectedIcon from "./assets/note-library-selected.svg";
import notebookRestIcon from "./assets/notebook-rest.svg";
import notebookSelectedIcon from "./assets/notebook-selected.svg";
import { loadScholiumMermaid } from "./mermaid";

const unorderedListMarkerPattern = /^ {0,3}[-*+]\s+/;
const typedUnorderedListMarkerPattern = /^[-*+]\s+(.*)$/;
const orderedListMarkerPattern = /^ {0,3}\d+[.)]\s+/;
const typedOrderedListMarkerPattern = /^\d+[.)]\s+(.*)$/;
const emptyPreviewListItemText = "\u200b";
const annotationClickDelayMs = 500;
const pendingAnchorAnnotationId = "__scholium_pending_anchor__";

type NoteStatus = "active" | "orphaned" | "deleted";
type AnnotationKind = "note" | "glossary";

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
  tone?: AnnotationTone;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type GlossaryTerm = {
  id: string;
  term: string;
  normalizedTerm: string;
  definition: string;
  createdAt: string;
  updatedAt: string;
};

type GlossaryBinding = {
  id: string;
  documentId: string;
  termId: string;
  term: string;
  normalizedTerm: string;
  status: NoteStatus;
  anchor: TextSelectionAnchor;
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
  glossaryTerms?: GlossaryTerm[];
  glossaryBindings?: GlossaryBinding[];
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
  parentPath: string | null;
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

type DeleteMarkdownFileResult = {
  path: string;
  notesPath: string;
};

type WorkspaceEntry =
  | {
      kind: "parent-directory";
      id: string;
      title: string;
      path: string;
    }
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

type NativeLocationKind = "directory" | "file";

type NativeLocation = {
  kind: NativeLocationKind;
  path: string;
  title: string;
};

type OpenLocationEventPayload = {
  kind: NativeLocationKind;
  path: string;
};

type DirtyDocumentState = {
  body: boolean;
  notes: boolean;
};

const emptyDocument: MarkdownDocument = {
  id: "__empty__",
  title: "",
  path: "",
  filePath: null,
  notesPath: null,
  updatedAt: "",
  body: "",
};

type EditorMode = "edit" | "preview";
type ActiveNoteMode = "view" | "edit";

type PreviewAnnotationFrame = {
  frameKey: string;
  isFocusTarget?: boolean;
  kind: AnnotationKind;
  noteId: string;
  tone: AnnotationTone;
  left: number;
  top: number;
  width: number;
  height: number;
};

type TextRangeRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  targetBottom: number;
  targetTop: number;
  targetX: number;
  targetY: number;
  top: number;
  width: number;
};

type SelectionWarningPosition = {
  left: number;
  top: number;
};

type FileContextMenuState = {
  documentId: string;
  left: number;
  top: number;
};

function DocumentGlyphIcon({ kind }: { kind: "file" | "folder" }) {
  return (
    <span
      aria-hidden="true"
      className="document-icon"
      dangerouslySetInnerHTML={{ __html: kind === "folder" ? folderGlyphSvg : fileGlyphSvg }}
    />
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2" />
      <path d="m19 6-1 14c-.1 1.1-1 2-2.1 2H8.1c-1.1 0-2-.9-2.1-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M8 7h10v13H8z" />
      <path d="M5 17H4V4h10v1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M8 8h10v12H8z" />
      <path d="M6 16H4V4h10v2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L17.5 5.5a2.1 2.1 0 0 0-3 0L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

type FloatingNotePosition = {
  connector: {
    angle: number;
    left: number;
    top: number;
    width: number;
  } | null;
  left: number;
  top: number;
  maxHeight: number;
  placement: "above" | "below" | "detached";
};

type PreviewTextMap = {
  text: string;
  sourceOffsets: Array<number | null>;
};

type PreviewAnnotationTextRange = {
  annotation: TextRangeAnnotation;
  start: number;
  end: number;
};

type TextRangeAnnotation = {
  id: string;
  isFocusTarget?: boolean;
  kind: AnnotationKind;
  status: NoteStatus;
  anchor: TextSelectionAnchor;
  tone?: AnnotationTone;
};

type BodyAnchorTransform = (
  anchor: TextSelectionAnchor,
  nextBody: string,
) => TextSelectionAnchor;

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
      info: string;
      language: string;
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
const previewAnnotationLineJoinMaxGap = 20;
const notePanelAnimationMs = 180;
const autosaveDelayMs = 1000;
const lastOpenedMarkdownPathStorageKey = "scholium:last-opened-markdown-path";
const mobileViewportQuery = "(max-width: 820px)";

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

const glossaryTermsSeed: GlossaryTerm[] = [
  {
    id: "glossary-1",
    term: "Markdown",
    normalizedTerm: "markdown",
    definition: "A lightweight plain-text markup format used for readable writing and publishing.",
    createdAt: "10:30",
    updatedAt: "10:30",
  },
];

const glossaryBindingsSeed: GlossaryBinding[] = [
  {
    id: "glossary-binding-1",
    documentId: "roadmap",
    termId: "glossary-1",
    term: "Markdown",
    normalizedTerm: "markdown",
    status: "active",
    anchor: makeAnchor(documentsSeed[0].body, "Markdown"),
    createdAt: "10:30",
    updatedAt: "10:30",
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

function hasRenderableAnchor(anchor: TextSelectionAnchor) {
  return anchor.to > anchor.from;
}

function assignAnnotationTones(annotations: TextRangeAnnotation[]): TextRangeAnnotation[] {
  let noteToneIndex = 0;

  return [...annotations]
    .sort(
      (left, right) =>
        left.anchor.from - right.anchor.from ||
        left.anchor.to - right.anchor.to ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    )
    .map((annotation) => {
      if (annotation.kind !== "note") {
        return {
          ...annotation,
          tone: 0 as AnnotationTone,
        };
      }

      const tone = (noteToneIndex % 2) as AnnotationTone;
      noteToneIndex += 1;

      return {
        ...annotation,
        tone,
      };
    });
}

const glossaryTokenNormalizationOverrides: Record<string, string> = {
  commited: "commit",
  commiting: "commit",
  committed: "commit",
  committing: "commit",
};

function normalizeGlossaryTerm(term: string) {
  return term
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .map(normalizeGlossaryToken)
    .join(" ");
}

function normalizeGlossaryToken(token: string) {
  const normalized = token.toLowerCase();
  if (!/^[a-z]+$/.test(normalized) || normalized.length <= 3) return normalized;

  const override = glossaryTokenNormalizationOverrides[normalized];
  if (override) return override;

  if (normalized.endsWith("ies") && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }

  if (normalized.endsWith("ing") && normalized.length > 5) {
    return normalizeDoubledFinalConsonant(normalized.slice(0, -3));
  }

  if (normalized.endsWith("ed") && normalized.length > 4) {
    return normalizeDoubledFinalConsonant(normalized.slice(0, -2));
  }

  if (/(ches|shes|sses|xes|zes)$/.test(normalized) && normalized.length > 4) {
    return normalized.slice(0, -2);
  }

  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 4) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function normalizeDoubledFinalConsonant(token: string) {
  if (/(bb|dd|ff|gg|ll|mm|nn|pp|rr|tt)$/.test(token)) {
    return token.slice(0, -1);
  }

  return token;
}

function glossaryTermWordCount(term: string) {
  const normalizedTerm = term.replace(/\s+/g, " ").trim();
  if (!normalizedTerm) return 0;

  return normalizedTerm.split(" ").length;
}

function isGlossarySelectionCandidate(anchor: TextSelectionAnchor) {
  const normalizedTerm = anchor.selectedText.replace(/\s+/g, " ").trim();
  const wordCount = glossaryTermWordCount(normalizedTerm);

  return (
    wordCount >= 1 &&
    wordCount <= 3 &&
    !/[\r\n]/.test(anchor.selectedText) &&
    !/[.!?。！？,，;；:：]$/.test(normalizedTerm)
  );
}

function selectionOverlapsNote(anchor: TextSelectionAnchor, note: SelectionNote) {
  return anchor.to > note.anchor.from && anchor.from < note.anchor.to;
}

function selectionOverlapsGlossaryBinding(anchor: TextSelectionAnchor, binding: GlossaryBinding) {
  return anchor.to > binding.anchor.from && anchor.from < binding.anchor.to;
}

function textSelectionAnchorsMatch(left: TextSelectionAnchor, right: TextSelectionAnchor) {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.selectedText.replace(/\s+/g, " ").trim() ===
      right.selectedText.replace(/\s+/g, " ").trim()
  );
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

function mergeGlossaryTerms(incomingTerms: GlossaryTerm[], currentTerms: GlossaryTerm[]) {
  const termsById = new Map<string, GlossaryTerm>();

  currentTerms.forEach((term) => termsById.set(term.id, term));
  incomingTerms.forEach((term) => termsById.set(term.id, term));

  return Array.from(termsById.values());
}

function selectionNoteHasContent(note: SelectionNote | null | undefined) {
  return Boolean(note?.body.trim());
}

function glossaryTermHasContent(term: GlossaryTerm | null | undefined): term is GlossaryTerm {
  return Boolean(term?.definition.trim());
}

function readLastOpenedMarkdownPath() {
  try {
    return window.localStorage.getItem(lastOpenedMarkdownPathStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberLastOpenedMarkdownPath(path: string | null | undefined) {
  if (!path) return;

  try {
    window.localStorage.setItem(lastOpenedMarkdownPathStorageKey, path);
  } catch {
    // Remembering the last file is best-effort only.
  }
}

function forgetLastOpenedMarkdownPath() {
  try {
    window.localStorage.removeItem(lastOpenedMarkdownPathStorageKey);
  } catch {
    // Remembering the last file is best-effort only.
  }
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

function previousNonWhitespaceIndex(text: string, from: number, to: number) {
  for (let index = Math.min(to, text.length) - 1; index >= Math.max(0, from); index -= 1) {
    if (!/\s/.test(text[index])) return index;
  }

  return null;
}

function isSentenceEndingCharacter(character: string) {
  return /[.!?。！？]/.test(character);
}

function isSelectionCompleteSentenceSpan(
  markdown: string,
  selection: ReturnType<typeof trimRange>,
  semanticRange: ReturnType<typeof trimRange>,
) {
  const selectedLastIndex = previousNonWhitespaceIndex(markdown, selection.from, selection.to);
  if (selectedLastIndex === null || !isSentenceEndingCharacter(markdown[selectedLastIndex])) {
    return false;
  }

  const previousContentIndex = previousNonWhitespaceIndex(
    markdown,
    semanticRange.from,
    selection.from,
  );
  const startsAtSentenceBoundary =
    previousContentIndex === null || isSentenceEndingCharacter(markdown[previousContentIndex]);

  return startsAtSentenceBoundary;
}

function getListItemSemanticRanges(
  markdown: string,
  block: Extract<MarkdownPreviewBlock, { kind: "unordered-list" | "ordered-list" }>,
) {
  return block.items
    .map((_item, itemIndex) => {
      const textMap = getListItemTextMap(markdown, block, itemIndex);
      const sourceOffsets = textMap.sourceOffsets.filter(
        (sourceOffset): sourceOffset is number => sourceOffset !== null,
      );
      if (sourceOffsets.length === 0) return null;

      return trimRange(
        markdown,
        Math.min(...sourceOffsets),
        Math.max(...sourceOffsets) + 1,
      );
    })
    .filter((range): range is ReturnType<typeof trimRange> => Boolean(range));
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

  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    const itemRanges = getListItemSemanticRanges(markdown, block);

    if (itemRanges.length === 0) return trimRange(markdown, blockRange.start, blockRange.end);

    return trimRange(
      markdown,
      Math.min(...itemRanges.map((range) => range.from)),
      Math.max(...itemRanges.map((range) => range.to)),
    );
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
      ? line.match(unorderedListMarkerPattern)?.[0] ?? ""
      : line.match(orderedListMarkerPattern)?.[0] ?? "";
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

function normalizeSelectionTextForComparison(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function selectionCoversListItems(
  markdown: string,
  anchor: TextSelectionAnchor,
  itemRanges: ReturnType<typeof trimRange>[],
) {
  const selectedText = normalizeSelectionTextForComparison(anchor.selectedText);
  const itemText = normalizeSelectionTextForComparison(
    itemRanges.map((itemRange) => markdown.slice(itemRange.from, itemRange.to).trim()).join(" "),
  );

  return Boolean(itemText && selectedText.length >= itemText.length * 0.9);
}

function selectionRangeCoversTrimmedRange(
  selection: ReturnType<typeof trimRange>,
  range: ReturnType<typeof trimRange>,
  boundaryTolerance = 0,
) {
  return (
    selection.from <= range.from + boundaryTolerance &&
    selection.to >= range.to - boundaryTolerance
  );
}

function blockIsList(
  block: MarkdownPreviewBlock,
): block is Extract<MarkdownPreviewBlock, { kind: "unordered-list" | "ordered-list" }> {
  return block.kind === "unordered-list" || block.kind === "ordered-list";
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

  if (intersectedBlocks.length > 1) {
    return true;
  }

  return intersectedBlocks.every(({ block, semanticRange }) => {
    if (!semanticRange) return true;

    if (selection.from <= semanticRange.from && selection.to >= semanticRange.to) {
      return true;
    }

    if (blockIsList(block)) {
      const intersectedItemRanges = getListItemSemanticRanges(markdown, block).filter(
        (itemRange) => selection.to > itemRange.from && selection.from < itemRange.to,
      );

      if (intersectedItemRanges.length === 0) return true;

      if (
        intersectedItemRanges.length > 1 &&
        (intersectedItemRanges.every((itemRange) =>
          selectionRangeCoversTrimmedRange(selection, itemRange, 1),
        ) ||
          selectionCoversListItems(markdown, anchor, intersectedItemRanges))
      ) {
        return true;
      }

      return intersectedItemRanges.every((itemRange) => {
        if (selectionRangeCoversTrimmedRange(selection, itemRange)) {
          return true;
        }

        const itemSelection = trimRange(
          markdown,
          Math.max(selection.from, itemRange.from),
          Math.min(selection.to, itemRange.to),
        );

        return isSelectionCompleteSentenceSpan(markdown, itemSelection, itemRange);
      });
    }

    return (
      block.kind === "paragraph" &&
      isSelectionCompleteSentenceSpan(markdown, selection, semanticRange)
    );
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

function closestPreviewBlockElement(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;

  return element?.closest<HTMLElement>("[data-preview-block-key]") ?? null;
}

function findTextIndices(text: string, query: string) {
  const indices: number[] = [];
  if (!query) return indices;

  let index = text.indexOf(query);
  while (index >= 0) {
    indices.push(index);
    index = text.indexOf(query, index + query.length);
  }

  return indices;
}

function closestTextIndex(indices: number[], approximateStart: number) {
  if (indices.length === 0) return -1;

  return indices.reduce((closestIndex, index) =>
    Math.abs(index - approximateStart) < Math.abs(closestIndex - approximateStart)
      ? index
      : closestIndex,
  );
}

function makePreviewAnchorFromTextMap(
  body: string,
  textMap: PreviewTextMap,
  selectedText: string,
  approximateStart: number,
) {
  const exactSelection = selectedText.trim();
  const normalizedSelection = selectedText.replace(/\s+/g, " ").trim();
  if (!normalizedSelection) return null;

  const exactIndex = closestTextIndex(findTextIndices(textMap.text, exactSelection), approximateStart);
  if (exactIndex >= 0) {
    const sourceRange = sourceRangeFromTextMapMatch(
      textMap,
      exactIndex,
      exactIndex + exactSelection.length,
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

  const normalizedTextMap = normalizeTextMapForMatch(textMap);
  const normalizedIndex = closestTextIndex(
    findTextIndices(normalizedTextMap.text, normalizedSelection),
    approximateStart,
  );
  if (normalizedIndex < 0) return null;

  const sourceRange = sourceRangeFromTextMapMatch(
    normalizedTextMap,
    normalizedIndex,
    normalizedIndex + normalizedSelection.length,
  );
  if (!sourceRange) return null;

  return makeAnchorFromRange(
    body,
    sourceRange.from,
    sourceRange.to,
    body.slice(sourceRange.from, sourceRange.to),
  );
}

function makePreviewAnchorFromSelection(
  body: string,
  blocks: MarkdownPreviewBlock[],
  previewElement: HTMLElement,
  selection: Selection,
) {
  const selectedText = selection.toString();
  if (!selectedText.trim() || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (
    !previewElement.contains(range.startContainer) ||
    !previewElement.contains(range.endContainer)
  ) {
    return null;
  }

  const startBlockElement = closestPreviewBlockElement(range.startContainer);
  const endBlockElement = closestPreviewBlockElement(range.endContainer);

  if (startBlockElement && startBlockElement === endBlockElement) {
    const blockKey = startBlockElement.dataset.previewBlockKey;
    const block = blocks.find((candidate) => candidate.key === blockKey);

    if (block) {
      const leadingRange = range.cloneRange();
      leadingRange.selectNodeContents(startBlockElement);
      leadingRange.setEnd(range.startContainer, range.startOffset);

      return makePreviewAnchorFromTextMap(
        body,
        getPreviewBlockTextMap(body, block),
        selectedText,
        leadingRange.toString().length,
      );
    }
  }

  return makePreviewAnchor(body, selectedText);
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

function getAnnotationsForPreviewBlock(
  markdown: string,
  block: MarkdownPreviewBlock,
  annotations: TextRangeAnnotation[],
) {
  const blockRange = getBlockRange(markdown, block);

  return annotations.filter(
    (annotation) =>
      annotation.status === "active" &&
      annotation.anchor.to > blockRange.start &&
      annotation.anchor.from < blockRange.end,
  );
}

function getAnnotationRangesForTextMap(
  textMap: PreviewTextMap,
  annotations: TextRangeAnnotation[],
) {
  const ranges: PreviewAnnotationTextRange[] = [];

  annotations.forEach((annotation) => {
    let rangeStart: number | null = null;

    textMap.sourceOffsets.forEach((sourceOffset, index) => {
      const isMarked =
        sourceOffset !== null &&
        sourceOffset >= annotation.anchor.from &&
        sourceOffset < annotation.anchor.to;

      if (isMarked && rangeStart === null) {
        rangeStart = index;
      }

      if (!isMarked && rangeStart !== null) {
        ranges.push({ annotation, start: rangeStart, end: index });
        rangeStart = null;
      }
    });

    if (rangeStart !== null) {
      ranges.push({ annotation, start: rangeStart, end: textMap.text.length });
    }
  });

  return ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function annotationKindLayer(kind: AnnotationKind | undefined) {
  return kind === "glossary" ? 1 : 0;
}

function sortAnnotationRangesForNesting(
  left: PreviewAnnotationTextRange,
  right: PreviewAnnotationTextRange,
) {
  return (
    left.start - right.start ||
    right.end - left.end ||
    annotationKindLayer(left.annotation.kind) - annotationKindLayer(right.annotation.kind) ||
    left.annotation.id.localeCompare(right.annotation.id)
  );
}

function renderAnnotationSpan(
  range: PreviewAnnotationTextRange,
  key: string,
  children: ReactNode,
  onAnnotationClick: (annotationId: string) => void,
  onAnnotationDoubleClick: (annotationId: string) => void,
) {
  return (
    <span
      className={`preview-note-annotation ${
        range.annotation.isFocusTarget ? "is-focus-target" : ""
      }`}
      data-annotation-kind={range.annotation.kind}
      data-focus-target={range.annotation.isFocusTarget ? "true" : "false"}
      data-note-id={range.annotation.id}
      data-note-tone={range.annotation.tone ?? 0}
      key={key}
      onClick={(event) => {
        if (window.getSelection()?.toString().trim()) return;
        if (event.detail >= 2) return;

        event.stopPropagation();
        onAnnotationClick(range.annotation.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onAnnotationDoubleClick(range.annotation.id);
      }}
    >
      {children}
    </span>
  );
}

function renderAnnotatedTextFragments(
  textMap: PreviewTextMap,
  keyPrefix: string,
  annotations: TextRangeAnnotation[],
  onAnnotationClick: (annotationId: string) => void,
  onAnnotationDoubleClick: (annotationId: string) => void,
  renderTextFragment: (text: string, keyPrefix: string) => ReactNode[],
) {
  const ranges = getAnnotationRangesForTextMap(textMap, annotations);
  const nodes: ReactNode[] = [];

  if (ranges.length === 0) {
    return renderTextFragment(textMap.text, keyPrefix);
  }

  const boundaries = Array.from(
    new Set(
      [0, textMap.text.length].concat(
        ranges.flatMap((range) => [
          clampNumber(range.start, 0, textMap.text.length),
          clampNumber(range.end, 0, textMap.text.length),
        ]),
      ),
    ),
  ).sort((left, right) => left - right);

  boundaries.slice(0, -1).forEach((start, segmentIndex) => {
    const end = boundaries[segmentIndex + 1];
    if (end <= start) return;

    const segmentText = textMap.text.slice(start, end);
    const segmentContent = renderTextFragment(
      segmentText,
      `${keyPrefix}-segment-${segmentIndex}`,
    );
    const coveringRanges = ranges
      .filter((range) => range.start <= start && range.end >= end)
      .sort(sortAnnotationRangesForNesting);

    if (coveringRanges.length === 0) {
      nodes.push(...segmentContent);
      return;
    }

    const annotatedSegment = coveringRanges.reduceRight<ReactNode>(
      (children, range, depthIndex) =>
        renderAnnotationSpan(
          range,
          `${keyPrefix}-annotation-${segmentIndex}-${depthIndex}-${range.annotation.id}`,
          children,
          onAnnotationClick,
          onAnnotationDoubleClick,
        ),
      segmentContent,
    );

    nodes.push(annotatedSegment);
  });

  return nodes;
}

function renderAnnotatedPlainText(
  textMap: PreviewTextMap,
  keyPrefix: string,
  annotations: TextRangeAnnotation[],
  onAnnotationClick: (annotationId: string) => void,
  onAnnotationDoubleClick: (annotationId: string) => void,
) {
  return renderAnnotatedTextFragments(
    textMap,
    keyPrefix,
    annotations,
    onAnnotationClick,
    onAnnotationDoubleClick,
    (text) => [text],
  );
}

function renderPreviewInline(
  textMap: PreviewTextMap,
  keyPrefix: string,
  annotations: TextRangeAnnotation[],
  onAnnotationClick: (annotationId: string) => void,
  onAnnotationDoubleClick: (annotationId: string) => void,
) {
  if (annotations.length === 0) {
    return renderInlineMarkdown(textMap.text, keyPrefix);
  }

  return renderAnnotatedTextFragments(
    textMap,
    keyPrefix,
    annotations,
    onAnnotationClick,
    onAnnotationDoubleClick,
    renderInlineMarkdown,
  );
}

function isMermaidLanguage(language: string) {
  return language.toLowerCase() === "mermaid";
}

function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId();
  const diagramId = `scholium-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [renderState, setRenderState] = useState<
    | { status: "rendering"; svg: ""; error: "" }
    | { status: "rendered"; svg: string; error: "" }
    | { status: "error"; svg: ""; error: string }
  >({ status: "rendering", svg: "", error: "" });

  useEffect(() => {
    const trimmedDefinition = definition.trim();
    let cancelled = false;

    if (!trimmedDefinition) {
      setRenderState({
        status: "error",
        svg: "",
        error: "Mermaid diagram is empty.",
      });
      return;
    }

    setRenderState({ status: "rendering", svg: "", error: "" });

    async function renderDiagram() {
      try {
        const mermaid = await loadScholiumMermaid();
        const { svg } = await mermaid.render(diagramId, trimmedDefinition);

        if (!cancelled) {
          setRenderState({ status: "rendered", svg, error: "" });
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState({
            status: "error",
            svg: "",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [definition, diagramId]);

  return (
    <figure className="mermaid-diagram">
      {renderState.status === "rendered" ? (
        <div
          className="mermaid-diagram__svg"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      ) : renderState.status === "error" ? (
        <pre className="mermaid-diagram__error">{renderState.error}</pre>
      ) : (
        <div className="mermaid-diagram__loading">Rendering diagram...</div>
      )}
    </figure>
  );
}

function roundPreviewFrameValue(value: number) {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function measurePreviewAnnotationFrames(container: HTMLDivElement): PreviewAnnotationFrame[] {
  const containerRect = container.getBoundingClientRect();
  const frames: PreviewAnnotationFrame[] = [];

  function frameFromBounds(
    noteId: string,
    frameKey: string,
    isFocusTarget: boolean,
    kind: AnnotationKind,
    tone: AnnotationTone,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): PreviewAnnotationFrame {
    return {
      frameKey,
      isFocusTarget,
      kind,
      noteId,
      tone,
      left: roundPreviewFrameValue(
        Math.max(
          0,
          left - containerRect.left + container.scrollLeft,
        ),
      ),
      top: roundPreviewFrameValue(
        Math.max(
          0,
          top - containerRect.top + container.scrollTop,
        ),
      ),
      width: roundPreviewFrameValue(right - left),
      height: roundPreviewFrameValue(bottom - top),
    };
  }

  container
    .querySelectorAll<HTMLElement>(".preview-note-annotation[data-note-id]")
    .forEach((annotation, annotationIndex) => {
      const noteId = annotation.dataset.noteId;
      if (!noteId) return;
      const isFocusTarget = annotation.dataset.focusTarget === "true";
      const tone: AnnotationTone = annotation.dataset.noteTone === "1" ? 1 : 0;
      const kind: AnnotationKind =
        annotation.dataset.annotationKind === "glossary" ? "glossary" : "note";

      const annotationRects = Array.from(annotation.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (annotationRects.length === 0) return;

      const sortedRects = annotationRects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );

      sortedRects.forEach((rect, rectIndex) => {
        let top = rect.top - previewAnnotationFramePadding;
        let bottom = rect.bottom + previewAnnotationFramePadding;
        const previousRect = sortedRects[rectIndex - 1];
        const nextRect = sortedRects[rectIndex + 1];

        if (previousRect) {
          const previousGap = rect.top - previousRect.bottom;
          if (previousGap >= 0 && previousGap <= previewAnnotationLineJoinMaxGap) {
            top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
          }
        }

        if (nextRect) {
          const nextGap = nextRect.top - rect.bottom;
          if (nextGap >= 0 && nextGap <= previewAnnotationLineJoinMaxGap) {
            bottom = Math.max(bottom, rect.bottom + nextGap / 2 + 1);
          }
        }

        frames.push(
          frameFromBounds(
            noteId,
            `${noteId}:inline:${annotationIndex}:${rectIndex}`,
            isFocusTarget,
            kind,
            tone,
            rect.left - previewAnnotationFramePadding,
            top,
            rect.right + previewAnnotationFramePadding,
            bottom,
          ),
        );
      });
    });

  return frames.sort(
    (left, right) =>
      left.top - right.top ||
      left.left - right.left ||
      annotationKindLayer(left.kind) - annotationKindLayer(right.kind) ||
      right.width - left.width ||
      left.frameKey.localeCompare(right.frameKey),
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
      leftFrame.frameKey === rightFrame.frameKey &&
      leftFrame.isFocusTarget === rightFrame.isFocusTarget &&
      leftFrame.kind === rightFrame.kind &&
      leftFrame.noteId === rightFrame.noteId &&
      leftFrame.tone === rightFrame.tone &&
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
    unorderedListMarkerPattern.test(line) ||
    orderedListMarkerPattern.test(line) ||
    /^```/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
  );
}

function parseCodeFenceInfo(line: string) {
  const info = line.trim().slice(3).trim();
  const language = info.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  return { info, language };
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
      const { info, language } = parseCodeFenceInfo(trimmed);
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
        info,
        language,
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

    if (unorderedListMarkerPattern.test(line)) {
      const items: string[] = [];
      const startLine = index;

      while (index < lines.length && unorderedListMarkerPattern.test(lines[index])) {
        items.push(lines[index].replace(unorderedListMarkerPattern, ""));
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

    if (orderedListMarkerPattern.test(line)) {
      const items: string[] = [];
      const startLine = index;

      while (index < lines.length && orderedListMarkerPattern.test(lines[index])) {
        items.push(lines[index].replace(orderedListMarkerPattern, ""));
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
  const rawLines = text
    .replace(/\u200b/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  const typedMarkdownBlock = markdownFromTypedPreviewBlock(rawLines);
  const lines = rawLines.map((line) => line.trimEnd());

  if (typedMarkdownBlock && block.kind !== "code") {
    return typedMarkdownBlock;
  }

  if (block.kind === "heading") {
    return `${"#".repeat(block.level)} ${lines.join(" ").trim() || "Untitled"}`;
  }

  if (block.kind === "quote") {
    return lines.map((line) => `> ${line}`).join("\n");
  }

  if (block.kind === "unordered-list") {
    return lines
      .map((line) => line.trim())
      .map((line) => `- ${line}`)
      .join("\n");
  }

  if (block.kind === "ordered-list") {
    return lines
      .map((line) => line.trim())
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");
  }

  if (block.kind === "code") {
    return `\`\`\`${block.info}\n${text.replace(/\n+$/, "")}\n\`\`\``;
  }

  if (block.kind === "rule") {
    return "---";
  }

  return lines.join("\n").trim();
}

function typedListItemsFromLines(
  lines: string[],
  markerPattern: RegExp,
): string[] | null {
  const items = lines.map((line) => {
    const match = line.trimStart().match(markerPattern);

    return match ? match[1].trim() : null;
  });

  if (!items.every((item): item is string => item !== null)) return null;
  if (!items.some((item) => item.length > 0)) return null;

  return items;
}

type TypedPreviewMarkdownBlock = {
  kind: "unordered-list" | "ordered-list";
  items: string[];
  markdown: string;
};

function typedMarkdownBlockFromLines(lines: string[]): TypedPreviewMarkdownBlock | null {
  const contentLines = lines
    .map((line) => line.replace(/\u200b/g, ""))
    .map((line) => line.replace(/\u00a0/g, " "))
    .filter((line) => line.trim());
  if (contentLines.length === 0) return null;

  const unorderedItems = typedListItemsFromLines(
    contentLines,
    typedUnorderedListMarkerPattern,
  );
  if (unorderedItems) {
    return {
      kind: "unordered-list",
      items: unorderedItems,
      markdown: unorderedItems.map((item) => `- ${item}`).join("\n"),
    };
  }

  const orderedItems = typedListItemsFromLines(contentLines, typedOrderedListMarkerPattern);
  if (orderedItems) {
    return {
      kind: "ordered-list",
      items: orderedItems,
      markdown: orderedItems.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    };
  }

  return null;
}

function markdownFromTypedPreviewBlock(lines: string[]) {
  return typedMarkdownBlockFromLines(lines)?.markdown ?? null;
}

function appendBlankListItemToTypedMarkdownBlock(block: TypedPreviewMarkdownBlock) {
  if (block.kind === "unordered-list") {
    return `${block.markdown}\n- `;
  }

  return `${block.markdown}\n${block.items.length + 1}. `;
}

function markdownFromPreviewListItems(
  block: Extract<MarkdownPreviewBlock, { kind: "unordered-list" | "ordered-list" }>,
  items: string[],
) {
  if (block.kind === "unordered-list") {
    return items.map((item) => `- ${item}`).join("\n");
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function replaceMarkdownBlock(markdown: string, block: MarkdownPreviewBlock, nextBlock: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nextLines = nextBlock ? nextBlock.split("\n") : [""];

  lines.splice(block.startLine, block.endLine - block.startLine + 1, ...nextLines);

  return lines.join("\n");
}

function isUndoKeyboardShortcut(
  event: Pick<KeyboardEvent | ReactKeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
) {
  return (
    event.key.toLowerCase() === "z" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

function selectionOffsetsInElement(element: HTMLElement, selection: Selection) {
  if (selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }

  const leadingRange = range.cloneRange();
  leadingRange.selectNodeContents(element);
  leadingRange.setEnd(range.startContainer, range.startOffset);

  return {
    from: leadingRange.toString().length,
    to: leadingRange.toString().length + range.toString().length,
  };
}

function focusEditableBlockEnd(blockKey: string) {
  window.requestAnimationFrame(() => {
    const blockElement = Array.from(
      document.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    ).find((element) => element.dataset.previewBlockKey === blockKey);

    if (!blockElement) return;

    blockElement.closest<HTMLElement>(".markdown-preview")?.focus();
    const focusTarget =
      blockElement.matches("ul, ol")
        ? blockElement.querySelector<HTMLElement>("li:last-child") ?? blockElement
        : blockElement;

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(focusTarget);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function focusEditableListItem(blockKey: string, itemIndex: number) {
  window.requestAnimationFrame(() => {
    const blockElement = Array.from(
      document.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    ).find((element) => element.dataset.previewBlockKey === blockKey);

    const listItem = blockElement?.querySelectorAll<HTMLElement>("li")[itemIndex];
    if (!listItem) return;

    blockElement.closest<HTMLElement>(".markdown-preview")?.focus();

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(listItem);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function sourcePositionForPreviewTextOffset(textMap: PreviewTextMap, offset: number) {
  if (textMap.sourceOffsets.length === 0) return null;

  const clampedOffset = clampNumber(offset, 0, textMap.sourceOffsets.length);
  const exactOffset = textMap.sourceOffsets[clampedOffset];
  if (exactOffset !== null && exactOffset !== undefined) return exactOffset;

  for (let index = clampedOffset - 1; index >= 0; index -= 1) {
    const sourceOffset = textMap.sourceOffsets[index];
    if (sourceOffset !== null) return sourceOffset + 1;
  }

  for (let index = clampedOffset; index < textMap.sourceOffsets.length; index += 1) {
    const sourceOffset = textMap.sourceOffsets[index];
    if (sourceOffset !== null) return sourceOffset;
  }

  return null;
}

function sourceRangeForPreviewTextOffsets(textMap: PreviewTextMap, from: number, to: number) {
  if (from === to) {
    const sourcePosition = sourcePositionForPreviewTextOffset(textMap, from);
    return sourcePosition === null ? null : { from: sourcePosition, to: sourcePosition };
  }

  const sourceOffsets = textMap.sourceOffsets
    .slice(from, to)
    .filter((sourceOffset): sourceOffset is number => sourceOffset !== null);
  if (sourceOffsets.length === 0) return null;

  return {
    from: Math.min(...sourceOffsets),
    to: Math.max(...sourceOffsets) + 1,
  };
}

type MarkdownTextEdit = {
  from: number;
  to: number;
  insert: string;
};

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

function transformAnchorWithTextEdits(
  anchor: TextSelectionAnchor,
  nextBody: string,
  edits: MarkdownTextEdit[],
) {
  const nextFrom = clampNumber(
    transformTextPositionWithEdits(anchor.from, "start", edits),
    0,
    nextBody.length,
  );
  const nextTo = clampNumber(
    transformTextPositionWithEdits(anchor.to, "end", edits),
    nextFrom,
    nextBody.length,
  );

  return refreshAnchor(nextBody, {
    ...anchor,
    from: nextFrom,
    to: nextTo,
  });
}

function textEditFromBodyChange(previousBody: string, nextBody: string): MarkdownTextEdit | null {
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

function transformAnchorWithBodyChange(
  anchor: TextSelectionAnchor,
  previousBody: string,
  nextBody: string,
) {
  const edit = textEditFromBodyChange(previousBody, nextBody);
  if (!edit) return refreshAnchor(nextBody, anchor);

  return transformAnchorWithTextEdits(anchor, nextBody, [edit]);
}

function applyMarkdownInlineMarker(markdown: string, from: number, to: number, marker: "*" | "**") {
  const markerLength = marker.length;
  const selectedText = markdown.slice(from, to);

  if (
    from >= markerLength &&
    markdown.slice(from - markerLength, from) === marker &&
    markdown.slice(to, to + markerLength) === marker
  ) {
    const edits = [
      { from: from - markerLength, to: from, insert: "" },
      { from: to, to: to + markerLength, insert: "" },
    ];

    return {
      edits,
      value:
      markdown.slice(0, from - markerLength) +
      selectedText +
      markdown.slice(to + markerLength),
    };
  }

  if (
    selectedText.length >= markerLength * 2 &&
    selectedText.startsWith(marker) &&
    selectedText.endsWith(marker)
  ) {
    const edits = [
      { from, to: from + markerLength, insert: "" },
      { from: to - markerLength, to, insert: "" },
    ];

    return {
      edits,
      value:
      markdown.slice(0, from) +
      selectedText.slice(markerLength, -markerLength) +
      markdown.slice(to),
    };
  }

  const edits = [
    { from, to: from, insert: marker },
    { from: to, to, insert: marker },
  ];

  return {
    edits,
    value:
    markdown.slice(0, from) +
    marker +
    selectedText +
    marker +
    markdown.slice(to),
  };
}

function applyInlineMarkdownShortcutToValue(
  markdown: string,
  block: MarkdownPreviewBlock,
  element: HTMLElement,
  marker: "*" | "**",
) {
  const selection = window.getSelection();
  if (!selection) return null;

  const offsets = selectionOffsetsInElement(element, selection);
  if (!offsets) return null;
  if (offsets.from === offsets.to) return null;

  const textMap = getPreviewBlockTextMap(markdown, block);
  const sourceRange = sourceRangeForPreviewTextOffsets(textMap, offsets.from, offsets.to);
  if (!sourceRange) return null;

  const change = applyMarkdownInlineMarker(markdown, sourceRange.from, sourceRange.to, marker);

  return {
    transformAnchor: (anchor: TextSelectionAnchor, nextBody: string) =>
      transformAnchorWithTextEdits(anchor, nextBody, change.edits),
    value: change.value,
  };
}

function MarkdownPreviewBlockView({
  block,
  markdown,
  annotations,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  block: MarkdownPreviewBlock;
  markdown: string;
  annotations: TextRangeAnnotation[];
  onAnnotationClick: (annotationId: string) => void;
  onAnnotationDoubleClick: (annotationId: string) => void;
}) {
  const blockAnnotations = getAnnotationsForPreviewBlock(markdown, block, annotations);

  const blockProps = {
    "data-preview-block-key": block.key,
  };

  if (block.kind === "heading") {
    const tagName = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const textMap = getPreviewBlockTextMap(markdown, block);

    return createElement(
      tagName,
      {
        ...blockProps,
        className: "markdown-preview-editable",
      },
      renderPreviewInline(
        textMap,
        `${block.key}-heading`,
        blockAnnotations,
        onAnnotationClick,
        onAnnotationDoubleClick,
      ),
    );
  }

  if (block.kind === "quote") {
    return (
      <blockquote
        {...blockProps}
        className="markdown-preview-editable"
        key={block.key}
      >
        {block.text.split("\n").map((_quoteLine, quoteIndex) => (
          <p key={`${block.key}-quote-${quoteIndex}`}>
            {renderPreviewInline(
              getQuoteLineTextMap(markdown, block, quoteIndex),
              `${block.key}-quote-${quoteIndex}`,
              blockAnnotations,
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
      <ListTag {...blockProps} className="markdown-preview-editable" key={block.key}>
        {block.items.map((item, itemIndex) => {
          const itemTextMap = getListItemTextMap(markdown, block, itemIndex);

          return (
            <li key={`${block.key}-item-${itemIndex}`}>
              {item
                ? renderPreviewInline(
                    itemTextMap,
                    `${block.key}-item-${itemIndex}`,
                    blockAnnotations,
                    onAnnotationClick,
                    onAnnotationDoubleClick,
                  )
                : emptyPreviewListItemText}
            </li>
          );
        })}
      </ListTag>
    );
  }

  if (block.kind === "code") {
    if (isMermaidLanguage(block.language)) {
      return <MermaidDiagram definition={block.text} key={block.key} />;
    }

    return (
      <pre {...blockProps} className="markdown-preview-editable" key={block.key}>
        <code>
          {renderAnnotatedPlainText(
            getPreviewBlockTextMap(markdown, block),
            `${block.key}-code`,
            blockAnnotations,
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
      <p {...blockProps} className="markdown-preview-editable" key={block.key}>
        {renderPreviewInline(
          getPreviewBlockTextMap(markdown, block),
          `${block.key}-paragraph`,
          blockAnnotations,
          onAnnotationClick,
          onAnnotationDoubleClick,
        )}
      </p>
    );
  }

  return null;
}

export function MarkdownPreview({
  value,
  annotations,
  readOnly,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
}: {
  value: string;
  annotations: TextRangeAnnotation[];
  readOnly?: boolean;
  onChange: (
    value: string,
    source: EditorChangeSource,
    anchorTransform?: BodyAnchorTransform,
  ) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (annotationId: string) => void;
}) {
  const blocks = parseMarkdownPreviewBlocks(value);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const annotationClickTimerRef = useRef(0);
  const previewUndoStackRef = useRef<string[]>([]);
  const previewRedoStackRef = useRef<string[]>([]);
  const [annotationFrames, setAnnotationFrames] = useState<PreviewAnnotationFrame[]>([]);

  useEffect(
    () => () => {
      window.clearTimeout(annotationClickTimerRef.current);
    },
    [],
  );

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
  }, [annotations, value]);

  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (readOnly) return;
      if (!isUndoKeyboardShortcut(event)) return;
      if (!previewShouldHandleDocumentShortcut(event.target)) return;
      if (!undoPreviewChange()) return;

      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [onChange, onSelectionChange, readOnly, value]);

  function handlePreviewSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";

    if (!selection || selection.isCollapsed || !selectedText.trim()) {
      onSelectionChange(null);
      return;
    }

    const previewElement = previewRef.current;
    const anchor = previewElement
      ? makePreviewAnchorFromSelection(value, blocks, previewElement, selection)
      : makePreviewAnchor(value, selectedText);

    clearQueuedAnnotationClick();
    onSelectionChange(anchor);
  }

  function noteIdFromPreviewFrameEvent(event: MouseEvent<HTMLDivElement>) {
    const previewElement = previewRef.current;
    if (!previewElement) return null;

    const targetElement =
      event.target instanceof HTMLElement
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
    if (targetElement?.closest(".preview-note-annotation")) return null;

    for (const frame of previewElement.querySelectorAll<HTMLElement>(
      ".preview-annotation-frame[data-note-id]",
    )) {
      const noteId = frame.dataset.noteId;
      if (!noteId) continue;

      const rect = frame.getBoundingClientRect();
      const hitFrame =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (hitFrame) return noteId;
    }

    return null;
  }

  function selectedPreviewText() {
    const selection = window.getSelection();
    return selection && !selection.isCollapsed ? selection.toString().trim() : "";
  }

  function clearQueuedAnnotationClick() {
    window.clearTimeout(annotationClickTimerRef.current);
    annotationClickTimerRef.current = 0;
  }

  function queueAnnotationClick(annotationId: string) {
    clearQueuedAnnotationClick();
    annotationClickTimerRef.current = window.setTimeout(() => {
      annotationClickTimerRef.current = 0;
      if (selectedPreviewText()) return;

      onAnnotationClick(annotationId);
    }, annotationClickDelayMs);
  }

  function handleAnnotationDoubleClick(_annotationId: string) {
    clearQueuedAnnotationClick();
  }

  function noteIdFromPreviewFrameClick(event: MouseEvent<HTMLDivElement>) {
    if (selectedPreviewText()) return null;

    const noteId = noteIdFromPreviewFrameEvent(event);
    if (!noteId) return null;

    event.preventDefault();
    event.stopPropagation();
    onSelectionChange(null);
    return noteId;
  }

  function handlePreviewMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.detail >= 2) {
      clearQueuedAnnotationClick();
    }
  }

  function handlePreviewMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    if (selectedPreviewText()) {
      clearQueuedAnnotationClick();
      handlePreviewSelection();
      return;
    }

    const noteId = noteIdFromPreviewFrameClick(event);
    if (noteId) {
      if (event.detail >= 2) {
        handleAnnotationDoubleClick(noteId);
      } else {
        queueAnnotationClick(noteId);
      }
      return;
    }

    handlePreviewSelection();
  }

  function previewBlockElementFromNode(node: Node | null) {
    const previewElement = previewRef.current;
    const element = node instanceof Element ? node : node?.parentElement;
    const blockElement = element?.closest<HTMLElement>("[data-preview-block-key]") ?? null;

    return blockElement && previewElement?.contains(blockElement) ? blockElement : null;
  }

  function previewBlockElementFromTarget(target: EventTarget | null) {
    return target instanceof Node ? previewBlockElementFromNode(target) : null;
  }

  function previewBlockElementFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    return previewBlockElementFromNode(selection.focusNode);
  }

  function blockForPreviewElement(blockElement: HTMLElement) {
    const blockKey = blockElement.dataset.previewBlockKey;
    if (!blockKey) return null;

    return blocks.find((block) => block.key === blockKey) ?? null;
  }

  function markPreviewBlockChanged(blockElement: HTMLElement) {
    blockElement.dataset.edited = "true";
  }

  function childNodeText(node: ChildNode) {
    if (node instanceof HTMLElement) return node.innerText;

    return node.textContent ?? "";
  }

  function clearTransientPreviewNodes(nodes: ChildNode[]) {
    nodes.forEach((node) => node.remove());
    window.getSelection()?.removeAllRanges();
  }

  function previewAnnotationLayer(previewElement: HTMLElement) {
    return previewElement.querySelector<HTMLElement>(".preview-annotation-layer");
  }

  function previewBlockBeforeNode(node: Node | null) {
    let previousNode = node?.previousSibling ?? null;

    while (previousNode) {
      if (
        previousNode instanceof HTMLElement &&
        previousNode.dataset.previewBlockKey
      ) {
        return blockForPreviewElement(previousNode);
      }

      previousNode = previousNode.previousSibling;
    }

    return null;
  }

  function focusEditableNodeStart(node: Node) {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function topLevelPreviewNode(previewElement: HTMLElement, node: Node | null) {
    let current = node;

    while (current && current.parentNode && current.parentNode !== previewElement) {
      current = current.parentNode;
    }

    return current?.parentNode === previewElement ? current : null;
  }

  function insertTransientPreviewLine(previewElement: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    if (!selection.focusNode || !previewElement.contains(selection.focusNode)) return false;

    const lineElement = document.createElement("div");
    lineElement.dataset.previewTransient = "true";
    lineElement.append(document.createElement("br"));

    const blockElement = previewBlockElementFromSelection();
    if (blockElement) {
      lineElement.dataset.previewPreviousBlockKey = blockElement.dataset.previewBlockKey ?? "";
      blockElement.after(lineElement);
      focusEditableNodeStart(lineElement);
      return true;
    }

    const topLevelNode = topLevelPreviewNode(previewElement, selection.focusNode);
    const annotationLayer = previewAnnotationLayer(previewElement);
    if (
      topLevelNode &&
      topLevelNode instanceof HTMLElement &&
      !topLevelNode.classList.contains("preview-annotation-layer")
    ) {
      const previousBlock = topLevelNode.dataset.previewBlockKey
        ? blockForPreviewElement(topLevelNode)
        : previewBlockBeforeNode(topLevelNode);
      lineElement.dataset.previewPreviousBlockKey = previousBlock?.key ?? "";
      topLevelNode.after(lineElement);
    } else {
      const previousBlock = previewBlockBeforeNode(annotationLayer);
      lineElement.dataset.previewPreviousBlockKey = previousBlock?.key ?? "";
      previewElement.insertBefore(lineElement, annotationLayer);
    }

    focusEditableNodeStart(lineElement);
    return true;
  }

  function rootTransientPreviewEdit(
    previewElement: HTMLElement,
    selectedTransientElement: HTMLElement | null,
  ) {
    const transientNodes = selectedTransientElement
      ? [selectedTransientElement]
      : Array.from(previewElement.children).filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.dataset.previewTransient === "true",
        );
    if (transientNodes.length === 0) return null;

    const firstTransientNode = transientNodes[0];
    const previousBlockKey = firstTransientNode.dataset.previewPreviousBlockKey;
    const previousBlock =
      blocks.find((block) => block.key === previousBlockKey) ??
      previewBlockBeforeNode(firstTransientNode);

    const text = transientNodes.map(childNodeText).join("\n");

    return { previousBlock, text, transientNodes };
  }

  function insertMarkdownAfterBlock(
    previousBlock: MarkdownPreviewBlock | null,
    markdownBlock: string,
  ) {
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const insertIndex = previousBlock ? previousBlock.endLine + 1 : 0;
    const leadingBlankLineCount = previousBlock ? 1 : 0;
    const insertedLines = [
      ...Array.from({ length: leadingBlankLineCount }, () => ""),
      ...markdownBlock.split("\n"),
      "",
    ];

    lines.splice(insertIndex, 0, ...insertedLines);

    return {
      nextValue: lines.join("\n"),
      insertedBlockKey: `markdown-block-${insertIndex + leadingBlankLineCount}`,
    };
  }

  function textBeforePreviewCaretOnCurrentLine(previewElement: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
    if (!selection.focusNode || !previewElement.contains(selection.focusNode)) return null;

    const scope = previewBlockElementFromNode(selection.focusNode) ?? previewElement;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(scope);
    range.setEnd(selection.focusNode, selection.focusOffset);

    const lines = range
      .toString()
      .replace(/\u00a0/g, " ")
      .split("\n");

    return lines[lines.length - 1] ?? "";
  }

  function insertPlainPreviewText(text: string) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const blockElement = previewBlockElementFromNode(textNode);
    if (blockElement) markPreviewBlockChanged(blockElement);

    return true;
  }

  function handlePreviewBeforeInput(event: FormEvent<HTMLDivElement>) {
    if (readOnly) {
      event.preventDefault();
      return;
    }

    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType !== "insertText" || nativeEvent.data !== " ") return;

    const textBeforeCaret = textBeforePreviewCaretOnCurrentLine(event.currentTarget);
    if (!textBeforeCaret) return;
    if (!/^ {0,3}(?:[-*+]|\d+[.)])$/.test(textBeforeCaret)) return;

    event.preventDefault();
    insertPlainPreviewText(" ");
  }

  function handlePreviewMarkdownShortcutSpace(event: ReactKeyboardEvent<HTMLDivElement>) {
    const isPlainSpace =
      (event.key === " " || event.code === "Space") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainSpace) return false;

    const previewElement = previewRef.current;
    if (!previewElement) return false;

    const textBeforeCaret = textBeforePreviewCaretOnCurrentLine(previewElement);
    if (!textBeforeCaret) return false;
    if (!/^ {0,3}(?:[-*+]|\d+[.)])$/.test(textBeforeCaret)) return false;

    event.preventDefault();
    event.stopPropagation();
    return insertPlainPreviewText(" ");
  }

  function handlePreviewInput(event: FormEvent<HTMLDivElement>) {
    if (readOnly) {
      event.preventDefault();
      return;
    }

    const blockElement =
      previewBlockElementFromTarget(event.target) ?? previewBlockElementFromSelection();
    if (!blockElement) return;

    markPreviewBlockChanged(blockElement);
  }

  function listItemElementFromSelection(blockElement: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const element =
      selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement;
    const listItem = element?.closest<HTMLLIElement>("li") ?? null;

    return listItem && blockElement.contains(listItem) ? listItem : null;
  }

  function listItemsFromPreviewElement(blockElement: HTMLElement) {
    return Array.from(blockElement.querySelectorAll<HTMLLIElement>("li")).map((item) =>
      item.innerText
        .replace(/\u200b/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "")
        .trimEnd(),
    );
  }

  function commitPreviewListEnter(blockElement: HTMLElement) {
    const block = blockForPreviewElement(blockElement);
    if (!block || !blockIsList(block)) return false;

    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed) return false;

    const listItem = listItemElementFromSelection(blockElement);
    if (!listItem) return false;

    const listItems = Array.from(blockElement.querySelectorAll<HTMLLIElement>("li"));
    const itemIndex = listItems.indexOf(listItem);
    if (itemIndex < 0) return false;

    const items = listItemsFromPreviewElement(blockElement);
    const currentItem = items[itemIndex] ?? "";

    if (!currentItem.trim()) return false;

    const nextItems = [
      ...items.slice(0, itemIndex + 1),
      "",
      ...items.slice(itemIndex + 1),
    ];

    delete blockElement.dataset.edited;
    commitPreviewBlockMarkdown(block, markdownFromPreviewListItems(block, nextItems));
    focusEditableListItem(block.key, itemIndex + 1);
    return true;
  }

  function transientPreviewElementFromNode(node: Node | null) {
    const previewElement = previewRef.current;
    const element = node instanceof Element ? node : node?.parentElement;
    const transientElement =
      element?.closest<HTMLElement>("[data-preview-transient='true']") ?? null;

    return transientElement && previewElement?.contains(transientElement)
      ? transientElement
      : null;
  }

  function transientPreviewElementFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    return transientPreviewElementFromNode(selection.focusNode);
  }

  function commitTypedPreviewBlock(
    blockElement: HTMLElement,
    options: { continueList?: boolean } = {},
  ) {
    const block = blockForPreviewElement(blockElement);
    if (!block || block.kind === "code") return false;

    const lines = blockElement.innerText
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));
    const typedMarkdownBlock = typedMarkdownBlockFromLines(lines);
    if (!typedMarkdownBlock) return false;

    delete blockElement.dataset.edited;
    commitPreviewBlockMarkdown(
      block,
      options.continueList
        ? appendBlankListItemToTypedMarkdownBlock(typedMarkdownBlock)
        : typedMarkdownBlock.markdown,
    );
    focusEditableBlockEnd(block.key);
    return true;
  }

  function commitRootTypedPreviewBlock(
    previewElement: HTMLElement,
    options: { continueList?: boolean } = {},
  ) {
    const transientEdit = rootTransientPreviewEdit(
      previewElement,
      transientPreviewElementFromSelection(),
    );
    if (!transientEdit) return false;

    const lines = transientEdit.text
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));
    const typedMarkdownBlock = typedMarkdownBlockFromLines(lines);
    if (!typedMarkdownBlock) return false;

    const { nextValue, insertedBlockKey } = insertMarkdownAfterBlock(
      transientEdit.previousBlock,
      options.continueList
        ? appendBlankListItemToTypedMarkdownBlock(typedMarkdownBlock)
        : typedMarkdownBlock.markdown,
    );

    if (nextValue === value) return false;

    clearTransientPreviewNodes(transientEdit.transientNodes);
    commitPreviewChange(nextValue);
    focusEditableBlockEnd(insertedBlockKey);
    return true;
  }

  function commitEditedPreviewBlocks() {
    const previewElement = previewRef.current;
    if (!previewElement) return false;

    const editedBlocks = Array.from(
      previewElement.querySelectorAll<HTMLElement>("[data-preview-block-key][data-edited='true']"),
    )
      .map((element) => {
        const block = blockForPreviewElement(element);
        return block ? { block, element } : null;
      })
      .filter((edit): edit is { block: MarkdownPreviewBlock; element: HTMLElement } =>
        Boolean(edit),
      )
      .sort((left, right) => right.block.startLine - left.block.startLine);

    if (editedBlocks.length === 0) return false;

    let nextValue = value;
    editedBlocks.forEach(({ block, element }) => {
      nextValue = replaceMarkdownBlock(
        nextValue,
        block,
        markdownFromPreviewBlock(block, element.innerText),
      );
      delete element.dataset.edited;
    });

    if (nextValue === value) return false;

    commitPreviewChange(nextValue);
    return true;
  }

  function commitPreviewBlockMarkdown(block: MarkdownPreviewBlock, markdownBlock: string) {
    const nextValue = replaceMarkdownBlock(value, block, markdownBlock);

    commitPreviewChange(nextValue);
  }

  function handlePreviewBlur(event: FocusEvent<HTMLDivElement>) {
    if (readOnly) return;

    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    commitRootTypedPreviewBlock(event.currentTarget);
    commitEditedPreviewBlocks();
  }

  function handlePreviewInlineShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;

    const key = event.key.toLowerCase();
    if (key !== "b" && key !== "i") return false;

    event.preventDefault();
    event.stopPropagation();

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return true;

    const startBlockElement = previewBlockElementFromNode(selection.anchorNode);
    const endBlockElement = previewBlockElementFromNode(selection.focusNode);
    if (!startBlockElement || startBlockElement !== endBlockElement) return true;

    const block = blockForPreviewElement(startBlockElement);
    if (!block || block.kind === "code") return true;

    delete startBlockElement.dataset.edited;
    applyPreviewInlineShortcut(
      block,
      startBlockElement,
      key === "b" ? "**" : "*",
    );

    return true;
  }

  function handlePreviewKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (readOnly) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isUndoKeyboardShortcut(event)) {
      if (previewHasActiveUncommittedEdit()) return;
      if (!undoPreviewChange()) return;

      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (handlePreviewInlineShortcut(event)) return;
    if (handlePreviewMarkdownShortcutSpace(event)) return;

    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    if (!selection || selection.isCollapsed || !selectedText.trim()) {
      const previewElement = previewRef.current;
      const blockElement = previewBlockElementFromSelection();
      const continuedPreviewList =
        blockElement && commitPreviewListEnter(blockElement);
      if (continuedPreviewList) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const convertedTypedList =
        (blockElement ? commitTypedPreviewBlock(blockElement, { continueList: true }) : false) ||
        (previewElement ? commitRootTypedPreviewBlock(previewElement, { continueList: true }) : false);

      if (convertedTypedList) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (transientPreviewElementFromSelection()) return;

      if (previewElement && insertTransientPreviewLine(previewElement)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const previewElement = previewRef.current;
    const anchor = previewElement
      ? makePreviewAnchorFromSelection(value, blocks, previewElement, selection)
      : makePreviewAnchor(value, selectedText);

    event.preventDefault();
    event.stopPropagation();

    if (anchor) {
      onSelectionEnter(anchor);
    } else {
      onSelectionChange(null);
    }
  }

  function applyPreviewInlineShortcut(
    block: MarkdownPreviewBlock,
    element: HTMLElement,
    marker: "*" | "**",
  ) {
    const change = applyInlineMarkdownShortcutToValue(value, block, element, marker);
    if (!change || change.value === value) return;

    window.getSelection()?.removeAllRanges();
    onSelectionChange(null);
    commitPreviewChange(change.value, change.transformAnchor);
  }

  function previewShouldHandleDocumentShortcut(target: EventTarget | null) {
    const previewElement = previewRef.current;
    if (!previewElement) return false;
    if (target instanceof Node && previewElement.contains(target)) return true;

    const activeElement = document.activeElement;
    if (activeElement === document.body || activeElement === document.documentElement) {
      return true;
    }
    if (!(activeElement instanceof HTMLElement)) return false;
    if (previewElement.contains(activeElement)) return true;
    if (activeElement.matches("input, textarea, select") || activeElement.isContentEditable) {
      return false;
    }

    return false;
  }

  function previewHasActiveUncommittedEdit() {
    if (transientPreviewElementFromSelection()) return true;

    const blockElement = previewBlockElementFromSelection();
    return blockElement?.dataset.edited === "true";
  }

  function undoPreviewChange() {
    const previousValue = previewUndoStackRef.current.pop();
    if (!previousValue) return false;

    previewRedoStackRef.current.push(value);
    onSelectionChange(null);
    onChange(previousValue, "undo");
    return true;
  }

  function commitPreviewChange(nextValue: string, anchorTransform?: BodyAnchorTransform) {
    if (nextValue === value) return;

    const undoStack = previewUndoStackRef.current;
    if (undoStack[undoStack.length - 1] !== value) {
      undoStack.push(value);
      if (undoStack.length > 100) {
        undoStack.shift();
      }
    }
    previewRedoStackRef.current = [];
    onChange(nextValue, "user", anchorTransform);
  }

  return (
    <div
      className="markdown-preview"
      contentEditable={readOnly ? false : "plaintext-only"}
      aria-readonly={readOnly || undefined}
      ref={previewRef}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      suppressContentEditableWarning
      tabIndex={0}
      onBlur={handlePreviewBlur}
      onBeforeInput={handlePreviewBeforeInput}
      onInput={handlePreviewInput}
      onKeyDownCapture={handlePreviewKeyDown}
      onKeyUp={handlePreviewSelection}
      onMouseDownCapture={handlePreviewMouseDown}
      onMouseUpCapture={handlePreviewMouseUp}
      onMouseUp={handlePreviewMouseUp}
    >
        {blocks.map((block) => (
          <MarkdownPreviewBlockView
            block={block}
            key={block.key}
            markdown={value}
            annotations={annotations}
            onAnnotationClick={queueAnnotationClick}
            onAnnotationDoubleClick={handleAnnotationDoubleClick}
          />
        ))}
      <div aria-hidden="true" className="preview-annotation-layer">
        {annotationFrames.map((frame) => (
          <span
            className={`preview-annotation-frame ${
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
    </div>
  );
}

function MarkdownPreviewContentBlock({
  block,
  keyPrefix,
}: {
  block: MarkdownPreviewBlock;
  keyPrefix: string;
}) {
  if (block.kind === "heading") {
    const tagName = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

    return createElement(
      tagName,
      { key: block.key },
      renderInlineMarkdown(block.text, `${keyPrefix}-heading`),
    );
  }

  if (block.kind === "quote") {
    return (
      <blockquote key={block.key}>
        {block.text.split("\n").map((quoteLine, quoteIndex) => (
          <p key={`${keyPrefix}-quote-${quoteIndex}`}>
            {renderInlineMarkdown(quoteLine, `${keyPrefix}-quote-${quoteIndex}`)}
          </p>
        ))}
      </blockquote>
    );
  }

  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    const ListTag = block.kind === "unordered-list" ? "ul" : "ol";

    return (
      <ListTag key={block.key}>
        {block.items.map((item, itemIndex) => (
          <li key={`${keyPrefix}-item-${itemIndex}`}>
            {renderInlineMarkdown(item, `${keyPrefix}-item-${itemIndex}`)}
          </li>
        ))}
      </ListTag>
    );
  }

  if (block.kind === "code") {
    if (isMermaidLanguage(block.language)) {
      return <MermaidDiagram definition={block.text} key={block.key} />;
    }

    return (
      <pre key={block.key}>
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.kind === "rule") {
    return <hr key={block.key} />;
  }

  if (block.kind === "paragraph") {
    return (
      <p key={block.key}>
        {renderInlineMarkdown(block.text, `${keyPrefix}-paragraph`)}
      </p>
    );
  }

  return null;
}

function MarkdownPreviewContent({
  className,
  emptyLabel,
  onDoubleClick,
  value,
}: {
  className: string;
  emptyLabel: string;
  onDoubleClick?: () => void;
  value: string;
}) {
  const isEmpty = !value.trim();
  const blocks = isEmpty ? [] : parseMarkdownPreviewBlocks(value);

  return (
    <div
      className={`${className} ${isEmpty ? "is-empty" : ""}`}
      onDoubleClick={onDoubleClick}
    >
      {isEmpty
        ? emptyLabel
        : blocks.map((block, blockIndex) => (
            <MarkdownPreviewContentBlock
              block={block}
              key={block.key}
              keyPrefix={`markdown-content-${blockIndex}`}
            />
          ))}
    </div>
  );
}

function NoteLibraryPreviewContent({
  className,
  emptyLabel,
  expanded,
  onDoubleClick,
  value,
}: {
  className: string;
  emptyLabel: string;
  expanded: boolean;
  onDoubleClick?: () => void;
  value: string;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);

  useLayoutEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const measuredElement = contentElement;
    let measureFrame = 0;

    function measureExpandedHeight() {
      window.cancelAnimationFrame(measureFrame);
      measureFrame = window.requestAnimationFrame(() => {
        const nextHeight = Math.ceil(measuredElement.scrollHeight);
        setExpandedHeight((currentHeight) =>
          currentHeight === nextHeight ? currentHeight : nextHeight,
        );
      });
    }

    measureExpandedHeight();

    const resizeObserver = new ResizeObserver(measureExpandedHeight);
    resizeObserver.observe(measuredElement);

    return () => {
      window.cancelAnimationFrame(measureFrame);
      resizeObserver.disconnect();
    };
  }, [value]);

  const bodyShellStyle = {
    "--note-library-card-body-expanded-height": `${expandedHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={`note-library-card__body-shell ${expanded ? "is-expanded" : ""}`}
      style={bodyShellStyle}
    >
      <div className="note-library-card__body-measure" ref={contentRef}>
        <MarkdownPreviewContent
          className={className}
          emptyLabel={emptyLabel}
          onDoubleClick={onDoubleClick}
          value={value}
        />
      </div>
    </div>
  );
}

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [workspaceTitle, setWorkspaceTitle] = useState("Scholium");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(() =>
    documentsSeed.map(workspaceEntryFromDocument),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0].id);
  const [notes, setNotes] = useState(notesSeed);
  const [glossaryTerms, setGlossaryTerms] = useState(glossaryTermsSeed);
  const [glossaryBindings, setGlossaryBindings] = useState(glossaryBindingsSeed);
  const [pendingAnchor, setPendingAnchor] = useState<TextSelectionAnchor | null>(null);
  const [pendingGlossaryTerm, setPendingGlossaryTerm] = useState<GlossaryTerm | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [glossaryDraft, setGlossaryDraft] = useState("");
  const [activeNoteId, setActiveNoteId] = useState("");
  const [activeGlossaryBindingId, setActiveGlossaryBindingId] = useState("");
  const [activeGlossaryTermId, setActiveGlossaryTermId] = useState("");
  const [activeNoteMode, setActiveNoteMode] = useState<ActiveNoteMode>("view");
  const [activeGlossaryMode, setActiveGlossaryMode] = useState<ActiveNoteMode>("view");
  const [floatingNotePanelPosition, setFloatingNotePanelPosition] =
    useState<FloatingNotePosition | null>(null);
  const [selectionWarningPosition, setSelectionWarningPosition] =
    useState<SelectionWarningPosition | null>(null);
  const [isNotePanelClosing, setIsNotePanelClosing] = useState(false);
  const [isReturningToView, setIsReturningToView] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    window.matchMedia(mobileViewportQuery).matches,
  );
  const [editorMode, setEditorMode] = useState<EditorMode>("preview");
  const [noteModeEnabled, setNoteModeEnabled] = useState(false);
  const [glossaryModeEnabled, setGlossaryModeEnabled] = useState(false);
  const [noteLibraryOpen, setNoteLibraryOpen] = useState(false);
  const [focusedLibraryNoteId, setFocusedLibraryNoteId] = useState("");
  const [editingLibraryNoteId, setEditingLibraryNoteId] = useState("");
  const [dirtyDocumentStates, setDirtyDocumentStates] = useState<
    Record<string, DirtyDocumentState>
  >({});
  const [savedDocumentBodies, setSavedDocumentBodies] = useState<Record<string, string>>(() =>
    savedBodiesFromDocuments(documentsSeed),
  );
  const [storageError, setStorageError] = useState("");
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const notePanelRef = useRef<HTMLElement | null>(null);
  const floatingNoteCardRef = useRef<HTMLDivElement | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const libraryNoteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const returnToViewTimerRef = useRef(0);
  const notePanelCloseTimerRef = useRef(0);
  const floatingNotePanelPositionFrameRef = useRef(0);
  const floatingNoteAnchorRectRef = useRef<TextRangeRect | null>(null);
  const lastPointerAnchorRectRef = useRef<TextRangeRect | null>(null);
  const noteTextareaShouldRefocusRef = useRef(false);
  const noteTextareaIsComposingRef = useRef(false);
  const noteTextareaEnterIgnoredDuringCompositionRef = useRef(false);
  const noteTextareaPostCompositionGuardUntilRef = useRef(0);
  const noteEditModalActiveRef = useRef(false);
  const noteDraftRef = useRef(noteDraft);
  const glossaryDraftRef = useRef(glossaryDraft);
  const transientSelectionNoteIdRef = useRef("");
  const transientGlossaryBindingIdRef = useRef("");
  const transientGlossaryTermIdRef = useRef("");
  const pendingGlossaryPromptLockUntilRef = useRef(0);
  const autosaveTimerRef = useRef(0);
  const autosaveInFlightRef = useRef(false);
  const autosaveRequestedWhileSavingRef = useRef(false);
  const documentsRef = useRef(documents);
  const notesRef = useRef(notes);
  const glossaryTermsRef = useRef(glossaryTerms);
  const glossaryBindingsRef = useRef(glossaryBindings);
  const dirtyDocumentStatesRef = useRef(dirtyDocumentStates);
  const savedDocumentBodiesRef = useRef(savedDocumentBodies);
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  const notePanelHasContentRef = useRef(false);
  const selectionDismissedUntilRef = useRef(0);
  const lastOpenedFileRestoreAttemptedRef = useRef(false);
  const newMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const openMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const openMarkdownFolderHandlerRef = useRef<() => void>(() => undefined);

  documentsRef.current = documents;
  notesRef.current = notes;
  glossaryTermsRef.current = glossaryTerms;
  glossaryBindingsRef.current = glossaryBindings;
  dirtyDocumentStatesRef.current = dirtyDocumentStates;
  savedDocumentBodiesRef.current = savedDocumentBodies;
  selectedDocumentIdRef.current = selectedDocumentId;
  noteDraftRef.current = noteDraft;
  glossaryDraftRef.current = glossaryDraft;
  newMarkdownFileHandlerRef.current = () => {
    void newMarkdownFile();
  };
  openMarkdownFileHandlerRef.current = () => {
    void openMarkdownFileFromPicker();
  };
  openMarkdownFolderHandlerRef.current = () => {
    void openMarkdownFolder();
  };

  const hasOpenDocument = documents.length > 0;
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ??
    documents[0] ??
    emptyDocument;
  const glossaryModeActive = noteModeEnabled && glossaryModeEnabled;

  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const documentGlossaryBindings = glossaryBindings.filter(
    (binding) => binding.documentId === selectedDocument.id && binding.status !== "deleted",
  );
  const nativeStorageAvailable = hasNativeStorageAccess();
  const activeNotes = documentNotes.filter(
    (note) =>
      note.status === "active" &&
      (selectionNoteHasContent(note) ||
        note.id === transientSelectionNoteIdRef.current ||
        note.id === activeNoteId),
  );
  const activeNote = documentNotes.find((note) => note.id === activeNoteId);
  const glossaryTermIdsWithContent = new Set(
    glossaryTerms.filter(glossaryTermHasContent).map((term) => term.id),
  );
  const editableGlossaryBindingIds = new Set(
    [activeGlossaryBindingId, transientGlossaryBindingIdRef.current].filter(Boolean),
  );
  const activeGlossaryBinding = glossaryModeActive
    ? documentGlossaryBindings.find((binding) => binding.id === activeGlossaryBindingId)
    : undefined;
  const rawActiveGlossaryTerm = glossaryModeActive
    ? glossaryTerms.find(
        (term) => term.id === (activeGlossaryTermId || activeGlossaryBinding?.termId),
      )
    : undefined;
  const activeGlossaryTerm =
    rawActiveGlossaryTerm &&
    (activeGlossaryMode === "edit" ||
      rawActiveGlossaryTerm.id === transientGlossaryTermIdRef.current ||
      glossaryTermHasContent(rawActiveGlossaryTerm))
      ? rawActiveGlossaryTerm
      : undefined;
  const pendingAnchorIsGlossaryTerm = Boolean(
    glossaryModeActive && pendingAnchor && isGlossarySelectionCandidate(pendingAnchor),
  );
  const noteLibraryFocusedNoteCandidateId =
    noteModeEnabled && noteLibraryOpen ? focusedLibraryNoteId : "";

  const activeGlossaryAnnotations: TextRangeAnnotation[] = glossaryModeActive
    ? documentGlossaryBindings
        .filter(
          (binding) =>
            binding.status === "active" &&
            (glossaryTermIdsWithContent.has(binding.termId) ||
              editableGlossaryBindingIds.has(binding.id)) &&
            hasRenderableAnchor(binding.anchor),
        )
        .map((binding) => ({
          id: `glossary:${binding.id}`,
          isFocusTarget: binding.id === activeGlossaryBindingId,
          kind: "glossary",
          status: binding.status,
          anchor: binding.anchor,
        }))
    : [];
  const activeNoteAnnotations: TextRangeAnnotation[] = activeNotes
    .filter((note) => hasRenderableAnchor(note.anchor))
    .map((note) => ({
      id: note.id,
      isFocusTarget:
        note.id === noteLibraryFocusedNoteCandidateId || note.id === activeNoteId,
      kind: "note",
      status: note.status,
      anchor: note.anchor,
      tone: note.tone,
    }));
  const pendingAnchorAnnotation: TextRangeAnnotation | null =
    noteModeEnabled && pendingAnchor && hasRenderableAnchor(pendingAnchor)
      ? {
          id: pendingAnchorAnnotationId,
          isFocusTarget: true,
          kind: pendingAnchorIsGlossaryTerm ? "glossary" : "note",
          status: "active",
          anchor: pendingAnchor,
        }
      : null;
  const activeTextAnnotations = assignAnnotationTones([
    ...activeNoteAnnotations,
    ...activeGlossaryAnnotations,
  ]);
  const activeNoteToneById = new Map(
    activeTextAnnotations
      .filter((annotation) => annotation.kind === "note")
      .map((annotation) => [annotation.id, annotation.tone ?? 0]),
  );
  const noteLibraryNotes = activeNotes
    .filter((note) => selectionNoteHasContent(note) && hasRenderableAnchor(note.anchor))
    .slice()
    .sort((leftNote, rightNote) => {
      const positionDifference = leftNote.anchor.from - rightNote.anchor.from;
      if (positionDifference !== 0) return positionDifference;

      return leftNote.createdAt.localeCompare(rightNote.createdAt);
    });
  const glossaryNavigationBindings = glossaryModeActive
    ? documentGlossaryBindings
        .filter(
          (binding) =>
            binding.status === "active" &&
            glossaryTermIdsWithContent.has(binding.termId) &&
            hasRenderableAnchor(binding.anchor),
        )
        .slice()
        .sort((leftBinding, rightBinding) => {
          const positionDifference = leftBinding.anchor.from - rightBinding.anchor.from;
          if (positionDifference !== 0) return positionDifference;

          return leftBinding.createdAt.localeCompare(rightBinding.createdAt);
        })
    : [];
  const noteLibrarySignature = noteLibraryNotes
    .map((note) => `${note.id}:${note.anchor.from}:${note.anchor.to}:${note.body}`)
    .join("|");
  const glossaryNavigationSignature = glossaryNavigationBindings
    .map((binding) => `${binding.id}:${binding.anchor.from}:${binding.anchor.to}`)
    .join("|");
  const noteLibraryFocusActive = Boolean(
    noteLibraryFocusedNoteCandidateId &&
      noteLibraryNotes.some((note) => note.id === noteLibraryFocusedNoteCandidateId),
  );
  const visibleTextAnnotations =
    noteModeEnabled && pendingAnchorAnnotation
      ? [...activeTextAnnotations, pendingAnchorAnnotation]
      : noteModeEnabled
        ? activeTextAnnotations
        : [];
  const annotations: TextAnnotation[] = visibleTextAnnotations.map((annotation) => ({
    id: annotation.id,
    isFocusTarget: annotation.isFocusTarget,
    kind: annotation.kind,
    from: annotation.anchor.from,
    prefix: annotation.anchor.prefix,
    selectedText: annotation.anchor.selectedText,
    suffix: annotation.anchor.suffix,
    tone: annotation.tone,
    to: annotation.anchor.to,
  }));
  const pendingAnchorIsCompleteBlock = Boolean(
    noteModeEnabled &&
      pendingAnchor &&
      isSelectionCompleteMarkdownBlock(selectedDocument.body, pendingAnchor),
  );
  const activeNoteIsEditing = Boolean(activeNote && activeNoteMode === "edit");
  const activeGlossaryIsEditing = Boolean(activeGlossaryTerm && activeGlossaryMode === "edit");
  const noteEditModalActive = activeNoteIsEditing || activeGlossaryIsEditing;
  const shouldShowSelectionConfirmation = Boolean(
    noteModeEnabled && pendingAnchor && (isMobileViewport || pendingAnchorIsGlossaryTerm),
  );
  const notePanelHasContent = Boolean(
    noteModeEnabled &&
      (shouldShowSelectionConfirmation ||
        activeNote ||
        activeGlossaryTerm ||
        pendingGlossaryTerm),
  );
  const floatingNotePanelShouldRender = noteModeEnabled && notePanelHasContent;
  const notePanelModalActive = floatingNotePanelShouldRender && !isNotePanelClosing;
  noteEditModalActiveRef.current = notePanelModalActive;

  useEffect(() => {
    notePanelHasContentRef.current = notePanelHasContent;
  }, [notePanelHasContent]);

  useEffect(() => {
    if (noteModeEnabled) return;

    resetNoteModeInteractionState();
    setGlossaryModeEnabled(false);
    setNoteLibraryOpen(false);
    setFocusedLibraryNoteId("");
    setEditingLibraryNoteId("");
  }, [noteModeEnabled]);

  useEffect(() => {
    if (
      focusedLibraryNoteId &&
      !noteLibraryNotes.some((note) => note.id === focusedLibraryNoteId)
    ) {
      setFocusedLibraryNoteId("");
    }
    if (
      editingLibraryNoteId &&
      !noteLibraryNotes.some((note) => note.id === editingLibraryNoteId)
    ) {
      setEditingLibraryNoteId("");
    }
  }, [editingLibraryNoteId, focusedLibraryNoteId, noteLibrarySignature]);

  useEffect(() => {
    if (!noteLibraryOpen) {
      setFocusedLibraryNoteId("");
      setEditingLibraryNoteId("");
    }
  }, [noteLibraryOpen]);

  useEffect(() => {
    if (!editingLibraryNoteId) return;

    window.requestAnimationFrame(() => {
      const textarea = libraryNoteTextareaRef.current;
      if (!textarea) return;

      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [editingLibraryNoteId]);

  useEffect(() => {
    function recordPointerAnchorRect(event: PointerEvent | globalThis.MouseEvent) {
      if (event.button !== 0) return;

      lastPointerAnchorRectRef.current = textRangeRectFromPoint(event.clientX, event.clientY);
    }

    window.addEventListener("pointerup", recordPointerAnchorRect, true);
    window.addEventListener("mouseup", recordPointerAnchorRect, true);

    return () => {
      window.removeEventListener("pointerup", recordPointerAnchorRect, true);
      window.removeEventListener("mouseup", recordPointerAnchorRect, true);
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(returnToViewTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileViewportQuery);

    function updateMobileViewport() {
      setIsMobileViewport(mediaQuery.matches);
    }

    updateMobileViewport();
    mediaQuery.addEventListener("change", updateMobileViewport);

    return () => {
      mediaQuery.removeEventListener("change", updateMobileViewport);
    };
  }, []);

  useLayoutEffect(() => {
    if (!noteTextareaShouldRefocusRef.current) return;

    refocusNoteTextarea();
  }, [activeGlossaryMode, activeGlossaryTermId, activeNoteId, activeNoteMode, pendingAnchor]);

  useLayoutEffect(() => {
    if (!notePanelHasContent) {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
      floatingNoteAnchorRectRef.current = null;
      setFloatingNotePanelPosition(null);
      return;
    }

    let anchorMeasureRetryCount = 0;

    function updateFloatingNotePanelPosition() {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
      floatingNotePanelPositionFrameRef.current = window.requestAnimationFrame(() => {
        const card = floatingNoteCardRef.current;
        const measuredAnchorRect = activeNote
          ? activeNoteAnchorRect(activeNote.id)
          : activeNoteId
            ? activeNoteAnchorRect(activeNoteId)
            : activeGlossaryBinding
              ? activeGlossaryAnchorRect(activeGlossaryBinding.id)
              : activeGlossaryBindingId
                ? activeGlossaryAnchorRect(activeGlossaryBindingId)
                : pendingAnchor
                  ? activeNoteAnchorRect(pendingAnchorAnnotationId) ?? currentSelectionAnchorRect()
                  : null;
        if (measuredAnchorRect) {
          anchorMeasureRetryCount = 0;
          floatingNoteAnchorRectRef.current = measuredAnchorRect;
        }
        const anchorRect = measuredAnchorRect ?? floatingNoteAnchorRectRef.current;
        const expectsAnchor = Boolean(
          activeNote ||
            activeNoteId ||
            activeGlossaryBinding ||
            activeGlossaryBindingId ||
            pendingAnchor,
        );

        if (!card) {
          setFloatingNotePanelPosition(null);
          return;
        }

        if (!anchorRect && expectsAnchor) {
          if (anchorMeasureRetryCount < 24) {
            setFloatingNotePanelPosition(null);
            anchorMeasureRetryCount += 1;
            updateFloatingNotePanelPosition();
            return;
          }

          const fallbackAnchorRect = lastPointerAnchorRectRef.current;
          if (fallbackAnchorRect) {
            const nextPosition = calculateFloatingNotePosition(
              fallbackAnchorRect,
              card.getBoundingClientRect(),
            );
            setFloatingNotePanelPosition((currentPosition) =>
              floatingNotePositionsAreEqual(currentPosition, nextPosition)
                ? currentPosition
                : nextPosition,
            );
            return;
          }

          const nextPosition = calculateDetachedFloatingNotePosition(card.getBoundingClientRect());
          setFloatingNotePanelPosition((currentPosition) =>
            floatingNotePositionsAreEqual(currentPosition, nextPosition)
              ? currentPosition
              : nextPosition,
          );
          return;
        }

        const nextPosition = anchorRect
          ? calculateFloatingNotePosition(anchorRect, card.getBoundingClientRect())
          : calculateDetachedFloatingNotePosition(card.getBoundingClientRect());
        setFloatingNotePanelPosition((currentPosition) =>
          floatingNotePositionsAreEqual(currentPosition, nextPosition)
            ? currentPosition
            : nextPosition,
        );
      });
    }

    updateFloatingNotePanelPosition();
    document.addEventListener("scroll", updateFloatingNotePanelPosition, true);
    window.addEventListener("resize", updateFloatingNotePanelPosition);

    return () => {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
      document.removeEventListener("scroll", updateFloatingNotePanelPosition, true);
      window.removeEventListener("resize", updateFloatingNotePanelPosition);
    };
  }, [
    activeGlossaryBinding,
    activeGlossaryBindingId,
    activeGlossaryMode,
    activeGlossaryTerm,
    activeNote,
    activeNoteId,
    activeNoteMode,
    editorMode,
    glossaryDraft,
    noteDraft,
    notePanelHasContent,
    pendingAnchor,
    pendingGlossaryTerm,
    selectedDocument.body,
  ]);

  function elementFromEventTarget(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  }

  function pointHitsRect(clientX: number, clientY: number, rect: DOMRect) {
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function pointHitsAnyRect(clientX: number, clientY: number, rects: DOMRect[]) {
    return rects.some((rect) => pointHitsRect(clientX, clientY, rect));
  }

  function textRangeRectFromClientRects(rects: DOMRect[]): TextRangeRect | null {
    const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    if (visibleRects.length === 0) return null;

    const left = Math.min(...visibleRects.map((rect) => rect.left));
    const top = Math.min(...visibleRects.map((rect) => rect.top));
    const right = Math.max(...visibleRects.map((rect) => rect.right));
    const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));

    return {
      bottom,
      height: bottom - top,
      left,
      right,
      targetBottom: bottom,
      targetTop: top,
      targetX: left + (right - left) / 2,
      targetY: top + (bottom - top) / 2,
      top,
      width: right - left,
    };
  }

  function lineRectsFromClientRects(rects: DOMRect[]) {
    const visibleRects = rects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const lineRects: TextRangeRect[] = [];

    visibleRects.forEach((rect) => {
      const rectCenterY = rect.top + rect.height / 2;
      const currentLine = lineRects[lineRects.length - 1];
      const currentLineCenterY = currentLine
        ? currentLine.top + currentLine.height / 2
        : 0;
      const lineTolerance = currentLine
        ? Math.max(2, Math.min(rect.height, currentLine.height) * 0.5)
        : 0;

      if (!currentLine || Math.abs(rectCenterY - currentLineCenterY) > lineTolerance) {
        lineRects.push({
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          targetBottom: rect.bottom,
          targetTop: rect.top,
          targetX: rect.left + rect.width / 2,
          targetY: rect.top + rect.height / 2,
          top: rect.top,
          width: rect.width,
        });
        return;
      }

      currentLine.left = Math.min(currentLine.left, rect.left);
      currentLine.right = Math.max(currentLine.right, rect.right);
      currentLine.top = Math.min(currentLine.top, rect.top);
      currentLine.bottom = Math.max(currentLine.bottom, rect.bottom);
      currentLine.width = currentLine.right - currentLine.left;
      currentLine.height = currentLine.bottom - currentLine.top;
      currentLine.targetBottom = currentLine.bottom;
      currentLine.targetTop = currentLine.top;
      currentLine.targetX = currentLine.left + currentLine.width / 2;
      currentLine.targetY = currentLine.top + currentLine.height / 2;
    });

    return lineRects;
  }

  function textAnchorRectFromClientRects(rects: DOMRect[]): TextRangeRect | null {
    const fullRect = textRangeRectFromClientRects(rects);
    if (!fullRect) return null;

    const lineRects = lineRectsFromClientRects(rects);
    if (lineRects.length === 0) return fullRect;

    const referenceMiddleX = fullRect.left + fullRect.width / 2;
    const linesCoveringMiddle = lineRects.filter(
      (lineRect) => lineRect.left <= referenceMiddleX && lineRect.right >= referenceMiddleX,
    );
    const targetLine =
      linesCoveringMiddle[linesCoveringMiddle.length - 1] ?? lineRects[lineRects.length - 1];

    return {
      ...fullRect,
      targetBottom: targetLine.targetBottom,
      targetTop: targetLine.targetTop,
      targetX: targetLine.targetX,
      targetY: targetLine.targetY,
    };
  }

  function textRangeRectFromPoint(clientX: number, clientY: number): TextRangeRect {
    return {
      bottom: clientY + 1,
      height: 1,
      left: clientX,
      right: clientX + 1,
      targetBottom: clientY + 1,
      targetTop: clientY,
      targetX: clientX,
      targetY: clientY,
      top: clientY,
      width: 1,
    };
  }

  function currentSelectionAnchorRect() {
    const selection = window.getSelection();

    if (selection && !selection.isCollapsed) {
      const selectionRects = Array.from({ length: selection.rangeCount }).flatMap((_, index) =>
        Array.from(selection.getRangeAt(index).getClientRects()),
      );
      const selectionRect = textAnchorRectFromClientRects(selectionRects);
      if (selectionRect) return selectionRect;
    }

    const editorSelectionRects = Array.from(
      document.querySelectorAll<HTMLElement>(".cm-selectionBackground"),
    ).flatMap((element) => Array.from(element.getClientRects()));

    return textAnchorRectFromClientRects(editorSelectionRects);
  }

  function selectionWarningPositionFromAnchor(anchorRect: TextRangeRect | null) {
    const warningWidth = 260;
    const warningHeight = 44;
    const viewportMargin = 12;
    const maxLeft = Math.max(viewportMargin, window.innerWidth - warningWidth - viewportMargin);
    const maxTop = Math.max(viewportMargin, window.innerHeight - warningHeight - viewportMargin);

    if (!anchorRect) {
      return {
        left: Math.round(clampNumber(window.innerWidth / 2 - warningWidth / 2, viewportMargin, maxLeft)),
        top: viewportMargin,
      };
    }

    return {
      left: Math.round(clampNumber(anchorRect.left, viewportMargin, maxLeft)),
      top: Math.round(clampNumber(anchorRect.bottom + 8, viewportMargin, maxTop)),
    };
  }

  function annotationAnchorRect(annotationId: string) {
    const frameElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-annotation-frame[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-annotation-frame[data-note-id]",
      ),
    ).filter((element) => element.dataset.noteId === annotationId);
    const frameRects = frameElements.flatMap((element) =>
      Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0),
    );
    const frameAnchorRect = textAnchorRectFromClientRects(frameRects);
    if (frameAnchorRect) return frameAnchorRect;

    const textElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-note-annotation[data-note-id], .preview-note-annotation[data-note-id], .milkdown-note-annotation[data-note-id]",
      ),
    ).filter((element) => element.dataset.noteId === annotationId);
    const textRects = textElements.flatMap((element) =>
      Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0),
    );

    return textAnchorRectFromClientRects(textRects);
  }

  function activeNoteAnchorRect(noteId: string) {
    return annotationAnchorRect(noteId);
  }

  function activeGlossaryAnchorRect(bindingId: string) {
    return annotationAnchorRect(`glossary:${bindingId}`);
  }

  function calculateFloatingNotePosition(
    anchorRect: TextRangeRect,
    cardRect: DOMRect,
  ): FloatingNotePosition {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = 12;
    const noteGap = 8;
    const cardWidth = Math.min(
      cardRect.width || 450,
      Math.max(180, viewportWidth - viewportMargin * 2),
    );
    const cardHeight = cardRect.height || 260;
    const belowRoom = viewportHeight - anchorRect.bottom - noteGap - viewportMargin;
    const aboveRoom = anchorRect.top - noteGap - viewportMargin;
    const preferredHeight = Math.min(cardHeight, 280);
    const placement =
      belowRoom >= preferredHeight || belowRoom >= aboveRoom ? "below" : "above";
    const availableHeight = placement === "below" ? belowRoom : aboveRoom;
    const maxHeight = Math.min(
      360,
      Math.max(120, availableHeight > 0 ? availableHeight : cardHeight),
      Math.max(120, viewportHeight - viewportMargin * 2),
    );
    const positionedHeight = Math.min(cardHeight, maxHeight);
    const connectorAnchorGap = 6;
    const panelAnchorY =
      placement === "below"
        ? anchorRect.bottom + connectorAnchorGap
        : anchorRect.top - connectorAnchorGap;
    const targetX = anchorRect.targetX;
    const targetY = placement === "below" ? anchorRect.targetBottom : anchorRect.targetTop;
    const preferredLeft = clampNumber(
      targetX - cardWidth / 2,
      viewportMargin,
      viewportWidth - viewportMargin - cardWidth,
    );
    const left = preferredLeft;
    const right = left + cardWidth;
    const verticalDistance = 12;
    const connectorTilt = verticalDistance * 0.65;
    const preferredSourceX =
      targetX + (targetX < viewportWidth / 2 ? connectorTilt : -connectorTilt);
    const minSourceX = Math.max(left, targetX - verticalDistance);
    const maxSourceX = Math.min(right, targetX + verticalDistance);
    const sourceX =
      minSourceX <= maxSourceX
        ? clampNumber(preferredSourceX, minSourceX, maxSourceX)
        : clampNumber(targetX, left, right);
    const top =
      placement === "below"
        ? panelAnchorY + verticalDistance
        : panelAnchorY - positionedHeight - verticalDistance;
    const sourceY = placement === "below" ? top : top + positionedHeight;
    const connectorDeltaX = sourceX - targetX;
    const connectorDeltaY = sourceY - targetY;
    const connectorWidth = Math.max(
      0,
      Math.sqrt(connectorDeltaX * connectorDeltaX + connectorDeltaY * connectorDeltaY),
    );
    const connectorAngle =
      Math.atan2(connectorDeltaY, connectorDeltaX) * (180 / Math.PI);

    return {
      connector: {
        angle: Math.round(connectorAngle * 100) / 100,
        left: Math.round(targetX),
        top: Math.round(targetY),
        width: Math.round(connectorWidth),
      },
      left: Math.round(left),
      maxHeight: Math.round(maxHeight),
      placement,
      top: Math.round(top),
    };
  }

  function calculateDetachedFloatingNotePosition(cardRect: DOMRect): FloatingNotePosition {
    const viewportHeight = window.innerHeight;
    const viewportMargin = 12;
    const cardHeight = cardRect.height || 260;
    const maxHeight = Math.min(
      360,
      Math.max(120, viewportHeight - viewportMargin * 2),
    );
    const positionedHeight = Math.min(cardHeight, maxHeight);

    return {
      connector: null,
      left: viewportMargin,
      maxHeight: Math.round(maxHeight),
      placement: "detached",
      top: Math.round(viewportHeight - viewportMargin - positionedHeight),
    };
  }

  function floatingNotePositionsAreEqual(
    leftPosition: FloatingNotePosition | null,
    rightPosition: FloatingNotePosition,
  ) {
    return (
      leftPosition?.left === rightPosition.left &&
      leftPosition.top === rightPosition.top &&
      leftPosition.maxHeight === rightPosition.maxHeight &&
      leftPosition.placement === rightPosition.placement &&
      leftPosition.connector?.left === rightPosition.connector?.left &&
      leftPosition.connector?.top === rightPosition.connector?.top &&
      leftPosition.connector?.width === rightPosition.connector?.width &&
      leftPosition.connector?.angle === rightPosition.connector?.angle
    );
  }

  function targetIsInsideNotePanel(target: EventTarget | null) {
    const panel = notePanelRef.current;
    return Boolean(panel && target instanceof Node && panel.contains(target));
  }

  function refocusNoteTextarea(remainingAttempts = 8) {
    window.requestAnimationFrame(() => {
      const textarea = noteTextareaRef.current;
      if (!textarea || textarea.disabled) {
        if (remainingAttempts > 0) {
          refocusNoteTextarea(remainingAttempts - 1);
        }
        return;
      }

      noteTextareaShouldRefocusRef.current = false;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  function insertTextIntoActiveNoteEditor(text: string) {
    if (!text) return false;

    if (activeNoteIsEditing && activeNote) {
      const nextDraft = `${noteDraftRef.current}${text}`;
      setNoteDraft(nextDraft);
      updateNoteBody(activeNote.id, nextDraft);
      noteTextareaShouldRefocusRef.current = true;
      refocusNoteTextarea();
      return true;
    }

    if (activeGlossaryIsEditing && activeGlossaryTerm) {
      const nextDraft = `${glossaryDraftRef.current}${text}`;
      setGlossaryDraft(nextDraft);
      updateGlossaryDefinition(activeGlossaryTerm.id, nextDraft);
      noteTextareaShouldRefocusRef.current = true;
      refocusNoteTextarea();
      return true;
    }

    return false;
  }

  function redirectOutsideNoteEditKeyboardEvent(event: KeyboardEvent) {
    if (targetIsInsideNotePanel(event.target)) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.length !== 1 || event.isComposing) return false;

    if (!insertTextIntoActiveNoteEditor(event.key)) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function redirectOutsideNoteEditInputEvent(event: Event) {
    if (targetIsInsideNotePanel(event.target)) return false;

    if (event instanceof InputEvent && event.data) {
      if (!insertTextIntoActiveNoteEditor(event.data)) return false;

      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event instanceof ClipboardEvent) {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text && insertTextIntoActiveNoteEditor(text)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }

    return false;
  }

  function blockNoteEditBackdropInteraction(event: {
    preventDefault(): void;
    stopPropagation(): void;
  }) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleNotePanelOutsideModalInteraction(event: {
    preventDefault(): void;
    stopPropagation(): void;
  }) {
    event.preventDefault();
    event.stopPropagation();

    dismissNotePanelFromAppInteraction();
  }

  function handleFloatingNotePanelBlur(event: FocusEvent<HTMLElement>) {
    if (!notePanelHasContentRef.current || isNotePanelClosing) return;

    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    closeNotePanel();
  }

  function targetIsActiveNoteRange(target: EventTarget | null) {
    if (!activeNoteId && !activeGlossaryBindingId) return false;

    const targetElement = elementFromEventTarget(target);
    const noteElement = targetElement?.closest<HTMLElement>(
      ".cm-note-annotation[data-note-id], .cm-annotation-frame[data-note-id], .preview-note-annotation[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
    );

    return (
      noteElement?.dataset.noteId === activeNoteId ||
      noteElement?.dataset.noteId === `glossary:${activeGlossaryBindingId}`
    );
  }

  function pointHitsActiveNoteRange(clientX: number, clientY: number) {
    if (!activeNoteId && !activeGlossaryBindingId) return false;

    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-note-annotation[data-note-id], .cm-annotation-frame[data-note-id], .preview-note-annotation[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
      ),
    ).some((element) => {
      const isActiveNote = element.dataset.noteId === activeNoteId;
      const isActiveGlossary = element.dataset.noteId === `glossary:${activeGlossaryBindingId}`;
      if (!isActiveNote && !isActiveGlossary) return false;
      return pointHitsAnyRect(clientX, clientY, Array.from(element.getClientRects()));
    });
  }

  function pointHitsCurrentSelection(clientX: number, clientY: number) {
    if (!pendingAnchor) return false;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        if (
          pointHitsAnyRect(
            clientX,
            clientY,
            Array.from(selection.getRangeAt(index).getClientRects()),
          )
        ) {
          return true;
        }
      }
    }

    return Array.from(document.querySelectorAll<HTMLElement>(".cm-selectionBackground")).some(
      (element) => pointHitsAnyRect(clientX, clientY, Array.from(element.getClientRects())),
    );
  }

  function notePanelKeepsFocus(target: EventTarget | null, clientX?: number, clientY?: number) {
    if (targetIsInsideNotePanel(target) || targetIsActiveNoteRange(target)) return true;

    if (typeof clientX === "number" && typeof clientY === "number") {
      return (
        pointHitsActiveNoteRange(clientX, clientY) ||
        pointHitsCurrentSelection(clientX, clientY)
      );
    }

    return false;
  }

  function dismissNotePanelFromAppInteraction() {
    selectionDismissedUntilRef.current = Date.now() + 700;
    window.getSelection()?.removeAllRanges();
    closeNotePanel();
  }

  function targetIsFormControl(target: EventTarget | null) {
    const targetElement = elementFromEventTarget(target);

    return Boolean(targetElement?.closest("input, textarea, select"));
  }

  useEffect(() => {
    if (!notePanelHasContent || isNotePanelClosing) return;

    function handleDocumentPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (notePanelModalActive) {
        if (targetIsInsideNotePanel(event.target)) return;

        handleNotePanelOutsideModalInteraction(event);
        return;
      }
      if (notePanelKeepsFocus(event.target, event.clientX, event.clientY)) return;

      dismissNotePanelFromAppInteraction();
    }

    function handleDocumentMouseDown(event: globalThis.MouseEvent) {
      if (event.button !== 0) return;
      if (notePanelModalActive) {
        if (targetIsInsideNotePanel(event.target)) return;

        handleNotePanelOutsideModalInteraction(event);
        return;
      }
      if (notePanelKeepsFocus(event.target, event.clientX, event.clientY)) return;

      dismissNotePanelFromAppInteraction();
    }

    function handleDocumentFocusIn(event: Event) {
      if (notePanelModalActive) {
        if (targetIsInsideNotePanel(event.target)) return;

        handleNotePanelOutsideModalInteraction(event);
        return;
      }
      if (notePanelKeepsFocus(event.target)) return;

      dismissNotePanelFromAppInteraction();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("mousedown", handleDocumentMouseDown, true);
    document.addEventListener("focusin", handleDocumentFocusIn, true);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      document.removeEventListener("focusin", handleDocumentFocusIn, true);
    };
  }, [
    activeGlossaryBindingId,
    activeNoteId,
    isNotePanelClosing,
    noteEditModalActive,
    notePanelModalActive,
    notePanelHasContent,
    pendingAnchor,
  ]);

  useEffect(() => {
    if (!notePanelHasContent || isNotePanelClosing) return;

    function handleWindowBlur() {
      closeNotePanel();
    }

    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [closeNotePanel, isNotePanelClosing, notePanelHasContent]);

  useEffect(() => {
    if (!noteEditModalActive) return;

    refocusNoteTextarea();

    function blockOutsideEditableEvent(event: Event) {
      if (targetIsInsideNotePanel(event.target)) return;
      if (redirectOutsideNoteEditInputEvent(event)) return;

      blockNoteEditBackdropInteraction(event);
    }

    document.addEventListener("beforeinput", blockOutsideEditableEvent, true);
    document.addEventListener("compositionstart", blockOutsideEditableEvent, true);
    document.addEventListener("drop", blockOutsideEditableEvent, true);
    document.addEventListener("paste", blockOutsideEditableEvent, true);

    return () => {
      document.removeEventListener("beforeinput", blockOutsideEditableEvent, true);
      document.removeEventListener("compositionstart", blockOutsideEditableEvent, true);
      document.removeEventListener("drop", blockOutsideEditableEvent, true);
      document.removeEventListener("paste", blockOutsideEditableEvent, true);
    };
  }, [noteEditModalActive]);

  useEffect(() => {
    if (!selectionWarningPosition) return;

    function dismissSelectionWarning() {
      setSelectionWarningPosition(null);
    }

    document.addEventListener("pointerdown", dismissSelectionWarning, true);

    return () => {
      document.removeEventListener("pointerdown", dismissSelectionWarning, true);
    };
  }, [selectionWarningPosition]);

  useEffect(() => {
    if (!fileContextMenu) return;

    function dismissFileContextMenu() {
      setFileContextMenu(null);
    }

    function handleFileContextMenuKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      setFileContextMenu(null);
    }

    document.addEventListener("pointerdown", dismissFileContextMenu);
    document.addEventListener("scroll", dismissFileContextMenu, true);
    window.addEventListener("keydown", handleFileContextMenuKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", dismissFileContextMenu);
      document.removeEventListener("scroll", dismissFileContextMenu, true);
      window.removeEventListener("keydown", handleFileContextMenuKeyDown, true);
    };
  }, [fileContextMenu]);

  useEffect(() => {
    return () => {
      window.clearTimeout(notePanelCloseTimerRef.current);
      window.clearTimeout(autosaveTimerRef.current);
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(autosaveTimerRef.current);

    if (!nativeStorageAvailable) return;

    const hasDirtyLocalDocument = documents.some(
      (document) =>
        Boolean(document.filePath) && hasDirtyState(dirtyDocumentStates[document.id]),
    );
    if (!hasDirtyLocalDocument) return;

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveDirtyDocuments();
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [dirtyDocumentStates, documents, glossaryBindings, glossaryTerms, nativeStorageAvailable, notes]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    function refreshCleanDocument() {
      if (document.visibilityState === "hidden") return;

      void refreshSelectedDocumentFromDisk();
    }

    window.addEventListener("focus", refreshCleanDocument);
    document.addEventListener("visibilitychange", refreshCleanDocument);

    return () => {
      window.removeEventListener("focus", refreshCleanDocument);
      document.removeEventListener("visibilitychange", refreshCleanDocument);
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable || lastOpenedFileRestoreAttemptedRef.current) return;

    lastOpenedFileRestoreAttemptedRef.current = true;
    const lastOpenedPath = readLastOpenedMarkdownPath();
    if (!lastOpenedPath) return;

    setStorageError("Opening last file...");

    void invoke<OpenMarkdownFileContextResult>("open_markdown_file_context", {
      path: lastOpenedPath,
    })
      .then((context) => {
        applyOpenedDirectory(directoryWithSelectedFile(context), context.selectedFile.path, {
          rememberRecent: false,
        });
        setStorageError("");
      })
      .catch((error) => {
        forgetLastOpenedMarkdownPath();
        setStorageError(
          `Could not reopen last file: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let unlistenNewFile: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    let unlistenOpenFolder: (() => void) | null = null;
    let unlistenOpenLocation: (() => void) | null = null;

    void Promise.all([
      listen("scholium-new-file", () => {
        newMarkdownFileHandlerRef.current();
      }),
      listen("scholium-open-file", () => {
        openMarkdownFileHandlerRef.current();
      }),
      listen("scholium-open-folder", () => {
        openMarkdownFolderHandlerRef.current();
      }),
      listen<OpenLocationEventPayload>("scholium-open-location", (event) => {
        void openNativeMenuLocation(event.payload);
      }),
    ]).then(
      ([
        newFileListener,
        openFileListener,
        openFolderListener,
        openLocationListener,
      ]) => {
        unlistenNewFile = newFileListener;
        unlistenOpenFile = openFileListener;
        unlistenOpenFolder = openFolderListener;
        unlistenOpenLocation = openLocationListener;
      },
    );

    return () => {
      unlistenNewFile?.();
      unlistenOpenFile?.();
      unlistenOpenFolder?.();
      unlistenOpenLocation?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    function handleModeShortcut(event: KeyboardEvent) {
      const isAnnotationNavigationTab =
        event.key === "Tab" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      const isPlainEnter =
        event.key === "Enter" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;

      if (event.key === "Escape" && (notePanelHasContentRef.current || pendingAnchor)) {
        event.preventDefault();
        closeNotePanel();
        return;
      }

      if (noteEditModalActive) {
        if (
          isAnnotationNavigationTab &&
          focusAdjacentFloatingAnnotation(event.shiftKey ? -1 : 1)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (redirectOutsideNoteEditKeyboardEvent(event)) return;
        if (!targetIsInsideNotePanel(event.target)) {
          blockNoteEditBackdropInteraction(event);
        }
        return;
      }

      if (notePanelModalActive) {
        if (
          isAnnotationNavigationTab &&
          focusAdjacentFloatingAnnotation(event.shiftKey ? -1 : 1)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (targetIsInsideNotePanel(event.target)) return;

        blockNoteEditBackdropInteraction(event);
        return;
      }

      if (isPlainEnter && pendingAnchor && pendingAnchorIsGlossaryTerm) {
        if (targetIsFormControl(event.target)) return;

        event.preventDefault();
        startPendingGlossaryFlow();
        return;
      }

      if (isPlainEnter && pendingAnchor && pendingAnchorIsCompleteBlock) {
        if (targetIsFormControl(event.target)) return;

        event.preventDefault();
        confirmPendingSelectionNote();
        return;
      }

      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "/" && event.code !== "Slash") return;

      event.preventDefault();
      closeNotePanel();
      setEditorMode((currentMode) => (currentMode === "preview" ? "edit" : "preview"));
    }

    window.addEventListener("keydown", handleModeShortcut, true);

    return () => {
      window.removeEventListener("keydown", handleModeShortcut, true);
    };
  }, [
    activeGlossaryBindingId,
    activeNoteId,
    closeNotePanel,
    glossaryNavigationSignature,
    noteLibrarySignature,
    noteEditModalActive,
    notePanelModalActive,
    pendingAnchor,
    pendingAnchorIsCompleteBlock,
    pendingAnchorIsGlossaryTerm,
  ]);

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
    if (!documentId || documentId === emptyDocument.id) return;

    updateDocumentDirtyState(documentId, { notes: true });
  }

  function markGlossaryTermDirty(termId: string) {
    const documentIds = new Set(
      glossaryBindingsRef.current
        .filter((binding) => binding.termId === termId && binding.status !== "deleted")
        .map((binding) => binding.documentId),
    );

    if (documentIds.size === 0) {
      markDocumentNotesDirty();
      return;
    }

    documentIds.forEach((documentId) => markDocumentNotesDirty(documentId));
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

  function rememberNativeRecentLocation(location: NativeLocation) {
    if (!nativeStorageAvailable) return;

    void invoke("remember_recent_location", location).catch((error) => {
      setStorageError(error instanceof Error ? error.message : String(error));
    });
  }

  function setNativeCurrentDirectory(path: string, title: string) {
    if (!nativeStorageAvailable) return;

    void invoke("set_current_directory_location", { path, title }).catch((error) => {
      setStorageError(error instanceof Error ? error.message : String(error));
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

  function directoryWithSelectedFile(context: OpenMarkdownFileContextResult) {
    const selectedFileEntryExists = context.directory.entries.some(
      (entry) => entry.kind === "file" && entry.file.path === context.selectedFile.path,
    );

    if (selectedFileEntryExists) {
      return context.directory;
    }

    return {
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
  }

  function applyLoadedFiles(
    loadedFiles: OpenMarkdownFileResult[],
    options: { rememberRecent?: boolean } = {},
  ) {
    if (loadedFiles.length === 0) {
      setStorageError("No Markdown files found in the selected folder.");
      return;
    }

    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();

    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedDocumentIds = new Set(loadedDocuments.map((document) => document.id));
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => ({
        ...note,
        documentId: loadedFile.path,
      })),
    );
    const loadedGlossaryBindings = loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) => ({
        ...binding,
        documentId: loadedFile.path,
      })),
    );
    const loadedGlossaryTerms = loadedFiles.flatMap(
      (loadedFile) => loadedFile.glossaryTerms ?? [],
    );
    const firstDocument = loadedDocuments[0];

    setDocuments((currentDocuments) => [
      ...loadedDocuments,
      ...currentDocuments.filter((document) => !loadedDocumentIds.has(document.id)),
    ]);
    setWorkspaceEntries((currentEntries) => {
      const parentEntries = currentEntries.filter((entry) => entry.kind === "parent-directory");
      const otherEntries = currentEntries.filter(
        (entry) =>
          entry.kind !== "parent-directory" &&
          (entry.kind !== "file" || !loadedDocumentIds.has(entry.documentId)),
      );

      return [...parentEntries, ...loadedDocuments.map(workspaceEntryFromDocument), ...otherEntries];
    });
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => !loadedDocumentIds.has(note.documentId)),
    ]);
    setGlossaryBindings((currentBindings) => [
      ...loadedGlossaryBindings,
      ...currentBindings.filter((binding) => !loadedDocumentIds.has(binding.documentId)),
    ]);
    setGlossaryTerms((currentTerms) => mergeGlossaryTerms(loadedGlossaryTerms, currentTerms));
    setSelectedDocumentId(firstDocument.id);
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    markLoadedDocumentsClean(loadedDocuments);
    rememberLastOpenedMarkdownPath(firstDocument.filePath);
    if (options.rememberRecent !== false) {
      loadedFiles.forEach((loadedFile) => {
        rememberNativeRecentLocation({
          kind: "file",
          path: loadedFile.path,
          title: loadedFile.title,
        });
      });
    }
  }

  function applyReloadedFile(loadedFile: OpenMarkdownFileResult) {
    const loadedDocument = documentFromLoadedFile(loadedFile);
    const documentId = loadedDocument.id;
    const loadedNotes = loadedFile.notes.map((note) => ({
      ...note,
      documentId,
    }));
    const loadedGlossaryBindings = (loadedFile.glossaryBindings ?? []).map((binding) => ({
      ...binding,
      documentId,
    }));
    const loadedGlossaryTerms = loadedFile.glossaryTerms ?? [];

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === documentId ? { ...loadedDocument, updatedAt: document.updatedAt } : document,
      ),
    );
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => note.documentId !== documentId),
    ]);
    setGlossaryBindings((currentBindings) => [
      ...loadedGlossaryBindings,
      ...currentBindings.filter((binding) => binding.documentId !== documentId),
    ]);
    setGlossaryTerms((currentTerms) => mergeGlossaryTerms(loadedGlossaryTerms, currentTerms));
    markLoadedDocumentsClean([loadedDocument]);
  }

  async function refreshSelectedDocumentFromDisk() {
    if (!nativeStorageAvailable) return;

    const documentId = selectedDocumentIdRef.current;
    if (!documentId) return;
    if (hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;

    const documentToRefresh = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToRefresh?.filePath) return;

    try {
      const loaded = await invoke<OpenMarkdownFileResult>("open_markdown_file", {
        path: documentToRefresh.filePath,
      });
      const currentDocument = documentsRef.current.find((document) => document.id === documentId);
      if (!currentDocument || hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;
      if (loaded.body === currentDocument.body) return;

      applyReloadedFile(loaded);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function applyOpenedDirectory(
    openedDirectory: OpenMarkdownDirectoryResult,
    selectedPath?: string,
    options: { rememberRecent?: boolean } = {},
  ) {
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();

    const loadedFiles = openedDirectory.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : [],
    );
    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => ({
        ...note,
        documentId: loadedFile.path,
      })),
    );
    const loadedGlossaryBindings = loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) => ({
        ...binding,
        documentId: loadedFile.path,
      })),
    );
    const loadedGlossaryTerms = loadedFiles.flatMap(
      (loadedFile) => loadedFile.glossaryTerms ?? [],
    );
    const childEntries = openedDirectory.entries.map((entry): WorkspaceEntry => {
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
    const nextEntries: WorkspaceEntry[] = openedDirectory.parentPath
      ? [
          {
            kind: "parent-directory",
            id: `parent-directory:${openedDirectory.parentPath}`,
            title: "上一層",
            path: openedDirectory.parentPath,
          },
          ...childEntries,
        ]
      : childEntries;
    const firstDocument = loadedDocuments[0];
    const selectedDocument = selectedPath
      ? loadedDocuments.find((document) => document.id === selectedPath)
      : firstDocument;
    const documentToSelect = selectedDocument ?? firstDocument;

    setDocuments(loadedDocuments);
    setNotes(loadedNotes);
    setGlossaryBindings(loadedGlossaryBindings);
    setGlossaryTerms(mergeGlossaryTerms(loadedGlossaryTerms, []));
    setWorkspaceTitle(openedDirectory.title);
    setWorkspaceEntries(nextEntries);
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    markLoadedDocumentsClean(loadedDocuments);

    if (documentToSelect) {
      setSelectedDocumentId(documentToSelect.id);
      rememberLastOpenedMarkdownPath(documentToSelect.filePath);
    } else {
      setSelectedDocumentId("");
      forgetLastOpenedMarkdownPath();
    }
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");

    if (nextEntries.length === 0) {
      setStorageError("No folders or Markdown files found in the selected folder.");
    } else {
      setStorageError("");
    }

    if (options.rememberRecent !== false) {
      rememberNativeRecentLocation({
        kind: "directory",
        path: openedDirectory.path,
        title: openedDirectory.title,
      });
    }
    setNativeCurrentDirectory(openedDirectory.path, openedDirectory.title);
  }

  async function openDirectoryPath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("Opening folder...");

    try {
      const openedDirectory = await invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", {
        path,
      });
      applyOpenedDirectory(openedDirectory);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMarkdownFilePath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("Opening file...");

    try {
      const context = await invoke<OpenMarkdownFileContextResult>("open_markdown_file_context", {
        path,
      });

      applyOpenedDirectory(directoryWithSelectedFile(context), context.selectedFile.path);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openNativeMenuLocation(location: OpenLocationEventPayload) {
    if (location.kind === "directory") {
      await openDirectoryPath(location.path);
      return;
    }

    await openMarkdownFilePath(location.path);
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

      await openMarkdownFilePath(selectedPath);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function newMarkdownFile() {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    setStorageError("");

    try {
      const selectedPath = await save({
        defaultPath: "Untitled.md",
        filters: markdownFilters,
      });
      if (!selectedPath) return;

      const path = ensureMarkdownExtension(selectedPath);
      const body = "";
      const saved = await invoke<SaveMarkdownFileResult>("save_markdown_file", {
        path,
        body,
        notes: [],
        glossaryTerms: [],
        glossaryBindings: [],
      });
      const loaded = await invoke<OpenMarkdownFileResult>("open_markdown_file", {
        path: saved.path,
      });

      applyLoadedFiles([loaded]);
      setEditorMode("edit");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function isTransientEmptySelectionNote(note: SelectionNote) {
    return note.id === transientSelectionNoteIdRef.current && !note.body.trim();
  }

  function notesForDocument(documentId: string, sourceNotes = notesRef.current) {
    return sourceNotes.filter(
      (note) =>
        note.documentId === documentId &&
        note.status !== "deleted" &&
        selectionNoteHasContent(note) &&
        !isTransientEmptySelectionNote(note),
    );
  }

  function glossaryBindingsForDocument(
    documentId: string,
    sourceBindings = glossaryBindingsRef.current,
    sourceTerms = glossaryTermsRef.current,
  ) {
    const termIdsWithContent = new Set(
      sourceTerms.filter(glossaryTermHasContent).map((term) => term.id),
    );

    return sourceBindings.filter(
      (binding) =>
        binding.documentId === documentId &&
        binding.status !== "deleted" &&
        termIdsWithContent.has(binding.termId),
    );
  }

  function glossaryTermsForDocument(
    documentId: string,
    sourceBindings = glossaryBindingsRef.current,
    sourceTerms = glossaryTermsRef.current,
  ) {
    const termIds = new Set(
      glossaryBindingsForDocument(documentId, sourceBindings, sourceTerms).map(
        (binding) => binding.termId,
      ),
    );

    return sourceTerms.filter((term) => termIds.has(term.id) && glossaryTermHasContent(term));
  }

  function sidecarFingerprint(
    sourceNotes: SelectionNote[],
    sourceGlossaryTerms: GlossaryTerm[],
    sourceGlossaryBindings: GlossaryBinding[],
  ) {
    return JSON.stringify({
      notes: sourceNotes,
      glossaryTerms: sourceGlossaryTerms,
      glossaryBindings: sourceGlossaryBindings,
    });
  }

  function markDocumentSnapshotSaved(
    documentId: string,
    savedBody: string,
    savedSidecarFingerprint: string,
  ) {
    setSavedDocumentBodies((currentBodies) => ({
      ...currentBodies,
      [documentId]: savedBody,
    }));
    setDirtyDocumentStates((currentStates) => {
      const currentDocument = documentsRef.current.find((document) => document.id === documentId);
      const currentSidecarFingerprint = sidecarFingerprint(
        notesForDocument(documentId),
        glossaryTermsForDocument(documentId),
        glossaryBindingsForDocument(documentId),
      );
      const nextState: DirtyDocumentState = {
        body: currentDocument ? currentDocument.body !== savedBody : false,
        notes: currentSidecarFingerprint !== savedSidecarFingerprint,
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

  async function saveDocumentToDisk(documentToSave: MarkdownDocument) {
    if (!documentToSave.filePath) return;

    const bodyToSave = documentToSave.body;
    const savedBodySnapshot =
      savedDocumentBodiesRef.current[documentToSave.id] ?? documentToSave.body;
    const currentDiskFile = await invoke<OpenMarkdownFileResult>("open_markdown_file", {
      path: documentToSave.filePath,
    });
    if (currentDiskFile.body !== savedBodySnapshot && currentDiskFile.body !== bodyToSave) {
      throw new Error(
        "檔案已在 Scholium 外更新，已停止自動儲存以避免覆蓋磁碟內容。請重新開啟檔案後再編輯。",
      );
    }

    const notesToSave = notesForDocument(documentToSave.id);
    const glossaryBindingsToSave = glossaryBindingsForDocument(documentToSave.id);
    const glossaryTermsToSave = glossaryTermsForDocument(documentToSave.id);
    const savedSidecarFingerprint = sidecarFingerprint(
      notesToSave,
      glossaryTermsToSave,
      glossaryBindingsToSave,
    );
    const saved = await invoke<SaveMarkdownFileResult>("save_markdown_file", {
      path: documentToSave.filePath,
      body: bodyToSave,
      notes: notesToSave,
      glossaryTerms: glossaryTermsToSave,
      glossaryBindings: glossaryBindingsToSave,
    });

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === documentToSave.id
          ? {
              ...document,
              filePath: saved.path,
              path: saved.path,
              notesPath: saved.notesPath,
              updatedAt: `Saved ${nowLabel()}`,
            }
          : document,
      ),
    );
    markDocumentSnapshotSaved(documentToSave.id, bodyToSave, savedSidecarFingerprint);
  }

  async function saveDirtyDocuments() {
    if (!nativeStorageAvailable) return;

    if (autosaveInFlightRef.current) {
      autosaveRequestedWhileSavingRef.current = true;
      return;
    }

    const dirtyDocuments = documentsRef.current.filter(
      (document) =>
        Boolean(document.filePath) &&
        hasDirtyState(dirtyDocumentStatesRef.current[document.id]),
    );
    if (dirtyDocuments.length === 0) return;

    autosaveInFlightRef.current = true;
    setStorageError("");

    try {
      for (const documentToSave of dirtyDocuments) {
        await saveDocumentToDisk(documentToSave);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      autosaveInFlightRef.current = false;

      if (autosaveRequestedWhileSavingRef.current) {
        autosaveRequestedWhileSavingRef.current = false;
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = window.setTimeout(() => {
          void saveDirtyDocuments();
        }, autosaveDelayMs);
      }
    }
  }

  function fileNameFromPath(path: string | null | undefined) {
    const segments = path?.split(/[\\/]/).filter(Boolean) ?? [];

    return segments[segments.length - 1] ?? "";
  }

  function defaultDuplicateFileName(documentToDuplicate: MarkdownDocument) {
    const fileName = fileNameFromPath(documentToDuplicate.filePath ?? documentToDuplicate.path);
    const fallbackName = `${documentToDuplicate.title || "Untitled"} 副本.md`;
    if (!fileName) return fallbackName;

    const extensionStart = fileName.lastIndexOf(".");
    if (extensionStart <= 0) return `${fileName} 副本.md`;

    return `${fileName.slice(0, extensionStart)} 副本${fileName.slice(extensionStart)}`;
  }

  async function writeTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();

    try {
      if (!document.execCommand("copy")) {
        throw new Error("copy command failed");
      }
    } finally {
      textarea.remove();
    }
  }

  function removeDocumentFromWorkspace(documentId: string) {
    const nextDocuments = documentsRef.current.filter((document) => document.id !== documentId);
    const nextNotes = notesRef.current.filter((note) => note.documentId !== documentId);
    const nextGlossaryBindings = glossaryBindingsRef.current.filter(
      (binding) => binding.documentId !== documentId,
    );
    const remainingGlossaryTermIds = new Set(
      nextGlossaryBindings
        .filter((binding) => binding.status !== "deleted")
        .map((binding) => binding.termId),
    );
    const nextGlossaryTerms = glossaryTermsRef.current.filter((term) =>
      remainingGlossaryTermIds.has(term.id),
    );
    const nextDirtyDocumentStates = { ...dirtyDocumentStatesRef.current };
    delete nextDirtyDocumentStates[documentId];

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    glossaryTermsRef.current = nextGlossaryTerms;
    dirtyDocumentStatesRef.current = nextDirtyDocumentStates;

    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    setDocuments(nextDocuments);
    setWorkspaceEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.kind !== "file" || entry.documentId !== documentId),
    );
    setNotes(nextNotes);
    setGlossaryBindings(nextGlossaryBindings);
    setGlossaryTerms(nextGlossaryTerms);
    setDirtyDocumentStates(nextDirtyDocumentStates);
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies = { ...currentBodies };
      delete nextBodies[documentId];
      return nextBodies;
    });
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    setFloatingNotePanelPosition(null);
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = false;

    if (selectedDocumentId === documentId) {
      const nextSelectedDocument = nextDocuments[0] ?? null;
      setSelectedDocumentId(nextSelectedDocument?.id ?? "");
      if (nextSelectedDocument?.filePath) {
        rememberLastOpenedMarkdownPath(nextSelectedDocument.filePath);
      } else {
        forgetLastOpenedMarkdownPath();
      }
    }
  }

  async function duplicateDocumentFile(documentId: string) {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    if (autosaveInFlightRef.current) {
      setStorageError("請稍候目前儲存完成後再建立副本。");
      return;
    }

    const documentToDuplicate = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToDuplicate?.filePath) {
      setStorageError("This document is not backed by a local Markdown file.");
      return;
    }

    setFileContextMenu(null);

    const requestedFileName = window.prompt(
      "請輸入副本檔名",
      defaultDuplicateFileName(documentToDuplicate),
    );
    const fileName = requestedFileName?.trim();
    if (!fileName) return;

    setStorageError("Creating duplicate...");

    try {
      if (hasDirtyState(dirtyDocumentStatesRef.current[documentId])) {
        await saveDocumentToDisk(documentToDuplicate);
      }

      const loaded = await invoke<OpenMarkdownFileResult>("duplicate_markdown_file", {
        path: documentToDuplicate.filePath,
        fileName,
      });
      applyLoadedFiles([loaded]);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyDocumentContent(documentId: string) {
    const documentToCopy = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToCopy) return;

    setFileContextMenu(null);

    try {
      await writeTextToClipboard(documentToCopy.body);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteDocumentFile(documentId: string) {
    if (!nativeStorageAvailable) {
      setStorageError("Open/save requires the Scholium macOS app runtime.");
      return;
    }

    if (autosaveInFlightRef.current) {
      setStorageError("請稍候目前儲存完成後再刪除檔案。");
      return;
    }

    const documentToDelete = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToDelete?.filePath) {
      setStorageError("This document is not backed by a local Markdown file.");
      return;
    }

    setFileContextMenu(null);

    const confirmed = window.confirm(
      `確定要刪除「${documentToDelete.title}」嗎？\n\n這會刪除 Markdown 檔案與對應的 notes sidecar。`,
    );
    if (!confirmed) return;

    setStorageError("Deleting file...");

    try {
      await invoke<DeleteMarkdownFileResult>("delete_markdown_file", {
        path: documentToDelete.filePath,
      });
      removeDocumentFromWorkspace(documentId);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateSelectedDocumentBody(
    body: string,
    source: EditorChangeSource,
    anchorTransform?: BodyAnchorTransform,
  ) {
    if (noteEditModalActiveRef.current) return;
    if (body === selectedDocument.body) return;

    const documentId = selectedDocument.id;
    const previousBody = selectedDocument.body;
    const bodyAnchorTransform: BodyAnchorTransform =
      anchorTransform ??
      ((anchor, nextBody) => transformAnchorWithBodyChange(anchor, previousBody, nextBody));
    const savedBody = savedDocumentBodies[documentId] ?? selectedDocument.body;

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === documentId ? { ...document, body } : document,
      ),
    );
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.documentId === documentId && note.status === "active"
          ? {
              ...note,
              anchor: bodyAnchorTransform(note.anchor, body),
            }
          : note,
      ),
    );
    setGlossaryBindings((currentBindings) =>
      currentBindings.map((binding) =>
        binding.documentId === documentId && binding.status === "active"
          ? {
              ...binding,
              anchor: bodyAnchorTransform(binding.anchor, body),
            }
          : binding,
      ),
    );
    markDocumentBodyDirty(documentId, !(source === "undo" && body === savedBody));
  }

  function selectDocument(documentId: string) {
    const nextDocument = documents.find((document) => document.id === documentId);
    if (!nextDocument) return;

    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();
    setSelectedDocumentId(documentId);
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    setStorageError("");
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    clearReturnToViewTimer();
    rememberLastOpenedMarkdownPath(nextDocument.filePath);
  }

  function clearNotePanelCloseTimer() {
    window.clearTimeout(notePanelCloseTimerRef.current);
    notePanelCloseTimerRef.current = 0;
  }

  function clearReturnToViewTimer() {
    window.clearTimeout(returnToViewTimerRef.current);
    returnToViewTimerRef.current = 0;
    setIsReturningToView(false);
  }

  function discardTransientEmptySelectionNote() {
    const noteId = transientSelectionNoteIdRef.current;
    if (!noteId) return false;

    const note = notesRef.current.find((candidate) => candidate.id === noteId);
    if (!note) {
      transientSelectionNoteIdRef.current = "";
      return false;
    }

    if (note.body.trim()) {
      transientSelectionNoteIdRef.current = "";
      return false;
    }

    notesRef.current = notesRef.current.filter((candidate) => candidate.id !== noteId);
    setNotes((currentNotes) => currentNotes.filter((candidate) => candidate.id !== noteId));
    transientSelectionNoteIdRef.current = "";
    markDocumentNotesDirty(note.documentId);
    return true;
  }

  function discardTransientEmptyGlossary() {
    const bindingId = transientGlossaryBindingIdRef.current;
    const termId = transientGlossaryTermIdRef.current;
    if (!bindingId || !termId) return false;
    const binding = glossaryBindingsRef.current.find((candidate) => candidate.id === bindingId);

    const term = glossaryTermsRef.current.find((candidate) => candidate.id === termId);
    if (!term) {
      transientGlossaryBindingIdRef.current = "";
      transientGlossaryTermIdRef.current = "";
      return false;
    }

    if (term.definition.trim()) {
      transientGlossaryBindingIdRef.current = "";
      transientGlossaryTermIdRef.current = "";
      return false;
    }

    glossaryBindingsRef.current = glossaryBindingsRef.current.filter(
      (candidate) => candidate.id !== bindingId,
    );
    setGlossaryBindings((currentBindings) =>
      currentBindings.filter((candidate) => candidate.id !== bindingId),
    );

    const hasOtherBindings = glossaryBindingsRef.current.some(
      (candidate) => candidate.termId === termId && candidate.status !== "deleted",
    );
    if (!hasOtherBindings) {
      glossaryTermsRef.current = glossaryTermsRef.current.filter((candidate) => candidate.id !== termId);
      setGlossaryTerms((currentTerms) =>
        currentTerms.filter((candidate) => candidate.id !== termId),
      );
    }

    transientGlossaryBindingIdRef.current = "";
    transientGlossaryTermIdRef.current = "";
    markDocumentNotesDirty(binding?.documentId ?? selectedDocument.id);
    return true;
  }

  function resetNoteModeInteractionState() {
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();
    selectionDismissedUntilRef.current = Date.now() + 700;
    pendingGlossaryPromptLockUntilRef.current = 0;
    window.getSelection()?.removeAllRanges();
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    setNoteDraft("");
    setGlossaryDraft("");
    setSelectionWarningPosition(null);
    setFloatingNotePanelPosition(null);
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = null;
    notePanelHasContentRef.current = false;
  }

  function resetGlossaryModeInteractionState() {
    const pendingAnchorIsNoteCandidate = Boolean(
      pendingAnchor && isSelectionCompleteMarkdownBlock(selectedDocument.body, pendingAnchor),
    );
    const keepNotePanelOpen = Boolean(activeNoteId || pendingAnchorIsNoteCandidate);

    discardTransientEmptyGlossary();
    pendingGlossaryPromptLockUntilRef.current = 0;
    setPendingGlossaryTerm(null);
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveGlossaryMode("view");
    setGlossaryDraft("");

    if (!pendingAnchorIsNoteCandidate) {
      setPendingAnchor(null);
      window.getSelection()?.removeAllRanges();
    }

    if (!keepNotePanelOpen) {
      clearNotePanelCloseTimer();
      clearReturnToViewTimer();
      setSelectionWarningPosition(null);
      setFloatingNotePanelPosition(null);
      setIsNotePanelClosing(false);
      floatingNoteAnchorRectRef.current = null;
      notePanelHasContentRef.current = false;
    }
  }

  function returnActiveNoteToViewMode() {
    if ((!activeNoteIsEditing && !activeGlossaryIsEditing) || isReturningToView) return;

    if (
      activeNote &&
      !activeNote.body.trim() &&
      !noteDraft.trim()
    ) {
      closeNotePanel();
      return;
    }

    if (
      activeGlossaryTerm &&
      activeGlossaryTerm.id === transientGlossaryTermIdRef.current &&
      !activeGlossaryTerm.definition.trim() &&
      !glossaryDraft.trim()
    ) {
      closeNotePanel();
      return;
    }

    setIsReturningToView(true);
    window.clearTimeout(returnToViewTimerRef.current);
    returnToViewTimerRef.current = window.setTimeout(() => {
      setActiveNoteMode("view");
      setActiveGlossaryMode("view");
      setIsReturningToView(false);
      returnToViewTimerRef.current = 0;
    }, 1000);
  }

  function resetNoteTextareaCompositionState() {
    noteTextareaIsComposingRef.current = false;
    noteTextareaEnterIgnoredDuringCompositionRef.current = false;
    noteTextareaPostCompositionGuardUntilRef.current = 0;
  }

  function closeNotePanel() {
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    setSelectionWarningPosition(null);

    if (!notePanelHasContentRef.current) {
      setPendingAnchor(null);
      setPendingGlossaryTerm(null);
      setActiveNoteId("");
      setActiveGlossaryBindingId("");
      setActiveGlossaryTermId("");
      setActiveNoteMode("view");
      setActiveGlossaryMode("view");
      setNoteDraft("");
      setGlossaryDraft("");
      floatingNoteAnchorRectRef.current = null;
      setIsNotePanelClosing(false);
      return;
    }

    setIsNotePanelClosing(true);
    notePanelCloseTimerRef.current = window.setTimeout(() => {
      discardTransientEmptySelectionNote();
      discardTransientEmptyGlossary();
      setPendingAnchor(null);
      setPendingGlossaryTerm(null);
      setActiveNoteId("");
      setActiveGlossaryBindingId("");
      setActiveGlossaryTermId("");
      setActiveNoteMode("view");
      setActiveGlossaryMode("view");
      setNoteDraft("");
      setGlossaryDraft("");
      setIsNotePanelClosing(false);
      floatingNoteAnchorRectRef.current = null;
      notePanelHasContentRef.current = false;
      notePanelCloseTimerRef.current = 0;
    }, notePanelAnimationMs);
  }

  function handleNoteEditorCompositionStart() {
    noteTextareaIsComposingRef.current = true;
    noteTextareaEnterIgnoredDuringCompositionRef.current = false;
    noteTextareaPostCompositionGuardUntilRef.current = 0;
  }

  function handleNoteEditorCompositionEnd() {
    const hadEnterDuringComposition = noteTextareaEnterIgnoredDuringCompositionRef.current;

    noteTextareaIsComposingRef.current = false;
    noteTextareaEnterIgnoredDuringCompositionRef.current = false;
    noteTextareaPostCompositionGuardUntilRef.current =
      Date.now() + (hadEnterDuringComposition ? 500 : 180);
  }

  function handleNoteEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const isPlainEnter = event.key === "Enter" && !event.shiftKey;
    const isDuringComposition =
      event.nativeEvent.isComposing || noteTextareaIsComposingRef.current;

    if (isDuringComposition) {
      if (isPlainEnter) {
        noteTextareaEnterIgnoredDuringCompositionRef.current = true;
      }
      return;
    }

    if (isPlainEnter && Date.now() <= noteTextareaPostCompositionGuardUntilRef.current) {
      event.preventDefault();
      noteTextareaPostCompositionGuardUntilRef.current = 0;
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeNotePanel();
      return;
    }

    if (!isPlainEnter) return;

    event.preventDefault();
    if (!event.currentTarget.value.trim()) {
      closeNotePanel();
      return;
    }

    returnActiveNoteToViewMode();
  }

  function handleLibraryNoteEditorKeyDown(
    noteId: string,
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (focusAdjacentLibraryNote(noteId, event)) {
      return;
    }

    const isPlainEnter = event.key === "Enter" && !event.shiftKey;
    const isDuringComposition =
      event.nativeEvent.isComposing || noteTextareaIsComposingRef.current;

    if (isDuringComposition) {
      if (isPlainEnter) {
        noteTextareaEnterIgnoredDuringCompositionRef.current = true;
      }
      return;
    }

    if (isPlainEnter && Date.now() <= noteTextareaPostCompositionGuardUntilRef.current) {
      event.preventDefault();
      noteTextareaPostCompositionGuardUntilRef.current = 0;
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setEditingLibraryNoteId((currentNoteId) =>
        currentNoteId === noteId ? "" : currentNoteId,
      );
      return;
    }

    if (!isPlainEnter) return;

    event.preventDefault();
    setEditingLibraryNoteId((currentNoteId) =>
      currentNoteId === noteId ? "" : currentNoteId,
    );
  }

  function handleSelectionChange(anchor: TextSelectionAnchor | null) {
    if (!noteModeEnabled || noteLibraryOpen) {
      return;
    }

    if (!anchor) {
      if (
        Date.now() < pendingGlossaryPromptLockUntilRef.current &&
        pendingAnchor &&
        pendingGlossaryTerm
      ) {
        return;
      }

      setSelectionWarningPosition(null);
      if (pendingAnchor) {
        closeNotePanel();
      }
      return;
    }

    if (Date.now() < selectionDismissedUntilRef.current) {
      return;
    }

    if (
      pendingAnchor &&
      pendingGlossaryTerm &&
      textSelectionAnchorsMatch(anchor, pendingAnchor)
    ) {
      return;
    }

    if (glossaryModeActive && isGlossarySelectionCandidate(anchor)) {
      const existingGlossaryBinding = activeGlossaryBindingForSelection(anchor);
      if (existingGlossaryBinding) {
        showGlossaryViewer(existingGlossaryBinding.id);
        return;
      }

      showPendingGlossaryPrompt(anchor);
      return;
    }

    if (selectionIsBlockedByExistingAnnotations(anchor)) {
      setSelectionWarningPosition(null);
      if (
        pendingAnchor ||
        activeNoteId ||
        activeGlossaryBindingId ||
        activeGlossaryTermId ||
        notePanelHasContentRef.current
      ) {
        closeNotePanel();
      }
      return;
    }

    if (
      !(glossaryModeActive && isGlossarySelectionCandidate(anchor)) &&
      !isSelectionCompleteMarkdownBlock(selectedDocument.body, anchor)
    ) {
      const anchorRect = currentSelectionAnchorRect();
      setPendingAnchor(null);
      setNoteDraft("");
      setPendingGlossaryTerm(null);
      setGlossaryDraft("");
      if (notePanelHasContentRef.current) {
        closeNotePanel();
      }
      setSelectionWarningPosition(selectionWarningPositionFromAnchor(anchorRect));
      return;
    }

    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setSelectionWarningPosition(null);
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = currentSelectionAnchorRect();
    setPendingAnchor(anchor);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    setNoteDraft("");
    setGlossaryDraft("");
    notePanelHasContentRef.current = isMobileViewport;
  }

  function selectionOverlapsActiveNote(anchor: TextSelectionAnchor) {
    return activeNotes.some((note) => selectionOverlapsNote(anchor, note));
  }

  function selectionOverlapsActiveGlossary(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return false;

    return documentGlossaryBindings.some((binding) =>
      (glossaryTermIdsWithContent.has(binding.termId) ||
        editableGlossaryBindingIds.has(binding.id)) &&
      selectionOverlapsGlossaryBinding(anchor, binding),
    );
  }

  function activeGlossaryBindingForSelection(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return null;

    return (
      documentGlossaryBindings.find(
        (binding) =>
          binding.status === "active" &&
          (glossaryTermIdsWithContent.has(binding.termId) ||
            editableGlossaryBindingIds.has(binding.id)) &&
          selectionOverlapsGlossaryBinding(anchor, binding),
      ) ?? null
    );
  }

  function selectionIsBlockedByExistingAnnotations(anchor: TextSelectionAnchor) {
    if (glossaryModeActive && isGlossarySelectionCandidate(anchor)) {
      return selectionOverlapsActiveGlossary(anchor);
    }

    return selectionOverlapsActiveNote(anchor) || selectionOverlapsActiveGlossary(anchor);
  }

  function handleSelectionEnter(anchor: TextSelectionAnchor) {
    if (!noteModeEnabled) return false;
    if (!hasOpenDocument) return false;
    if (noteLibraryOpen) return false;

    if (selectionIsBlockedByExistingAnnotations(anchor)) {
      return true;
    }

    if (glossaryModeActive && isGlossarySelectionCandidate(anchor)) {
      startGlossaryFlowForAnchor(anchor);
      return true;
    }

    if (isSelectionCompleteMarkdownBlock(selectedDocument.body, anchor)) {
      confirmSelectionNoteForAnchor(anchor);
      return true;
    }

    setPendingAnchor(null);
    setNoteDraft("");
    setPendingGlossaryTerm(null);
    setGlossaryDraft("");
    setSelectionWarningPosition(selectionWarningPositionFromAnchor(currentSelectionAnchorRect()));
    return true;
  }

  function showNoteViewer(noteId: string) {
    if (!noteModeEnabled) return;

    const note = notes.find((candidate) => candidate.id === noteId && candidate.status !== "deleted");
    if (!note || !selectionNoteHasContent(note)) return;

    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = activeNoteAnchorRect(noteId);
    setPendingAnchor(null);
    setActiveNoteId(noteId);
    setActiveNoteMode("view");
    setNoteDraft(note.body);
    notePanelHasContentRef.current = true;
  }

  function wrappedNavigationIndex(
    currentIndex: number,
    itemCount: number,
    direction: -1 | 1,
  ) {
    if (itemCount === 0) return -1;
    if (currentIndex < 0) return direction > 0 ? 0 : itemCount - 1;

    return (currentIndex + direction + itemCount) % itemCount;
  }

  function scrollTextAnnotationIntoView(annotationId: string) {
    const annotationElement = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-note-annotation[data-note-id], .cm-annotation-frame[data-note-id], .preview-note-annotation[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
      ),
    ).find(
      (element) =>
        element.dataset.noteId === annotationId &&
        Array.from(element.getClientRects()).some(
          (rect) => rect.width > 0 && rect.height > 0,
        ),
    );

    annotationElement?.scrollIntoView({ block: "center", inline: "nearest" });
  }

  function focusAdjacentFloatingAnnotation(direction: -1 | 1) {
    if (activeNoteId) {
      const currentIndex = noteLibraryNotes.findIndex((note) => note.id === activeNoteId);
      const nextIndex = wrappedNavigationIndex(
        currentIndex,
        noteLibraryNotes.length,
        direction,
      );
      const nextNoteId = nextIndex >= 0 ? noteLibraryNotes[nextIndex]?.id : "";
      if (!nextNoteId) return false;

      scrollTextAnnotationIntoView(nextNoteId);
      showNoteViewer(nextNoteId);
      return true;
    }

    if (activeGlossaryBindingId) {
      const currentIndex = glossaryNavigationBindings.findIndex(
        (binding) => binding.id === activeGlossaryBindingId,
      );
      const nextIndex = wrappedNavigationIndex(
        currentIndex,
        glossaryNavigationBindings.length,
        direction,
      );
      const nextBindingId =
        nextIndex >= 0 ? glossaryNavigationBindings[nextIndex]?.id : "";
      if (!nextBindingId) return false;

      scrollTextAnnotationIntoView(`glossary:${nextBindingId}`);
      showGlossaryViewer(nextBindingId);
      return true;
    }

    return false;
  }

  function openNoteEditor(noteId: string) {
    if (!noteModeEnabled) return;

    const note = notes.find((candidate) => candidate.id === noteId && candidate.status !== "deleted");
    if (!note || !selectionNoteHasContent(note)) return;

    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = activeNoteAnchorRect(noteId);
    setPendingAnchor(null);
    setActiveNoteId(noteId);
    noteTextareaShouldRefocusRef.current = true;
    setActiveNoteMode("edit");
    setNoteDraft(note.body);
    notePanelHasContentRef.current = true;
  }

  function glossaryTermForAnchor(anchor: TextSelectionAnchor) {
    const normalizedTerm = normalizeGlossaryTerm(anchor.selectedText);

    return (
      glossaryTerms.find(
        (term) =>
          glossaryTermHasContent(term) &&
          (term.normalizedTerm === normalizedTerm ||
            normalizeGlossaryTerm(term.term) === normalizedTerm),
      ) ?? null
    );
  }

  function createGlossaryBinding(term: GlossaryTerm, anchor: TextSelectionAnchor) {
    const binding: GlossaryBinding = {
      id: crypto.randomUUID(),
      documentId: selectedDocument.id,
      termId: term.id,
      term: term.term,
      normalizedTerm: normalizeGlossaryTerm(term.term),
      status: "active",
      anchor: {
        ...anchor,
        selectedText: anchor.selectedText.replace(/\s+/g, " ").trim(),
      },
      createdAt: nowLabel(),
      updatedAt: nowLabel(),
      deletedAt: null,
    };

    setGlossaryBindings((currentBindings) => [binding, ...currentBindings]);
    markDocumentNotesDirty();
    return binding;
  }

  function startPendingGlossaryFlow() {
    if (!glossaryModeActive) return;
    if (!pendingAnchor || !pendingAnchorIsGlossaryTerm) return;

    startGlossaryFlowForAnchor(pendingAnchor);
  }

  function showPendingGlossaryPrompt(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return;

    discardTransientEmptySelectionNote();
    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);

    const anchorRect =
      currentSelectionAnchorRect() ??
      activeNoteAnchorRect(pendingAnchorAnnotationId) ??
      lastPointerAnchorRectRef.current;
    if (anchorRect) {
      floatingNoteAnchorRectRef.current = anchorRect;
    }

    const existingTerm = glossaryTermForAnchor(anchor);
    if (existingTerm) {
      pendingGlossaryPromptLockUntilRef.current = Date.now() + 350;
      setPendingGlossaryTerm(existingTerm);
      setActiveGlossaryTermId(existingTerm.id);
      setGlossaryDraft(existingTerm.definition);
    } else {
      pendingGlossaryPromptLockUntilRef.current = 0;
      setPendingGlossaryTerm(null);
      setActiveGlossaryTermId("");
      setGlossaryDraft("");
    }

    setPendingAnchor(anchor);
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    setNoteDraft("");
    notePanelHasContentRef.current = true;
  }

  function startGlossaryFlowForAnchor(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return;

    discardTransientEmptySelectionNote();
    setSelectionWarningPosition(null);
    const anchorRect =
      currentSelectionAnchorRect() ??
      activeNoteAnchorRect(pendingAnchorAnnotationId) ??
      floatingNoteAnchorRectRef.current ??
      lastPointerAnchorRectRef.current;
    if (anchorRect) {
      floatingNoteAnchorRectRef.current = anchorRect;
    }

    const existingTerm = glossaryTermForAnchor(anchor);
    if (existingTerm) {
      clearNotePanelCloseTimer();
      clearReturnToViewTimer();
      setIsNotePanelClosing(false);
      setPendingAnchor(anchor);
      setPendingGlossaryTerm(existingTerm);
      pendingGlossaryPromptLockUntilRef.current = Date.now() + 350;
      setActiveNoteId("");
      setActiveGlossaryBindingId("");
      setActiveGlossaryTermId(existingTerm.id);
      setActiveGlossaryMode("view");
      setGlossaryDraft(existingTerm.definition);
      notePanelHasContentRef.current = true;
      return;
    }

    const now = nowLabel();
    const termText = anchor.selectedText.replace(/\s+/g, " ").trim();
    const term: GlossaryTerm = {
      id: crypto.randomUUID(),
      term: termText,
      normalizedTerm: normalizeGlossaryTerm(termText),
      definition: "",
      createdAt: now,
      updatedAt: now,
    };

    setGlossaryTerms((currentTerms) => [term, ...currentTerms]);
    const binding = createGlossaryBinding(term, anchor);
    transientGlossaryBindingIdRef.current = binding.id;
    transientGlossaryTermIdRef.current = term.id;
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId(binding.id);
    setActiveGlossaryTermId(term.id);
    setActiveGlossaryMode("edit");
    setGlossaryDraft("");
    noteTextareaShouldRefocusRef.current = true;
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = true;
  }

  function bindPendingGlossaryTerm() {
    if (!glossaryModeActive) return;
    if (!pendingAnchor || !pendingGlossaryTerm) return;
    if (!glossaryTermHasContent(pendingGlossaryTerm)) {
      closeNotePanel();
      return;
    }

    const binding = createGlossaryBinding(pendingGlossaryTerm, pendingAnchor);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId(binding.id);
    setActiveGlossaryTermId(pendingGlossaryTerm.id);
    setActiveGlossaryMode("view");
    setGlossaryDraft(pendingGlossaryTerm.definition);
    notePanelHasContentRef.current = true;
  }

  function rejectPendingGlossaryTerm() {
    closeNotePanel();
  }

  function showGlossaryViewer(bindingId: string) {
    if (!glossaryModeActive) return;

    const binding = glossaryBindings.find(
      (candidate) => candidate.id === bindingId && candidate.status !== "deleted",
    );
    if (!binding) return;

    const term = glossaryTerms.find((candidate) => candidate.id === binding.termId);
    if (!glossaryTermHasContent(term)) return;

    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = activeGlossaryAnchorRect(bindingId);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId(bindingId);
    setActiveGlossaryTermId(term.id);
    setActiveGlossaryMode("view");
    setGlossaryDraft(term.definition);
    notePanelHasContentRef.current = true;
  }

  function openGlossaryEditor(termId: string) {
    if (!glossaryModeActive) return;

    const term = glossaryTerms.find((candidate) => candidate.id === termId);
    if (!term) return;

    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryTermId(term.id);
    noteTextareaShouldRefocusRef.current = true;
    setActiveGlossaryMode("edit");
    setGlossaryDraft(term.definition);
    notePanelHasContentRef.current = true;
  }

  function showAnnotationViewer(annotationId: string) {
    if (!noteModeEnabled) return;
    if (noteLibraryOpen) {
      focusLibraryNoteFromAnnotation(annotationId);
      return;
    }

    if (annotationId.startsWith("glossary:")) {
      if (!glossaryModeActive) return;

      showGlossaryViewer(annotationId.slice("glossary:".length));
      return;
    }

    showNoteViewer(annotationId);
  }

  function focusLibraryNoteFromAnnotation(annotationId: string) {
    if (annotationId.startsWith("glossary:")) return false;

    const note = noteLibraryNotes.find((candidate) => candidate.id === annotationId);
    if (!note) return false;

    setEditingLibraryNoteId("");
    setFocusedLibraryNoteId(note.id);
    focusLibraryNoteCard(note.id);
    return true;
  }

  function updateGlossaryDefinition(termId: string, definition: string) {
    setGlossaryTerms((currentTerms) =>
      currentTerms.map((term) =>
        term.id === termId
          ? {
              ...term,
              definition,
              updatedAt: nowLabel(),
            }
          : term,
      ),
    );
    markGlossaryTermDirty(termId);

    if (termId === transientGlossaryTermIdRef.current && definition.trim()) {
      transientGlossaryBindingIdRef.current = "";
      transientGlossaryTermIdRef.current = "";
    }
  }

  function updateActiveGlossaryDraft(definition: string) {
    if (!activeGlossaryTerm) return;

    setGlossaryDraft(definition);
    updateGlossaryDefinition(activeGlossaryTerm.id, definition);
  }

  function deleteGlossaryBinding(bindingId: string) {
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    if (transientGlossaryBindingIdRef.current === bindingId) {
      transientGlossaryBindingIdRef.current = "";
      transientGlossaryTermIdRef.current = "";
    }
    setGlossaryBindings((currentBindings) =>
      currentBindings.map((binding) =>
        binding.id === bindingId
          ? {
              ...binding,
              status: "deleted",
              deletedAt: new Date().toISOString(),
              updatedAt: nowLabel(),
            }
          : binding,
      ),
    );

    if (activeGlossaryBindingId === bindingId) {
      setPendingAnchor(null);
      setPendingGlossaryTerm(null);
      setActiveGlossaryBindingId("");
      setActiveGlossaryTermId("");
      setActiveGlossaryMode("view");
      setGlossaryDraft("");
      setIsNotePanelClosing(false);
      notePanelHasContentRef.current = false;
    }
    markDocumentNotesDirty();
  }

  function confirmPendingSelectionNote() {
    if (!noteModeEnabled) return;
    if (!pendingAnchor || !pendingAnchorIsCompleteBlock) return;

    confirmSelectionNoteForAnchor(pendingAnchor);
  }

  function confirmSelectionNoteForAnchor(anchor: TextSelectionAnchor) {
    if (!noteModeEnabled) return;

    discardTransientEmptySelectionNote();
    setSelectionWarningPosition(null);

    const note: SelectionNote = {
      id: crypto.randomUUID(),
      documentId: selectedDocument.id,
      status: "active",
      selectedText: anchor.selectedText,
      anchor,
      body: "",
      createdAt: nowLabel(),
      updatedAt: nowLabel(),
      deletedAt: null,
    };

    setNotes((currentNotes) => [note, ...currentNotes]);
    transientSelectionNoteIdRef.current = note.id;
    noteTextareaShouldRefocusRef.current = true;
    clearReturnToViewTimer();
    setPendingAnchor(null);
    setActiveNoteId(note.id);
    setActiveNoteMode("edit");
    setNoteDraft("");
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = true;
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

  function updateActiveNoteDraft(body: string) {
    if (!activeNote) return;

    setNoteDraft(body);
    updateNoteBody(activeNote.id, body);
  }

  function deleteNote(noteId: string) {
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    if (transientSelectionNoteIdRef.current === noteId) {
      transientSelectionNoteIdRef.current = "";
    }
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
    if (focusedLibraryNoteId === noteId) {
      setFocusedLibraryNoteId("");
    }
    if (editingLibraryNoteId === noteId) {
      setEditingLibraryNoteId("");
    }
    markDocumentNotesDirty();
  }

  function toggleNoteMode() {
    const nextNoteModeEnabled = !noteModeEnabled;
    if (!nextNoteModeEnabled) {
      resetNoteModeInteractionState();
      setGlossaryModeEnabled(false);
    }

    setNoteModeEnabled(nextNoteModeEnabled);
  }

  function toggleGlossaryMode() {
    if (!noteModeEnabled) return;

    const nextGlossaryModeEnabled = !glossaryModeEnabled;
    if (!nextGlossaryModeEnabled) {
      resetGlossaryModeInteractionState();
    }

    setGlossaryModeEnabled(nextGlossaryModeEnabled);
  }

  function handleNoteLibraryCardBlur(
    noteId: string,
    event: FocusEvent<HTMLElement>,
  ) {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    setFocusedLibraryNoteId((currentNoteId) =>
      currentNoteId === noteId ? "" : currentNoteId,
    );
    setEditingLibraryNoteId((currentNoteId) =>
      currentNoteId === noteId ? "" : currentNoteId,
    );
  }

  function handleShellMouseDownCapture(event: MouseEvent<HTMLElement>) {
    if (!noteLibraryFocusActive || !focusedLibraryNoteId) return;

    const target = event.target;
    if (target instanceof Element && target.closest(".note-library-card.is-focused")) {
      return;
    }

    setFocusedLibraryNoteId("");
    setEditingLibraryNoteId("");
  }

  function startLibraryNoteEditor(noteId: string) {
    const note = notes.find((candidate) => candidate.id === noteId && candidate.status !== "deleted");
    if (!note || !selectionNoteHasContent(note)) return;

    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");
    setNoteDraft("");
    setGlossaryDraft("");
    setFloatingNotePanelPosition(null);
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = false;
    floatingNoteAnchorRectRef.current = null;
    setFocusedLibraryNoteId(noteId);
    setEditingLibraryNoteId(noteId);
  }

  function toggleLibraryNoteEditor(noteId: string) {
    if (editingLibraryNoteId === noteId) {
      setEditingLibraryNoteId("");
      return;
    }

    startLibraryNoteEditor(noteId);
  }

  function updateLibraryNoteDraft(noteId: string, body: string) {
    updateNoteBody(noteId, body);
  }

  function focusLibraryNoteCard(noteId: string) {
    window.requestAnimationFrame(() => {
      const safeNoteId = noteId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const noteCard = document.querySelector<HTMLElement>(
        `.note-library-card[data-note-id="${safeNoteId}"]`,
      );
      if (!noteCard) return;

      noteCard.focus({ preventScroll: true });
      noteCard.scrollIntoView({ block: "nearest" });
    });
  }

  function focusAdjacentLibraryNote(
    noteId: string,
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (noteLibraryNotes.length === 0) return false;

    event.preventDefault();
    event.stopPropagation();
    const currentIndex = noteLibraryNotes.findIndex((note) => note.id === noteId);
    const nextIndex = wrappedNavigationIndex(
      currentIndex,
      noteLibraryNotes.length,
      event.shiftKey ? -1 : 1,
    );
    const nextNoteId = nextIndex >= 0 ? noteLibraryNotes[nextIndex]?.id : "";
    if (!nextNoteId) return false;

    setEditingLibraryNoteId("");
    setFocusedLibraryNoteId(nextNoteId);
    focusLibraryNoteCard(nextNoteId);
    return true;
  }

  function handleNoteLibraryCardKeyDown(
    noteId: string,
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    focusAdjacentLibraryNote(noteId, event);
  }

  function toggleNoteLibrary() {
    if (!noteModeEnabled) return;

    const nextNoteLibraryOpen = !noteLibraryOpen;
    setFocusedLibraryNoteId("");
    setEditingLibraryNoteId("");
    if (nextNoteLibraryOpen) {
      resetNoteModeInteractionState();
    }

    setNoteLibraryOpen(nextNoteLibraryOpen);
  }

  const floatingNotePanelStyle: CSSProperties = floatingNotePanelPosition
    ? {
        left: floatingNotePanelPosition.left,
        maxHeight: floatingNotePanelPosition.maxHeight,
        top: floatingNotePanelPosition.top,
      }
    : {
        left: 0,
        maxHeight: 360,
        top: 0,
        visibility: "hidden",
      };
  const selectionWarningStyle: CSSProperties | undefined = selectionWarningPosition
    ? {
        left: selectionWarningPosition.left,
        top: selectionWarningPosition.top,
      }
    : undefined;
  const fileContextMenuStyle: CSSProperties | undefined = fileContextMenu
    ? {
        left: Math.round(
          clampNumber(fileContextMenu.left, 8, Math.max(8, window.innerWidth - 188)),
        ),
        top: Math.round(
          clampNumber(fileContextMenu.top, 8, Math.max(8, window.innerHeight - 64)),
        ),
      }
    : undefined;
  const floatingNoteConnectorStyle: CSSProperties | null = floatingNotePanelPosition
    ?.connector
    ? {
        left: floatingNotePanelPosition.connector.left,
        top: floatingNotePanelPosition.connector.top,
        transform: `translateY(-50%) rotate(${floatingNotePanelPosition.connector.angle}deg)`,
        width: floatingNotePanelPosition.connector.width,
      }
    : null;
  const editorReadOnly = notePanelModalActive || noteLibraryOpen;
  const fileContextMenuActions = fileContextMenu
    ? [
        {
          id: "duplicate",
          label: "建立副本",
          icon: <DuplicateIcon />,
          onSelect: () => {
            void duplicateDocumentFile(fileContextMenu.documentId);
          },
        },
        {
          id: "copy-content",
          label: "複製內容",
          icon: <CopyIcon />,
          onSelect: () => {
            void copyDocumentContent(fileContextMenu.documentId);
          },
        },
        {
          id: "delete",
          label: "刪除檔案",
          icon: <TrashIcon />,
          tone: "danger",
          onSelect: () => {
            void deleteDocumentFile(fileContextMenu.documentId);
          },
        },
      ]
    : [];
  const floatingPanelIsGlossary = Boolean(
    pendingGlossaryTerm ||
      activeGlossaryTerm ||
      activeGlossaryIsEditing ||
      (pendingAnchor && pendingAnchorIsGlossaryTerm),
  );
  const selectionWarningMessage = glossaryModeActive
    ? "請選取 1-3 個單詞建立名詞解釋，或選取完整句子/段落新增筆記。"
    : "請選取完整句子或段落新增筆記。";

  const shellClassName = [
    "scholium-shell",
    noteModeEnabled && noteLibraryOpen ? "is-note-library-open" : "",
    noteLibraryFocusActive ? "is-note-library-focus-active" : "",
    notePanelModalActive ? "is-note-panel-modal-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName} onMouseDownCapture={handleShellMouseDownCapture}>
      <aside className="document-pane" aria-label="Documents">
        <div className="pane-header">
          <div>
            <h1>{workspaceTitle}</h1>
          </div>
        </div>

        <div className="document-list">
          {workspaceEntries.map((entry) => {
            const isSelected =
              hasOpenDocument && entry.kind === "file" && entry.documentId === selectedDocument.id;

            return (
              <button
                className={`document-row ${
                  entry.kind === "directory" || entry.kind === "parent-directory"
                    ? "is-folder"
                    : ""
                } ${entry.kind === "parent-directory" ? "is-parent" : ""} ${
                  isSelected ? "is-selected" : ""
                }`}
                key={entry.id}
                onClick={() => {
                  if (entry.kind === "directory" || entry.kind === "parent-directory") {
                    void openDirectoryPath(entry.path);
                    return;
                  }

                  selectDocument(entry.documentId);
                }}
                onContextMenu={(event) => {
                  if (entry.kind !== "file") return;

                  event.preventDefault();
                  event.stopPropagation();
                  setFileContextMenu({
                    documentId: entry.documentId,
                    left: event.clientX,
                    top: event.clientY,
                  });
                }}
                aria-label={entry.kind === "parent-directory" ? "回到上一層目錄" : undefined}
                title={entry.kind === "parent-directory" ? "回到上一層目錄" : undefined}
                type="button"
              >
                {entry.kind === "parent-directory" ? (
                  <span className="parent-directory-icon" aria-hidden="true">
                    ←
                  </span>
                ) : (
                  <>
                    <DocumentGlyphIcon kind={entry.kind === "file" ? "file" : "folder"} />
                    <span className="document-title">{entry.title}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {storageError ? <p className="storage-error">{storageError}</p> : null}
      </aside>

      {fileContextMenu ? (
        <div
          className="file-context-menu"
          role="menu"
          style={fileContextMenuStyle}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {fileContextMenuActions.map((action) => (
            <button
              className={action.tone === "danger" ? "is-danger" : ""}
              key={action.id}
              type="button"
              role="menuitem"
              onClick={action.onSelect}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className="editor-pane" aria-label="Markdown editor">
        <div className="editor-grid">
          <div className="editor-surface">
            <div
              aria-label="Editor tools"
              className="editor-toolbar"
              data-expanded={noteModeEnabled ? "true" : "false"}
            >
              <button
                aria-checked={noteModeEnabled}
                aria-label={noteModeEnabled ? "關閉筆記模式" : "開啟筆記模式"}
                className="note-mode-switch note-mode-switch--primary"
                onClick={toggleNoteMode}
                role="switch"
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="note-mode-switch__icon"
                  src={noteModeEnabled ? notebookSelectedIcon : notebookRestIcon}
                />
                <span className="note-mode-switch__label">筆記模式</span>
              </button>
              <span
                aria-hidden="true"
                className="editor-toolbar__divider note-mode-switch--dependent"
              />
              <button
                aria-checked={glossaryModeActive}
                aria-hidden={!noteModeEnabled}
                aria-label={glossaryModeActive ? "關閉名詞解釋模式" : "開啟名詞解釋模式"}
                className="note-mode-switch note-mode-switch--secondary note-mode-switch--dependent"
                disabled={!noteModeEnabled}
                onClick={toggleGlossaryMode}
                role="switch"
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="note-mode-switch__icon"
                  src={glossaryModeActive ? dictionarySelectedIcon : dictionaryRestIcon}
                />
                <span className="note-mode-switch__label">名詞</span>
              </button>
              <button
                aria-expanded={noteLibraryOpen}
                aria-hidden={!noteModeEnabled}
                aria-label={noteLibraryOpen ? "收起筆記庫" : "展開筆記庫"}
                className="note-mode-switch note-mode-switch--secondary note-mode-switch--dependent note-library-toggle"
                disabled={!noteModeEnabled}
                onClick={toggleNoteLibrary}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="note-mode-switch__icon"
                  src={noteLibraryOpen ? noteLibrarySelectedIcon : noteLibraryRestIcon}
                />
                <span className="note-mode-switch__label">筆記庫</span>
              </button>
            </div>
            {!hasOpenDocument ? (
              <div className="empty-editor-state">
                <h2>此目錄沒有 Markdown 檔案</h2>
                <p>請選擇左側子目錄，或開啟其他 Markdown 檔案。</p>
              </div>
            ) : editorMode === "preview" ? (
                <MilkdownMarkdownEditor
                  annotations={annotations}
                  key={selectedDocument.id}
                  noteModeEnabled={noteModeEnabled}
                  readOnly={editorReadOnly}
                  value={selectedDocument.body}
                  onAnnotationClick={showAnnotationViewer}
                  onAnnotationDoubleClick={showAnnotationViewer}
                  onChange={updateSelectedDocumentBody}
                  onSelectionChange={handleSelectionChange}
                  onSelectionEnter={handleSelectionEnter}
                />
            ) : (
                <MarkdownEditor
                  annotations={annotations}
                  noteModeEnabled={noteModeEnabled}
                  readOnly={editorReadOnly}
                  value={selectedDocument.body}
                  onAnnotationClick={showAnnotationViewer}
                  onAnnotationDoubleClick={showAnnotationViewer}
                  onChange={updateSelectedDocumentBody}
                  onSelectionChange={handleSelectionChange}
                  onSelectionEnter={handleSelectionEnter}
                />
            )}
          </div>
        </div>
      </section>

      {noteModeEnabled ? (
        <aside
          aria-hidden={!noteLibraryOpen}
          aria-label="筆記庫"
          className={`note-library-pane ${noteLibraryOpen ? "is-open" : ""} ${
            noteLibraryFocusActive ? "is-focus-active" : ""
          }`}
        >
          <div className="note-library-header">
            <h2>筆記庫</h2>
            <span>{noteLibraryNotes.length}</span>
          </div>
          <div className="note-library-list">
            {noteLibraryNotes.length > 0 ? (
              noteLibraryNotes.map((note) => {
                const isEditingLibraryNote = editingLibraryNoteId === note.id;

                return (
                  <article
                    className={`note-library-card ${activeNoteId === note.id ? "is-active" : ""} ${
                      focusedLibraryNoteId === note.id ? "is-focused" : ""
                    } ${isEditingLibraryNote ? "is-editing" : ""}`}
                    data-note-id={note.id}
                    data-note-tone={activeNoteToneById.get(note.id) ?? note.tone ?? 0}
                    key={note.id}
                    tabIndex={0}
                    onBlur={(event) => handleNoteLibraryCardBlur(note.id, event)}
                    onClick={() => setFocusedLibraryNoteId(note.id)}
                    onFocus={() => setFocusedLibraryNoteId(note.id)}
                    onKeyDown={(event) => handleNoteLibraryCardKeyDown(note.id, event)}
                  >
                    <div className="note-library-card__header">
                      <p className="eyebrow">Note</p>
                      <div className="note-actions note-library-card__actions">
                        <button
                          type="button"
                          aria-label={isEditingLibraryNote ? "完成編輯筆記" : "編輯筆記"}
                          aria-pressed={isEditingLibraryNote}
                          title={isEditingLibraryNote ? "完成編輯筆記" : "編輯筆記"}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLibraryNoteEditor(note.id);
                          }}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          aria-label="刪除筆記"
                          title="刪除筆記"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteNote(note.id);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                    {isEditingLibraryNote ? (
                      <textarea
                        className="note-library-card__editor"
                        ref={libraryNoteTextareaRef}
                        value={note.body}
                        onChange={(event) => updateLibraryNoteDraft(note.id, event.currentTarget.value)}
                        onCompositionStart={handleNoteEditorCompositionStart}
                        onCompositionEnd={handleNoteEditorCompositionEnd}
                        onKeyDown={(event) => handleLibraryNoteEditorKeyDown(note.id, event)}
                        onClick={(event) => event.stopPropagation()}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                      />
                    ) : (
                      <NoteLibraryPreviewContent
                        className="bottom-note-body note-library-card__body"
                        emptyLabel="無內容"
                        expanded={focusedLibraryNoteId === note.id}
                        onDoubleClick={() => startLibraryNoteEditor(note.id)}
                        value={note.body}
                      />
                    )}
                  </article>
                );
              })
            ) : (
              <p className="note-library-empty">尚無筆記</p>
            )}
          </div>
        </aside>
      ) : null}

      {noteModeEnabled && selectionWarningPosition ? (
        <div className="selection-warning-popover" role="status" style={selectionWarningStyle}>
          {selectionWarningMessage}
        </div>
      ) : null}

      {floatingNotePanelShouldRender ? (
        <>
          {notePanelModalActive ? (
            <div
              aria-hidden="true"
              className="note-edit-backdrop"
              onClick={handleNotePanelOutsideModalInteraction}
              onMouseDown={handleNotePanelOutsideModalInteraction}
              onPointerDown={handleNotePanelOutsideModalInteraction}
              onWheel={blockNoteEditBackdropInteraction}
            />
          ) : null}
          {floatingNoteConnectorStyle ? (
            <span
              aria-hidden="true"
              className={`floating-note-connector ${
                isNotePanelClosing ? "is-closing" : "is-open"
              } ${floatingPanelIsGlossary ? "is-glossary" : "is-note"}`}
              style={floatingNoteConnectorStyle}
            />
          ) : null}
          <section
            className={`floating-note-panel ${isNotePanelClosing ? "is-closing" : "is-open"} ${
              floatingNotePanelPosition?.placement === "above"
                ? "is-above"
                : floatingNotePanelPosition?.placement === "detached"
                  ? "is-detached"
                  : "is-below"
            } ${floatingPanelIsGlossary ? "is-glossary" : "is-note"}`}
            onBlur={handleFloatingNotePanelBlur}
            ref={notePanelRef}
            style={floatingNotePanelStyle}
            aria-label={
              pendingAnchor
                ? pendingAnchorIsGlossaryTerm
                  ? "Create glossary term"
                  : "Create selection note"
                : activeGlossaryIsEditing
                  ? "Edit glossary term"
                  : activeGlossaryTerm
                    ? "View glossary term"
                    : activeNoteIsEditing
                      ? "Edit selection note"
                      : "View selection note"
            }
          >
            <div className="floating-note-card" ref={floatingNoteCardRef}>
              <button
                className="floating-note-close-button"
                type="button"
                aria-label="Close note"
                onClick={closeNotePanel}
              >
                ×
              </button>
              <div className="bottom-note-context">
                <p className="eyebrow">
                  {pendingGlossaryTerm
                    ? "Glossary"
                    : pendingAnchor
                      ? pendingAnchorIsGlossaryTerm
                        ? "Glossary"
                        : "Selection note"
                      : activeGlossaryTerm
                        ? "Glossary"
                        : activeNoteIsEditing
                          ? "Edit note"
                          : "Note"}
                </p>
                {activeGlossaryTerm ? (
                  <h2 className="glossary-panel-title">{activeGlossaryTerm.term}</h2>
                ) : pendingGlossaryTerm ? (
                  <h2 className="glossary-panel-title">{pendingGlossaryTerm.term}</h2>
                ) : null}
              </div>

              {pendingAnchor && pendingGlossaryTerm ? (
                <div className="selection-confirmation">
                  <p>已存在於詞彙庫中，是否綁定？</p>
                  <MarkdownPreviewContent
                    className="bottom-note-body glossary-existing-definition"
                    emptyLabel="尚未填寫說明"
                    value={pendingGlossaryTerm.definition}
                  />
                  <div className="note-actions bottom-note-actions">
                    <button
                      className="selection-confirmation-button"
                      type="button"
                      onClick={rejectPendingGlossaryTerm}
                    >
                      不綁定
                    </button>
                    <button
                      className="is-primary selection-confirmation-button"
                      type="button"
                      onClick={bindPendingGlossaryTerm}
                    >
                      綁定
                    </button>
                  </div>
                </div>
              ) : null}

              {pendingAnchor && !pendingGlossaryTerm && pendingAnchorIsGlossaryTerm ? (
                <div className="selection-confirmation">
                  <p>要建立或綁定「{pendingAnchor.selectedText.replace(/\s+/g, " ").trim()}」的名詞解釋嗎？</p>
                  <div className="note-actions bottom-note-actions">
                    <button
                      className="is-primary selection-confirmation-button"
                      type="button"
                      onClick={startPendingGlossaryFlow}
                    >
                      處理名詞
                    </button>
                  </div>
                </div>
              ) : null}

              {pendingAnchor &&
              !pendingGlossaryTerm &&
              !pendingAnchorIsGlossaryTerm &&
              pendingAnchorIsCompleteBlock ? (
                <div className="selection-confirmation">
                  <p>要新增筆記嗎？</p>
                  <div className="note-actions bottom-note-actions">
                    <button
                      className="is-primary selection-confirmation-button"
                      type="button"
                      aria-label="Add note"
                      title="Add note"
                      onClick={confirmPendingSelectionNote}
                    >
                      新增
                    </button>
                  </div>
                </div>
              ) : null}

              {!pendingAnchor && activeNoteIsEditing ? (
                <textarea
                  aria-label="Edit note"
                  ref={noteTextareaRef}
                  value={noteDraft}
                  autoFocus
                  onChange={(event) => updateActiveNoteDraft(event.currentTarget.value)}
                  onCompositionStart={handleNoteEditorCompositionStart}
                  onCompositionEnd={handleNoteEditorCompositionEnd}
                  onKeyDown={handleNoteEditorKeyDown}
                  disabled={isReturningToView}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  placeholder="Add a note..."
                />
              ) : null}

              {!pendingAnchor && activeGlossaryIsEditing ? (
                <textarea
                  aria-label="Edit glossary term"
                  ref={noteTextareaRef}
                  value={glossaryDraft}
                  autoFocus
                  onChange={(event) => updateActiveGlossaryDraft(event.currentTarget.value)}
                  onCompositionStart={handleNoteEditorCompositionStart}
                  onCompositionEnd={handleNoteEditorCompositionEnd}
                  onKeyDown={handleNoteEditorKeyDown}
                  disabled={isReturningToView}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  placeholder="輸入名詞解釋..."
                />
              ) : null}

              {!pendingAnchor && (activeNoteIsEditing || activeGlossaryIsEditing) && isReturningToView ? (
                <div className="note-returning-status" role="status">
                  <span className="note-returning-spinner" aria-hidden="true" />
                  <span>正在回到閱覽模式</span>
                </div>
              ) : null}

              {!pendingAnchor && activeGlossaryTerm && !activeGlossaryIsEditing ? (
                <MarkdownPreviewContent
                  className="bottom-note-body"
                  emptyLabel="尚未填寫說明"
                  onDoubleClick={() => openGlossaryEditor(activeGlossaryTerm.id)}
                  value={activeGlossaryTerm.definition}
                />
              ) : null}

              {!pendingAnchor && activeGlossaryTerm && !activeGlossaryIsEditing ? (
                <div className="note-actions bottom-note-actions">
                  {activeGlossaryBinding ? (
                    <button
                      className="is-glossary-action"
                      type="button"
                      aria-label="Remove glossary binding"
                      title="Remove glossary binding"
                      onClick={() => deleteGlossaryBinding(activeGlossaryBinding.id)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!pendingAnchor && activeNote && !activeNoteIsEditing ? (
                <MarkdownPreviewContent
                  className="bottom-note-body"
                  emptyLabel="無內容"
                  onDoubleClick={() => openNoteEditor(activeNote.id)}
                  value={activeNote.body}
                />
              ) : null}

              {!pendingAnchor && activeNote && !activeNoteIsEditing ? (
                <div className="note-actions bottom-note-actions">
                  <button
                    className="is-danger"
                    type="button"
                    aria-label="Delete note"
                    title="Delete"
                    onClick={() => deleteNote(activeNote.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

export default App;
