import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import {
  type ChangeEvent,
  createElement,
  Fragment,
  type CompositionEvent,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
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
import type { DocumentSearchState } from "./documentSearch";
import { SettingsView } from "./SettingsView";
import fileSelectedGlyphSvg from "./assets/file-selected-glyph.svg?raw";
import fileGlyphSvg from "./assets/file-glyph.svg?raw";
import folderGlyphSvg from "./assets/folder-glyph.svg?raw";
import folderSelectedGlyphSvg from "./assets/folder-selected-glyph.svg?raw";
import collapseIconSvg from "./assets/collapse.svg?raw";
import expandIconSvg from "./assets/expand.svg?raw";
import { appLanguageHtmlLang, createTranslator } from "./i18n";
import { loadScholiumMermaid } from "./mermaid";
import {
  readSettingsSnapshot,
  resetSetting,
  resetSettings,
  writeSetting,
  type SettingCategory,
  type SettingKey,
  type SettingValue,
  type SettingsSnapshot,
} from "./settings";

const markdownUnorderedListLinePattern = /^(\s*)[-*+]\s+(.*)$/;
const markdownOrderedListLinePattern = /^(\s*)\d+[.)]\s+(.*)$/;
const inlineBreakPattern = /<br\s*\/?>/gi;
const annotationClickDelayMs = 500;
const libraryAnnotationClickSuppressionMs = annotationClickDelayMs + 350;
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
  dropboxRev?: string | null;
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

type LibraryAnnotationPointerEvent = {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: EventTarget | null;
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

type SearchMarkdownFileResult = {
  path: string;
  parentPath: string | null;
  title: string;
  relativePath: string;
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

type MarkdownImageFileResult = {
  path: string;
  mimeType: string;
  dataUrl: string;
};

type WritePdfFileResult = {
  path: string;
};

type WorkspaceEntry =
  | {
      kind: "parent-directory";
      id: string;
      title: string;
      path: string;
      depth?: number;
      source?: "local" | "dropbox";
    }
  | {
      kind: "directory";
      id: string;
      title: string;
      path: string;
      depth?: number;
      source?: "local" | "dropbox";
    }
  | {
      kind: "file";
      id: string;
      title: string;
      path: string;
      documentId: string;
      depth?: number;
      source?: "local" | "dropbox";
    };

type NativeLocationKind = "directory" | "file";
type WorkspaceSource = "local" | "dropbox";

type NativeLocation = {
  kind: NativeLocationKind;
  path: string;
  title: string;
};

type OpenLocationEventPayload = {
  kind: NativeLocationKind;
  path: string;
};

type DropboxOAuthStatusResult = {
  connected: boolean;
};

type StartDropboxOAuthResult = {
  authUrl: string;
  redirectUri: string;
};

type DropboxOAuthCallbackPayload = {
  status: "success" | "error";
  code?: string | null;
  state?: string | null;
  error?: string | null;
};

type DropboxDirectoryEntryResult = {
  kind: "directory" | "file";
  path: string;
  title: string;
  size?: number | null;
  serverModified?: string | null;
};

type OpenDropboxMarkdownDirectoryResult = {
  path: string;
  parentPath: string | null;
  title: string;
  entries: DropboxDirectoryEntryResult[];
};

type OpenDropboxMarkdownFileResult = {
  path: string;
  notesPath: string;
  title: string;
  body: string;
  notes: SelectionNote[];
  glossaryTerms?: GlossaryTerm[];
  glossaryBindings?: GlossaryBinding[];
  rev?: string | null;
  serverModified?: string | null;
};

type DropboxDirectoryPickerNode = DropboxDirectoryEntryResult & {
  kind: "directory";
  children: DropboxDirectoryPickerNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  error: string;
};

type FlattenedDropboxDirectoryPickerNode = {
  node: DropboxDirectoryPickerNode;
  depth: number;
};

type DropboxDirectoryPickerState = {
  directories: DropboxDirectoryPickerNode[];
  selectedPath: string;
  isLoadingRoot: boolean;
  isOpening: boolean;
  error: string;
};

type DirtyDocumentState = {
  body: boolean;
  notes: boolean;
};

type DirtyDocumentStates = Record<string, DirtyDocumentState>;

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
  borderRadius: string;
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

type PreviewAnnotationRect = {
  bottom: number;
  canExtendRight: boolean;
  left: number;
  lineRight: number;
  right: number;
  top: number;
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

type FileActionTarget = {
  documentId: string;
  path: string;
  title: string;
  source?: WorkspaceSource;
};

type FileContextMenuState = FileActionTarget & {
  exportDocumentIds: string[];
  left: number;
  top: number;
};

type ResolvedFileActionTarget = FileActionTarget & {
  document: MarkdownDocument | null;
  isDropboxTarget: boolean;
};

type FileContextMenuAction = {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: "danger";
  onSelect: () => void;
};

type DuplicateFileDialogState = FileActionTarget & {
  fileName: string;
  isSubmitting: boolean;
};

function DocumentGlyphIcon({ kind, selected = false }: { kind: "file" | "folder"; selected?: boolean }) {
  const glyphSvg =
    kind === "folder"
      ? selected
        ? folderSelectedGlyphSvg
        : folderGlyphSvg
      : selected
        ? fileSelectedGlyphSvg
        : fileGlyphSvg;

  return (
    <span
      aria-hidden="true"
      className={`document-icon ${selected ? "is-selected" : ""}`}
      dangerouslySetInnerHTML={{ __html: glyphSvg }}
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

function PdfIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M7 4.5h7l3 3v12H7z" />
      <path d="M14 4.5v3h3" />
      <path d="M9.5 12h5" />
      <path d="M9.5 15h3.5" />
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

function ExpandPanelIcon() {
  return (
    <span
      aria-hidden="true"
      className="note-action-icon note-action-icon--raw-svg"
      dangerouslySetInnerHTML={{ __html: expandIconSvg }}
    />
  );
}

function CollapsePanelIcon() {
  return (
    <span
      aria-hidden="true"
      className="note-action-icon note-action-icon--raw-svg"
      dangerouslySetInnerHTML={{ __html: collapseIconSvg }}
    />
  );
}

function MobileFilesIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15z" />
      <path d="M3.5 6.5v-2h5.4l2 2h6.6a2 2 0 0 1 2 2" />
    </svg>
  );
}

function MobileNoteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M6 4.5h12v15H6z" />
      <path d="M9 8h6" />
      <path d="M9 11.5h6" />
      <path d="M9 15h3.5" />
    </svg>
  );
}

function MobileTermIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M5 6h14" />
      <path d="M12 6v12" />
      <path d="M8 18h8" />
    </svg>
  );
}

function MobileLibraryIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M5 4.5h10.5a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 17z" />
      <path d="M8 8h7" />
      <path d="M8 11.5h7" />
      <path d="M8 15h4" />
    </svg>
  );
}

function SourceModeIcon({ className = "editor-mode-toggle__icon" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m9 18-6-6 6-6" />
      <path d="m15 6 6 6-6 6" />
    </svg>
  );
}

function SearchIcon({ className = "document-search__icon" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

function SearchPreviousIcon() {
  return (
    <svg aria-hidden="true" className="document-search__button-icon" fill="none" viewBox="0 0 24 24">
      <path d="m7 14 5-5 5 5" />
    </svg>
  );
}

function SearchNextIcon() {
  return (
    <svg aria-hidden="true" className="document-search__button-icon" fill="none" viewBox="0 0 24 24">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function SearchCloseIcon() {
  return (
    <svg aria-hidden="true" className="document-search__button-icon" fill="none" viewBox="0 0 24 24">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function MobileNewFileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-source-action__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M7 4.5h7l3 3v12H7z" />
      <path d="M14 4.5v3h3" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5h5" />
    </svg>
  );
}

function MobileOpenFileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-source-action__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M7 4.5h7l3 3v12H7z" />
      <path d="M14 4.5v3h3" />
      <path d="M9.5 11h5" />
      <path d="M9.5 14.5h4" />
    </svg>
  );
}

function MobileOpenFolderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-source-action__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M3.5 7h6l2 2h9v8.5a2 2 0 0 1-2 2h-15z" />
      <path d="M3.5 7v-2h5.4l2 2h4.6" />
    </svg>
  );
}

function MobileCloudIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-source-action__icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M8.5 18.5h8a4 4 0 0 0 .6-8 5.2 5.2 0 0 0-10-1.8A3.8 3.8 0 0 0 8.5 18.5z" />
    </svg>
  );
}

function PinBadge({ ariaLabel }: { ariaLabel: string }) {
  return (
    <div className="pin-badge" aria-label={ariaLabel}>
      <svg aria-hidden="true" width="13.5" height="13.5" viewBox="0 0 24 24" fill="none">
        <path
          d="M14.5 3.5 9 9 5.5 9.8 4 11.3l3.8 3.8-3.3 4.6 4.6-3.3 3.8 3.8 1.5-1.5.8-3.5 5.5-5.5z"
          fill="#F7E0C8"
        />
        <path
          d="m9.6 14.4-5 5"
          stroke="#F7E0C8"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
    </div>
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

type MarkdownPreviewListKind = "unordered-list" | "ordered-list";

type MarkdownPreviewListItem = {
  children: MarkdownPreviewList[];
  flatIndex: number;
  key: string;
  text: string;
};

type MarkdownPreviewList = {
  kind: MarkdownPreviewListKind;
  items: MarkdownPreviewListItem[];
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
      info: string;
      language: string;
      text: string;
    }
  | {
      kind: MarkdownPreviewListKind;
      key: string;
      startLine: number;
      endLine: number;
      items: string[];
      list: MarkdownPreviewList;
      rawLines: string[];
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
const previewAnnotationFrameHorizontalPadding = 12;
const previewAnnotationLineJoinMaxGap = 20;
const previewAnnotationLineEndTolerance = 2;
const previewAnnotationFrameCornerRadius = "4px";
const annotationLayoutSettleDelaysMs = [80, 180, 360, 720];
const noteLibraryFocusAlignmentRatio = 0.2;
const notePanelAnimationMs = 180;
const selectionWarningAutoDismissMs = 2600;
const appDrivenSelectionClearGuardMs = 1200;
const autosaveDelayMs = 500;
const externalFileRefreshIntervalMs = 1500;
const pdfCssPageWidth = 794;
const pdfCssPageHeight = 1123;
const pdfPageWidthPoints = 595.28;
const pdfPageHeightPoints = 841.89;
const pdfRenderScale = 2;
const lastOpenedMarkdownPathStorageKey = "scholium:last-opened-markdown-path";
const lastOpenedMarkdownRootDirectoryStorageKey =
  "scholium:last-opened-markdown-root-directory";
const mobileViewportQuery = "(max-width: 640px)";
const mobileSafeLayoutViewportQuery =
  "((max-width: 640px) and (any-pointer: coarse)), ((max-width: 980px) and (max-height: 520px) and (any-pointer: coarse))";
const dropboxDocumentIdPrefix = "dropbox:";
const configuredDropboxAppKey = import.meta.env.VITE_DROPBOX_APP_KEY?.trim() ?? "";

function previewAnnotationFramePaddingForKind(kind: AnnotationKind) {
  return kind === "glossary" ? 0 : previewAnnotationFramePadding;
}

function previewAnnotationFrameHorizontalPaddingForKind(kind: AnnotationKind) {
  return kind === "glossary" ? 0 : previewAnnotationFrameHorizontalPadding;
}

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

function filePathInDirectory(directoryPath: string | null | undefined, fileName: string) {
  const trimmedDirectoryPath = directoryPath?.trim() ?? "";
  const trimmedFileName = fileName.trim();
  if (!trimmedDirectoryPath || !trimmedFileName) return trimmedFileName;

  const separator =
    trimmedDirectoryPath.includes("\\") && !trimmedDirectoryPath.includes("/") ? "\\" : "/";
  const directoryWithoutTrailingSeparators = trimmedDirectoryPath.replace(/[\\/]+$/, "");
  if (!directoryWithoutTrailingSeparators) return `${separator}${trimmedFileName}`;

  return `${directoryWithoutTrailingSeparators}${separator}${trimmedFileName}`;
}

function dropboxDocumentId(path: string) {
  return `${dropboxDocumentIdPrefix}${path || "/"}`;
}

function isDropboxDocumentId(documentId: string) {
  return documentId.startsWith(dropboxDocumentIdPrefix);
}

function documentIsFromDropbox(document: MarkdownDocument) {
  return isDropboxDocumentId(document.id);
}

function workspaceEntryFromDocument(
  document: MarkdownDocument,
  depth = 1,
): Extract<WorkspaceEntry, { kind: "file" }> {
  return {
    kind: "file",
    id: `file:${document.id}`,
    title: document.title,
    path: document.path,
    documentId: document.id,
    depth,
    source: documentIsFromDropbox(document) ? "dropbox" : "local",
  };
}

function workspaceEntrySortRank(entry: WorkspaceEntry) {
  if (entry.kind === "parent-directory") return 0;
  if (entry.kind === "directory") return 1;
  return 2;
}

function compareWorkspaceEntries(left: WorkspaceEntry, right: WorkspaceEntry) {
  const rankDifference = workspaceEntrySortRank(left) - workspaceEntrySortRank(right);
  if (rankDifference !== 0) return rankDifference;

  const leftTitle = left.title.toLowerCase();
  const rightTitle = right.title.toLowerCase();
  if (leftTitle < rightTitle) return -1;
  if (leftTitle > rightTitle) return 1;

  const leftPath = left.path.toLowerCase();
  const rightPath = right.path.toLowerCase();
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;

  return 0;
}

function sortWorkspaceEntriesForDirectory(entries: WorkspaceEntry[]) {
  return [...entries].sort(compareWorkspaceEntries);
}

function directoryTreeKey(entry: Pick<WorkspaceEntry, "path" | "source">) {
  return `${entry.source ?? "local"}:${entry.path}`;
}

function workspaceEntrySelectionKey(entry: WorkspaceEntry) {
  return `${entry.kind}:${entry.source ?? "local"}:${entry.path}`;
}

function localFileSearchResultSelectionKey(result: SearchMarkdownFileResult) {
  return `file-search:${result.path}`;
}

function workspaceEntriesFromOpenedDirectory(
  openedDirectory: OpenMarkdownDirectoryResult,
  depth: number,
): WorkspaceEntry[] {
  return openedDirectory.entries.map((entry): WorkspaceEntry => {
    if (entry.kind === "directory") {
      return {
        kind: "directory",
        id: `directory:${entry.path}`,
        title: entry.title,
        path: entry.path,
        depth,
        source: "local",
      };
    }

    return workspaceEntryFromDocument(documentFromLoadedFileResult(entry.file), depth);
  });
}

function workspaceEntriesFromOpenedDropboxDirectory(
  openedDirectory: OpenDropboxMarkdownDirectoryResult,
  depth: number,
): WorkspaceEntry[] {
  return openedDirectory.entries.map((entry): WorkspaceEntry => {
    if (entry.kind === "directory") {
      return {
        kind: "directory",
        id: `dropbox-directory:${entry.path || "/"}`,
        title: entry.title,
        path: entry.path,
        depth,
        source: "dropbox",
      };
    }

    return {
      kind: "file",
      id: `dropbox-file:${entry.path}`,
      title: entry.title,
      path: entry.path,
      documentId: dropboxDocumentId(entry.path),
      depth,
      source: "dropbox",
    };
  });
}

function dropboxPickerDirectories(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
  return openedDirectory.entries.filter(
    (entry): entry is DropboxDirectoryEntryResult & { kind: "directory" } =>
      entry.kind === "directory",
  );
}

function dropboxPickerNodeFromDirectory(
  directory: DropboxDirectoryEntryResult & { kind: "directory" },
): DropboxDirectoryPickerNode {
  return {
    ...directory,
    children: [],
    isExpanded: false,
    isLoaded: false,
    isLoading: false,
    error: "",
  };
}

function dropboxPickerNodesFromOpenedDirectory(
  openedDirectory: OpenDropboxMarkdownDirectoryResult,
) {
  return dropboxPickerDirectories(openedDirectory).map(dropboxPickerNodeFromDirectory);
}

function flattenDropboxDirectoryPickerNodes(
  nodes: DropboxDirectoryPickerNode[],
  depth = 0,
): FlattenedDropboxDirectoryPickerNode[] {
  return nodes.flatMap((node) => {
    const flattenedNode = { node, depth };
    if (!node.isExpanded) return [flattenedNode];

    return [
      flattenedNode,
      ...flattenDropboxDirectoryPickerNodes(node.children, depth + 1),
    ];
  });
}

function updateDropboxDirectoryPickerNode(
  nodes: DropboxDirectoryPickerNode[],
  path: string,
  updater: (node: DropboxDirectoryPickerNode) => DropboxDirectoryPickerNode,
): DropboxDirectoryPickerNode[] {
  return nodes.map((node) => {
    if (node.path === path) return updater(node);

    if (node.children.length === 0) return node;

    return {
      ...node,
      children: updateDropboxDirectoryPickerNode(node.children, path, updater),
    };
  });
}

function firstDropboxMarkdownFileEntry(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
  return openedDirectory.entries.find(
    (entry): entry is DropboxDirectoryEntryResult & { kind: "file" } =>
      entry.kind === "file",
  );
}

function documentFromLoadedFileResult(loaded: OpenMarkdownFileResult): MarkdownDocument {
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

function collectVisibleDescendantDirectoryKeys(entries: WorkspaceEntry[], directory: WorkspaceEntry) {
  const directoryIndex = entries.findIndex(
    (entry) => entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return [];

  const baseDepth = directory.depth ?? 1;
  const keys: string[] = [];
  for (const entry of entries.slice(directoryIndex + 1)) {
    const entryDepth = entry.depth ?? 1;
    if (entryDepth <= baseDepth) break;
    if (entry.kind === "directory") keys.push(directoryTreeKey(entry));
  }
  return keys;
}

function collapseWorkspaceDirectory(entries: WorkspaceEntry[], directory: WorkspaceEntry) {
  const directoryIndex = entries.findIndex(
    (entry) => entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return entries;

  const baseDepth = directory.depth ?? 1;
  const nextEntries = [...entries.slice(0, directoryIndex + 1)];
  const remainingEntries = entries.slice(directoryIndex + 1);
  const firstSiblingIndex = remainingEntries.findIndex((entry) => (entry.depth ?? 1) <= baseDepth);
  if (firstSiblingIndex >= 0) {
    nextEntries.push(...remainingEntries.slice(firstSiblingIndex));
  }
  return nextEntries;
}

function insertWorkspaceDirectoryChildren(
  entries: WorkspaceEntry[],
  directory: WorkspaceEntry,
  childEntries: WorkspaceEntry[],
) {
  const collapsedEntries = collapseWorkspaceDirectory(entries, directory);
  const directoryIndex = collapsedEntries.findIndex(
    (entry) => entry.kind === "directory" && directoryTreeKey(entry) === directoryTreeKey(directory),
  );
  if (directoryIndex < 0) return entries;

  return [
    ...collapsedEntries.slice(0, directoryIndex + 1),
    ...childEntries,
    ...collapsedEntries.slice(directoryIndex + 1),
  ];
}

function insertOrUpdateWorkspaceFileEntry(
  entries: WorkspaceEntry[],
  fileEntry: Extract<WorkspaceEntry, { kind: "file" }>,
  workspaceRootPath: string | null,
) {
  const existingEntryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "file" &&
      (entry.documentId === fileEntry.documentId ||
        (entry.source === fileEntry.source && localPathsMatch(entry.path, fileEntry.path))),
  );

  if (existingEntryIndex >= 0) {
    return entries.map((entry, index) =>
      index === existingEntryIndex
        ? {
            ...entry,
            title: fileEntry.title,
            path: fileEntry.path,
            id: fileEntry.id,
            documentId: fileEntry.documentId,
          }
        : entry,
    );
  }

  const fileParentPath = normalizeLocalPathForCompare(parentDirectoryPath(fileEntry.path));
  const rootPath = normalizeLocalPathForCompare(workspaceRootPath);

  if (!rootPath || fileParentPath === rootPath) {
    return [...entries, { ...fileEntry, depth: 1 }];
  }

  const parentDirectoryIndex = entries.findIndex(
    (entry) =>
      entry.kind === "directory" &&
      entry.source === fileEntry.source &&
      localPathsMatch(entry.path, fileParentPath),
  );
  if (parentDirectoryIndex < 0) {
    return [...entries, { ...fileEntry, depth: 1 }];
  }

  const parentDirectory = entries[parentDirectoryIndex];
  const fileDepth = (parentDirectory.depth ?? 1) + 1;
  const followingEntries = entries.slice(parentDirectoryIndex + 1);
  const nextSiblingOffset = followingEntries.findIndex(
    (entry) => (entry.depth ?? 1) <= (parentDirectory.depth ?? 1),
  );
  const insertionIndex =
    nextSiblingOffset >= 0
      ? parentDirectoryIndex + 1 + nextSiblingOffset
      : entries.length;

  return [
    ...entries.slice(0, insertionIndex),
    { ...fileEntry, depth: fileDepth },
    ...entries.slice(insertionIndex),
  ];
}

function estimateDirectoryTextWidth(text: string) {
  return Array.from(text).reduce((width, character) => {
    if (/[\u3400-\u9fff]/.test(character)) return width + 14;
    if (/[A-Z0-9_]/.test(character)) return width + 9;
    if (/[il.,'` ]/.test(character)) return width + 4;
    return width + 8;
  }, 0);
}

function estimateDocumentPaneWidth(workspaceTitle: string, entries: WorkspaceEntry[]) {
  const rootWidth = 64 + estimateDirectoryTextWidth(workspaceTitle);
  const entryWidth = entries.reduce((maxWidth, entry) => {
    const depth = entry.depth ?? 1;
    const controlWidth = entry.kind === "directory" ? 42 : 36;
    const width = 34 + depth * 12 + controlWidth + estimateDirectoryTextWidth(entry.title);
    return Math.max(maxWidth, width);
  }, rootWidth);

  return Math.max(272, Math.min(520, Math.ceil(entryWidth)));
}

function normalizedFileSearchTerms(query: string) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function workspaceEntryMatchesSearch(entry: WorkspaceEntry, terms: string[]) {
  if (terms.length === 0) return true;

  const searchableText = `${entry.title} ${entry.path}`.toLowerCase();
  return terms.every((term) => searchableText.includes(term));
}

function filterWorkspaceEntriesForSearch(entries: WorkspaceEntry[], query: string) {
  const terms = normalizedFileSearchTerms(query);
  if (terms.length === 0) return entries;

  const includedEntryIndexes = new Set<number>();
  const ancestorIndexesByDepth = new Map<number, number>();

  entries.forEach((entry, index) => {
    const depth = entry.depth ?? 1;

    Array.from(ancestorIndexesByDepth.keys()).forEach((ancestorDepth) => {
      if (ancestorDepth >= depth) ancestorIndexesByDepth.delete(ancestorDepth);
    });

    if (entry.kind !== "file") {
      ancestorIndexesByDepth.set(depth, index);
    }

    if (!workspaceEntryMatchesSearch(entry, terms)) return;

    includedEntryIndexes.add(index);
    ancestorIndexesByDepth.forEach((ancestorIndex) => {
      includedEntryIndexes.add(ancestorIndex);
    });

    if (entry.kind === "file") return;

    for (let descendantIndex = index + 1; descendantIndex < entries.length; descendantIndex += 1) {
      const descendantEntry = entries[descendantIndex];
      if ((descendantEntry.depth ?? 1) <= depth) break;
      includedEntryIndexes.add(descendantIndex);
    }
  });

  return entries.filter((_, index) => includedEntryIndexes.has(index));
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

function readLastOpenedMarkdownRootDirectoryPath() {
  try {
    return window.localStorage.getItem(lastOpenedMarkdownRootDirectoryStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberLastOpenedMarkdownRootDirectoryPath(path: string | null | undefined) {
  if (!path) return;

  try {
    window.localStorage.setItem(lastOpenedMarkdownRootDirectoryStorageKey, path);
  } catch {
    // Remembering the last root directory is best-effort only.
  }
}

function forgetLastOpenedMarkdownRootDirectoryPath() {
  try {
    window.localStorage.removeItem(lastOpenedMarkdownRootDirectoryStorageKey);
  } catch {
    // Remembering the last root directory is best-effort only.
  }
}

function parentDirectoryPath(path: string | null | undefined) {
  const normalizedPath = path?.trim();
  if (!normalizedPath) return "";

  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  if (separatorIndex <= 0) return "";

  return normalizedPath.slice(0, separatorIndex);
}

function normalizeLocalPathForCompare(path: string | null | undefined) {
  let normalizedPath = path?.trim().replace(/\\/g, "/") ?? "";
  while (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}

function localPathsMatch(left: string | null | undefined, right: string | null | undefined) {
  return normalizeLocalPathForCompare(left) === normalizeLocalPathForCompare(right);
}

function localPathIsInsideDirectory(path: string, directoryPath: string) {
  const normalizedPath = normalizeLocalPathForCompare(path);
  const normalizedDirectoryPath = normalizeLocalPathForCompare(directoryPath);
  if (!normalizedPath || !normalizedDirectoryPath) return false;
  if (normalizedPath === normalizedDirectoryPath) return true;
  if (normalizedDirectoryPath === "/") return normalizedPath.startsWith("/");

  return normalizedPath.startsWith(`${normalizedDirectoryPath}/`);
}

function ancestorDirectoryPathsForFile(rootDirectoryPath: string, filePath: string) {
  const rootPath = normalizeLocalPathForCompare(rootDirectoryPath);
  const selectedDirectoryPath = normalizeLocalPathForCompare(parentDirectoryPath(filePath));
  if (!rootPath || !selectedDirectoryPath) return [];
  if (selectedDirectoryPath === rootPath) return [];
  if (!localPathIsInsideDirectory(selectedDirectoryPath, rootPath)) return [];

  const ancestorPaths: string[] = [];
  let currentPath = selectedDirectoryPath;

  while (currentPath && currentPath !== rootPath) {
    ancestorPaths.unshift(currentPath);

    const parentPath = normalizeLocalPathForCompare(parentDirectoryPath(currentPath));
    if (!parentPath || parentPath === currentPath) return [];
    currentPath = parentPath;
  }

  return currentPath === rootPath ? ancestorPaths : [];
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

function isInlineBreakToken(token: string) {
  return token === "\n" || /^<br\s*\/?>$/i.test(token);
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\n|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|<br\s*\/?>)/gi;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-inline-${tokenIndex}`;

    if (isInlineBreakToken(token)) {
      nodes.push(<br key={key} />);
    } else if (token.startsWith("`")) {
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

type PdfExportDocument = Pick<MarkdownDocument, "body" | "filePath" | "path" | "title">;

type PdfJpegPage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type PdfSvgTextElement = {
  kind: "text";
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  text: string;
  x: number;
  y: number;
};

type PdfSvgRectElement = {
  kind: "rect";
  fill: string;
  height: number;
  rx?: number;
  stroke?: string;
  strokeDasharray?: string;
  width: number;
  x: number;
  y: number;
};

type PdfSvgLineElement = {
  kind: "line";
  stroke: string;
  strokeWidth: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

type PdfSvgImageElement = {
  kind: "image";
  alt: string;
  height: number;
  src: string;
  width: number;
  x: number;
  y: number;
};

type PdfSvgElement =
  | PdfSvgTextElement
  | PdfSvgRectElement
  | PdfSvgLineElement
  | PdfSvgImageElement;

type PdfSvgPage = {
  elements: PdfSvgElement[];
};

type PdfInlinePart =
  | {
      kind: "text";
      text: string;
    }
  | {
      alt: string;
      kind: "image";
      src: string;
    };

type PdfTextStyle = {
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
};

type PdfImageLayout = {
  alt: string;
  dataUrl: string;
  height: number;
  width: number;
};

const pdfPagePaddingX = 72;
const pdfPagePaddingY = 64;
const pdfContentWidth = pdfCssPageWidth - pdfPagePaddingX * 2;
const pdfContentBottom = pdfCssPageHeight - pdfPagePaddingY;
const pdfMaxImageHeight = 720;
const pdfBodyFontFamily =
  '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Helvetica Neue", Arial, sans-serif';
const pdfMonoFontFamily = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const pdfBodyTextStyle: PdfTextStyle = {
  fill: "#161616",
  fontFamily: pdfBodyFontFamily,
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 26,
};
const pdfQuoteTextStyle: PdfTextStyle = {
  ...pdfBodyTextStyle,
  fill: "#4b5563",
};
const pdfCodeTextStyle: PdfTextStyle = {
  fill: "#24292f",
  fontFamily: pdfMonoFontFamily,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 19,
};
const pdfImageFallbackStyle: PdfTextStyle = {
  fill: "#6b7280",
  fontFamily: pdfBodyFontFamily,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 19,
};

function localMarkdownImageNeedsHydration(src: string) {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) return false;

  return !/^(https?:|data:|blob:|asset:|tauri:|ipc:|\/\/)/i.test(trimmedSrc);
}

function fileNameFromPath(path: string | null | undefined) {
  const normalizedPath = path?.trim().replace(/\\/g, "/") ?? "";
  if (!normalizedPath) return "";

  return normalizedPath.split("/").filter(Boolean).pop() ?? "";
}

function stripMarkdownExtension(fileName: string) {
  return fileName.replace(/\.(md|markdown|mdown)$/i, "");
}

function sanitizedPdfFileName(value: string) {
  const sanitized = value
    .trim()
    .replace(/\.(pdf)$/i, "")
    .replace(/\.(md|markdown|mdown)$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");

  return `${sanitized || "Scholium"}.pdf`;
}

function pdfFileNameForDocument(exportDocument: PdfExportDocument) {
  const sourceFileName = fileNameFromPath(exportDocument.path);
  return sanitizedPdfFileName(stripMarkdownExtension(sourceFileName) || exportDocument.title);
}

function isDataImageSource(src: string) {
  return /^data:image\//i.test(src.trim());
}

async function resolvePdfImageSource(markdownPath: string | null, imageSrc: string) {
  if (isDataImageSource(imageSrc)) return imageSrc;
  if (!markdownPath || !localMarkdownImageNeedsHydration(imageSrc)) return "";

  const result = await invoke<MarkdownImageFileResult>("read_markdown_image_file", {
    markdownPath,
    imageSrc,
  });

  return result.dataUrl;
}

function markdownInlineToPlainText(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function parsePdfInlineParts(text: string) {
  const parts: PdfInlinePart[] = [];
  const imageTokenPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(imageTokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const textPart = markdownInlineToPlainText(text.slice(lastIndex, index));
      if (textPart) {
        parts.push({ kind: "text", text: textPart });
      }
    }

    parts.push({
      alt: match[1] ?? "",
      kind: "image",
      src: match[2] ?? "",
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    const textPart = markdownInlineToPlainText(text.slice(lastIndex));
    if (textPart) {
      parts.push({ kind: "text", text: textPart });
    }
  }

  return parts;
}

function loadPdfImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to render PDF page image"));
    image.src = src;
  });
}

async function resolvePdfImageLayout(
  markdownPath: string | null,
  imageSrc: string,
  alt: string,
): Promise<PdfImageLayout | null> {
  const dataUrl = await resolvePdfImageSource(markdownPath, imageSrc);
  if (!dataUrl) return null;

  const image = await loadPdfImage(dataUrl);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;

  return {
    alt,
    dataUrl,
    height: image.naturalHeight,
    width: image.naturalWidth,
  };
}

function pdfHeadingTextStyle(level: number): PdfTextStyle {
  if (level <= 1) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 34,
      fontWeight: 700,
      lineHeight: 42,
    };
  }
  if (level === 2) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 26,
      fontWeight: 700,
      lineHeight: 33,
    };
  }
  if (level === 3) {
    return {
      fill: "#111827",
      fontFamily: pdfBodyFontFamily,
      fontSize: 21,
      fontWeight: 700,
      lineHeight: 28,
    };
  }

  return {
    fill: "#111827",
    fontFamily: pdfBodyFontFamily,
    fontSize: 17,
    fontWeight: 700,
    lineHeight: 24,
  };
}

function createPdfTextMeasureContext() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("failed to create PDF text measurement context");

  return context;
}

function pdfCanvasFont(style: PdfTextStyle) {
  return `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function measurePdfText(
  context: CanvasRenderingContext2D,
  text: string,
  style: PdfTextStyle,
) {
  context.font = pdfCanvasFont(style);
  return context.measureText(text).width;
}

function isPdfCjkWrapCharacter(character: string) {
  return /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(character);
}

function splitPdfWrapUnits(text: string) {
  const units: string[] = [];
  let word = "";

  const flushWord = () => {
    if (!word) return;
    units.push(word);
    word = "";
  };

  for (const character of Array.from(text)) {
    if (character === "\n") {
      flushWord();
      units.push("\n");
    } else if (/\s/.test(character)) {
      flushWord();
      units.push(" ");
    } else if (isPdfCjkWrapCharacter(character)) {
      flushWord();
      units.push(character);
    } else {
      word += character;
    }
  }

  flushWord();
  return units;
}

function wrapOversizedPdfUnit(
  context: CanvasRenderingContext2D,
  unit: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(unit)) {
    const candidate = `${current}${character}`;
    if (current && measurePdfText(context, candidate, style) > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function wrapPdfText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  const lines: string[] = [];
  let current = "";

  for (const unit of splitPdfWrapUnits(text)) {
    if (unit === "\n") {
      lines.push(current.trimEnd());
      current = "";
      continue;
    }
    if (unit === " " && !current) continue;

    const nextUnit = current ? unit : unit.trimStart();
    const candidate = `${current}${nextUnit}`;
    if (!current || measurePdfText(context, candidate, style) <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current.trimEnd());
    if (measurePdfText(context, nextUnit, style) > maxWidth) {
      const oversizedLines = wrapOversizedPdfUnit(context, nextUnit, maxWidth, style);
      current = oversizedLines.pop() ?? "";
      lines.push(...oversizedLines);
    } else {
      current = nextUnit.trimStart();
    }
  }

  if (current.trimEnd()) {
    lines.push(current.trimEnd());
  }

  return lines;
}

function wrapPdfCodeLine(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: PdfTextStyle,
) {
  if (!text) return [""];

  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text)) {
    const printableCharacter = character === " " ? "\u00a0" : character;
    const candidate = `${current}${printableCharacter}`;
    if (current && measurePdfText(context, candidate, style) > maxWidth) {
      lines.push(current);
      current = printableCharacter;
    } else {
      current = candidate;
    }
  }

  lines.push(current);
  return lines;
}

class PdfSvgLayout {
  private currentPage: PdfSvgPage;
  private readonly pages: PdfSvgPage[];
  private y: number;

  constructor(private readonly textContext: CanvasRenderingContext2D) {
    this.currentPage = { elements: [] };
    this.pages = [this.currentPage];
    this.y = pdfPagePaddingY;
  }

  getPages() {
    return this.pages;
  }

  getCursorY() {
    return this.y;
  }

  private isAtPageTop() {
    return this.y <= pdfPagePaddingY + 0.1 && this.currentPage.elements.length === 0;
  }

  private startNewPage() {
    this.currentPage = { elements: [] };
    this.pages.push(this.currentPage);
    this.y = pdfPagePaddingY;
  }

  addGap(height: number) {
    if (height <= 0 || this.isAtPageTop()) return;
    this.y = Math.min(pdfContentBottom, this.y + height);
  }

  ensureSpace(height: number) {
    if (this.y + height <= pdfContentBottom || this.isAtPageTop()) return;
    this.startNewPage();
  }

  addLine(element: Omit<PdfSvgLineElement, "kind">) {
    this.currentPage.elements.push({ kind: "line", ...element });
  }

  addRect(element: Omit<PdfSvgRectElement, "kind">) {
    this.currentPage.elements.push({ kind: "rect", ...element });
  }

  addTextLine(text: string, x: number, style: PdfTextStyle) {
    this.ensureSpace(style.lineHeight);
    this.currentPage.elements.push({
      fill: style.fill,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      kind: "text",
      text,
      x,
      y: this.y + style.fontSize,
    });
    this.y += style.lineHeight;
  }

  addWrappedText(
    text: string,
    x: number,
    maxWidth: number,
    style: PdfTextStyle,
    options: { marginBottom?: number; marginTop?: number } = {},
  ) {
    const lines = wrapPdfText(this.textContext, text, maxWidth, style);
    if (lines.length === 0) return;

    this.addGap(options.marginTop ?? 0);
    for (const line of lines) {
      this.addTextLine(line, x, style);
    }
    this.addGap(options.marginBottom ?? 0);
  }

  addListItem(marker: string, text: string, style: PdfTextStyle) {
    const markerX = pdfPagePaddingX;
    const textX = pdfPagePaddingX + 28;
    const lines = wrapPdfText(this.textContext, text, pdfContentWidth - 28, style);
    if (lines.length === 0) return;

    this.addGap(2);
    lines.forEach((line, index) => {
      this.ensureSpace(style.lineHeight);
      if (index === 0) {
        this.currentPage.elements.push({
          fill: style.fill,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          kind: "text",
          text: marker,
          x: markerX,
          y: this.y + style.fontSize,
        });
      }
      this.currentPage.elements.push({
        fill: style.fill,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        kind: "text",
        text: line,
        x: textX,
        y: this.y + style.fontSize,
      });
      this.y += style.lineHeight;
    });
  }

  addCodeBlock(text: string) {
    const codePaddingX = 16;
    const codePaddingY = 14;
    const lines = text
      .split("\n")
      .flatMap((line) =>
        wrapPdfCodeLine(
          this.textContext,
          line,
          pdfContentWidth - codePaddingX * 2,
          pdfCodeTextStyle,
        ),
      );
    const remainingLines = lines.length > 0 ? lines : [""];

    this.addGap(16);
    while (remainingLines.length > 0) {
      const availableHeight = Math.max(
        pdfCodeTextStyle.lineHeight + codePaddingY * 2,
        pdfContentBottom - this.y,
      );
      const maxLinesOnPage = Math.max(
        1,
        Math.floor((availableHeight - codePaddingY * 2) / pdfCodeTextStyle.lineHeight),
      );
      const pageLines = remainingLines.splice(0, maxLinesOnPage);
      const blockHeight = pageLines.length * pdfCodeTextStyle.lineHeight + codePaddingY * 2;

      this.ensureSpace(blockHeight);
      this.addRect({
        fill: "#f6f8fa",
        height: blockHeight,
        rx: 6,
        stroke: "#d8dee4",
        width: pdfContentWidth,
        x: pdfPagePaddingX,
        y: this.y,
      });
      let lineY = this.y + codePaddingY;
      for (const line of pageLines) {
        this.currentPage.elements.push({
          fill: pdfCodeTextStyle.fill,
          fontFamily: pdfCodeTextStyle.fontFamily,
          fontSize: pdfCodeTextStyle.fontSize,
          fontWeight: pdfCodeTextStyle.fontWeight,
          kind: "text",
          text: line,
          x: pdfPagePaddingX + codePaddingX,
          y: lineY + pdfCodeTextStyle.fontSize,
        });
        lineY += pdfCodeTextStyle.lineHeight;
      }
      this.y += blockHeight;
      if (remainingLines.length > 0) this.startNewPage();
    }
    this.addGap(12);
  }

  addImage(image: PdfImageLayout) {
    const maxHeight = Math.min(pdfMaxImageHeight, pdfContentBottom - pdfPagePaddingY);
    const scale = Math.min(1, pdfContentWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    this.addGap(16);
    this.ensureSpace(height);
    this.currentPage.elements.push({
      alt: image.alt,
      height,
      kind: "image",
      src: image.dataUrl,
      width,
      x: pdfPagePaddingX + (pdfContentWidth - width) / 2,
      y: this.y,
    });
    this.y += height;
    this.addGap(16);
  }

  addImageFallback(label: string) {
    const height = 42;
    this.addGap(14);
    this.ensureSpace(height);
    this.addRect({
      fill: "#f6f8fa",
      height,
      rx: 6,
      stroke: "#aeb6c2",
      strokeDasharray: "6 4",
      width: pdfContentWidth,
      x: pdfPagePaddingX,
      y: this.y,
    });
    this.currentPage.elements.push({
      fill: pdfImageFallbackStyle.fill,
      fontFamily: pdfImageFallbackStyle.fontFamily,
      fontSize: pdfImageFallbackStyle.fontSize,
      fontWeight: pdfImageFallbackStyle.fontWeight,
      kind: "text",
      text: label || "Image unavailable",
      x: pdfPagePaddingX + 12,
      y: this.y + 26,
    });
    this.y += height;
    this.addGap(12);
  }

  addRule(gapBefore = 20, gapAfter = 20) {
    this.addGap(gapBefore);
    this.ensureSpace(1);
    this.addLine({
      stroke: "#d8dee4",
      strokeWidth: 1,
      x1: pdfPagePaddingX,
      x2: pdfPagePaddingX + pdfContentWidth,
      y1: this.y,
      y2: this.y,
    });
    this.addGap(gapAfter);
  }
}

async function addPdfInlineParts(
  layout: PdfSvgLayout,
  markdownPath: string | null,
  parts: PdfInlinePart[],
  style: PdfTextStyle,
  options: { indent?: number; marginBottom?: number; marginTop?: number } = {},
) {
  const indent = options.indent ?? 0;
  let hasAddedContent = false;

  for (const part of parts) {
    if (part.kind === "text") {
      layout.addWrappedText(part.text, pdfPagePaddingX + indent, pdfContentWidth - indent, style, {
        marginTop: hasAddedContent ? 4 : options.marginTop,
      });
      hasAddedContent = true;
    } else {
      try {
        const image = await resolvePdfImageLayout(markdownPath, part.src, part.alt);
        if (image) {
          layout.addImage(image);
        } else {
          layout.addImageFallback(part.alt || part.src);
        }
      } catch {
        layout.addImageFallback(part.alt || part.src);
      }
      hasAddedContent = true;
    }
  }

  if (hasAddedContent) {
    layout.addGap(options.marginBottom ?? 0);
  }
}

async function layoutMarkdownDocumentForPdf(exportDocument: PdfExportDocument) {
  const blocks = parseMarkdownPreviewBlocks(exportDocument.body);
  const layout = new PdfSvgLayout(createPdfTextMeasureContext());
  const markdownPath = exportDocument.filePath;

  if (blocks.length === 0) {
    layout.addWrappedText("Empty document", pdfPagePaddingX, pdfContentWidth, {
      ...pdfBodyTextStyle,
      fill: "#6b7280",
    });
    return layout.getPages();
  }

  for (const block of blocks) {
    if (block.kind === "heading") {
      const style = pdfHeadingTextStyle(block.level);
      layout.addWrappedText(
        markdownInlineToPlainText(block.text),
        pdfPagePaddingX,
        pdfContentWidth,
        style,
        {
          marginBottom: block.level === 2 ? 6 : 8,
          marginTop: block.level <= 2 ? 24 : 18,
        },
      );
      if (block.level === 2) {
        layout.addRule(0, 18);
      }
    } else if (block.kind === "paragraph") {
      await addPdfInlineParts(
        layout,
        markdownPath,
        parsePdfInlineParts(block.text),
        pdfBodyTextStyle,
        {
          marginBottom: 10,
          marginTop: 4,
        },
      );
    } else if (block.kind === "quote") {
      layout.addGap(14);
      const quoteStartY = layout.getCursorY();
      await addPdfInlineParts(
        layout,
        markdownPath,
        parsePdfInlineParts(block.text),
        pdfQuoteTextStyle,
        {
          indent: 16,
          marginBottom: 10,
        },
      );
      const quoteEndY = layout.getCursorY();
      if (quoteEndY > quoteStartY) {
        layout.addLine({
          stroke: "#8a2438",
          strokeWidth: 4,
          x1: pdfPagePaddingX,
          x2: pdfPagePaddingX,
          y1: quoteStartY,
          y2: quoteEndY - 10,
        });
      }
    } else if (block.kind === "unordered-list" || block.kind === "ordered-list") {
      layout.addGap(8);
      for (const [index, item] of block.items.entries()) {
        const plainText = markdownInlineToPlainText(item);
        const marker = block.kind === "ordered-list" ? `${index + 1}.` : "•";
        layout.addListItem(marker, plainText, pdfBodyTextStyle);
      }
      layout.addGap(10);
    } else if (block.kind === "code") {
      layout.addCodeBlock(block.text);
    } else if (block.kind === "rule") {
      layout.addRule();
    }
  }

  return layout.getPages();
}

function drawPdfRect(context: CanvasRenderingContext2D, element: PdfSvgRectElement) {
  context.save();
  context.fillStyle = element.fill;
  context.fillRect(element.x, element.y, element.width, element.height);

  if (element.stroke) {
    context.strokeStyle = element.stroke;
    context.lineWidth = 1;
    if (element.strokeDasharray) {
      context.setLineDash(
        element.strokeDasharray
          .split(/\s+/)
          .map(Number)
          .filter((value) => Number.isFinite(value) && value > 0),
      );
    }
    context.strokeRect(element.x, element.y, element.width, element.height);
  }

  context.restore();
}

async function drawPdfPageElement(
  context: CanvasRenderingContext2D,
  element: PdfSvgElement,
) {
  if (element.kind === "text") {
    context.save();
    context.fillStyle = element.fill;
    context.font = `${element.fontWeight} ${element.fontSize}px ${element.fontFamily}`;
    context.textBaseline = "alphabetic";
    context.fillText(element.text, element.x, element.y);
    context.restore();
    return;
  }

  if (element.kind === "rect") {
    drawPdfRect(context, element);
    return;
  }

  if (element.kind === "line") {
    context.save();
    context.strokeStyle = element.stroke;
    context.lineWidth = element.strokeWidth;
    context.beginPath();
    context.moveTo(element.x1, element.y1);
    context.lineTo(element.x2, element.y2);
    context.stroke();
    context.restore();
    return;
  }

  const image = await loadPdfImage(element.src);
  context.drawImage(image, element.x, element.y, element.width, element.height);
}

async function renderPdfPageToJpeg(page: PdfSvgPage) {
  const canvas = document.createElement("canvas");
  const width = pdfCssPageWidth * pdfRenderScale;
  const height = pdfCssPageHeight * pdfRenderScale;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("failed to create PDF render canvas");

  context.scale(pdfRenderScale, pdfRenderScale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pdfCssPageWidth, pdfCssPageHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (const element of page.elements) {
    await drawPdfPageElement(context, element);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    bytes: base64ToUint8Array(dataUrl.split(",", 2)[1] ?? ""),
    width,
    height,
  };
}

async function renderMarkdownDocumentToPdfBase64(exportDocument: PdfExportDocument) {
  const pages = await layoutMarkdownDocumentForPdf(exportDocument);
  const jpegPages: PdfJpegPage[] = [];

  for (const page of pages) {
    jpegPages.push(await renderPdfPageToJpeg(page));
  }

  return uint8ArrayToBase64(buildPdfFromJpegPages(jpegPages));
}

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function asciiBytes(text: string) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return merged;
}

function pdfObject(id: number, body: string) {
  return asciiBytes(`${id} 0 obj\n${body}\nendobj\n`);
}

function pdfStreamObject(id: number, dictionary: string, stream: Uint8Array) {
  return concatBytes([
    asciiBytes(`${id} 0 obj\n<< ${dictionary} /Length ${stream.length} >>\nstream\n`),
    stream,
    asciiBytes("\nendstream\nendobj\n"),
  ]);
}

function buildPdfFromJpegPages(pages: PdfJpegPage[]) {
  const objects: { id: number; bytes: Uint8Array }[] = [];
  const pageIds = pages.map((_, pageIndex) => 3 + pageIndex * 3);

  objects.push({
    id: 1,
    bytes: pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
  });
  objects.push({
    id: 2,
    bytes: pdfObject(
      2,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${
        pages.length
      } >>`,
    ),
  });

  pages.forEach((page, pageIndex) => {
    const pageObjectId = 3 + pageIndex * 3;
    const contentObjectId = pageObjectId + 1;
    const imageObjectId = pageObjectId + 2;
    const imageName = `Im${pageIndex + 1}`;
    const contentStream = asciiBytes(
      `q\n${pdfPageWidthPoints} 0 0 ${pdfPageHeightPoints} 0 0 cm\n/${imageName} Do\nQ\n`,
    );

    objects.push({
      id: pageObjectId,
      bytes: pdfObject(
        pageObjectId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidthPoints} ${pdfPageHeightPoints}] /Resources << /XObject << /${imageName} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ),
    });
    objects.push({
      id: contentObjectId,
      bytes: pdfStreamObject(contentObjectId, "", contentStream),
    });
    objects.push({
      id: imageObjectId,
      bytes: pdfStreamObject(
        imageObjectId,
        `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        page.bytes,
      ),
    });
  });

  objects.sort((left, right) => left.id - right.id);

  const header = asciiBytes("%PDF-1.4\n");
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let offset = header.length;

  for (const object of objects) {
    offsets[object.id] = offset;
    parts.push(object.bytes);
    offset += object.bytes.length;
  }

  const xrefOffset = offset;
  const objectCount = objects.length + 1;
  const xrefLines = [
    "xref",
    `0 ${objectCount}`,
    "0000000000 65535 f ",
    ...objects.map((object) => `${String(offsets[object.id]).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objectCount} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ];
  parts.push(asciiBytes(xrefLines.join("\n")));

  return concatBytes(parts);
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

function getLineIndexAtSourcePosition(markdown: string, position: number) {
  const lineStartOffsets = getLineStartOffsets(markdown);
  const clampedPosition = clampNumber(position, 0, markdown.length);

  for (let index = lineStartOffsets.length - 1; index >= 0; index -= 1) {
    if (clampedPosition >= lineStartOffsets[index]) return index;
  }

  return 0;
}

function outdentMarkdownLine(line: string) {
  if (line.startsWith("  ")) return line.slice(2);
  if (line.startsWith(" ") || line.startsWith("\t")) return line.slice(1);

  return line;
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

function appendPreviewTextMap(target: PreviewTextMap, source: PreviewTextMap) {
  target.text += source.text;
  target.sourceOffsets.push(...source.sourceOffsets);
}

function appendInlineTextMap(target: PreviewTextMap, text: string, sourceStart: number | null) {
  let lastIndex = 0;

  for (const match of text.matchAll(inlineBreakPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      appendTextMap(
        target,
        text.slice(lastIndex, index),
        sourceStart === null ? null : sourceStart + lastIndex,
      );
    }

    appendTextMap(target, "\n", sourceStart === null ? null : sourceStart + index);
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    appendTextMap(
      target,
      text.slice(lastIndex),
      sourceStart === null ? null : sourceStart + lastIndex,
    );
  }
}

function previewTextMapFromInlineText(text: string, sourceStart: number | null): PreviewTextMap {
  const textMap: PreviewTextMap = { text: "", sourceOffsets: [] };
  appendInlineTextMap(textMap, text, sourceStart);
  return textMap;
}

function getHeadingTextMap(markdown: string, block: Extract<MarkdownPreviewBlock, { kind: "heading" }>) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const lineStartOffsets = getLineStartOffsets(markdown);
  const line = lines[block.startLine] ?? "";
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  const markerLength = match ? match[1].length + (line[match[1].length] === " " ? 1 : 0) : 0;
  const sourceStart = (lineStartOffsets[block.startLine] ?? 0) + markerLength;

  return previewTextMapFromInlineText(block.text, sourceStart);
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
      appendTextMap(textMap, "\n", (lineStartOffsets[lineIndex] ?? 0) - 1);
    }

    appendInlineTextMap(
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

  return previewTextMapFromInlineText(
    text,
    (lineStartOffsets[lineIndex] ?? 0) + marker.length,
  );
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
  const listLine = parseMarkdownListLine(line);
  const markerLength = listLine?.markerLength ?? 0;
  const text = line.slice(markerLength);

  return previewTextMapFromInlineText(
    text,
    (lineStartOffsets[lineIndex] ?? 0) + markerLength,
  );
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
        appendPreviewTextMap(textMap, quoteLineTextMap);
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
        appendPreviewTextMap(textMap, itemTextMap);
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

  if (intersectedBlocks.length === 0) return false;

  return intersectedBlocks.every(({ block, semanticRange }) => {
    if (!semanticRange) return false;

    if (selection.from <= semanticRange.from && selection.to >= semanticRange.to) {
      return true;
    }

    if (blockIsList(block)) {
      const intersectedItemRanges = getListItemSemanticRanges(markdown, block).filter(
        (itemRange) => selection.to > itemRange.from && selection.from < itemRange.to,
      );

      if (intersectedItemRanges.length === 0) return false;

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

function recoverRenderableAnchor(body: string, anchor: TextSelectionAnchor): TextSelectionAnchor {
  if (hasRenderableAnchor(anchor)) {
    return refreshAnchor(body, anchor);
  }

  return makePreviewAnchor(body, anchor.selectedText) ?? refreshAnchor(body, anchor);
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

function MermaidDiagram({
  definition,
  emptyDefinitionLabel,
  loadingLabel,
}: {
  definition: string;
  emptyDefinitionLabel: string;
  loadingLabel: string;
}) {
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
        error: emptyDefinitionLabel,
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
  }, [definition, diagramId, emptyDefinitionLabel]);

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
        <div className="mermaid-diagram__loading">{loadingLabel}</div>
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
      canExtendRight: rect.right >= lineRight - previewAnnotationLineEndTolerance,
      lineRight,
    };
  }

  function annotationRectBounds(annotation: HTMLElement, rect: DOMRect): PreviewAnnotationRect {
    const lineMetrics = annotationLineMetrics(annotation, rect);

    return {
      bottom: rect.bottom,
      canExtendRight: lineMetrics.canExtendRight,
      left: rect.left,
      lineRight: lineMetrics.lineRight,
      right: rect.right,
      top: rect.top,
    };
  }

  function annotationListAdjustedRect(
    annotation: HTMLElement,
    rect: DOMRect,
    kind: AnnotationKind,
  ) {
    const baseRect = annotationRectBounds(annotation, rect);
    if (kind === "glossary") {
      return baseRect;
    }

    const listItem = annotation.closest<HTMLLIElement>("li");
    const list = listItem?.closest<HTMLOListElement | HTMLUListElement>("ol, ul") ?? null;
    if (!listItem || !list || !container.contains(list)) {
      return baseRect;
    }

    const listRect = list.getBoundingClientRect();
    const listItemRect = listItem.getBoundingClientRect();
    const left = Math.max(
      containerRect.left,
      Math.min(listRect.left, listItemRect.left, rect.left),
    );

    return {
      ...baseRect,
      left,
    };
  }

  function frameFromBounds(
    noteId: string,
    frameKey: string,
    isFocusTarget: boolean,
    kind: AnnotationKind,
    tone: AnnotationTone,
    borderRadius: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): PreviewAnnotationFrame {
    return {
      borderRadius,
      frameKey,
      isFocusTarget,
      kind,
      noteId,
      tone,
      left: roundPreviewFrameValue(
        left - containerRect.left + container.scrollLeft,
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

      const annotationRects = Array.from(annotation.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => annotationListAdjustedRect(annotation, rect, kind));
      if (annotationRects.length === 0) return;

      const sortedRects = annotationRects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );
      const extensionRightByRect = new Map<PreviewAnnotationRect, number>();
      const borderRadiusByRect = new Map<PreviewAnnotationRect, string>();
      let rectGroup: PreviewAnnotationRect[] = [];

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
              isFirstRect ? previewAnnotationFrameCornerRadius : "0",
              isFirstRect ? previewAnnotationFrameCornerRadius : "0",
              isLastRect ? previewAnnotationFrameCornerRadius : "0",
              isLastRect ? previewAnnotationFrameCornerRadius : "0",
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
            (lineGap < 0 || lineGap > previewAnnotationLineJoinMaxGap)
          ) {
            flushRectGroup();
          }

          rectGroup.push(rect);
        });
        flushRectGroup();
      }

      sortedRects.forEach((rect, rectIndex) => {
        const framePadding = previewAnnotationFramePaddingForKind(kind);
        const frameHorizontalPadding = previewAnnotationFrameHorizontalPaddingForKind(kind);
        const shouldJoinFrameLines = kind !== "glossary";
        let top = rect.top - framePadding;
        let bottom = rect.bottom + framePadding;
        const previousRect = sortedRects[rectIndex - 1];
        const nextRect = sortedRects[rectIndex + 1];

        if (shouldJoinFrameLines && previousRect) {
          const previousGap = rect.top - previousRect.bottom;
          if (previousGap >= 0 && previousGap <= previewAnnotationLineJoinMaxGap) {
            top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
          }
        }

        if (shouldJoinFrameLines && nextRect) {
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
            borderRadiusByRect.get(rect) ?? previewAnnotationFrameCornerRadius,
            rect.left - frameHorizontalPadding,
            top,
            (extensionRightByRect.get(rect) ?? rect.right) + frameHorizontalPadding,
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
      leftFrame.borderRadius === rightFrame.borderRadius &&
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

type ParsedMarkdownListLine = {
  indent: number;
  kind: MarkdownPreviewListKind;
  markerLength: number;
  text: string;
};

function normalizedMarkdownIndent(rawIndent: string) {
  return rawIndent.replace(/\t/g, "    ").length;
}

function parseMarkdownListLine(line: string): ParsedMarkdownListLine | null {
  const unorderedMatch = line.match(markdownUnorderedListLinePattern);
  if (unorderedMatch) {
    return {
      indent: normalizedMarkdownIndent(unorderedMatch[1]),
      kind: "unordered-list",
      markerLength: unorderedMatch[0].length - unorderedMatch[2].length,
      text: unorderedMatch[2],
    };
  }

  const orderedMatch = line.match(markdownOrderedListLinePattern);
  if (orderedMatch) {
    return {
      indent: normalizedMarkdownIndent(orderedMatch[1]),
      kind: "ordered-list",
      markerLength: orderedMatch[0].length - orderedMatch[2].length,
      text: orderedMatch[2],
    };
  }

  return null;
}

function isMarkdownListLine(line: string) {
  return parseMarkdownListLine(line) !== null;
}

function buildMarkdownPreviewList(rawLines: string[], blockKey: string): MarkdownPreviewList {
  const parsedLines = rawLines
    .map((line, flatIndex) => {
      const parsedLine = parseMarkdownListLine(line);
      return parsedLine ? { ...parsedLine, flatIndex } : null;
    })
    .filter((line): line is ParsedMarkdownListLine & { flatIndex: number } => Boolean(line));
  const rootList: MarkdownPreviewList = {
    kind: parsedLines[0]?.kind ?? "unordered-list",
    items: [],
  };
  const rootIndent = parsedLines[0]?.indent ?? 0;
  const stack: Array<{
    indent: number;
    lastItem: MarkdownPreviewListItem | null;
    list: MarkdownPreviewList;
  }> = [{ indent: rootIndent, lastItem: null, list: rootList }];

  parsedLines.forEach((line) => {
    while (stack.length > 1 && line.indent < stack[stack.length - 1].indent) {
      stack.pop();
    }

    let current = stack[stack.length - 1];
    if (line.indent > current.indent && current.lastItem) {
      const childList: MarkdownPreviewList = { kind: line.kind, items: [] };
      current.lastItem.children.push(childList);
      current = { indent: line.indent, lastItem: null, list: childList };
      stack.push(current);
    } else if (line.indent === current.indent && line.kind !== current.list.kind) {
      const parent = stack.length > 1 ? stack[stack.length - 2] : null;
      if (parent?.lastItem) {
        const siblingList: MarkdownPreviewList = { kind: line.kind, items: [] };
        parent.lastItem.children.push(siblingList);
        current = { indent: line.indent, lastItem: null, list: siblingList };
        stack[stack.length - 1] = current;
      }
    }

    const item: MarkdownPreviewListItem = {
      children: [],
      flatIndex: line.flatIndex,
      key: `${blockKey}-item-${line.flatIndex}`,
      text: line.text,
    };
    current.list.items.push(item);
    current.lastItem = item;
    stack[stack.length - 1] = current;
  });

  return rootList;
}

function isMarkdownBlockStart(line: string) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isMarkdownListLine(line) ||
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

    const listLine = parseMarkdownListLine(line);
    if (listLine) {
      const rawLines: string[] = [];
      const startLine = index;

      while (index < lines.length && isMarkdownListLine(lines[index])) {
        rawLines.push(lines[index]);
        index += 1;
      }

      const list = buildMarkdownPreviewList(rawLines, key);

      blocks.push({
        kind: listLine.kind,
        key,
        startLine,
        endLine: index - 1,
        items: rawLines
          .map((rawLine) => parseMarkdownListLine(rawLine)?.text ?? "")
          .filter((_item, itemIndex) => itemIndex < rawLines.length),
        list,
        rawLines,
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
      text: paragraphLines.join("\n"),
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

type TypedPreviewMarkdownBlock = {
  kind: "block" | "unordered-list" | "ordered-list";
  items?: string[];
  markdown: string;
};

function simpleTypedListBlockFromLines(
  lines: string[],
  kind: MarkdownPreviewListKind,
): TypedPreviewMarkdownBlock | null {
  const parsedLines = lines.map((line) => parseMarkdownListLine(line));
  if (!parsedLines.every((line): line is ParsedMarkdownListLine => Boolean(line))) return null;
  if (!parsedLines.every((line) => line.kind === kind)) return null;
  if (parsedLines.some((line) => line.indent > 0)) {
    return { kind: "block", markdown: lines.join("\n") };
  }

  const items = parsedLines.map((line) => line.text.trim());
  if (!items.some((item) => item.length > 0)) return null;

  if (kind === "unordered-list") {
    return {
      kind,
      items,
      markdown: items.map((item) => `- ${item}`).join("\n"),
    };
  }

  return {
    kind,
    items,
    markdown: items.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  };
}

function typedMarkdownBlockFromLines(lines: string[]): TypedPreviewMarkdownBlock | null {
  const normalizedLines = lines
    .map((line) => line.replace(/\u200b/g, ""))
    .map((line) => line.replace(/\u00a0/g, " "))
    .map((line) => line.replace(/\r$/, "").trimEnd());
  const contentLines = normalizedLines.filter((line) => line.trim());
  if (contentLines.length === 0) return null;

  const unorderedBlock = simpleTypedListBlockFromLines(contentLines, "unordered-list");
  if (unorderedBlock) return unorderedBlock;

  const orderedBlock = simpleTypedListBlockFromLines(contentLines, "ordered-list");
  if (orderedBlock) return orderedBlock;

  if (contentLines.length === 1) {
    const singleLine = contentLines[0].trim();
    if (/^#{1,6}\s+\S/.test(singleLine)) {
      return { kind: "block", markdown: singleLine };
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(singleLine)) {
      return { kind: "block", markdown: singleLine };
    }
  }

  if (contentLines.every((line) => /^>\s?/.test(line))) {
    return { kind: "block", markdown: contentLines.join("\n") };
  }

  if (
    contentLines.length >= 2 &&
    contentLines[0].trim().startsWith("```") &&
    contentLines[contentLines.length - 1].trim().startsWith("```")
  ) {
    return { kind: "block", markdown: contentLines.join("\n") };
  }

  if (
    contentLines.length > 1 &&
    contentLines.every((line) => {
      const trimmedLine = line.trim();

      return /^#{1,6}\s+\S/.test(trimmedLine) || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine);
    })
  ) {
    return { kind: "block", markdown: contentLines.join("\n") };
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

  if (block.kind === "ordered-list") {
    return `${block.markdown}\n${(block.items?.length ?? 0) + 1}. `;
  }

  return `${block.markdown}\n`;
}

function directPreviewListItemText(item: HTMLLIElement) {
  const text = Array.from(item.childNodes)
    .filter(
      (node) =>
        !(
          node instanceof HTMLElement &&
          (node.tagName.toLowerCase() === "ul" || node.tagName.toLowerCase() === "ol")
        ),
    )
    .map((node) => (node instanceof HTMLElement ? node.innerText : node.textContent ?? ""))
    .join("");

  return text.replace(/\u200b/g, "").replace(/\u00a0/g, " ").replace(/\r/g, "").trimEnd();
}

function normalizedPreviewListText(text: string) {
  return text.replace(/\u200b/g, "").replace(/\u00a0/g, " ").replace(/\r/g, "");
}

function directPreviewListNodeText(node: Node): string {
  if (
    node instanceof HTMLElement &&
    (node.tagName.toLowerCase() === "ul" || node.tagName.toLowerCase() === "ol")
  ) {
    return "";
  }

  return normalizedPreviewListText(
    node instanceof HTMLElement ? node.innerText : node.textContent ?? "",
  );
}

function directPreviewListNodeSelectionOffset(
  node: Node,
  targetNode: Node,
  targetOffset: number,
): { found: true; offset: number } | { found: false } {
  if (
    node instanceof HTMLElement &&
    (node.tagName.toLowerCase() === "ul" || node.tagName.toLowerCase() === "ol")
  ) {
    return { found: false };
  }

  if (node === targetNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      return {
        found: true,
        offset: normalizedPreviewListText((node.textContent ?? "").slice(0, targetOffset)).length,
      };
    }

    let offset = 0;
    Array.from(node.childNodes)
      .slice(0, targetOffset)
      .forEach((child) => {
        offset += directPreviewListNodeText(child).length;
      });

    return { found: true, offset };
  }

  if (!node.contains(targetNode)) return { found: false };

  let offset = 0;
  for (const child of Array.from(node.childNodes)) {
    const childOffset = directPreviewListNodeSelectionOffset(child, targetNode, targetOffset);
    if (childOffset.found) return { found: true, offset: offset + childOffset.offset };

    offset += directPreviewListNodeText(child).length;
  }

  return { found: false };
}

function directPreviewListItemSelectionOffset(item: HTMLLIElement, selection: Selection) {
  if (!selection.isCollapsed || !selection.focusNode || !item.contains(selection.focusNode)) {
    return null;
  }

  const focusElement =
    selection.focusNode instanceof Element
      ? selection.focusNode
      : selection.focusNode.parentElement;
  const focusedItem = focusElement?.closest<HTMLLIElement>("li") ?? null;
  if (focusedItem !== item) return null;

  let offset = 0;
  for (const child of Array.from(item.childNodes)) {
    const childOffset = directPreviewListNodeSelectionOffset(
      child,
      selection.focusNode,
      selection.focusOffset,
    );
    if (childOffset.found) return offset + childOffset.offset;

    offset += directPreviewListNodeText(child).length;
  }

  return directPreviewListItemText(item).length;
}

function markdownLinesFromPreviewListElement(
  listElement: HTMLUListElement | HTMLOListElement,
  options: { insertEmptyAfter?: HTMLLIElement } = {},
  indent = 0,
) {
  const lines: string[] = [];
  const ordered = listElement.tagName.toLowerCase() === "ol";
  const indentText = " ".repeat(indent);
  let itemNumber = 1;

  Array.from(listElement.children).forEach((child) => {
    if (!(child instanceof HTMLLIElement)) return;

    const marker = ordered ? `${itemNumber}. ` : "- ";
    lines.push(`${indentText}${marker}${directPreviewListItemText(child)}`);
    itemNumber += 1;

    Array.from(child.children).forEach((grandchild) => {
      if (grandchild instanceof HTMLUListElement || grandchild instanceof HTMLOListElement) {
        lines.push(
          ...markdownLinesFromPreviewListElement(grandchild, options, indent + 2),
        );
      }
    });

    if (options.insertEmptyAfter === child) {
      const emptyMarker = ordered ? `${itemNumber}. ` : "- ";
      lines.push(`${indentText}${emptyMarker}`);
      itemNumber += 1;
    }
  });

  return lines;
}

function markdownFromPreviewListElement(
  blockElement: HTMLElement,
  options: { insertEmptyAfter?: HTMLLIElement } = {},
) {
  const listElement = Array.from(blockElement.children).find(
    (child): child is HTMLUListElement | HTMLOListElement =>
      child instanceof HTMLUListElement || child instanceof HTMLOListElement,
  );

  return listElement ? markdownLinesFromPreviewListElement(listElement, options).join("\n") : null;
}

function listContinuationLine(line: string) {
  const parsedLine = parseMarkdownListLine(line);
  if (!parsedLine) return null;

  const unorderedMatch = line.match(/^(\s*)[-*+]\s+/);
  if (unorderedMatch) return `${unorderedMatch[1]}- `;

  const orderedMatch = line.match(/^(\s*)(\d+)([.)])\s+/);
  if (orderedMatch) {
    return `${orderedMatch[1]}${Number(orderedMatch[2]) + 1}${orderedMatch[3]} `;
  }

  return line.slice(0, parsedLine.markerLength);
}

function markdownFromEditedPreviewBlock(block: MarkdownPreviewBlock, element: HTMLElement) {
  if (block.kind === "unordered-list" || block.kind === "ordered-list") {
    return markdownFromPreviewListElement(element) ?? markdownFromPreviewBlock(block, element.innerText);
  }

  return markdownFromPreviewBlock(block, element.innerText);
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

  return recoverRenderableAnchor(nextBody, {
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

function renderEditablePreviewList(
  list: MarkdownPreviewList,
  block: Extract<MarkdownPreviewBlock, { kind: MarkdownPreviewListKind }>,
  markdown: string,
  annotations: TextRangeAnnotation[],
  keyPrefix: string,
  onAnnotationClick: (annotationId: string) => void,
  onAnnotationDoubleClick: (annotationId: string) => void,
): ReactNode {
  const ListTag = list.kind === "unordered-list" ? "ul" : "ol";

  return (
    <ListTag>
      {list.items.map((item) => {
        const itemTextMap = getListItemTextMap(markdown, block, item.flatIndex);

        return (
          <li data-preview-list-item-index={item.flatIndex} key={item.key}>
            {item.text
              ? renderPreviewInline(
                  itemTextMap,
                  `${keyPrefix}-item-${item.flatIndex}`,
                  annotations,
                  onAnnotationClick,
                  onAnnotationDoubleClick,
                )
              : <br />}
            {item.children.map((childList, childIndex) => (
              <Fragment key={`${item.key}-child-list-${childIndex}`}>
                {renderEditablePreviewList(
                  childList,
                  block,
                  markdown,
                  annotations,
                  `${keyPrefix}-item-${item.flatIndex}-child-${childIndex}`,
                  onAnnotationClick,
                  onAnnotationDoubleClick,
                )}
              </Fragment>
            ))}
          </li>
        );
      })}
    </ListTag>
  );
}

function renderPreviewContentList(
  list: MarkdownPreviewList,
  keyPrefix: string,
): ReactNode {
  const ListTag = list.kind === "unordered-list" ? "ul" : "ol";

  return (
    <ListTag>
      {list.items.map((item) => (
        <li data-preview-list-item-index={item.flatIndex} key={item.key}>
          {renderInlineMarkdown(item.text, `${keyPrefix}-item-${item.flatIndex}`)}
          {item.children.map((childList, childIndex) => (
            <Fragment key={`${item.key}-child-list-${childIndex}`}>
              {renderPreviewContentList(
                childList,
                `${keyPrefix}-item-${item.flatIndex}-child-${childIndex}`,
              )}
            </Fragment>
          ))}
        </li>
      ))}
    </ListTag>
  );
}

function MarkdownPreviewBlockView({
  block,
  markdown,
  annotations,
  mermaidEmptyDefinitionLabel,
  mermaidLoadingLabel,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  block: MarkdownPreviewBlock;
  markdown: string;
  annotations: TextRangeAnnotation[];
  mermaidEmptyDefinitionLabel: string;
  mermaidLoadingLabel: string;
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
    return (
      <div {...blockProps} className="markdown-preview-editable" key={block.key}>
        {renderEditablePreviewList(
          block.list,
          block,
          markdown,
          annotations,
          block.key,
          onAnnotationClick,
          onAnnotationDoubleClick,
        )}
      </div>
    );
  }

  if (block.kind === "code") {
    if (isMermaidLanguage(block.language)) {
      return (
        <MermaidDiagram
          definition={block.text}
          emptyDefinitionLabel={mermaidEmptyDefinitionLabel}
          key={block.key}
          loadingLabel={mermaidLoadingLabel}
        />
      );
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
  allowSelectedTextEnterEdit = false,
  commitOnInput = false,
  enableTabIndent = false,
  mermaidEmptyDefinitionLabel,
  mermaidLoadingLabel,
  readOnly,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
}: {
  value: string;
  annotations: TextRangeAnnotation[];
  allowSelectedTextEnterEdit?: boolean;
  commitOnInput?: boolean;
  enableTabIndent?: boolean;
  mermaidEmptyDefinitionLabel: string;
  mermaidLoadingLabel: string;
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
  const inputCommitFrameRef = useRef(0);
  const previewUndoStackRef = useRef<string[]>([]);
  const previewRedoStackRef = useRef<string[]>([]);
  const [annotationFrames, setAnnotationFrames] = useState<PreviewAnnotationFrame[]>([]);

  useEffect(
    () => () => {
      window.clearTimeout(annotationClickTimerRef.current);
      window.cancelAnimationFrame(inputCommitFrameRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (allowSelectedTextEnterEdit) return;

    const previewElement = previewRef.current;
    if (!previewElement) return;

    let animationFrame = 0;
    let annotationLayoutSettleTimers: number[] = [];
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
    const clearAnnotationLayoutSettleTimers = () => {
      annotationLayoutSettleTimers.forEach((timer) => window.clearTimeout(timer));
      annotationLayoutSettleTimers = [];
    };
    const scheduleSettledAnnotationFrameUpdate = () => {
      scheduleAnnotationFrameUpdate();
      clearAnnotationLayoutSettleTimers();
      annotationLayoutSettleTimers = annotationLayoutSettleDelaysMs.map((delay) =>
        window.setTimeout(scheduleAnnotationFrameUpdate, delay),
      );
    };

    scheduleSettledAnnotationFrameUpdate();

    const editorContentFrame = previewElement.closest<HTMLElement>(".editor-content-frame");
    const resizeObserver = new ResizeObserver(scheduleSettledAnnotationFrameUpdate);
    resizeObserver.observe(previewElement);
    if (editorContentFrame) {
      resizeObserver.observe(editorContentFrame);
      editorContentFrame.addEventListener("transitionend", scheduleSettledAnnotationFrameUpdate);
      editorContentFrame.addEventListener("transitioncancel", scheduleSettledAnnotationFrameUpdate);
    }
    window.addEventListener("resize", scheduleSettledAnnotationFrameUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
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

  function focusPreviewBlockEnd(blockKey: string) {
    window.requestAnimationFrame(() => {
      const previewElement = previewRef.current;
      const blockElement = Array.from(
        previewElement?.querySelectorAll<HTMLElement>("[data-preview-block-key]") ?? [],
      ).find((element) => element.dataset.previewBlockKey === blockKey);

      if (!blockElement) return;

      previewElement?.focus();
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

  function focusPreviewListItem(
    blockKey: string,
    itemIndex: number,
    placement: "start" | "end" = "end",
  ) {
    window.requestAnimationFrame(() => {
      const previewElement = previewRef.current;
      const blockElement = Array.from(
        previewElement?.querySelectorAll<HTMLElement>("[data-preview-block-key]") ?? [],
      ).find((element) => element.dataset.previewBlockKey === blockKey);

      const listItem = blockElement?.querySelectorAll<HTMLElement>("li")[itemIndex];
      if (!listItem) return;

      previewElement?.focus();

      const selection = window.getSelection();
      if (!selection) return;

      const range = document.createRange();
      range.selectNodeContents(listItem);
      range.collapse(placement === "start");
      selection.removeAllRanges();
      selection.addRange(range);
    });
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

  function looseRootPreviewText(previewElement: HTMLElement) {
    if (blocks.length > 0) return null;

    const looseNodes = Array.from(previewElement.childNodes).filter((node) => {
      if (!(node instanceof HTMLElement)) return true;
      if (node.classList.contains("preview-annotation-layer")) return false;
      if (node.dataset.previewBlockKey || node.dataset.previewTransient === "true") {
        return false;
      }

      return true;
    });
    if (looseNodes.length === 0) return null;

    return looseNodes
      .map(childNodeText)
      .join("\n")
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .trimEnd();
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

  function commitPreviewListIndent(blockElement: HTMLElement) {
    const block = blockForPreviewElement(blockElement);
    if (!block || !blockIsList(block)) return false;

    const listItem = listItemElementFromSelection(blockElement);
    const flatIndex = Number(listItem?.dataset.previewListItemIndex ?? Number.NaN);
    if (!listItem || !Number.isInteger(flatIndex) || flatIndex <= 0) return false;

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const lineIndex = block.startLine + flatIndex;
    const line = lines[lineIndex] ?? "";
    if (!parseMarkdownListLine(line)) return false;

    lines[lineIndex] = `  ${line}`;
    delete blockElement.dataset.edited;
    commitPreviewChange(lines.join("\n"));
    focusPreviewListItem(block.key, flatIndex);
    return true;
  }

  function commitPreviewListOutdent(blockElement: HTMLElement) {
    const block = blockForPreviewElement(blockElement);
    if (!block || !blockIsList(block)) return false;

    const listItem = listItemElementFromSelection(blockElement);
    const flatIndex = Number(listItem?.dataset.previewListItemIndex ?? Number.NaN);
    if (!listItem || !Number.isInteger(flatIndex)) return false;

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const lineIndex = block.startLine + flatIndex;
    const line = lines[lineIndex] ?? "";
    const listLine = parseMarkdownListLine(line);
    if (!listLine || listLine.indent <= 0) return false;

    lines[lineIndex] = outdentMarkdownLine(line);
    delete blockElement.dataset.edited;
    commitPreviewChange(lines.join("\n"));
    focusPreviewListItem(block.key, flatIndex);
    return true;
  }

  function sourceLineIndexFromPreviewSelection(
    block: MarkdownPreviewBlock,
    blockElement: HTMLElement,
  ) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed) return null;

    const offsets = selectionOffsetsInElement(blockElement, selection);
    if (!offsets) return null;

    const textMap = getPreviewBlockTextMap(value, block);
    const sourcePosition = sourcePositionForPreviewTextOffset(textMap, offsets.from);
    if (sourcePosition === null) return null;

    return getLineIndexAtSourcePosition(value, sourcePosition);
  }

  function commitPreviewLineOutdent(blockElement: HTMLElement) {
    const block = blockForPreviewElement(blockElement);
    if (!block || blockIsList(block)) return false;

    const lineIndex = sourceLineIndexFromPreviewSelection(block, blockElement);
    if (lineIndex === null) return false;

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const line = lines[lineIndex] ?? "";
    const nextLine = outdentMarkdownLine(line);
    if (nextLine === line) return false;

    lines[lineIndex] = nextLine;
    delete blockElement.dataset.edited;
    commitPreviewChange(lines.join("\n"));
    focusPreviewBlockEnd(block.key);
    return true;
  }

  function commitPreviewListItemRemoval(blockElement: HTMLElement, preferPrevious = true) {
    const block = blockForPreviewElement(blockElement);
    if (!block || !blockIsList(block)) return false;

    const listItem = listItemElementFromSelection(blockElement);
    const flatIndex = Number(listItem?.dataset.previewListItemIndex ?? Number.NaN);
    if (!listItem || !Number.isInteger(flatIndex)) return false;
    if (directPreviewListItemText(listItem).trim()) return false;

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const lineIndex = block.startLine + flatIndex;
    if (!parseMarkdownListLine(lines[lineIndex] ?? "")) return false;

    if (block.rawLines.length <= 1) {
      lines[lineIndex] = "";
    } else {
      lines.splice(lineIndex, 1);
    }

    delete blockElement.dataset.edited;
    commitPreviewChange(lines.join("\n"));

    const remainingItemCount = Math.max(0, block.rawLines.length - 1);
    if (remainingItemCount > 0) {
      const nextFocusIndex = preferPrevious
        ? Math.max(0, flatIndex - 1)
        : Math.min(flatIndex, remainingItemCount - 1);
      focusPreviewListItem(block.key, nextFocusIndex);
    }

    return true;
  }

  function handlePreviewListDelete(event: ReactKeyboardEvent<HTMLDivElement>) {
    const isListDeleteKey =
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isListDeleteKey) return false;

    const blockElement = previewBlockElementFromSelection();
    if (!blockElement) return false;
    if (!commitPreviewListItemRemoval(blockElement, event.key === "Backspace")) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePreviewTabIndent(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (!enableTabIndent) return false;

    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const blockElement = previewBlockElementFromSelection();
      if (!blockElement) return true;

      commitPreviewListOutdent(blockElement) || commitPreviewLineOutdent(blockElement);
      return true;
    }

    event.preventDefault();
    event.stopPropagation();

    const blockElement = previewBlockElementFromSelection();
    if (blockElement && commitPreviewListIndent(blockElement)) return true;

    return insertPlainPreviewText("  ");
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
    if (blockElement) {
      markPreviewBlockChanged(blockElement);
    }

    if (!commitOnInput) return;
    if ((event.nativeEvent as InputEvent).isComposing) return;

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = window.requestAnimationFrame(() => {
      inputCommitFrameRef.current = 0;
      commitPendingPreviewInput(event.currentTarget);
    });
  }

  function handlePreviewCompositionEnd(event: CompositionEvent<HTMLDivElement>) {
    if (readOnly || !commitOnInput) return;

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = window.requestAnimationFrame(() => {
      inputCommitFrameRef.current = 0;
      commitPendingPreviewInput(event.currentTarget);
    });
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
    const flatIndex = Number(listItem.dataset.previewListItemIndex ?? Number.NaN);
    if (!Number.isInteger(flatIndex)) return false;

    const currentItem = directPreviewListItemText(listItem);
    const caretOffset = directPreviewListItemSelectionOffset(listItem, selection);

    if (!currentItem.trim()) {
      return commitPreviewListItemRemoval(blockElement, true);
    }

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    const lineIndex = block.startLine + flatIndex;
    const currentLine = lines[lineIndex] ?? "";
    const listLine = parseMarkdownListLine(currentLine);
    const nextLine = listContinuationLine(currentLine);
    if (!listLine || nextLine === null) return false;

    const splitOffset = caretOffset === null
      ? currentItem.length
      : clampNumber(caretOffset, 0, currentItem.length);
    const previousItemText = currentItem.slice(0, splitOffset).trimEnd();
    const nextItemText = currentItem.slice(splitOffset).replace(/^\s+/, "");

    lines[lineIndex] = `${currentLine.slice(0, listLine.markerLength)}${previousItemText}`;
    lines.splice(lineIndex + 1, 0, `${nextLine}${nextItemText}`);
    delete blockElement.dataset.edited;
    commitPreviewChange(lines.join("\n"));
    focusPreviewListItem(block.key, itemIndex + 1, nextItemText ? "start" : "end");
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
    focusPreviewBlockEnd(block.key);
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
    const markdownBlock =
      typedMarkdownBlock?.markdown ??
      lines
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
    if (!markdownBlock) return false;

    const { nextValue, insertedBlockKey } = insertMarkdownAfterBlock(
      transientEdit.previousBlock,
      options.continueList
        ? typedMarkdownBlock
          ? appendBlankListItemToTypedMarkdownBlock(typedMarkdownBlock)
          : `${markdownBlock}\n`
        : markdownBlock,
    );

    if (nextValue === value) return false;

    clearTransientPreviewNodes(transientEdit.transientNodes);
    commitPreviewChange(nextValue);
    focusPreviewBlockEnd(insertedBlockKey);
    return true;
  }

  function commitLooseRootPreviewText(previewElement: HTMLElement) {
    const text = looseRootPreviewText(previewElement);
    if (text === null) return false;

    const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
    const typedMarkdownBlock = typedMarkdownBlockFromLines(lines);
    const nextValue =
      typedMarkdownBlock?.markdown ??
      lines
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
    if (nextValue === value) return false;

    commitPreviewChange(nextValue);
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
        markdownFromEditedPreviewBlock(block, element),
      );
      delete element.dataset.edited;
    });

    if (nextValue === value) return false;

    commitPreviewChange(nextValue);
    return true;
  }

  function commitPendingPreviewInput(previewElement: HTMLElement) {
    const committedRoot = commitRootTypedPreviewBlock(previewElement);
    const committedEditedBlocks = commitEditedPreviewBlocks();
    if (!committedRoot && !committedEditedBlocks) {
      return commitLooseRootPreviewText(previewElement);
    }

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

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    commitPendingPreviewInput(event.currentTarget);
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
      if (
        allowSelectedTextEnterEdit &&
        event.key === "Tab" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        return;
      }

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

    if (handlePreviewTabIndent(event)) return;
    if (handlePreviewListDelete(event)) return;
    if (handlePreviewInlineShortcut(event)) return;
    if (handlePreviewMarkdownShortcutSpace(event)) return;

    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter) return;
    if (keyboardEventIsComposing(event)) return;

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
      contentEditable={!readOnly}
      aria-readonly={readOnly || undefined}
      ref={previewRef}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      suppressContentEditableWarning
      tabIndex={0}
      onBlur={handlePreviewBlur}
      onBeforeInput={handlePreviewBeforeInput}
      onCompositionEnd={handlePreviewCompositionEnd}
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
            mermaidEmptyDefinitionLabel={mermaidEmptyDefinitionLabel}
            mermaidLoadingLabel={mermaidLoadingLabel}
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
              borderRadius: frame.borderRadius,
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
  mermaidEmptyDefinitionLabel,
  mermaidLoadingLabel,
}: {
  block: MarkdownPreviewBlock;
  keyPrefix: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidLoadingLabel: string;
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
    return <Fragment key={block.key}>{renderPreviewContentList(block.list, keyPrefix)}</Fragment>;
  }

  if (block.kind === "code") {
    if (isMermaidLanguage(block.language)) {
      return (
        <MermaidDiagram
          definition={block.text}
          emptyDefinitionLabel={mermaidEmptyDefinitionLabel}
          key={block.key}
          loadingLabel={mermaidLoadingLabel}
        />
      );
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
  mermaidEmptyDefinitionLabel,
  mermaidLoadingLabel,
  onDoubleClick,
  value,
}: {
  className: string;
  emptyLabel: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidLoadingLabel: string;
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
              mermaidEmptyDefinitionLabel={mermaidEmptyDefinitionLabel}
              mermaidLoadingLabel={mermaidLoadingLabel}
            />
          ))}
    </div>
  );
}

function keyboardEventIsComposing(event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) {
  const nativeEvent =
    "nativeEvent" in event
      ? (event.nativeEvent as KeyboardEvent & { isComposing?: boolean })
      : event;

  return Boolean(nativeEvent.isComposing || nativeEvent.keyCode === 229);
}

function ensureEmptyEditablePreviewLine(editableElement: HTMLElement) {
  if (!editableElement.classList.contains("markdown-preview")) return null;

  const existingInputTarget =
    editableElement.querySelector<HTMLElement>("[data-preview-transient='true']") ??
    editableElement.querySelector<HTMLElement>("[data-preview-block-key]");
  if (existingInputTarget) return existingInputTarget;

  const lineElement = document.createElement("div");
  lineElement.className = "markdown-preview-editable";
  lineElement.dataset.previewTransient = "true";
  lineElement.dataset.previewPreviousBlockKey = "";
  lineElement.append(document.createElement("br"));

  const annotationLayer = editableElement.querySelector<HTMLElement>(
    ".preview-annotation-layer",
  );
  editableElement.insertBefore(lineElement, annotationLayer);

  return lineElement;
}

function textareaValueWithListContinuation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  if (selectionStart !== selectionEnd) return null;

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = value.indexOf("\n", selectionStart);
  const lineEnd = lineEndIndex >= 0 ? lineEndIndex : value.length;
  const line = value.slice(lineStart, lineEnd);
  const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
  const orderedMatch = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);

  if (unorderedMatch) {
    const [, indent, marker, itemText] = unorderedMatch;
    if (!itemText.trim()) {
      const nextValue = `${value.slice(0, lineStart)}${value.slice(lineEnd)}`;
      return { value: nextValue, selectionStart: lineStart };
    }

    const insertedText = `\n${indent}${marker} `;
    return {
      value: `${value.slice(0, selectionStart)}${insertedText}${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + insertedText.length,
    };
  }

  if (orderedMatch) {
    const [, indent, numberText, marker, itemText] = orderedMatch;
    if (!itemText.trim()) {
      const nextValue = `${value.slice(0, lineStart)}${value.slice(lineEnd)}`;
      return { value: nextValue, selectionStart: lineStart };
    }

    const nextNumber = Number(numberText) + 1;
    const insertedText = `\n${indent}${nextNumber}${marker} `;
    return {
      value: `${value.slice(0, selectionStart)}${insertedText}${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + insertedText.length,
    };
  }

  return null;
}

function resizeNoteTextareaToContent(textarea: HTMLTextAreaElement) {
  const computedStyle = window.getComputedStyle(textarea);
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : (Number.isFinite(parsedFontSize) ? parsedFontSize : 16) * 1.5;
  const maximumHeight = lineHeight * 10;

  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(contentHeight, maximumHeight);

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > maximumHeight + 1 ? "auto" : "hidden";
}

function NoteMarkdownEditor({
  ariaLabel,
  className = "",
  editing = true,
  editorRootRef,
  onChange,
  onClick,
  onCompositionEnd,
  onCompositionStart,
  onEditingBlur,
  onKeyDown,
  onRequestEdit,
  readOnly = false,
  value,
}: {
  ariaLabel: string;
  className?: string;
  editing?: boolean;
  editorRootRef?: (element: HTMLDivElement | null) => void;
  onChange: (value: string) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onCompositionEnd?: () => void;
  onCompositionStart?: () => void;
  onEditingBlur?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onRequestEdit?: () => void;
  readOnly?: boolean;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingEditPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const isEditable = editing && !readOnly;
  const editorClassName = [
    "note-markdown-editor",
    "note-markdown-editor--preview",
    isEditable ? "is-editing" : "is-previewing",
    readOnly ? "is-readonly" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  useLayoutEffect(() => {
    if (!isEditable) return;

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      resizeNoteTextareaToContent(textarea);
      textarea.focus({ preventScroll: true });
      const selectionOffset = textarea.value.length;
      textarea.setSelectionRange(selectionOffset, selectionOffset);
      pendingEditPointerRef.current = null;
    });
  }, [isEditable]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!isEditable || !textarea) return;

    resizeNoteTextareaToContent(textarea);
  }, [isEditable, value]);

  function setRootElement(element: HTMLDivElement | null) {
    rootRef.current = element;
    editorRootRef?.(element);
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isEditable || readOnly) return;

    pendingEditPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    onRequestEdit?.();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!isEditable) return;

    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    onEditingBlur?.();
  }

  function handleTextareaChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.currentTarget.value);
  }

  function handleTextareaKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter || keyboardEventIsComposing(event)) return;

    const textarea = event.currentTarget;
    const nextValue = textareaValueWithListContinuation(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (!nextValue) return;

    event.preventDefault();
    onChange(nextValue.value);

    window.requestAnimationFrame(() => {
      textarea.setSelectionRange(nextValue.selectionStart, nextValue.selectionStart);
    });
  }

  return (
    <div
      aria-label={ariaLabel}
      className={editorClassName}
      onBlur={handleBlur}
      onClick={onClick}
      onPointerDownCapture={handlePointerDownCapture}
      ref={setRootElement}
    >
      {isEditable ? (
        <textarea
          aria-label={ariaLabel}
          className="note-markdown-editor__textarea"
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          value={value}
          onChange={handleTextareaChange}
          onCompositionEnd={onCompositionEnd}
          onCompositionStart={onCompositionStart}
          onKeyDown={handleTextareaKeyDown}
        />
      ) : (
        <MarkdownPreviewContent
          className="note-markdown-editor__preview"
          emptyLabel=""
          mermaidEmptyDefinitionLabel="Mermaid diagram is empty."
          mermaidLoadingLabel="Rendering diagram..."
          onDoubleClick={readOnly ? undefined : onRequestEdit}
          value={value}
        />
      )}
    </div>
  );
}

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [workspaceTitle, setWorkspaceTitle] = useState("Scholium");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(() =>
    documentsSeed.map(workspaceEntryFromDocument),
  );
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceSource, setWorkspaceSource] = useState<WorkspaceSource | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [localFileSearchResults, setLocalFileSearchResults] = useState<
    SearchMarkdownFileResult[]
  >([]);
  const [fileSearchPending, setFileSearchPending] = useState(false);
  const [fileSearchError, setFileSearchError] = useState("");
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSearchActiveIndex, setDocumentSearchActiveIndex] = useState(0);
  const [documentSearchMatchCount, setDocumentSearchMatchCount] = useState(0);
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(() => new Set());
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(() => new Set());
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0].id);
  const [selectedWorkspaceDocumentIds, setSelectedWorkspaceDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mobileSelectedWorkspaceEntryKey, setMobileSelectedWorkspaceEntryKey] = useState("");
  const [notes, setNotes] = useState(notesSeed);
  const [activeNoteEditorKey, setActiveNoteEditorKey] = useState("");
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
  const [notePanelExpanded, setNotePanelExpanded] = useState(false);
  const [floatingNotePanelPosition, setFloatingNotePanelPosition] =
    useState<FloatingNotePosition | null>(null);
  const [selectionWarningPosition, setSelectionWarningPosition] =
    useState<SelectionWarningPosition | null>(null);
  const [isNotePanelClosing, setIsNotePanelClosing] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    window.matchMedia(mobileViewportQuery).matches,
  );
  const [isMobileSafeLayoutViewport, setIsMobileSafeLayoutViewport] = useState(() =>
    window.matchMedia(mobileSafeLayoutViewportQuery).matches,
  );
  const [settingsSnapshot, setSettingsSnapshot] =
    useState<SettingsSnapshot>(readSettingsSnapshot);
  const appLanguage = settingsSnapshot["app.language"];
  const noteModeEnabledByDefault = settingsSnapshot["app.noteModeEnabledByDefault"];
  const t = createTranslator(appLanguage);
  const [editorMode, setEditorMode] = useState<EditorMode>("preview");
  const [noteModeEnabled, setNoteModeEnabled] = useState(
    () => noteModeEnabledByDefault && documentsSeed.length > 0,
  );
  const [glossaryModeEnabled, setGlossaryModeEnabled] = useState(false);
  const [directoryPaneOpen, setDirectoryPaneOpen] = useState(false);
  const [windowIsFullscreen, setWindowIsFullscreen] = useState(false);
  const [noteLibraryOpen, setNoteLibraryOpen] = useState(false);
  const [focusedLibraryNoteId, setFocusedLibraryNoteId] = useState("");
  const [expandedLibraryNoteId, setExpandedLibraryNoteId] = useState("");
  const [dirtyDocumentStates, setDirtyDocumentStates] = useState<
    Record<string, DirtyDocumentState>
  >({});
  const [savedDocumentBodies, setSavedDocumentBodies] = useState<Record<string, string>>(() =>
    savedBodiesFromDocuments(documentsSeed),
  );
  const [storageError, setStorageError] = useState("");
  const [settingsViewOpen, setSettingsViewOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingCategory>("app");
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [duplicateFileDialog, setDuplicateFileDialog] =
    useState<DuplicateFileDialogState | null>(null);
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxConnecting, setDropboxConnecting] = useState(false);
  const [dropboxDirectoryPicker, setDropboxDirectoryPicker] =
    useState<DropboxDirectoryPickerState | null>(null);
  const notePanelRef = useRef<HTMLElement | null>(null);
  const floatingNoteCardRef = useRef<HTMLDivElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const duplicateFileInputRef = useRef<HTMLInputElement | null>(null);
  const documentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const noteEditorRootRef = useRef<HTMLDivElement | null>(null);
  const noteModeDefaultAppliedRef = useRef(noteModeEnabled);
  const returnToViewTimerRef = useRef(0);
  const notePanelCloseTimerRef = useRef(0);
  const floatingNotePanelPositionFrameRef = useRef(0);
  const floatingNoteAnchorRectRef = useRef<TextRangeRect | null>(null);
  const lastPointerAnchorRectRef = useRef<TextRangeRect | null>(null);
  const directoryPaneOpenBeforeNoteLibraryRef = useRef<boolean | null>(null);
  const directoryPaneOpenBeforeFullscreenRef = useRef<boolean | null>(null);
  const directoryPaneClosedInFullscreenRef = useRef(false);
  const directoryPaneToggledInFullscreenRef = useRef(false);
  const directoryPaneStartupSettingNormalizedRef = useRef(false);
  const windowIsFullscreenRef = useRef(false);
  const noteEditorShouldRefocusRef = useRef(false);
  const noteLibraryFocusAlignmentKeyRef = useRef("");
  const noteEditorIsComposingRef = useRef(false);
  const noteEditorEnterIgnoredDuringCompositionRef = useRef(false);
  const noteEditorPostCompositionGuardUntilRef = useRef(0);
  const noteEditModalActiveRef = useRef(false);
  const ignoreNextWorkspaceClickRef = useRef(false);
  const suppressedLibraryAnnotationClickRef = useRef<{
    noteId: string;
    until: number;
  } | null>(null);
  const noteDraftRef = useRef(noteDraft);
  const glossaryDraftRef = useRef(glossaryDraft);
  const transientSelectionNoteIdRef = useRef("");
  const transientGlossaryBindingIdRef = useRef("");
  const transientGlossaryTermIdRef = useRef("");
  const pendingGlossaryPromptLockUntilRef = useRef(0);
  const autosaveTimerRef = useRef(0);
  const autosaveInFlightRef = useRef(false);
  const autosaveRequestedWhileSavingRef = useRef(false);
  const externalFileRefreshInFlightRef = useRef(false);
  const documentsRef = useRef(documents);
  const workspaceEntriesRef = useRef(workspaceEntries);
  const notesRef = useRef(notes);
  const glossaryTermsRef = useRef(glossaryTerms);
  const glossaryBindingsRef = useRef(glossaryBindings);
  const dirtyDocumentStatesRef = useRef(dirtyDocumentStates);
  const savedDocumentBodiesRef = useRef(savedDocumentBodies);
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  const notePanelHasContentRef = useRef(false);
  const selectionWarningPreserveUntilRef = useRef(0);
  const selectionDismissedUntilRef = useRef(0);
  const selectionClearedByAppUntilRef = useRef(0);
  const lastOpenedFileRestoreAttemptedRef = useRef(false);
  const dropboxOpenAfterAuthRef = useRef(false);
  const openSettingsHandlerRef = useRef<() => void>(() => undefined);
  const newMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const openMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const openMarkdownFolderHandlerRef = useRef<() => void>(() => undefined);
  const openDropboxCloudHandlerRef = useRef<() => void>(() => undefined);
  const completeDropboxOAuthHandlerRef = useRef<
    (payload: DropboxOAuthCallbackPayload) => void
  >(() => undefined);

  documentsRef.current = documents;
  workspaceEntriesRef.current = workspaceEntries;
  notesRef.current = notes;
  glossaryTermsRef.current = glossaryTerms;
  glossaryBindingsRef.current = glossaryBindings;
  dirtyDocumentStatesRef.current = dirtyDocumentStates;
  savedDocumentBodiesRef.current = savedDocumentBodies;
  selectedDocumentIdRef.current = selectedDocumentId;
  noteDraftRef.current = noteDraft;
  glossaryDraftRef.current = glossaryDraft;
  openSettingsHandlerRef.current = openSettingsView;
  newMarkdownFileHandlerRef.current = () => {
    void newMarkdownFile();
  };
  openMarkdownFileHandlerRef.current = () => {
    void openMarkdownFileFromPicker();
  };
  openMarkdownFolderHandlerRef.current = () => {
    void openMarkdownFolder();
  };
  openDropboxCloudHandlerRef.current = () => {
    void openDropboxCloudSource();
  };
  completeDropboxOAuthHandlerRef.current = (payload) => {
    void completeDropboxOAuth(payload);
  };

  const hasOpenDocument = documents.length > 0;
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ??
    documents[0] ??
    emptyDocument;
  const annotationToolsAvailable = hasOpenDocument;
  const workspaceHasMarkdownFileEntries = workspaceEntries.some(
    (entry) => entry.kind === "file",
  );
  const glossaryModeActive = noteModeEnabled && glossaryModeEnabled;

  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const documentGlossaryBindings = glossaryBindings.filter(
    (binding) => binding.documentId === selectedDocument.id && binding.status !== "deleted",
  );
  const nativeStorageAvailable = hasNativeStorageAccess();
  const documentSearchVisible = hasOpenDocument && !settingsViewOpen && (documentSearchOpen || isMobileViewport);
  const activeDocumentSearchQuery = documentSearchVisible ? documentSearchQuery : "";
  const documentSearchState = useMemo<DocumentSearchState>(
    () => ({
      activeIndex: documentSearchActiveIndex,
      query: activeDocumentSearchQuery,
    }),
    [activeDocumentSearchQuery, documentSearchActiveIndex],
  );
  const documentSearchStatus =
    documentSearchQuery.trim() && documentSearchVisible
      ? documentSearchMatchCount > 0
        ? t("documentSearch.count", {
            current: Math.min(documentSearchActiveIndex + 1, documentSearchMatchCount),
            total: documentSearchMatchCount,
          })
        : t("documentSearch.noResults")
      : "";
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
    .filter(selectionNoteHasContent)
    .slice()
    .sort((leftNote, rightNote) => {
      const positionDifference = leftNote.anchor.from - rightNote.anchor.from;
      if (positionDifference !== 0) return positionDifference;

      return leftNote.createdAt.localeCompare(rightNote.createdAt);
    });
  const expandedLibraryNote = noteLibraryNotes.find(
    (note) => note.id === expandedLibraryNoteId,
  );
  const expandedLibraryNoteEditorKey = expandedLibraryNote
    ? noteEditorKey("expanded", expandedLibraryNote.id)
    : "";
  const libraryNotePanelExpanded = Boolean(
    !settingsViewOpen && noteModeEnabled && noteLibraryOpen && expandedLibraryNote,
  );
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
  const activeNoteIsEditing = Boolean(activeNote && activeNoteMode === "edit");
  const activeGlossaryIsEditing = Boolean(activeGlossaryTerm && activeGlossaryMode === "edit");
  const noteEditModalActive = activeNoteIsEditing || activeGlossaryIsEditing;
  const pendingAnchorCanCreateNote = Boolean(
    noteModeEnabled &&
      pendingAnchor &&
      !pendingGlossaryTerm &&
      !pendingAnchorIsGlossaryTerm,
  );
  const shouldShowSelectionConfirmation = pendingAnchorCanCreateNote;
  function noteEditorKey(surface: "floating" | "library" | "expanded", noteId: string) {
    return `${surface}:${noteId}`;
  }
  const notePanelHasContent = Boolean(
    noteModeEnabled &&
      (shouldShowSelectionConfirmation ||
        activeNote ||
        activeGlossaryTerm ||
        pendingGlossaryTerm),
  );
  const floatingNotePanelShouldRender = noteModeEnabled && notePanelHasContent;
  const notePanelModalActive = floatingNotePanelShouldRender && !isNotePanelClosing;
  const floatingNoteCanExpand = Boolean(!pendingAnchor && (activeNote || activeGlossaryTerm));
  const floatingNotePanelExpanded =
    !settingsViewOpen && notePanelExpanded && floatingNoteCanExpand && !isNotePanelClosing;
  const expandedNotePanelScrollLocked =
    floatingNotePanelExpanded || libraryNotePanelExpanded;
  const floatingNoteBackdropActive = notePanelModalActive;
  const activeFloatingNoteKey = activeNote
    ? `note:${activeNote.id}`
    : activeGlossaryTerm
      ? `glossary:${activeGlossaryTerm.id}`
      : pendingGlossaryTerm
        ? `pending-glossary:${pendingGlossaryTerm.id}`
        : pendingAnchor
          ? `pending:${pendingAnchor.from}:${pendingAnchor.to}`
          : "";
  noteEditModalActiveRef.current = notePanelModalActive;

  useEffect(() => {
    if (!activeNoteEditorKey) return;

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      if (event.button !== 0) return;
      if (targetIsInsideNoteMarkdownEditor(event.target)) return;

      setActiveNoteEditorKey("");
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [activeNoteEditorKey]);

  useEffect(() => {
    if (!notePanelModalActive || !pendingAnchor) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    selectionClearedByAppUntilRef.current =
      Date.now() + appDrivenSelectionClearGuardMs;
    selection.removeAllRanges();
  }, [notePanelModalActive, pendingAnchor]);

  useEffect(() => {
    notePanelHasContentRef.current = notePanelHasContent;
  }, [notePanelHasContent]);

  useEffect(() => {
    setNotePanelExpanded(false);
  }, [activeFloatingNoteKey]);

  useEffect(() => {
    if (floatingNotePanelShouldRender) return;

    setNotePanelExpanded(false);
  }, [floatingNotePanelShouldRender]);

  useEffect(() => {
    if (!expandedNotePanelScrollLocked) return undefined;

    const originalBodyOverflow = document.body.style.overflow;
    const originalDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalDocumentOverflow;
    };
  }, [expandedNotePanelScrollLocked]);

  useEffect(() => {
    if (!expandedNotePanelScrollLocked || !directoryPaneOpen) return;

    collapseDirectoryPaneForNoteExpansion();
  }, [directoryPaneOpen, expandedNotePanelScrollLocked]);

  useEffect(() => {
    if (noteModeEnabled) return;

    resetNoteModeInteractionState();
    setGlossaryModeEnabled(false);
    if (directoryPaneOpenBeforeNoteLibraryRef.current === true) {
      setDirectoryPaneOpen(true);
    }
    directoryPaneOpenBeforeNoteLibraryRef.current = null;
    setNoteLibraryOpen(false);
    setFocusedLibraryNoteId("");
  }, [noteModeEnabled]);

  useEffect(() => {
    if (!hasOpenDocument) {
      noteModeDefaultAppliedRef.current = false;
      return;
    }

    if (!noteModeEnabledByDefault) {
      noteModeDefaultAppliedRef.current = false;
      return;
    }

    if (noteModeDefaultAppliedRef.current) return;

    noteModeDefaultAppliedRef.current = true;
    setNoteModeEnabled(true);
  }, [hasOpenDocument, noteModeEnabledByDefault]);

  useEffect(() => {
    if (hasOpenDocument) return;

    if (noteModeEnabled) {
      resetNoteModeInteractionState();
      setNoteModeEnabled(false);
      setGlossaryModeEnabled(false);
    }
    if (noteLibraryOpen) {
      closeNoteLibrary({ restoreDirectoryPane: false });
    }
  }, [hasOpenDocument, noteLibraryOpen, noteModeEnabled]);

  useEffect(() => {
    if (
      focusedLibraryNoteId &&
      !noteLibraryNotes.some((note) => note.id === focusedLibraryNoteId)
    ) {
      setFocusedLibraryNoteId("");
    }
  }, [focusedLibraryNoteId, noteLibrarySignature]);

  useEffect(() => {
    if (
      expandedLibraryNoteId &&
      (!noteLibraryOpen || !noteLibraryNotes.some((note) => note.id === expandedLibraryNoteId))
    ) {
      setExpandedLibraryNoteId("");
    }
  }, [expandedLibraryNoteId, noteLibraryOpen, noteLibrarySignature]);

  useEffect(() => {
    if (!noteLibraryOpen) {
      setFocusedLibraryNoteId("");
      setExpandedLibraryNoteId("");
    }
  }, [noteLibraryOpen]);

  useEffect(() => {
    if (!noteLibraryFocusActive || !focusedLibraryNoteId) {
      noteLibraryFocusAlignmentKeyRef.current = "";
      return undefined;
    }

    const alignmentKey = `${selectedDocumentId}:${editorMode}:${focusedLibraryNoteId}`;
    if (noteLibraryFocusAlignmentKeyRef.current === alignmentKey) return undefined;

    noteLibraryFocusAlignmentKeyRef.current = alignmentKey;

    let cancelled = false;
    let animationFrame = 0;
    let attempts = 0;

    function alignFocusedTargets() {
      if (cancelled) return;

      const annotationAligned = alignFocusedAnnotationToViewport(focusedLibraryNoteId);
      const noteCardAligned = alignLibraryNoteCardToViewport(focusedLibraryNoteId);
      attempts += 1;

      if ((!annotationAligned || !noteCardAligned) && attempts < 8) {
        animationFrame = window.requestAnimationFrame(alignFocusedTargets);
      }
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = window.requestAnimationFrame(alignFocusedTargets);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    editorMode,
    focusedLibraryNoteId,
    noteLibraryFocusActive,
    noteLibrarySignature,
    selectedDocumentId,
  ]);

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
    function handlePlainTextCopy(event: ClipboardEvent) {
      const selectedText = window.getSelection()?.toString() ?? "";
      if (!selectedText) return;
      if (!event.clipboardData) return;

      event.preventDefault();
      event.clipboardData.clearData();
      event.clipboardData.setData("text/plain", selectedText);
    }

    document.addEventListener("copy", handlePlainTextCopy, true);

    return () => {
      document.removeEventListener("copy", handlePlainTextCopy, true);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileViewportQuery);
    const safeLayoutMediaQuery = window.matchMedia(mobileSafeLayoutViewportQuery);

    function updateMobileViewport() {
      setIsMobileViewport(mediaQuery.matches);
      setIsMobileSafeLayoutViewport(safeLayoutMediaQuery.matches);
    }

    updateMobileViewport();
    mediaQuery.addEventListener("change", updateMobileViewport);
    safeLayoutMediaQuery.addEventListener("change", updateMobileViewport);

    return () => {
      mediaQuery.removeEventListener("change", updateMobileViewport);
      safeLayoutMediaQuery.removeEventListener("change", updateMobileViewport);
    };
  }, []);

  useEffect(() => {
    if (isMobileViewport && directoryPaneOpen) return;
    setMobileSelectedWorkspaceEntryKey("");
  }, [directoryPaneOpen, isMobileViewport]);

  useEffect(() => {
    if (directoryPaneStartupSettingNormalizedRef.current) return;
    directoryPaneStartupSettingNormalizedRef.current = true;
    if (!settingsSnapshot["app.directoryPaneOpen"]) return;

    const writtenValue = writeSetting("app.directoryPaneOpen", false) as boolean;
    setSettingsSnapshot((currentSettings) => ({
      ...currentSettings,
      "app.directoryPaneOpen": writtenValue,
    }));
  }, [settingsSnapshot]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let fullscreenSyncTimer = 0;
    let unlistenResized: (() => void) | null = null;
    let unlistenFocusChanged: (() => void) | null = null;

    async function synchronizeWindowFullscreenState() {
      try {
        const nextWindowIsFullscreen = await appWindow.isFullscreen();
        if (!disposed) {
          setWindowIsFullscreen(nextWindowIsFullscreen);
        }
      } catch (error) {
        console.error(error);
      }
    }

    function scheduleWindowFullscreenSync() {
      window.clearTimeout(fullscreenSyncTimer);
      fullscreenSyncTimer = window.setTimeout(() => {
        void synchronizeWindowFullscreenState();
      }, 120);
    }

    void synchronizeWindowFullscreenState();

    void Promise.all([
      appWindow.onResized(() => scheduleWindowFullscreenSync()),
      appWindow.onFocusChanged(() => scheduleWindowFullscreenSync()),
    ]).then(([resizedListener, focusChangedListener]) => {
      if (disposed) {
        resizedListener();
        focusChangedListener();
        return;
      }

      unlistenResized = resizedListener;
      unlistenFocusChanged = focusChangedListener;
    });

    return () => {
      disposed = true;
      window.clearTimeout(fullscreenSyncTimer);
      unlistenResized?.();
      unlistenFocusChanged?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    const wasWindowFullscreen = windowIsFullscreenRef.current;

    if (wasWindowFullscreen !== windowIsFullscreen) {
      windowIsFullscreenRef.current = windowIsFullscreen;

      if (windowIsFullscreen) {
        directoryPaneOpenBeforeFullscreenRef.current = directoryPaneOpen;
        directoryPaneClosedInFullscreenRef.current = false;
        directoryPaneToggledInFullscreenRef.current = false;
      } else {
        const restoreDirectoryPaneOpen = directoryPaneOpenBeforeFullscreenRef.current;
        const userToggledDirectoryPaneInFullscreen =
          directoryPaneToggledInFullscreenRef.current;

        directoryPaneOpenBeforeFullscreenRef.current = null;
        directoryPaneClosedInFullscreenRef.current = false;
        directoryPaneToggledInFullscreenRef.current = false;

        if (!userToggledDirectoryPaneInFullscreen && restoreDirectoryPaneOpen !== null) {
          setDirectoryPaneOpen(restoreDirectoryPaneOpen);
        }

        return;
      }
    }

    if (
      windowIsFullscreen &&
      !directoryPaneClosedInFullscreenRef.current &&
      !directoryPaneOpen
    ) {
      setDirectoryPaneOpen(true);
    }
  }, [directoryPaneOpen, windowIsFullscreen]);

  useLayoutEffect(() => {
    if (!noteEditorShouldRefocusRef.current) return;

    refocusNoteMarkdownEditor();
  }, [
    activeGlossaryMode,
    activeGlossaryTermId,
    activeNoteId,
    activeNoteMode,
    editorMode,
    pendingAnchor,
  ]);

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
    window.addEventListener("resize", updateFloatingNotePanelPosition);

    return () => {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
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

  function targetIsInsideNoteMarkdownEditor(target: EventTarget | null) {
    return Boolean(elementFromEventTarget(target)?.closest(".note-markdown-editor"));
  }

  function targetIsInsideEditingNoteMarkdownEditor(target: EventTarget | null) {
    return Boolean(
      elementFromEventTarget(target)?.closest(".note-markdown-editor.is-editing"),
    );
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

  function clearSelectionWarning() {
    selectionWarningPreserveUntilRef.current = 0;
    setSelectionWarningPosition(null);
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

  function cssAttributeSelectorValue(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function scrollableAncestor(element: Element) {
    let currentElement = element.parentElement;

    while (currentElement && currentElement !== document.body) {
      const style = window.getComputedStyle(currentElement);
      const canScrollVertically =
        currentElement.scrollHeight > currentElement.clientHeight + 1;
      if (
        canScrollVertically &&
        (style.overflowY === "auto" ||
          style.overflowY === "scroll" ||
          style.overflowY === "overlay")
      ) {
        return currentElement;
      }

      currentElement = currentElement.parentElement;
    }

    return null;
  }

  function alignRectToVerticalViewportPosition(
    rect: Pick<TextRangeRect, "top">,
    scrollContainer: HTMLElement | null,
  ) {
    const targetViewportTop = window.innerHeight * noteLibraryFocusAlignmentRatio;

    if (scrollContainer) {
      const rawTop = scrollContainer.scrollTop + rect.top - targetViewportTop;
      const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const nextTop = clampNumber(rawTop, 0, maxTop);

      if (Math.abs(scrollContainer.scrollTop - nextTop) > 1) {
        scrollContainer.scrollTo({ top: nextTop, behavior: "instant" });
      }
      return true;
    }

    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const rawTop = window.scrollY + rect.top - targetViewportTop;
    const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    const nextTop = clampNumber(rawTop, 0, maxTop);

    if (Math.abs(window.scrollY - nextTop) > 1) {
      window.scrollTo({ top: nextTop, behavior: "instant" });
    }
    return true;
  }

  function annotationElementsForNote(noteId: string) {
    const safeNoteId = cssAttributeSelectorValue(noteId);
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        `.cm-annotation-frame[data-note-id="${safeNoteId}"], .preview-annotation-frame[data-note-id="${safeNoteId}"], .milkdown-annotation-frame[data-note-id="${safeNoteId}"], .cm-note-annotation[data-note-id="${safeNoteId}"], .preview-note-annotation[data-note-id="${safeNoteId}"], .milkdown-note-annotation[data-note-id="${safeNoteId}"]`,
      ),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort(
        (leftElement, rightElement) =>
          leftElement.getBoundingClientRect().top -
            rightElement.getBoundingClientRect().top ||
          leftElement.getBoundingClientRect().left -
            rightElement.getBoundingClientRect().left,
      );
  }

  function alignFocusedAnnotationToViewport(noteId: string) {
    const annotationElements = annotationElementsForNote(noteId);
    if (annotationElements.length === 0) return false;

    const annotationRects = annotationElements.flatMap((element) =>
      Array.from(element.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      ),
    );
    const anchorRect = textAnchorRectFromClientRects(annotationRects);
    if (!anchorRect) return false;

    alignRectToVerticalViewportPosition(
      anchorRect,
      scrollableAncestor(annotationElements[0]),
    );
    return true;
  }

  function noteLibraryCardElement(noteId: string) {
    const safeNoteId = cssAttributeSelectorValue(noteId);
    return document.querySelector<HTMLElement>(
      `.note-library-card[data-note-id="${safeNoteId}"]`,
    );
  }

  function alignLibraryNoteCardToViewport(noteId: string) {
    const noteCard = noteLibraryCardElement(noteId);
    if (!noteCard) return false;

    alignRectToVerticalViewportPosition(
      noteCard.getBoundingClientRect(),
      noteCard.closest<HTMLElement>(".note-library-list") ?? scrollableAncestor(noteCard),
    );
    return true;
  }

  function shellRelativePointFromViewport(clientX: number, clientY: number) {
    const shellRect = document
      .querySelector<HTMLElement>(".scholium-shell")
      ?.getBoundingClientRect();

    return {
      left: clientX - (shellRect?.left ?? 0),
      top: clientY - (shellRect?.top ?? 0),
    };
  }

  function calculateFloatingNotePosition(
    anchorRect: TextRangeRect,
    cardRect: DOMRect,
  ): FloatingNotePosition {
    const viewportWidth = window.innerWidth;
    const viewportMargin = 12;
    const cardWidth = Math.min(
      cardRect.width || 450,
      Math.max(180, viewportWidth - viewportMargin * 2),
    );
    const placement = "below";
    const connectorAnchorGap = 6;
    const panelAnchorY = anchorRect.bottom + connectorAnchorGap;
    const targetX = anchorRect.targetX;
    const targetY = anchorRect.targetBottom;
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
    const top = panelAnchorY + verticalDistance;
    const sourceY = top;
    const connectorDeltaX = sourceX - targetX;
    const connectorDeltaY = sourceY - targetY;
    const connectorWidth = Math.max(
      0,
      Math.sqrt(connectorDeltaX * connectorDeltaX + connectorDeltaY * connectorDeltaY),
    );
    const connectorAngle =
      Math.atan2(connectorDeltaY, connectorDeltaX) * (180 / Math.PI);
    const panelPoint = shellRelativePointFromViewport(left, top);
    const connectorPoint = shellRelativePointFromViewport(targetX, targetY);

    return {
      connector: {
        angle: Math.round(connectorAngle * 100) / 100,
        left: Math.round(connectorPoint.left),
        top: Math.round(connectorPoint.top),
        width: Math.round(connectorWidth),
      },
      left: Math.round(panelPoint.left),
      placement,
      top: Math.round(panelPoint.top),
    };
  }

  function calculateDetachedFloatingNotePosition(cardRect: DOMRect): FloatingNotePosition {
    const viewportHeight = window.innerHeight;
    const viewportMargin = 12;
    const cardHeight = cardRect.height || 260;
    const maxFittingTop = viewportHeight - viewportMargin - cardHeight;
    const top =
      maxFittingTop >= viewportMargin
        ? viewportHeight - viewportMargin - cardHeight
        : viewportMargin;
    const panelPoint = shellRelativePointFromViewport(viewportMargin, top);

    return {
      connector: null,
      left: Math.round(panelPoint.left),
      placement: "detached",
      top: Math.round(panelPoint.top),
    };
  }

  function floatingNotePositionsAreEqual(
    leftPosition: FloatingNotePosition | null,
    rightPosition: FloatingNotePosition,
  ) {
    return (
      leftPosition?.left === rightPosition.left &&
      leftPosition.top === rightPosition.top &&
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

  function moveEditableCaretToEnd(element: HTMLElement) {
    if (element instanceof HTMLTextAreaElement) {
      const selectionOffset = element.value.length;
      element.setSelectionRange(selectionOffset, selectionOffset);
      return;
    }

    const focusTarget = ensureEmptyEditablePreviewLine(element) ?? element;
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(focusTarget);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function focusMarkdownEditor(root: HTMLElement | null, remainingAttempts = 8) {
    window.requestAnimationFrame(() => {
      const editableElement = root?.querySelector<HTMLElement>(
        ".note-markdown-editor__textarea, .cm-content[contenteditable='true'], .ProseMirror[contenteditable='true'], .markdown-preview[contenteditable='true']",
      );
      if (!editableElement) {
        if (remainingAttempts > 0) {
          focusMarkdownEditor(root, remainingAttempts - 1);
        }
        return;
      }

      noteEditorShouldRefocusRef.current = false;
      editableElement.focus({ preventScroll: true });
      moveEditableCaretToEnd(editableElement);
    });
  }

  function refocusNoteMarkdownEditor() {
    focusMarkdownEditor(noteEditorRootRef.current);
  }

  function insertTextIntoActiveNoteEditor(text: string) {
    if (!text) return false;

    if (activeNote) {
      const nextDraft = `${noteDraftRef.current}${text}`;
      setNoteDraft(nextDraft);
      updateNoteBody(activeNote.id, nextDraft);
      noteEditorShouldRefocusRef.current = true;
      refocusNoteMarkdownEditor();
      return true;
    }

    if (activeGlossaryIsEditing && activeGlossaryTerm) {
      const nextDraft = `${glossaryDraftRef.current}${text}`;
      setGlossaryDraft(nextDraft);
      updateGlossaryDefinition(activeGlossaryTerm.id, nextDraft);
      noteEditorShouldRefocusRef.current = true;
      refocusNoteMarkdownEditor();
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
    if (!(nextFocusedElement instanceof Node)) {
      return;
    }

    if (event.currentTarget.contains(nextFocusedElement)) {
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

  function pointHitsLibraryNoteRange(noteId: string, clientX: number, clientY: number) {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-note-annotation[data-note-id], .cm-annotation-frame[data-note-id], .preview-note-annotation[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
      ),
    ).some((element) => {
      if (element.dataset.noteId !== noteId) return false;

      return pointHitsAnyRect(clientX, clientY, Array.from(element.getClientRects()));
    });
  }

  function eventHitsFocusedLibraryNoteRange(event: LibraryAnnotationPointerEvent) {
    if (!focusedLibraryNoteId) return false;

    const targetElement = elementFromEventTarget(event.target);
    const noteElement = targetElement?.closest<HTMLElement>(
      ".cm-note-annotation[data-note-id], .cm-annotation-frame[data-note-id], .preview-note-annotation[data-note-id], .preview-annotation-frame[data-note-id], .milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
    );

    return (
      noteElement?.dataset.noteId === focusedLibraryNoteId ||
      pointHitsLibraryNoteRange(focusedLibraryNoteId, event.clientX, event.clientY)
    );
  }

  function suppressNextLibraryAnnotationClick(noteId: string) {
    suppressedLibraryAnnotationClickRef.current = {
      noteId,
      until: Date.now() + libraryAnnotationClickSuppressionMs,
    };
  }

  function consumeSuppressedLibraryAnnotationClick(noteId: string) {
    const suppressedClick = suppressedLibraryAnnotationClickRef.current;
    if (!suppressedClick) return false;

    if (Date.now() > suppressedClick.until) {
      suppressedLibraryAnnotationClickRef.current = null;
      return false;
    }

    if (suppressedClick.noteId !== noteId) return false;

    suppressedLibraryAnnotationClickRef.current = null;
    return true;
  }

  function suppressAndDismissFocusedLibraryAnnotationClick(
    event: LibraryAnnotationPointerEvent,
  ) {
    if (event.button !== 0) return false;
    if (!eventHitsFocusedLibraryNoteRange(event)) return false;

    suppressNextLibraryAnnotationClick(focusedLibraryNoteId);
    setFocusedLibraryNoteId("");
    event.preventDefault();
    event.stopPropagation();
    return true;
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

    return Boolean(
      targetElement?.closest("input, textarea, select, [contenteditable='true']"),
    );
  }

  function focusDocumentSearchInput(selectText = false) {
    window.requestAnimationFrame(() => {
      const input = documentSearchInputRef.current;
      if (!input) return;

      input.focus();
      if (selectText) {
        input.select();
      }
    });
  }

  function openDocumentSearch(selectText = true) {
    if (!hasOpenDocument || settingsViewOpen) return;

    setDocumentSearchOpen(true);
    focusDocumentSearchInput(selectText);
  }

  function closeDocumentSearch() {
    setDocumentSearchOpen(false);
  }

  function clearDocumentSearch() {
    setDocumentSearchQuery("");
    setDocumentSearchActiveIndex(0);
    setDocumentSearchMatchCount(0);
    focusDocumentSearchInput(false);
  }

  function updateDocumentSearchQuery(value: string) {
    setDocumentSearchQuery(value);
    setDocumentSearchActiveIndex(0);
  }

  function moveDocumentSearch(delta: number) {
    if (documentSearchMatchCount <= 0) return;

    setDocumentSearchActiveIndex(
      (currentIndex) =>
        (currentIndex + delta + documentSearchMatchCount) % documentSearchMatchCount,
    );
  }

  function handleDocumentSearchInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveDocumentSearch(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeDocumentSearch();
    }
  }

  function handleDocumentSearchMatchCountChange(count: number) {
    setDocumentSearchMatchCount(count);
    setDocumentSearchActiveIndex((currentIndex) =>
      count > 0 ? Math.min(currentIndex, count - 1) : 0,
    );
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
    if (!noteEditModalActive) return;

    refocusNoteMarkdownEditor();

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

    const dismissTimer = window.setTimeout(() => {
      clearSelectionWarning();
    }, selectionWarningAutoDismissMs);

    function dismissSelectionWarning() {
      if (Date.now() < selectionWarningPreserveUntilRef.current) return;

      clearSelectionWarning();
    }

    document.addEventListener("pointerdown", dismissSelectionWarning, true);

    return () => {
      window.clearTimeout(dismissTimer);
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
    if (!duplicateFileDialog) return;

    window.setTimeout(() => {
      duplicateFileInputRef.current?.focus();
      duplicateFileInputRef.current?.select();
    });
  }, [duplicateFileDialog?.documentId]);

  useEffect(() => {
    if (!settingsViewOpen) return;

    window.setTimeout(() => {
      settingsCloseButtonRef.current?.focus();
    });
  }, [settingsViewOpen]);

  useEffect(() => {
    document.documentElement.lang = appLanguageHtmlLang[appLanguage];

    return () => {
      document.documentElement.removeAttribute("lang");
    };
  }, [appLanguage]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    void invoke("set_app_language", { language: appLanguage }).catch((error) => {
      console.error(error);
    });
  }, [appLanguage, nativeStorageAvailable]);

  useEffect(() => {
    const query = fileSearchQuery.trim();
    const canSearchLocalWorkspace =
      Boolean(query) &&
      workspaceSource === "local" &&
      Boolean(workspaceRootPath) &&
      nativeStorageAvailable;

    if (!canSearchLocalWorkspace) {
      setLocalFileSearchResults([]);
      setFileSearchPending(false);
      setFileSearchError("");
      return;
    }

    let cancelled = false;
    setLocalFileSearchResults([]);
    setFileSearchPending(true);
    setFileSearchError("");

    const searchTimer = window.setTimeout(() => {
      void invoke<SearchMarkdownFileResult[]>("search_markdown_files", {
        rootPath: workspaceRootPath,
        query,
      })
        .then((results) => {
          if (cancelled) return;
          setLocalFileSearchResults(results);
        })
        .catch((error) => {
          if (cancelled) return;
          setLocalFileSearchResults([]);
          setFileSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) {
            setFileSearchPending(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(searchTimer);
    };
  }, [fileSearchQuery, nativeStorageAvailable, workspaceRootPath, workspaceSource]);

  useEffect(() => {
    const interfaceFontSize = settingsSnapshot["app.interfaceFontSize"];
    document.documentElement.style.fontSize = `${interfaceFontSize}px`;

    return () => {
      document.documentElement.style.removeProperty("font-size");
    };
  }, [settingsSnapshot]);

  useEffect(() => {
    const theme = settingsSnapshot["app.theme"];
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const effectiveTheme = theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = effectiveTheme;
    }

    applyTheme();

    if (theme !== "system") {
      return () => {
        document.documentElement.removeAttribute("data-theme");
      };
    }

    mediaQuery.addEventListener("change", applyTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
      document.documentElement.removeAttribute("data-theme");
    };
  }, [settingsSnapshot]);

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

    const hasDirtyBackedDocument = documents.some((document) => {
      const hasBackingFile = Boolean(document.filePath) || documentIsFromDropbox(document);
      return hasBackingFile && hasDirtyState(dirtyDocumentStates[document.id]);
    });
    if (!hasDirtyBackedDocument) return;

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveDirtyDocuments();
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [dirtyDocumentStates, documents, glossaryBindings, glossaryTerms, nativeStorageAvailable, notes]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let refreshIntervalId = 0;

    function refreshCleanDocument() {
      if (document.visibilityState === "hidden") return;

      void refreshSelectedDocumentFromDisk();
    }

    function startRefreshPolling() {
      if (refreshIntervalId || document.visibilityState === "hidden") return;

      refreshIntervalId = window.setInterval(
        refreshCleanDocument,
        externalFileRefreshIntervalMs,
      );
    }

    function stopRefreshPolling() {
      if (!refreshIntervalId) return;

      window.clearInterval(refreshIntervalId);
      refreshIntervalId = 0;
    }

    function refreshAndPollCleanDocument() {
      if (document.visibilityState === "hidden") {
        stopRefreshPolling();
        return;
      }

      startRefreshPolling();
      refreshCleanDocument();
    }

    refreshAndPollCleanDocument();
    window.addEventListener("focus", refreshAndPollCleanDocument);
    document.addEventListener("visibilitychange", refreshAndPollCleanDocument);

    return () => {
      stopRefreshPolling();
      window.removeEventListener("focus", refreshAndPollCleanDocument);
      document.removeEventListener("visibilitychange", refreshAndPollCleanDocument);
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable || lastOpenedFileRestoreAttemptedRef.current) return;
    lastOpenedFileRestoreAttemptedRef.current = true;
    if (!settingsSnapshot["app.restoreLastOpenedFile"]) return;

    const lastOpenedPath = readLastOpenedMarkdownPath();
    const lastOpenedRootDirectoryPath = readLastOpenedMarkdownRootDirectoryPath();
    if (!lastOpenedPath && !lastOpenedRootDirectoryPath) return;

    setStorageError(t("status.openingLastFile"));

    function restoreFromSelectedFileParent() {
      if (!lastOpenedPath) {
        forgetLastOpenedMarkdownRootDirectoryPath();
        setStorageError("");
        return;
      }

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
          forgetLastOpenedMarkdownRootDirectoryPath();
          setStorageError(
            t("error.couldNotReopenLastFile", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
    }

    if (lastOpenedRootDirectoryPath) {
      void restoreLastOpenedMarkdownWorkspace(
        lastOpenedRootDirectoryPath,
        lastOpenedPath,
      )
        .then(() => {
          setStorageError("");
        })
        .catch(() => {
          forgetLastOpenedMarkdownRootDirectoryPath();
          restoreFromSelectedFileParent();
        });
      return;
    }

    restoreFromSelectedFileParent();
  }, [nativeStorageAvailable, settingsSnapshot]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let unlistenNewFile: (() => void) | null = null;
    let unlistenOpenSettings: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    let unlistenOpenFolder: (() => void) | null = null;
    let unlistenOpenDropbox: (() => void) | null = null;
    let unlistenOpenLocation: (() => void) | null = null;

    void Promise.all([
      listen("scholium-new-file", () => {
        newMarkdownFileHandlerRef.current();
      }),
      listen("scholium-open-settings", () => {
        openSettingsHandlerRef.current();
      }),
      listen("scholium-open-file", () => {
        openMarkdownFileHandlerRef.current();
      }),
      listen("scholium-open-folder", () => {
        openMarkdownFolderHandlerRef.current();
      }),
      listen("scholium-open-dropbox", () => {
        openDropboxCloudHandlerRef.current();
      }),
      listen<OpenLocationEventPayload>("scholium-open-location", (event) => {
        void openNativeMenuLocation(event.payload);
      }),
    ]).then(
      ([
        newFileListener,
        openSettingsListener,
        openFileListener,
        openFolderListener,
        openDropboxListener,
        openLocationListener,
      ]) => {
        unlistenNewFile = newFileListener;
        unlistenOpenSettings = openSettingsListener;
        unlistenOpenFile = openFileListener;
        unlistenOpenFolder = openFolderListener;
        unlistenOpenDropbox = openDropboxListener;
        unlistenOpenLocation = openLocationListener;
      },
    );

    return () => {
      unlistenNewFile?.();
      unlistenOpenSettings?.();
      unlistenOpenFile?.();
      unlistenOpenFolder?.();
      unlistenOpenDropbox?.();
      unlistenOpenLocation?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    void refreshDropboxOAuthStatus();
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let unlistenDropboxOAuthCallback: (() => void) | null = null;

    void listen<DropboxOAuthCallbackPayload>("scholium-dropbox-oauth-callback", (event) => {
      completeDropboxOAuthHandlerRef.current(event.payload);
    }).then((listener) => {
      unlistenDropboxOAuthCallback = listener;
    });

    return () => {
      unlistenDropboxOAuthCallback?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!dropboxDirectoryPicker) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [Boolean(dropboxDirectoryPicker)]);

  useEffect(() => {
    if (!hasOpenDocument && documentSearchOpen) {
      setDocumentSearchOpen(false);
    }
  }, [documentSearchOpen, hasOpenDocument]);

  useEffect(() => {
    function handleDocumentSearchShortcut(event: KeyboardEvent) {
      const shortcutKey = event.key.toLowerCase();
      const isFindShortcut =
        shortcutKey === "f" &&
        !event.altKey &&
        !event.shiftKey &&
        ((event.metaKey && !event.ctrlKey) || (event.ctrlKey && !event.metaKey));

      if (isFindShortcut) {
        if (!hasOpenDocument || settingsViewOpen || duplicateFileDialog || dropboxDirectoryPicker) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openDocumentSearch(true);
        return;
      }

      if (event.key !== "Escape" || !documentSearchOpen) return;
      if (settingsViewOpen || duplicateFileDialog || dropboxDirectoryPicker) return;

      event.preventDefault();
      event.stopPropagation();
      closeDocumentSearch();
    }

    window.addEventListener("keydown", handleDocumentSearchShortcut, true);

    return () => {
      window.removeEventListener("keydown", handleDocumentSearchShortcut, true);
    };
  }, [
    documentSearchOpen,
    dropboxDirectoryPicker,
    duplicateFileDialog,
    hasOpenDocument,
    settingsViewOpen,
  ]);

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
      const isAppModeShortcut =
        event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey;

      if (isAppModeShortcut) {
        const shortcutKey = event.key.toLowerCase();
        if (shortcutKey === "n") {
          if (!annotationToolsAvailable) return;
          event.preventDefault();
          event.stopPropagation();
          toggleNoteMode();
          return;
        }

        if (shortcutKey === "g") {
          if (!annotationToolsAvailable) return;
          event.preventDefault();
          event.stopPropagation();
          if (noteModeEnabled) {
            toggleGlossaryMode();
          } else {
            setNoteModeEnabled(true);
            setGlossaryModeEnabled(true);
            setNoteLibraryOpen(false);
          }
          return;
        }

        if (shortcutKey === "l") {
          if (!annotationToolsAvailable) return;
          event.preventDefault();
          event.stopPropagation();
          if (noteModeEnabled) {
            toggleNoteLibrary();
          } else {
            setNoteModeEnabled(true);
            openNoteLibrary();
          }
          return;
        }
      }

      if (settingsViewOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSettingsView();
        }
        return;
      }

      if (duplicateFileDialog) {
        if (event.key === "Escape" && !duplicateFileDialog.isSubmitting) {
          event.preventDefault();
          setDuplicateFileDialog(null);
        }
        return;
      }

      if (dropboxDirectoryPicker) {
        if (event.key === "Escape" && !dropboxDirectoryPicker.isOpening) {
          event.preventDefault();
          setDropboxDirectoryPicker(null);
        }
        return;
      }

      if (event.key === "Escape" && (notePanelHasContentRef.current || pendingAnchor)) {
        event.preventDefault();
        closeNotePanel();
        return;
      }

      if (isPlainEnter && pendingAnchor && pendingAnchorIsGlossaryTerm) {
        if (targetIsFormControl(event.target)) return;

        event.preventDefault();
        startPendingGlossaryFlow();
        return;
      }

      if (isPlainEnter && pendingAnchorCanCreateNote) {
        if (targetIsFormControl(event.target)) return;

        event.preventDefault();
        confirmPendingSelectionNote();
        return;
      }

      if (noteEditModalActive) {
        if (isAnnotationNavigationTab && targetIsInsideEditingNoteMarkdownEditor(event.target)) {
          return;
        }

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
        if (isAnnotationNavigationTab && targetIsInsideEditingNoteMarkdownEditor(event.target)) {
          return;
        }

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

      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "/" && event.code !== "Slash") return;

      if (targetIsInsideNoteMarkdownEditor(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

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
    annotationToolsAvailable,
    closeNotePanel,
    duplicateFileDialog,
    dropboxDirectoryPicker,
    glossaryModeEnabled,
    glossaryNavigationSignature,
    noteLibraryOpen,
    noteLibrarySignature,
    noteEditModalActive,
    noteModeEnabled,
    notePanelModalActive,
    pendingAnchor,
    pendingAnchorCanCreateNote,
    pendingAnchorIsGlossaryTerm,
    settingsViewOpen,
  ]);

  function dirtyBackedDocumentExists(states = dirtyDocumentStatesRef.current) {
    return documentsRef.current.some((document) => {
      const hasBackingFile = Boolean(document.filePath) || documentIsFromDropbox(document);
      return hasBackingFile && hasDirtyState(states[document.id]);
    });
  }

  function scheduleAutosaveForDirtyDocuments(states = dirtyDocumentStatesRef.current) {
    window.clearTimeout(autosaveTimerRef.current);

    if (!nativeStorageAvailable) return;
    if (!dirtyBackedDocumentExists(states)) return;

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveDirtyDocuments();
    }, autosaveDelayMs);
  }

  function flushDirtyDocumentsAfterCurrentEvent() {
    if (!nativeStorageAvailable) return;

    window.setTimeout(() => {
      window.clearTimeout(autosaveTimerRef.current);
      void saveDirtyDocuments();
    }, 0);
  }

  function finishNoteEditorEditing(activeEditorKey: string) {
    setActiveNoteEditorKey((currentKey) =>
      currentKey === activeEditorKey ? "" : currentKey,
    );
    flushDirtyDocumentsAfterCurrentEvent();
  }

  function updateDocumentDirtyState(documentId: string, patch: Partial<DirtyDocumentState>) {
    const currentStates = dirtyDocumentStatesRef.current;
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

    dirtyDocumentStatesRef.current = nextStates;
    setDirtyDocumentStates(nextStates);
    scheduleAutosaveForDirtyDocuments(nextStates);
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

  function updateNotesState(updater: (currentNotes: SelectionNote[]) => SelectionNote[]) {
    const nextNotes = updater(notesRef.current);

    notesRef.current = nextNotes;
    setNotes(nextNotes);
    return nextNotes;
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

  function resetFileSearch() {
    setFileSearchQuery("");
    setLocalFileSearchResults([]);
    setFileSearchPending(false);
    setFileSearchError("");
  }

  function documentFromLoadedFile(loaded: OpenMarkdownFileResult): MarkdownDocument {
    return documentFromLoadedFileResult(loaded);
  }

  function localLoadedNoteFromFile(
    loadedFile: OpenMarkdownFileResult,
    note: SelectionNote,
  ): SelectionNote {
    const anchorSourceText = note.anchor.selectedText || note.selectedText;
    const anchor = recoverRenderableAnchor(loadedFile.body, {
      ...note.anchor,
      selectedText: anchorSourceText,
    });

    return {
      ...note,
      documentId: loadedFile.path,
      selectedText: note.selectedText || anchor.selectedText,
      anchor,
    };
  }

  function localLoadedGlossaryBindingFromFile(
    loadedFile: OpenMarkdownFileResult,
    binding: GlossaryBinding,
  ): GlossaryBinding {
    return {
      ...binding,
      documentId: loadedFile.path,
      anchor: recoverRenderableAnchor(loadedFile.body, binding.anchor),
    };
  }

  function mergeLoadedFilesIntoDocumentState(loadedFiles: OpenMarkdownFileResult[]) {
    if (loadedFiles.length === 0) return;

    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedDocumentIds = new Set(loadedDocuments.map((document) => document.id));
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => localLoadedNoteFromFile(loadedFile, note)),
    );
    const loadedGlossaryBindings = loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        localLoadedGlossaryBindingFromFile(loadedFile, binding),
      ),
    );
    const loadedGlossaryTerms = loadedFiles.flatMap(
      (loadedFile) => loadedFile.glossaryTerms ?? [],
    );

    setDocuments((currentDocuments) => [
      ...loadedDocuments,
      ...currentDocuments.filter((document) => !loadedDocumentIds.has(document.id)),
    ]);
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => !loadedDocumentIds.has(note.documentId)),
    ]);
    setGlossaryBindings((currentBindings) => [
      ...loadedGlossaryBindings,
      ...currentBindings.filter((binding) => !loadedDocumentIds.has(binding.documentId)),
    ]);
    setGlossaryTerms((currentTerms) => mergeGlossaryTerms(loadedGlossaryTerms, currentTerms));
    markLoadedDocumentsClean(loadedDocuments);
  }

  function mergeLoadedFilesIntoWorkspace(loadedFiles: OpenMarkdownFileResult[]) {
    if (loadedFiles.length === 0) return;

    mergeLoadedFilesIntoDocumentState(loadedFiles);
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
    options: { rememberRecent?: boolean; sortEntries?: boolean } = {},
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
      loadedFile.notes.map((note) => localLoadedNoteFromFile(loadedFile, note)),
    );
    const loadedGlossaryBindings = loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        localLoadedGlossaryBindingFromFile(loadedFile, binding),
      ),
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

      const nextEntries = [
        ...parentEntries,
        ...loadedDocuments.map(workspaceEntryFromDocument),
        ...otherEntries,
      ];

      return options.sortEntries ? sortWorkspaceEntriesForDirectory(nextEntries) : nextEntries;
    });
    setWorkspaceRootPath(parentDirectoryPath(firstDocument.filePath));
    setWorkspaceSource("local");
    resetFileSearch();
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
    rememberLastOpenedMarkdownRootDirectoryPath(parentDirectoryPath(firstDocument.filePath));
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

  function documentFromDropboxFile(loaded: OpenDropboxMarkdownFileResult): MarkdownDocument {
    return {
      id: dropboxDocumentId(loaded.path),
      title: loaded.title,
      path: loaded.path,
      filePath: null,
      notesPath: loaded.notesPath,
      updatedAt: loaded.serverModified ? `Dropbox ${loaded.serverModified}` : "Dropbox",
      body: loaded.body,
      dropboxRev: loaded.rev ?? null,
    };
  }

  function dropboxWorkspaceTitle(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
    return openedDirectory.path ? `Dropbox / ${openedDirectory.title}` : "Dropbox";
  }

  function applyOpenedDropboxDirectory(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();

    const nextEntries = workspaceEntriesFromOpenedDropboxDirectory(openedDirectory, 1);

    setDocuments([]);
    setNotes([]);
    setGlossaryBindings([]);
    setGlossaryTerms([]);
    setWorkspaceTitle(dropboxWorkspaceTitle(openedDirectory));
    setWorkspaceEntries(nextEntries);
    setWorkspaceRootPath(openedDirectory.path);
    setWorkspaceSource("dropbox");
    resetFileSearch();
    setExpandedDirectoryKeys(new Set());
    setLoadingDirectoryKeys(new Set());
    setSelectedWorkspaceDocumentIds(new Set());
    setMobileSelectedWorkspaceEntryKey("");
    setSelectedDocumentId("");
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
    setDirtyDocumentStates({});
    setSavedDocumentBodies({});
    forgetLastOpenedMarkdownPath();
    forgetLastOpenedMarkdownRootDirectoryPath();

    if (nextEntries.length === 0) {
      setStorageError(t("dropbox.emptyFolder"));
    } else {
      setStorageError("");
    }
  }

  function applyLoadedDropboxFile(loadedFile: OpenDropboxMarkdownFileResult) {
    const loadedDocument = documentFromDropboxFile(loadedFile);
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

    setDocuments((currentDocuments) => [
      loadedDocument,
      ...currentDocuments.filter((document) => document.id !== documentId),
    ]);
    setWorkspaceEntries((currentEntries) => {
      const fileEntry = workspaceEntryFromDocument(loadedDocument);

      return insertOrUpdateWorkspaceFileEntry(currentEntries, fileEntry, workspaceRootPath);
    });
    setNotes((currentNotes) => [
      ...loadedNotes,
      ...currentNotes.filter((note) => note.documentId !== documentId),
    ]);
    setGlossaryBindings((currentBindings) => [
      ...loadedGlossaryBindings,
      ...currentBindings.filter((binding) => binding.documentId !== documentId),
    ]);
    setGlossaryTerms((currentTerms) => mergeGlossaryTerms(loadedGlossaryTerms, currentTerms));
    setSelectedDocumentId(documentId);
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
    markLoadedDocumentsClean([loadedDocument]);
    forgetLastOpenedMarkdownPath();
    forgetLastOpenedMarkdownRootDirectoryPath();
  }

  function applyReloadedFile(loadedFile: OpenMarkdownFileResult) {
    const loadedDocument = documentFromLoadedFile(loadedFile);
    const documentId = loadedDocument.id;
    const loadedNotes = loadedFile.notes.map((note) =>
      localLoadedNoteFromFile(loadedFile, note),
    );
    const loadedGlossaryBindings = (loadedFile.glossaryBindings ?? []).map((binding) =>
      localLoadedGlossaryBindingFromFile(loadedFile, binding),
    );
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
    if (externalFileRefreshInFlightRef.current) return;

    const documentId = selectedDocumentIdRef.current;
    if (!documentId) return;
    if (hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;

    const documentToRefresh = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToRefresh?.filePath) return;

    externalFileRefreshInFlightRef.current = true;
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
    } finally {
      externalFileRefreshInFlightRef.current = false;
    }
  }

  function applyOpenedDirectory(
    openedDirectory: OpenMarkdownDirectoryResult,
    selectedPath?: string,
    options: {
      rememberRecent?: boolean;
      rememberSelection?: boolean;
      selectFallback?: boolean;
    } = {},
  ) {
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();
    setSelectedWorkspaceDocumentIds(new Set());
    setMobileSelectedWorkspaceEntryKey("");

    const loadedFiles = openedDirectory.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : [],
    );
    const loadedDocuments = loadedFiles.map(documentFromLoadedFile);
    const loadedNotes = loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) => localLoadedNoteFromFile(loadedFile, note)),
    );
    const loadedGlossaryBindings = loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        localLoadedGlossaryBindingFromFile(loadedFile, binding),
      ),
    );
    const loadedGlossaryTerms = loadedFiles.flatMap(
      (loadedFile) => loadedFile.glossaryTerms ?? [],
    );
    const nextEntries = workspaceEntriesFromOpenedDirectory(openedDirectory, 1);
    const firstDocument = loadedDocuments[0];
    const selectedDocument = selectedPath
      ? loadedDocuments.find((document) => document.id === selectedPath)
      : firstDocument;
    const documentToSelect =
      selectedDocument ?? (options.selectFallback === false ? null : firstDocument);

    setDocuments(loadedDocuments);
    setNotes(loadedNotes);
    setGlossaryBindings(loadedGlossaryBindings);
    setGlossaryTerms(mergeGlossaryTerms(loadedGlossaryTerms, []));
    setWorkspaceTitle(openedDirectory.title);
    setWorkspaceEntries(nextEntries);
    setWorkspaceRootPath(openedDirectory.path);
    setWorkspaceSource("local");
    resetFileSearch();
    setExpandedDirectoryKeys(new Set());
    setLoadingDirectoryKeys(new Set());
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    markLoadedDocumentsClean(loadedDocuments);
    rememberLastOpenedMarkdownRootDirectoryPath(openedDirectory.path);

    if (documentToSelect) {
      setSelectedDocumentId(documentToSelect.id);
      if (options.rememberSelection !== false) {
        rememberLastOpenedMarkdownPath(documentToSelect.filePath);
      }
    } else {
      setSelectedDocumentId("");
      if (options.rememberSelection !== false) {
        forgetLastOpenedMarkdownPath();
      }
    }
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");

    if (nextEntries.length === 0) {
      setStorageError(t("status.noFoldersOrMarkdown"));
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

  async function restoreLastOpenedMarkdownWorkspace(
    rootDirectoryPath: string,
    selectedPath: string,
  ) {
    const openedDirectory = await invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", {
      path: rootDirectoryPath,
    });
    const rootLoadedFiles = openedDirectory.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : [],
    );
    const selectedIsRootEntry = rootLoadedFiles.some((file) =>
      localPathsMatch(file.path, selectedPath),
    );
    const ancestorPaths =
      selectedPath && !selectedIsRootEntry
        ? ancestorDirectoryPathsForFile(rootDirectoryPath, selectedPath)
        : [];

    if (selectedPath && !selectedIsRootEntry && ancestorPaths.length === 0) {
      throw new Error("last opened file is outside the saved root directory");
    }

    applyOpenedDirectory(openedDirectory, selectedIsRootEntry ? selectedPath : undefined, {
      rememberRecent: false,
      rememberSelection: false,
      selectFallback: !selectedPath || selectedIsRootEntry,
    });

    if (!selectedPath) return;

    if (selectedIsRootEntry) {
      rememberLastOpenedMarkdownPath(selectedPath);
      return;
    }

    let nextEntries = workspaceEntriesFromOpenedDirectory(openedDirectory, 1);
    const nextExpandedDirectoryKeys = new Set<string>();
    const loadedDescendantFiles: OpenMarkdownFileResult[] = [];

    for (const ancestorPath of ancestorPaths) {
      const ancestorEntry = nextEntries.find(
        (entry): entry is Extract<WorkspaceEntry, { kind: "directory" }> =>
          entry.kind === "directory" && localPathsMatch(entry.path, ancestorPath),
      );
      if (!ancestorEntry) {
        throw new Error("last opened file ancestor is not visible from the saved root directory");
      }

      const openedAncestorDirectory = await invoke<OpenMarkdownDirectoryResult>(
        "open_markdown_directory",
        { path: ancestorEntry.path },
      );
      const childDepth = (ancestorEntry.depth ?? 1) + 1;
      const childEntries = workspaceEntriesFromOpenedDirectory(
        openedAncestorDirectory,
        childDepth,
      );

      loadedDescendantFiles.push(
        ...openedAncestorDirectory.entries.flatMap((entry) =>
          entry.kind === "file" ? [entry.file] : [],
        ),
      );
      nextEntries = insertWorkspaceDirectoryChildren(nextEntries, ancestorEntry, childEntries);
      nextExpandedDirectoryKeys.add(directoryTreeKey(ancestorEntry));
    }

    const selectedFile = loadedDescendantFiles.find((file) =>
      localPathsMatch(file.path, selectedPath),
    );
    if (!selectedFile) {
      throw new Error("last opened file was not found in the restored directory tree");
    }

    mergeLoadedFilesIntoDocumentState(loadedDescendantFiles);
    setWorkspaceEntries(nextEntries);
    setExpandedDirectoryKeys(nextExpandedDirectoryKeys);
    setSelectedDocumentId(selectedFile.path);
    rememberLastOpenedMarkdownPath(selectedFile.path);
  }

  async function openDirectoryPath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError(t("status.openingFolder"));

    try {
      const openedDirectory = await invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", {
        path,
      });
      applyOpenedDirectory(openedDirectory);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openDropboxMarkdownFilePath(
    path: string,
    options: { allowPendingConnection?: boolean } = {},
  ) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (!dropboxConnected && !options.allowPendingConnection) {
      setStorageError(t("dropbox.error.notConnected"));
      return;
    }

    setStorageError(t("dropbox.status.openingFile"));

    try {
      const loaded = await invoke<OpenDropboxMarkdownFileResult>("open_dropbox_markdown_file", {
        path,
      });
      applyLoadedDropboxFile(loaded);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function dropboxErrorNeedsAuthorization(message: string) {
    return (
      message.includes("Dropbox authorization failed") ||
      message.includes("Dropbox session expired") ||
      message.includes("Dropbox permission is missing")
    );
  }

  async function openDropboxCloudSource(options: { allowPendingConnection?: boolean } = {}) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (dropboxConnecting) return;

    setFileContextMenu(null);
    if (!duplicateFileDialog?.isSubmitting) {
      setDuplicateFileDialog(null);
    }
    setDropboxDirectoryPicker({
      directories: [],
      selectedPath: "",
      isLoadingRoot: true,
      isOpening: false,
      error: "",
    });
    setStorageError(t("dropbox.status.loadingRoot"));

    try {
      const status = await invoke<DropboxOAuthStatusResult>("dropbox_oauth_status");
      setDropboxConnected(status.connected);

      if (!status.connected && !options.allowPendingConnection) {
        setDropboxDirectoryPicker(null);
        dropboxOpenAfterAuthRef.current = false;
        openSettingsView("cloud");
        return;
      }
      if (!status.connected && options.allowPendingConnection) {
        throw new Error(t("dropbox.error.notConnected"));
      }

      await loadDropboxDirectoryPickerRoot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message)) {
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        return;
      }

      setDropboxDirectoryPicker({
        directories: [],
        selectedPath: "",
        isLoadingRoot: false,
        isOpening: false,
        error: message,
      });
      setStorageError(message);
    }
  }

  async function loadDropboxDirectoryPickerRoot() {
    setDropboxDirectoryPicker((currentPicker) =>
      currentPicker
        ? {
            ...currentPicker,
            isLoadingRoot: true,
            isOpening: false,
            error: "",
          }
        : currentPicker,
    );
    setStorageError(t("dropbox.status.loadingRoot"));

    try {
      const openedDirectory = await invoke<OpenDropboxMarkdownDirectoryResult>(
        "list_dropbox_markdown_directory",
        { path: "" },
      );
      const directories = dropboxPickerNodesFromOpenedDirectory(openedDirectory);
      const selectedPath = directories[0]?.path || "";

      setDropboxDirectoryPicker({
        directories,
        selectedPath,
        isLoadingRoot: false,
        isOpening: false,
        error: directories.length > 0 ? "" : t("dropbox.picker.empty"),
      });
      setStorageError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message)) {
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        setStorageError(message);
        return;
      }

      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              isLoadingRoot: false,
              isOpening: false,
              error: message,
            }
          : currentPicker,
      );
      setStorageError(message);
    }
  }

  function closeDropboxDirectoryPicker() {
    if (dropboxDirectoryPicker?.isOpening) return;

    setDropboxDirectoryPicker(null);
    setStorageError("");
  }

  function handleDropboxDirectoryBackdropWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDropboxDirectoryListWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  async function toggleDropboxPickerDirectory(path: string) {
    const picker = dropboxDirectoryPicker;
    if (!picker || picker.isLoadingRoot || picker.isOpening) return;

    const directory = flattenDropboxDirectoryPickerNodes(picker.directories).find(
      ({ node }) => node.path === path,
    )?.node;
    if (!directory || directory.isLoading) return;

    if (directory.isExpanded) {
      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              directories: updateDropboxDirectoryPickerNode(
                currentPicker.directories,
                path,
                (node) => ({
                  ...node,
                  isExpanded: false,
                }),
              ),
            }
          : currentPicker,
      );
      return;
    }

    if (directory.isLoaded) {
      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              directories: updateDropboxDirectoryPickerNode(
                currentPicker.directories,
                path,
                (node) => ({
                  ...node,
                  isExpanded: true,
                  error: "",
                }),
              ),
            }
          : currentPicker,
      );
      return;
    }

    setDropboxDirectoryPicker((currentPicker) =>
      currentPicker
        ? {
            ...currentPicker,
            directories: updateDropboxDirectoryPickerNode(
              currentPicker.directories,
              path,
              (node) => ({
                ...node,
                isExpanded: true,
                isLoading: true,
                error: "",
              }),
            ),
          }
        : currentPicker,
    );
    setStorageError(t("dropbox.status.loadingRoot"));

    try {
      const openedDirectory = await invoke<OpenDropboxMarkdownDirectoryResult>(
        "list_dropbox_markdown_directory",
        { path },
      );
      const childDirectories = dropboxPickerNodesFromOpenedDirectory(openedDirectory);

      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              directories: updateDropboxDirectoryPickerNode(
                currentPicker.directories,
                path,
                (node) => ({
                  ...node,
                  children: childDirectories,
                  isExpanded: true,
                  isLoaded: true,
                  isLoading: false,
                  error: childDirectories.length > 0 ? "" : t("dropbox.picker.emptyNested"),
                }),
              ),
            }
          : currentPicker,
      );
      setStorageError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message)) {
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        setStorageError(message);
        return;
      }

      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              directories: updateDropboxDirectoryPickerNode(
                currentPicker.directories,
                path,
                (node) => ({
                  ...node,
                  isExpanded: true,
                  isLoading: false,
                  error: message,
                }),
              ),
            }
          : currentPicker,
      );
      setStorageError(message);
    }
  }

  async function openSelectedDropboxDirectory(pathOverride?: string) {
    const picker = dropboxDirectoryPicker;
    const selectedPath = pathOverride ?? picker?.selectedPath;
    if (!selectedPath || !picker || picker.isLoadingRoot || picker.isOpening) {
      return;
    }

    setDropboxDirectoryPicker((currentPicker) =>
      currentPicker ? { ...currentPicker, isOpening: true, error: "" } : currentPicker,
    );
    setStorageError(t("dropbox.status.openingFolder"));

    try {
      const openedDirectory = await invoke<OpenDropboxMarkdownDirectoryResult>(
        "list_dropbox_markdown_directory",
        { path: selectedPath },
      );
      applyOpenedDropboxDirectory(openedDirectory);
      setDropboxDirectoryPicker(null);
      const firstFile = firstDropboxMarkdownFileEntry(openedDirectory);
      if (firstFile) {
        await openDropboxMarkdownFilePath(firstFile.path);
        return;
      }

      setStorageError(openedDirectory.entries.length === 0 ? t("dropbox.emptyFolder") : "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              isOpening: false,
              error: message,
            }
          : currentPicker,
      );
      setStorageError(message);
    }
  }

  function toggleWorkspaceExportSelection(documentId: string) {
    setSelectedWorkspaceDocumentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      const activeDocumentId = selectedDocument.id;
      const activeDocumentIsInWorkspace = workspaceEntries.some(
        (workspaceEntry) =>
          workspaceEntry.kind === "file" && workspaceEntry.documentId === activeDocumentId,
      );

      if (
        nextIds.size === 0 &&
        activeDocumentIsInWorkspace &&
        documentId !== activeDocumentId
      ) {
        nextIds.add(activeDocumentId);
      }

      if (nextIds.has(documentId)) {
        nextIds.delete(documentId);
      } else {
        nextIds.add(documentId);
      }

      if (nextIds.size === 1 && nextIds.has(activeDocumentId)) {
        return new Set();
      }

      return nextIds;
    });
  }

  function openWorkspaceEntry(entry: WorkspaceEntry, event?: MouseEvent<HTMLButtonElement>) {
    if (ignoreNextWorkspaceClickRef.current) {
      ignoreNextWorkspaceClickRef.current = false;
      return;
    }

    if (isMobileViewport && (entry.kind === "directory" || entry.kind === "file")) {
      const entryKey = workspaceEntrySelectionKey(entry);
      const entryIsCurrentDocument =
        entry.kind === "file" && entry.documentId === selectedDocumentIdRef.current;

      if (!entryIsCurrentDocument && mobileSelectedWorkspaceEntryKey !== entryKey) {
        setSelectedWorkspaceDocumentIds(new Set());
        setMobileSelectedWorkspaceEntryKey(entryKey);
        return;
      }
    }

    if (entry.kind === "directory") {
      setSelectedWorkspaceDocumentIds(new Set());
      setMobileSelectedWorkspaceEntryKey("");
      void toggleWorkspaceDirectory(entry);
      return;
    }

    if (entry.kind !== "file") return;

    if (event?.metaKey || event?.ctrlKey) {
      toggleWorkspaceExportSelection(entry.documentId);
      return;
    }

    setSelectedWorkspaceDocumentIds(new Set());
    setMobileSelectedWorkspaceEntryKey("");

    if (entry.source === "dropbox") {
      const loadedDocument = documents.find((document) => document.id === entry.documentId);
      if (loadedDocument) {
        selectDocument(entry.documentId);
      } else {
        void openDropboxMarkdownFilePath(entry.path);
      }
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
      return;
    }

    selectDocument(entry.documentId);
    if (isMobileViewport) {
      setDirectoryPaneOpen(false);
    }
  }

  function workspaceExportDocumentIdsForContext(entry: Extract<WorkspaceEntry, { kind: "file" }>) {
    if (!selectedWorkspaceDocumentIds.has(entry.documentId)) {
      return [entry.documentId];
    }

    const orderedSelectedIds = workspaceEntries
      .filter(
        (workspaceEntry): workspaceEntry is Extract<WorkspaceEntry, { kind: "file" }> =>
          workspaceEntry.kind === "file" &&
          selectedWorkspaceDocumentIds.has(workspaceEntry.documentId),
      )
      .map((workspaceEntry) => workspaceEntry.documentId);

    return orderedSelectedIds.length > 0 ? orderedSelectedIds : [entry.documentId];
  }

  function openFileContextMenu(
    entry: Extract<WorkspaceEntry, { kind: "file" }>,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (event.ctrlKey && event.button === 0) {
      ignoreNextWorkspaceClickRef.current = true;
      toggleWorkspaceExportSelection(entry.documentId);
      return;
    }

    const exportDocumentIds = workspaceExportDocumentIdsForContext(entry);
    setSelectedWorkspaceDocumentIds(new Set(exportDocumentIds));
    setFileContextMenu({
      documentId: entry.documentId,
      exportDocumentIds,
      path: entry.path,
      title: entry.title,
      source: entry.source,
      left: event.clientX,
      top: event.clientY,
    });
  }

  async function openLocalFileSearchResult(result: SearchMarkdownFileResult) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    const loadedDocument = documentsRef.current.find((document) => document.id === result.path);
    if (loadedDocument) {
      setMobileSelectedWorkspaceEntryKey("");
      selectDocument(loadedDocument.id);
      setStorageError("");
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
      return;
    }

    setStorageError(t("status.openingFile"));

    try {
      const loaded = await invoke<OpenMarkdownFileResult>("open_markdown_file", {
        path: result.path,
      });
      mergeLoadedFilesIntoDocumentState([loaded]);
      setMobileSelectedWorkspaceEntryKey("");
      setSelectedDocumentId(loaded.path);
      rememberLastOpenedMarkdownPath(loaded.path);
      setStorageError("");
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleWorkspaceDirectory(entry: WorkspaceEntry) {
    if (entry.kind !== "directory") return;

    const entryKey = directoryTreeKey(entry);
    if (loadingDirectoryKeys.has(entryKey)) return;

    if (expandedDirectoryKeys.has(entryKey)) {
      const descendantKeys = collectVisibleDescendantDirectoryKeys(workspaceEntries, entry);
      setWorkspaceEntries((currentEntries) => collapseWorkspaceDirectory(currentEntries, entry));
      setExpandedDirectoryKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(entryKey);
        descendantKeys.forEach((key) => nextKeys.delete(key));
        return nextKeys;
      });
      setStorageError("");
      return;
    }

    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    if (entry.source === "dropbox" && !dropboxConnected) {
      setStorageError(t("dropbox.error.notConnected"));
      return;
    }

    setLoadingDirectoryKeys((currentKeys) => new Set(currentKeys).add(entryKey));
    setStorageError(entry.source === "dropbox" ? t("dropbox.status.openingFolder") : t("status.openingFolder"));

    try {
      const childDepth = (entry.depth ?? 1) + 1;
      let childEntries: WorkspaceEntry[];

      if (entry.source === "dropbox") {
        const openedDirectory = await invoke<OpenDropboxMarkdownDirectoryResult>(
          "list_dropbox_markdown_directory",
          { path: entry.path },
        );
        childEntries = workspaceEntriesFromOpenedDropboxDirectory(openedDirectory, childDepth);
      } else {
        const openedDirectory = await invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", {
          path: entry.path,
        });
        const loadedFiles = openedDirectory.entries.flatMap((childEntry) =>
          childEntry.kind === "file" ? [childEntry.file] : [],
        );
        mergeLoadedFilesIntoWorkspace(loadedFiles);
        childEntries = workspaceEntriesFromOpenedDirectory(openedDirectory, childDepth);
      }

      if (childEntries.length === 0) {
        setStorageError(
          entry.source === "dropbox" ? t("dropbox.emptyFolder") : t("status.noFoldersOrMarkdown"),
        );
        return;
      }

      setWorkspaceEntries((currentEntries) =>
        insertWorkspaceDirectoryChildren(currentEntries, entry, childEntries),
      );
      setExpandedDirectoryKeys((currentKeys) => new Set(currentKeys).add(entryKey));
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDirectoryKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(entryKey);
        return nextKeys;
      });
    }
  }

  async function openMarkdownFilePath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError(t("status.openingFile"));

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
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError("");

    try {
      const selectedPath = await openDialog({
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
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError(t("status.openingFile"));

    try {
      const selectedPath = await openDialog({
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

  function documentCanExportToPdf(documentToExport: MarkdownDocument) {
    if (autosaveInFlightRef.current) {
      setStorageError(t("pdfExport.error.waitForAutosave"));
      return false;
    }

    if (hasDirtyState(dirtyDocumentStatesRef.current[documentToExport.id])) {
      setStorageError(t("pdfExport.error.saveBeforeExport"));
      return false;
    }

    return true;
  }

  function documentsForDocumentIds(documentIds: string[]) {
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const orderedDocuments: MarkdownDocument[] = [];
    const seenDocumentIds = new Set<string>();

    documentIds.forEach((documentId) => {
      if (seenDocumentIds.has(documentId)) return;

      const documentToExport = documentsById.get(documentId);
      if (!documentToExport) return;

      orderedDocuments.push(documentToExport);
      seenDocumentIds.add(documentId);
    });

    return orderedDocuments;
  }

  function pdfOutputDirectoryForDocument(documentToExport: MarkdownDocument) {
    return parentDirectoryPath(documentToExport.filePath);
  }

  async function writeDocumentPdfToDirectory(
    documentToExport: MarkdownDocument,
    directory: string,
  ) {
    const dataBase64 = await renderMarkdownDocumentToPdfBase64(documentToExport);

    return invoke<WritePdfFileResult>("write_pdf_file_to_directory", {
      directory,
      fileName: pdfFileNameForDocument(documentToExport),
      dataBase64,
    });
  }

  async function exportDocumentsAsPdf(documentsToExport: MarkdownDocument[]) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (documentsToExport.length === 0) {
      setStorageError(t("pdfExport.error.noDocument"));
      return;
    }
    if (autosaveInFlightRef.current) {
      setStorageError(t("pdfExport.error.waitForAutosave"));
      return;
    }

    const dirtyDocument = documentsToExport.find((documentToExport) =>
      hasDirtyState(dirtyDocumentStatesRef.current[documentToExport.id]),
    );
    if (dirtyDocument) {
      setStorageError(t("pdfExport.error.saveBeforeExport"));
      return;
    }

    if (documentsToExport.length === 1) {
      const documentToExport = documentsToExport[0];
      if (!documentCanExportToPdf(documentToExport)) return;
      const outputDirectory = pdfOutputDirectoryForDocument(documentToExport);

      try {
        setStorageError(t("pdfExport.status.renderingCurrent"));
        let saved: WritePdfFileResult;

        if (outputDirectory) {
          saved = await writeDocumentPdfToDirectory(documentToExport, outputDirectory);
        } else {
          const selectedPath = await save({
            defaultPath: pdfFileNameForDocument(documentToExport),
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!selectedPath) return;

          const dataBase64 = await renderMarkdownDocumentToPdfBase64(documentToExport);
          saved = await invoke<WritePdfFileResult>("write_pdf_file", {
            path: selectedPath,
            dataBase64,
          });
        }

        setStorageError(t("pdfExport.status.saved", { path: saved.path }));
      } catch (error) {
        setStorageError(
          t("pdfExport.error.renderFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    try {
      const outputDirectories = documentsToExport.map(pdfOutputDirectoryForDocument);
      const allDocumentsHaveOutputDirectories = outputDirectories.every(Boolean);
      let selectedPath = "";

      if (!allDocumentsHaveOutputDirectories) {
        const pickedPath = await openDialog({
          directory: true,
          multiple: false,
          title: t("pdfExport.dialog.chooseFolder"),
        });
        if (!pickedPath || Array.isArray(pickedPath)) return;

        selectedPath = pickedPath;
      }

      const writtenPaths: string[] = [];
      for (const [index, documentToExport] of documentsToExport.entries()) {
        setStorageError(
          t("pdfExport.status.renderingBatch", {
            current: index + 1,
            total: documentsToExport.length,
          }),
        );

        const outputDirectory = outputDirectories[index] || selectedPath;
        const saved = await writeDocumentPdfToDirectory(documentToExport, outputDirectory);
        writtenPaths.push(saved.path);
      }

      setStorageError(
        selectedPath
          ? t("pdfExport.status.batchSaved", {
              count: writtenPaths.length,
              directory: selectedPath,
            })
          : t("pdfExport.status.batchSavedToCurrentDirectories", {
              count: writtenPaths.length,
            }),
      );
    } catch (error) {
      setStorageError(
        t("pdfExport.error.renderFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async function newMarkdownFile() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError("");

    try {
      if (workspaceSource === "dropbox") {
        if (!workspaceRootPath) {
          setStorageError(t("dropbox.error.noWorkspace"));
          return;
        }

        const fileName = window.prompt(t("newFile.namePrompt"), t("app.untitledFile"));
        if (fileName === null) return;

        const trimmedFileName = fileName.trim();
        if (!trimmedFileName) {
          setStorageError(t("error.fileNameRequired"));
          return;
        }

        const loaded = await invoke<OpenDropboxMarkdownFileResult>(
          "create_dropbox_markdown_file",
          {
            parentPath: workspaceRootPath,
            fileName: trimmedFileName,
          },
        );
        applyLoadedDropboxFile(loaded);
        setEditorMode("edit");
        setStorageError("");
        return;
      }

      const defaultFileName = t("app.untitledFile");
      const selectedPath = await save({
        defaultPath:
          workspaceSource === "local" && workspaceRootPath
            ? filePathInDirectory(workspaceRootPath, defaultFileName)
            : defaultFileName,
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
    const nextDirtyStatesFrom = (currentStates: DirtyDocumentStates) => {
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
    };

    const nextDirtyStates = nextDirtyStatesFrom(dirtyDocumentStatesRef.current);
    dirtyDocumentStatesRef.current = nextDirtyStates;
    setDirtyDocumentStates(nextDirtyStates);
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
        t("error.externalFileChanged"),
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

  async function saveDocumentToDropbox(documentToSave: MarkdownDocument) {
    if (!documentIsFromDropbox(documentToSave)) return;

    const bodyToSave = documentToSave.body;
    const notesToSave = notesForDocument(documentToSave.id);
    const glossaryBindingsToSave = glossaryBindingsForDocument(documentToSave.id);
    const glossaryTermsToSave = glossaryTermsForDocument(documentToSave.id);
    const savedSidecarFingerprint = sidecarFingerprint(
      notesToSave,
      glossaryTermsToSave,
      glossaryBindingsToSave,
    );
    const saved = await invoke<OpenDropboxMarkdownFileResult>("save_dropbox_markdown_file", {
      path: documentToSave.path,
      body: bodyToSave,
      rev: documentToSave.dropboxRev ?? null,
      notes: notesToSave,
      glossaryTerms: glossaryTermsToSave,
      glossaryBindings: glossaryBindingsToSave,
    });

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === documentToSave.id
          ? {
              ...document,
              title: saved.title,
              path: saved.path,
              notesPath: saved.notesPath,
              updatedAt: saved.serverModified
                ? `Dropbox ${saved.serverModified}`
                : `Saved ${nowLabel()}`,
              dropboxRev: saved.rev ?? null,
            }
          : document,
      ),
    );
    setWorkspaceEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.kind === "file" && entry.documentId === documentToSave.id
          ? {
              ...entry,
              title: saved.title,
              path: saved.path,
              id: `dropbox-file:${saved.path}`,
            }
          : entry,
      ),
    );
    markDocumentSnapshotSaved(documentToSave.id, bodyToSave, savedSidecarFingerprint);
  }

  async function saveDocument(documentToSave: MarkdownDocument) {
    if (documentIsFromDropbox(documentToSave)) {
      await saveDocumentToDropbox(documentToSave);
      return;
    }

    await saveDocumentToDisk(documentToSave);
  }

  async function saveDirtyDocuments() {
    if (!nativeStorageAvailable) return;

    if (autosaveInFlightRef.current) {
      autosaveRequestedWhileSavingRef.current = true;
      return;
    }

    const dirtyDocuments = documentsRef.current.filter((document) => {
      const hasBackingFile = Boolean(document.filePath) || documentIsFromDropbox(document);
      return hasBackingFile && hasDirtyState(dirtyDocumentStatesRef.current[document.id]);
    });
    if (dirtyDocuments.length === 0) return;

    autosaveInFlightRef.current = true;
    setStorageError("");

    try {
      for (const documentToSave of dirtyDocuments) {
        await saveDocument(documentToSave);
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

  function defaultDuplicateFileName(
    fileToDuplicate: Pick<MarkdownDocument, "filePath" | "path" | "title">,
  ) {
    const fileName = fileNameFromPath(fileToDuplicate.filePath ?? fileToDuplicate.path);
    const duplicateSuffix = t("duplicate.suffix");
    const fallbackName = `${stripMarkdownExtension(fileToDuplicate.title || t("app.untitled"))} ${duplicateSuffix}`;
    if (!fileName) return fallbackName;

    const fileNameWithoutExtension = stripMarkdownExtension(fileName);
    if (!fileNameWithoutExtension) return fallbackName;

    return `${fileNameWithoutExtension} ${duplicateSuffix}`;
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

  function removeDocumentsFromWorkspace(documentIds: Iterable<string>) {
    const documentIdSet = new Set(documentIds);
    if (documentIdSet.size === 0) return;

    const nextDocuments = documentsRef.current.filter((document) => !documentIdSet.has(document.id));
    const nextNotes = notesRef.current.filter((note) => !documentIdSet.has(note.documentId));
    const nextGlossaryBindings = glossaryBindingsRef.current.filter(
      (binding) => !documentIdSet.has(binding.documentId),
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
    documentIdSet.forEach((documentId) => {
      delete nextDirtyDocumentStates[documentId];
    });

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    glossaryTermsRef.current = nextGlossaryTerms;
    dirtyDocumentStatesRef.current = nextDirtyDocumentStates;

    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    const nextWorkspaceEntries = workspaceEntriesRef.current.filter(
      (entry) => entry.kind !== "file" || !documentIdSet.has(entry.documentId),
    );
    workspaceEntriesRef.current = nextWorkspaceEntries;
    setDocuments(nextDocuments);
    setWorkspaceEntries(nextWorkspaceEntries);
    setNotes(nextNotes);
    setGlossaryBindings(nextGlossaryBindings);
    setGlossaryTerms(nextGlossaryTerms);
    setDirtyDocumentStates(nextDirtyDocumentStates);
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies = { ...currentBodies };
      documentIdSet.forEach((documentId) => {
        delete nextBodies[documentId];
      });
      return nextBodies;
    });
    setSelectedWorkspaceDocumentIds(new Set());
    setMobileSelectedWorkspaceEntryKey("");
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
    setNotePanelExpanded(false);
    setExpandedLibraryNoteId("");
    setFloatingNotePanelPosition(null);
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = false;

    if (documentIdSet.has(selectedDocumentIdRef.current)) {
      const nextSelectedDocument = nextDocuments[0] ?? null;
      const nextSelectedDocumentId = nextSelectedDocument?.id ?? "";
      selectedDocumentIdRef.current = nextSelectedDocumentId;
      setSelectedDocumentId(nextSelectedDocumentId);
      if (nextSelectedDocument?.filePath) {
        rememberLastOpenedMarkdownPath(nextSelectedDocument.filePath);
      } else {
        forgetLastOpenedMarkdownPath();
      }
    }
  }

  function openSettingsView(category: SettingCategory = "app") {
    setFileContextMenu(null);
    if (!duplicateFileDialog?.isSubmitting) {
      setDuplicateFileDialog(null);
    }
    setSettingsInitialCategory(category);
    setStorageError("");
    setSettingsViewOpen(true);
  }

  function closeSettingsView() {
    setSettingsViewOpen(false);
  }

  function recordFullscreenDirectoryPaneManualValue(nextValue: boolean) {
    if (!windowIsFullscreenRef.current) return;

    directoryPaneToggledInFullscreenRef.current = true;
    directoryPaneClosedInFullscreenRef.current = !nextValue;
  }

  function applySettingRuntimeValue(key: SettingKey, value: SettingValue) {
    if (key === "app.directoryPaneOpen" && typeof value === "boolean") {
      recordFullscreenDirectoryPaneManualValue(value);
      setDirectoryPaneOpen(value);
      return;
    }

    if (key === "app.noteModeEnabledByDefault" && typeof value === "boolean") {
      const shouldEnableNoteMode = value && documentsRef.current.length > 0;
      noteModeDefaultAppliedRef.current = shouldEnableNoteMode;
      setNoteModeEnabled(shouldEnableNoteMode);
      return;
    }

  }

  function updateSettingValue(key: SettingKey, value: SettingValue) {
    const nextValue = writeSetting(key, value);

    setSettingsSnapshot(
      (currentSettings) =>
        ({
          ...currentSettings,
          [key]: nextValue,
        }) as SettingsSnapshot,
    );
    applySettingRuntimeValue(key, nextValue);
  }

  function resetSettingValue(key: SettingKey) {
    const nextValue = resetSetting(key);

    setSettingsSnapshot(
      (currentSettings) =>
        ({
          ...currentSettings,
          [key]: nextValue,
        }) as SettingsSnapshot,
    );
    applySettingRuntimeValue(key, nextValue);
  }

  function resetAllSettingValues() {
    const nextSettings = resetSettings();

    setSettingsSnapshot(nextSettings);
    setDirectoryPaneOpen(nextSettings["app.directoryPaneOpen"]);
    applySettingRuntimeValue(
      "app.noteModeEnabledByDefault",
      nextSettings["app.noteModeEnabledByDefault"],
    );
  }

  async function refreshDropboxOAuthStatus() {
    if (!nativeStorageAvailable) return;

    try {
      const status = await invoke<DropboxOAuthStatusResult>("dropbox_oauth_status");
      setDropboxConnected(status.connected);
    } catch (error) {
      setDropboxConnected(false);
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function resetDropboxWorkspaceAfterAuthorizationRemoval() {
    if (workspaceSource !== "dropbox") return;

    setDocuments(documentsSeed);
    setNotes(notesSeed);
    setGlossaryTerms(glossaryTermsSeed);
    setGlossaryBindings(glossaryBindingsSeed);
    setWorkspaceTitle("Scholium");
    setWorkspaceEntries(documentsSeed.map(workspaceEntryFromDocument));
    setWorkspaceRootPath(null);
    setWorkspaceSource(null);
    resetFileSearch();
    setExpandedDirectoryKeys(new Set());
    setLoadingDirectoryKeys(new Set());
    setSelectedWorkspaceDocumentIds(new Set());
    setSelectedDocumentId(documentsSeed[0]?.id ?? "");
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
    setDirtyDocumentStates({});
    setSavedDocumentBodies(savedBodiesFromDocuments(documentsSeed));
    forgetLastOpenedMarkdownPath();
    forgetLastOpenedMarkdownRootDirectoryPath();
  }

  async function connectDropbox(
    options: { openDirectoryPickerAfterAuth?: boolean } = {},
  ) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    if (!configuredDropboxAppKey) {
      dropboxOpenAfterAuthRef.current = false;
      setStorageError(t("dropbox.error.notConfigured"));
      return;
    }

    dropboxOpenAfterAuthRef.current = Boolean(options.openDirectoryPickerAfterAuth);
    setDropboxConnecting(true);
    setStorageError(t("dropbox.status.openingAuth"));

    try {
      const oauthStart = await invoke<StartDropboxOAuthResult>("start_dropbox_oauth", {
        appKey: configuredDropboxAppKey,
      });
      await openExternalUrl(oauthStart.authUrl);
    } catch (error) {
      setDropboxConnecting(false);
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function completeDropboxOAuth(payload: DropboxOAuthCallbackPayload) {
    if (payload.status !== "success" || !payload.code || !payload.state) {
      setDropboxConnecting(false);
      dropboxOpenAfterAuthRef.current = false;
      setStorageError(
        t("dropbox.error.oauthCallback", {
          message: payload.error ?? "unknown error",
        }),
      );
      return;
    }

    setStorageError(t("dropbox.status.completingAuth"));

    try {
      const status = await invoke<DropboxOAuthStatusResult>("complete_dropbox_oauth", {
        code: payload.code,
        state: payload.state,
      });
      setDropboxConnected(status.connected);
      setDropboxConnecting(false);
      const shouldOpenDirectoryPicker = dropboxOpenAfterAuthRef.current;
      dropboxOpenAfterAuthRef.current = false;
      if (shouldOpenDirectoryPicker) {
        await openDropboxCloudSource({ allowPendingConnection: status.connected });
      } else {
        setStorageError("");
      }
    } catch (error) {
      setDropboxConnecting(false);
      setDropboxConnected(false);
      dropboxOpenAfterAuthRef.current = false;
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeDropboxAuthorization() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    if (autosaveInFlightRef.current) {
      setStorageError(t("dropbox.error.waitForAutosaveBeforeDisconnect"));
      return;
    }

    const hasDirtyDropboxDocument = documentsRef.current.some(
      (document) =>
        documentIsFromDropbox(document) &&
        hasDirtyState(dirtyDocumentStatesRef.current[document.id]),
    );
    if (hasDirtyDropboxDocument) {
      setStorageError(t("dropbox.error.saveBeforeDisconnect"));
      return;
    }

    const confirmed = window.confirm(t("dropbox.confirm.removeAuthorization"));
    if (!confirmed) return;

    try {
      const status = await invoke<DropboxOAuthStatusResult>("disconnect_dropbox");
      setDropboxConnected(status.connected);
      setDropboxDirectoryPicker(null);
      dropboxOpenAfterAuthRef.current = false;
      resetDropboxWorkspaceAfterAuthorizationRemoval();
      setStorageError(t("dropbox.status.authorizationRemoved"));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  const editorSurfaceStyle = {
    "--settings-editor-font-size": `${settingsSnapshot["editor.fontSize"]}px`,
    "--settings-editor-line-height": settingsSnapshot["editor.lineHeight"],
    "--settings-editor-line-height-px": `${
      settingsSnapshot["editor.fontSize"] * settingsSnapshot["editor.lineHeight"]
    }px`,
  } as CSSProperties;

  function openDuplicateDocumentDialog(target: FileActionTarget) {
    setFileContextMenu(null);

    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }

    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeDuplicate"));
      return false;
    }

    const documentToDuplicate = documentsRef.current.find(
      (document) => document.id === target.documentId,
    );
    const isDropboxTarget =
      target.source === "dropbox" ||
      (documentToDuplicate ? documentIsFromDropbox(documentToDuplicate) : false);
    const path = documentToDuplicate?.path ?? target.path;
    const title = documentToDuplicate?.title ?? target.title;

    if (!documentToDuplicate && !isDropboxTarget) {
      setStorageError(t("error.notBackedByMarkdownFile"));
      return false;
    }

    setStorageError("");
    setDuplicateFileDialog({
      documentId: target.documentId,
      path,
      title,
      source: isDropboxTarget ? "dropbox" : target.source,
      fileName: defaultDuplicateFileName({
        filePath: documentToDuplicate?.filePath ?? null,
        path,
        title,
      }),
      isSubmitting: false,
    });

    return true;
  }

  async function duplicateDocumentFile(target: DuplicateFileDialogState) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }

    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeDuplicate"));
      return false;
    }

    const documentToDuplicate = documentsRef.current.find(
      (document) => document.id === target.documentId,
    );
    const isDropboxTarget =
      target.source === "dropbox" ||
      (documentToDuplicate ? documentIsFromDropbox(documentToDuplicate) : false);

    const trimmedFileName = target.fileName.trim();
    if (!trimmedFileName) {
      setStorageError(t("error.duplicateFileNameRequired"));
      return false;
    }
    const targetFileName = ensureMarkdownExtension(trimmedFileName);

    setStorageError("");

    try {
      if (
        documentToDuplicate &&
        hasDirtyState(dirtyDocumentStatesRef.current[target.documentId])
      ) {
        await saveDocument(documentToDuplicate);
      }

      if (isDropboxTarget) {
        const dropboxPath = documentToDuplicate?.path ?? target.path;
        if (!dropboxPath) {
          setStorageError(t("error.notBackedByMarkdownFile"));
          return false;
        }

        const loaded = await invoke<OpenDropboxMarkdownFileResult>(
          "duplicate_dropbox_markdown_file",
          {
            path: dropboxPath,
            fileName: targetFileName,
          },
        );
        applyLoadedDropboxFile(loaded);
        setStorageError("");
        return true;
      }

      if (!documentToDuplicate?.filePath) {
        setStorageError(t("error.notBackedByMarkdownFile"));
        return false;
      }

      const loaded = await invoke<OpenMarkdownFileResult>("duplicate_markdown_file", {
        path: documentToDuplicate.filePath,
        fileName: targetFileName,
      });
      applyLoadedFiles([loaded], { sortEntries: true });
      setStorageError("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "duplicate file already exists") {
        setStorageError(t("error.duplicateExists"));
      } else if (message === "duplicate file name must not include folders") {
        setStorageError(t("error.duplicateNameNoFolders"));
      } else if (message === "duplicate file name is empty") {
        setStorageError(t("error.duplicateFileNameRequired"));
      } else {
        setStorageError(message);
      }
      return false;
    }
  }

  async function submitDuplicateDocumentFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!duplicateFileDialog || duplicateFileDialog.isSubmitting) return;

    setDuplicateFileDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: true } : currentDialog,
    );

    const duplicated = await duplicateDocumentFile(duplicateFileDialog);
    if (duplicated) {
      setDuplicateFileDialog(null);
      return;
    }

    setDuplicateFileDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: false } : currentDialog,
    );
  }

  function closeDuplicateFileDialog() {
    if (duplicateFileDialog?.isSubmitting) return;

    setDuplicateFileDialog(null);
    setStorageError("");
  }

  async function copyDocumentContent(target: FileActionTarget) {
    setFileContextMenu(null);

    try {
      const documentToCopy = documentsRef.current.find(
        (document) => document.id === target.documentId,
      );
      const isDropboxTarget =
        target.source === "dropbox" ||
        (documentToCopy ? documentIsFromDropbox(documentToCopy) : false);
      const bodyToCopy = documentToCopy
        ? documentToCopy.body
        : isDropboxTarget
          ? (
              await invoke<OpenDropboxMarkdownFileResult>("open_dropbox_markdown_file", {
                path: target.path,
              })
            ).body
          : "";

      if (!bodyToCopy && !documentToCopy && !isDropboxTarget) {
        setStorageError(t("error.notBackedByMarkdownFile"));
        return;
      }

      await writeTextToClipboard(bodyToCopy);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    }
  }

  function fileActionTargetsForDocumentIds(
    documentIds: string[],
    fallbackTarget?: FileActionTarget,
  ): ResolvedFileActionTarget[] {
    const documentsById = new Map(documentsRef.current.map((document) => [document.id, document]));
    const workspaceFileEntriesById = new Map(
      workspaceEntriesRef.current
        .filter(
          (entry): entry is Extract<WorkspaceEntry, { kind: "file" }> => entry.kind === "file",
        )
        .map((entry) => [entry.documentId, entry]),
    );
    const targets: ResolvedFileActionTarget[] = [];
    const seenDocumentIds = new Set<string>();

    documentIds.forEach((documentId) => {
      if (seenDocumentIds.has(documentId)) return;
      seenDocumentIds.add(documentId);

      const documentToDelete = documentsById.get(documentId) ?? null;
      const workspaceEntry = workspaceFileEntriesById.get(documentId);
      const fallback = fallbackTarget?.documentId === documentId ? fallbackTarget : null;
      const isDropboxTarget =
        workspaceEntry?.source === "dropbox" ||
        fallback?.source === "dropbox" ||
        (documentToDelete ? documentIsFromDropbox(documentToDelete) : false);
      const path = documentToDelete?.path ?? workspaceEntry?.path ?? fallback?.path ?? "";
      const title = documentToDelete?.title ?? workspaceEntry?.title ?? fallback?.title ?? path;

      targets.push({
        documentId,
        document: documentToDelete,
        isDropboxTarget,
        path,
        title,
        source: isDropboxTarget ? "dropbox" : (workspaceEntry?.source ?? fallback?.source),
      });
    });

    return targets;
  }

  async function deleteResolvedDocumentFile(target: ResolvedFileActionTarget) {
    if (target.isDropboxTarget) {
      const dropboxPath = target.document?.path ?? target.path;
      if (!dropboxPath) {
        throw new Error(t("error.notBackedByMarkdownFile"));
      }

      await invoke<OpenDropboxMarkdownFileResult>("delete_dropbox_markdown_file", {
        path: dropboxPath,
      });
      return;
    }

    const localPath = target.document?.filePath ?? target.path;
    if (!localPath) {
      throw new Error(t("error.notBackedByMarkdownFile"));
    }

    await invoke<DeleteMarkdownFileResult>("delete_markdown_file", {
      path: localPath,
    });
  }

  async function deleteDocumentFiles(documentIds: string[], fallbackTarget?: FileActionTarget) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeDelete"));
      return;
    }

    const targets = fileActionTargetsForDocumentIds(documentIds, fallbackTarget);
    if (targets.length === 0) {
      setStorageError(t("error.notBackedByMarkdownFile"));
      return;
    }

    const hasDropboxTarget = targets.some((target) => target.isDropboxTarget);
    const firstTarget = targets[0];
    const deleteConfirmationKey =
      targets.length > 1
        ? hasDropboxTarget
          ? "confirm.deleteDropboxFiles"
          : "confirm.deleteFiles"
        : firstTarget.isDropboxTarget
          ? "confirm.deleteDropboxFile"
          : "confirm.deleteFile";

    setFileContextMenu(null);

    const confirmed = window.confirm(
      t(deleteConfirmationKey, {
        count: targets.length,
        title: firstTarget.title,
      }),
    );
    if (!confirmed) return;

    setStorageError(t("status.deletingFile"));

    const deletedDocumentIds: string[] = [];
    try {
      for (const target of targets) {
        await deleteResolvedDocumentFile(target);
        deletedDocumentIds.push(target.documentId);
      }

      removeDocumentsFromWorkspace(deletedDocumentIds);
      setStorageError("");
    } catch (error) {
      removeDocumentsFromWorkspace(deletedDocumentIds);
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
    setSelectedWorkspaceDocumentIds(new Set());
    setSelectedDocumentId(documentId);
    setMobileSelectedWorkspaceEntryKey("");
    setSelectionWarningPosition(null);
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setNoteDraft("");
    setGlossaryDraft("");
    setStorageError("");
    setActiveNoteId("");
    setActiveNoteEditorKey("");
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
    setNotePanelExpanded(false);
    setExpandedLibraryNoteId("");
    setFloatingNotePanelPosition(null);
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current = null;
    notePanelHasContentRef.current = false;
  }

  function resetGlossaryModeInteractionState() {
    const pendingAnchorIsNoteCandidate = Boolean(
      pendingAnchor && !pendingGlossaryTerm && !pendingAnchorIsGlossaryTerm,
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
      setNotePanelExpanded(false);
      setFloatingNotePanelPosition(null);
      setIsNotePanelClosing(false);
      floatingNoteAnchorRectRef.current = null;
      notePanelHasContentRef.current = false;
    }
  }

  function resetNoteTextareaCompositionState() {
    noteEditorIsComposingRef.current = false;
    noteEditorEnterIgnoredDuringCompositionRef.current = false;
    noteEditorPostCompositionGuardUntilRef.current = 0;
  }

  function toggleFloatingNotePanelExpanded() {
    if (!floatingNoteCanExpand) return;

    setNotePanelExpanded((currentValue) => !currentValue);
  }

  function closeNotePanel() {
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    setSelectionWarningPosition(null);
    setNotePanelExpanded(false);
    setActiveNoteEditorKey("");

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
      setActiveNoteEditorKey("");
      setIsNotePanelClosing(false);
      floatingNoteAnchorRectRef.current = null;
      notePanelHasContentRef.current = false;
      notePanelCloseTimerRef.current = 0;
    }, notePanelAnimationMs);
  }

  function handleNoteEditorCompositionStart() {
    noteEditorIsComposingRef.current = true;
    noteEditorEnterIgnoredDuringCompositionRef.current = false;
    noteEditorPostCompositionGuardUntilRef.current = 0;
  }

  function handleNoteEditorCompositionEnd() {
    const hadEnterDuringComposition = noteEditorEnterIgnoredDuringCompositionRef.current;

    noteEditorIsComposingRef.current = false;
    noteEditorEnterIgnoredDuringCompositionRef.current = false;
    noteEditorPostCompositionGuardUntilRef.current =
      Date.now() + (hadEnterDuringComposition ? 500 : 180);
  }

  function handleNoteEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && keyboardEventIsComposing(event)) {
      noteEditorEnterIgnoredDuringCompositionRef.current = true;
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeNotePanel();
    }
  }

  function handleLibraryNoteEditorKeyDown(
    noteId: string,
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (focusAdjacentLibraryNote(noteId, event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (expandedLibraryNoteId === noteId) {
        closeLibraryNoteExpandedPanel();
      } else {
        setFocusedLibraryNoteId((currentNoteId) =>
          currentNoteId === noteId ? "" : currentNoteId,
        );
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
  }

  function openSelectionNoteConfirmation(anchor: TextSelectionAnchor) {
    const anchorRect = currentSelectionAnchorRect();
    if (anchorRect) {
      floatingNoteAnchorRectRef.current = anchorRect;
    }

    setSelectionWarningPosition(null);
    setPendingAnchor(anchor);
    setNoteDraft("");
    setPendingGlossaryTerm(null);
    setGlossaryDraft("");
    setActiveNoteId("");
    setActiveNoteMode("view");
    notePanelHasContentRef.current = true;
  }

  function handleSelectionChange(anchor: TextSelectionAnchor | null) {
    if (!noteModeEnabled) {
      return;
    }

    if (noteLibraryOpen) {
      if (!anchor && pendingAnchor) {
        setPendingAnchor(null);
        setPendingGlossaryTerm(null);
        setNoteDraft("");
        setGlossaryDraft("");
        setSelectionWarningPosition(null);
        floatingNoteAnchorRectRef.current = null;
        notePanelHasContentRef.current = false;
      }
      return;
    }

    if (!anchor) {
      const now = Date.now();

      if (now < selectionClearedByAppUntilRef.current) {
        if (now >= selectionWarningPreserveUntilRef.current) {
          clearSelectionWarning();
        }
        return;
      }

      if (
        now < pendingGlossaryPromptLockUntilRef.current &&
        pendingAnchor &&
        pendingGlossaryTerm
      ) {
        return;
      }

      if (now < selectionWarningPreserveUntilRef.current) {
        return;
      }

      clearSelectionWarning();
      if (pendingAnchor) {
        closeNotePanel();
      }
      return;
    }

    const now = Date.now();

    if (now < selectionDismissedUntilRef.current) {
      return;
    }

    if (now >= selectionWarningPreserveUntilRef.current) {
      clearSelectionWarning();
    }

    if (
      pendingAnchor &&
      !pendingGlossaryTerm &&
      !textSelectionAnchorsMatch(anchor, pendingAnchor)
    ) {
      setPendingAnchor(null);
      setNoteDraft("");
      setPendingGlossaryTerm(null);
      setGlossaryDraft("");
      floatingNoteAnchorRectRef.current = null;
      notePanelHasContentRef.current = false;
    }

    if (isMobileViewport && !pendingGlossaryTerm) {
      if (selectionShouldSuppressNewAnnotation(anchor)) {
        return;
      }

      if (glossaryModeActive && isGlossarySelectionCandidate(anchor)) {
        startGlossaryFlowForAnchor(anchor);
        return;
      }

      openSelectionNoteConfirmation(anchor);
    }
  }

  function selectionOverlapsActiveNote(anchor: TextSelectionAnchor) {
    return activeNotes.some((note) => selectionOverlapsNote(anchor, note));
  }

  function activeNoteOverlappingSelection(anchor: TextSelectionAnchor) {
    return activeNotes.find((note) => selectionOverlapsNote(anchor, note)) ?? null;
  }

  function selectionOverlapsActiveGlossary(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return false;

    return documentGlossaryBindings.some((binding) =>
      (glossaryTermIdsWithContent.has(binding.termId) ||
        editableGlossaryBindingIds.has(binding.id)) &&
      selectionOverlapsGlossaryBinding(anchor, binding),
    );
  }

  function activeGlossaryBindingOverlappingSelection(anchor: TextSelectionAnchor) {
    if (!glossaryModeActive) return null;

    return (
      documentGlossaryBindings.find(
        (binding) =>
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

  function selectionShouldSuppressNewAnnotation(anchor: TextSelectionAnchor) {
    if (isMobileViewport && !(glossaryModeActive && isGlossarySelectionCandidate(anchor))) {
      return false;
    }

    return selectionIsBlockedByExistingAnnotations(anchor);
  }

  function openSelectionNoteViewer(note: SelectionNote) {
    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current =
      activeNoteAnchorRect(note.id) ?? currentSelectionAnchorRect();
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveGlossaryMode("view");
    setActiveNoteId(note.id);
    setActiveNoteMode("view");
    setActiveNoteEditorKey(selectionNoteHasContent(note) ? "" : noteEditorKey("floating", note.id));
    setNoteDraft(note.body);
    notePanelHasContentRef.current = true;
  }

  function openGlossaryBindingPanel(binding: GlossaryBinding) {
    if (!glossaryModeActive) return false;

    const term = glossaryTerms.find((candidate) => candidate.id === binding.termId);
    if (!term) return false;

    const termHasContent = glossaryTermHasContent(term);
    setSelectionWarningPosition(null);
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    setIsNotePanelClosing(false);
    floatingNoteAnchorRectRef.current =
      activeGlossaryAnchorRect(binding.id) ?? currentSelectionAnchorRect();
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveNoteMode("view");
    setActiveNoteEditorKey("");
    setActiveGlossaryBindingId(binding.id);
    setActiveGlossaryTermId(term.id);
    setActiveGlossaryMode(termHasContent ? "view" : "edit");
    setGlossaryDraft(term.definition);
    noteEditorShouldRefocusRef.current = !termHasContent;
    notePanelHasContentRef.current = true;
    return true;
  }

  function openExistingAnnotationForSelection(anchor: TextSelectionAnchor) {
    const overlappingNote = activeNoteOverlappingSelection(anchor);
    if (overlappingNote) {
      openSelectionNoteViewer(overlappingNote);
      return true;
    }

    const overlappingGlossaryBinding = activeGlossaryBindingOverlappingSelection(anchor);
    if (overlappingGlossaryBinding) {
      return openGlossaryBindingPanel(overlappingGlossaryBinding);
    }

    return false;
  }

  function handleSelectionEnter(anchor: TextSelectionAnchor) {
    if (!hasOpenDocument) return false;
    if (
      settingsViewOpen ||
      duplicateFileDialog ||
      dropboxDirectoryPicker ||
      notePanelModalActive ||
      noteEditModalActive
    ) {
      return false;
    }

    if (selectionShouldSuppressNewAnnotation(anchor)) {
      if (!noteModeEnabled) {
        setNoteModeEnabled(true);
      }
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      openExistingAnnotationForSelection(anchor);
      return true;
    }

    if (glossaryModeActive && isGlossarySelectionCandidate(anchor)) {
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      startGlossaryFlowForAnchor(anchor);
      return true;
    }

    if (isSelectionCompleteMarkdownBlock(selectedDocument.body, anchor)) {
      if (!noteModeEnabled) {
        setNoteModeEnabled(true);
        setGlossaryModeEnabled(false);
      }
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      openSelectionNoteConfirmation(anchor);
      return true;
    }

    if (!noteModeEnabled) {
      setNoteModeEnabled(true);
      setGlossaryModeEnabled(false);
    }

    if (noteLibraryOpen) {
      setNoteLibraryOpen(false);
    }

    openSelectionNoteConfirmation(anchor);
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
    setActiveNoteEditorKey("");
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
    noteEditorShouldRefocusRef.current = true;
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
    noteEditorShouldRefocusRef.current = true;
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

    if (consumeSuppressedLibraryAnnotationClick(note.id)) {
      return true;
    }

    if (focusedLibraryNoteId === note.id) {
      suppressNextLibraryAnnotationClick(note.id);
      setFocusedLibraryNoteId("");
      return true;
    }

    setFocusedLibraryNoteId(note.id);
    focusLibraryNoteCard(note.id);
    return true;
  }

  function dismissFocusTargetAnnotationFromEditor(annotationId: string) {
    if (noteLibraryOpen && !annotationId.startsWith("glossary:")) {
      suppressNextLibraryAnnotationClick(annotationId);
      setFocusedLibraryNoteId("");
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }

    if (annotationId.startsWith("glossary:")) {
      const bindingId = annotationId.slice("glossary:".length);
      if (activeGlossaryBindingId === bindingId || notePanelHasContentRef.current) {
        closeNotePanel();
      }
      return;
    }

    if (activeNoteId === annotationId || notePanelHasContentRef.current) {
      closeNotePanel();
    }
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
      setNotePanelExpanded(false);
      setIsNotePanelClosing(false);
      notePanelHasContentRef.current = false;
    }
    markDocumentNotesDirty();
  }

  function confirmPendingSelectionNote() {
    if (!noteModeEnabled) return;
    if (!pendingAnchorCanCreateNote || !pendingAnchor) return;

    confirmSelectionNoteForAnchor(pendingAnchor);
  }

  function confirmSelectionNoteForAnchor(anchor: TextSelectionAnchor) {
    if (!noteModeEnabled) return;

    createSelectionNoteForAnchor(anchor, { startEditing: true });
  }

  function createSelectionNoteForAnchor(
    anchor: TextSelectionAnchor,
    options: { startEditing?: boolean } = {},
  ) {
    const { startEditing = false } = options;

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

    updateNotesState((currentNotes) => [note, ...currentNotes]);
    transientSelectionNoteIdRef.current = note.id;
    noteEditorShouldRefocusRef.current = startEditing;
    clearReturnToViewTimer();
    setPendingAnchor(null);
    setActiveNoteId(note.id);
    setActiveNoteMode("view");
    setActiveNoteEditorKey(startEditing ? noteEditorKey("floating", note.id) : "");
    setNoteDraft("");
    setIsNotePanelClosing(false);
    notePanelHasContentRef.current = true;
  }

  function updateNoteBody(noteId: string, body: string) {
    const noteDocumentId =
      notesRef.current.find((note) => note.id === noteId)?.documentId ?? selectedDocument.id;
    if (transientSelectionNoteIdRef.current === noteId && body.trim()) {
      transientSelectionNoteIdRef.current = "";
    }

    updateNotesState((currentNotes) =>
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
    markDocumentNotesDirty(noteDocumentId);
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
    updateNotesState((currentNotes) =>
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
      setActiveNoteEditorKey("");
      setNoteDraft("");
      setNotePanelExpanded(false);
      setIsNotePanelClosing(false);
      notePanelHasContentRef.current = false;
    }
    if (focusedLibraryNoteId === noteId) {
      setFocusedLibraryNoteId("");
    }
    setActiveNoteEditorKey((currentKey) =>
      currentKey.endsWith(`:${noteId}`) ? "" : currentKey,
    );
    if (expandedLibraryNoteId === noteId) {
      setExpandedLibraryNoteId("");
    }
    markDocumentNotesDirty();
  }

  function toggleNoteMode() {
    if (!annotationToolsAvailable) return;

    const nextNoteModeEnabled = !noteModeEnabled;
    if (!nextNoteModeEnabled) {
      resetNoteModeInteractionState();
      setGlossaryModeEnabled(false);
    }

    setNoteModeEnabled(nextNoteModeEnabled);
  }

  function toggleGlossaryMode() {
    if (!annotationToolsAvailable) return;
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
    if (expandedLibraryNoteId === noteId) {
      return;
    }

    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }
    if (
      nextFocusedElement instanceof Element &&
      nextFocusedElement.closest(".note-library-expanded-panel")
    ) {
      return;
    }

    if (focusedLibraryNoteId === noteId) {
      suppressNextLibraryAnnotationClick(noteId);
    }
    setFocusedLibraryNoteId((currentNoteId) =>
      currentNoteId === noteId ? "" : currentNoteId,
    );
  }

  function handleShellMouseDownCapture(event: MouseEvent<HTMLElement>) {
    if (!noteLibraryFocusActive || !focusedLibraryNoteId) return;
    if (libraryNotePanelExpanded) return;

    const target = event.target;
    if (target instanceof Element && target.closest(".note-library-expanded-panel")) {
      return;
    }
    if (target instanceof Element && target.closest(".note-library-card.is-focused")) {
      return;
    }
    if (suppressAndDismissFocusedLibraryAnnotationClick(event)) {
      return;
    }

    setFocusedLibraryNoteId("");
  }

  function handleShellPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (!noteLibraryFocusActive || !focusedLibraryNoteId) return;
    if (libraryNotePanelExpanded) return;

    const target = event.target;
    if (target instanceof Element && target.closest(".note-library-expanded-panel")) {
      return;
    }
    if (target instanceof Element && target.closest(".note-library-card.is-focused")) {
      return;
    }
    if (suppressAndDismissFocusedLibraryAnnotationClick(event)) {
      return;
    }
  }

  function updateLibraryNoteDraft(noteId: string, body: string) {
    updateNoteBody(noteId, body);
  }

  function focusLibraryNoteCard(noteId: string) {
    window.requestAnimationFrame(() => {
      const noteCard = noteLibraryCardElement(noteId);
      if (!noteCard) return;

      noteCard.focus({ preventScroll: true });
      alignLibraryNoteCardToViewport(noteId);
    });
  }

  function focusAdjacentLibraryNote(
    noteId: string,
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (targetIsInsideEditingNoteMarkdownEditor(event.target)) return false;
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

  function openLibraryNoteExpandedPanel(noteId: string) {
    const note = noteLibraryNotes.find((candidate) => candidate.id === noteId);
    if (!note) return;

    setFocusedLibraryNoteId(note.id);
    setExpandedLibraryNoteId(note.id);
  }

  function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
    if (deltaMode === 1) return delta * 40;
    if (deltaMode === 2) return delta * pageSize;
    return delta;
  }

  function scrollElementByWheelDelta(
    element: Element,
    deltaX: number,
    deltaY: number,
  ) {
    const scrollElement = element as HTMLElement;
    const previousLeft = scrollElement.scrollLeft;
    const previousTop = scrollElement.scrollTop;

    scrollElement.scrollLeft += deltaX;
    scrollElement.scrollTop += deltaY;

    return scrollElement.scrollLeft !== previousLeft || scrollElement.scrollTop !== previousTop;
  }

  function scrollMainDocumentFromWheel(event: ReactWheelEvent<HTMLElement>) {
    const editorContentFrame = document.querySelector<HTMLElement>(".editor-content-frame");
    if (!editorContentFrame) return;

    const editorContentRect = editorContentFrame.getBoundingClientRect();
    if (!pointHitsRect(event.clientX, event.clientY, editorContentRect)) return;

    const scrollDeltaY = normalizeWheelDelta(
      event.deltaY,
      event.deltaMode,
      window.innerHeight,
    );
    const scrollDeltaX = normalizeWheelDelta(
      event.deltaX,
      event.deltaMode,
      window.innerWidth,
    );
    if (scrollDeltaX === 0 && scrollDeltaY === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const previousWindowX = window.scrollX;
    const previousWindowY = window.scrollY;
    window.scrollBy({ left: scrollDeltaX, top: scrollDeltaY, behavior: "instant" });
    if (window.scrollX !== previousWindowX || window.scrollY !== previousWindowY) {
      return;
    }

    const scrollTargets = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.querySelector(".editor-pane"),
      document.querySelector(".editor-surface"),
      document.querySelector(".editor-content-frame"),
      document.querySelector(".cm-scroller"),
      document.querySelector(".markdown-preview"),
      document.querySelector(".milkdown-markdown-editor-shell"),
    ].filter((target): target is Element => target instanceof Element);

    for (const scrollTarget of scrollTargets) {
      if (scrollElementByWheelDelta(scrollTarget, scrollDeltaX, scrollDeltaY)) {
        return;
      }
    }
  }

  function handleNoteLibraryFocusBackdropWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!libraryNotePanelExpanded) return;

    scrollMainDocumentFromWheel(event);
  }

  function handleLibraryNoteExpandedPanelWheel(event: ReactWheelEvent<HTMLElement>) {
    const scrollTarget = event.currentTarget.classList.contains(
      "note-library-expanded-panel__body-scroll",
    )
      ? event.currentTarget
      : event.currentTarget.querySelector<HTMLElement>(
          ".note-library-expanded-panel__body-scroll",
        );
    if (!scrollTarget) return;

    const canScrollVertically = scrollTarget.scrollHeight > scrollTarget.clientHeight + 1;
    const canScrollHorizontally = scrollTarget.scrollWidth > scrollTarget.clientWidth + 1;
    if (!canScrollVertically && !canScrollHorizontally) return;

    const scrollDeltaY = normalizeWheelDelta(
      event.deltaY,
      event.deltaMode,
      scrollTarget.clientHeight,
    );
    const scrollDeltaX = normalizeWheelDelta(
      event.deltaX,
      event.deltaMode,
      scrollTarget.clientWidth,
    );

    event.preventDefault();
    event.stopPropagation();
    if (canScrollHorizontally) {
      scrollTarget.scrollLeft += scrollDeltaX;
    }
    if (canScrollVertically) {
      scrollTarget.scrollTop += scrollDeltaY;
    }
  }

  function renderNoteLibraryCard(note: SelectionNote) {
    const isFocusedLibraryNote = focusedLibraryNoteId === note.id;
    const editorKey = noteEditorKey("library", note.id);

    return (
      <article
        className={`note-library-card ${activeNoteId === note.id ? "is-active" : ""} ${
          isFocusedLibraryNote ? "is-focused" : ""
        }`}
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
          <PinBadge ariaLabel={t("note.pin")} />
          <button
            className="note-library-card__expand-button"
            type="button"
            aria-label={t("note.expand")}
            title={t("note.expand")}
            onClick={(event) => {
              event.stopPropagation();
              openLibraryNoteExpandedPanel(note.id);
            }}
          >
            <ExpandPanelIcon />
          </button>
        </div>
        <NoteMarkdownEditor
          ariaLabel={t("note.edit")}
          className="note-library-card__editor"
          editing={activeNoteEditorKey === editorKey}
          value={note.body}
          onChange={(value) => updateLibraryNoteDraft(note.id, value)}
          onClick={(event) => {
            event.stopPropagation();
            setFocusedLibraryNoteId(note.id);
          }}
          onCompositionStart={handleNoteEditorCompositionStart}
          onCompositionEnd={handleNoteEditorCompositionEnd}
          onEditingBlur={() => finishNoteEditorEditing(editorKey)}
          onKeyDown={(event) => handleLibraryNoteEditorKeyDown(note.id, event)}
          onRequestEdit={() => {
            setFocusedLibraryNoteId(note.id);
            setActiveNoteEditorKey(editorKey);
          }}
        />
        <div
          className="note-actions note-library-card__actions"
          aria-hidden={!isFocusedLibraryNote}
        >
          <button
            className="is-danger"
            type="button"
            aria-label={t("note.delete")}
            title={t("note.delete")}
            tabIndex={isFocusedLibraryNote ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation();
              deleteNote(note.id);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </article>
    );
  }

  function closeLibraryNoteExpandedPanel() {
    const noteId = expandedLibraryNoteId;
    setExpandedLibraryNoteId("");
    setActiveNoteEditorKey((currentKey) =>
      currentKey === noteEditorKey("expanded", noteId) ? "" : currentKey,
    );
    if (noteId) {
      setFocusedLibraryNoteId(noteId);
      focusLibraryNoteCard(noteId);
    }
  }

  function collapseDirectoryPaneForNoteExpansion() {
    if (!directoryPaneOpen) return;

    if (isMobileViewport) {
      setDirectoryPaneOpen(false);
      return;
    }

    const writtenValue = writeSetting("app.directoryPaneOpen", false) as boolean;
    recordFullscreenDirectoryPaneManualValue(writtenValue);
    setSettingsSnapshot((currentSettings) => ({
      ...currentSettings,
      "app.directoryPaneOpen": writtenValue,
    }));
    setDirectoryPaneOpen(writtenValue);
  }

  function openNoteLibrary() {
    if (!annotationToolsAvailable) return;

    setFocusedLibraryNoteId("");
    setExpandedLibraryNoteId("");
    setActiveNoteEditorKey("");
    resetNoteModeInteractionState();
    collapseDirectoryPaneForNoteExpansion();
    setNoteLibraryOpen(true);
  }

  function closeNoteLibrary(options: { restoreDirectoryPane?: boolean } = {}) {
    const { restoreDirectoryPane = true } = options;

    setFocusedLibraryNoteId("");
    setExpandedLibraryNoteId("");
    setActiveNoteEditorKey("");
    void restoreDirectoryPane;
    directoryPaneOpenBeforeNoteLibraryRef.current = null;
    setNoteLibraryOpen(false);
  }

  function toggleNoteLibrary() {
    if (!noteModeEnabled) return;

    if (noteLibraryOpen) {
      closeNoteLibrary();
      return;
    }

    openNoteLibrary();
  }

  function toggleDirectoryPane() {
    const nextValue = !directoryPaneOpen;
    if (isMobileViewport) {
      if (nextValue && noteLibraryOpen) {
        closeNoteLibrary({ restoreDirectoryPane: false });
      }
      setDirectoryPaneOpen(nextValue);
      return;
    }

    const writtenValue = writeSetting("app.directoryPaneOpen", nextValue) as boolean;
    recordFullscreenDirectoryPaneManualValue(writtenValue);
    setSettingsSnapshot((currentSettings) => ({
      ...currentSettings,
      "app.directoryPaneOpen": writtenValue,
    }));
    setDirectoryPaneOpen(writtenValue);
  }

  function runMobileSourceAction(action: () => Promise<void> | void) {
    if (isMobileViewport) {
      setFileContextMenu(null);
      setDirectoryPaneOpen(false);
      if (noteLibraryOpen) {
        closeNoteLibrary({ restoreDirectoryPane: false });
      }
    }

    void action();
  }

  const floatingNotePanelStyle: CSSProperties = floatingNotePanelExpanded
    ? {}
    : floatingNotePanelPosition
      ? {
          left: floatingNotePanelPosition.left,
          top: floatingNotePanelPosition.top,
        }
      : {
          left: 0,
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
  const floatingNoteConnectorStyle: CSSProperties | null =
    floatingNotePanelExpanded || !floatingNotePanelPosition?.connector
      ? null
      : {
          left: floatingNotePanelPosition.connector.left,
          top: floatingNotePanelPosition.connector.top,
          transform: `translateY(-50%) rotate(${floatingNotePanelPosition.connector.angle}deg)`,
          width: floatingNotePanelPosition.connector.width,
        };
  const editorReadOnly = notePanelModalActive;
  const fileContextMenuActions: FileContextMenuAction[] = fileContextMenu
    ? (() => {
        const exportDocumentCount = fileContextMenu.exportDocumentIds.length;
        const exportPdfAction = {
          id: "export-pdf",
          label:
            exportDocumentCount > 1
              ? t("pdfExport.actionWithCount", { count: exportDocumentCount })
              : t("pdfExport.action"),
          icon: <PdfIcon />,
          onSelect: () => {
            const documentsToExport = documentsForDocumentIds(fileContextMenu.exportDocumentIds);
            setFileContextMenu(null);
            void exportDocumentsAsPdf(documentsToExport);
          },
        };
        const copyContentAction = {
          id: "copy-content",
          label: t("file.copyContent"),
          icon: <CopyIcon />,
          onSelect: () => {
            void copyDocumentContent(fileContextMenu);
          },
        };
        const deleteFileAction = {
          id: "delete",
          label:
            exportDocumentCount > 1
              ? t("file.deleteWithCount", { count: exportDocumentCount })
              : t("file.delete"),
          icon: <TrashIcon />,
          tone: "danger" as const,
          onSelect: () => {
            void deleteDocumentFiles(fileContextMenu.exportDocumentIds, fileContextMenu);
          },
        };

        if (exportDocumentCount > 1) {
          return [exportPdfAction, deleteFileAction];
        }

        return [
          exportPdfAction,
          {
            id: "duplicate",
            label: t("duplicate.action"),
            icon: <DuplicateIcon />,
            onSelect: () => {
              openDuplicateDocumentDialog(fileContextMenu);
            },
          },
          copyContentAction,
          deleteFileAction,
        ];
      })()
    : [];
  const floatingPanelIsGlossary = Boolean(
    pendingGlossaryTerm ||
      activeGlossaryTerm ||
      activeGlossaryIsEditing ||
      (pendingAnchor && pendingAnchorIsGlossaryTerm),
  );
  const floatingNoteTone = activeNote
    ? (activeNoteToneById.get(activeNote.id) ?? activeNote.tone ?? 0)
    : 0;
  const selectionWarningMessage = glossaryModeActive
    ? t("selection.warning.glossary")
    : t("selection.warning.note");
  const trimmedFileSearchQuery = fileSearchQuery.trim();
  const fileSearchActive = trimmedFileSearchQuery.length > 0;
  const localRecursiveFileSearchActive =
    fileSearchActive &&
    workspaceSource === "local" &&
    Boolean(workspaceRootPath) &&
    nativeStorageAvailable;
  const visibleWorkspaceEntries =
    fileSearchActive && !localRecursiveFileSearchActive
      ? filterWorkspaceEntriesForSearch(workspaceEntries, trimmedFileSearchQuery)
      : workspaceEntries;
  const fileSearchHasNoResults =
    fileSearchActive &&
    !fileSearchPending &&
    !fileSearchError &&
    (localRecursiveFileSearchActive
      ? localFileSearchResults.length === 0
      : visibleWorkspaceEntries.length === 0);
  const visibleDropboxPickerDirectories = dropboxDirectoryPicker
    ? flattenDropboxDirectoryPickerNodes(dropboxDirectoryPicker.directories)
    : [];
  const mobileSourceActions: Array<{
    id: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
  }> = [
    {
      id: "dropbox",
      label: t("mobileSource.openDropbox"),
      icon: <MobileCloudIcon />,
      onSelect: () => runMobileSourceAction(openDropboxCloudSource),
    },
    {
      id: "open-file",
      label: t("mobileSource.openFile"),
      icon: <MobileOpenFileIcon />,
      onSelect: () => runMobileSourceAction(openMarkdownFileFromPicker),
    },
    {
      id: "open-folder",
      label: t("mobileSource.openFolder"),
      icon: <MobileOpenFolderIcon />,
      onSelect: () => runMobileSourceAction(openMarkdownFolder),
    },
    {
      id: "new-file",
      label: t("mobileSource.newFile"),
      icon: <MobileNewFileIcon />,
      onSelect: () => runMobileSourceAction(newMarkdownFile),
    },
  ];

  const shellClassName = [
    "scholium-shell",
    isMobileSafeLayoutViewport ? "is-mobile-safe-layout" : "",
    directoryPaneOpen ? "" : "is-directory-pane-closed",
    !settingsViewOpen && noteModeEnabled && noteLibraryOpen ? "is-note-library-open" : "",
    !settingsViewOpen && noteLibraryFocusActive ? "is-note-library-focus-active" : "",
    !settingsViewOpen && libraryNotePanelExpanded ? "is-note-library-expanded" : "",
    !settingsViewOpen && notePanelModalActive ? "is-note-panel-modal-active" : "",
    !settingsViewOpen && expandedNotePanelScrollLocked ? "is-note-panel-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const documentPaneWidth = estimateDocumentPaneWidth(workspaceTitle, workspaceEntries);
  const shellStyle = {
    "--document-pane-measured-width": `${documentPaneWidth}px`,
  } as CSSProperties;
  const settingsCustomSections = useMemo(
    () => [
      {
        category: "cloud" as SettingCategory,
        content: (
          <div className="settings-view__custom-list">
            <section className="settings-view__cloud-card" aria-label={t("dropbox.settings.title")}>
              <div className="settings-view__cloud-copy">
                <span className="settings-view__setting-label">
                  {t("dropbox.settings.title")}
                </span>
                <span className="settings-view__setting-description">
                  {t("dropbox.settings.description")}
                </span>
              </div>
              <div className="settings-view__cloud-status-row">
                <span
                  className={`settings-view__cloud-status ${
                    dropboxConnected ? "is-connected" : ""
                  } ${!configuredDropboxAppKey ? "is-not-configured" : ""}`}
                >
                  {dropboxConnected
                    ? t("dropbox.connected")
                    : configuredDropboxAppKey
                      ? t("dropbox.disconnected")
                      : t("dropbox.notConfigured")}
                </span>
              </div>
              <div className="settings-view__cloud-actions">
                <button
                  className="is-primary"
                  disabled={dropboxConnecting || !configuredDropboxAppKey || !nativeStorageAvailable}
                  onClick={() => void connectDropbox()}
                  type="button"
                >
                  {dropboxConnecting
                    ? t("dropbox.connecting")
                    : dropboxConnected
                      ? t("dropbox.settings.reauthorize")
                      : t("dropbox.settings.connect")}
                </button>
                {dropboxConnected ? (
                  <button
                    className="is-danger"
                    disabled={dropboxConnecting || !nativeStorageAvailable}
                    onClick={() => void removeDropboxAuthorization()}
                    type="button"
                  >
                    {t("dropbox.settings.removeAuthorization")}
                  </button>
                ) : null}
              </div>
              <p className="settings-view__cloud-note">
                {t("dropbox.settings.openFromFileMenu")}
              </p>
            </section>
          </div>
        ),
      },
    ],
    [dropboxConnected, dropboxConnecting, nativeStorageAvailable, t],
  );

  return (
    <main
      className={shellClassName}
      style={shellStyle}
      onMouseDownCapture={handleShellMouseDownCapture}
      onPointerDownCapture={handleShellPointerDownCapture}
    >
      {!settingsViewOpen && noteLibraryFocusActive ? (
        <div
          aria-hidden="true"
          className={`note-library-focus-backdrop ${
            libraryNotePanelExpanded ? "is-scroll-through" : ""
          }`}
          onWheel={handleNoteLibraryFocusBackdropWheel}
        />
      ) : null}
      <aside className="document-pane" aria-label={t("app.documents")}>
        <div className="pane-header">
          <div>
            <h1>{t("app.documents")}</h1>
          </div>
          <button
            aria-label={t("directory.bookmark.close")}
            className="mobile-panel-close"
            onClick={toggleDirectoryPane}
            type="button"
          >
            {t("mobilePanel.done")}
          </button>
        </div>

        <label className="file-search" aria-label={t("fileSearch.label")}>
          <input
            aria-label={t("fileSearch.label")}
            autoComplete="off"
            placeholder={t("fileSearch.placeholder")}
            type="search"
            value={fileSearchQuery}
            onChange={(event) => setFileSearchQuery(event.target.value)}
          />
          {fileSearchQuery ? (
            <button
              aria-label={t("fileSearch.clear")}
              className="file-search__clear"
              onClick={resetFileSearch}
              type="button"
            >
              ×
            </button>
          ) : null}
        </label>

        <div className="mobile-source-actions" aria-label={t("mobileSource.label")}>
          {mobileSourceActions.map((action) => (
            <button key={action.id} onClick={action.onSelect} type="button">
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        <div className="document-list">
          <div className="document-tree-root" title={workspaceTitle}>
            <DocumentGlyphIcon kind="folder" selected />
            <span className="document-tree-root__title">{workspaceTitle}</span>
          </div>

          {localRecursiveFileSearchActive ? (
            <>
              {fileSearchPending ? (
                <p className="file-search-status" role="status">
                  {t("fileSearch.searching")}
                </p>
              ) : null}
              {fileSearchError ? (
                <p className="file-search-status is-error" role="status">
                  {fileSearchError}
                </p>
              ) : null}
              {!fileSearchPending && !fileSearchError
                ? localFileSearchResults.map((result) => {
                    const mobileSelectionKey = localFileSearchResultSelectionKey(result);
                    const isCurrentDocument =
                      hasOpenDocument && localPathsMatch(result.path, selectedDocument.id);
                    const isSelected =
                      isCurrentDocument ||
                      (isMobileViewport && mobileSelectedWorkspaceEntryKey === mobileSelectionKey);

                    return (
                      <button
                        className={`document-row file-search-result ${
                          isSelected ? "is-selected" : ""
                        }`}
                        key={result.path}
                        onClick={() => {
                          if (
                            isMobileViewport &&
                            !isCurrentDocument &&
                            mobileSelectedWorkspaceEntryKey !== mobileSelectionKey
                          ) {
                            setMobileSelectedWorkspaceEntryKey(mobileSelectionKey);
                            setSelectedWorkspaceDocumentIds(new Set());
                            return;
                          }

                          void openLocalFileSearchResult(result);
                        }}
                        title={result.relativePath}
                        type="button"
                      >
                        <span
                          className="document-disclosure is-placeholder"
                          aria-hidden="true"
                        />
                        <DocumentGlyphIcon kind="file" selected={isSelected} />
                        <span className="document-title">
                          <span className="document-title__primary">{result.title}</span>
                          <span className="document-title__meta">{result.relativePath}</span>
                        </span>
                      </button>
                    );
                  })
                : null}
            </>
          ) : (
            visibleWorkspaceEntries.map((entry) => {
              const mobileSelectionKey = workspaceEntrySelectionKey(entry);
              const isMobileSelected =
                isMobileViewport && mobileSelectedWorkspaceEntryKey === mobileSelectionKey;
              const isSelected =
                hasOpenDocument &&
                entry.kind === "file" &&
                entry.documentId === selectedDocument.id;
              const rowIsSelected = isSelected || isMobileSelected;
              const isBatchSelected =
                entry.kind === "file" && selectedWorkspaceDocumentIds.has(entry.documentId);
              const isDirectory = entry.kind === "directory";
              const entryKey = isDirectory ? directoryTreeKey(entry) : "";
              const isExpanded = isDirectory && expandedDirectoryKeys.has(entryKey);
              const useSelectedFolderIcon = isDirectory && isExpanded;
              const isLoading = isDirectory && loadingDirectoryKeys.has(entryKey);
              const rowStyle = {
                "--document-row-depth": entry.depth ?? 1,
              } as CSSProperties;

              return (
                <button
                  aria-expanded={isDirectory ? isExpanded : undefined}
                  className={`document-row ${isDirectory ? "is-folder" : ""} ${
                    isExpanded ? "is-expanded" : ""
                  } ${isLoading ? "is-loading" : ""} ${rowIsSelected ? "is-selected" : ""} ${
                    isBatchSelected ? "is-batch-selected" : ""
                  }`}
                  key={entry.id}
                  style={rowStyle}
                  onClick={(event) => {
                    openWorkspaceEntry(entry, event);
                  }}
                  onContextMenu={(event) => {
                    if (entry.kind !== "file") return;

                    openFileContextMenu(entry, event);
                  }}
                  title={entry.title}
                  type="button"
                >
                  <span
                    className={`document-disclosure ${isDirectory ? "" : "is-placeholder"}`}
                    aria-hidden="true"
                  >
                    {isDirectory ? (isLoading ? "..." : isExpanded ? "⌄" : "›") : ""}
                  </span>
                  <DocumentGlyphIcon
                    kind={isDirectory ? "folder" : "file"}
                    selected={
                      isDirectory
                        ? useSelectedFolderIcon || isMobileSelected
                        : isSelected || isMobileSelected || isBatchSelected
                    }
                  />
                  <span className="document-title">{entry.title}</span>
                </button>
              );
            })
          )}

          {fileSearchHasNoResults ? (
            <p className="file-search-status" role="status">
              {t("fileSearch.noResults")}
            </p>
          ) : null}
        </div>

        {storageError ? <p className="storage-error">{storageError}</p> : null}

        {!settingsViewOpen ? (
          <button
            aria-expanded={directoryPaneOpen}
            aria-label={
              directoryPaneOpen ? t("directory.bookmark.close") : t("directory.bookmark.open")
            }
            className={`directory-bookmark ${directoryPaneOpen ? "is-attached" : ""}`}
            onClick={toggleDirectoryPane}
            type="button"
          >
            <span aria-hidden="true" className="directory-bookmark__label">
              {t("directory.bookmark.label")
                .split("")
                .map((character, index) => (
                  <span key={`${character}-${index}`}>{character}</span>
                ))}
            </span>
          </button>
        ) : null}
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

      {duplicateFileDialog ? (
        <div
          className="duplicate-file-dialog-backdrop"
          onMouseDown={closeDuplicateFileDialog}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <form
            aria-labelledby="duplicate-file-dialog-title"
            aria-modal="true"
            className="duplicate-file-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submitDuplicateDocumentFile}
            role="dialog"
          >
            <div className="duplicate-file-dialog__header">
              <h2 id="duplicate-file-dialog-title">{t("duplicate.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                className="duplicate-file-dialog__close"
                disabled={duplicateFileDialog.isSubmitting}
                onClick={closeDuplicateFileDialog}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="duplicate-file-dialog__field">
              <span>{t("duplicate.fileName")}</span>
              <span className="duplicate-file-dialog__file-name-control">
                <input
                  aria-describedby="duplicate-file-dialog-extension"
                  disabled={duplicateFileDialog.isSubmitting}
                  ref={duplicateFileInputRef}
                  type="text"
                  value={duplicateFileDialog.fileName}
                  onChange={(event) => {
                    const nextFileName = stripMarkdownExtension(event.target.value);
                    setDuplicateFileDialog((currentDialog) =>
                      currentDialog ? { ...currentDialog, fileName: nextFileName } : currentDialog,
                    );
                  }}
                />
                <span
                  className="duplicate-file-dialog__extension"
                  id="duplicate-file-dialog-extension"
                >
                  .md
                </span>
              </span>
            </label>
            {storageError ? (
              <p className="duplicate-file-dialog__message" role="status">
                {storageError}
              </p>
            ) : null}
            <div className="note-actions duplicate-file-dialog__actions">
              <button
                disabled={duplicateFileDialog.isSubmitting}
                onClick={closeDuplicateFileDialog}
                type="button"
              >
                {t("duplicate.cancel")}
              </button>
              <button
                className="is-primary"
                disabled={duplicateFileDialog.isSubmitting}
                type="submit"
              >
                {duplicateFileDialog.isSubmitting
                  ? t("duplicate.submitting")
                  : t("duplicate.submit")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {dropboxDirectoryPicker ? (
        <div
          className="dropbox-directory-dialog-backdrop"
          onMouseDown={closeDropboxDirectoryPicker}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={handleDropboxDirectoryBackdropWheel}
        >
          <section
            aria-labelledby="dropbox-directory-dialog-title"
            aria-modal="true"
            className="dropbox-directory-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="dropbox-directory-dialog__header">
              <h2 id="dropbox-directory-dialog-title">{t("dropbox.picker.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                className="dropbox-directory-dialog__close"
                disabled={dropboxDirectoryPicker.isOpening}
                onClick={closeDropboxDirectoryPicker}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="dropbox-directory-dialog__body">
              <div className="dropbox-directory-dialog__navigation is-root">
                <span title={dropboxDirectoryPicker.selectedPath || "Dropbox"}>
                  {dropboxDirectoryPicker.selectedPath || "Dropbox"}
                </span>
              </div>
              {dropboxDirectoryPicker.isLoadingRoot ? (
                <p className="dropbox-directory-dialog__status" role="status">
                  {t("dropbox.picker.loading")}
                </p>
              ) : null}
              {!dropboxDirectoryPicker.isLoadingRoot &&
              visibleDropboxPickerDirectories.length > 0 ? (
                <div
                  aria-label={t("dropbox.picker.directoryList")}
                  className="dropbox-directory-dialog__list"
                  onWheel={handleDropboxDirectoryListWheel}
                  role="listbox"
                >
                  {visibleDropboxPickerDirectories.map(({ node: directory, depth }) => {
                    const isSelected = directory.path === dropboxDirectoryPicker.selectedPath;
                    const rowStyle = {
                      "--dropbox-directory-indent": `${depth * 18}px`,
                    } as CSSProperties;

                    return (
                      <div
                        aria-selected={isSelected}
                        className={`dropbox-directory-dialog__row ${
                          directory.isExpanded ? "is-expanded" : ""
                        } ${directory.isLoading ? "is-loading" : ""} ${
                          isSelected ? "is-selected" : ""
                        }`}
                        key={directory.path}
                        role="option"
                        style={rowStyle}
                        title={directory.path}
                      >
                        <button
                          aria-expanded={directory.isExpanded}
                          aria-label={t("dropbox.picker.enterFolder", {
                            name: directory.title,
                          })}
                          className="dropbox-directory-dialog__row-toggle"
                          disabled={dropboxDirectoryPicker.isOpening || directory.isLoading}
                          onClick={() => void toggleDropboxPickerDirectory(directory.path)}
                          type="button"
                        >
                          {directory.isLoading ? "..." : directory.isExpanded ? "⌄" : "›"}
                        </button>
                        <button
                          className="dropbox-directory-dialog__row-main"
                          disabled={dropboxDirectoryPicker.isOpening}
                          onClick={() => {
                            if (isMobileViewport && isSelected) {
                              void openSelectedDropboxDirectory(directory.path);
                              return;
                            }

                            setDropboxDirectoryPicker((currentPicker) =>
                              currentPicker
                                ? { ...currentPicker, selectedPath: directory.path }
                                : currentPicker,
                            );
                          }}
                          onDoubleClick={() => void openSelectedDropboxDirectory(directory.path)}
                          type="button"
                        >
                          <DocumentGlyphIcon kind="folder" selected={isSelected} />
                          <span>{directory.title}</span>
                        </button>
                        {directory.error ? (
                          <p className="dropbox-directory-dialog__row-message" role="status">
                            {directory.error}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {dropboxDirectoryPicker.error ? (
                <p className="dropbox-directory-dialog__message" role="status">
                  {dropboxDirectoryPicker.error}
                </p>
              ) : null}
            </div>
            <div className="note-actions dropbox-directory-dialog__actions">
              <button
                disabled={dropboxDirectoryPicker.isOpening}
                onClick={closeDropboxDirectoryPicker}
                type="button"
              >
                {t("dropbox.picker.cancel")}
              </button>
              <button
                className="is-primary"
                disabled={
                  dropboxDirectoryPicker.isLoadingRoot ||
                  dropboxDirectoryPicker.isOpening ||
                  !dropboxDirectoryPicker.selectedPath
                }
                onClick={() => void openSelectedDropboxDirectory()}
                type="button"
              >
                {dropboxDirectoryPicker.isOpening
                  ? t("dropbox.picker.opening")
                  : t("dropbox.picker.open")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsViewOpen ? (
        <SettingsView
          closeButtonRef={settingsCloseButtonRef}
          customSections={settingsCustomSections}
          initialCategory={settingsInitialCategory}
          values={settingsSnapshot}
          t={t}
          onChange={updateSettingValue}
          onClose={closeSettingsView}
          onResetAllSettings={resetAllSettingValues}
          onResetSetting={resetSettingValue}
        />
      ) : null}

      <section className="editor-pane" aria-label={t("app.markdownEditor")}>
        <div className="editor-grid">
          <div className="editor-surface" style={editorSurfaceStyle}>
            {documentSearchVisible && isMobileViewport && documentSearchOpen ? (
              <div
                aria-hidden="true"
                className="document-search-backdrop"
                onClick={closeDocumentSearch}
              />
            ) : null}
            {documentSearchVisible ? (
              <form
                aria-label={t("documentSearch.label")}
                className="document-search"
                data-expanded={documentSearchOpen ? "true" : "false"}
                onSubmit={(event) => {
                  event.preventDefault();
                  moveDocumentSearch(1);
                }}
              >
                <label className="document-search__field">
                  <SearchIcon />
                  <input
                    aria-label={t("documentSearch.label")}
                    autoComplete="off"
                    placeholder={t("documentSearch.placeholder")}
                    ref={documentSearchInputRef}
                    type="search"
                    value={documentSearchQuery}
                    onChange={(event) => updateDocumentSearchQuery(event.target.value)}
                    onFocus={() => {
                      if (isMobileViewport) {
                        setDocumentSearchOpen(true);
                      }
                    }}
                    onKeyDown={handleDocumentSearchInputKeyDown}
                    onPointerDown={() => {
                      if (isMobileViewport) {
                        setDocumentSearchOpen(true);
                      }
                    }}
                  />
                  {documentSearchQuery ? (
                    <button
                      aria-label={t("documentSearch.clear")}
                      className="document-search__clear"
                      onClick={clearDocumentSearch}
                      type="button"
                    >
                      <SearchCloseIcon />
                    </button>
                  ) : null}
                </label>
                <span className="document-search__status" role="status">
                  {documentSearchStatus}
                </span>
                <button
                  aria-label={t("documentSearch.previous")}
                  className="document-search__button"
                  disabled={documentSearchMatchCount <= 0}
                  onClick={() => moveDocumentSearch(-1)}
                  type="button"
                >
                  <SearchPreviousIcon />
                </button>
                <button
                  aria-label={t("documentSearch.next")}
                  className="document-search__button"
                  disabled={documentSearchMatchCount <= 0}
                  onClick={() => moveDocumentSearch(1)}
                  type="button"
                >
                  <SearchNextIcon />
                </button>
                <button
                  aria-label={t("documentSearch.close")}
                  className="document-search__button"
                  onClick={closeDocumentSearch}
                  type="button"
                >
                  <SearchCloseIcon />
                </button>
              </form>
            ) : null}
            {annotationToolsAvailable ? (
              <div
                aria-label={t("app.editorTools")}
                className="editor-toolbar"
                data-expanded={noteModeEnabled ? "true" : "false"}
              >
                <button
                  aria-label={`${t("toolbar.editorMode")}: ${
                    editorMode === "edit" ? t("toolbar.sourceMode") : t("toolbar.previewMode")
                  }`}
                  aria-pressed={editorMode === "edit"}
                  className={`editor-mode-toggle ${editorMode === "edit" ? "is-active" : ""}`}
                  onClick={() =>
                    setEditorMode((currentMode) =>
                      currentMode === "preview" ? "edit" : "preview",
                    )
                  }
                  title={
                    editorMode === "edit"
                      ? t("toolbar.previewMode.open")
                      : t("toolbar.sourceMode.open")
                  }
                  type="button"
                >
                  <SourceModeIcon />
                </button>
                <span aria-hidden="true" className="editor-toolbar__divider" />
                <button
                  aria-checked={noteModeEnabled}
                  aria-label={
                    noteModeEnabled ? t("toolbar.noteMode.close") : t("toolbar.noteMode.open")
                  }
                  className="note-mode-switch note-mode-switch--primary"
                  onClick={toggleNoteMode}
                  role="switch"
                  type="button"
                >
                  <span className="note-mode-switch__label">{t("toolbar.noteMode")}</span>
                </button>
                <span
                  aria-hidden="true"
                  className="editor-toolbar__divider note-mode-switch--dependent"
                />
                <button
                  aria-checked={glossaryModeActive}
                  aria-hidden={!noteModeEnabled}
                  aria-label={
                    glossaryModeActive
                      ? t("toolbar.glossaryMode.close")
                      : t("toolbar.glossaryMode.open")
                  }
                  className="note-mode-switch note-mode-switch--secondary note-mode-switch--dependent"
                  disabled={!noteModeEnabled}
                  onClick={toggleGlossaryMode}
                  role="switch"
                  type="button"
                >
                  <span className="note-mode-switch__label">{t("toolbar.glossaryMode")}</span>
                </button>
              </div>
            ) : null}
            <div className="editor-content-frame">
            {!hasOpenDocument ? (
              <div className="empty-editor-state">
                <h2>
                  {workspaceHasMarkdownFileEntries
                    ? t("emptyDocumentSelection.title")
                    : t("emptyDirectory.title")}
                </h2>
                <p>
                  {workspaceHasMarkdownFileEntries
                    ? t("emptyDocumentSelection.description")
                    : t("emptyDirectory.description")}
                </p>
                <div className="mobile-empty-actions" aria-label={t("mobileSource.label")}>
                  {mobileSourceActions.map((action) => (
                    <button key={action.id} onClick={action.onSelect} type="button">
                      {action.icon}
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : editorMode === "preview" ? (
                <MilkdownMarkdownEditor
                  annotations={annotations}
                  documentFilePath={selectedDocument.filePath}
                  key={selectedDocument.id}
                  noteModeEnabled={noteModeEnabled}
                  readOnly={editorReadOnly}
                  search={documentSearchState}
                  toolbarEnabled={false}
                  value={selectedDocument.body}
                  onAnnotationClick={showAnnotationViewer}
                  onAnnotationDoubleClick={showAnnotationViewer}
                  onChange={updateSelectedDocumentBody}
                  onFocusTargetAnnotationPress={dismissFocusTargetAnnotationFromEditor}
                  onSearchMatchCountChange={handleDocumentSearchMatchCountChange}
                  onSelectionChange={handleSelectionChange}
                  onSelectionEnter={handleSelectionEnter}
                />
            ) : (
                <MarkdownEditor
                  annotations={annotations}
                  noteModeEnabled={noteModeEnabled}
                  readOnly={editorReadOnly}
                  search={documentSearchState}
                  value={selectedDocument.body}
                  onAnnotationClick={showAnnotationViewer}
                  onAnnotationDoubleClick={showAnnotationViewer}
                  onChange={updateSelectedDocumentBody}
                  onFocusTargetAnnotationPress={dismissFocusTargetAnnotationFromEditor}
                  onSearchMatchCountChange={handleDocumentSearchMatchCountChange}
                  onSelectionChange={handleSelectionChange}
                  onSelectionEnter={handleSelectionEnter}
                />
            )}
            </div>
          </div>
        </div>
      </section>

      {!settingsViewOpen && noteModeEnabled ? (
        <>
          <aside
            aria-label={t("noteLibrary.label")}
            className={`note-library-pane ${noteLibraryOpen ? "is-open" : ""} ${
              noteLibraryFocusActive ? "is-focus-active" : ""
            }`}
          >
            <button
              aria-expanded={noteLibraryOpen}
              aria-label={
                noteLibraryOpen
                  ? t("noteLibrary.bookmark.close")
                  : t("noteLibrary.bookmark.open")
              }
              className={`note-library-bookmark ${noteLibraryOpen ? "is-attached" : ""}`}
              onClick={toggleNoteLibrary}
              type="button"
            >
              <span aria-hidden="true" className="note-library-bookmark__label">
                {t("noteLibrary.bookmark.label")
                  .split("")
                  .map((character, index) => (
                    <span key={`${character}-${index}`}>{character}</span>
                  ))}
              </span>
            </button>
            <div className="note-library-header">
              <span>{noteLibraryNotes.length}</span>
              <button
                aria-label={t("noteLibrary.bookmark.close")}
                className="mobile-panel-close"
                onClick={() => closeNoteLibrary()}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="note-library-list">
              {noteLibraryNotes.length > 0 ? (
                noteLibraryNotes.map((note) => renderNoteLibraryCard(note))
            ) : (
              <p className="note-library-empty">{t("noteLibrary.empty")}</p>
            )}
          </div>
        </aside>
        {libraryNotePanelExpanded && expandedLibraryNote ? (
          <section
            aria-label={t("selectionNote.view")}
            className="note-library-expanded-panel"
            onWheel={handleLibraryNoteExpandedPanelWheel}
          >
            <div
              className="note-library-expanded-panel__card"
              data-note-tone={
                activeNoteToneById.get(expandedLibraryNote.id) ??
                expandedLibraryNote.tone ??
                0
              }
            >
              <div className="note-library-expanded-panel__header">
                <PinBadge ariaLabel={t("note.pin")} />
                <div className="note-library-expanded-panel__header-actions">
                  <button
                    className="note-library-expanded-panel__collapse-button"
                    type="button"
                    aria-label={t("note.collapse")}
                    title={t("note.collapse")}
                    onClick={closeLibraryNoteExpandedPanel}
                  >
                    <CollapsePanelIcon />
                  </button>
                </div>
              </div>
              <div
                className="note-library-expanded-panel__body-scroll"
                onWheel={handleLibraryNoteExpandedPanelWheel}
              >
                <NoteMarkdownEditor
                  ariaLabel={t("note.edit")}
                  className="note-library-expanded-panel__editor"
                  editing={activeNoteEditorKey === expandedLibraryNoteEditorKey}
                  value={expandedLibraryNote.body}
                  onChange={(value) =>
                    updateLibraryNoteDraft(expandedLibraryNote.id, value)
                  }
                  onCompositionStart={handleNoteEditorCompositionStart}
                  onCompositionEnd={handleNoteEditorCompositionEnd}
                  onEditingBlur={() =>
                    finishNoteEditorEditing(expandedLibraryNoteEditorKey)
                  }
                  onKeyDown={(event) =>
                    handleLibraryNoteEditorKeyDown(expandedLibraryNote.id, event)
                  }
                  onRequestEdit={() => {
                    setFocusedLibraryNoteId(expandedLibraryNote.id);
                    setActiveNoteEditorKey(expandedLibraryNoteEditorKey);
                  }}
                />
              </div>
              <div className="note-actions note-library-expanded-panel__actions">
                <button
                  className="is-danger"
                  type="button"
                  aria-label={t("note.delete")}
                  title={t("note.delete")}
                  onClick={() => deleteNote(expandedLibraryNote.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </section>
        ) : null}
        </>
      ) : null}

      {!settingsViewOpen ? (
        <nav className="mobile-command-bar" aria-label={t("app.editorTools")}>
          <button
            aria-label={
              directoryPaneOpen ? t("directory.bookmark.close") : t("directory.bookmark.open")
            }
            aria-pressed={directoryPaneOpen}
            className={directoryPaneOpen ? "is-active" : ""}
            onClick={toggleDirectoryPane}
            type="button"
          >
            <MobileFilesIcon />
            <span>{t("app.documents")}</span>
          </button>
          <button
            aria-label={`${t("toolbar.editorMode")}: ${
              editorMode === "edit" ? t("toolbar.sourceMode") : t("toolbar.previewMode")
            }`}
            aria-pressed={editorMode === "edit"}
            className={editorMode === "edit" ? "is-active" : ""}
            disabled={!hasOpenDocument}
            onClick={() =>
              setEditorMode((currentMode) =>
                currentMode === "preview" ? "edit" : "preview",
              )
            }
            type="button"
          >
            <SourceModeIcon className="mobile-command-bar__icon" />
            <span>{t("toolbar.sourceMode")}</span>
          </button>
          <button
            aria-checked={noteModeEnabled}
            aria-label={noteModeEnabled ? t("toolbar.noteMode.close") : t("toolbar.noteMode.open")}
            className={noteModeEnabled ? "is-active" : ""}
            disabled={!annotationToolsAvailable}
            onClick={toggleNoteMode}
            role="switch"
            type="button"
          >
            <MobileNoteIcon />
            <span>{t("toolbar.noteMode")}</span>
          </button>
          <button
            aria-checked={glossaryModeActive}
            aria-label={
              glossaryModeActive
                ? t("toolbar.glossaryMode.close")
                : t("toolbar.glossaryMode.open")
            }
            className={glossaryModeActive ? "is-active" : ""}
            disabled={!noteModeEnabled}
            onClick={toggleGlossaryMode}
            role="switch"
            type="button"
          >
            <MobileTermIcon />
            <span>{t("toolbar.glossaryMode")}</span>
          </button>
          <button
            aria-label={
              noteLibraryOpen
                ? t("noteLibrary.bookmark.close")
                : t("noteLibrary.bookmark.open")
            }
            aria-pressed={noteLibraryOpen}
            className={noteLibraryOpen ? "is-active" : ""}
            disabled={!noteModeEnabled}
            onClick={toggleNoteLibrary}
            type="button"
          >
            <MobileLibraryIcon />
            <span>{t("noteLibrary.bookmark.label")}</span>
          </button>
        </nav>
      ) : null}

      {!settingsViewOpen && storageError ? (
        <p className="mobile-storage-status" role="status">
          {storageError}
        </p>
      ) : null}

      {!settingsViewOpen && noteModeEnabled && selectionWarningPosition ? (
        <div className="selection-warning-popover" role="status" style={selectionWarningStyle}>
          {selectionWarningMessage}
        </div>
      ) : null}

      {!settingsViewOpen && floatingNotePanelShouldRender ? (
        <>
          {floatingNoteBackdropActive ? (
            <div
              aria-hidden="true"
              className={`note-edit-backdrop ${
                floatingNotePanelExpanded ? "is-passive" : ""
              }`}
              onClick={
                floatingNotePanelExpanded ? undefined : handleNotePanelOutsideModalInteraction
              }
              onMouseDown={
                floatingNotePanelExpanded ? undefined : handleNotePanelOutsideModalInteraction
              }
              onPointerDown={
                floatingNotePanelExpanded ? undefined : handleNotePanelOutsideModalInteraction
              }
              onWheel={
                floatingNotePanelExpanded ? undefined : blockNoteEditBackdropInteraction
              }
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
            } ${floatingNotePanelExpanded ? "is-expanded-sidebar" : ""} ${
              floatingPanelIsGlossary ? "is-glossary" : "is-note"
            }`}
            onBlur={handleFloatingNotePanelBlur}
            ref={notePanelRef}
            style={floatingNotePanelStyle}
            aria-label={
              pendingAnchor
                ? pendingAnchorIsGlossaryTerm
                  ? t("glossary.create")
                  : t("selectionNote.create")
                : activeGlossaryIsEditing
                  ? t("glossary.edit")
                  : activeGlossaryTerm
                    ? t("glossary.view")
                    : activeNoteIsEditing
                      ? t("selectionNote.edit")
                      : t("selectionNote.view")
            }
          >
            <div
              className="floating-note-card"
              data-note-tone={floatingNoteTone}
              ref={floatingNoteCardRef}
            >
              <div className="floating-note-card__header">
                <PinBadge ariaLabel={t("note.pin")} />
                <div className="floating-note-card__header-actions">
                  {floatingNoteCanExpand ? (
                    <button
                      className={`floating-note-panel-toggle-button ${
                        floatingNotePanelExpanded ? "is-expanded" : ""
                      }`}
                      type="button"
                      aria-label={
                        floatingNotePanelExpanded ? t("note.collapse") : t("note.expand")
                      }
                      aria-pressed={floatingNotePanelExpanded}
                      title={
                        floatingNotePanelExpanded ? t("note.collapse") : t("note.expand")
                      }
                      onClick={toggleFloatingNotePanelExpanded}
                    >
                      {floatingNotePanelExpanded ? <CollapsePanelIcon /> : <ExpandPanelIcon />}
                    </button>
                  ) : null}
                  <button
                    className="floating-note-close-button"
                    type="button"
                    aria-label={t("note.close")}
                    onClick={closeNotePanel}
                  >
                    ×
                  </button>
                </div>
              </div>
              {activeGlossaryTerm || pendingGlossaryTerm ? (
                <div className="bottom-note-context floating-note-card__context">
                  {activeGlossaryTerm ? (
                    <h2 className="glossary-panel-title">{activeGlossaryTerm.term}</h2>
                  ) : pendingGlossaryTerm ? (
                    <h2 className="glossary-panel-title">{pendingGlossaryTerm.term}</h2>
                  ) : null}
                </div>
              ) : null}

              {pendingAnchor && pendingGlossaryTerm ? (
                <div className="selection-confirmation">
                  <p>{t("selection.glossary.exists")}</p>
                  <MarkdownPreviewContent
                    className="bottom-note-body glossary-existing-definition"
                    emptyLabel={t("glossary.emptyDefinition")}
                    mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                    mermaidLoadingLabel={t("mermaid.loading")}
                    value={pendingGlossaryTerm.definition}
                  />
                  <div className="note-actions bottom-note-actions">
                    <button
                      className="selection-confirmation-button"
                      type="button"
                      onClick={rejectPendingGlossaryTerm}
                    >
                      {t("selection.glossary.unbind")}
                    </button>
                    <button
                      className="is-primary selection-confirmation-button"
                      type="button"
                      onClick={bindPendingGlossaryTerm}
                    >
                      {t("selection.glossary.bind")}
                    </button>
                  </div>
                </div>
              ) : null}

              {pendingAnchorCanCreateNote ? (
                <div className="selection-confirmation">
                  <p>{t("selection.note.prompt")}</p>
                  <div className="note-actions bottom-note-actions">
                    <button
                      className="is-primary selection-confirmation-button"
                      type="button"
                      aria-label={t("note.add.aria")}
                      title={t("note.add.aria")}
                      onClick={confirmPendingSelectionNote}
                    >
                      {t("note.add")}
                    </button>
                  </div>
                </div>
              ) : null}

              {!pendingAnchor && activeNote ? (
                <div className="floating-note-card__body-shell">
                  <div className="floating-note-card__body-measure">
                    <NoteMarkdownEditor
                      ariaLabel={t("note.edit")}
                      className="floating-note-card__editor"
                      editing={activeNoteEditorKey === noteEditorKey("floating", activeNote.id)}
                      editorRootRef={(element) => {
                        noteEditorRootRef.current = element;
                      }}
                      value={activeNote.body}
                      onChange={updateActiveNoteDraft}
                      onCompositionStart={handleNoteEditorCompositionStart}
                      onCompositionEnd={handleNoteEditorCompositionEnd}
                      onEditingBlur={() =>
                        finishNoteEditorEditing(noteEditorKey("floating", activeNote.id))
                      }
                      onKeyDown={handleNoteEditorKeyDown}
                      onRequestEdit={() =>
                        setActiveNoteEditorKey(noteEditorKey("floating", activeNote.id))
                      }
                    />
                  </div>
                </div>
              ) : null}

              {!pendingAnchor && activeGlossaryIsEditing ? (
                <NoteMarkdownEditor
                  ariaLabel={t("glossary.edit")}
                  className="floating-note-card__editor"
                  editorRootRef={(element) => {
                    noteEditorRootRef.current = element;
                  }}
                  value={glossaryDraft}
                  onChange={updateActiveGlossaryDraft}
                  onCompositionStart={handleNoteEditorCompositionStart}
                  onCompositionEnd={handleNoteEditorCompositionEnd}
                  onKeyDown={handleNoteEditorKeyDown}
                />
              ) : null}

              {!pendingAnchor && activeGlossaryTerm && !activeGlossaryIsEditing ? (
                <MarkdownPreviewContent
                  className="bottom-note-body"
                  emptyLabel={t("glossary.emptyDefinition")}
                  mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                  mermaidLoadingLabel={t("mermaid.loading")}
                  onDoubleClick={() => openGlossaryEditor(activeGlossaryTerm.id)}
                  value={activeGlossaryTerm.definition}
                />
              ) : null}

              {!pendingAnchor && activeGlossaryTerm && !activeGlossaryIsEditing ? (
                <div className="note-actions bottom-note-actions">
                  <button
                    type="button"
                    aria-label={t("glossary.edit")}
                    title={t("glossary.edit")}
                    onClick={() => openGlossaryEditor(activeGlossaryTerm.id)}
                  >
                    <PencilIcon />
                  </button>
                  {activeGlossaryBinding ? (
                    <button
                      className="is-glossary-action"
                      type="button"
                      aria-label={t("glossary.removeBinding")}
                      title={t("glossary.removeBinding")}
                      onClick={() => deleteGlossaryBinding(activeGlossaryBinding.id)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!pendingAnchor && activeNote ? (
                <div className="note-actions bottom-note-actions">
                  <button
                    className="is-danger"
                    type="button"
                    aria-label={t("note.delete")}
                    title={t("note.delete")}
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
