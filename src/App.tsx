import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CompositionEvent,
  createElement,
  Fragment,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
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
import { MarkdownEditor } from "./MarkdownEditor";
import type {
  AnnotationTone,
  EditorChangeSource,
  EditorSelectionHandle,
  EditorSelectionSnapshot,
  TextAnnotation,
  TextSelectionAnchor,
  TextSelectionEnterContext,
} from "./editorTypes";
import {
  anchorMatchesBodyText,
  hasRenderableAnchor,
  makeAnchorFromRange,
  normalizeSelectionTextForComparison,
  refreshAnchor,
  textEditFromBodyChange,
  textSelectionAnchorsMatch,
  transformAnchorRangeWithTextEdits,
  type MarkdownTextEdit,
} from "./annotationAnchor";
import {
  createAutosaveCoordinator,
  hasDirtyState,
  patchDirtyDocumentStates,
  reconcileDirtyAfterSavedSnapshot,
  sidecarFingerprint,
  type DirtyDocumentState,
  type DirtyDocumentStates,
} from "./autosave";
import type {
  GlossaryBinding,
  GlossaryTerm,
  NoteStatus,
  SelectionNote,
} from "./documentTypes";
import {
  documentSearchHistoryAction,
  documentSearchMoveDeltaForKeyDown,
  isDocumentSearchSelectAllShortcut,
  type DocumentSearchState,
} from "./documentSearch";
import {
  draftDocumentCreatedAt,
  draftDocumentHasContent,
  draftDocumentId,
  draftDocumentSource,
  isDraftDocumentId,
  parseStoredDraftDocument,
  serializeStoredDraftDocument,
} from "./draftDocuments";
import {
  availableDocumentTabIds,
  availableDocumentTabSession,
  createDocumentTabSession,
  documentTabClickSelection,
  documentTabIdsAfterOpening,
  documentTabIdAtPoint,
  documentTabsAfterClosing,
  documentTabsAfterClosingOthers,
  parseDocumentTabSession,
  type DocumentTabSessionState,
} from "./documentTabs";
import { shouldHandlePreviewSelectAllShortcut } from "./editorKeyboardShortcuts";
import {
  fileNameTextIsTruncated,
  fileNameTooltipPosition,
} from "./fileNameTooltip";
import {
  anchoredFloatingNoteGeometry,
  floatingNoteViewportRectWithinHorizontalBounds,
} from "./floatingNotePosition";
import {
  containWheelInPanel,
  panelScrollTargetCanConsumeWheel,
} from "./expandedPanelWheel";
import { SettingsView } from "./SettingsView";
import appIconUrl from "../src-tauri/icons/128x128@2x.png";
import fileSelectedGlyphUrl from "./assets/file-selected-glyph.png";
import fileGlyphUrl from "./assets/file-glyph.png";
import folderGlyphSvg from "./assets/folder-glyph.svg?raw";
import folderSelectedGlyphSvg from "./assets/folder-selected-glyph.svg?raw";
import collapseIconSvg from "./assets/collapse.svg?raw";
import expandIconSvg from "./assets/expand.svg?raw";
import plusSignIconSvg from "./assets/plus-sign.svg?raw";
import priceTagIconSvg from "./assets/price-tag.svg?raw";
import { appLanguageHtmlLang, createTranslator, type TranslationKey } from "./i18n";
import { localRecoveryErrorTranslationKey } from "./localRecoveryError";
import {
  loadedGlossaryBindingForDocument,
  loadedNoteForDocument,
  projectLoadedLocalFiles,
} from "./loadedFileProjection";
import { renderScholiumMermaid } from "./mermaid";
import { observeReadingDiagrams, retainDiagramTextEditor } from "./mermaidReading";
import {
  markdownTagDedupeKey as tagDedupeKey,
  markdownHasMalformedFrontmatter,
  normalizeMarkdownTag as normalizeTagInput,
  readMarkdownTags,
  stripMarkdownFrontmatter,
  writeMarkdownTags,
} from "./markdownFrontmatter";
import { resolveMarkdownLinkTarget } from "./markdownLinkTarget";
import {
  closestTextIndex,
  findNonOverlappingTextIndices,
  markdownLineStartOffsets as getLineStartOffsets,
} from "./markdownInlineTextMap";
import {
  parseMarkdownListLine,
  parseMarkdownPreviewBlocks,
  replaceMarkdownBlock,
  parseNoteMarkdownPreviewBlocks,
  removeSelectedPreviewSoftLine,
  type MarkdownPreviewBlock,
  type MarkdownPreviewList,
  type MarkdownPreviewListKind,
  type NoteMarkdownPreviewBlock,
  type ParsedMarkdownListLine,
} from "./markdownPreview";
import { isCommentedFileTreeCodeBlock } from "./textDiagramPreview";
import {
  createNoteEditorHistory,
  recordNoteEditorChange,
  takeNoteEditorRedo,
  takeNoteEditorUndo,
} from "./noteEditorHistory";
import {
  sortWorkspaceEntriesForDirectory,
  type WorkspaceSortMode,
} from "./workspaceSort";
import {
  currentWindowWorkspaceStorage,
  workspaceStorageKeys,
} from "./workspaceStorage";
import {
  ancestorDirectoryPathsForFile,
  dropboxDocumentId,
  dropboxDocumentIdPrefix,
  dropboxParentDirectoryPath,
  ensureMarkdownExtension,
  fileNameFromPath,
  filePathInDirectory,
  isDropboxDocumentId,
  localPathIsInsideDirectory,
  localPathsMatch,
  normalizeLocalPathForCompare,
  parentDirectoryPath,
  stripMarkdownExtension,
  workspacePathIsInsideDirectory,
} from "./workspacePaths";
import {
  lastOpenedFileAmong,
  lastOpenedFileInDirectory,
  parseRecentOpenedFiles,
  recentOpenedFilesAfterOpening,
  recentOpenedFilesStorageKey,
  recentOpenedFilesWithout,
  type RecentOpenedFileSource,
} from "./recentOpenedFiles";
import {
  collapseWorkspaceDirectory,
  collectVisibleDescendantDirectoryKeys,
  directoryTreeKey,
  documentFromLoadedFileResult,
  documentIsFromDropbox,
  dropboxPickerNodesFromOpenedDirectory,
  filterWorkspaceEntriesForSearch,
  firstDropboxMarkdownFileEntry,
  flattenDropboxDirectoryPickerNodes,
  insertOrUpdateWorkspaceFileEntry,
  insertWorkspaceDirectoryChildren,
  updateDropboxDirectoryPickerNode,
  workspaceEntriesFromOpenedDirectory,
  workspaceEntriesFromOpenedDropboxDirectory,
  workspaceEntryFromDocument,
  workspaceEntrySelectionKey,
  type DropboxDirectoryPickerState,
  type DropboxPickerMode,
  type MarkdownDocument,
  type WorkspaceEntry,
  type WorkspaceFileEntry,
} from "./workspaceEntries";
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
import {
  checkDropboxConnection,
  listFileLinkTargets,
  openLinkedFile,
  completeDropboxOAuth as requestDropboxOAuthCompletion,
  createDropboxMarkdownDirectory,
  createDropboxMarkdownFile as createDropboxMarkdownFileRequest,
  createMarkdownDirectory,
  createNewWindow,
  deleteDropboxMarkdownDirectory,
  deleteDropboxMarkdownFile,
  deleteMarkdownDirectory,
  deleteMarkdownFile,
  disconnectDropbox,
  dropboxOAuthStatus,
  duplicateDropboxMarkdownFile,
  duplicateMarkdownFile,
  listDropboxMarkdownDirectory,
  openDropboxMarkdownFile,
  openMarkdownDirectory,
  openMarkdownFile,
  openMarkdownFileContext,
  readDropboxMarkdownBody,
  rememberRecentLocation,
  renameDropboxMarkdownDirectory,
  renameDropboxMarkdownFile,
  renameMarkdownDirectory,
  renameMarkdownFile,
  saveDropboxMarkdownFile,
  saveMarkdownFile,
  savedLocations as loadSavedLocations,
  searchMarkdownFiles,
  setAppLanguage,
  setCurrentDirectoryLocation,
  setNativeFolderPickerListView,
  startDropboxOAuth,
  takeNewWindowDocumentTarget,
  takeOpenedFilePaths,
  resolveTypedMarkdownPath,
  storeDraftDocument,
  listStoredDraftDocuments,
  deleteStoredDraftDocument,
  validateDroppedMarkdownPath,
  focusAndFullscreenAppWindow,
  writePdfFile,
  writePdfFileToDirectory,
  type DropboxOAuthStatusResult,
  type NativeLocation,
  type OpenLocationEventPayload,
  type OpenDropboxMarkdownDirectoryResult,
  type OpenDropboxMarkdownFileResult,
  type OpenMarkdownDirectoryResult,
  type OpenMarkdownFileContextResult,
  type OpenMarkdownFileResult,
  type RenamePathResult,
  type SavedLocationsResult,
  type SearchMarkdownFileResult as SearchMarkdownFileTransportResult,
  type WorkspaceSource,
  type WritePdfFileResult,
} from "./tauriGateway";
import { createTextContextMenu } from "./textContextMenu";
import { preserveEditorContextMenuSelection } from "./contextMenuSelection";
import { clearTouchButtonFocus } from "./touchPointer";

const inlineBreakPattern = /<br\s*\/?>/gi;
const annotationClickDelayMs = 500;
const libraryAnnotationClickSuppressionMs = annotationClickDelayMs + 350;
const mobileContextMenuLongPressMs = 500;
const mobileContextMenuLongPressMoveTolerancePx = 10;
const fileNameTooltipHoverDelayMs = 250;
const fileNameTooltipId = "file-name-tooltip";
const mobileFileContextMenuTitleHeight = 96;
const pendingAnchorAnnotationId = "__scholium_pending_anchor__";

type AnnotationKind = "note" | "glossary";

type TextRangeAnnotation = {
  anchor: TextSelectionAnchor;
  id: string;
  isFocusTarget?: boolean;
  kind: AnnotationKind;
  status: NoteStatus;
  tone?: AnnotationTone;
};

type LibraryAnnotationPointerEvent = {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: EventTarget | null;
};

type SearchMarkdownFileResult = SearchMarkdownFileTransportResult & {
  entry?: WorkspaceFileEntry;
};

type FileSearchMode = "files" | "tags";

type DocumentTagGroup = {
  key: string;
  label: string;
  entries: WorkspaceFileEntry[];
};

type DocumentTagSuggestionGroup = {
  key: string;
  label: string;
  documentCount: number;
};

type DropboxIndexedDocumentTags = {
  documentId: string;
  tags: string[];
};

type LastOpenedDropboxWorkspaceState = {
  workspacePath: string;
  filePath: string;
  updatedAt: number;
};

type MobileStartupPhase = "hidden" | "restoring" | "welcome";

const emptySavedLocations: SavedLocationsResult = {
  recent: [],
  favoriteDirectories: [],
};

type DropboxOAuthCallbackPayload = {
  status: "success" | "error";
  code?: string | null;
  state?: string | null;
  error?: string | null;
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
type DocumentTabBehavior = "replace" | "add" | "none";

type DocumentModeState = {
  editorMode: EditorMode;
  noteModeEnabled: boolean;
  glossaryModeEnabled: boolean;
};

type EditorFocusRequest = {
  documentId: string;
  mode: EditorMode;
  requestKey: number;
  selection: EditorSelectionSnapshot | null;
};

type EditorModeScrollSnapshot = {
  scrollContainer: Element;
  scrollLeft: number;
  scrollTop: number;
};

type DocumentScrollPosition = {
  scrollLeft: number;
  scrollTop: number;
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
  kind: "file";
  documentId: string;
  path: string;
  title: string;
  source?: WorkspaceSource;
};

type DirectoryActionTarget = {
  kind: "directory";
  path: string;
  title: string;
  source?: WorkspaceSource;
};

type WorkspaceActionTarget = FileActionTarget | DirectoryActionTarget;

type FileContextMenuState = WorkspaceActionTarget & {
  exportDocumentIds: string[];
  left: number;
  top: number;
};

type FileNameTooltipState = {
  anchorRect: Pick<DOMRect, "right" | "top">;
  detail?: string;
  key: string;
  position: { left: number; top: number } | null;
  title: string;
};

type DocumentTabContextMenuState = {
  documentId: string;
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

type RenameDialogState = WorkspaceActionTarget & {
  name: string;
  isSubmitting: boolean;
};

type OpenPathDialogState = {
  path: string;
  isSubmitting: boolean;
  error: string;
};

const typedPathErrorTranslationKeys: Record<string, TranslationKey> = {
  "typed path is empty": "openPath.error.empty",
  "typed path must be absolute": "openPath.error.notAbsolute",
  "typed path does not exist": "openPath.error.notFound",
  "typed file is not a Markdown file": "openPath.error.notMarkdown",
};

type CreateEntryDialogState = {
  kind: "file" | "folder";
  name: string;
  isSubmitting: boolean;
};

type DraftFileDialogState = {
  documentId: string;
  reason: "save" | "close";
  name: string;
  isSubmitting: boolean;
  error: string;
};

type DraftFileDecision =
  | { action: "created"; documentId: string }
  | { action: "discarded" }
  | { action: "cancelled" };

type DraftDocumentSaveResult =
  | { status: "saved"; documentId: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

function DocumentGlyphIcon({ kind, selected = false }: { kind: "file" | "folder"; selected?: boolean }) {
  if (kind === "file") {
    const maskImage = `url("${selected ? fileSelectedGlyphUrl : fileGlyphUrl}")`;

    return (
      <span
        aria-hidden="true"
        className={`document-icon ${selected ? "is-selected" : ""}`}
      >
        <span
          className="document-icon__flaticon-book"
          style={{ maskImage, WebkitMaskImage: maskImage }}
        />
      </span>
    );
  }

  const glyphSvg =
    selected ? folderSelectedGlyphSvg : folderGlyphSvg;

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

function NoteCopyIcon() {
  return (
    <span
      aria-hidden="true"
      className="note-action-icon note-copy-icon"
    />
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

function OpenTabIcon() {
  return (
    <svg
      aria-hidden="true"
      className="note-action-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M4 6.5h6l2 2h8v9H4z" />
      <path d="M8 13h8" />
      <path d="M12 9v8" />
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

function FloatingNoteCopyIcon() {
  return (
    <span
      aria-hidden="true"
      className="floating-note-action-icon floating-note-action-icon--copy"
    />
  );
}

function FloatingNoteExpandIcon() {
  return (
    <span
      aria-hidden="true"
      className="floating-note-action-icon floating-note-action-icon--expand"
    />
  );
}

function FloatingNoteCollapseIcon() {
  return (
    <span
      aria-hidden="true"
      className="floating-note-action-icon floating-note-action-icon--collapse"
    />
  );
}

function FloatingNoteCheckIcon() {
  return (
    <svg aria-hidden="true" className="floating-note-action-icon" viewBox="4 5 16 14">
      <path d="M9.4 17.6a1.2 1.2 0 0 1-1.7 0l-3.5-3.5a1.2 1.2 0 0 1 1.7-1.7l2.6 2.6 9.1-9.1a1.2 1.2 0 1 1 1.7 1.7Z" />
    </svg>
  );
}

function FloatingNoteCloseIcon() {
  return (
    <span
      aria-hidden="true"
      className="floating-note-action-icon floating-note-action-icon--close"
    />
  );
}

function MobileFilesIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="currentColor"
      viewBox="0 0 512 512"
    >
      <path d="m278.72 120h233.28v-45h-265.424z" />
      <path d="m188.281 45h-188.281v422h512v-317h-248.719z" />
    </svg>
  );
}

function MobileNoteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="currentColor"
      viewBox="0 0 511.8 511.8"
    >
      <path d="m0 360.875h37v30h-37z" />
      <path d="m0 240.875h37v30h-37z" />
      <path d="m0 120.875h37v30h-37z" />
      <path d="m375 151.65v-107.78h-338v77h67v30h-67v90h67v30h-67v90h67v30h-67v77.06h338v-173.01l-114.23 113.98h-70.21v-73.22zm-219-30.78h136v30h-136zm0 90v-30h72v30z" />
      <path d="m467.16 160.59c-52.453 52.332-165.63 165.257-218.8 218.31h-27.8v-30.78c44.053-43.953 175.388-174.99 217.31-216.82z" />
      <path d="m511.8 116.05-23.4 23.34-29.29-29.29 23.46-23.4z" />
    </svg>
  );
}

function MobileTermIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="currentColor"
      viewBox="0 0 512 512"
    >
      <path d="m272.49 79.237h76.335v87.144h-76.335z" />
      <path d="m142.5 347.286h6.131v-347.286h-12.869c-34.576 0-62.705 28.129-62.705 62.705v342.998c5.749-33.134 34.689-58.417 69.443-58.417z" />
      <path d="m385.031 377.286v81h53.223v-29.967h-25.351v-51.033z" />
      <path d="m142.5 458.286h113.5v-81h-113.5c-22.332 0-40.5 18.168-40.5 40.5s18.168 40.5 40.5 40.5z" />
      <path d="m438.943 347.286v-347.286h-260.378v347.286zm-196.387-297.983h136.203v147.012h-136.203zm-.415 173.379h136.44v29.934h-136.44zm136.44 52.975v29.934h-136.44v-29.934z" />
      <path d="m356.031 378.286h-71.031v133.25l35.903-20.828 35.128 21.292z" />
    </svg>
  );
}

function MobileLibraryIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="currentColor"
      viewBox="0 0 510 510"
    >
      <path d="m210.785 180h194.215v-180h-300v120h30.785zm74.215-135h60v60h-30v-30h-30zm0 90h-60v-30h60zm-120-90h60v30h-30v30h-30z" />
      <path d="m0 510h510v-210h-510zm390-90h60v30h-60zm-330 0h30v30h-30z" />
      <path d="m200.262 210-75-60h-125.262v120h510v-60z" />
    </svg>
  );
}

function MobileToolbarCloudIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mobile-command-bar__icon"
      fill="currentColor"
      viewBox="0 0 512 512"
    >
      <path d="m406 361c57.891 0 106-47.109 106-105 0-52.808-40.185-96.636-91.015-103.931.015-.351.015-.717.015-1.069 0-66.167-53.833-120-120-120-34.321 0-66.914 14.897-89.59 40.415-14.165-6.841-29.634-10.415-45.41-10.415-56.382 0-102.524 44.678-104.897 100.488-36.373 17.227-61.103 53.907-61.103 94.512 0 57.891 48.109 105 106 105h135v60h-60v15h-181v30h181v15h150v-15h181v-30h-181v-15h-60v-60z" />
    </svg>
  );
}

function SourceModeIcon({ className = "editor-mode-toggle__icon" }: { className?: string }) {
  return <span aria-hidden="true" className={className} />;
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

function MobileCloudIcon({ className = "mobile-source-action__icon" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
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
  maxWidth: number;
  top: number;
  placement: "above" | "below" | "detached";
};

type FloatingNoteAnchorLock = {
  key: string;
  panelEdgeOffset: number;
  placement: "above" | "below";
};

type PreviewTextMap = {
  text: string;
  sourceOffsets: Array<number | null>;
  sourceEndOffset?: number | null;
};

type BodyAnchorTransform = (
  anchor: TextSelectionAnchor,
  nextBody: string,
) => TextSelectionAnchor;

const markdownFilters = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown"],
  },
];

const noteLibraryFocusAlignmentRatio = 0.35;
const notePanelAnimationMs = 180;
const selectionWarningAutoDismissMs = 2600;
const storageFeedbackAutoDismissMs = 3000;
const appDrivenSelectionClearGuardMs = 1200;
const autosaveDelayMs = 500;
const externalFileRefreshIntervalMs = 1500;
const dropboxExternalFileRefreshIntervalMs = 30_000;
const dropboxOAuthCompletionTimeoutMs = 50_000;
const {
  lastOpenedMarkdownPath: lastOpenedMarkdownPathStorageKey,
  lastOpenedMarkdownRootDirectory: lastOpenedMarkdownRootDirectoryStorageKey,
  lastOpenedDropboxWorkspace: lastOpenedDropboxWorkspaceStorageKey,
  documentTabSession: documentTabSessionStorageKey,
} = workspaceStorageKeys;
const mobileViewportQuery = "(max-width: 640px)";
const mobileSafeLayoutViewportQuery =
  "((max-width: 640px) and (any-pointer: coarse)), ((max-width: 980px) and (max-height: 520px) and (any-pointer: coarse))";
const configuredDropboxAppKey = import.meta.env.VITE_DROPBOX_APP_KEY?.trim() ?? "";

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

  return makeAnchorFromRange(body, safeFrom, safeTo, selectedText);
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

function compareNotesByDocumentPosition(left: SelectionNote, right: SelectionNote) {
  return (
    left.anchor.from - right.anchor.from ||
    left.anchor.to - right.anchor.to ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function noteAnchorRangeKey(anchor: TextSelectionAnchor) {
  return `${anchor.from}:${anchor.to}`;
}

function buildVisibleNoteToneMap(notes: SelectionNote[]) {
  const noteToneById = new Map<string, AnnotationTone>();
  let rangeIndex = -1;
  let previousRangeKey = "";

  notes
    .filter((note) => note.status === "active" && hasRenderableAnchor(note.anchor))
    .slice()
    .sort(compareNotesByDocumentPosition)
    .forEach((note) => {
      const rangeKey = noteAnchorRangeKey(note.anchor);
      if (rangeKey !== previousRangeKey) {
        rangeIndex += 1;
        previousRangeKey = rangeKey;
      }
      noteToneById.set(note.id, (rangeIndex % 2) as AnnotationTone);
    });

  return noteToneById;
}

function assignAnnotationTones(
  annotations: TextRangeAnnotation[],
  noteToneById = new Map<string, AnnotationTone>(),
): TextRangeAnnotation[] {
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

      const tone =
        noteToneById.get(annotation.id) ??
        annotation.tone ??
        ((noteToneIndex % 2) as AnnotationTone);
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

function glossarySelectionBoundaryCharacter(character: string) {
  return /[\s.,，。!?！？;；:：、"'“”‘’()[\]{}《》〈〉【】]/u.test(character);
}

function normalizeGlossarySelectionAnchor(anchor: TextSelectionAnchor) {
  let leadingLength = 0;
  for (const character of anchor.selectedText) {
    if (!glossarySelectionBoundaryCharacter(character)) break;
    leadingLength += character.length;
  }

  let trailingLength = 0;
  for (const character of Array.from(anchor.selectedText.slice(leadingLength)).reverse()) {
    if (!glossarySelectionBoundaryCharacter(character)) break;
    trailingLength += character.length;
  }

  const selectedText = anchor.selectedText.slice(
    leadingLength,
    anchor.selectedText.length - trailingLength,
  );
  if (!selectedText) return null;

  return {
    ...anchor,
    from: anchor.from + leadingLength,
    to: anchor.to - trailingLength,
    selectedText,
    prefix: `${anchor.prefix}${anchor.selectedText.slice(0, leadingLength)}`.slice(-48),
    suffix: `${anchor.selectedText.slice(anchor.selectedText.length - trailingLength)}${
      anchor.suffix
    }`.slice(0, 48),
  };
}

function isGlossarySelectionCandidate(anchor: TextSelectionAnchor) {
  const normalizedAnchor = normalizeGlossarySelectionAnchor(anchor);
  if (!normalizedAnchor) return false;

  return (
    !/[\r\n]/.test(normalizedAnchor.selectedText) &&
    /[\p{L}\p{N}]/u.test(normalizedAnchor.selectedText)
  );
}

function selectionOverlapsNote(anchor: TextSelectionAnchor, note: SelectionNote) {
  return anchor.to > note.anchor.from && anchor.from < note.anchor.to;
}

function selectionOverlapsGlossaryBinding(anchor: TextSelectionAnchor, binding: GlossaryBinding) {
  return anchor.to > binding.anchor.from && anchor.from < binding.anchor.to;
}

function hasNativeStorageAccess() {
  return "__TAURI_INTERNALS__" in window;
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
    return currentWindowWorkspaceStorage().getItem(lastOpenedMarkdownPathStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

function readDocumentTabSession() {
  try {
    return parseDocumentTabSession(
      currentWindowWorkspaceStorage().getItem(documentTabSessionStorageKey),
    );
  } catch {
    return null;
  }
}

function rememberDocumentTabSession(session: DocumentTabSessionState | null) {
  try {
    if (session) {
      currentWindowWorkspaceStorage().setItem(documentTabSessionStorageKey, JSON.stringify(session));
    } else {
      currentWindowWorkspaceStorage().removeItem(documentTabSessionStorageKey);
    }
  } catch {
    // Remembering open tabs is best-effort only.
  }
}

function documentTabSessionForWorkspace(
  source: WorkspaceSource,
  workspacePath: string,
) {
  const session = readDocumentTabSession();
  if (
    session?.source !== source ||
    !localPathsMatch(session.workspacePath, workspacePath)
  ) {
    return null;
  }

  return session;
}

function rememberLastOpenedMarkdownPath(path: string | null | undefined) {
  if (!path) return;

  try {
    currentWindowWorkspaceStorage().setItem(lastOpenedMarkdownPathStorageKey, path);
    forgetLastOpenedDropboxWorkspace();
  } catch {
    // Remembering the last file is best-effort only.
  }
}

function readLastOpenedMarkdownRootDirectoryPath() {
  try {
    return currentWindowWorkspaceStorage()
      .getItem(lastOpenedMarkdownRootDirectoryStorageKey)
      ?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberLastOpenedMarkdownRootDirectoryPath(path: string | null | undefined) {
  if (!path) return;

  try {
    currentWindowWorkspaceStorage().setItem(lastOpenedMarkdownRootDirectoryStorageKey, path);
    forgetLastOpenedDropboxWorkspace();
  } catch {
    // Remembering the last root directory is best-effort only.
  }
}

function forgetLastOpenedMarkdownRootDirectoryPath() {
  try {
    currentWindowWorkspaceStorage().removeItem(lastOpenedMarkdownRootDirectoryStorageKey);
  } catch {
    // Remembering the last root directory is best-effort only.
  }
}

function readLastOpenedDropboxWorkspace() {
  try {
    const rawValue = currentWindowWorkspaceStorage().getItem(
      lastOpenedDropboxWorkspaceStorageKey,
    );
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue) as Partial<LastOpenedDropboxWorkspaceState>;
    if (
      typeof parsedValue.workspacePath !== "string" ||
      typeof parsedValue.filePath !== "string"
    ) {
      return null;
    }

    return {
      workspacePath: parsedValue.workspacePath.trim(),
      filePath: parsedValue.filePath.trim(),
      updatedAt:
        typeof parsedValue.updatedAt === "number" && Number.isFinite(parsedValue.updatedAt)
          ? parsedValue.updatedAt
          : 0,
    };
  } catch {
    return null;
  }
}

function rememberLastOpenedDropboxWorkspace(
  workspacePath: string | null | undefined,
  filePath: string | null | undefined = "",
) {
  const nextState: LastOpenedDropboxWorkspaceState = {
    workspacePath: workspacePath?.trim() ?? "",
    filePath: filePath?.trim() ?? "",
    updatedAt: Date.now(),
  };

  try {
    currentWindowWorkspaceStorage().setItem(
      lastOpenedDropboxWorkspaceStorageKey,
      JSON.stringify(nextState),
    );
    forgetLastOpenedMarkdownPath();
    forgetLastOpenedMarkdownRootDirectoryPath();
  } catch {
    // Remembering the last Dropbox workspace is best-effort only.
  }
}

function forgetLastOpenedDropboxWorkspace() {
  try {
    currentWindowWorkspaceStorage().removeItem(lastOpenedDropboxWorkspaceStorageKey);
  } catch {
    // Remembering the last Dropbox workspace is best-effort only.
  }
}

function browserAppearsOffline() {
  return typeof navigator !== "undefined" && "onLine" in navigator && navigator.onLine === false;
}

function nativeLocationKey(location: Pick<NativeLocation, "source" | "kind" | "path">) {
  return `${location.source}:${location.kind}:${location.path}`;
}

function forgetLastOpenedMarkdownPath() {
  try {
    currentWindowWorkspaceStorage().removeItem(lastOpenedMarkdownPathStorageKey);
  } catch {
    // Remembering the last file is best-effort only.
  }
}

// Shared by all windows, so opening a folder anywhere shows the file last opened in it.
function readRecentOpenedFiles() {
  try {
    return parseRecentOpenedFiles(window.localStorage.getItem(recentOpenedFilesStorageKey));
  } catch {
    return [];
  }
}

function writeRecentOpenedFiles(files: ReturnType<typeof readRecentOpenedFiles>) {
  try {
    window.localStorage.setItem(recentOpenedFilesStorageKey, JSON.stringify(files));
  } catch {
    // Remembering recently opened files is best-effort only.
  }
}

function rememberRecentOpenedFile(source: RecentOpenedFileSource, path: string) {
  writeRecentOpenedFiles(recentOpenedFilesAfterOpening(readRecentOpenedFiles(), source, path));
}

function forgetRecentOpenedFile(source: RecentOpenedFileSource, path: string) {
  writeRecentOpenedFiles(recentOpenedFilesWithout(readRecentOpenedFiles(), source, path));
}

function readLastOpenedFileInDirectory(source: RecentOpenedFileSource, directoryPath: string) {
  return lastOpenedFileInDirectory(readRecentOpenedFiles(), source, directoryPath);
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
  if (sourceStart !== null) {
    target.sourceEndOffset = sourceStart + text.length;
  }
}

function appendTextMapSeparator(target: PreviewTextMap, separator: string) {
  appendTextMap(target, separator, null);
}

function appendPreviewTextMap(target: PreviewTextMap, source: PreviewTextMap) {
  target.text += source.text;
  target.sourceOffsets.push(...source.sourceOffsets);
  if (source.sourceEndOffset !== undefined) {
    target.sourceEndOffset = source.sourceEndOffset;
  }
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
    if (sourceStart !== null) {
      target.sourceEndOffset = sourceStart + index + token.length;
    }
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
  const textMap: PreviewTextMap = {
    text: "", sourceOffsets: [], sourceEndOffset: lineStartOffsets[block.startLine] ?? 0,
  };

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

function makePreviewAnchorFromTextMap(
  body: string,
  textMap: PreviewTextMap,
  selectedText: string,
  approximateStart: number,
) {
  const exactSelection = selectedText.trim();
  const normalizedSelection = selectedText.replace(/\s+/g, " ").trim();
  if (!normalizedSelection) return null;

  const exactIndex = closestTextIndex(
    findNonOverlappingTextIndices(textMap.text, exactSelection),
    approximateStart,
  );
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
    findNonOverlappingTextIndices(normalizedTextMap.text, normalizedSelection),
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
  if (anchorMatchesBodyText(body, anchor)) {
    return refreshAnchor(body, anchor);
  }

  const recoveredAnchor = makePreviewAnchor(body, anchor.selectedText);
  if (recoveredAnchor) return recoveredAnchor;

  return refreshAnchor(body, anchor);
}

function isMermaidLanguage(language: string) {
  return language.toLowerCase() === "mermaid";
}

function MermaidDiagram({
  definition,
  emptyDefinitionLabel,
  loadingLabel,
  renderErrorLabel,
  editing,
}: {
  definition: string;
  emptyDefinitionLabel: string;
  loadingLabel: string;
  renderErrorLabel: string;
  editing?: { change: (previous: string, next: string) => boolean; history: (redo: boolean) => string | undefined };
}) {
  const reactId = useId();
  const diagramId = `scholium-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const figureRef = useRef<HTMLElement | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [renderState, setRenderState] = useState<
    | { status: "rendering"; svg: ""; error: "" }
    | { status: "rendered"; svg: string; error: "" }
    | { status: "error"; svg: ""; error: string }
  >({ status: "rendering", svg: "", error: "" });
  const renderedDiagramHtml = useMemo(() => ({ __html: renderState.svg }), [renderState.svg]);

  useEffect(() => {
    if (figureRef.current && retainDiagramTextEditor(figureRef.current, definition)) return;
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
        const { svg } = await renderScholiumMermaid(diagramId, definition);

        if (!cancelled) {
          setRenderState({ status: "rendered", svg, error: "" });
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setRenderState({
            status: "error",
            svg: "",
            error: renderErrorLabel,
          });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [definition, diagramId, emptyDefinitionLabel, renderErrorLabel]);

  useEffect(() => {
    if (figureRef.current) return observeReadingDiagrams(figureRef.current, {
      canEdit: () => Boolean(editingRef.current),
      change: (_root, previous, next) => editingRef.current?.change(previous, next) ?? false,
      history: (_root, redo) => editingRef.current?.history(redo),
    });
  }, []);

  return (
    <figure ref={figureRef} className="mermaid-diagram" contentEditable={false}>
      {renderState.status === "rendered" ? (
        <div
          className="mermaid-diagram__svg"
          dangerouslySetInnerHTML={renderedDiagramHtml}
        />
      ) : renderState.status === "error" ? (
        <pre className="mermaid-diagram__error">{renderState.error}</pre>
      ) : (
        <div className="mermaid-diagram__loading">{loadingLabel}</div>
      )}
    </figure>
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
    return `${"#".repeat(block.level)} ${lines.join(" ").trim()}`;
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

function previewTextFromNode(node: Node): string {
  if (node instanceof Text) return node.data;
  if (node instanceof HTMLBRElement) return "\n";

  let text = "";
  Array.from(node.childNodes).forEach((child, index, children) => {
    const isBlockChild =
      child instanceof HTMLElement &&
      ["blockquote", "div", "li", "p", "pre"].includes(child.tagName.toLowerCase());
    if (isBlockChild && text && !text.endsWith("\n")) {
      text += "\n";
    }

    text += previewTextFromNode(child);

    if (isBlockChild && index < children.length - 1 && !text.endsWith("\n")) {
      text += "\n";
    }
  });

  return text;
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
    .map(previewTextFromNode)
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
    previewTextFromNode(node),
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
    return (
      markdownFromPreviewListElement(element) ??
      markdownFromPreviewBlock(block, previewTextFromNode(element))
    );
  }

  const text = previewTextFromNode(element);
  if (block.kind === "paragraph" && element.querySelector("br")) {
    return text
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("<br>")
      .replace(/(?:<br>)+$/, "");
  }

  return markdownFromPreviewBlock(block, text);
}

function markdownFromEditedPreviewBlockElements(
  block: MarkdownPreviewBlock,
  elements: HTMLElement[],
) {
  if (block.kind !== "paragraph" || elements.length <= 1) {
    return markdownFromEditedPreviewBlock(block, elements[elements.length - 1]);
  }

  return markdownFromPreviewBlock(
    block,
    elements.map(previewTextFromNode).join("\n"),
  );
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

function isRedoKeyboardShortcut(
  event: Pick<KeyboardEvent | ReactKeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
) {
  const key = event.key.toLowerCase();
  return (
    !event.altKey &&
    ((key === "z" && (event.metaKey || event.ctrlKey) && event.shiftKey) ||
      (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey))
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

function selectionOffsetsWithInlineBreaksInElement(
  element: HTMLElement,
  selection: Selection,
  selectedRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null,
) {
  if (!selectedRange) return null;

  const range = selectedRange;
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }

  const nodeLength = (node: Node): number => {
    if (node instanceof Text) return node.data.replace(/\u200b/g, "").length;
    if (node instanceof HTMLBRElement) return 1;

    return Array.from(node.childNodes).reduce(
      (length, child) => length + nodeLength(child),
      0,
    );
  };
  const pointOffset = (targetNode: Node, targetOffset: number) => {
    let offset = 0;

    function visit(node: Node): boolean {
      if (node === targetNode) {
        if (node instanceof Text) {
          offset += node.data
            .slice(0, clampNumber(targetOffset, 0, node.data.length))
            .replace(/\u200b/g, "").length;
        } else {
          Array.from(node.childNodes)
            .slice(0, clampNumber(targetOffset, 0, node.childNodes.length))
            .forEach((child) => {
              offset += nodeLength(child);
            });
        }
        return true;
      }

      for (const child of Array.from(node.childNodes)) {
        if (child === targetNode || child.contains(targetNode)) {
          return visit(child);
        }
        offset += nodeLength(child);
      }

      return false;
    }

    return visit(element) ? offset : null;
  };
  const from = pointOffset(range.startContainer, range.startOffset);
  const to = pointOffset(range.endContainer, range.endOffset);
  if (from === null || to === null) return null;

  return {
    from,
    to,
  };
}

function sourcePositionForPreviewTextOffset(textMap: PreviewTextMap, offset: number) {
  if (textMap.sourceOffsets.length === 0) return textMap.sourceEndOffset ?? null;

  const clampedOffset = clampNumber(offset, 0, textMap.sourceOffsets.length);
  if (
    clampedOffset === textMap.sourceOffsets.length &&
    textMap.sourceEndOffset !== null &&
    textMap.sourceEndOffset !== undefined
  ) {
    return textMap.sourceEndOffset;
  }
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

function previewTextOffsetForSourcePosition(textMap: PreviewTextMap, sourcePosition: number) {
  if (textMap.sourceOffsets.length === 0) return 0;

  const exactOffset = textMap.sourceOffsets.findIndex(
    (sourceOffset) => sourceOffset !== null && sourceOffset >= sourcePosition,
  );
  if (exactOffset >= 0) return exactOffset;

  return textMap.text.length;
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

function transformAnchorWithTextEdits(
  anchor: TextSelectionAnchor,
  nextBody: string,
  edits: MarkdownTextEdit[],
) {
  return recoverRenderableAnchor(
    nextBody,
    transformAnchorRangeWithTextEdits(anchor, nextBody.length, edits),
  );
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
  keyPrefix: string,
): ReactNode {
  const ListTag = list.kind === "unordered-list" ? "ul" : "ol";

  return (
    <ListTag>
      {list.items.map((item) => {
        const itemTextMap = getListItemTextMap(markdown, block, item.flatIndex);

        return (
          <li data-preview-list-item-index={item.flatIndex} key={item.key}>
            {item.text
              ? renderInlineMarkdown(
                  itemTextMap.text,
                  `${keyPrefix}-item-${item.flatIndex}`,
                )
              : <br />}
            {item.children.map((childList, childIndex) => (
              <Fragment key={`${item.key}-child-list-${childIndex}`}>
                {renderEditablePreviewList(
                  childList,
                  block,
                  markdown,
                  `${keyPrefix}-item-${item.flatIndex}-child-${childIndex}`,
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
  editable,
  mermaidEmptyDefinitionLabel,
  mermaidErrorLabel,
  mermaidLoadingLabel,
  diagramEditing,
}: {
  block: MarkdownPreviewBlock;
  markdown: string;
  editable: boolean;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
  diagramEditing?: { change: (previous: string, next: string) => boolean; history: (redo: boolean) => string | undefined };
}) {
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
      renderInlineMarkdown(textMap.text, `${block.key}-heading`),
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
            {renderInlineMarkdown(
              getQuoteLineTextMap(markdown, block, quoteIndex).text,
              `${block.key}-quote-${quoteIndex}`,
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
          block.key,
        )}
      </div>
    );
  }

  if (block.kind === "code") {
    if (isMermaidLanguage(block.language)) {
      return (
        <MermaidDiagram
          definition={block.text}
          editing={editable ? diagramEditing : undefined}
          emptyDefinitionLabel={mermaidEmptyDefinitionLabel}
          key={block.key}
          loadingLabel={mermaidLoadingLabel}
          renderErrorLabel={mermaidErrorLabel}
        />
      );
    }

    return (
      <pre
        {...blockProps}
        className={`markdown-preview-editable${
          isCommentedFileTreeCodeBlock(block.language, block.text)
            ? " is-commented-file-tree"
            : ""
        }`}
        key={block.key}
      >
        <code>{getPreviewBlockTextMap(markdown, block).text}</code>
      </pre>
    );
  }

  if (block.kind === "rule") {
    return <hr data-preview-block-key={block.key} key={block.key} />;
  }

  if (block.kind === "paragraph") {
    const textMap = getPreviewBlockTextMap(markdown, block);

    return (
      <p {...blockProps} className="markdown-preview-editable" key={block.key}>
        {renderInlineMarkdown(textMap.text, `${block.key}-paragraph`)}
        {editable && textMap.text.endsWith("\n") ? (
          <span aria-hidden="true" data-preview-trailing-caret="true">
            {"\u200b"}
          </span>
        ) : null}
      </p>
    );
  }

  return null;
}

function MarkdownPreview({
  value,
  mermaidEmptyDefinitionLabel,
  mermaidErrorLabel,
  mermaidLoadingLabel,
  placeholder,
  readOnly,
  onChange,
}: {
  value: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange: (
    value: string,
    source: EditorChangeSource,
    anchorTransform?: BodyAnchorTransform,
  ) => void;
}) {
  function parsePreviewBlocks(markdown: string) {
    return parseMarkdownPreviewBlocks(markdown, { preserveEmptyParagraphs: !readOnly });
  }
  const blocks = parsePreviewBlocks(value);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewPointerPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const previewValueRef = useRef(value);
  const inputCommitFrameRef = useRef(0);
  const pendingPreviewTextFocusRef = useRef<{
    blockKey: string;
    scrollIntoView?: boolean;
    textOffset: number;
  } | null>(null);
  const previewHistoryRef = useRef(createNoteEditorHistory());
  const previewInputCommitRef = useRef(false);
  previewValueRef.current = value;

  useEffect(
    () => () => {
      window.cancelAnimationFrame(inputCommitFrameRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const pendingFocus = pendingPreviewTextFocusRef.current;
    if (!pendingFocus) return;

    pendingPreviewTextFocusRef.current = null;
    applyPreviewBlockTextOffset(
      pendingFocus.blockKey,
      pendingFocus.textOffset,
      pendingFocus.scrollIntoView,
    );
  }, [value]);

  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
      if (readOnly) return;
      const shouldRedo = isRedoKeyboardShortcut(event);
      if (!shouldRedo && !isUndoKeyboardShortcut(event)) return;
      if (!previewShouldHandleDocumentShortcut(event.target)) return;
      flushPendingPreviewHistoryInput();
      if (!(shouldRedo ? redoPreviewChange() : undoPreviewChange())) return;

      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [onChange, readOnly, value]);

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

    return previewBlockElementFromNode(previewRangeFromSelection(selection)?.startContainer ?? null);
  }

  function previewRangeFromSelection(selection: Selection) {
    if (selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (previewBlockElementFromNode(range.startContainer)) return range;
    if (!selection.isCollapsed) return range;

    const previewElement = previewRef.current;
    if (!previewElement) return range;

    const pointerPoint = previewPointerPointRef.current;
    const caretRange = pointerPoint
      ? caretRangeFromPoint(pointerPoint.clientX, pointerPoint.clientY)
      : null;
    if (caretRange && previewBlockElementFromNode(caretRange.startContainer)) {
      return caretRange;
    }

    const rangeRect = range.getBoundingClientRect();
    if (rangeRect.height > 0) {
      const geometricRange = caretRangeFromPoint(
        rangeRect.left,
        rangeRect.top + rangeRect.height / 2,
      );
      if (geometricRange && previewBlockElementFromNode(geometricRange.startContainer)) {
        return geometricRange;
      }
    }

    if (selection.focusNode !== previewElement) return range;

    const focusOffset = clampNumber(
      selection.focusOffset,
      0,
      previewElement.childNodes.length,
    );
    const nextBlock = previewBlockElementFromNode(
      previewElement.childNodes[focusOffset] ?? null,
    );
    const previousBlock = previewBlockElementFromNode(
      previewElement.childNodes[focusOffset - 1] ?? null,
    );
    const boundaryBlock = nextBlock ?? previousBlock;
    if (!boundaryBlock) return range;

    const boundaryRange = document.createRange();
    boundaryRange.selectNodeContents(boundaryBlock);
    boundaryRange.collapse(Boolean(nextBlock));
    return boundaryRange;
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

  function focusPreviewBlockStart(blockKey: string) {
    window.requestAnimationFrame(() => {
      applyPreviewBlockTextOffset(blockKey, 0);
    });
  }

  function applyPreviewBlockTextOffset(
    blockKey: string,
    textOffset: number,
    shouldScrollIntoView = false,
  ) {
    const previewElement = previewRef.current;
    const blockElement = Array.from(
      previewElement?.querySelectorAll<HTMLElement>("[data-preview-block-key]") ?? [],
    ).find((element) => element.dataset.previewBlockKey === blockKey);
    if (!blockElement) {
      if (!blockKey && previewElement) {
        focusEditableElementAtPoint(previewElement, null);
      }
      return;
    }

    let remainingOffset = Math.max(0, textOffset);
    const walker = document.createTreeWalker(
      blockElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    let focusNode: Node = blockElement;
    let focusOffset = blockElement.childNodes.length;

    while (node) {
      if (node instanceof Text) {
        const textLength = node.data.length;
        if (remainingOffset <= textLength) {
          focusNode = node;
          focusOffset = remainingOffset;
          break;
        }
        remainingOffset -= textLength;
      } else if (node instanceof HTMLBRElement) {
        if (remainingOffset <= 1) {
          const trailingCaretText =
            remainingOffset === 1 &&
            node.nextSibling instanceof HTMLElement &&
            node.nextSibling.dataset.previewTrailingCaret === "true" &&
            node.nextSibling.firstChild instanceof Text
              ? node.nextSibling.firstChild
              : null;
          if (trailingCaretText) {
            focusNode = trailingCaretText;
            focusOffset = trailingCaretText.data.length;
          } else {
            focusNode = node.parentNode ?? blockElement;
            focusOffset = Array.from(focusNode.childNodes).indexOf(node) + remainingOffset;
          }
          break;
        }
        remainingOffset -= 1;
      }

      node = walker.nextNode();
    }

    previewElement?.focus();
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.setStart(focusNode, focusOffset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    if (shouldScrollIntoView) {
      blockElement.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function focusPreviewBlockTextOffset(
    blockKey: string,
    textOffset: number,
    scrollIntoView = false,
  ) {
    pendingPreviewTextFocusRef.current = { blockKey, scrollIntoView, textOffset };
  }

  function focusPreviewSourcePosition(
    nextValue: string,
    sourcePosition: number,
    scrollIntoView = false,
  ) {
    const caretLine = nextValue.slice(0, sourcePosition).split("\n").length - 1;
    const nextBlocks = parsePreviewBlocks(nextValue);
    const focusBlock =
      nextBlocks.find(
        (block) => block.startLine <= caretLine && block.endLine >= caretLine,
      ) ??
      nextBlocks.filter((block) => block.endLine < caretLine).slice(-1)[0] ??
      nextBlocks[0];

    if (!focusBlock) {
      focusPreviewBlockTextOffset("", 0);
      return;
    }

    focusPreviewBlockTextOffset(
      focusBlock.key,
      previewTextOffsetForSourcePosition(
        getPreviewBlockTextMap(nextValue, focusBlock),
        sourcePosition,
      ),
      scrollIntoView,
    );
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

  function previewTextFocusFromSelection(blockElement: HTMLElement) {
    const blockKey = blockElement.dataset.previewBlockKey;
    const selection = window.getSelection();
    const offsets = selection
      ? selectionOffsetsWithInlineBreaksInElement(blockElement, selection)
      : null;
    const matchingElements = blockKey
      ? Array.from(
          previewRef.current?.querySelectorAll<HTMLElement>("[data-preview-block-key]") ?? [],
        ).filter((element) => element.dataset.previewBlockKey === blockKey)
      : [];
    const blockElementIndex = matchingElements.indexOf(blockElement);
    const precedingTextLength =
      blockElementIndex > 0
        ? matchingElements
            .slice(0, blockElementIndex)
            .reduce(
              (length, element) =>
                length + previewTextFromNode(element).replace(/\u200b/g, "").length + 1,
              0,
            )
        : 0;

    return blockKey && offsets
      ? { blockKey, textOffset: precedingTextLength + offsets.to }
      : null;
  }

  function childNodeText(node: ChildNode) {
    const text = previewTextFromNode(node);
    if (node instanceof HTMLBRElement || text !== "\n") return text;

    return "";
  }

  function clearTransientPreviewNodes(nodes: ChildNode[]) {
    nodes.forEach((node) => node.remove());
    window.getSelection()?.removeAllRanges();
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

  function previewBlockAfterNode(node: Node | null) {
    let nextNode = node?.nextSibling ?? null;

    while (nextNode) {
      if (
        nextNode instanceof HTMLElement &&
        nextNode.dataset.previewBlockKey
      ) {
        return blockForPreviewElement(nextNode);
      }

      nextNode = nextNode.nextSibling;
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
    if (topLevelNode instanceof HTMLElement) {
      const previousBlock = topLevelNode.dataset.previewBlockKey
        ? blockForPreviewElement(topLevelNode)
        : previewBlockBeforeNode(topLevelNode);
      lineElement.dataset.previewPreviousBlockKey = previousBlock?.key ?? "";
      topLevelNode.after(lineElement);
    } else {
      const previousBlock = blocks[blocks.length - 1] ?? null;
      lineElement.dataset.previewPreviousBlockKey = previousBlock?.key ?? "";
      previewElement.append(lineElement);
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
    const lines = previewValueRef.current.replace(/\r\n/g, "\n").split("\n");
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
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly) {
      event.preventDefault();
      return;
    }

    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.defaultPrevented) return;
    if (nativeEvent.inputType === "insertLineBreak" && !nativeEvent.isComposing) {
      if (commitPreviewSoftBreak()) {
        event.preventDefault();
      }
      return;
    }

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

  function selectAllPreviewContent(previewElement: HTMLElement) {
    const blockElements = Array.from(
      previewElement.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    );
    const firstBlock = blockElements[0];
    const lastBlock = blockElements[blockElements.length - 1];
    const selection = window.getSelection();
    if (!firstBlock || !lastBlock || !selection) return false;

    const range = document.createRange();
    range.setStart(firstBlock, 0);
    range.setEnd(lastBlock, lastBlock.childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function selectionCoversAllPreviewContent(
    previewElement: HTMLElement,
    selection: Selection,
  ) {
    if (selection.isCollapsed || selection.rangeCount === 0) return false;

    const blockElements = Array.from(
      previewElement.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    );
    const firstBlock = blockElements[0];
    const lastBlock = blockElements[blockElements.length - 1];
    if (!firstBlock || !lastBlock) return false;

    const contentRange = document.createRange();
    contentRange.setStart(firstBlock, 0);
    contentRange.setEnd(lastBlock, lastBlock.childNodes.length);
    const selectionRange = selection.getRangeAt(0);

    return (
      selectionRange.compareBoundaryPoints(Range.START_TO_START, contentRange) <= 0 &&
      selectionRange.compareBoundaryPoints(Range.END_TO_END, contentRange) >= 0
    );
  }

  function previewNodePath(root: Node, node: Node) {
    const path: number[] = [];
    let current: Node | null = node;

    while (current && current !== root) {
      const parentNode: ParentNode | null = current.parentNode;
      if (!parentNode) return null;
      const index = Array.from(parentNode.childNodes).indexOf(current as ChildNode);
      if (index < 0) return null;
      path.unshift(index);
      current = parentNode;
    }

    return current === root ? path : null;
  }

  function previewNodeAtPath(root: Node, path: number[]) {
    let current = root;
    for (const index of path) {
      const child = current.childNodes[index];
      if (!child) return null;
      current = child;
    }
    return current;
  }

  function clonedPreviewSelection(
    previewElement: HTMLElement,
    selection: Selection,
  ) {
    if (selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const startPath = previewNodePath(previewElement, range.startContainer);
    const endPath = previewNodePath(previewElement, range.endContainer);
    if (!startPath || !endPath) return null;

    const clone = previewElement.cloneNode(true) as HTMLElement;
    const startNode = previewNodeAtPath(clone, startPath);
    const endNode = previewNodeAtPath(clone, endPath);
    if (!startNode || !endNode) return null;

    const clonedRange = document.createRange();
    clonedRange.setStart(startNode, range.startOffset);
    clonedRange.setEnd(endNode, range.endOffset);
    return { clone, range: clonedRange };
  }

  function commitPreviewSelectionDeletion(previewElement: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;

    const selectedRange = selection.getRangeAt(0);
    if (
      !previewElement.contains(selectedRange.startContainer) ||
      !previewElement.contains(selectedRange.endContainer)
    ) {
      return false;
    }

    const coversAllContent = selectionCoversAllPreviewContent(previewElement, selection);
    const startBlockElement = previewBlockElementFromNode(selectedRange.startContainer);
    const endBlockElement = previewBlockElementFromNode(selectedRange.endContainer);
    const renderedBlock = startBlockElement ? blockForPreviewElement(startBlockElement) : null;
    const renderedEndBlock = endBlockElement ? blockForPreviewElement(endBlockElement) : null;
    const sameBlockOffsets = startBlockElement
      ? selectionOffsetsWithInlineBreaksInElement(startBlockElement, selection)
      : null;
    const startPointRange = selectedRange.cloneRange();
    startPointRange.collapse(true);
    const endPointRange = selectedRange.cloneRange();
    endPointRange.collapse(false);
    const startOffsets = startBlockElement
      ? selectionOffsetsWithInlineBreaksInElement(
          startBlockElement,
          selection,
          startPointRange,
        )
      : null;
    const endOffsets = endBlockElement
      ? selectionOffsetsWithInlineBreaksInElement(
          endBlockElement,
          selection,
          endPointRange,
        )
      : null;
    const crossesBlocks = Boolean(
      startBlockElement &&
      endBlockElement &&
      startBlockElement !== endBlockElement &&
      renderedBlock &&
      renderedEndBlock &&
      startOffsets &&
      endOffsets,
    );
    const clonedSelection = clonedPreviewSelection(previewElement, selection);
    if (
      !coversAllContent &&
      !crossesBlocks &&
      (!startBlockElement || startBlockElement !== endBlockElement ||
        !renderedBlock || !sameBlockOffsets || !clonedSelection)
    ) {
      return false;
    }

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    commitPendingPreviewInput(previewElement, true);

    if (coversAllContent) {
      window.getSelection()?.removeAllRanges();
      focusPreviewSourcePosition("", 0);
      commitPreviewChange("");
      return true;
    }

    if (
      crossesBlocks &&
      renderedBlock &&
      renderedEndBlock &&
      startOffsets &&
      endOffsets
    ) {
      const currentValue = previewValueRef.current;
      const currentBlocks = parsePreviewBlocks(currentValue);
      const startBlock = currentBlocks.find(
        (candidate) => candidate.key === renderedBlock.key,
      );
      const endBlock = currentBlocks.find(
        (candidate) => candidate.key === renderedEndBlock.key,
      );
      if (!startBlock || !endBlock) return true;

      const startTextMap = getPreviewBlockTextMap(currentValue, startBlock);
      const endTextMap = getPreviewBlockTextMap(currentValue, endBlock);
      const startBlockRange = getBlockRange(currentValue, startBlock);
      const endBlockRange = getBlockRange(currentValue, endBlock);
      const sourceFrom = startOffsets.from === 0
        ? startBlockRange.start
        : startOffsets.from >= startTextMap.text.length
          ? startBlockRange.end
          : sourcePositionForPreviewTextOffset(startTextMap, startOffsets.from);
      const sourceTo = endOffsets.from === 0
        ? endBlockRange.start
        : endOffsets.from >= endTextMap.text.length
          ? endBlockRange.end
          : sourcePositionForPreviewTextOffset(endTextMap, endOffsets.from);
      if (sourceFrom === null || sourceTo === null || sourceTo < sourceFrom) return true;

      const nextValue = currentValue.slice(0, sourceFrom) + currentValue.slice(sourceTo);
      window.getSelection()?.removeAllRanges();
      focusPreviewSourcePosition(nextValue, sourceFrom);
      commitPreviewChange(nextValue);
      return true;
    }

    if (!renderedBlock || !sameBlockOffsets || !clonedSelection) return false;
    const currentValue = previewValueRef.current;
    const block =
      parsePreviewBlocks(currentValue).find(
        (candidate) => candidate.key === renderedBlock.key,
      );
    if (!block) return true;
    const selectedSoftLine = block.kind === "paragraph"
      ? removeSelectedPreviewSoftLine({
          from: sameBlockOffsets.from,
          selectedText: selectedRange.toString(),
          text: getPreviewBlockTextMap(currentValue, block).text,
          to: sameBlockOffsets.to,
        })
      : null;
    if (selectedSoftLine) {
      const textMap = getPreviewBlockTextMap(currentValue, block);
      const sourceFrom = sourcePositionForPreviewTextOffset(textMap, selectedSoftLine.caretOffset);
      const sourceTo = sourcePositionForPreviewTextOffset(
        textMap,
        selectedSoftLine.caretOffset + textMap.text.length - selectedSoftLine.text.length,
      );
      if (sourceFrom === null || sourceTo === null) return false;
      const nextValue = currentValue.slice(0, sourceFrom) + currentValue.slice(sourceTo);
      const nextRenderedBlock = parsePreviewBlocks(nextValue).find(
        (candidate) => candidate.startLine === block.startLine,
      );

      window.getSelection()?.removeAllRanges();
      if (nextRenderedBlock) {
        focusPreviewBlockTextOffset(nextRenderedBlock.key, selectedSoftLine.caretOffset);
      }
      commitPreviewChange(nextValue);
      return true;
    }

    clonedSelection.range.deleteContents();
    const clonedBlockElements = Array.from(
      clonedSelection.clone.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    ).filter((element) => element.dataset.previewBlockKey === block.key);
    const nextBlock = clonedBlockElements.length > 0
      ? markdownFromEditedPreviewBlockElements(block, clonedBlockElements)
      : "";
    const nextValue = replaceMarkdownBlock(currentValue, block, nextBlock);
    const nextRenderedBlock = parsePreviewBlocks(nextValue).find(
      (candidate) => candidate.startLine === block.startLine,
    );
    const caretSourcePosition = nextRenderedBlock
      ? sourcePositionForPreviewTextOffset(
          getPreviewBlockTextMap(nextValue, nextRenderedBlock),
          sameBlockOffsets.from,
        ) ?? getBlockRange(currentValue, block).start
      : getBlockRange(currentValue, block).start;

    window.getSelection()?.removeAllRanges();
    focusPreviewSourcePosition(nextValue, caretSourcePosition);
    commitPreviewChange(nextValue);
    return true;
  }

  function commitPreviewEmptyLineDeletion(
    previewElement: HTMLElement,
    key: string,
  ) {
    const selection = window.getSelection();
    if (
      !selection ||
      !selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !selection.focusNode ||
      !previewElement.contains(selection.focusNode)
    ) {
      return false;
    }

    const transientElement = transientPreviewElementFromSelection();
    if (transientElement) {
      const previousBlock = previewBlockBeforeNode(transientElement);
      const nextBlock = previewBlockAfterNode(transientElement);
      if (!previousBlock && !nextBlock) return true;

      clearTransientPreviewNodes([transientElement]);
      if (key === "Backspace" && previousBlock) {
        focusPreviewBlockEnd(previousBlock.key);
      } else if (nextBlock) {
        focusPreviewBlockStart(nextBlock.key);
      } else if (previousBlock) {
        focusPreviewBlockEnd(previousBlock.key);
      }
      return true;
    }

    const blockElement = previewBlockElementFromSelection();
    const renderedBlock = blockElement ? blockForPreviewElement(blockElement) : null;
    const offsets = blockElement
      ? selectionOffsetsWithInlineBreaksInElement(blockElement, selection)
      : null;
    if (!blockElement || renderedBlock?.kind !== "paragraph" || !offsets) return false;

    const renderedText = previewTextFromNode(blockElement).replace(/\u200b/g, "");
    if (renderedText === "") {
      const blockIndex = blocks.findIndex((block) => block.key === renderedBlock.key);
      const previousBlock = blocks[blockIndex - 1];
      const neighbor = blocks[blockIndex + (key === "Backspace" ? -1 : 1)];
      if (!neighbor) {
        if (key === "Delete" && previousBlock && blockIsList(previousBlock)) {
          focusPreviewBlockEnd(previousBlock.key);
        }
        return true;
      }
      const currentValue = previewValueRef.current;
      const emptyRange = getBlockRange(currentValue, renderedBlock);
      const neighborRange = getBlockRange(currentValue, neighbor);
      const from = key === "Backspace" ? neighborRange.end : emptyRange.start;
      const to = key === "Backspace" ? emptyRange.end : neighborRange.start;
      const nextValue = currentValue.slice(0, from) + currentValue.slice(to);
      window.getSelection()?.removeAllRanges();
      if (key === "Backspace" && blockIsList(neighbor)) {
        focusPreviewBlockEnd(neighbor.key);
      } else {
        focusPreviewSourcePosition(nextValue, from);
      }
      commitPreviewChange(nextValue);
      return true;
    }
    const renderedCaretOffset = clampNumber(offsets.from, 0, renderedText.length);
    const hasAdjacentBreak =
      renderedText === "\n" ||
      (key === "Delete" && renderedText[renderedCaretOffset] === "\n") ||
      (renderedCaretOffset > 0 && renderedText[renderedCaretOffset - 1] === "\n");
    if (!hasAdjacentBreak) return false;

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    commitPendingPreviewInput(previewElement, true);

    const currentValue = previewValueRef.current;
    const block = parsePreviewBlocks(currentValue).find(
      (candidate) => candidate.key === renderedBlock.key,
    );
    if (!block || block.kind !== "paragraph") return false;

    const textMap = getPreviewBlockTextMap(currentValue, block);
    const caretOffset = clampNumber(offsets.from, 0, textMap.text.length);
    const breakFrom =
      textMap.text === "\n"
        ? 0
        : key === "Delete" && textMap.text[caretOffset] === "\n"
        ? caretOffset
        : caretOffset > 0 && textMap.text[caretOffset - 1] === "\n"
          ? caretOffset - 1
          : null;
    if (breakFrom === null) return false;

    const sourceFrom = sourcePositionForPreviewTextOffset(textMap, breakFrom);
    const sourceTo = sourcePositionForPreviewTextOffset(textMap, breakFrom + 1);
    if (sourceFrom === null || sourceTo === null || sourceTo <= sourceFrom) return false;
    if (!isInlineBreakToken(currentValue.slice(sourceFrom, sourceTo))) return false;

    const nextValue = currentValue.slice(0, sourceFrom) + currentValue.slice(sourceTo);
    delete blockElement.dataset.edited;
    window.getSelection()?.removeAllRanges();
    focusPreviewSourcePosition(nextValue, sourceFrom);
    commitPreviewChange(nextValue);
    return true;
  }

  function handlePreviewPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const previewElement = event.currentTarget;
    if (
      !selection.focusNode ||
      !previewElement.contains(selection.focusNode) ||
      (selection.anchorNode && !previewElement.contains(selection.anchorNode))
    ) {
      return;
    }

    let selectedRange =
      selectionCoversAllPreviewContent(previewElement, selection)
        ? { from: 0, to: previewValueRef.current.length }
        : selection.isCollapsed
          ? null
          : makePreviewAnchorFromSelection(
              previewValueRef.current,
              blocks,
              previewElement,
              selection,
            );

    if (!selectedRange && selection.isCollapsed && previewValueRef.current.length === 0) {
      selectedRange = { from: 0, to: 0 };
    }

    if (!selectedRange && selection.isCollapsed) {
      const blockElement = previewBlockElementFromSelection();
      const block = blockElement ? blockForPreviewElement(blockElement) : null;
      const offsets =
        blockElement ? selectionOffsetsWithInlineBreaksInElement(blockElement, selection) : null;
      const sourceRange =
        block && offsets
          ? sourceRangeForPreviewTextOffsets(
              getPreviewBlockTextMap(previewValueRef.current, block),
              offsets.from,
              offsets.to,
            )
          : null;

      selectedRange = sourceRange;
    }

    if (!selectedRange) return;

    const pastedText = event.clipboardData
      .getData("text/plain")
      .replace(/\r\n?/g, "\n");
    event.preventDefault();
    event.stopPropagation();
    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    pendingPreviewTextFocusRef.current = null;
    window.getSelection()?.removeAllRanges();

    const nextValue =
      previewValueRef.current.slice(0, selectedRange.from) +
      pastedText +
      previewValueRef.current.slice(selectedRange.to);
    const caretSourcePosition = selectedRange.from + pastedText.length;
    focusPreviewSourcePosition(nextValue, caretSourcePosition);
    commitPreviewChange(nextValue);
  }

  function handlePreviewCut(event: ReactClipboardEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly || !event.clipboardData) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const previewElement = event.currentTarget;
    const selectedRange = selection.getRangeAt(0);
    if (
      !previewElement.contains(selectedRange.startContainer) ||
      !previewElement.contains(selectedRange.endContainer)
    ) {
      return;
    }

    const selectedText = selection.toString();
    if (!selectedText || !commitPreviewSelectionDeletion(previewElement)) return;

    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.clearData();
    event.clipboardData.setData("text/plain", selectedText);
  }

  function handlePreviewInput(event: FormEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly) {
      event.preventDefault();
      return;
    }

    previewPointerPointRef.current = null;
    const previewElement = event.currentTarget;
    const blockElement =
      previewBlockElementFromTarget(event.target) ?? previewBlockElementFromSelection();
    if (blockElement) {
      markPreviewBlockChanged(blockElement);
    }

    if ((event.nativeEvent as InputEvent).isComposing) return;

    const pendingFocus = blockElement
      ? previewTextFocusFromSelection(blockElement)
      : null;
    if (pendingFocus) {
      pendingPreviewTextFocusRef.current = pendingFocus;
    }
    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = window.requestAnimationFrame(() => {
      inputCommitFrameRef.current = 0;
      if (!commitPendingPreviewInput(previewElement, true) && pendingFocus) {
        pendingPreviewTextFocusRef.current = null;
      }
    });
  }

  function handlePreviewCompositionEnd(event: CompositionEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly) return;

    previewPointerPointRef.current = null;
    const previewElement = event.currentTarget;
    const blockElement =
      previewBlockElementFromTarget(event.target) ?? previewBlockElementFromSelection();
    const pendingFocus = blockElement
      ? previewTextFocusFromSelection(blockElement)
      : null;
    if (pendingFocus) {
      pendingPreviewTextFocusRef.current = pendingFocus;
    }
    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    if (!commitPendingPreviewInput(previewElement, true) && pendingFocus) {
      pendingPreviewTextFocusRef.current = null;
    }
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

    const nextListItem = listItem.nextElementSibling;
    const nextListLine = parseMarkdownListLine(lines[lineIndex + 1] ?? "");
    if (
      caretOffset !== 0 &&
      nextListItem instanceof HTMLLIElement &&
      Number(nextListItem.dataset.previewListItemIndex) === flatIndex + 1 &&
      nextListLine &&
      !nextListLine.text.trim() &&
      !directPreviewListItemText(nextListItem).trim()
    ) {
      focusPreviewListItem(block.key, itemIndex + 1);
      return true;
    }

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

    const lines = previewTextFromNode(blockElement)
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
    const preserveSoftBreaks = transientEdit.transientNodes.some(
      (node) => node.dataset.previewSoftBreaks === "true",
    );
    if (preserveSoftBreaks && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const markdownBlock =
      typedMarkdownBlock?.markdown ??
      (preserveSoftBreaks
        ? lines.some((line) => line.trim())
          ? lines.map((line) => line.trimEnd()).join("<br>")
          : ""
        : lines
            .map((line) => line.trimEnd())
            .join("\n")
            .trim());
    if (!markdownBlock) return false;

    const { nextValue, insertedBlockKey } = insertMarkdownAfterBlock(
      transientEdit.previousBlock,
      options.continueList
        ? typedMarkdownBlock
          ? appendBlankListItemToTypedMarkdownBlock(typedMarkdownBlock)
          : `${markdownBlock}\n`
        : markdownBlock,
    );

    if (nextValue === previewValueRef.current) return false;

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
    if (nextValue === previewValueRef.current) return false;

    commitPreviewChange(nextValue);
    return true;
  }

  function commitEditedPreviewBlocks() {
    const previewElement = previewRef.current;
    if (!previewElement) return false;

    const previewBlockElements = Array.from(
      previewElement.querySelectorAll<HTMLElement>("[data-preview-block-key]"),
    );
    const editedBlockKeys = new Set(
      previewBlockElements
        .filter((element) => element.dataset.edited === "true")
        .map((element) => element.dataset.previewBlockKey)
        .filter((blockKey): blockKey is string => Boolean(blockKey)),
    );
    const editedBlocks = Array.from(editedBlockKeys)
      .map((blockKey) => {
        const block = blocks.find((candidate) => candidate.key === blockKey);
        const elements = previewBlockElements.filter(
          (element) => element.dataset.previewBlockKey === blockKey,
        );
        return block && elements.length > 0 ? { block, blockKey, elements } : null;
      })
      .filter((edit): edit is {
        block: MarkdownPreviewBlock;
        blockKey: string;
        elements: HTMLElement[];
      } =>
        Boolean(edit),
      )
      .sort((left, right) => right.block.startLine - left.block.startLine);

    if (editedBlocks.length === 0) return false;

    const currentValue = previewValueRef.current;
    let nextValue = currentValue;
    editedBlocks.forEach(({ block, blockKey, elements }) => {
      const currentBlock =
        parsePreviewBlocks(nextValue).find(
          (candidate) => candidate.key === blockKey,
        ) ?? block;
      nextValue = replaceMarkdownBlock(
        nextValue,
        currentBlock,
        markdownFromEditedPreviewBlockElements(currentBlock, elements),
      );
      if (currentBlock.kind === "paragraph" && currentBlock.text === "") {
        // The browser inserted these nodes into a paragraph with no React
        // children. Remove only those unmanaged nodes before React adds the
        // committed text, keeping the paragraph element itself intact.
        elements.forEach((element) => element.replaceChildren());
      }
      elements.forEach((element) => delete element.dataset.edited);
    });

    if (nextValue === currentValue) return false;

    commitPreviewChange(nextValue);
    return true;
  }

  function commitPendingPreviewInput(
    previewElement: HTMLElement,
    recordAsInput = false,
  ) {
    previewInputCommitRef.current = recordAsInput;
    try {
      const committedRoot = commitRootTypedPreviewBlock(previewElement);
      const committedEditedBlocks = commitEditedPreviewBlocks();
      if (!committedRoot && !committedEditedBlocks) {
        return commitLooseRootPreviewText(previewElement);
      }

      return true;
    } finally {
      previewInputCommitRef.current = false;
    }
  }

  function commitPreviewSoftBreak() {
    const previewElement = previewRef.current;
    if (previewElement) {
      window.cancelAnimationFrame(inputCommitFrameRef.current);
      inputCommitFrameRef.current = 0;
      commitPendingPreviewInput(previewElement, true);
    }

    const selection = window.getSelection();
    const blockElement = previewBlockElementFromSelection();
    if (!selection || !blockElement) return false;

    const renderedBlock = blockForPreviewElement(blockElement);
    const selectedRange = previewRangeFromSelection(selection);
    const offsets = selectionOffsetsWithInlineBreaksInElement(
      blockElement,
      selection,
      selectedRange,
    );
    if (!renderedBlock || !offsets) return false;
    previewPointerPointRef.current = null;

    const currentValue = previewValueRef.current;
    const block =
      parsePreviewBlocks(currentValue).find(
        (candidate) => candidate.key === renderedBlock.key,
      ) ?? renderedBlock;
    const textMap = getPreviewBlockTextMap(currentValue, block);
    const sourceRange = sourceRangeForPreviewTextOffsets(textMap, offsets.from, offsets.to);
    if (!sourceRange) return false;

    const softBreak = block.kind === "code" ? "\n" : "<br>";
    const precedingWhitespace =
      currentValue.slice(0, sourceRange.from).match(/[ \t]+$/)?.[0] ?? "";
    const breakFrom = sourceRange.from - precedingWhitespace.length;
    delete blockElement.dataset.edited;
    focusPreviewBlockTextOffset(
      block.key,
      Math.max(0, offsets.from - precedingWhitespace.length) + 1,
    );
    commitPreviewChange(
      currentValue.slice(0, breakFrom) +
        softBreak +
        currentValue.slice(sourceRange.to),
    );
    return true;
  }

  function commitPreviewBlockMarkdown(block: MarkdownPreviewBlock, markdownBlock: string) {
    const nextValue = replaceMarkdownBlock(previewValueRef.current, block, markdownBlock);

    commitPreviewChange(nextValue);
  }

  function handlePreviewBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (readOnly) return;

    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    commitPendingPreviewInput(event.currentTarget, true);
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
    if (event.target instanceof Element && event.target.closest("[data-diagram-text]")) return;
    if (event.key !== "Enter") {
      previewPointerPointRef.current = null;
    }

    if (readOnly) {
      if (
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

    if (shouldHandlePreviewSelectAllShortcut(event.nativeEvent, true, false)) {
      const previewElement = previewRef.current;
      if (!previewElement || !selectAllPreviewContent(previewElement)) return;

      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const shouldRedo = isRedoKeyboardShortcut(event);
    if (shouldRedo || isUndoKeyboardShortcut(event)) {
      flushPendingPreviewHistoryInput();
      if (!(shouldRedo ? redoPreviewChange() : undoPreviewChange())) return;

      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const isSelectionDelete =
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !keyboardEventIsComposing(event);
    if (
      isSelectionDelete &&
      commitPreviewSelectionDeletion(event.currentTarget)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (handlePreviewTabIndent(event)) return;
    if (handlePreviewListDelete(event)) return;
    if (
      isSelectionDelete &&
      commitPreviewEmptyLineDeletion(event.currentTarget, event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (handlePreviewInlineShortcut(event)) return;
    if (handlePreviewMarkdownShortcutSpace(event)) return;

    const isSoftEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.shiftKey;
    if (isSoftEnter && !event.nativeEvent.isComposing) {
      if (!commitPreviewSoftBreak()) {
        const transientElement = transientPreviewElementFromSelection();
        if (transientElement) {
          transientElement.dataset.previewSoftBreaks = "true";
        }
        return;
      }

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

      if (
        blockElement &&
        blockForPreviewElement(blockElement)?.kind === "paragraph" &&
        commitPreviewSoftBreak()
      ) {
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

    event.preventDefault();
    event.stopPropagation();
  }

  function applyPreviewInlineShortcut(
    block: MarkdownPreviewBlock,
    element: HTMLElement,
    marker: "*" | "**",
  ) {
    const change = applyInlineMarkdownShortcutToValue(value, block, element, marker);
    if (!change || change.value === value) return;

    window.getSelection()?.removeAllRanges();
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

  function flushPendingPreviewHistoryInput() {
    const previewElement = previewRef.current;
    if (!previewElement) return;

    window.cancelAnimationFrame(inputCommitFrameRef.current);
    inputCommitFrameRef.current = 0;
    commitPendingPreviewInput(previewElement, true);
    const emptyTransientNodes = Array.from(
      previewElement.querySelectorAll<HTMLElement>("[data-preview-transient='true']"),
    ).filter((node) => !previewTextFromNode(node).replace(/\u200b/g, "").trim());
    if (emptyTransientNodes.length > 0) {
      clearTransientPreviewNodes(emptyTransientNodes);
    }
  }

  function undoPreviewChange() {
    const undo = takeNoteEditorUndo(
      previewHistoryRef.current,
      previewValueRef.current,
    );
    if (!undo.snapshot) return false;

    previewHistoryRef.current = undo.history;
    previewValueRef.current = undo.snapshot.value;
    focusPreviewSourcePosition(
      undo.snapshot.value,
      undo.snapshot.caretSourcePosition,
      true,
    );
    onChange(undo.snapshot.value, "undo");
    return true;
  }

  function redoPreviewChange() {
    const redo = takeNoteEditorRedo(
      previewHistoryRef.current,
      previewValueRef.current,
    );
    if (!redo.snapshot) return false;

    previewHistoryRef.current = redo.history;
    previewValueRef.current = redo.snapshot.value;
    focusPreviewSourcePosition(
      redo.snapshot.value,
      redo.snapshot.caretSourcePosition,
      true,
    );
    onChange(redo.snapshot.value, "user");
    return true;
  }

  function commitPreviewChange(nextValue: string, anchorTransform?: BodyAnchorTransform, input = previewInputCommitRef.current) {
    const previousValue = previewValueRef.current;
    if (nextValue === previousValue) return;
    previewHistoryRef.current = recordNoteEditorChange(
      previewHistoryRef.current,
      previousValue,
      nextValue,
      { input },
    );
    previewValueRef.current = nextValue;
    onChange(nextValue, "user", anchorTransform);
  }

  return (
    <div
      className="markdown-preview"
      contentEditable={!readOnly}
      data-empty={!value.trim() ? "true" : undefined}
      data-placeholder={placeholder}
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
      onCut={handlePreviewCut}
      onInput={handlePreviewInput}
      onKeyDownCapture={handlePreviewKeyDown}
      onPaste={handlePreviewPaste}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        previewPointerPointRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }}
    >
      {blocks.map((block) => (
        <MarkdownPreviewBlockView
          block={block}
          key={block.key}
          markdown={value}
          editable={!readOnly}
          diagramEditing={!readOnly && block.kind === "code" ? {
            change: (previous, next) => {
              const current = parsePreviewBlocks(previewValueRef.current).find(item => item.key === block.key);
              if (current?.kind !== "code" || current.text !== previous) return false;
              const eol = previewValueRef.current.includes("\r\n") ? "\r\n" : "\n";
              const lines = previewValueRef.current.split(/\r?\n/);
              lines.splice(current.startLine + 1, current.endLine - current.startLine - 1, ...next.split("\n"));
              commitPreviewChange(lines.join(eol), undefined, true);
              return true;
            },
            history: (shouldRedo) => {
              const result = (shouldRedo ? takeNoteEditorRedo : takeNoteEditorUndo)(previewHistoryRef.current, previewValueRef.current);
              if (!result.snapshot) return undefined;
              previewHistoryRef.current = result.history;
              previewValueRef.current = result.snapshot.value;
              onChange(result.snapshot.value, shouldRedo ? "user" : "undo");
              const restored = parsePreviewBlocks(result.snapshot.value).find(item => item.key === block.key);
              return restored?.kind === "code" ? restored.text : undefined;
            },
          } : undefined}
          mermaidEmptyDefinitionLabel={mermaidEmptyDefinitionLabel}
          mermaidErrorLabel={mermaidErrorLabel}
          mermaidLoadingLabel={mermaidLoadingLabel}
        />
      ))}
    </div>
  );
}

function MarkdownPreviewContentBlock({
  block,
  keyPrefix,
  mermaidEmptyDefinitionLabel,
  mermaidErrorLabel,
  mermaidLoadingLabel,
}: {
  block: NoteMarkdownPreviewBlock;
  keyPrefix: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
}) {
  if (block.kind === "table") {
    return (
      <div className="note-markdown-table-scroll" key={block.key}>
        <table>
          <thead>
            <tr>
              {block.table.header.map((cell, cellIndex) => (
                <th
                  key={`${block.key}-header-${cellIndex}`}
                  scope="col"
                  style={{ textAlign: block.table.alignments[cellIndex] ?? undefined }}
                >
                  {renderInlineMarkdown(cell, `${keyPrefix}-header-${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, rowIndex) => (
              <tr key={`${block.key}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${block.key}-row-${rowIndex}-cell-${cellIndex}`}
                    style={{ textAlign: block.table.alignments[cellIndex] ?? undefined }}
                  >
                    {renderInlineMarkdown(
                      cell,
                      `${keyPrefix}-row-${rowIndex}-cell-${cellIndex}`,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
          renderErrorLabel={mermaidErrorLabel}
        />
      );
    }

    return (
      <pre
        className={isCommentedFileTreeCodeBlock(block.language, block.text)
          ? "is-commented-file-tree"
          : undefined}
        key={block.key}
      >
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
  mermaidErrorLabel,
  mermaidLoadingLabel,
  onDoubleClick,
  style,
  value,
}: {
  className: string;
  emptyLabel: string;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
  onDoubleClick?: () => void;
  style?: React.CSSProperties;
  value: string;
}) {
  const isEmpty = !stripMarkdownFrontmatter(value).trim();
  const blocks = isEmpty ? [] : parseNoteMarkdownPreviewBlocks(value);

  return (
    <div
      className={`${className} ${isEmpty ? "is-empty" : ""}`}
      style={style}
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
              mermaidErrorLabel={mermaidErrorLabel}
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

  editableElement.append(lineElement);

  return lineElement;
}

function resizeNoteTextareaToContent(textarea: HTMLTextAreaElement) {
  const computedStyle = window.getComputedStyle(textarea);
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : (Number.isFinite(parsedFontSize) ? parsedFontSize : 16) * 1.5;
  const maximumHeight = lineHeight * 10;

  const container = textarea.parentElement;
  if (container) {
    container.style.alignItems = "start";
  }

  textarea.style.minHeight = "0px";
  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(contentHeight, maximumHeight);

  textarea.style.minHeight = `${nextHeight}px`;
  textarea.style.height = "";
  textarea.style.overflowY = contentHeight > maximumHeight + 1 ? "auto" : "hidden";

  if (container) {
    container.style.alignItems = "";
  }
}

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (
    clientX: number,
    clientY: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
};

function caretRangeFromPoint(clientX: number, clientY: number) {
  const caretDocument = document as CaretPositionDocument;
  const caretPosition = caretDocument.caretPositionFromPoint?.(clientX, clientY);

  if (caretPosition) {
    const range = document.createRange();
    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);
    return range;
  }

  return caretDocument.caretRangeFromPoint?.(clientX, clientY) ?? null;
}

function focusEditableElementAtPoint(
  editableElement: HTMLElement,
  point: { clientX: number; clientY: number } | null,
) {
  editableElement.focus({ preventScroll: true });

  const range = point ? caretRangeFromPoint(point.clientX, point.clientY) : null;
  if (range && editableElement.contains(range.startContainer)) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }

  const focusTarget = ensureEmptyEditablePreviewLine(editableElement) ?? editableElement;
  const selection = window.getSelection();
  if (!selection) return;

  const fallbackRange = document.createRange();
  fallbackRange.selectNodeContents(focusTarget);
  fallbackRange.collapse(false);
  selection.removeAllRanges();
  selection.addRange(fallbackRange);
}

function NoteMarkdownEditor({
  ariaLabel,
  autoFocusOnEdit = true,
  className = "",
  editingSurface = "rendered",
  editing = true,
  editorRootRef,
  mermaidEmptyDefinitionLabel,
  mermaidErrorLabel,
  mermaidLoadingLabel,
  onChange,
  onClick,
  onCompositionEnd,
  onCompositionStart,
  onEditingBlur,
  onKeyDown,
  onRequestEdit,
  readOnly = false,
  value,
  placeholder,
}: {
  ariaLabel: string;
  autoFocusOnEdit?: boolean;
  className?: string;
  editingSurface?: "rendered" | "source";
  editing?: boolean;
  editorRootRef?: (element: HTMLDivElement | null) => void;
  mermaidEmptyDefinitionLabel: string;
  mermaidErrorLabel: string;
  mermaidLoadingLabel: string;
  onChange: (value: string) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onCompositionEnd?: (event: CompositionEvent<HTMLElement>) => void;
  onCompositionStart?: (event: CompositionEvent<HTMLElement>) => void;
  onEditingBlur?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onRequestEdit?: () => void;
  readOnly?: boolean;
  value: string;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingEditPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const isEditable = editing && !readOnly;
  const editorClassName = [
    "note-markdown-editor",
    "note-markdown-editor--preview",
    isEditable ? "is-editing" : "is-previewing",
    value.length === 0 ? "is-empty" : "",
    readOnly ? "is-readonly" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  useLayoutEffect(() => {
    if (!isEditable) return;

    window.requestAnimationFrame(() => {
      if (editingSurface === "source") {
        const textarea = textareaRef.current;
        if (!textarea) return;
        resizeNoteTextareaToContent(textarea);
        if (!autoFocusOnEdit) return;

        textarea.focus({ preventScroll: true });
        const selectionOffset = textarea.value.length;
        textarea.setSelectionRange(selectionOffset, selectionOffset);
        pendingEditPointerRef.current = null;
        return;
      }

      const editableElement = rootRef.current?.querySelector<HTMLElement>(
        ".markdown-preview[contenteditable='true']",
      );
      if (!editableElement) return;
      if (!autoFocusOnEdit) {
        pendingEditPointerRef.current = null;
        return;
      }

      focusEditableElementAtPoint(editableElement, pendingEditPointerRef.current);
      pendingEditPointerRef.current = null;
    });
  }, [autoFocusOnEdit, editingSurface, isEditable]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!isEditable || editingSurface !== "source" || !textarea) return;

    resizeNoteTextareaToContent(textarea);
  }, [editingSurface, isEditable, value]);

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
      onCompositionEnd={editingSurface === "rendered" ? onCompositionEnd : undefined}
      onCompositionStart={editingSurface === "rendered" ? onCompositionStart : undefined}
      onKeyDownCapture={editingSurface === "rendered" ? onKeyDown : undefined}
      onPointerDownCapture={handlePointerDownCapture}
      ref={setRootElement}
    >
      {editingSurface === "source" && isEditable ? (
        <textarea
          aria-label={ariaLabel}
          className="note-markdown-editor__textarea"
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={handleTextareaChange}
          onCompositionEnd={onCompositionEnd}
          onCompositionStart={onCompositionStart}
          onKeyDown={handleTextareaKeyDown}
        />
      ) : (
        <MarkdownPreview
          mermaidEmptyDefinitionLabel={mermaidEmptyDefinitionLabel}
          mermaidErrorLabel={mermaidErrorLabel}
          mermaidLoadingLabel={mermaidLoadingLabel}
          placeholder={placeholder}
          readOnly={!isEditable}
          value={value}
          onChange={(nextValue) => onChange(nextValue)}
        />
      )}
    </div>
  );
}

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [workspaceTitle, setWorkspaceTitle] = useState("Scholium");
  const [workspaceSortMode, setWorkspaceSortMode] = useState<WorkspaceSortMode>("name");
  const workspaceSortModeRef = useRef(workspaceSortMode);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>(() =>
    sortWorkspaceEntriesForDirectory(documentsSeed.map(workspaceEntryFromDocument)),
  );
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceSource, setWorkspaceSource] = useState<WorkspaceSource | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchMode, setFileSearchMode] = useState<FileSearchMode>("files");
  const [fileSearchFocused, setFileSearchFocused] = useState(false);
  const [exactTagSearchKey, setExactTagSearchKey] = useState("");
  const [localFileSearchResults, setLocalFileSearchResults] = useState<
    SearchMarkdownFileResult[]
  >([]);
  const [fileSearchPending, setFileSearchPending] = useState(false);
  const [fileSearchError, setFileSearchError] = useState("");
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSearchActiveIndex, setDocumentSearchActiveIndex] = useState(0);
  const [documentSearchMatchCount, setDocumentSearchMatchCount] = useState(0);
  const [documentSearchScrollRequestKey, setDocumentSearchScrollRequestKey] = useState(0);
  const [tagDraft, setTagDraft] = useState("");
  const [documentTagsExpanded, setDocumentTagsExpanded] = useState(false);
  const [hiddenDocumentTagCount, setHiddenDocumentTagCount] = useState(0);
  const [mobileTagPickerOpen, setMobileTagPickerOpen] = useState(false);
  const [mobileDataSourceOpen, setMobileDataSourceOpen] = useState(false);
  const [dropboxIndexedDocumentTags, setDropboxIndexedDocumentTags] = useState<
    DropboxIndexedDocumentTags[]
  >([]);
  const [dropboxTagIndexLoading, setDropboxTagIndexLoading] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const documentTagsListRef = useRef<HTMLDivElement>(null);
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(() => new Set());
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(() => new Set());
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0]?.id ?? "");
  const [openDocumentTabIds, setOpenDocumentTabIds] = useState<string[]>(() =>
    documentsSeed[0]?.id ? [documentsSeed[0].id] : [],
  );
  const [documentTabSessionRestoreCompleted, setDocumentTabSessionRestoreCompleted] =
    useState(false);
  const [documentTabIndicatorStyle, setDocumentTabIndicatorStyle] =
    useState<CSSProperties>(() => ({
      opacity: 0,
      transform: "translate3d(0px, -50%, 0)",
      width: 0,
    }));
  const [selectedWorkspaceDocumentIds, setSelectedWorkspaceDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let keyboardCloseTimer = 0;
    let restoreScrollFrame = 0;
    let floatingNoteScrollLock: {
      editorPane: HTMLElement;
      left: number;
      top: number;
      windowX: number;
      windowY: number;
    } | null = null;

    function floatingNoteEditableFromTarget(target: EventTarget | null) {
      if (!(target instanceof Element)) return null;
      const editable = target.closest<HTMLElement>(
        "input, textarea, [contenteditable='true']",
      );
      return editable?.closest(".floating-note-panel:not(.is-expanded-sidebar)")
        ? editable
        : null;
    }

    function captureFloatingNoteScrollPosition(event: Event) {
      if (!window.matchMedia(mobileSafeLayoutViewportQuery).matches) return;
      if (!floatingNoteEditableFromTarget(event.target)) return;
      if (event.type === "focusin" && floatingNoteScrollLock) return;

      const editorPane = document.querySelector<HTMLElement>(".editor-pane");
      if (!editorPane) return;
      floatingNoteScrollLock = {
        editorPane,
        left: editorPane.scrollLeft,
        top: editorPane.scrollTop,
        windowX: window.scrollX,
        windowY: window.scrollY,
      };
    }

    function restoreFloatingNoteScrollPosition() {
      const lock = floatingNoteScrollLock;
      if (!lock || !lock.editorPane.isConnected) return;

      if (lock.editorPane.scrollLeft !== lock.left) {
        lock.editorPane.scrollLeft = lock.left;
      }
      if (lock.editorPane.scrollTop !== lock.top) {
        lock.editorPane.scrollTop = lock.top;
      }
      if (window.scrollX !== lock.windowX || window.scrollY !== lock.windowY) {
        window.scrollTo(lock.windowX, lock.windowY);
      }
    }

    function keepFloatingNoteScrollPosition() {
      restoreFloatingNoteScrollPosition();
      window.cancelAnimationFrame(restoreScrollFrame);
      restoreScrollFrame = window.requestAnimationFrame(restoreFloatingNoteScrollPosition);
    }

    function syncVisualViewportProperties() {
      const visualViewport = window.visualViewport;
      const rootElement = document.documentElement;
      document.documentElement.style.setProperty(
        "--visual-viewport-offset-top",
        `${visualViewport?.offsetTop ?? 0}px`,
      );
      document.documentElement.style.setProperty(
        "--visual-viewport-offset-left",
        `${visualViewport?.offsetLeft ?? 0}px`,
      );
      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${visualViewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        "--visual-viewport-width",
        `${visualViewport?.width ?? window.innerWidth}px`,
      );

      const activeElement = document.activeElement;
      const editableElementFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      const softwareKeyboardOpen =
        editableElementFocused &&
        visualViewport !== null &&
        Math.max(window.innerHeight, rootElement.clientHeight) - visualViewport.height > 96;

      if (floatingNoteScrollLock) {
        keepFloatingNoteScrollPosition();
      }

      if (softwareKeyboardOpen) {
        window.clearTimeout(keyboardCloseTimer);
        keyboardCloseTimer = 0;
        rootElement.classList.add("is-mobile-keyboard-open");
      } else if (
        rootElement.classList.contains("is-mobile-keyboard-open") &&
        keyboardCloseTimer === 0
      ) {
        keyboardCloseTimer = window.setTimeout(() => {
          rootElement.classList.remove("is-mobile-keyboard-open");
          floatingNoteScrollLock = null;
          keyboardCloseTimer = 0;
        }, 180);
      }
    }

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("scroll", syncVisualViewportProperties);
    visualViewport?.addEventListener("resize", syncVisualViewportProperties);
    window.addEventListener("resize", syncVisualViewportProperties);
    document.addEventListener("pointerdown", captureFloatingNoteScrollPosition, true);
    document.addEventListener("focusin", captureFloatingNoteScrollPosition, true);
    syncVisualViewportProperties();

    return () => {
      window.clearTimeout(keyboardCloseTimer);
      window.cancelAnimationFrame(restoreScrollFrame);
      visualViewport?.removeEventListener("scroll", syncVisualViewportProperties);
      visualViewport?.removeEventListener("resize", syncVisualViewportProperties);
      window.removeEventListener("resize", syncVisualViewportProperties);
      document.removeEventListener("pointerdown", captureFloatingNoteScrollPosition, true);
      document.removeEventListener("focusin", captureFloatingNoteScrollPosition, true);
      document.documentElement.classList.remove("is-mobile-keyboard-open");
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
      document.documentElement.style.removeProperty("--visual-viewport-offset-left");
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-width");
    };
  }, []);
  const [mobileSelectedWorkspaceEntryKey, setMobileSelectedWorkspaceEntryKey] = useState("");
  const [savedLocations, setSavedLocations] =
    useState<SavedLocationsResult>(emptySavedLocations);
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
  const [mobileNoteSelectionHintVisible, setMobileNoteSelectionHintVisible] =
    useState(false);
  const [noteModeSourceBlockedNoticePosition, setNoteModeSourceBlockedNoticePosition] =
    useState<CSSProperties | null>(null);
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
  const translatedError = (error: unknown, key: TranslationKey = "error.operationFailed") => {
    console.error(error);
    return t(localRecoveryErrorTranslationKey(error) ?? key);
  };
  const mobileAnnotationKeyboardShouldStayClosed =
    isMobileViewport || isMobileSafeLayoutViewport;
  const [editorMode, setEditorMode] = useState<EditorMode>("preview");
  const [editorFocusRequest, setEditorFocusRequest] = useState<EditorFocusRequest | null>(null);
  const [editorSelectAllRequestKey, setEditorSelectAllRequestKey] = useState(0);
  const initialNoteModeEnabled =
    noteModeEnabledByDefault && documentsSeed.length > 0;
  const [noteModeEnabled, setNoteModeEnabled] = useState(initialNoteModeEnabled);
  const [glossaryModeEnabled, setGlossaryModeEnabled] = useState(false);
  const [documentModeStates, setDocumentModeStates] = useState<
    Record<string, DocumentModeState>
  >(() =>
    documentsSeed[0]?.id
      ? {
          [documentsSeed[0].id]: {
            editorMode: "preview",
            noteModeEnabled: initialNoteModeEnabled,
            glossaryModeEnabled: false,
          },
        }
      : {},
  );
  const [directoryPaneOpen, setDirectoryPaneOpen] = useState(false);
  const [windowIsFullscreen, setWindowIsFullscreen] = useState(false);
  const [noteLibraryOpen, setNoteLibraryOpen] = useState(false);
  const [focusedLibraryNoteId, setFocusedLibraryNoteId] = useState("");
  const [expandedLibraryNoteId, setExpandedLibraryNoteId] = useState("");
  const [copiedNoteActionKey, setCopiedNoteActionKey] = useState("");
  const [dirtyDocumentStates, setDirtyDocumentStates] = useState<DirtyDocumentStates>({});
  const [savedDocumentBodies, setSavedDocumentBodies] = useState<Record<string, string>>(() =>
    savedBodiesFromDocuments(documentsSeed),
  );
  const [storageError, setStorageError] = useState("");
  const [settingsViewOpen, setSettingsViewOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingCategory>("app");
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [fileNameTooltip, setFileNameTooltip] = useState<FileNameTooltipState | null>(null);
  const [documentTabContextMenu, setDocumentTabContextMenu] =
    useState<DocumentTabContextMenuState | null>(null);
  const [duplicateFileDialog, setDuplicateFileDialog] =
    useState<DuplicateFileDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [createEntryDialog, setCreateEntryDialog] =
    useState<CreateEntryDialogState | null>(null);
  const [draftFileDialog, setDraftFileDialog] = useState<DraftFileDialogState | null>(null);
  const [openPathDialog, setOpenPathDialog] = useState<OpenPathDialogState | null>(null);
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxConnectionChecked, setDropboxConnectionChecked] = useState(false);
  const [dropboxConnecting, setDropboxConnecting] = useState(false);
  const [dropboxDirectoryPicker, setDropboxDirectoryPicker] =
    useState<DropboxDirectoryPickerState | null>(null);
  const [mobileStartupPhase, setMobileStartupPhase] = useState<MobileStartupPhase>(() => {
    if (!window.matchMedia(mobileViewportQuery).matches) {
      return hasNativeStorageAccess() ? "restoring" : "hidden";
    }
    return readLastOpenedDropboxWorkspace() ? "restoring" : "welcome";
  });
  const [mobileStartupLogoLoaded, setMobileStartupLogoLoaded] = useState(false);
  const [mobileStartupLogoVisible, setMobileStartupLogoVisible] = useState(false);
  const notePanelRef = useRef<HTMLElement | null>(null);
  const floatingNoteCardRef = useRef<HTMLDivElement | null>(null);
  const fileNameTooltipRef = useRef<HTMLDivElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const duplicateFileInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const createEntryInputRef = useRef<HTMLInputElement | null>(null);
  const draftFileInputRef = useRef<HTMLInputElement | null>(null);
  const openPathInputRef = useRef<HTMLInputElement | null>(null);
  const draftFileDialogResolverRef = useRef<((decision: DraftFileDecision) => void) | null>(
    null,
  );
  const storedDraftSnapshotsRef = useRef(new Map<string, string>());
  const draftStoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storedDraftsRestoredRef = useRef(false);
  // Set when launch opens a file or folder the person chose, so restored drafts stay in the background.
  const startupOpenRequestedRef = useRef(false);
  const draftStoreTimerRef = useRef(0);
  const documentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const desktopSourceModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSourceModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const noteEditorRootRef = useRef<HTMLDivElement | null>(null);
  const noteModeDefaultAppliedRef = useRef(noteModeEnabled);
  const returnToViewTimerRef = useRef(0);
  const notePanelCloseTimerRef = useRef(0);
  const floatingNotePanelPositionFrameRef = useRef(0);
  const floatingNoteAnchorRectRef = useRef<TextRangeRect | null>(null);
  const floatingNoteAnchorLockRef = useRef<FloatingNoteAnchorLock | null>(null);
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
  const copiedNoteActionTimerRef = useRef(0);
  const ignoreNextWorkspaceClickRef = useRef(false);
  const fileNameTooltipTimerRef = useRef(0);
  const workspaceFileLongPressTimerRef = useRef(0);
  const workspaceFileLongPressStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const suppressedWorkspaceFileClickRef = useRef<{
    entryId: string;
    until: number;
  } | null>(null);
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
  const saveDocumentHandlerRef = useRef<(document: MarkdownDocument) => Promise<void>>(
    async () => undefined,
  );
  const externalFileRefreshInFlightRef = useRef(false);
  const lastDropboxExternalRefreshRef = useRef<{ path: string; timestamp: number } | null>(null);
  const dropboxTagIndexRequestRef = useRef(0);
  const documentsRef = useRef(documents);
  const workspaceEntriesRef = useRef(workspaceEntries);
  const notesRef = useRef(notes);
  const glossaryTermsRef = useRef(glossaryTerms);
  const glossaryBindingsRef = useRef(glossaryBindings);
  const dirtyDocumentStatesRef = useRef(dirtyDocumentStates);
  const savedDocumentBodiesRef = useRef(savedDocumentBodies);
  const autosaveCoordinatorRef = useRef<
    ReturnType<typeof createAutosaveCoordinator<string>> | null
  >(null);
  if (!autosaveCoordinatorRef.current) {
    autosaveCoordinatorRef.current = createAutosaveCoordinator(
      () =>
        documentsRef.current
          .filter((document) => {
            const hasBackingFile = Boolean(document.filePath) || documentIsFromDropbox(document);
            return hasBackingFile && hasDirtyState(dirtyDocumentStatesRef.current[document.id]);
          })
          .map((document) => document.id),
      async (documentId) => {
        const document = documentsRef.current.find((candidate) => candidate.id === documentId);
        const hasBackingFile =
          document && (Boolean(document.filePath) || documentIsFromDropbox(document));
        if (
          !document ||
          !hasBackingFile ||
          !hasDirtyState(dirtyDocumentStatesRef.current[documentId])
        ) {
          return;
        }
        await saveDocumentHandlerRef.current(document);
      },
    );
  }
  const autosaveCoordinator = autosaveCoordinatorRef.current;
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  const openDocumentTabIdsRef = useRef(openDocumentTabIds);
  const documentTabsScrollerRef = useRef<HTMLDivElement | null>(null);
  const documentTabPointerActivationRef = useRef("");
  const documentTabLongPressTimerRef = useRef(0);
  const suppressedDocumentTabClickRef = useRef<{
    documentId: string;
    until: number;
  } | null>(null);
  const manualDocumentSelectionRevisionRef = useRef(0);
  const documentTabTouchStateRef = useRef<{
    documentId: string;
    longPressTriggered: boolean;
    moved: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  const noteModeEnabledRef = useRef(noteModeEnabled);
  const previousNoteModeEnabledRef = useRef(noteModeEnabled);
  const glossaryModeEnabledRef = useRef(glossaryModeEnabled);
  const editorModeRef = useRef(editorMode);
  const activeDocumentEditorRef = useRef<EditorSelectionHandle | null>(null);
  const editorFocusRequestSequenceRef = useRef(0);
  const pendingEditorModeScrollSnapshotRef = useRef<EditorModeScrollSnapshot | null>(null);
  const documentScrollPositionsRef = useRef<Record<string, DocumentScrollPosition>>({});
  const pendingDocumentScrollPositionRef = useRef<DocumentScrollPosition | null>(null);
  const documentModeStatesRef = useRef(documentModeStates);
  const notePanelHasContentRef = useRef(false);
  const selectionWarningPreserveUntilRef = useRef(0);
  const selectionDismissedUntilRef = useRef(0);
  const selectionClearedByAppUntilRef = useRef(0);
  const lastOpenedFileRestoreAttemptedRef = useRef(false);
  const dropboxPickerModeAfterAuthRef = useRef<DropboxPickerMode | null>(null);
  const pendingDropboxLocationAfterAuthRef = useRef<NativeLocation | null>(null);
  const dropboxPickerSessionRevisionRef = useRef(0);
  const returnToMobileDataSourceOnPickerCancelRef = useRef(false);
  const returnToMobileDataSourceAfterDropboxAuthRef = useRef(false);
  const openSettingsHandlerRef = useRef<() => void>(() => undefined);
  const newMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const newMarkdownFolderHandlerRef = useRef<() => void>(() => undefined);
  const openMarkdownFileHandlerRef = useRef<() => void>(() => undefined);
  const openDroppedMarkdownPathsHandlerRef = useRef<(paths: string[]) => void>(() => undefined);
  const windowCloseRequestHandlerRef = useRef<() => Promise<boolean>>(async () => true);
  const openNewWindowDocumentTargetHandlerRef = useRef<
    (target: OpenLocationEventPayload) => void
  >(() => undefined);
  const openMarkdownFolderHandlerRef = useRef<() => void>(() => undefined);
  const openPathHandlerRef = useRef<() => void>(() => undefined);
  const openDropboxCloudHandlerRef = useRef<() => void>(() => undefined);
  const completeDropboxOAuthHandlerRef = useRef<
    (payload: DropboxOAuthCallbackPayload) => void
  >(() => undefined);

  documentsRef.current = documents;
  workspaceSortModeRef.current = workspaceSortMode;
  workspaceEntriesRef.current = workspaceEntries;
  notesRef.current = notes;
  glossaryTermsRef.current = glossaryTerms;
  glossaryBindingsRef.current = glossaryBindings;
  dirtyDocumentStatesRef.current = dirtyDocumentStates;
  savedDocumentBodiesRef.current = savedDocumentBodies;
  selectedDocumentIdRef.current = selectedDocumentId;
  openDocumentTabIdsRef.current = openDocumentTabIds;
  noteModeEnabledRef.current = noteModeEnabled;
  glossaryModeEnabledRef.current = glossaryModeEnabled;
  editorModeRef.current = editorMode;
  documentModeStatesRef.current = documentModeStates;
  useEffect(() => {
    const menu = createTextContextMenu(
      () => {
        const current = documentsRef.current.find((entry) => entry.id === selectedDocumentIdRef.current);
        return current ? {
          id: current.id,
          path: isDraftDocumentId(current.id) ? null : current.filePath ?? current.path,
          source: documentIsFromDropbox(current) ? "dropbox" : "local",
        } : null;
      },
      () => activeDocumentEditorRef.current,
      (current) => listFileLinkTargets({ path: current.path!, source: current.source }),
      setStorageError,
    );
    window.__scholiumTextMenu = menu;
    const restoreContextMenuSelection = preserveEditorContextMenuSelection(document);
    return () => {
      restoreContextMenuSelection();
      if (window.__scholiumTextMenu === menu) delete window.__scholiumTextMenu;
    };
  }, []);
  noteDraftRef.current = noteDraft;
  glossaryDraftRef.current = glossaryDraft;
  openSettingsHandlerRef.current = openSettingsView;
  newMarkdownFileHandlerRef.current = () => {
    void newMarkdownFile();
  };
  newMarkdownFolderHandlerRef.current = () => {
    void newMarkdownFolder();
  };
  openMarkdownFileHandlerRef.current = () => {
    void openMarkdownFileFromPicker();
  };
  openDroppedMarkdownPathsHandlerRef.current = (paths) => {
    void openDroppedMarkdownPaths(paths);
  };
  windowCloseRequestHandlerRef.current = resolveDraftDocumentsBeforeWindowClose;
  openNewWindowDocumentTargetHandlerRef.current = (target) => {
    void openNativeMenuLocation(target).finally(() => setMobileStartupPhase("hidden"));
  };
  openPathHandlerRef.current = openOpenPathDialog;
  openMarkdownFolderHandlerRef.current = () => {
    void openMarkdownFolder();
  };
  openDropboxCloudHandlerRef.current = () => {
    void openDropboxCloudSource();
  };
  completeDropboxOAuthHandlerRef.current = (payload) => {
    void completeDropboxOAuth(payload);
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(copiedNoteActionTimerRef.current);
      window.clearTimeout(workspaceFileLongPressTimerRef.current);
      window.clearTimeout(documentTabLongPressTimerRef.current);
    };
  }, []);

  const activeDocument = documents.find((document) => document.id === selectedDocumentId);
  const hasOpenDocument = Boolean(activeDocument);
  const selectedDocument = activeDocument ?? emptyDocument;
  const selectedDocumentTags = useMemo(
    () => (hasOpenDocument ? readMarkdownTags(selectedDocument.body) : []),
    [hasOpenDocument, selectedDocument.body],
  );
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const documentTagGroups = useMemo(() => {
    const loadedDocumentsById = new Map(
      documents.map((document) => [document.id, document]),
    );
    const indexedTagsByDocumentId = new Map(
      dropboxIndexedDocumentTags.map((entry) => [entry.documentId, entry.tags]),
    );
    const groups = new Map<string, DocumentTagGroup>();

    workspaceEntries.forEach((entry) => {
      if (entry.kind !== "file") return;

      const loadedDocument = loadedDocumentsById.get(entry.documentId);
      const tags = loadedDocument
        ? readMarkdownTags(loadedDocument.body)
        : indexedTagsByDocumentId.get(entry.documentId) ?? [];

      tags.forEach((tag) => {
        const label = normalizeTagInput(tag);
        const key = tagDedupeKey(label);
        if (!key) return;

        const group = groups.get(key);
        if (!group) {
          groups.set(key, { key, label, entries: [entry] });
          return;
        }
        if (!group.entries.some((candidate) => candidate.documentId === entry.documentId)) {
          group.entries.push(entry);
        }
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort((left, right) =>
          left.title.localeCompare(right.title),
        ),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [documents, dropboxIndexedDocumentTags, workspaceEntries]);
  const documentTagSuggestionGroups = useMemo<DocumentTagSuggestionGroup[]>(
    () =>
      documentTagGroups.map((group) => ({
        key: group.key,
        label: group.label,
        documentCount: group.entries.length,
      })),
    [documentTagGroups],
  );
  const selectedDocumentTagKeys = new Set(selectedDocumentTags.map(tagDedupeKey));
  const normalizedTagDraft = normalizeTagInput(tagDraft);
  const normalizedTagDraftKey = tagDedupeKey(tagDraft);
  const matchingTagPickerGroups = documentTagSuggestionGroups.filter(
    (group) =>
      !normalizedTagDraftKey || tagDedupeKey(group.label).includes(normalizedTagDraftKey),
  );
  const tagPickerGroups = matchingTagPickerGroups.filter(
    (group) => !selectedDocumentTagKeys.has(group.key),
  );
  const visibleTagPickerGroups = normalizedTagDraftKey
    ? matchingTagPickerGroups
    : tagPickerGroups;
  const tagPickerIndexPending = workspaceSource === "dropbox" && dropboxTagIndexLoading;
  const tagPickerCanCreate =
    Boolean(normalizedTagDraft) &&
    !tagPickerIndexPending &&
    !documentTagSuggestionGroups.some((group) => group.key === normalizedTagDraftKey);
  const mobileTagDraftAlreadySelected = selectedDocumentTagKeys.has(normalizedTagDraftKey);
  const openDocumentTabs = openDocumentTabIds
    .map((documentId) => documentsById.get(documentId))
    .filter((document): document is MarkdownDocument => Boolean(document));
  const annotationToolsAvailable = hasOpenDocument;
  const workspaceHasMarkdownFileEntries = workspaceEntries.some(
    (entry) => entry.kind === "file",
  );
  const glossaryModeActive = noteModeEnabled && glossaryModeEnabled;

  useEffect(() => {
    setDocumentTagsExpanded(false);
  }, [selectedDocument.id]);

  useLayoutEffect(() => {
    const list = documentTagsListRef.current;
    if (!list) {
      setHiddenDocumentTagCount(0);
      return;
    }

    const updateHiddenTagCount = () => {
      const chips = Array.from(
        list.querySelectorAll<HTMLElement>(":scope > .document-tag-chip"),
      );
      const rowTops = Array.from(new Set(chips.map((chip) => chip.offsetTop))).sort(
        (left, right) => left - right,
      );
      const thirdRowTop = rowTops[2];
      const nextCount =
        thirdRowTop === undefined
          ? 0
          : chips.filter((chip) => chip.offsetTop >= thirdRowTop).length;

      setHiddenDocumentTagCount((currentCount) =>
        currentCount === nextCount ? currentCount : nextCount,
      );
    };

    updateHiddenTagCount();
    const resizeObserver = new ResizeObserver(updateHiddenTagCount);
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [documentTagGroups, isMobileViewport, selectedDocumentTags]);

  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const documentGlossaryBindings = glossaryBindings.filter(
    (binding) => binding.documentId === selectedDocument.id && binding.status !== "deleted",
  );
  const nativeStorageAvailable = hasNativeStorageAccess();
  const documentSearchVisible =
    hasOpenDocument && !settingsViewOpen && (isMobileViewport || documentSearchOpen);
  const documentTabsVisible = !settingsViewOpen && openDocumentTabs.length > 1;

  useLayoutEffect(() => {
    if (!documentTabsVisible) {
      setDocumentTabIndicatorStyle({
        opacity: 0,
        transform: "translate3d(0px, -50%, 0)",
        width: 0,
      });
      return;
    }

    const scroller = documentTabsScrollerRef.current;
    if (!scroller) return;

    let frameId = 0;
    const syncActiveIndicator = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const activeTab = scroller.querySelector<HTMLElement>(".document-tab.is-active");

        if (!activeTab) {
          setDocumentTabIndicatorStyle({
            opacity: 0,
            transform: "translate3d(0px, -50%, 0)",
            width: 0,
          });
          return;
        }

        setDocumentTabIndicatorStyle({
          opacity: 1,
          transform: `translate3d(${activeTab.offsetLeft}px, -50%, 0)`,
          width: activeTab.offsetWidth,
        });
      });
    };

    syncActiveIndicator();

    const resizeObserver = new ResizeObserver(syncActiveIndicator);
    resizeObserver.observe(scroller);
    scroller
      .querySelectorAll<HTMLElement>(".document-tab")
      .forEach((tab) => resizeObserver.observe(tab));
    window.addEventListener("resize", syncActiveIndicator);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncActiveIndicator);
    };
  }, [documentTabsVisible, openDocumentTabs.length, selectedDocument.id]);

  const activeDocumentSearchQuery = documentSearchVisible ? documentSearchQuery : "";
  const documentSearchState = useMemo<DocumentSearchState>(
    () => ({
      activeIndex: documentSearchActiveIndex,
      query: activeDocumentSearchQuery,
      scrollRequestKey: documentSearchScrollRequestKey,
    }),
    [
      activeDocumentSearchQuery,
      documentSearchActiveIndex,
      documentSearchScrollRequestKey,
    ],
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
  const noteLibraryNotes = activeNotes
    .filter(selectionNoteHasContent)
    .slice()
    .sort(compareNotesByDocumentPosition);
  const visibleNoteToneById = buildVisibleNoteToneMap(activeNotes);

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
      tone: visibleNoteToneById.get(note.id) ?? note.tone,
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
  const activeTextAnnotations = assignAnnotationTones(
    [...activeNoteAnnotations, ...activeGlossaryAnnotations],
    visibleNoteToneById,
  );
  const activeNoteToneById = new Map(
    activeTextAnnotations
      .filter((annotation) => annotation.kind === "note")
      .map((annotation) => [annotation.id, annotation.tone ?? 0]),
  );
  const firstNoteLibraryNoteId = noteLibraryNotes[0]?.id ?? "";
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
  const floatingCopyActionKey = activeNote
    ? `floating:${activeNote.id}`
    : activeGlossaryTerm
      ? `floating-glossary:${activeGlossaryTerm.id}`
      : "";
  const floatingCopyContent = activeNote?.body ?? activeGlossaryTerm?.definition ?? "";
  const floatingCopyLabel = activeGlossaryTerm ? t("glossary.copy") : t("note.copy");
  const floatingCopySuccessLabel = activeGlossaryTerm
    ? t("glossary.copy.copied")
    : t("note.copy.copied");
  const expandedNotePanelActive =
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
    const bodyShell = notePanelRef.current?.querySelector<HTMLElement>(
      ".floating-note-card__body-shell",
    );
    if (bodyShell) {
      bodyShell.scrollTop = 0;
    }
  }, [activeFloatingNoteKey]);

  useEffect(() => {
    if (!floatingNotePanelExpanded) return;

    const panel = notePanelRef.current;
    const bodyShell = panel?.querySelector<HTMLElement>(".floating-note-card__body-shell");
    if (!panel || !bodyShell) return;
    const scrollRoot = bodyShell;

    function handleExpandedFloatingNoteWheel(event: WheelEvent) {
      let scrollTarget = scrollRoot;
      let candidate = event.target instanceof Element ? event.target : null;

      while (candidate && scrollRoot.contains(candidate)) {
        if (
          candidate instanceof HTMLElement &&
          panelScrollTargetCanConsumeWheel(
            event,
            candidate,
            window.getComputedStyle(candidate),
          )
        ) {
          scrollTarget = candidate;
          break;
        }
        if (candidate === scrollRoot) break;
        candidate = candidate.parentElement;
      }

      containWheelInPanel(event, scrollTarget);
    }

    panel.addEventListener("wheel", handleExpandedFloatingNoteWheel, { passive: false });
    return () => panel.removeEventListener("wheel", handleExpandedFloatingNoteWheel);
  }, [floatingNotePanelExpanded, activeFloatingNoteKey]);

  useEffect(() => {
    if (libraryNotePanelExpanded) {
      const bodyScroll = document.querySelector(".note-library-expanded-panel__body-scroll");
      if (bodyScroll) {
        bodyScroll.scrollTop = 0;
      }
    }
  }, [libraryNotePanelExpanded]);

  useEffect(() => {
    if (!activeNoteEditorKey) return;

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      if (event.button !== 0) return;
      if (targetIsInsideNoteMarkdownEditor(event.target)) return;
      if (
        elementFromEventTarget(event.target)?.closest(
          ".floating-note-panel-toggle-button",
        )
      ) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        targetIsInsideNoteMarkdownEditor(activeElement)
      ) {
        activeElement.blur();
      }
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
    if (!libraryNotePanelExpanded) return undefined;

    const originalBodyOverflow = document.body.style.overflow;
    const originalDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalDocumentOverflow;
    };
  }, [libraryNotePanelExpanded]);

  useEffect(() => {
    if (!expandedNotePanelActive || !directoryPaneOpen) return;

    collapseDirectoryPaneForNoteExpansion();
  }, [directoryPaneOpen, expandedNotePanelActive]);

  useEffect(() => {
    setDocumentModeState(selectedDocumentId, {
      noteModeEnabled,
      glossaryModeEnabled,
    });
  }, [glossaryModeEnabled, noteModeEnabled, selectedDocumentId]);

  useEffect(() => {
    setMobileNoteSelectionHintVisible(false);
    setNoteModeSourceBlockedNoticePosition(null);
  }, [selectedDocumentId]);

  useEffect(() => {
    const noteModeJustEnabled = noteModeEnabled && !previousNoteModeEnabledRef.current;
    previousNoteModeEnabledRef.current = noteModeEnabled;

    if (
      !noteModeJustEnabled ||
      settingsViewOpen
    ) {
      if (!noteModeEnabled || settingsViewOpen) {
        setMobileNoteSelectionHintVisible(false);
        setNoteModeSourceBlockedNoticePosition(null);
      }
      return;
    }

    setMobileNoteSelectionHintVisible(false);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setMobileNoteSelectionHintVisible(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [noteModeEnabled, settingsViewOpen]);

  useEffect(() => {
    if (!mobileNoteSelectionHintVisible) return undefined;

    const hideTimer = window.setTimeout(
      () => setMobileNoteSelectionHintVisible(false),
      3000,
    );
    const hideOnPointerDown = () => setMobileNoteSelectionHintVisible(false);
    window.addEventListener("pointerdown", hideOnPointerDown, true);

    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("pointerdown", hideOnPointerDown, true);
    };
  }, [mobileNoteSelectionHintVisible]);

  useEffect(() => {
    if (!noteModeSourceBlockedNoticePosition) return undefined;

    const hideTimer = window.setTimeout(
      () => setNoteModeSourceBlockedNoticePosition(null),
      3000,
    );
    const hideOnPointerDown = () => setNoteModeSourceBlockedNoticePosition(null);
    window.addEventListener("pointerdown", hideOnPointerDown, true);

    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("pointerdown", hideOnPointerDown, true);
    };
  }, [noteModeSourceBlockedNoticePosition]);

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

    if (documentModeStatesRef.current[selectedDocumentId]) {
      noteModeDefaultAppliedRef.current = noteModeEnabled;
      return;
    }

    if (noteModeDefaultAppliedRef.current) return;

    noteModeDefaultAppliedRef.current = true;
    setActiveDocumentModeState({
      noteModeEnabled: true,
      glossaryModeEnabled: false,
    });
  }, [hasOpenDocument, noteModeEnabled, noteModeEnabledByDefault, selectedDocumentId]);

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
      !isMobileViewport ||
      settingsViewOpen ||
      !noteModeEnabled ||
      !noteLibraryOpen ||
      focusedLibraryNoteId ||
      !firstNoteLibraryNoteId
    ) {
      return;
    }

    setFocusedLibraryNoteId(firstNoteLibraryNoteId);
  }, [
    firstNoteLibraryNoteId,
    focusedLibraryNoteId,
    isMobileViewport,
    noteLibraryOpen,
    noteModeEnabled,
    settingsViewOpen,
  ]);

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
      const selection = window.getSelection();
      const selectedText = selection?.toString() ?? "";
      if (!selectedText) return;
      if (!event.clipboardData) return;
      const selectionElements = [selection?.anchorNode, selection?.focusNode]
        .map((node) => (node instanceof Element ? node : node?.parentElement ?? null))
        .filter((element): element is Element => Boolean(element));
      if (
        selectionElements.some((element) => element.closest(".milkdown-markdown-editor"))
      ) {
        return;
      }

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

  useLayoutEffect(() => {
    if (!fileNameTooltip || fileNameTooltip.position || !fileNameTooltipRef.current) return;

    const tooltipRect = fileNameTooltipRef.current.getBoundingClientRect();
    const position = fileNameTooltipPosition({
      anchorRect: fileNameTooltip.anchorRect,
      tooltipRect,
      viewportRect: currentVisualViewportRect(),
    });
    setFileNameTooltip((currentTooltip) =>
      currentTooltip?.key === fileNameTooltip.key
        ? { ...currentTooltip, position }
        : currentTooltip,
    );
  }, [fileNameTooltip]);

  useEffect(() => {
    if (!fileNameTooltip) return;

    const hideTooltip = () => setFileNameTooltip(null);
    window.addEventListener("resize", hideTooltip);
    window.visualViewport?.addEventListener("resize", hideTooltip);
    window.visualViewport?.addEventListener("scroll", hideTooltip);
    document.addEventListener("scroll", hideTooltip, true);

    return () => {
      window.removeEventListener("resize", hideTooltip);
      window.visualViewport?.removeEventListener("resize", hideTooltip);
      window.visualViewport?.removeEventListener("scroll", hideTooltip);
      document.removeEventListener("scroll", hideTooltip, true);
    };
  }, [fileNameTooltip?.key]);

  useEffect(
    () => () => {
      window.clearTimeout(fileNameTooltipTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    window.clearTimeout(fileNameTooltipTimerRef.current);
    fileNameTooltipTimerRef.current = 0;
    setFileNameTooltip(null);
  }, [directoryPaneOpen, fileSearchMode, fileSearchQuery, workspaceEntries]);

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
      floatingNoteAnchorLockRef.current = null;
      setFloatingNotePanelPosition(null);
      return;
    }

    let anchorMeasureRetryCount = 0;

    function measureFloatingNotePanelPosition() {
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
      const expectsAnchor = Boolean(
        activeNote ||
          activeNoteId ||
          activeGlossaryBinding ||
          activeGlossaryBindingId ||
          pendingAnchor,
      );

      const cardRect = card?.getBoundingClientRect();
      const cardSize = {
        height: card?.offsetHeight || cardRect?.height || 0,
        width: card?.offsetWidth || cardRect?.width || 0,
      };

      function setPositionForAnchor(anchorRect: TextRangeRect | null) {
        if (!anchorRect) {
          floatingNoteAnchorLockRef.current = null;
        }
        const nextPosition = anchorRect
          ? calculateFloatingNotePosition(anchorRect, cardSize)
          : calculateDetachedFloatingNotePosition(cardSize);
        setFloatingNotePanelPosition((currentPosition) =>
          floatingNotePositionsAreEqual(currentPosition, nextPosition)
            ? currentPosition
            : nextPosition,
        );
      }

      if (measuredAnchorRect) {
        anchorMeasureRetryCount = 0;
        floatingNoteAnchorRectRef.current = measuredAnchorRect;
      } else if (expectsAnchor) {
        const fallbackAnchorRect = floatingNoteAnchorRectRef.current;
        if (anchorMeasureRetryCount < 24) {
          if (fallbackAnchorRect) {
            setPositionForAnchor(fallbackAnchorRect);
          } else {
            setFloatingNotePanelPosition(null);
          }
          anchorMeasureRetryCount += 1;
          updateFloatingNotePanelPosition();
          return;
        }

        if (fallbackAnchorRect) {
          setPositionForAnchor(fallbackAnchorRect);
          return;
        }

        floatingNoteAnchorRectRef.current = null;
        closeNotePanel();
        return;
      }

      setPositionForAnchor(measuredAnchorRect);
    }

    function updateFloatingNotePanelPosition() {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
      floatingNotePanelPositionFrameRef.current = window.requestAnimationFrame(
        measureFloatingNotePanelPosition,
      );
    }

    measureFloatingNotePanelPosition();
    window.addEventListener("resize", updateFloatingNotePanelPosition);
    window.visualViewport?.addEventListener("resize", updateFloatingNotePanelPosition);
    window.visualViewport?.addEventListener("scroll", updateFloatingNotePanelPosition);
    document.addEventListener("scroll", updateFloatingNotePanelPosition, true);

    const resizeObserver = new ResizeObserver(() => {
      updateFloatingNotePanelPosition();
    });
    const editorFrame = document.querySelector(".editor-content-frame");
    if (editorFrame) {
      resizeObserver.observe(editorFrame);
    }
    const floatingNoteCard = floatingNoteCardRef.current;
    if (floatingNoteCard) {
      resizeObserver.observe(floatingNoteCard);
    }

    return () => {
      window.cancelAnimationFrame(floatingNotePanelPositionFrameRef.current);
      window.removeEventListener("resize", updateFloatingNotePanelPosition);
      window.visualViewport?.removeEventListener("resize", updateFloatingNotePanelPosition);
      window.visualViewport?.removeEventListener("scroll", updateFloatingNotePanelPosition);
      document.removeEventListener("scroll", updateFloatingNotePanelPosition, true);
      resizeObserver.disconnect();
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
    floatingNotePanelExpanded,
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

  function textRangeRectFromSelectionEnterContext(
    context?: TextSelectionEnterContext,
  ): TextRangeRect | null {
    const rect = context?.anchorRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      targetBottom: rect.targetBottom,
      targetTop: rect.targetTop,
      targetX: rect.targetX,
      targetY: rect.targetY,
      top: rect.top,
      width: rect.width,
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

    return null;
  }

  function clearSelectionWarning() {
    selectionWarningPreserveUntilRef.current = 0;
    setSelectionWarningPosition(null);
  }

  function annotationAnchorRect(annotationId: string) {
    const textElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".milkdown-note-annotation[data-note-id]",
      ),
    ).filter((element) => element.dataset.noteId === annotationId);
    const textRects = textElements.flatMap((element) =>
      Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0),
    );
    const textAnchorRect = textAnchorRectFromClientRects(textRects);
    if (textAnchorRect) return textAnchorRect;

    const frameElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".milkdown-annotation-frame[data-note-id]",
      ),
    ).filter((element) => element.dataset.noteId === annotationId);
    const frameRects = frameElements.flatMap((element) =>
      Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0),
    );
    return textAnchorRectFromClientRects(frameRects);
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
    rect: DOMRect,
    scrollContainer: HTMLElement | null,
    behavior: ScrollBehavior = "instant",
  ) {
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetViewportTop = containerRect.top + containerRect.height * noteLibraryFocusAlignmentRatio;
      const currentViewportTop = rect.top;
      const offset = currentViewportTop - targetViewportTop;
      if (Math.abs(offset) > 1) {
        scrollContainer.scrollBy({ top: offset, behavior });
      }
      return true;
    }

    const targetViewportTop = window.innerHeight * noteLibraryFocusAlignmentRatio;
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const rawTop = window.scrollY + rect.top - targetViewportTop;
    const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    const nextTop = clampNumber(rawTop, 0, maxTop);

    if (Math.abs(window.scrollY - nextTop) > 1) {
      window.scrollTo({ top: nextTop, behavior });
    }
    return true;
  }

  function annotationElementsForNote(noteId: string) {
    const safeNoteId = cssAttributeSelectorValue(noteId);
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        `.milkdown-annotation-frame[data-note-id="${safeNoteId}"], .milkdown-note-annotation[data-note-id="${safeNoteId}"]`,
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

  function alignFocusedAnnotationToViewport(noteId: string, behavior: ScrollBehavior = "instant") {
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
      annotationElements[0].getBoundingClientRect(),
      scrollableAncestor(annotationElements[0]),
      behavior,
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

  function floatingLayerPointFromViewport(clientX: number, clientY: number) {
    if (mobileAnnotationKeyboardShouldStayClosed) {
      return {
        left: clientX,
        top: clientY,
      };
    }

    return shellRelativePointFromViewport(clientX, clientY);
  }

  function fileNameTooltipTargetIsTruncated(target: HTMLElement) {
    return Array.from(
      target.querySelectorAll<HTMLElement>("[data-file-name-overflow]"),
    ).some((element) => fileNameTextIsTruncated(element));
  }

  function hideFileNameTooltip() {
    window.clearTimeout(fileNameTooltipTimerRef.current);
    fileNameTooltipTimerRef.current = 0;
    setFileNameTooltip(null);
  }

  function showFileNameTooltip(
    target: HTMLButtonElement,
    key: string,
    title: string,
    detail?: string,
  ) {
    if (!fileNameTooltipTargetIsTruncated(target)) return;

    const rect = target.getBoundingClientRect();
    setFileNameTooltip({
      anchorRect: { right: rect.right, top: rect.top },
      detail,
      key,
      position: null,
      title,
    });
  }

  function scheduleFileNameTooltip(
    target: HTMLButtonElement,
    key: string,
    title: string,
    detail?: string,
  ) {
    if (isMobileViewport) return;

    hideFileNameTooltip();
    fileNameTooltipTimerRef.current = window.setTimeout(() => {
      fileNameTooltipTimerRef.current = 0;
      showFileNameTooltip(target, key, title, detail);
    }, fileNameTooltipHoverDelayMs);
  }

  function showFocusedFileNameTooltip(
    event: FocusEvent<HTMLButtonElement>,
    key: string,
    title: string,
    detail?: string,
  ) {
    if (!event.currentTarget.matches(":focus-visible")) return;

    hideFileNameTooltip();
    showFileNameTooltip(event.currentTarget, key, title, detail);
  }

  function handleFileNameTooltipKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") hideFileNameTooltip();
  }

  function fileNameTooltipDescribedBy(key: string) {
    return fileNameTooltip?.key === key && fileNameTooltip.position
      ? fileNameTooltipId
      : undefined;
  }

  function currentVisualViewportRect() {
    const visualViewport = window.visualViewport;
    const left = visualViewport?.offsetLeft ?? 0;
    const top = visualViewport?.offsetTop ?? 0;
    const width = visualViewport?.width ?? window.innerWidth;
    const height = visualViewport?.height ?? window.innerHeight;

    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
    };
  }

  function currentFloatingNoteViewportRect() {
    const viewportRect = currentVisualViewportRect();
    if (!isMobileViewport) return viewportRect;

    const commandBarRect = document
      .querySelector<HTMLElement>(".mobile-command-bar")
      ?.getBoundingClientRect();
    if (!commandBarRect || commandBarRect.height <= 0) return viewportRect;

    const bottom = Math.min(viewportRect.bottom, commandBarRect.top);
    return {
      ...viewportRect,
      bottom,
      height: Math.max(0, bottom - viewportRect.top),
    };
  }

  function currentFloatingNoteBoundsRect() {
    const viewportRect = currentFloatingNoteViewportRect();
    if (isMobileViewport) return viewportRect;

    const editorBodyRect = document
      .querySelector<HTMLElement>(
        ".editor-content-frame > .milkdown-markdown-editor-shell, .editor-content-frame > .markdown-editor-host",
      )
      ?.getBoundingClientRect();

    return floatingNoteViewportRectWithinHorizontalBounds({
      contentRect: editorBodyRect ?? null,
      viewportRect,
    });
  }

  function calculateFloatingNotePosition(
    anchorRect: TextRangeRect,
    cardRect: Pick<DOMRect, "height" | "width">,
  ): FloatingNotePosition {
    const viewportRect = currentFloatingNoteBoundsRect();
    const viewportMargin = isMobileViewport ? 32 : 12;
    const maxWidth = Math.max(0, viewportRect.right - viewportRect.left - viewportMargin * 2);
    const cardWidth = Math.min(
      cardRect.width || 450,
      maxWidth,
    );
    const cardHeight = cardRect.height || 260;
    const anchorLock =
      floatingNoteAnchorLockRef.current?.key === activeFloatingNoteKey
        ? floatingNoteAnchorLockRef.current
        : null;
    const geometry = anchoredFloatingNoteGeometry({
      anchorRect,
      cardHeight,
      cardWidth,
      flipAboveWhenNeeded: true,
      lockedPlacement: anchorLock?.placement,
      panelEdgeOffset: anchorLock?.panelEdgeOffset,
      viewportMargin,
      viewportRect,
    });
    if (!anchorLock && activeFloatingNoteKey) {
      const anchorY =
        geometry.placement === "above" ? anchorRect.top : anchorRect.bottom;
      const panelEdgeY =
        geometry.placement === "above" ? geometry.top + cardHeight : geometry.top;
      floatingNoteAnchorLockRef.current = {
        key: activeFloatingNoteKey,
        panelEdgeOffset: panelEdgeY - anchorY,
        placement: geometry.placement,
      };
    }
    const panelPoint = floatingLayerPointFromViewport(geometry.left, geometry.top);
    const connectorPoint = floatingLayerPointFromViewport(
      geometry.connector.left,
      geometry.connector.top,
    );

    return {
      connector: {
        angle: geometry.connector.angle,
        left: Math.round(connectorPoint.left),
        top: Math.round(connectorPoint.top),
        width: geometry.connector.width,
      },
      left: Math.round(panelPoint.left),
      maxWidth: Math.round(maxWidth),
      placement: geometry.placement,
      top: Math.round(panelPoint.top),
    };
  }

  function calculateDetachedFloatingNotePosition(
    cardRect: Pick<DOMRect, "height" | "width">,
  ): FloatingNotePosition {
    const viewportRect = currentFloatingNoteBoundsRect();
    const viewportMargin = 12;
    const maxWidth = Math.max(0, viewportRect.right - viewportRect.left - viewportMargin * 2);
    const cardHeight = Math.min(
      cardRect.height || 260,
      Math.max(120, viewportRect.height - viewportMargin * 2),
    );
    const maxFittingTop = viewportRect.bottom - viewportMargin - cardHeight;
    const top =
      maxFittingTop >= viewportRect.top + viewportMargin
        ? maxFittingTop
        : viewportRect.top + viewportMargin;
    const panelPoint = floatingLayerPointFromViewport(viewportRect.left + viewportMargin, top);

    return {
      connector: null,
      left: Math.round(panelPoint.left),
      maxWidth: Math.round(maxWidth),
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
      leftPosition.maxWidth === rightPosition.maxWidth &&
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

  function targetIsInsideDocumentSearch(target: EventTarget | null) {
    const targetElement = elementFromEventTarget(target);
    return Boolean(targetElement?.closest(".document-search"));
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
    if (targetIsInsideDocumentSearch(event.target)) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.length !== 1 || event.isComposing) return false;

    if (!insertTextIntoActiveNoteEditor(event.key)) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function redirectOutsideNoteEditInputEvent(event: Event) {
    if (targetIsInsideNotePanel(event.target)) return false;
    if (targetIsInsideDocumentSearch(event.target)) return false;

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
      ".milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
    );

    return (
      noteElement?.dataset.noteId === activeNoteId ||
      noteElement?.dataset.noteId === `glossary:${activeGlossaryBindingId}`
    );
  }

  function pointHitsLibraryNoteRange(noteId: string, clientX: number, clientY: number) {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
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
      ".milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
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
        ".milkdown-note-annotation[data-note-id], .milkdown-annotation-frame[data-note-id]",
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

    return false;
  }

  function notePanelKeepsFocus(target: EventTarget | null, clientX?: number, clientY?: number) {
    if (
      targetIsInsideNotePanel(target) ||
      targetIsActiveNoteRange(target)
    ) {
      return true;
    }

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
    if (!isMobileViewport) {
      setDocumentSearchQuery("");
      setDocumentSearchActiveIndex(0);
      setDocumentSearchMatchCount(0);
    }
    if (isMobileViewport) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.closest(".document-search")) {
        activeElement.blur();
      }
    }
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
    if (value.trim()) {
      setDocumentSearchScrollRequestKey((requestKey) => requestKey + 1);
    }
  }

  function moveDocumentSearch(delta: number) {
    if (documentSearchMatchCount <= 0) return;

    setDocumentSearchScrollRequestKey((requestKey) => requestKey + 1);
    setDocumentSearchActiveIndex(
      (currentIndex) =>
        (currentIndex + delta + documentSearchMatchCount) % documentSearchMatchCount,
    );
  }

  function handleDocumentSearchInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const historyAction = documentSearchHistoryAction(event.nativeEvent);
    if (historyAction) {
      event.preventDefault();
      event.stopPropagation();
      document.execCommand(historyAction);
      return;
    }

    if (isDocumentSearchSelectAllShortcut(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.select();
      return;
    }

    const moveDelta = documentSearchMoveDeltaForKeyDown(event.nativeEvent);
    if (moveDelta !== 0) {
      event.preventDefault();
      moveDocumentSearch(moveDelta);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeDocumentSearch();
    }
  }

  useEffect(() => {
    if (!documentSearchOpen) return;

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      if (targetIsInsideDocumentSearch(event.target)) return;

      documentSearchInputRef.current?.blur();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [documentSearchOpen]);

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
        if (targetIsInsideDocumentSearch(event.target)) return;
        if (isMobileViewport) return;

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
        if (targetIsInsideDocumentSearch(event.target)) return;
        if (isMobileViewport) return;

        handleNotePanelOutsideModalInteraction(event);
        return;
      }
      if (notePanelKeepsFocus(event.target, event.clientX, event.clientY)) return;

      dismissNotePanelFromAppInteraction();
    }

    function handleDocumentFocusIn(event: Event) {
      if (notePanelModalActive) {
        if (targetIsInsideNotePanel(event.target)) return;
        if (targetIsInsideDocumentSearch(event.target)) return;

        handleNotePanelOutsideModalInteraction(event);
        return;
      }
      if (notePanelKeepsFocus(event.target)) return;

      dismissNotePanelFromAppInteraction();
    }

    function handleDocumentClick(event: globalThis.MouseEvent) {
      if (!isMobileViewport || !notePanelModalActive) return;
      if (targetIsInsideNotePanel(event.target)) return;
      if (targetIsInsideDocumentSearch(event.target)) return;

      handleNotePanelOutsideModalInteraction(event);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("mousedown", handleDocumentMouseDown, true);
    document.addEventListener("focusin", handleDocumentFocusIn, true);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      document.removeEventListener("focusin", handleDocumentFocusIn, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [
    activeGlossaryBindingId,
    activeNoteId,
    isNotePanelClosing,
    isMobileViewport,
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
      if (targetIsInsideDocumentSearch(event.target)) return;
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
    if (!fileContextMenu && !documentTabContextMenu) return;

    function dismissContextMenus() {
      setFileContextMenu(null);
      setDocumentTabContextMenu(null);
    }

    function handleContextMenuKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      dismissContextMenus();
    }

    document.addEventListener("pointerdown", dismissContextMenus);
    document.addEventListener("scroll", dismissContextMenus, true);
    window.addEventListener("keydown", handleContextMenuKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", dismissContextMenus);
      document.removeEventListener("scroll", dismissContextMenus, true);
      window.removeEventListener("keydown", handleContextMenuKeyDown, true);
    };
  }, [documentTabContextMenu, fileContextMenu]);

  useEffect(() => {
    if (!duplicateFileDialog) return;

    window.setTimeout(() => {
      duplicateFileInputRef.current?.focus();
      duplicateFileInputRef.current?.select();
    });
  }, [duplicateFileDialog?.documentId]);

  useEffect(() => {
    if (!renameDialog) return;

    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameDialog?.path]);

  useEffect(() => {
    if (!createEntryDialog) return;

    window.setTimeout(() => {
      createEntryInputRef.current?.focus();
      createEntryInputRef.current?.select();
    });
  }, [createEntryDialog?.kind]);

  useEffect(() => {
    if (!draftFileDialog) return;

    window.setTimeout(() => {
      draftFileInputRef.current?.focus();
      draftFileInputRef.current?.select();
    });
  }, [draftFileDialog?.documentId]);

  useEffect(() => {
    if (!openPathDialog) return;

    window.setTimeout(() => {
      openPathInputRef.current?.focus();
      openPathInputRef.current?.select();
    });
  }, [Boolean(openPathDialog)]);

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

    void setAppLanguage({ language: appLanguage }).catch((error) => {
      console.error(error);
    });
  }, [appLanguage, nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable) {
      setSavedLocations(emptySavedLocations);
      return;
    }
    if (!isMobileViewport || !mobileDataSourceOpen) return;

    void refreshSavedLocations();
  }, [isMobileViewport, mobileDataSourceOpen, nativeStorageAvailable]);

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
      void searchMarkdownFiles({
        exactTag: Boolean(
          fileSearchMode === "tags" &&
            exactTagSearchKey &&
            exactTagSearchKey === tagDedupeKey(query),
        ),
        rootPath: workspaceRootPath!,
        query,
        searchTags: fileSearchMode === "tags",
      })
        .then((results) => {
          if (cancelled) return;
          setLocalFileSearchResults(results);
        })
        .catch((error) => {
          if (cancelled) return;
          setLocalFileSearchResults([]);
          setFileSearchError(translatedError(error, "fileSearch.error"));
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
  }, [
    exactTagSearchKey,
    fileSearchMode,
    fileSearchQuery,
    nativeStorageAvailable,
    workspaceRootPath,
    workspaceSource,
  ]);

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

      refreshSelectedDocumentFromBackingStore();
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

    let disposed = false;
    let unlistenOpenedFilePaths: (() => void) | null = null;

    function completeDocumentTabSessionRestore() {
      if (!disposed) {
        setDocumentTabSessionRestoreCompleted(true);
      }
    }

    function restoreLastOpenedFile() {
      const lastOpenedDropboxWorkspace = readLastOpenedDropboxWorkspace();
      const dropboxTabSession = lastOpenedDropboxWorkspace
        ? documentTabSessionForWorkspace(
            "dropbox",
            lastOpenedDropboxWorkspace.workspacePath,
          )
        : null;
      if (isMobileViewport) {
        if (!lastOpenedDropboxWorkspace) {
          setMobileStartupPhase("welcome");
          completeDocumentTabSessionRestore();
          return;
        }

        setMobileStartupPhase("restoring");
        void restoreLastOpenedDropboxWorkspace(
          lastOpenedDropboxWorkspace,
          dropboxTabSession,
        ).then((workspaceRestored) => {
          if (!disposed) {
            setMobileStartupPhase(workspaceRestored ? "hidden" : "welcome");
          }
        }).finally(() => {
          completeDocumentTabSessionRestore();
        });
        return;
      }

      if (!settingsSnapshot["app.restoreLastOpenedFile"]) {
        setMobileStartupPhase("hidden");
        completeDocumentTabSessionRestore();
        return;
      }

      if (lastOpenedDropboxWorkspace) {
        void restoreLastOpenedDropboxWorkspace(
          lastOpenedDropboxWorkspace,
          dropboxTabSession,
        ).finally(() => {
          if (!disposed) setMobileStartupPhase("hidden");
          completeDocumentTabSessionRestore();
        });
        return;
      }

      const savedTabSession = readDocumentTabSession();
      const lastOpenedRootDirectoryPath =
        readLastOpenedMarkdownRootDirectoryPath() ||
        (savedTabSession?.source === "local" ? savedTabSession.workspacePath : "");
      const localTabSession = lastOpenedRootDirectoryPath
        ? documentTabSessionForWorkspace("local", lastOpenedRootDirectoryPath)
        : null;
      const lastOpenedPath =
        localTabSession?.activeDocumentPath || readLastOpenedMarkdownPath();
      if (!lastOpenedPath && !lastOpenedRootDirectoryPath) {
        setMobileStartupPhase("hidden");
        completeDocumentTabSessionRestore();
        return;
      }

      const restoreSelectionRevision = manualDocumentSelectionRevisionRef.current;
      // True once the person opened another file or folder while this was loading.
      const restoreWasInterrupted = () =>
        manualDocumentSelectionRevisionRef.current !== restoreSelectionRevision;

      setStorageError(t("status.openingLastFile"));

      function restoreFromSelectedFileParent() {
        if (!lastOpenedPath) {
          forgetLastOpenedMarkdownRootDirectoryPath();
          setStorageError("");
          setMobileStartupPhase("hidden");
          completeDocumentTabSessionRestore();
          return;
        }

        void openMarkdownFileContext({
          path: lastOpenedPath,
        })
          .then((context) => {
            if (restoreWasInterrupted()) return;

            applyOpenedDirectory(directoryWithSelectedFile(context), context.selectedFile.path, {
              rememberRecent: false,
            });
            setStorageError("");
          })
          .catch((error) => {
            if (restoreWasInterrupted()) return;

            forgetLastOpenedMarkdownPath();
            forgetLastOpenedMarkdownRootDirectoryPath();
            console.error(error);
            setStorageError(t("error.couldNotReopenLastFile"));
          })
          .finally(() => {
            if (!disposed) setMobileStartupPhase("hidden");
            completeDocumentTabSessionRestore();
          });
      }

      if (lastOpenedRootDirectoryPath) {
        void restoreLastOpenedMarkdownWorkspace(
          lastOpenedRootDirectoryPath,
          lastOpenedPath,
          localTabSession,
        )
          .then((restored) => {
            if (restored) setStorageError("");
            if (!disposed) setMobileStartupPhase("hidden");
            completeDocumentTabSessionRestore();
          })
          .catch(() => {
            if (restoreWasInterrupted()) {
              if (!disposed) setMobileStartupPhase("hidden");
              completeDocumentTabSessionRestore();
              return;
            }

            forgetLastOpenedMarkdownRootDirectoryPath();
            restoreFromSelectedFileParent();
          });
        return;
      }

      restoreFromSelectedFileParent();
    }

    void listen<string[]>("scholium-open-file-paths", (event) => {
      if (!disposed) {
        if (!storedDraftsRestoredRef.current) startupOpenRequestedRef.current = true;
        openDroppedMarkdownPathsHandlerRef.current(event.payload);
      }
    }).then(async (listener) => {
      if (disposed || lastOpenedFileRestoreAttemptedRef.current) {
        listener();
        return;
      }

      unlistenOpenedFilePaths = listener;
      lastOpenedFileRestoreAttemptedRef.current = true;

      try {
        const newWindowTarget = await takeNewWindowDocumentTarget();
        if (disposed) return;
        if (newWindowTarget) {
          startupOpenRequestedRef.current = true;
          openNewWindowDocumentTargetHandlerRef.current(newWindowTarget);
          completeDocumentTabSessionRestore();
          return;
        }
      } catch (error) {
        console.error(error);
      }

      try {
        const openedFilePaths = await takeOpenedFilePaths();
        if (disposed) return;
        if (openedFilePaths.length > 0) {
          startupOpenRequestedRef.current = true;
          openDroppedMarkdownPathsHandlerRef.current(openedFilePaths);
          completeDocumentTabSessionRestore();
          return;
        }
      } catch (error) {
        console.error(error);
      }

      if (!disposed) {
        restoreLastOpenedFile();
      }
    });

    return () => {
      disposed = true;
      unlistenOpenedFilePaths?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    function handleEditorSelectAllKeyUp(event: KeyboardEvent) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const activeEditor =
        activeElement instanceof Element
          ? activeElement.closest(
              ".editor-content-frame .milkdown-markdown-editor, .editor-content-frame .markdown-editor-host",
            )
          : null;
      const documentSurfaceOwnsShortcut =
        activeElement === document.body || activeElement === document.documentElement;
      if (!activeEditor && !documentSurfaceOwnsShortcut) return;
      if (!shouldHandlePreviewSelectAllShortcut(event, true, false)) return;

      setEditorSelectAllRequestKey((currentKey) => currentKey + 1);
    }

    document.addEventListener("keyup", handleEditorSelectAllKeyUp, true);

    return () => {
      document.removeEventListener("keyup", handleEditorSelectAllKeyUp, true);
    };
  }, []);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let disposed = false;
    let unlistenDragDrop: (() => void) | null = null;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (!disposed && event.payload.type === "drop") {
          openDroppedMarkdownPathsHandlerRef.current(event.payload.paths);
        }
      })
      .then((listener) => {
        if (disposed) {
          listener();
          return;
        }
        unlistenDragDrop = listener;
      });

    return () => {
      disposed = true;
      unlistenDragDrop?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let disposed = false;
    let unlistenCloseRequested: (() => void) | null = null;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        let canClose = true;
        try {
          canClose = await windowCloseRequestHandlerRef.current();
        } catch (error) {
          console.error(error);
        }
        if (!canClose) {
          event.preventDefault();
        }
      })
      .then((listener) => {
        if (disposed) {
          listener();
          return;
        }
        unlistenCloseRequested = listener;
      })
      .catch((error: unknown) => {
        console.error(error);
      });

    return () => {
      disposed = true;
      unlistenCloseRequested?.();
    };
  }, [nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable || draftStoreTimerRef.current) return;
    if (!documents.some((document) => isDraftDocumentId(document.id))) return;

    // Throttled rather than debounced, so continuous typing is still written every 300 ms.
    draftStoreTimerRef.current = window.setTimeout(() => {
      draftStoreTimerRef.current = 0;
      storeChangedDraftDocuments();
    }, 300);
  }, [documents, glossaryBindings, glossaryTerms, nativeStorageAvailable, notes]);

  useEffect(() => {
    if (
      !nativeStorageAvailable ||
      !documentTabSessionRestoreCompleted ||
      storedDraftsRestoredRef.current
    ) {
      return;
    }

    storedDraftsRestoredRef.current = true;
    // Only the first window reopens unnamed files, so they never appear twice.
    if (getCurrentWindow().label !== "main") return;
    void restoreStoredDraftDocuments();
  }, [documentTabSessionRestoreCompleted, nativeStorageAvailable]);

  useEffect(() => {
    if (!nativeStorageAvailable || !documentIsFromDropbox(selectedDocument)) return;

    rememberLastOpenedDropboxWorkspace(
      workspaceRootPath ??
        readLastOpenedDropboxWorkspace()?.workspacePath ??
        dropboxParentDirectoryPath(selectedDocument.path),
      selectedDocument.path,
    );
  }, [nativeStorageAvailable, selectedDocument.id, selectedDocument.path, workspaceRootPath]);

  useEffect(() => {
    if (!nativeStorageAvailable || !documentTabSessionRestoreCompleted) return;

    if (documentIsFromDropbox(selectedDocument)) {
      rememberRecentOpenedFile("dropbox", selectedDocument.path);
    } else if (selectedDocument.filePath) {
      rememberRecentOpenedFile("local", selectedDocument.filePath);
    }
  }, [
    documentTabSessionRestoreCompleted,
    nativeStorageAvailable,
    selectedDocument.filePath,
    selectedDocument.id,
    selectedDocument.path,
  ]);

  useEffect(() => {
    if (
      !nativeStorageAvailable ||
      !documentTabSessionRestoreCompleted ||
      !workspaceSource ||
      workspaceRootPath === null
    ) {
      return;
    }

    const sessionSource = workspaceSource;
    const sessionWorkspacePath = workspaceRootPath;

    const openDocumentPaths = openDocumentTabIds.flatMap((documentId) => {
      const document = documents.find((candidate) => candidate.id === documentId);
      if (!document || isDraftDocumentId(document.id)) return [];

      const fromDropbox = documentIsFromDropbox(document);
      if (
        (sessionSource === "dropbox" && !fromDropbox) ||
        (sessionSource === "local" && fromDropbox)
      ) {
        return [];
      }

      return [fromDropbox ? document.path : (document.filePath ?? document.path)];
    });
    const activeDocument = documents.find(
      (document) => document.id === selectedDocumentId,
    );
    const activeDocumentPath = activeDocument
      ? documentIsFromDropbox(activeDocument)
        ? activeDocument.path
        : (activeDocument.filePath ?? activeDocument.path)
      : "";

    rememberDocumentTabSession(
      createDocumentTabSession(
        sessionSource,
        sessionWorkspacePath,
        openDocumentPaths,
        activeDocumentPath,
      ),
    );
  }, [
    documents,
    documentTabSessionRestoreCompleted,
    nativeStorageAvailable,
    openDocumentTabIds,
    selectedDocumentId,
    workspaceRootPath,
    workspaceSource,
  ]);

  useEffect(() => {
    if (!nativeStorageAvailable) return;

    let unlistenNewFile: (() => void) | null = null;
    let unlistenNewFolder: (() => void) | null = null;
    let unlistenOpenSettings: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    let unlistenOpenFolder: (() => void) | null = null;
    let unlistenOpenPath: (() => void) | null = null;
    let unlistenOpenDropbox: (() => void) | null = null;
    let unlistenOpenLocation: (() => void) | null = null;
    let unlistenSelectAll: (() => void) | null = null;
    const appWindow = getCurrentWindow();

    void Promise.all([
      appWindow.listen("scholium-new-file", () => {
        newMarkdownFileHandlerRef.current();
      }),
      appWindow.listen("scholium-new-folder", () => {
        newMarkdownFolderHandlerRef.current();
      }),
      appWindow.listen("scholium-open-settings", () => {
        openSettingsHandlerRef.current();
      }),
      appWindow.listen("scholium-open-file", () => {
        openMarkdownFileHandlerRef.current();
      }),
      appWindow.listen("scholium-open-folder", () => {
        openMarkdownFolderHandlerRef.current();
      }),
      appWindow.listen("scholium-open-path", () => {
        openPathHandlerRef.current();
      }),
      appWindow.listen("scholium-open-dropbox", () => {
        openDropboxCloudHandlerRef.current();
      }),
      appWindow.listen<OpenLocationEventPayload>("scholium-open-location", (event) => {
        void openNativeMenuLocation(event.payload);
      }),
      appWindow.listen("scholium-select-all", () => {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement
        ) {
          activeElement.select();
          return;
        }

        const activeDocumentEditor =
          activeElement instanceof Element
            ? activeElement.closest(
                ".editor-content-frame .milkdown-markdown-editor, .editor-content-frame .markdown-editor-host",
              )
            : null;
        const documentSurfaceOwnsShortcut =
          activeElement === document.body || activeElement === document.documentElement;
        if (activeDocumentEditor || documentSurfaceOwnsShortcut) {
          setEditorSelectAllRequestKey((currentKey) => currentKey + 1);
          return;
        }

        if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
          const selection = window.getSelection();
          if (!selection) return;

          const range = document.createRange();
          range.selectNodeContents(activeElement);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }),
    ]).then(
      ([
        newFileListener,
        newFolderListener,
        openSettingsListener,
        openFileListener,
        openFolderListener,
        openPathListener,
        openDropboxListener,
        openLocationListener,
        selectAllListener,
      ]) => {
        unlistenNewFile = newFileListener;
        unlistenNewFolder = newFolderListener;
        unlistenOpenSettings = openSettingsListener;
        unlistenOpenFile = openFileListener;
        unlistenOpenFolder = openFolderListener;
        unlistenOpenPath = openPathListener;
        unlistenOpenDropbox = openDropboxListener;
        unlistenOpenLocation = openLocationListener;
        unlistenSelectAll = selectAllListener;
      },
    );

    return () => {
      unlistenNewFile?.();
      unlistenNewFolder?.();
      unlistenOpenSettings?.();
      unlistenOpenFile?.();
      unlistenOpenFolder?.();
      unlistenOpenPath?.();
      unlistenOpenDropbox?.();
      unlistenOpenLocation?.();
      unlistenSelectAll?.();
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
    setTagDraft("");
    setMobileTagPickerOpen(false);
  }, [isMobileViewport, selectedDocument.id]);

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
        if (
          !hasOpenDocument ||
          settingsViewOpen ||
          createEntryDialog ||
          draftFileDialog ||
          openPathDialog ||
          duplicateFileDialog ||
          dropboxDirectoryPicker
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openDocumentSearch(true);
        return;
      }

      if (event.key !== "Escape" || !documentSearchOpen) return;
      if (settingsViewOpen || createEntryDialog || duplicateFileDialog || dropboxDirectoryPicker) {
        return;
      }

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
    createEntryDialog,
    draftFileDialog,
    openPathDialog,
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
            setActiveDocumentModeState({
              noteModeEnabled: true,
              glossaryModeEnabled: true,
            });
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
            setActiveDocumentModeState({
              noteModeEnabled: true,
              glossaryModeEnabled,
            });
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

      if (createEntryDialog) {
        if (event.key === "Escape" && !createEntryDialog.isSubmitting) {
          event.preventDefault();
          setCreateEntryDialog(null);
          setStorageError("");
        }
        return;
      }

      if (openPathDialog) {
        if (event.key === "Escape" && !openPathDialog.isSubmitting) {
          event.preventDefault();
          setOpenPathDialog(null);
        }
        return;
      }

      if (draftFileDialog) {
        if (event.key === "Escape" && !draftFileDialog.isSubmitting) {
          event.preventDefault();
          cancelDraftFileDialog();
        } else if (
          event.key.toLowerCase() === "s" &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
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

      if (renameDialog) {
        if (event.key === "Escape" && !renameDialog.isSubmitting) {
          event.preventDefault();
          setRenameDialog(null);
        }
        return;
      }

      if (dropboxDirectoryPicker) {
        if (event.key === "Escape" && !dropboxDirectoryPicker.isOpening) {
          event.preventDefault();
          closeDropboxDirectoryPicker();
        }
        return;
      }

      const isSaveShortcut =
        event.key.toLowerCase() === "s" &&
        !event.altKey &&
        !event.shiftKey &&
        ((event.metaKey && !event.ctrlKey) || (event.ctrlKey && !event.metaKey));
      if (isSaveShortcut) {
        const documentToSave = documentsRef.current.find(
          (document) => document.id === selectedDocumentIdRef.current,
        );
        if (documentToSave && isDraftDocumentId(documentToSave.id)) {
          event.preventDefault();
          event.stopPropagation();
          if (!draftFileDialogResolverRef.current) {
            void requestDraftFileDecision(documentToSave.id, "save");
          }
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
        if (targetIsInsideDocumentSearch(event.target)) return;
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
        if (targetIsInsideDocumentSearch(event.target)) return;

        if (isAnnotationNavigationTab && (activeNoteId || activeGlossaryBindingId)) {
          if (targetIsInsideEditingNoteMarkdownEditor(event.target)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          focusAdjacentFloatingAnnotation(event.shiftKey ? -1 : 1);
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
      if (noteModeEnabled) {
        event.stopPropagation();
        showNoteModeSourceBlockedNotice();
        return;
      }
      closeNotePanel();
      toggleEditorMode(undefined, true);
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
    createEntryDialog,
    draftFileDialog,
    openPathDialog,
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
    const nextStates = patchDirtyDocumentStates(
      dirtyDocumentStatesRef.current,
      documentId,
      patch,
    );

    dirtyDocumentStatesRef.current = nextStates;
    setDirtyDocumentStates(nextStates);
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

  function toneForNewSelectionNote(anchor: TextSelectionAnchor): AnnotationTone {
    const visibleNotes = notesRef.current
      .filter(
        (note) =>
          note.documentId === selectedDocument.id &&
          note.status === "active" &&
          selectionNoteHasContent(note) &&
          hasRenderableAnchor(note.anchor),
      )
      .slice()
      .sort(compareNotesByDocumentPosition);
    const anchorRangeKey = noteAnchorRangeKey(anchor);
    let insertionIndex = 0;
    let previousRangeKey = "";

    for (const note of visibleNotes) {
      const rangeKey = noteAnchorRangeKey(note.anchor);
      if (rangeKey === previousRangeKey) continue;
      if (
        note.anchor.from > anchor.from ||
        (note.anchor.from === anchor.from && note.anchor.to > anchor.to)
      ) {
        break;
      }
      if (rangeKey === anchorRangeKey) return (insertionIndex % 2) as AnnotationTone;

      insertionIndex += 1;
      previousRangeKey = rangeKey;
    }

    return (insertionIndex % 2) as AnnotationTone;
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

    void rememberRecentLocation(location)
      .then(() => {
        void refreshSavedLocations();
      })
      .catch((error) => {
        setStorageError(translatedError(error));
      });
  }

  function setNativeCurrentDirectory(path: string, title: string, source: WorkspaceSource) {
    if (!nativeStorageAvailable) return;

    void setCurrentDirectoryLocation({ path, title, source }).catch((error) => {
      setStorageError(translatedError(error));
    });
  }

  async function refreshSavedLocations() {
    if (!nativeStorageAvailable) {
      setSavedLocations(emptySavedLocations);
      return;
    }

    try {
      const nextSavedLocations = await loadSavedLocations();
      setSavedLocations({
        recent: nextSavedLocations.recent ?? [],
        favoriteDirectories: nextSavedLocations.favoriteDirectories ?? [],
      });
    } catch (error) {
      setStorageError(translatedError(error));
    }
  }

  function resetFileSearch() {
    setFileSearchQuery("");
    setFileSearchMode("files");
    setFileSearchFocused(false);
    setExactTagSearchKey("");
    setLocalFileSearchResults([]);
    setFileSearchPending(false);
    setFileSearchError("");
  }

  function normalizeDocumentModeState(modeState: DocumentModeState): DocumentModeState {
    return {
      editorMode: modeState.noteModeEnabled ? "preview" : modeState.editorMode,
      noteModeEnabled: modeState.noteModeEnabled,
      glossaryModeEnabled: modeState.noteModeEnabled
        ? modeState.glossaryModeEnabled
        : false,
    };
  }

  function defaultDocumentModeState(documentId: string): DocumentModeState {
    return {
      editorMode: "preview",
      noteModeEnabled: Boolean(documentId) && noteModeEnabledByDefault,
      glossaryModeEnabled: false,
    };
  }

  function documentModeStateForDocument(documentId: string): DocumentModeState {
    return normalizeDocumentModeState(
      documentModeStatesRef.current[documentId] ??
        defaultDocumentModeState(documentId),
    );
  }

  function completeDocumentModeState(
    documentId: string,
    modeState: Partial<DocumentModeState>,
  ): DocumentModeState {
    return normalizeDocumentModeState({
      ...documentModeStateForDocument(documentId),
      ...modeState,
    });
  }

  function setDocumentModeState(
    documentId: string,
    modeState: Partial<DocumentModeState>,
  ) {
    if (!documentId) return;

    const normalizedModeState = completeDocumentModeState(documentId, modeState);
    const currentModeState = documentModeStatesRef.current[documentId];
    if (
      currentModeState?.editorMode === normalizedModeState.editorMode &&
      currentModeState?.noteModeEnabled === normalizedModeState.noteModeEnabled &&
      currentModeState?.glossaryModeEnabled === normalizedModeState.glossaryModeEnabled
    ) {
      return;
    }

    const nextModeStates = {
      ...documentModeStatesRef.current,
      [documentId]: normalizedModeState,
    };
    documentModeStatesRef.current = nextModeStates;
    setDocumentModeStates(nextModeStates);
  }

  function saveCurrentDocumentModeState(documentId = selectedDocumentIdRef.current) {
    setDocumentModeState(documentId, {
      editorMode: editorModeRef.current,
      noteModeEnabled: noteModeEnabledRef.current,
      glossaryModeEnabled: glossaryModeEnabledRef.current,
    });
  }

  function applyDocumentModeState(modeState: DocumentModeState) {
    const normalizedModeState = normalizeDocumentModeState(modeState);

    editorModeRef.current = normalizedModeState.editorMode;
    noteModeEnabledRef.current = normalizedModeState.noteModeEnabled;
    glossaryModeEnabledRef.current = normalizedModeState.glossaryModeEnabled;
    setEditorMode(normalizedModeState.editorMode);
    setNoteModeEnabled(normalizedModeState.noteModeEnabled);
    setGlossaryModeEnabled(normalizedModeState.glossaryModeEnabled);
  }

  function completeEditorFocusRequest(requestKey: number) {
    setEditorFocusRequest((currentRequest) =>
      currentRequest?.requestKey === requestKey ? null : currentRequest,
    );
  }

  function elementCanScrollVertically(element: HTMLElement) {
    const overflowY = window.getComputedStyle(element).overflowY;
    return (
      overflowY !== "visible" &&
      overflowY !== "clip" &&
      element.scrollHeight > element.clientHeight + 1
    );
  }

  function editorModeScrollContainer() {
    const editorPane = document.querySelector<HTMLElement>(".editor-pane");
    if (editorPane && elementCanScrollVertically(editorPane)) {
      return editorPane;
    }

    return document.scrollingElement;
  }

  function captureEditorModeScrollSnapshot(): EditorModeScrollSnapshot | null {
    const scrollContainer = editorModeScrollContainer();
    if (!scrollContainer) return null;

    return {
      scrollContainer,
      scrollLeft: scrollContainer.scrollLeft,
      scrollTop: scrollContainer.scrollTop,
    };
  }

  function restoreEditorModeScrollSnapshot(snapshot: EditorModeScrollSnapshot) {
    const restore = () => {
      if (!snapshot.scrollContainer.isConnected) return;

      snapshot.scrollContainer.scrollLeft = Math.min(
        snapshot.scrollLeft,
        Math.max(0, snapshot.scrollContainer.scrollWidth - snapshot.scrollContainer.clientWidth),
      );
      snapshot.scrollContainer.scrollTop = Math.min(
        snapshot.scrollTop,
        Math.max(0, snapshot.scrollContainer.scrollHeight - snapshot.scrollContainer.clientHeight),
      );
    };

    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
  }

  function captureDocumentScrollPosition(): DocumentScrollPosition | null {
    const snapshot = captureEditorModeScrollSnapshot();
    if (!snapshot) return null;

    return {
      scrollLeft: snapshot.scrollLeft,
      scrollTop: snapshot.scrollTop,
    };
  }

  function restoreDocumentScrollPosition(position: DocumentScrollPosition) {
    const scrollContainer = editorModeScrollContainer();
    if (!scrollContainer) return;

    restoreEditorModeScrollSnapshot({
      scrollContainer,
      scrollLeft: position.scrollLeft,
      scrollTop: position.scrollTop,
    });
  }

  function saveDocumentScrollPosition(documentId: string) {
    const position = captureDocumentScrollPosition();
    if (!position) return;

    documentScrollPositionsRef.current[documentId] = position;
  }

  function toggleEditorMode(
    event?: MouseEvent<HTMLButtonElement>,
    restoreEditorFocus = false,
  ) {
    if (noteModeEnabledRef.current) {
      showNoteModeSourceBlockedNotice(event?.currentTarget);
      return;
    }

    const nextEditorMode = editorModeRef.current === "preview" ? "edit" : "preview";
    const activeElement = document.activeElement;
    const activeEditor =
      activeElement instanceof Element
        ? activeElement.closest(
            ".editor-content-frame .milkdown-markdown-editor-shell, .editor-content-frame .markdown-editor-host",
          )
        : null;
    const shouldRestoreEditorFocus =
      Boolean(activeEditor) && (Boolean(event) || Boolean(restoreEditorFocus));
    let currentSelection: EditorSelectionSnapshot | null = null;

    if (shouldRestoreEditorFocus) {
      currentSelection = activeDocumentEditorRef.current?.getSelectionSnapshot() ?? null;
    }

    if (shouldRestoreEditorFocus && currentSelection) {
      editorFocusRequestSequenceRef.current += 1;
      setEditorFocusRequest({
        documentId: selectedDocumentIdRef.current,
        mode: nextEditorMode,
        requestKey: editorFocusRequestSequenceRef.current,
        selection: currentSelection,
      });
    }
    if (!shouldRestoreEditorFocus || !currentSelection) {
      const scrollSnapshot = captureEditorModeScrollSnapshot();
      if (scrollSnapshot) {
        pendingEditorModeScrollSnapshotRef.current = scrollSnapshot;
      }
    }
    setActiveDocumentModeState({
      editorMode: nextEditorMode,
      noteModeEnabled: noteModeEnabledRef.current,
      glossaryModeEnabled: glossaryModeEnabledRef.current,
    });
  }

  function showNoteModeSourceBlockedNotice(button?: HTMLButtonElement | null) {
    const sourceModeButton =
      button ??
      [mobileSourceModeButtonRef.current, desktopSourceModeButtonRef.current].find(
        (candidate) => {
          const rect = candidate?.getBoundingClientRect();
          return Boolean(rect && rect.width > 0 && rect.height > 0);
        },
      );
    if (!sourceModeButton) return;

    const buttonRect = sourceModeButton.getBoundingClientRect();
    const noticeWidth = Math.min(320, window.innerWidth - 32);
    const noticeLeft = Math.min(
      Math.max(16, buttonRect.left + buttonRect.width / 2 - noticeWidth / 2),
      window.innerWidth - 16 - noticeWidth,
    );
    setMobileNoteSelectionHintVisible(false);
    setNoteModeSourceBlockedNoticePosition({
      top: Math.round(buttonRect.bottom + 12),
      left: Math.round(noticeLeft),
    });
  }

  function setActiveDocumentModeState(modeState: Partial<DocumentModeState>) {
    const selectedDocumentId = selectedDocumentIdRef.current;
    const normalizedModeState = completeDocumentModeState(selectedDocumentId, modeState);
    applyDocumentModeState(normalizedModeState);
    setDocumentModeState(selectedDocumentId, normalizedModeState);
  }

  function restoreDocumentModeState(documentId: string) {
    applyDocumentModeState(documentModeStateForDocument(documentId));
  }

  function setActiveDocumentId(documentId: string) {
    const previousDocumentId = selectedDocumentIdRef.current;

    if (previousDocumentId && previousDocumentId !== documentId) {
      saveCurrentDocumentModeState(previousDocumentId);
      saveDocumentScrollPosition(previousDocumentId);
    }

    selectedDocumentIdRef.current = documentId;
    setSelectedDocumentId(documentId);
    restoreDocumentModeState(documentId);
    pendingDocumentScrollPositionRef.current =
      previousDocumentId && previousDocumentId !== documentId
        ? (documentScrollPositionsRef.current[documentId] ?? { scrollLeft: 0, scrollTop: 0 })
        : null;
  }

  function resetDocumentTabs(documentId: string) {
    setOpenDocumentTabIds((currentIds) => [
      ...(documentId ? [documentId] : []),
      ...currentIds.filter(
        (currentId) => currentId !== documentId && isDraftDocumentId(currentId),
      ),
    ]);
  }

  function addDocumentTab(documentId: string) {
    setOpenDocumentTabIds((currentIds) =>
      documentTabIdsAfterOpening(
        currentIds,
        selectedDocumentIdRef.current,
        documentId,
        "add",
        documentsRef.current.map((document) => document.id),
      ),
    );
  }

  function replaceActiveDocumentTab(documentId: string) {
    setOpenDocumentTabIds((currentIds) =>
      documentTabIdsAfterOpening(
        currentIds,
        selectedDocumentIdRef.current,
        documentId,
        // Unnamed new files keep their tab so their content stays available.
        isDraftDocumentId(selectedDocumentIdRef.current) ? "add" : "replace",
        documentsRef.current.map((document) => document.id),
      ),
    );
  }

  function applyDocumentTabBehavior(documentId: string, behavior: DocumentTabBehavior) {
    if (!documentId || behavior === "none") return;

    if (behavior === "add") {
      addDocumentTab(documentId);
      return;
    }

    replaceActiveDocumentTab(documentId);
  }

  function clearActiveDocumentSelection() {
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();
    setSelectedWorkspaceDocumentIds(new Set());
    setActiveDocumentId("");
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
  }

  async function closeDocumentTab(documentId: string, event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();

    let documentIdToClose = documentId;
    if (isDraftDocumentId(documentId)) {
      const result = await prepareDraftDocumentForLeaving(documentId);
      if (result.status === "blocked" || result.status === "discarded") return;
      if (result.status === "saved") {
        documentIdToClose = result.documentId;
      }
    }

    const currentIds = openDocumentTabIdsRef.current;
    const transition = documentTabsAfterClosing(
      currentIds,
      selectedDocumentIdRef.current,
      documentIdToClose,
    );
    if (transition.openDocumentTabIds !== currentIds) {
      openDocumentTabIdsRef.current = transition.openDocumentTabIds;
      setOpenDocumentTabIds(transition.openDocumentTabIds);
    }

    if (transition.nextActiveDocumentId === null) {
      clearActiveDocumentSelection();
      return;
    }
    if (transition.nextActiveDocumentId != null) {
      selectDocument(transition.nextActiveDocumentId, { tabBehavior: "none" });
    }
  }

  async function closeOtherDocumentTabs(documentId: string) {
    setDocumentTabContextMenu(null);
    const documentIdsToClose = openDocumentTabIdsRef.current.filter(
      (currentId) => currentId !== documentId,
    );
    for (const currentId of documentIdsToClose) {
      const result = await prepareDraftDocumentForLeaving(currentId);
      if (result.status === "blocked") return;
    }

    const currentIds = openDocumentTabIdsRef.current;
    const transition = documentTabsAfterClosingOthers(
      currentIds,
      selectedDocumentIdRef.current,
      documentId,
    );
    if (transition.openDocumentTabIds !== currentIds) {
      openDocumentTabIdsRef.current = transition.openDocumentTabIds;
      setOpenDocumentTabIds(transition.openDocumentTabIds);
    }
    if (transition.nextActiveDocumentId != null) {
      selectDocument(transition.nextActiveDocumentId, { tabBehavior: "none" });
    }
  }

  async function closeAllDocumentTabs() {
    setDocumentTabContextMenu(null);
    if (openDocumentTabIdsRef.current.length === 0) return;

    for (const currentId of [...openDocumentTabIdsRef.current]) {
      const result = await prepareDraftDocumentForLeaving(currentId);
      if (result.status === "blocked") return;
    }

    openDocumentTabIdsRef.current = [];
    setOpenDocumentTabIds([]);
    clearActiveDocumentSelection();
  }

  async function openDocumentTabInNewWindow(documentId: string) {
    setDocumentTabContextMenu(null);
    let documentIdToOpen = documentId;
    if (isDraftDocumentId(documentIdToOpen)) {
      const result = await prepareDraftDocumentForLeaving(documentIdToOpen);
      if (result.status !== "saved") return;
      documentIdToOpen = result.documentId;
    }

    window.clearTimeout(autosaveTimerRef.current);

    for (let attempts = 0; autosaveInFlightRef.current && attempts < 300; attempts += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeNewWindow"));
      return;
    }

    if (hasDirtyState(dirtyDocumentStatesRef.current[documentIdToOpen])) {
      await saveDirtyDocuments();
      if (hasDirtyState(dirtyDocumentStatesRef.current[documentIdToOpen])) return;
    }

    const documentToOpen = documentsRef.current.find(
      (document) => document.id === documentIdToOpen,
    );
    if (!documentToOpen) return;

    try {
      let requesterSceneIdentifier: string | null = null;
      try {
        requesterSceneIdentifier = await getCurrentWindow().sceneIdentifier();
      } catch {
        // Scene identifiers are available on iOS; desktop windows do not need one.
      }
      await createNewWindow({
        documentTarget: {
          kind: "file",
          path: documentToOpen.filePath ?? documentToOpen.path,
          source: documentIsFromDropbox(documentToOpen) ? "dropbox" : "local",
          title: documentToOpen.title,
        },
        requesterSceneIdentifier,
      });
      setStorageError("");
    } catch (error) {
      setStorageError(translatedError(error, "error.openInNewWindowFailed"));
    }
  }

  function mergeLoadedFilesIntoDocumentState(loadedFiles: OpenMarkdownFileResult[]) {
    if (loadedFiles.length === 0) return;

    const {
      loadedDocuments,
      loadedDocumentIds,
      loadedNotes,
      loadedGlossaryBindings,
      loadedGlossaryTerms,
    } = projectLoadedLocalFiles(loadedFiles, recoverRenderableAnchor);
    const nextDocuments = [
      ...loadedDocuments,
      ...documentsRef.current.filter((document) => !loadedDocumentIds.has(document.id)),
    ];

    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
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
      setStorageError("");
      return;
    }

    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();

    const {
      loadedDocuments,
      loadedDocumentIds,
      loadedNotes,
      loadedGlossaryBindings,
      loadedGlossaryTerms,
    } = projectLoadedLocalFiles(loadedFiles, recoverRenderableAnchor);
    const firstDocument = loadedDocuments[0];
    const rootPath = parentDirectoryPath(firstDocument.filePath);
    const nextDocuments = [
      ...loadedDocuments,
      ...documentsRef.current.filter((document) => !loadedDocumentIds.has(document.id)),
    ];

    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
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

      return options.sortEntries
        ? sortWorkspaceEntriesForDirectory(nextEntries, workspaceSortModeRef.current)
        : nextEntries;
    });
    setWorkspaceTitle(fileNameFromPath(rootPath) || rootPath || "Scholium");
    setWorkspaceRootPath(rootPath);
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
    setActiveDocumentId(firstDocument.id);
    resetDocumentTabs(firstDocument.id);
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
    rememberLastOpenedMarkdownRootDirectoryPath(rootPath);
    if (options.rememberRecent !== false) {
      loadedFiles.forEach((loadedFile) => {
        rememberNativeRecentLocation({
          kind: "file",
          path: loadedFile.path,
          title: loadedFile.title,
          source: "local",
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
      modifiedAt: loaded.serverModified ? Date.parse(loaded.serverModified) : null,
      body: loaded.body,
      dropboxRev: loaded.rev ?? null,
    };
  }

  function dropboxWorkspaceTitle(openedDirectory: OpenDropboxMarkdownDirectoryResult) {
    return openedDirectory.path ? `Dropbox / ${openedDirectory.title}` : "Dropbox";
  }

  async function loadDropboxTagIndex(
    entries: WorkspaceEntry[],
    requestId: number,
    replace: boolean,
  ) {
    const fileEntries = entries.filter(
      (entry): entry is Extract<WorkspaceEntry, { kind: "file" }> => entry.kind === "file",
    );

    for (let index = 0; index < fileEntries.length; index += 6) {
      const results = await Promise.allSettled(
        fileEntries.slice(index, index + 6).map(async (entry) => ({
          documentId: entry.documentId,
          tags: readMarkdownTags(
            await readDropboxMarkdownBody({ path: entry.path }),
          ),
        })),
      );
      if (dropboxTagIndexRequestRef.current !== requestId) return;

      const indexedEntries = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setDropboxIndexedDocumentTags((currentEntries) => {
        const nextEntries = new Map(
          replace && index === 0
            ? []
            : currentEntries.map((entry) => [entry.documentId, entry]),
        );
        indexedEntries.forEach((entry) => nextEntries.set(entry.documentId, entry));
        return Array.from(nextEntries.values());
      });
    }

    if (replace && dropboxTagIndexRequestRef.current === requestId) {
      setDropboxTagIndexLoading(false);
    }
  }

  function applyOpenedDropboxDirectory(
    openedDirectory: OpenDropboxMarkdownDirectoryResult,
    options: { rememberLastOpened?: boolean; rememberRecent?: boolean } = {},
  ) {
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();

    const nextEntries = sortWorkspaceEntriesForDirectory(
      workspaceEntriesFromOpenedDropboxDirectory(openedDirectory, 1),
      workspaceSortModeRef.current,
    );
    const tagIndexRequestId = ++dropboxTagIndexRequestRef.current;
    const draftState = currentDraftDocumentState();

    documentsRef.current = draftState.documents;
    setDocuments(draftState.documents);
    setNotes(draftState.notes);
    setGlossaryBindings(draftState.glossaryBindings);
    setGlossaryTerms(draftState.glossaryTerms);
    setWorkspaceTitle(dropboxWorkspaceTitle(openedDirectory));
    setWorkspaceEntries(nextEntries);
    setWorkspaceRootPath(openedDirectory.path);
    setWorkspaceSource("dropbox");
    resetFileSearch();
    setExpandedDirectoryKeys(new Set());
    setLoadingDirectoryKeys(new Set());
    setSelectedWorkspaceDocumentIds(new Set());
    setMobileSelectedWorkspaceEntryKey("");
    setActiveDocumentId("");
    resetDocumentTabs("");
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
    setSavedDocumentBodies(draftState.savedBodies);
    setDropboxIndexedDocumentTags([]);
    setDropboxTagIndexLoading(true);
    void loadDropboxTagIndex(nextEntries, tagIndexRequestId, true);
    if (options.rememberLastOpened !== false) {
      rememberLastOpenedDropboxWorkspace(openedDirectory.path, "");
    }
    if (openedDirectory.path) {
      if (options.rememberRecent !== false) {
        rememberNativeRecentLocation({
          kind: "directory",
          path: openedDirectory.path,
          title: openedDirectory.title,
          source: "dropbox",
        });
      }
      setNativeCurrentDirectory(openedDirectory.path, openedDirectory.title, "dropbox");
    }

    setStorageError("");
  }

  function applyLoadedDropboxFile(
    loadedFile: OpenDropboxMarkdownFileResult,
    options: {
      rememberRecent?: boolean;
      replaceDocuments?: boolean;
      tabBehavior?: DocumentTabBehavior;
    } = {},
  ) {
    const loadedDocument = documentFromDropboxFile(loadedFile);
    const documentId = loadedDocument.id;
    const loadedNotes = loadedFile.notes.map((note) =>
      loadedNoteForDocument(loadedFile, note, documentId, recoverRenderableAnchor),
    );
    const loadedGlossaryBindings = (loadedFile.glossaryBindings ?? []).map((binding) =>
      loadedGlossaryBindingForDocument(
        loadedFile,
        binding,
        documentId,
        recoverRenderableAnchor,
      ),
    );
    const loadedGlossaryTerms = loadedFile.glossaryTerms ?? [];
    const nextDocuments = options.replaceDocuments
      ? [loadedDocument, ...currentDraftDocumentState().documents]
      : [
          loadedDocument,
          ...documentsRef.current.filter((document) => document.id !== documentId),
        ];

    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    setWorkspaceEntries((currentEntries) => {
      const fileEntry = workspaceEntryFromDocument(loadedDocument);

      return sortWorkspaceEntriesForDirectory(
        insertOrUpdateWorkspaceFileEntry(currentEntries, fileEntry, workspaceRootPath),
        workspaceSortModeRef.current,
      );
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
    setActiveDocumentId(documentId);
    applyDocumentTabBehavior(documentId, options.tabBehavior ?? "replace");
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
    rememberLastOpenedDropboxWorkspace(
      workspaceRootPath ??
        readLastOpenedDropboxWorkspace()?.workspacePath ??
        dropboxParentDirectoryPath(loadedDocument.path),
      loadedDocument.path,
    );
    if (options.rememberRecent !== false) {
      rememberNativeRecentLocation({
        kind: "file",
        path: loadedFile.path,
        title: loadedFile.title,
        source: "dropbox",
      });
    }
  }

  function applyReloadedFile(loadedFile: OpenMarkdownFileResult) {
    const loadedDocument = documentFromLoadedFileResult(loadedFile);
    const documentId = loadedDocument.id;
    const loadedNotes = loadedFile.notes.map((note) =>
      loadedNoteForDocument(loadedFile, note, loadedFile.path, recoverRenderableAnchor),
    );
    const loadedGlossaryBindings = (loadedFile.glossaryBindings ?? []).map((binding) =>
      loadedGlossaryBindingForDocument(
        loadedFile,
        binding,
        loadedFile.path,
        recoverRenderableAnchor,
      ),
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

  function dropboxLoadedSidecarFingerprint(
    loadedFile: OpenDropboxMarkdownFileResult,
    documentId: string,
  ) {
    const loadedNotes = loadedFile.notes.map((note) =>
      loadedNoteForDocument(loadedFile, note, documentId, recoverRenderableAnchor),
    );
    const loadedGlossaryBindings = (loadedFile.glossaryBindings ?? []).map((binding) =>
      loadedGlossaryBindingForDocument(
        loadedFile,
        binding,
        documentId,
        recoverRenderableAnchor,
      ),
    );

    return sidecarFingerprint(
      loadedNotes,
      loadedFile.glossaryTerms ?? [],
      loadedGlossaryBindings,
    );
  }

  function dropboxLoadedFileMatchesCurrentDocument(
    loadedFile: OpenDropboxMarkdownFileResult,
    currentDocument: MarkdownDocument,
  ) {
    const currentSidecarFingerprint = sidecarFingerprint(
      notesForDocument(currentDocument.id),
      glossaryTermsForDocument(currentDocument.id),
      glossaryBindingsForDocument(currentDocument.id),
    );

    return (
      loadedFile.body === currentDocument.body &&
      (loadedFile.rev ?? null) === (currentDocument.dropboxRev ?? null) &&
      dropboxLoadedSidecarFingerprint(loadedFile, currentDocument.id) ===
        currentSidecarFingerprint
    );
  }

  async function refreshSelectedDocumentFromDropbox() {
    if (!nativeStorageAvailable) return;
    if (externalFileRefreshInFlightRef.current) return;

    const documentId = selectedDocumentIdRef.current;
    if (!documentId) return;
    if (hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;

    const documentToRefresh = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToRefresh || !documentIsFromDropbox(documentToRefresh)) return;

    const now = Date.now();
    const lastRefresh = lastDropboxExternalRefreshRef.current;
    if (
      lastRefresh?.path === documentToRefresh.path &&
      now - lastRefresh.timestamp < dropboxExternalFileRefreshIntervalMs
    ) {
      return;
    }
    lastDropboxExternalRefreshRef.current = { path: documentToRefresh.path, timestamp: now };

    externalFileRefreshInFlightRef.current = true;
    try {
      const loaded = await openDropboxMarkdownFile({
        path: documentToRefresh.path,
      });
      const currentDocument = documentsRef.current.find((document) => document.id === documentId);
      if (!currentDocument || hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;
      if (!documentIsFromDropbox(currentDocument)) return;
      if (dropboxLoadedFileMatchesCurrentDocument(loaded, currentDocument)) return;

      applyLoadedDropboxFile(loaded, { rememberRecent: false, tabBehavior: "none" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error);
      if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
        setDropboxConnected(false);
        setStorageError(t("dropbox.error.restoreNeedsAuthorization"));
      }
    } finally {
      externalFileRefreshInFlightRef.current = false;
    }
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
      const loaded = await openMarkdownFile({
        path: documentToRefresh.filePath,
      });
      const currentDocument = documentsRef.current.find((document) => document.id === documentId);
      if (!currentDocument || hasDirtyState(dirtyDocumentStatesRef.current[documentId])) return;
      if (loaded.body === currentDocument.body) return;

      applyReloadedFile(loaded);
    } catch (error) {
      setStorageError(translatedError(error, "error.openFileFailed"));
    } finally {
      externalFileRefreshInFlightRef.current = false;
    }
  }

  function refreshSelectedDocumentFromBackingStore() {
    const selectedDocument = documentsRef.current.find(
      (document) => document.id === selectedDocumentIdRef.current,
    );
    if (selectedDocument && documentIsFromDropbox(selectedDocument)) {
      void refreshSelectedDocumentFromDropbox();
      return;
    }

    void refreshSelectedDocumentFromDisk();
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
    const {
      loadedDocuments,
      loadedNotes,
      loadedGlossaryBindings,
      loadedGlossaryTerms,
    } = projectLoadedLocalFiles(loadedFiles, recoverRenderableAnchor);
    const nextEntries = sortWorkspaceEntriesForDirectory(
      workspaceEntriesFromOpenedDirectory(openedDirectory, 1),
      workspaceSortModeRef.current,
    );
    const firstDocument = loadedDocuments[0];
    const selectedDocument = selectedPath
      ? loadedDocuments.find((document) => document.id === selectedPath)
      : firstDocument;
    const documentToSelect =
      selectedDocument ?? (options.selectFallback === false ? null : firstDocument);
    const draftState = currentDraftDocumentState();
    const nextDocuments = [...loadedDocuments, ...draftState.documents];

    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    setNotes([...loadedNotes, ...draftState.notes]);
    setGlossaryBindings([...loadedGlossaryBindings, ...draftState.glossaryBindings]);
    setGlossaryTerms(mergeGlossaryTerms(loadedGlossaryTerms, draftState.glossaryTerms));
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
    forgetLastOpenedDropboxWorkspace();
    rememberLastOpenedMarkdownRootDirectoryPath(openedDirectory.path);

    if (documentToSelect) {
      setActiveDocumentId(documentToSelect.id);
      resetDocumentTabs(documentToSelect.id);
      if (options.rememberSelection !== false) {
        rememberLastOpenedMarkdownPath(documentToSelect.filePath);
      }
    } else {
      setActiveDocumentId("");
      resetDocumentTabs("");
      if (options.rememberSelection !== false) {
        forgetLastOpenedMarkdownPath();
      }
    }
    setActiveNoteId("");
    setActiveGlossaryBindingId("");
    setActiveGlossaryTermId("");
    setActiveNoteMode("view");
    setActiveGlossaryMode("view");

    setStorageError("");

    if (options.rememberRecent !== false) {
      rememberNativeRecentLocation({
        kind: "directory",
        path: openedDirectory.path,
        title: openedDirectory.title,
        source: "local",
      });
    }
    setNativeCurrentDirectory(openedDirectory.path, openedDirectory.title, "local");
  }

  async function loadAvailableLocalDocumentTabSession(
    session: DocumentTabSessionState,
  ) {
    const sessionPaths = session.openDocumentPaths.filter((path) =>
      localPathIsInsideDirectory(path, session.workspacePath),
    );
    const loadedResults = await Promise.allSettled(
      sessionPaths.map((path) =>
        openMarkdownFile({ path }),
      ),
    );
    const loadedFiles = loadedResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const restoredSession = availableDocumentTabSession(
      session,
      loadedFiles.map((file) => file.path),
    );

    return { loadedFiles, restoredSession };
  }

  function applyLocalDocumentTabSession(
    loadedSession: Awaited<ReturnType<typeof loadAvailableLocalDocumentTabSession>>,
  ) {
    const { loadedFiles, restoredSession } = loadedSession;
    if (restoredSession.openDocumentPaths.length === 0) return false;

    mergeLoadedFilesIntoDocumentState(loadedFiles);
    openDocumentTabIdsRef.current = restoredSession.openDocumentPaths;
    setOpenDocumentTabIds(restoredSession.openDocumentPaths);
    setActiveDocumentId(restoredSession.activeDocumentPath);
    rememberLastOpenedMarkdownPath(restoredSession.activeDocumentPath);
    return true;
  }

  /**
   * Resolves to false when the person opened another file or folder before the
   * restore finished, so the restore never replaces what they asked for.
   */
  async function restoreLastOpenedMarkdownWorkspace(
    rootDirectoryPath: string,
    selectedPath: string,
    tabSession: DocumentTabSessionState | null = null,
    options: { rememberRecent?: boolean } = {},
  ) {
    const restoreSelectionRevision = manualDocumentSelectionRevisionRef.current;
    const restoreWasInterrupted = () =>
      manualDocumentSelectionRevisionRef.current !== restoreSelectionRevision;

    const openedDirectory = await openMarkdownDirectory({
      path: rootDirectoryPath,
    });
    const loadedTabSession = tabSession
      ? await loadAvailableLocalDocumentTabSession(tabSession)
      : null;
    if (restoreWasInterrupted()) return false;
    const restoredSelectedPath = loadedTabSession
      ? loadedTabSession.restoredSession.activeDocumentPath
      : selectedPath;
    const rootLoadedFiles = openedDirectory.entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.file] : [],
    );
    const selectedIsRootEntry = rootLoadedFiles.some((file) =>
      localPathsMatch(file.path, restoredSelectedPath),
    );
    const ancestorPaths =
      restoredSelectedPath && !selectedIsRootEntry
        ? ancestorDirectoryPathsForFile(rootDirectoryPath, restoredSelectedPath)
        : [];

    if (restoredSelectedPath && !selectedIsRootEntry && ancestorPaths.length === 0) {
      throw new Error("last opened file is outside the saved root directory");
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

      const openedAncestorDirectory = await openMarkdownDirectory({
        path: ancestorEntry.path,
      });
      if (restoreWasInterrupted()) return false;
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
      localPathsMatch(file.path, restoredSelectedPath),
    );
    if (restoredSelectedPath && !selectedIsRootEntry && !selectedFile) {
      throw new Error("last opened file was not found in the restored directory tree");
    }

    applyOpenedDirectory(openedDirectory, selectedIsRootEntry ? restoredSelectedPath : undefined, {
      rememberRecent: options.rememberRecent ?? false,
      rememberSelection: false,
      selectFallback:
        loadedTabSession === null && (!restoredSelectedPath || selectedIsRootEntry),
    });

    if (!restoredSelectedPath) {
      forgetLastOpenedMarkdownPath();
      rememberDocumentTabSession(null);
      return true;
    }

    if (selectedIsRootEntry) {
      rememberLastOpenedMarkdownPath(restoredSelectedPath);
      if (loadedTabSession) {
        applyLocalDocumentTabSession(loadedTabSession);
      }
      return true;
    }

    if (!selectedFile) return true;

    mergeLoadedFilesIntoDocumentState(loadedDescendantFiles);
    setWorkspaceEntries(
      sortWorkspaceEntriesForDirectory(nextEntries, workspaceSortModeRef.current),
    );
    setExpandedDirectoryKeys(nextExpandedDirectoryKeys);
    setActiveDocumentId(selectedFile.path);
    resetDocumentTabs(selectedFile.path);
    rememberLastOpenedMarkdownPath(selectedFile.path);
    if (loadedTabSession) {
      applyLocalDocumentTabSession(loadedTabSession);
    }
    return true;
  }

  function dropboxErrorIsConnectionTimeout(message: string) {
    const normalizedMessage = message.toLowerCase();
    return normalizedMessage.includes("timed out") || normalizedMessage.includes("timeout");
  }

  function dropboxErrorIsDisconnected(message: string) {
    const normalizedMessage = message.toLowerCase();
    return normalizedMessage.includes("not connected") || normalizedMessage.includes("reconnect");
  }

  function dropboxErrorIsNetworkFailure(message: string) {
    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes("error sending request") ||
      normalizedMessage.includes("failed to connect") ||
      normalizedMessage.includes("connection reset") ||
      normalizedMessage.includes("connection closed") ||
      normalizedMessage.includes("dns") ||
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("tls") ||
      normalizedMessage.includes("certificate")
    );
  }

  function dropboxUserFacingError(message: string) {
    console.error(message);
    if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
      return t("dropbox.error.restoreNeedsAuthorization");
    }
    if (dropboxErrorIsConnectionTimeout(message)) {
      return t("dropbox.error.restoreTimeout");
    }
    if (dropboxErrorIsNetworkFailure(message)) {
      return t("dropbox.error.network");
    }

    return t("dropbox.error.unexpected");
  }

  async function checkDropboxRestoreConnection() {
    if (browserAppearsOffline()) {
      setStorageError(t("dropbox.error.offline"));
      return false;
    }

    try {
      const status = await checkDropboxConnection();
      setDropboxConnected(status.connected);
      if (!status.connected) {
        setStorageError(t("dropbox.error.restoreNeedsAuthorization"));
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
        setDropboxConnected(false);
        setStorageError(t("dropbox.error.restoreNeedsAuthorization"));
        return false;
      }
      if (dropboxErrorIsConnectionTimeout(message)) {
        setStorageError(t("dropbox.error.restoreTimeout"));
        return false;
      }
      if (dropboxErrorIsNetworkFailure(message)) {
        setStorageError(t("dropbox.error.network"));
        return false;
      }

      console.error(error);
      setStorageError(t("dropbox.error.couldNotRestore"));
      return false;
    }
  }

  async function restoreDropboxDocumentTabSession(
    session: DocumentTabSessionState,
  ) {
    const sessionPaths = session.openDocumentPaths.filter(
      (path) =>
        !session.workspacePath ||
        localPathIsInsideDirectory(path, session.workspacePath),
    );
    const availablePaths: string[] = [];

    for (const path of sessionPaths) {
      const existingDocument = documentsRef.current.find(
        (document) => documentIsFromDropbox(document) && document.path === path,
      );
      if (existingDocument) {
        availablePaths.push(path);
        continue;
      }

      try {
        const loadedFile = await openDropboxMarkdownFile({ path });
        applyLoadedDropboxFile(loadedFile, {
          rememberRecent: false,
          tabBehavior: "none",
        });
        availablePaths.push(loadedFile.path);
      } catch (error) {
        console.error(error);
      }
    }

    const restoredSession = availableDocumentTabSession(session, availablePaths);
    if (restoredSession.openDocumentPaths.length === 0) return false;

    const restoredDocumentIds = restoredSession.openDocumentPaths.map(dropboxDocumentId);
    const activeDocumentId = dropboxDocumentId(restoredSession.activeDocumentPath);
    openDocumentTabIdsRef.current = restoredDocumentIds;
    setOpenDocumentTabIds(restoredDocumentIds);
    setActiveDocumentId(activeDocumentId);
    rememberLastOpenedDropboxWorkspace(
      session.workspacePath,
      restoredSession.activeDocumentPath,
    );
    return true;
  }

  async function restoreLastOpenedDropboxWorkspace(
    restoreState: LastOpenedDropboxWorkspaceState,
    tabSession: DocumentTabSessionState | null = null,
  ): Promise<boolean> {
    const restoreSelectionRevision = manualDocumentSelectionRevisionRef.current;
    const restoreWasInterrupted = () =>
      manualDocumentSelectionRevisionRef.current !== restoreSelectionRevision;

    setStorageError(t("dropbox.status.restoringLastFile"));

    const canReachDropbox = await checkDropboxRestoreConnection();
    if (restoreWasInterrupted()) return true;
    if (!canReachDropbox) return false;

    let openedDirectory: OpenDropboxMarkdownDirectoryResult | null = null;

    try {
      openedDirectory = await listDropboxMarkdownDirectory({
        path: restoreState.workspacePath,
      });
      if (restoreWasInterrupted()) return true;
      applyOpenedDropboxDirectory(openedDirectory, {
        rememberLastOpened: false,
        rememberRecent: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
        setDropboxConnected(false);
        setStorageError(t("dropbox.error.restoreNeedsAuthorization"));
        return false;
      }
      if (dropboxErrorIsConnectionTimeout(message)) {
        setStorageError(t("dropbox.error.restoreTimeout"));
        return false;
      }
      if (dropboxErrorIsNetworkFailure(message)) {
        setStorageError(t("dropbox.error.network"));
        return false;
      }

      forgetLastOpenedDropboxWorkspace();
      console.error(error);
      setStorageError(t("dropbox.error.couldNotRestore"));
      return false;
    }

    if (tabSession) {
      const sessionRestored = await restoreDropboxDocumentTabSession(tabSession);
      if (restoreWasInterrupted()) return true;
      if (sessionRestored) {
        setStorageError("");
        return true;
      }

      rememberLastOpenedDropboxWorkspace(openedDirectory.path, "");
      rememberDocumentTabSession(null);
      setStorageError("");
      return true;
    }

    const restoreFilePath =
      restoreState.filePath ||
      firstDropboxMarkdownFileEntry(openedDirectory)?.path ||
      "";

    if (!restoreFilePath) {
      rememberLastOpenedDropboxWorkspace(openedDirectory.path, "");
      setStorageError("");
      return true;
    }

    try {
      setStorageError(t("dropbox.status.openingFile"));
      const loaded = await openDropboxMarkdownFile({
        path: restoreFilePath,
      });
      if (restoreWasInterrupted()) return true;
      applyLoadedDropboxFile(loaded, { rememberRecent: false });
      setStorageError("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
        setDropboxConnected(false);
        setStorageError(t("dropbox.error.restoreNeedsAuthorization"));
        return false;
      }
      if (dropboxErrorIsConnectionTimeout(message)) {
        setStorageError(t("dropbox.error.restoreTimeout"));
        return true;
      }
      if (dropboxErrorIsNetworkFailure(message)) {
        setStorageError(t("dropbox.error.network"));
        return true;
      }

      rememberLastOpenedDropboxWorkspace(openedDirectory.path, "");
      console.error(error);
      setStorageError(t("dropbox.error.couldNotReopenLastFile"));
      return true;
    }
  }

  async function openDirectoryPath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }

    // Opening a folder stops any unfinished restore or earlier open from replacing it.
    const openSelectionRevision = ++manualDocumentSelectionRevisionRef.current;
    setStorageError(t("status.openingFolder"));

    const lastOpenedFilePath = readLastOpenedFileInDirectory("local", path);
    if (lastOpenedFilePath) {
      try {
        const restored = await restoreLastOpenedMarkdownWorkspace(
          path,
          lastOpenedFilePath,
          null,
          { rememberRecent: true },
        );
        if (restored) setStorageError("");
        return restored;
      } catch {
        // The file was moved or deleted, so the folder opens at its first file instead.
        forgetRecentOpenedFile("local", lastOpenedFilePath);
      }
    }

    try {
      const openedDirectory = await openMarkdownDirectory({
        path,
      });
      if (openSelectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      applyOpenedDirectory(openedDirectory);
      return true;
    } catch (error) {
      if (openSelectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      setStorageError(translatedError(error, "error.openFolderFailed"));
      return false;
    }
  }

  async function openDropboxMarkdownFilePath(
    path: string,
    options: {
      allowPendingConnection?: boolean;
      openedDirectory?: OpenDropboxMarkdownDirectoryResult;
      tabBehavior?: DocumentTabBehavior;
      userInitiated?: boolean;
    } = {},
  ): Promise<boolean> {
    const selectionRevision =
      options.userInitiated !== false
        ? ++manualDocumentSelectionRevisionRef.current
        : manualDocumentSelectionRevisionRef.current;

    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }
    if (!dropboxConnected && !options.allowPendingConnection) {
      setStorageError(t("dropbox.error.notConnected"));
      return false;
    }

    setStorageError(t("dropbox.status.openingFile"));

    try {
      const loaded = await openDropboxMarkdownFile({
        path,
      });
      if (selectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      if (options.openedDirectory) {
        applyOpenedDropboxDirectory(options.openedDirectory);
      }
      applyLoadedDropboxFile(loaded, {
        replaceDocuments: Boolean(options.openedDirectory),
        tabBehavior: options.tabBehavior,
      });
      setStorageError("");
      return true;
    } catch (error) {
      if (selectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      const message = error instanceof Error ? error.message : String(error);
      setStorageError(dropboxUserFacingError(message));
      return false;
    }
  }

  function dropboxErrorNeedsAuthorization(message: string) {
    return (
      message.includes("Dropbox authorization failed") ||
      message.includes("Dropbox session expired") ||
      message.includes("Dropbox permission is missing")
    );
  }

  async function openDropboxCloudSource(
    options: {
      allowPendingConnection?: boolean;
      pickerMode?: DropboxPickerMode;
    } = {},
  ) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      cancelMobileLocationPicker();
      return;
    }
    if (dropboxConnecting && !options.allowPendingConnection) {
      cancelMobileLocationPicker();
      return;
    }
    if (isMobileViewport && browserAppearsOffline()) {
      setStorageError(t("dropbox.error.offline"));
      cancelMobileLocationPicker();
      return;
    }

    const pickerSessionRevision = dropboxPickerSessionRevisionRef.current + 1;
    dropboxPickerSessionRevisionRef.current = pickerSessionRevision;

    setFileContextMenu(null);
    if (!createEntryDialog?.isSubmitting) {
      setCreateEntryDialog(null);
    }
    if (!duplicateFileDialog?.isSubmitting) {
      setDuplicateFileDialog(null);
    }
    const pickerMode = options.pickerMode ?? "directory";
    setDropboxDirectoryPicker({
      mode: pickerMode,
      directories: [],
      selectedPath: "",
      isLoadingRoot: true,
      isOpening: false,
      error: "",
    });
    setStorageError(t("dropbox.status.loadingRoot"));

    try {
      const status = await dropboxOAuthStatus();
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      setDropboxConnected(status.connected);

      if (!status.connected && !options.allowPendingConnection) {
        completeMobileLocationPicker();
        invalidateDropboxDirectoryPickerSession();
        setDropboxDirectoryPicker(null);
        dropboxPickerModeAfterAuthRef.current = null;
        openSettingsView("cloud");
        return;
      }
      if (!status.connected && options.allowPendingConnection) {
        throw new Error(t("dropbox.error.notConnected"));
      }

      await loadDropboxDirectoryPickerRoot(pickerMode, pickerSessionRevision);
    } catch (error) {
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const displayMessage = dropboxUserFacingError(message);
      if (dropboxErrorNeedsAuthorization(message)) {
        completeMobileLocationPicker();
        invalidateDropboxDirectoryPickerSession();
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        return;
      }

      setDropboxDirectoryPicker({
        mode: pickerMode,
        directories: [],
        selectedPath: "",
        isLoadingRoot: false,
        isOpening: false,
        error: displayMessage,
      });
      setStorageError(displayMessage);
    }
  }

  async function loadDropboxDirectoryPickerRoot(
    mode: DropboxPickerMode,
    pickerSessionRevision: number,
  ) {
    if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;

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
      const openedDirectory = await listDropboxMarkdownDirectory({ path: "" });
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const directories = dropboxPickerNodesFromOpenedDirectory(openedDirectory, mode);
      const selectedPath =
        mode === "file"
          ? directories.find((entry) => entry.kind === "file")?.path || ""
          : directories[0]?.path || "";

      setDropboxDirectoryPicker({
        mode,
        directories,
        selectedPath,
        isLoadingRoot: false,
        isOpening: false,
        error:
          directories.length > 0
            ? ""
            : t(mode === "file" ? "dropbox.picker.emptyFiles" : "dropbox.picker.empty"),
      });
      setStorageError("");
    } catch (error) {
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const displayMessage = dropboxUserFacingError(message);
      if (dropboxErrorNeedsAuthorization(message)) {
        completeMobileLocationPicker();
        invalidateDropboxDirectoryPickerSession();
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        setStorageError(displayMessage);
        return;
      }

      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              isLoadingRoot: false,
              isOpening: false,
              error: displayMessage,
            }
          : currentPicker,
      );
      setStorageError(displayMessage);
    }
  }

  function invalidateDropboxDirectoryPickerSession() {
    dropboxPickerSessionRevisionRef.current += 1;
  }

  function closeDropboxDirectoryPicker() {
    if (dropboxDirectoryPicker?.isOpening) return;

    invalidateDropboxDirectoryPickerSession();
    setDropboxDirectoryPicker(null);
    setStorageError("");
    cancelMobileLocationPicker();
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
    const pickerSessionRevision = dropboxPickerSessionRevisionRef.current;

    const directory = flattenDropboxDirectoryPickerNodes(picker.directories).find(
      ({ node }) => node.path === path,
    )?.node;
    if (!directory || directory.kind !== "directory" || directory.isLoading) return;

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
      const openedDirectory = await listDropboxMarkdownDirectory({ path });
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const childDirectories = dropboxPickerNodesFromOpenedDirectory(
        openedDirectory,
        picker.mode,
      );

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
                  error:
                    childDirectories.length > 0
                      ? ""
                      : t(
                          picker.mode === "file"
                            ? "dropbox.picker.emptyFiles"
                            : "dropbox.picker.emptyNested",
                        ),
                }),
              ),
            }
          : currentPicker,
      );
      setStorageError("");
    } catch (error) {
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const displayMessage = dropboxUserFacingError(message);
      if (dropboxErrorNeedsAuthorization(message)) {
        completeMobileLocationPicker();
        invalidateDropboxDirectoryPickerSession();
        setDropboxDirectoryPicker(null);
        setDropboxConnected(false);
        openSettingsView("cloud");
        setStorageError(displayMessage);
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
                  error: displayMessage,
                }),
              ),
            }
          : currentPicker,
      );
      setStorageError(displayMessage);
    }
  }

  async function openSelectedDropboxPickerItem(pathOverride?: string) {
    const picker = dropboxDirectoryPicker;
    const pickerSessionRevision = dropboxPickerSessionRevisionRef.current;
    const selectedPath = pathOverride ?? picker?.selectedPath;
    if (!selectedPath || !picker || picker.isLoadingRoot || picker.isOpening) {
      return;
    }
    const selectedEntry = flattenDropboxDirectoryPickerNodes(picker.directories).find(
      ({ node }) => node.path === selectedPath,
    )?.node;
    if (!selectedEntry || selectedEntry.kind !== picker.mode) return;

    setDropboxDirectoryPicker((currentPicker) =>
      currentPicker ? { ...currentPicker, isOpening: true, error: "" } : currentPicker,
    );
    setStorageError(
      picker.mode === "file" ? t("dropbox.status.openingFile") : t("dropbox.status.openingFolder"),
    );

    try {
      if (selectedEntry.kind === "file") {
        completeMobileLocationPicker();
        invalidateDropboxDirectoryPickerSession();
        setDropboxDirectoryPicker(null);
        await openDropboxLocation({
          kind: "file",
          path: selectedEntry.path,
          source: "dropbox",
          title: selectedEntry.title,
        }, {
          allowPendingConnection: true,
        });
        if (isMobileViewport && mobileStartupPhase === "welcome") {
          setMobileStartupPhase("hidden");
        }
        return;
      }

      const openedDirectory = await listDropboxMarkdownDirectory({
        path: selectedPath,
      });
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      applyOpenedDropboxDirectory(openedDirectory);
      completeMobileLocationPicker();
      invalidateDropboxDirectoryPickerSession();
      setDropboxDirectoryPicker(null);
      const firstFile = firstDropboxMarkdownFileEntry(openedDirectory);
      if (firstFile) {
        await openDropboxMarkdownFilePath(firstFile.path);
      }

      if (isMobileViewport && mobileStartupPhase === "welcome") {
        setMobileStartupPhase("hidden");
      }
    } catch (error) {
      if (pickerSessionRevision !== dropboxPickerSessionRevisionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const displayMessage = dropboxUserFacingError(message);
      setDropboxDirectoryPicker((currentPicker) =>
        currentPicker
          ? {
              ...currentPicker,
              isOpening: false,
              error: displayMessage,
            }
          : currentPicker,
      );
      setStorageError(displayMessage);
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
    const suppressedClick = suppressedWorkspaceFileClickRef.current;
    if (suppressedClick?.entryId === entry.id && Date.now() < suppressedClick.until) {
      suppressedWorkspaceFileClickRef.current = null;
      return;
    }
    if (suppressedClick && Date.now() >= suppressedClick.until) {
      suppressedWorkspaceFileClickRef.current = null;
    }

    if (ignoreNextWorkspaceClickRef.current) {
      ignoreNextWorkspaceClickRef.current = false;
      return;
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
        selectDocument(entry.documentId, { tabBehavior: "add" });
      } else {
        void openDropboxMarkdownFilePath(entry.path, { tabBehavior: "add" }).then((opened) => {
          if (opened && isMobileViewport) {
            setDirectoryPaneOpen(false);
          }
        });
        return;
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

  function showFileContextMenu(
    entry: Extract<WorkspaceEntry, { kind: "file" | "directory" }>,
    left: number,
    top: number,
  ) {
    const exportDocumentIds = entry.kind === "file" ? workspaceExportDocumentIdsForContext(entry) : [];
    if (entry.kind === "file") {
      setSelectedWorkspaceDocumentIds(new Set(exportDocumentIds));
    } else {
      setSelectedWorkspaceDocumentIds(new Set());
    }
    const position = { left, top };
    setFileContextMenu(
      entry.kind === "file"
        ? {
            kind: "file",
            documentId: entry.documentId,
            exportDocumentIds,
            path: entry.path,
            title: entry.title,
            source: entry.source,
            ...position,
          }
        : {
            kind: "directory",
            exportDocumentIds,
            path: entry.path,
            title: entry.title,
            source: entry.source,
            ...position,
          },
    );
  }

  function openFileContextMenu(
    entry: Extract<WorkspaceEntry, { kind: "file" | "directory" }>,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (entry.kind === "file" && event.ctrlKey && event.button === 0) {
      ignoreNextWorkspaceClickRef.current = true;
      toggleWorkspaceExportSelection(entry.documentId);
      return;
    }

    if (isMobileViewport && entry.kind === "file") {
      suppressedWorkspaceFileClickRef.current = {
        entryId: entry.id,
        until: Date.now() + 1000,
      };
    }
    showFileContextMenu(entry, event.clientX, event.clientY);
  }

  function cancelWorkspaceFileLongPress(pointerId?: number) {
    const start = workspaceFileLongPressStartRef.current;
    if (pointerId !== undefined && start?.pointerId !== pointerId) return;

    window.clearTimeout(workspaceFileLongPressTimerRef.current);
    workspaceFileLongPressTimerRef.current = 0;
    workspaceFileLongPressStartRef.current = null;
  }

  function startWorkspaceFileLongPress(
    entry: Extract<WorkspaceEntry, { kind: "file" | "directory" }>,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!isMobileViewport || entry.kind !== "file" || event.pointerType === "mouse") return;

    cancelWorkspaceFileLongPress();
    const start = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    workspaceFileLongPressStartRef.current = start;
    workspaceFileLongPressTimerRef.current = window.setTimeout(() => {
      if (workspaceFileLongPressStartRef.current !== start) return;

      workspaceFileLongPressTimerRef.current = 0;
      workspaceFileLongPressStartRef.current = null;
      suppressedWorkspaceFileClickRef.current = {
        entryId: entry.id,
        until: Date.now() + 1000,
      };
      showFileContextMenu(entry, start.clientX, start.clientY);
    }, mobileContextMenuLongPressMs);
  }

  function moveWorkspaceFileLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = workspaceFileLongPressStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    if (moved > mobileContextMenuLongPressMoveTolerancePx) {
      cancelWorkspaceFileLongPress(event.pointerId);
    }
  }

  async function openFileInNewTab(target: FileActionTarget) {
    setFileContextMenu(null);

    const loadedDocument = documentsRef.current.find(
      (document) => document.id === target.documentId,
    );

    if (loadedDocument) {
      selectDocument(loadedDocument.id, { tabBehavior: "add" });
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
      return;
    }

    if (target.source === "dropbox" || isDropboxDocumentId(target.documentId)) {
      const opened = await openDropboxMarkdownFilePath(target.path, { tabBehavior: "add" });
      if (opened && isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
      return;
    }

    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError(t("status.openingFile"));

    try {
      const loaded = await openMarkdownFile({
        path: target.path,
      });
      const nextDocument = documentFromLoadedFileResult(loaded);

      documentsRef.current = [
        nextDocument,
        ...documentsRef.current.filter((document) => document.id !== nextDocument.id),
      ];
      mergeLoadedFilesIntoDocumentState([loaded]);
      selectDocument(nextDocument.id, { tabBehavior: "add" });
      rememberLastOpenedMarkdownPath(nextDocument.filePath);
      setStorageError("");
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
    } catch (error) {
      setStorageError(translatedError(error, "error.openFileFailed"));
    }
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
      const loaded = await openMarkdownFile({
        path: result.path,
      });
      mergeLoadedFilesIntoDocumentState([loaded]);
      setMobileSelectedWorkspaceEntryKey("");
      setActiveDocumentId(loaded.path);
      replaceActiveDocumentTab(loaded.path);
      rememberLastOpenedMarkdownPath(loaded.path);
      setStorageError("");
      if (isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
    } catch (error) {
      setStorageError(translatedError(error, "error.openFileFailed"));
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
    setStorageError("");

    try {
      const childDepth = (entry.depth ?? 1) + 1;
      let childEntries: WorkspaceEntry[];

      if (entry.source === "dropbox") {
        const openedDirectory = await listDropboxMarkdownDirectory({
          path: entry.path,
        });
        childEntries = workspaceEntriesFromOpenedDropboxDirectory(openedDirectory, childDepth);
        void loadDropboxTagIndex(
          childEntries,
          dropboxTagIndexRequestRef.current,
          false,
        );
      } else {
        const openedDirectory = await openMarkdownDirectory({
          path: entry.path,
        });
        const loadedFiles = openedDirectory.entries.flatMap((childEntry) =>
          childEntry.kind === "file" ? [childEntry.file] : [],
        );
        mergeLoadedFilesIntoDocumentState(loadedFiles);
        childEntries = workspaceEntriesFromOpenedDirectory(openedDirectory, childDepth);
      }

      if (childEntries.length === 0) {
        setExpandedDirectoryKeys((currentKeys) => new Set(currentKeys).add(entryKey));
        setStorageError("");
        return;
      }

      setWorkspaceEntries((currentEntries) =>
        sortWorkspaceEntriesForDirectory(
          insertWorkspaceDirectoryChildren(currentEntries, entry, childEntries),
          workspaceSortModeRef.current,
        ),
      );
      setExpandedDirectoryKeys((currentKeys) => new Set(currentKeys).add(entryKey));
      setStorageError("");
    } catch (error) {
      setStorageError(translatedError(error, "error.openFolderFailed"));
    } finally {
      setLoadingDirectoryKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(entryKey);
        return nextKeys;
      });
    }
  }

  async function openDroppedMarkdownPaths(paths: string[]) {
    let droppedPath;

    try {
      droppedPath = await validateDroppedMarkdownPath({ paths });
    } catch {
      setStorageError(t("error.dropOneMdFile"));
      setMobileStartupPhase("hidden");
      return;
    }

    const opened =
      droppedPath.kind === "directory"
        ? await openDirectoryPath(droppedPath.path)
        : await openMarkdownFilePath(droppedPath.path);

    if (opened) {
      try {
        await focusAndFullscreenAppWindow();
      } catch (error) {
        console.error(error);
      }
    }

    setMobileStartupPhase("hidden");
  }

  async function openMarkdownFilePath(path: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }

    // The chosen file always wins over a restore or an earlier open that is still loading.
    const openSelectionRevision = ++manualDocumentSelectionRevisionRef.current;
    setStorageError(t("status.openingFile"));

    try {
      const context = await openMarkdownFileContext({
        path,
      });
      if (openSelectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      applyOpenedDirectory(directoryWithSelectedFile(context), context.selectedFile.path);
      return true;
    } catch (error) {
      if (openSelectionRevision !== manualDocumentSelectionRevisionRef.current) return false;

      setStorageError(translatedError(error, "error.openFileFailed"));
      return false;
    }
  }

  async function openDropboxLocation(
    location: NativeLocation,
    options: { allowPendingConnection?: boolean } = {},
  ) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    let connected = dropboxConnected || options.allowPendingConnection === true;
    if (!connected) {
      try {
        const status = await dropboxOAuthStatus();
        connected = status.connected;
        setDropboxConnected(status.connected);
      } catch (error) {
        setStorageError(translatedError(error, "dropbox.error.unexpected"));
        return;
      }
    }

    if (!connected) {
      pendingDropboxLocationAfterAuthRef.current = location;
      await connectDropbox();
      return;
    }

    setStorageError(
      location.kind === "directory"
        ? t("dropbox.status.openingFolder")
        : t("dropbox.status.openingFile"),
    );

    try {
      const directoryPath =
        location.kind === "directory"
          ? location.path
          : dropboxParentDirectoryPath(location.path);
      const openedDirectory = await listDropboxMarkdownDirectory({ path: directoryPath });

      // A folder opens at the file last opened in it; only a never-opened folder starts at its first file.
      const filePath =
        location.kind === "file"
          ? location.path
          : lastOpenedFileAmong(
              readRecentOpenedFiles(),
              "dropbox",
              openedDirectory.entries.flatMap((entry) =>
                entry.kind === "file" ? [entry.path] : [],
              ),
            ) || firstDropboxMarkdownFileEntry(openedDirectory)?.path;
      if (filePath) {
        await openDropboxMarkdownFilePath(filePath, {
          allowPendingConnection: connected,
          openedDirectory,
        });
      } else {
        applyOpenedDropboxDirectory(openedDirectory);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dropboxErrorNeedsAuthorization(message) || dropboxErrorIsDisconnected(message)) {
        setDropboxConnected(false);
        pendingDropboxLocationAfterAuthRef.current = location;
        await connectDropbox();
        return;
      }
      setStorageError(dropboxUserFacingError(message));
    }
  }

  async function openNativeMenuLocation(location: OpenLocationEventPayload) {
    if (location.source === "dropbox") {
      await openDropboxLocation(location);
      return;
    }
    if (location.kind === "directory") {
      await openDirectoryPath(location.path);
      return;
    }

    await openMarkdownFilePath(location.path);
  }

  async function openMarkdownFolder() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return true;
    }

    setStorageError("");

    try {
      await setNativeFolderPickerListView({ enabled: true });
      let selectedPath: string | string[] | null;
      try {
        selectedPath = await openDialog({
          directory: true,
          multiple: false,
        });
      } finally {
        await setNativeFolderPickerListView({ enabled: false });
      }
      if (!selectedPath) return false;
      if (Array.isArray(selectedPath)) return true;

      await openDirectoryPath(selectedPath);
      return true;
    } catch (error) {
      setStorageError(translatedError(error, "error.openFolderFailed"));
      return true;
    }
  }

  function openOpenPathDialog() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setOpenPathDialog((currentDialog) =>
      currentDialog ?? { path: "", isSubmitting: false, error: "" },
    );
  }

  function closeOpenPathDialog() {
    if (openPathDialog?.isSubmitting) return;

    setOpenPathDialog(null);
  }

  async function submitOpenPathDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openPathDialog || openPathDialog.isSubmitting) return;

    setOpenPathDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: true, error: "" } : currentDialog,
    );

    let location;
    try {
      location = await resolveTypedMarkdownPath({ path: openPathDialog.path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenPathDialog((currentDialog) =>
        currentDialog
          ? {
              ...currentDialog,
              isSubmitting: false,
              error: t(typedPathErrorTranslationKeys[message] ?? "error.openFileFailed"),
            }
          : currentDialog,
      );
      return;
    }

    setOpenPathDialog(null);
    if (location.kind === "directory") {
      await openDirectoryPath(location.path);
    } else {
      await openMarkdownFilePath(location.path);
    }
  }

  async function openMarkdownFileFromPicker() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return true;
    }

    setStorageError(t("status.openingFile"));

    try {
      const selectedPath = await openDialog({
        directory: false,
        multiple: false,
        filters: markdownFilters,
      });
      if (!selectedPath) {
        setStorageError("");
        return false;
      }
      if (Array.isArray(selectedPath)) {
        setStorageError("");
        return true;
      }

      await openMarkdownFilePath(selectedPath);
      return true;
    } catch (error) {
      setStorageError(translatedError(error, "error.openFileFailed"));
      return true;
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
    const { pdfFileNameForDocument, renderMarkdownDocumentToPdfBase64 } = await import(
      "./pdfExport"
    );
    const dataBase64 = await renderMarkdownDocumentToPdfBase64(
      documentToExport,
      t("pdfExport.content.imageUnavailable"),
      parseMarkdownPreviewBlocks,
    );

    return writePdfFileToDirectory({
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
          const { pdfFileNameForDocument, renderMarkdownDocumentToPdfBase64 } = await import(
            "./pdfExport"
          );
          const selectedPath = await save({
            defaultPath: pdfFileNameForDocument(documentToExport),
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!selectedPath) return;

          const dataBase64 = await renderMarkdownDocumentToPdfBase64(
            documentToExport,
            t("pdfExport.content.imageUnavailable"),
            parseMarkdownPreviewBlocks,
          );
          saved = await writePdfFile({
            path: selectedPath,
            dataBase64,
          });
        }

        setStorageError(t("pdfExport.status.saved", { path: saved.path }));
      } catch (error) {
        console.error(error);
        setStorageError(t("pdfExport.error.renderFailed"));
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
      console.error(error);
      setStorageError(t("pdfExport.error.renderFailed"));
    }
  }

  async function createDropboxMarkdownFile(fileName: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }
    if (workspaceSource !== "dropbox" || workspaceRootPath === null) {
      setStorageError(t("dropbox.error.noWorkspace"));
      return false;
    }

    const trimmedFileName = fileName.trim();
    if (!trimmedFileName) {
      setStorageError(t("error.fileNameRequired"));
      return false;
    }

    try {
      const loaded = await createDropboxMarkdownFileRequest({
        parentPath: workspaceRootPath,
        fileName: trimmedFileName,
      });
      applyLoadedDropboxFile(loaded);
      setActiveDocumentModeState({ editorMode: "preview" });
      setStorageError("");
      return true;
    } catch (error) {
      setStorageError(translatedError(error, "error.createFileFailed"));
      return false;
    }
  }

  async function createLocalMarkdownFile(fileName: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }
    if (workspaceSource !== "local" || workspaceRootPath === null) {
      setStorageError(t("newFolder.noWorkspace"));
      return false;
    }

    const trimmedFileName = fileName.trim();
    if (!trimmedFileName) {
      setStorageError(t("error.fileNameRequired"));
      return false;
    }
    if (/[\\/]/.test(trimmedFileName)) {
      setStorageError(t("error.fileNameNoFolders"));
      return false;
    }

    const path = filePathInDirectory(workspaceRootPath, ensureMarkdownExtension(trimmedFileName));
    try {
      await openMarkdownFile({ path });
      setStorageError(t("error.fileExists"));
      return false;
    } catch {
      // Opening fails for a new path; save below creates the file.
    }

    try {
      const saved = await saveMarkdownFile({
        path,
        body: "",
        notes: [],
        glossaryTerms: [],
        glossaryBindings: [],
      });
      const loaded = await openMarkdownFile({
        path: saved.path,
      });
      applyLoadedFiles([loaded], { sortEntries: true });
      setActiveDocumentModeState({ editorMode: "preview" });
      setStorageError("");
      return true;
    } catch (error) {
      setStorageError(translatedError(error, "error.createFileFailed"));
      return false;
    }
  }

  function replaceDraftWithLoadedDocument(
    draftId: string,
    loadedDocument: MarkdownDocument,
    loadedNotes: SelectionNote[],
    loadedGlossaryTerms: GlossaryTerm[],
    loadedGlossaryBindings: GlossaryBinding[],
  ) {
    const nextDocuments = documentsRef.current.flatMap((document) => {
      if (document.id === draftId) return [loadedDocument];
      if (document.id === loadedDocument.id) return [];
      return [document];
    });
    if (!nextDocuments.some((document) => document.id === loadedDocument.id)) {
      nextDocuments.unshift(loadedDocument);
    }

    const nextNotes = [
      ...loadedNotes,
      ...notesRef.current.filter(
        (note) => note.documentId !== draftId && note.documentId !== loadedDocument.id,
      ),
    ];
    const nextGlossaryBindings = [
      ...loadedGlossaryBindings,
      ...glossaryBindingsRef.current.filter(
        (binding) =>
          binding.documentId !== draftId && binding.documentId !== loadedDocument.id,
      ),
    ];
    const nextGlossaryTerms = mergeGlossaryTerms(
      loadedGlossaryTerms,
      glossaryTermsRef.current,
    );
    const nextDirtyDocumentStates = { ...dirtyDocumentStatesRef.current };
    delete nextDirtyDocumentStates[draftId];
    delete nextDirtyDocumentStates[loadedDocument.id];

    const nextDocumentModeStates = { ...documentModeStatesRef.current };
    const draftModeState = nextDocumentModeStates[draftId];
    delete nextDocumentModeStates[draftId];
    if (draftModeState) {
      nextDocumentModeStates[loadedDocument.id] = draftModeState;
    }

    const nextOpenDocumentTabIds = availableDocumentTabIds(
      openDocumentTabIdsRef.current.map((documentId) =>
        documentId === draftId || documentId === loadedDocument.id
          ? loadedDocument.id
          : documentId,
      ),
      nextDocuments.map((document) => document.id),
    );
    const nextWorkspaceEntries = sortWorkspaceEntriesForDirectory(
      insertOrUpdateWorkspaceFileEntry(
        workspaceEntriesRef.current.filter(
          (entry) => entry.kind !== "file" || entry.documentId !== draftId,
        ),
        workspaceEntryFromDocument(loadedDocument),
        workspaceRootPath,
      ),
      workspaceSortModeRef.current,
    );

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    glossaryTermsRef.current = nextGlossaryTerms;
    dirtyDocumentStatesRef.current = nextDirtyDocumentStates;
    documentModeStatesRef.current = nextDocumentModeStates;
    openDocumentTabIdsRef.current = nextOpenDocumentTabIds;
    workspaceEntriesRef.current = nextWorkspaceEntries;

    setDocuments(nextDocuments);
    setNotes(nextNotes);
    setGlossaryBindings(nextGlossaryBindings);
    setGlossaryTerms(nextGlossaryTerms);
    setDirtyDocumentStates(nextDirtyDocumentStates);
    setDocumentModeStates(nextDocumentModeStates);
    setOpenDocumentTabIds(nextOpenDocumentTabIds);
    setWorkspaceEntries(nextWorkspaceEntries);
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies = { ...currentBodies };
      delete nextBodies[draftId];
      nextBodies[loadedDocument.id] = loadedDocument.body;
      savedDocumentBodiesRef.current = nextBodies;
      return nextBodies;
    });
    if (selectedDocumentIdRef.current === draftId) {
      setActiveDocumentId(loadedDocument.id);
    }
  }

  function replaceDraftWithLoadedLocalFile(
    draftId: string,
    loadedFile: OpenMarkdownFileResult,
  ) {
    const loadedDocument = documentFromLoadedFileResult(loadedFile);
    replaceDraftWithLoadedDocument(
      draftId,
      loadedDocument,
      loadedFile.notes.map((note) =>
        loadedNoteForDocument(loadedFile, note, loadedFile.path, recoverRenderableAnchor),
      ),
      loadedFile.glossaryTerms ?? [],
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        loadedGlossaryBindingForDocument(
          loadedFile,
          binding,
          loadedFile.path,
          recoverRenderableAnchor,
        ),
      ),
    );
    rememberLastOpenedMarkdownPath(loadedDocument.filePath);
  }

  function replaceDraftWithLoadedDropboxFile(
    draftId: string,
    loadedFile: OpenDropboxMarkdownFileResult,
  ) {
    const loadedDocument = documentFromDropboxFile(loadedFile);
    replaceDraftWithLoadedDocument(
      draftId,
      loadedDocument,
      loadedFile.notes.map((note) =>
        loadedNoteForDocument(
          loadedFile,
          note,
          loadedDocument.id,
          recoverRenderableAnchor,
        ),
      ),
      loadedFile.glossaryTerms ?? [],
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        loadedGlossaryBindingForDocument(
          loadedFile,
          binding,
          loadedDocument.id,
          recoverRenderableAnchor,
        ),
      ),
    );
    rememberLastOpenedDropboxWorkspace(
      workspaceRootPath ??
        readLastOpenedDropboxWorkspace()?.workspacePath ??
        dropboxParentDirectoryPath(loadedDocument.path),
      loadedDocument.path,
    );
  }

  async function saveDraftDocument(
    documentToSave: MarkdownDocument,
    fileName: string,
  ): Promise<DraftDocumentSaveResult> {
    if (!nativeStorageAvailable) {
      return { status: "failed", message: t("error.nativeRuntimeRequired") };
    }
    if (!isDraftDocumentId(documentToSave.id)) {
      return { status: "saved", documentId: documentToSave.id };
    }

    const trimmedFileName = stripMarkdownExtension(fileName.trim()).trim();
    if (!trimmedFileName) {
      return { status: "failed", message: t("error.fileNameRequired") };
    }
    if (/[\\/]/.test(trimmedFileName)) {
      return { status: "failed", message: t("error.fileNameNoFolders") };
    }

    const notesToSave = notesForDocument(documentToSave.id);
    const glossaryBindingsToSave = glossaryBindingsForDocument(documentToSave.id);
    const glossaryTermsToSave = glossaryTermsForDocument(documentToSave.id);
    const source = draftDocumentSource(documentToSave.id);
    const markdownFileName = ensureMarkdownExtension(trimmedFileName);

    try {
      if (source === "dropbox") {
        if (workspaceRootPath === null) {
          return { status: "failed", message: t("dropbox.error.noWorkspace") };
        }

        const created = await createDropboxMarkdownFileRequest({
          parentPath: workspaceRootPath,
          fileName: trimmedFileName,
        });
        const saved = await saveDropboxMarkdownFile({
          path: created.path,
          body: documentToSave.body,
          rev: created.rev ?? null,
          notes: notesToSave,
          glossaryTerms: glossaryTermsToSave,
          glossaryBindings: glossaryBindingsToSave,
        });
        replaceDraftWithLoadedDropboxFile(documentToSave.id, saved);
        forgetStoredDraftDocument(documentToSave.id);
        setStorageError("");
        return { status: "saved", documentId: documentFromDropboxFile(saved).id };
      }

      let path: string;
      if (workspaceSource === "local" && workspaceRootPath !== null) {
        path = filePathInDirectory(workspaceRootPath, markdownFileName);
        try {
          await openMarkdownFile({ path });
          return { status: "failed", message: t("error.fileExists") };
        } catch {
          // Opening fails for a new path; save below creates the file.
        }
      } else {
        const selectedPath = await save({
          defaultPath: markdownFileName,
          filters: markdownFilters,
        });
        if (!selectedPath) return { status: "cancelled" };
        path = ensureMarkdownExtension(selectedPath);
      }

      const saved = await saveMarkdownFile({
        path,
        body: documentToSave.body,
        notes: notesToSave,
        glossaryTerms: glossaryTermsToSave,
        glossaryBindings: glossaryBindingsToSave,
      });
      const loaded = await openMarkdownFile({
        path: saved.path,
      });
      replaceDraftWithLoadedLocalFile(documentToSave.id, loaded);
      forgetStoredDraftDocument(documentToSave.id);
      setStorageError("");
      return { status: "saved", documentId: documentFromLoadedFileResult(loaded).id };
    } catch (error) {
      return { status: "failed", message: translatedError(error, "error.createFileFailed") };
    }
  }

  function requestDraftFileDecision(
    documentId: string,
    reason: DraftFileDialogState["reason"],
  ) {
    draftFileDialogResolverRef.current?.({ action: "cancelled" });

    return new Promise<DraftFileDecision>((resolve) => {
      draftFileDialogResolverRef.current = resolve;
      setDraftFileDialog({
        documentId,
        reason,
        name: stripMarkdownExtension(t("app.untitledFile")),
        isSubmitting: false,
        error: "",
      });
    });
  }

  function finishDraftFileDialog(decision: DraftFileDecision) {
    const resolve = draftFileDialogResolverRef.current;
    draftFileDialogResolverRef.current = null;
    setDraftFileDialog(null);
    resolve?.(decision);
  }

  function cancelDraftFileDialog() {
    if (draftFileDialog?.isSubmitting) return;

    finishDraftFileDialog({ action: "cancelled" });
  }

  function discardDraftFileDialogDocument() {
    if (!draftFileDialog || draftFileDialog.isSubmitting) return;

    removeDocumentsFromWorkspace([draftFileDialog.documentId]);
    forgetStoredDraftDocument(draftFileDialog.documentId);
    finishDraftFileDialog({ action: "discarded" });
  }

  async function submitDraftFileDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftFileDialog || draftFileDialog.isSubmitting) return;

    const documentToSave = documentsRef.current.find(
      (document) => document.id === draftFileDialog.documentId,
    );
    if (!documentToSave) {
      finishDraftFileDialog({ action: "cancelled" });
      return;
    }

    setDraftFileDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: true, error: "" } : currentDialog,
    );
    const result = await saveDraftDocument(documentToSave, draftFileDialog.name);
    if (result.status === "saved") {
      finishDraftFileDialog({ action: "created", documentId: result.documentId });
      return;
    }

    setDraftFileDialog((currentDialog) =>
      currentDialog
        ? {
            ...currentDialog,
            isSubmitting: false,
            error: result.status === "failed" ? result.message : "",
          }
        : currentDialog,
    );
  }

  async function prepareDraftDocumentForLeaving(
    documentId: string,
  ): Promise<
    | { status: "unchanged" | "discarded" | "blocked" }
    | { status: "saved"; documentId: string }
  > {
    const documentToLeave = documentsRef.current.find((document) => document.id === documentId);
    if (!documentToLeave || !isDraftDocumentId(documentToLeave.id)) {
      return { status: "unchanged" };
    }
    if (
      !draftDocumentHasContent(
        documentToLeave.body,
        notesForDocument(documentToLeave.id).length,
        glossaryBindingsForDocument(documentToLeave.id).length,
      )
    ) {
      removeDocumentsFromWorkspace([documentToLeave.id]);
      forgetStoredDraftDocument(documentToLeave.id);
      return { status: "discarded" };
    }

    if (selectedDocumentIdRef.current !== documentToLeave.id) {
      selectDocument(documentToLeave.id, { tabBehavior: "none", userInitiated: false });
    }

    const decision = await requestDraftFileDecision(documentToLeave.id, "close");
    if (decision.action === "created") {
      return { status: "saved", documentId: decision.documentId };
    }
    return { status: decision.action === "discarded" ? "discarded" : "blocked" };
  }

  async function resolveDraftDocumentsBeforeWindowClose() {
    const draftDocumentIds = documentsRef.current
      .map((document) => document.id)
      .filter(isDraftDocumentId);
    for (const documentId of draftDocumentIds) {
      const result = await prepareDraftDocumentForLeaving(documentId);
      if (result.status === "blocked") return false;
    }
    return true;
  }

  function enqueueDraftStoreOperation(operation: () => Promise<void>) {
    draftStoreQueueRef.current = draftStoreQueueRef.current
      .then(operation)
      .catch((error: unknown) => {
        console.error(error);
      });
  }

  function serializedDraftDocument(documentToStore: MarkdownDocument) {
    return serializeStoredDraftDocument({
      id: documentToStore.id,
      title: documentToStore.title,
      body: documentToStore.body,
      notes: notesForDocument(documentToStore.id),
      glossaryTerms: glossaryTermsForDocument(documentToStore.id),
      glossaryBindings: glossaryBindingsForDocument(documentToStore.id),
    });
  }

  // Unnamed files are written to the app's draft folder whenever they change, so
  // their content survives a forced quit, crash or power loss.
  function storeChangedDraftDocuments() {
    documentsRef.current.forEach((document) => {
      if (!isDraftDocumentId(document.id)) return;

      const contents = serializedDraftDocument(document);
      if (storedDraftSnapshotsRef.current.get(document.id) === contents) return;

      storedDraftSnapshotsRef.current.set(document.id, contents);
      enqueueDraftStoreOperation(() => storeDraftDocument({ id: document.id, contents }));
    });
  }

  // Stored drafts are removed only here: after the user chooses "捨棄", closes an
  // empty unnamed tab, or the content has been created as a real file.
  function forgetStoredDraftDocument(documentId: string) {
    if (!nativeStorageAvailable) return;

    storedDraftSnapshotsRef.current.delete(documentId);
    enqueueDraftStoreOperation(() => deleteStoredDraftDocument({ id: documentId }));
  }

  async function restoreStoredDraftDocuments() {
    const restoreSelectionRevision = manualDocumentSelectionRevisionRef.current;
    let storedContents: string[];
    try {
      storedContents = await listStoredDraftDocuments();
    } catch (error) {
      console.error(error);
      return;
    }

    const openDocumentIds = new Set(documentsRef.current.map((document) => document.id));
    const storedDrafts = storedContents
      .map((contents) =>
        parseStoredDraftDocument<SelectionNote, GlossaryTerm, GlossaryBinding>(contents),
      )
      .filter((draft): draft is NonNullable<typeof draft> =>
        Boolean(draft && !openDocumentIds.has(draft.id)),
      )
      .sort(
        (first, second) =>
          draftDocumentCreatedAt(first.id) - draftDocumentCreatedAt(second.id),
      );
    if (storedDrafts.length === 0) return;

    const restoredDocuments: MarkdownDocument[] = storedDrafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      path: "",
      filePath: null,
      notesPath: null,
      updatedAt: "",
      modifiedAt: null,
      body: draft.body,
    }));
    const restoredIds = new Set(restoredDocuments.map((document) => document.id));
    const nextDocuments = [
      ...documentsRef.current.filter((document) => !restoredIds.has(document.id)),
      ...restoredDocuments,
    ];
    const nextNotes = [
      ...notesRef.current.filter((note) => !restoredIds.has(note.documentId)),
      ...storedDrafts.flatMap((draft) => draft.notes),
    ];
    const nextGlossaryBindings = [
      ...glossaryBindingsRef.current.filter((binding) => !restoredIds.has(binding.documentId)),
      ...storedDrafts.flatMap((draft) => draft.glossaryBindings),
    ];
    const nextGlossaryTerms = mergeGlossaryTerms(
      storedDrafts.flatMap((draft) => draft.glossaryTerms),
      glossaryTermsRef.current,
    );
    const nextOpenDocumentTabIds = [
      ...openDocumentTabIdsRef.current.filter((documentId) => !restoredIds.has(documentId)),
      ...restoredDocuments.map((document) => document.id),
    ];

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    glossaryTermsRef.current = nextGlossaryTerms;
    openDocumentTabIdsRef.current = nextOpenDocumentTabIds;
    restoredDocuments.forEach((document) => {
      storedDraftSnapshotsRef.current.set(document.id, serializedDraftDocument(document));
    });

    setDocuments(nextDocuments);
    setNotes(nextNotes);
    setGlossaryBindings(nextGlossaryBindings);
    setGlossaryTerms(nextGlossaryTerms);
    setOpenDocumentTabIds(nextOpenDocumentTabIds);
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies = { ...currentBodies };
      restoredDocuments.forEach((document) => {
        nextBodies[document.id] = "";
      });
      savedDocumentBodiesRef.current = nextBodies;
      return nextBodies;
    });
    // Show the most recent unnamed file so the recovered content is visible right away,
    // unless the person opened a specific file or folder, which then stays in front.
    if (
      !startupOpenRequestedRef.current &&
      manualDocumentSelectionRevisionRef.current === restoreSelectionRevision
    ) {
      selectDocument(restoredDocuments[restoredDocuments.length - 1].id, {
        tabBehavior: "none",
        userInitiated: false,
      });
    }
  }

  // Keeps unnamed files (and their notes) open when another folder replaces the
  // documents of the current workspace.
  function currentDraftDocumentState() {
    const documents = documentsRef.current.filter((document) =>
      isDraftDocumentId(document.id),
    );
    const draftIds = new Set(documents.map((document) => document.id));
    const glossaryBindings = glossaryBindingsRef.current.filter((binding) =>
      draftIds.has(binding.documentId),
    );
    const termIds = new Set(glossaryBindings.map((binding) => binding.termId));

    return {
      documents,
      notes: notesRef.current.filter((note) => draftIds.has(note.documentId)),
      glossaryBindings,
      glossaryTerms: glossaryTermsRef.current.filter((term) => termIds.has(term.id)),
      savedBodies: Object.fromEntries(
        Object.entries(savedDocumentBodiesRef.current).filter(([documentId]) =>
          draftIds.has(documentId),
        ),
      ),
    };
  }

  function createDraftMarkdownDocument(source: WorkspaceSource | null) {
    const title = stripMarkdownExtension(t("app.untitledFile"));
    const draftDocument: MarkdownDocument = {
      id: draftDocumentId(source),
      title,
      path: "",
      filePath: null,
      notesPath: null,
      updatedAt: "",
      modifiedAt: null,
      body: "",
    };
    const nextDocuments = [
      draftDocument,
      ...documentsRef.current.filter((document) => document.id !== draftDocument.id),
    ];

    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    setSavedDocumentBodies((currentBodies) => ({
      ...currentBodies,
      [draftDocument.id]: "",
    }));
    setActiveDocumentId(draftDocument.id);
    addDocumentTab(draftDocument.id);
    setActiveDocumentModeState({ editorMode: "preview" });
    setStorageError("");
    if (isMobileViewport) {
      setDirectoryPaneOpen(false);
    }
  }

  async function newMarkdownFile() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    // Mobile has no tabs or save shortcut, so it names the file before creating it.
    if (isMobileViewport && workspaceSource && workspaceRootPath !== null) {
      openCreateEntryDialog("file");
      return;
    }

    createDraftMarkdownDocument(workspaceSource === "dropbox" ? "dropbox" : "local");
  }

  async function createWorkspaceFolder(name: string) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return false;
    }
    if (workspaceRootPath === null || workspaceSource === null) {
      setStorageError(t("newFolder.noWorkspace"));
      return false;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStorageError(t("newFolder.nameRequired"));
      return false;
    }

    const parentPath = workspaceRootPath;
    const source = workspaceSource;
    try {
      const createDirectory =
        source === "dropbox" ? createDropboxMarkdownDirectory : createMarkdownDirectory;
      const created = await createDirectory({
        parentPath,
        name: trimmedName,
      });
      const createdEntry: WorkspaceEntry = {
        kind: "directory",
        id: source === "dropbox" ? `dropbox-directory:${created.path}` : `directory:${created.path}`,
        title: created.title,
        path: created.path,
        modifiedAt: Date.now(),
        depth: 1,
        source,
      };

      setWorkspaceEntries((currentEntries) =>
        sortWorkspaceEntriesForDirectory(
          [
            ...currentEntries.filter(
              (entry) =>
                entry.kind === "parent-directory" ||
                entry.source !== source ||
                entry.path !== created.path,
            ),
            createdEntry,
          ],
          workspaceSortModeRef.current,
        ),
      );
      setStorageError("");
      return true;
    } catch (error) {
      setStorageError(translatedError(error, "newFolder.createFailed"));
      return false;
    }
  }

  function newMarkdownFolder() {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (workspaceRootPath === null || workspaceSource === null) {
      setStorageError(t("newFolder.noWorkspace"));
      return;
    }

    openCreateEntryDialog("folder");
  }

  function openCreateEntryDialog(kind: CreateEntryDialogState["kind"]) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (workspaceRootPath === null || workspaceSource === null) {
      setStorageError(kind === "file" ? t("dropbox.error.noWorkspace") : t("newFolder.noWorkspace"));
      return;
    }

    setStorageError("");
    setCreateEntryDialog({
      kind,
      name: kind === "file" ? stripMarkdownExtension(t("app.untitledFile")) : "",
      isSubmitting: false,
    });
  }

  async function submitCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createEntryDialog || createEntryDialog.isSubmitting) return;

    setCreateEntryDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: true } : currentDialog,
    );

    const created =
      createEntryDialog.kind === "file"
        ? workspaceSource === "dropbox"
          ? await createDropboxMarkdownFile(createEntryDialog.name)
          : await createLocalMarkdownFile(createEntryDialog.name)
        : await createWorkspaceFolder(createEntryDialog.name);
    if (created) {
      if (createEntryDialog.kind === "file" && isMobileViewport) {
        setDirectoryPaneOpen(false);
      }
      setCreateEntryDialog(null);
      return;
    }

    setCreateEntryDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: false } : currentDialog,
    );
  }

  function closeCreateEntryDialog() {
    if (createEntryDialog?.isSubmitting) return;

    setCreateEntryDialog(null);
    setStorageError("");
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

  function markDocumentSnapshotSaved(
    documentId: string,
    savedBody: string,
    savedSidecarFingerprint: string,
  ) {
    const nextSavedBodies = {
      ...savedDocumentBodiesRef.current,
      [documentId]: savedBody,
    };
    savedDocumentBodiesRef.current = nextSavedBodies;
    setSavedDocumentBodies(nextSavedBodies);

    const currentDocument = documentsRef.current.find((document) => document.id === documentId);
    const currentSidecarFingerprint = sidecarFingerprint(
      notesForDocument(documentId, notesRef.current),
      glossaryTermsForDocument(
        documentId,
        glossaryBindingsRef.current,
        glossaryTermsRef.current,
      ),
      glossaryBindingsForDocument(
        documentId,
        glossaryBindingsRef.current,
        glossaryTermsRef.current,
      ),
    );
    const nextDirtyStates = reconcileDirtyAfterSavedSnapshot(
      dirtyDocumentStatesRef.current,
      documentId,
      currentDocument?.body ?? savedBody,
      savedBody,
      currentSidecarFingerprint,
      savedSidecarFingerprint,
    );
    dirtyDocumentStatesRef.current = nextDirtyStates;
    setDirtyDocumentStates(nextDirtyStates);
  }

  async function saveDocumentToDisk(documentToSave: MarkdownDocument) {
    if (!documentToSave.filePath) return;

    const bodyToSave = documentToSave.body;
    const sourceNotes = notesRef.current;
    const sourceGlossaryTerms = glossaryTermsRef.current;
    const sourceGlossaryBindings = glossaryBindingsRef.current;
    const notesToSave = notesForDocument(documentToSave.id, sourceNotes);
    const glossaryBindingsToSave = glossaryBindingsForDocument(
      documentToSave.id,
      sourceGlossaryBindings,
      sourceGlossaryTerms,
    );
    const glossaryTermsToSave = glossaryTermsForDocument(
      documentToSave.id,
      sourceGlossaryBindings,
      sourceGlossaryTerms,
    );
    const savedSidecarFingerprint = sidecarFingerprint(
      notesToSave,
      glossaryTermsToSave,
      glossaryBindingsToSave,
    );
    const savedBodySnapshot =
      savedDocumentBodiesRef.current[documentToSave.id] ?? documentToSave.body;
    const currentDiskFile = await openMarkdownFile({
      path: documentToSave.filePath,
    });
    if (currentDiskFile.body !== savedBodySnapshot && currentDiskFile.body !== bodyToSave) {
      throw new Error(
        t("error.externalFileChanged"),
      );
    }

    const saved = await saveMarkdownFile({
      path: documentToSave.filePath,
      body: bodyToSave,
      notes: notesToSave,
      glossaryTerms: glossaryTermsToSave,
      glossaryBindings: glossaryBindingsToSave,
    });

    const nextDocuments = documentsRef.current.map((document) =>
      document.id === documentToSave.id
        ? {
            ...document,
            filePath: saved.path,
            path: saved.path,
            notesPath: saved.notesPath,
            updatedAt: `Saved ${nowLabel()}`,
            modifiedAt: saved.modifiedAt ?? Date.now(),
          }
        : document,
    );
    const nextWorkspaceEntries = sortWorkspaceEntriesForDirectory(
      workspaceEntriesRef.current.map((entry) =>
        entry.kind === "file" && entry.documentId === documentToSave.id
          ? {
              ...entry,
              path: saved.path,
              id: `file:${saved.path}`,
              modifiedAt: saved.modifiedAt ?? Date.now(),
            }
          : entry,
      ),
      workspaceSortModeRef.current,
    );
    documentsRef.current = nextDocuments;
    workspaceEntriesRef.current = nextWorkspaceEntries;
    setDocuments(nextDocuments);
    setWorkspaceEntries(nextWorkspaceEntries);
    markDocumentSnapshotSaved(documentToSave.id, bodyToSave, savedSidecarFingerprint);
  }

  async function saveDocumentToDropbox(documentToSave: MarkdownDocument) {
    if (!documentIsFromDropbox(documentToSave)) return;

    const bodyToSave = documentToSave.body;
    const sourceNotes = notesRef.current;
    const sourceGlossaryTerms = glossaryTermsRef.current;
    const sourceGlossaryBindings = glossaryBindingsRef.current;
    const notesToSave = notesForDocument(documentToSave.id, sourceNotes);
    const glossaryBindingsToSave = glossaryBindingsForDocument(
      documentToSave.id,
      sourceGlossaryBindings,
      sourceGlossaryTerms,
    );
    const glossaryTermsToSave = glossaryTermsForDocument(
      documentToSave.id,
      sourceGlossaryBindings,
      sourceGlossaryTerms,
    );
    const savedSidecarFingerprint = sidecarFingerprint(
      notesToSave,
      glossaryTermsToSave,
      glossaryBindingsToSave,
    );
    const saved = await saveDropboxMarkdownFile({
      path: documentToSave.path,
      body: bodyToSave,
      rev: documentToSave.dropboxRev ?? null,
      notes: notesToSave,
      glossaryTerms: glossaryTermsToSave,
      glossaryBindings: glossaryBindingsToSave,
    });

    const nextDocuments = documentsRef.current.map((document) =>
      document.id === documentToSave.id
        ? {
            ...document,
            title: saved.title,
            path: saved.path,
            notesPath: saved.notesPath,
            updatedAt: saved.serverModified
              ? `Dropbox ${saved.serverModified}`
              : `Saved ${nowLabel()}`,
            modifiedAt: saved.serverModified ? Date.parse(saved.serverModified) : Date.now(),
            dropboxRev: saved.rev ?? null,
          }
        : document,
    );
    const nextWorkspaceEntries = sortWorkspaceEntriesForDirectory(
      workspaceEntriesRef.current.map((entry) =>
        entry.kind === "file" && entry.documentId === documentToSave.id
          ? {
              ...entry,
              title: saved.title,
              path: saved.path,
              id: `dropbox-file:${saved.path}`,
              modifiedAt: saved.serverModified ? Date.parse(saved.serverModified) : Date.now(),
            }
          : entry,
      ),
      workspaceSortModeRef.current,
    );
    documentsRef.current = nextDocuments;
    workspaceEntriesRef.current = nextWorkspaceEntries;
    setDocuments(nextDocuments);
    setWorkspaceEntries(nextWorkspaceEntries);
    markDocumentSnapshotSaved(documentToSave.id, bodyToSave, savedSidecarFingerprint);
  }

  async function saveDocument(documentToSave: MarkdownDocument) {
    if (documentIsFromDropbox(documentToSave)) {
      await saveDocumentToDropbox(documentToSave);
      return;
    }

    await saveDocumentToDisk(documentToSave);
  }
  saveDocumentHandlerRef.current = saveDocument;

  async function saveDirtyDocuments() {
    if (!nativeStorageAvailable) return;

    const wasSaving = autosaveCoordinator.isSaving();
    if (
      !wasSaving &&
      !documentsRef.current.some((document) => {
        const hasBackingFile = Boolean(document.filePath) || documentIsFromDropbox(document);
        return hasBackingFile && hasDirtyState(dirtyDocumentStatesRef.current[document.id]);
      })
    ) {
      return;
    }

    const saveRequest = autosaveCoordinator.request();
    autosaveInFlightRef.current = true;
    if (wasSaving) {
      try {
        await saveRequest;
      } catch {
        // The request owner reports unexpected coordinator errors.
      } finally {
        autosaveInFlightRef.current = autosaveCoordinator.isSaving();
      }
      return;
    }

    setStorageError("");

    try {
      const failures = await saveRequest;
      const unresolvedFailuresByDocumentId = new Map<
        string,
        (typeof failures)[number]
      >();
      failures.forEach((failure) => {
        console.error(failure.error);
        if (hasDirtyState(dirtyDocumentStatesRef.current[failure.target])) {
          unresolvedFailuresByDocumentId.set(failure.target, failure);
        }
      });
      const unresolvedFailures = [...unresolvedFailuresByDocumentId.values()];
      if (unresolvedFailures.length > 0) {
        const externalFileChangedMessage = t("error.externalFileChanged");
        const externalFileFailure = unresolvedFailures.find(({ error }) =>
          (error instanceof Error ? error.message : String(error)) === externalFileChangedMessage,
        );
        const localRecoveryFailureKey = unresolvedFailures
          .map(({ error }) => localRecoveryErrorTranslationKey(error))
          .find((key): key is TranslationKey => key !== null);
        setStorageError(
          externalFileFailure
            ? externalFileChangedMessage
            : localRecoveryFailureKey
              ? t(localRecoveryFailureKey)
              : t("error.saveFailed"),
        );
      }
    } catch (error) {
      console.error(error);
      setStorageError(t("error.saveFailed"));
    } finally {
      autosaveInFlightRef.current = autosaveCoordinator.isSaving();
    }
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

  function markNoteCopySucceeded(actionKey: string) {
    window.clearTimeout(copiedNoteActionTimerRef.current);
    setCopiedNoteActionKey(actionKey);
    copiedNoteActionTimerRef.current = window.setTimeout(() => {
      copiedNoteActionTimerRef.current = 0;
      setCopiedNoteActionKey((currentKey) => (currentKey === actionKey ? "" : currentKey));
    }, 1200);
  }

  function noteCopyButtonIcon(actionKey: string) {
    return copiedNoteActionKey === actionKey ? <CheckIcon /> : <NoteCopyIcon />;
  }

  async function copyTextContent(text: string, actionKey: string) {
    try {
      await writeTextToClipboard(text);
      markNoteCopySucceeded(actionKey);
      setStorageError("");
    } catch (error) {
      setStorageError(translatedError(error));
    }
  }

  function copyNoteContent(note: Pick<SelectionNote, "body">, actionKey: string) {
    return copyTextContent(note.body, actionKey);
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
    const nextDocumentModeStates = { ...documentModeStatesRef.current };
    documentIdSet.forEach((documentId) => {
      delete nextDirtyDocumentStates[documentId];
      delete nextDocumentModeStates[documentId];
    });
    let nextOpenDocumentTabIds = openDocumentTabIdsRef.current.filter(
      (documentId) => !documentIdSet.has(documentId),
    );

    if (documentIdSet.has(selectedDocumentIdRef.current)) {
      const nextSelectedDocument =
        nextOpenDocumentTabIds
          .map((documentId) => nextDocuments.find((document) => document.id === documentId))
          .find((document): document is MarkdownDocument => Boolean(document)) ??
        nextDocuments[0] ??
        null;
      const nextSelectedDocumentId = nextSelectedDocument?.id ?? "";

      if (
        nextSelectedDocumentId &&
        !nextOpenDocumentTabIds.includes(nextSelectedDocumentId)
      ) {
        nextOpenDocumentTabIds = [nextSelectedDocumentId];
      }

      setActiveDocumentId(nextSelectedDocumentId);
      if (nextSelectedDocument?.filePath) {
        rememberLastOpenedMarkdownPath(nextSelectedDocument.filePath);
      } else if (nextSelectedDocument && documentIsFromDropbox(nextSelectedDocument)) {
        rememberLastOpenedDropboxWorkspace(
          workspaceRootPath ??
            readLastOpenedDropboxWorkspace()?.workspacePath ??
            dropboxParentDirectoryPath(nextSelectedDocument.path),
          nextSelectedDocument.path,
        );
      } else {
        forgetLastOpenedMarkdownPath();
        forgetLastOpenedDropboxWorkspace();
      }
    }

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    glossaryTermsRef.current = nextGlossaryTerms;
    dirtyDocumentStatesRef.current = nextDirtyDocumentStates;
    documentModeStatesRef.current = nextDocumentModeStates;
    openDocumentTabIdsRef.current = nextOpenDocumentTabIds;

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
    setDocumentModeStates(nextDocumentModeStates);
    setOpenDocumentTabIds(nextOpenDocumentTabIds);
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
  }

  function openSettingsView(category: SettingCategory = "app") {
    setFileContextMenu(null);
    if (!createEntryDialog?.isSubmitting) {
      setCreateEntryDialog(null);
    }
    if (!duplicateFileDialog?.isSubmitting) {
      setDuplicateFileDialog(null);
    }
    if (!renameDialog?.isSubmitting) {
      setRenameDialog(null);
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
      setActiveDocumentModeState({
        noteModeEnabled: shouldEnableNoteMode,
        glossaryModeEnabled: false,
      });
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
      const status = await dropboxOAuthStatus();
      setDropboxConnected(status.connected);
      if (status.connected && isMobileViewport && !readLastOpenedDropboxWorkspace()) {
        setMobileStartupPhase("hidden");
      }
    } catch (error) {
      setDropboxConnected(false);
      setStorageError(translatedError(error, "dropbox.error.unexpected"));
    } finally {
      setDropboxConnectionChecked(true);
    }
  }

  function resetDropboxWorkspaceAfterAuthorizationRemoval() {
    forgetLastOpenedDropboxWorkspace();
    if (workspaceSource !== "dropbox") return;

    const draftState = currentDraftDocumentState();
    documentsRef.current = [...documentsSeed, ...draftState.documents];
    setDocuments(documentsRef.current);
    setNotes([...notesSeed, ...draftState.notes]);
    setGlossaryTerms(mergeGlossaryTerms(glossaryTermsSeed, draftState.glossaryTerms));
    setGlossaryBindings([...glossaryBindingsSeed, ...draftState.glossaryBindings]);
    setWorkspaceTitle("Scholium");
    setWorkspaceEntries(
      sortWorkspaceEntriesForDirectory(
        documentsSeed.map(workspaceEntryFromDocument),
        workspaceSortModeRef.current,
      ),
    );
    setWorkspaceRootPath(null);
    setWorkspaceSource(null);
    resetFileSearch();
    setExpandedDirectoryKeys(new Set());
    setLoadingDirectoryKeys(new Set());
    setSelectedWorkspaceDocumentIds(new Set());
    setActiveDocumentId(documentsSeed[0]?.id ?? "");
    resetDocumentTabs(documentsSeed[0]?.id ?? "");
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
    setSavedDocumentBodies({
      ...savedBodiesFromDocuments(documentsSeed),
      ...draftState.savedBodies,
    });
    forgetLastOpenedMarkdownPath();
    forgetLastOpenedMarkdownRootDirectoryPath();
  }

  function restoreMobileDataSourceAfterDropboxAuthFailure() {
    const shouldReturn = returnToMobileDataSourceAfterDropboxAuthRef.current;
    returnToMobileDataSourceAfterDropboxAuthRef.current = false;
    if (!shouldReturn) return;

    returnToMobileDataSourceOnPickerCancelRef.current = true;
    cancelMobileLocationPicker();
  }

  function transferMobileDataSourceReturnToDropboxPicker() {
    returnToMobileDataSourceOnPickerCancelRef.current =
      returnToMobileDataSourceAfterDropboxAuthRef.current;
    returnToMobileDataSourceAfterDropboxAuthRef.current = false;
  }

  async function connectDropbox(
    options: { pickerModeAfterAuth?: DropboxPickerMode } = {},
  ) {
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      returnToMobileDataSourceAfterDropboxAuthRef.current = false;
      cancelMobileLocationPicker();
      return;
    }

    if (!configuredDropboxAppKey) {
      dropboxPickerModeAfterAuthRef.current = null;
      pendingDropboxLocationAfterAuthRef.current = null;
      returnToMobileDataSourceAfterDropboxAuthRef.current = false;
      cancelMobileLocationPicker();
      setStorageError(t("dropbox.error.notConfigured"));
      return;
    }

    returnToMobileDataSourceAfterDropboxAuthRef.current =
      Boolean(options.pickerModeAfterAuth) &&
      returnToMobileDataSourceOnPickerCancelRef.current;
    completeMobileLocationPicker();
    dropboxPickerModeAfterAuthRef.current = options.pickerModeAfterAuth ?? null;
    setDropboxConnecting(true);
    setStorageError(t("dropbox.status.openingAuth"));

    try {
      const oauthStart = await startDropboxOAuth({
        appKey: configuredDropboxAppKey,
      });
      await openExternalUrl(oauthStart.authUrl);
    } catch (error) {
      setDropboxConnecting(false);
      dropboxPickerModeAfterAuthRef.current = null;
      pendingDropboxLocationAfterAuthRef.current = null;
      restoreMobileDataSourceAfterDropboxAuthFailure();
      setStorageError(translatedError(error, "dropbox.error.unexpected"));
    }
  }

  async function completeDropboxOAuth(payload: DropboxOAuthCallbackPayload) {
    if (payload.status !== "success" || !payload.code || !payload.state) {
      setDropboxConnecting(false);
      dropboxPickerModeAfterAuthRef.current = null;
      pendingDropboxLocationAfterAuthRef.current = null;
      restoreMobileDataSourceAfterDropboxAuthFailure();
      console.error(payload.error ?? "Dropbox OAuth callback failed");
      setStorageError(t("dropbox.error.oauthCallback"));
      return;
    }

    setStorageError(t("dropbox.status.completingAuth"));

    let completionTimeoutId = 0;

    try {
      const completionRequest = requestDropboxOAuthCompletion({
        code: payload.code,
        state: payload.state,
      });
      const completionTimeout = new Promise<DropboxOAuthStatusResult>((_resolve, reject) => {
        completionTimeoutId = window.setTimeout(() => {
          reject(new Error("Dropbox OAuth completion timed out"));
        }, dropboxOAuthCompletionTimeoutMs);
      });
      const status = await Promise.race([completionRequest, completionTimeout]);
      setDropboxConnected(status.connected);
      setDropboxConnecting(false);
      const pendingLocation = pendingDropboxLocationAfterAuthRef.current;
      pendingDropboxLocationAfterAuthRef.current = null;
      const pickerModeAfterAuth = dropboxPickerModeAfterAuthRef.current;
      dropboxPickerModeAfterAuthRef.current = null;
      if (pendingLocation) {
        returnToMobileDataSourceAfterDropboxAuthRef.current = false;
        await openDropboxLocation(pendingLocation, { allowPendingConnection: status.connected });
      } else if (pickerModeAfterAuth) {
        transferMobileDataSourceReturnToDropboxPicker();
        await openDropboxCloudSource({
          allowPendingConnection: status.connected,
          pickerMode: pickerModeAfterAuth,
        });
      } else {
        returnToMobileDataSourceAfterDropboxAuthRef.current = false;
        setStorageError("");
      }
      if (status.connected && isMobileViewport) {
        setMobileStartupPhase("hidden");
      }
    } catch (error) {
      setDropboxConnecting(false);
      setDropboxConnected(false);
      dropboxPickerModeAfterAuthRef.current = null;
      pendingDropboxLocationAfterAuthRef.current = null;
      restoreMobileDataSourceAfterDropboxAuthFailure();
      setStorageError(translatedError(error, "dropbox.error.oauthCallback"));
    } finally {
      window.clearTimeout(completionTimeoutId);
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
      const status = await disconnectDropbox();
      setDropboxConnected(status.connected);
      completeMobileLocationPicker();
      invalidateDropboxDirectoryPickerSession();
      setDropboxDirectoryPicker(null);
      dropboxPickerModeAfterAuthRef.current = null;
      pendingDropboxLocationAfterAuthRef.current = null;
      returnToMobileDataSourceAfterDropboxAuthRef.current = false;
      resetDropboxWorkspaceAfterAuthorizationRemoval();
      forgetLastOpenedDropboxWorkspace();
      setStorageError(t("dropbox.status.authorizationRemoved"));
    } catch (error) {
      setStorageError(translatedError(error, "dropbox.error.unexpected"));
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
      kind: "file",
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

        const loaded = await duplicateDropboxMarkdownFile({
          path: dropboxPath,
          fileName: targetFileName,
        });
        applyLoadedDropboxFile(loaded);
        setStorageError("");
        return true;
      }

      if (!documentToDuplicate?.filePath) {
        setStorageError(t("error.notBackedByMarkdownFile"));
        return false;
      }

      const loaded = await duplicateMarkdownFile({
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
        setStorageError(translatedError(error));
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
              await openDropboxMarkdownFile({
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
      setStorageError(translatedError(error));
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
        kind: "file",
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

      await deleteDropboxMarkdownFile({
        path: dropboxPath,
      });
      return;
    }

    const localPath = target.document?.filePath ?? target.path;
    if (!localPath) {
      throw new Error(t("error.notBackedByMarkdownFile"));
    }

    await deleteMarkdownFile({
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
      setStorageError(translatedError(error));
    }
  }

  async function deleteWorkspaceDirectory(target: DirectoryActionTarget) {
    setFileContextMenu(null);
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeDeleteDirectory"));
      return;
    }
    if (!workspaceRootPath) {
      setStorageError(t("error.operationFailed"));
      return;
    }

    const source = target.source ?? workspaceSource ?? "local";
    const confirmed = window.confirm(
      t(source === "dropbox" ? "confirm.deleteDropboxDirectory" : "confirm.deleteDirectory", {
        title: target.title,
      }),
    );
    if (!confirmed) return;

    setStorageError(t("status.deletingDirectory"));
    try {
      if (source === "dropbox") {
        await deleteDropboxMarkdownDirectory({
          path: target.path,
          rootPath: workspaceRootPath,
        });
      } else {
        await deleteMarkdownDirectory({
          path: target.path,
          rootPath: workspaceRootPath,
        });
      }

      const deletedDocumentIds = new Set(
        documentsRef.current
          .filter((document) => {
            const documentSource = documentIsFromDropbox(document) ? "dropbox" : "local";
            const documentPath = documentSource === "dropbox" ? document.path : document.filePath;
            return (
              documentSource === source &&
              Boolean(documentPath) &&
              workspacePathIsInsideDirectory(documentPath ?? "", target.path, source)
            );
          })
          .map((document) => document.id),
      );
      workspaceEntriesRef.current.forEach((entry) => {
        if (
          entry.kind === "file" &&
          entry.source === source &&
          workspacePathIsInsideDirectory(entry.path, target.path, source)
        ) {
          deletedDocumentIds.add(entry.documentId);
        }
      });

      removeDocumentsFromWorkspace(deletedDocumentIds);
      const deletedDirectoryKeys = new Set(
        workspaceEntriesRef.current
          .filter(
            (entry) =>
              entry.kind === "directory" &&
              entry.source === source &&
              workspacePathIsInsideDirectory(entry.path, target.path, source),
          )
          .map(directoryTreeKey),
      );
      const nextWorkspaceEntries = workspaceEntriesRef.current.filter(
        (entry) =>
          entry.source !== source ||
          !workspacePathIsInsideDirectory(entry.path, target.path, source),
      );
      workspaceEntriesRef.current = nextWorkspaceEntries;
      setWorkspaceEntries(nextWorkspaceEntries);
      setExpandedDirectoryKeys(
        (currentKeys) => new Set([...currentKeys].filter((key) => !deletedDirectoryKeys.has(key))),
      );
      setLoadingDirectoryKeys(
        (currentKeys) => new Set([...currentKeys].filter((key) => !deletedDirectoryKeys.has(key))),
      );
      setDropboxIndexedDocumentTags((currentEntries) =>
        currentEntries.filter((entry) => !deletedDocumentIds.has(entry.documentId)),
      );
      setStorageError("");
    } catch (error) {
      setStorageError(translatedError(error));
    }
  }

  function renamedPath(path: string, oldPath: string, newPath: string, source?: WorkspaceSource) {
    if (source === "dropbox") {
      if (path === oldPath) return newPath;
      const prefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
      return path.startsWith(prefix) ? `${newPath}${path.slice(oldPath.length)}` : path;
    }

    if (localPathsMatch(path, oldPath)) return newPath;
    if (localPathIsInsideDirectory(path, oldPath)) {
      return `${newPath}${normalizeLocalPathForCompare(path).slice(normalizeLocalPathForCompare(oldPath).length)}`;
    }
    return path;
  }

  function updateWorkspaceAfterRename(
    target: WorkspaceActionTarget,
    renamed: RenamePathResult | OpenMarkdownFileResult | OpenDropboxMarkdownFileResult,
  ) {
    const oldPath = target.path;
    const newPath = renamed.path;
    const source = target.source;
    const renamedDocumentId = (documentId: string) => {
      const documentPath =
        source === "dropbox" && isDropboxDocumentId(documentId)
          ? documentId.slice(dropboxDocumentIdPrefix.length)
          : documentId;
      const nextPath = renamedPath(documentPath, oldPath, newPath, source);
      if (nextPath === documentPath) return documentId;

      return source === "dropbox" ? dropboxDocumentId(nextPath) : nextPath;
    };

    setWorkspaceEntries((currentEntries) => {
      const nextEntries = sortWorkspaceEntriesForDirectory(
        currentEntries.map((entry) => {
          const nextPath = renamedPath(entry.path, oldPath, newPath, source);
          if (nextPath === entry.path) return entry;

          if (entry.kind === "file") {
            const nextDocumentId =
              entry.source === "dropbox" ? dropboxDocumentId(nextPath) : nextPath;
            return {
              ...entry,
              id: `${entry.source === "dropbox" ? "dropbox-file" : "file"}:${nextPath}`,
              path: nextPath,
              title: nextPath === newPath ? renamed.title : entry.title,
              documentId: nextDocumentId,
              modifiedAt: nextPath === newPath && "modifiedAt" in renamed ? renamed.modifiedAt ?? null : entry.modifiedAt,
            };
          }

          return {
            ...entry,
            id: `${entry.source === "dropbox" ? "dropbox-directory" : "directory"}:${nextPath || "/"}`,
            path: nextPath,
            title: nextPath === newPath ? renamed.title : entry.title,
          };
        }),
        workspaceSortModeRef.current,
      );
      workspaceEntriesRef.current = nextEntries;
      return nextEntries;
    });

    setDocuments((currentDocuments) => {
      const nextDocuments = currentDocuments.map((document) => {
        const documentPath = source === "dropbox" ? document.path : document.filePath;
        const nextPath = renamedPath(documentPath ?? "", oldPath, newPath, source);
        if (!nextPath || nextPath === documentPath) return document;

        const nextDocumentId = source === "dropbox" ? dropboxDocumentId(nextPath) : nextPath;
        return {
          ...document,
          id: nextDocumentId,
          path: nextPath,
          filePath: source === "dropbox" ? null : nextPath,
          title: nextPath === newPath ? renamed.title : document.title,
          notesPath:
            nextPath === newPath && "notesPath" in renamed
              ? renamed.notesPath ?? document.notesPath
              : document.notesPath,
          modifiedAt: nextPath === newPath && "modifiedAt" in renamed ? renamed.modifiedAt ?? null : document.modifiedAt,
          dropboxRev: nextPath === newPath && "rev" in renamed ? renamed.rev ?? null : document.dropboxRev,
        };
      });
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });

    setNotes((currentNotes) =>
      currentNotes.map((note) => ({ ...note, documentId: renamedDocumentId(note.documentId) })),
    );
    setGlossaryBindings((currentBindings) =>
      currentBindings.map((binding) => ({
        ...binding,
        documentId: renamedDocumentId(binding.documentId),
      })),
    );
    setOpenDocumentTabIds((currentIds) =>
      currentIds.map((documentId) => renamedDocumentId(documentId)),
    );
    setSelectedDocumentId((currentDocumentId) =>
      renamedDocumentId(currentDocumentId),
    );
    selectedDocumentIdRef.current = renamedDocumentId(selectedDocumentIdRef.current);
    setDirtyDocumentStates((currentStates) => {
      const nextStates: typeof currentStates = {};
      for (const [documentId, state] of Object.entries(currentStates)) {
        nextStates[renamedDocumentId(documentId)] = state;
      }
      dirtyDocumentStatesRef.current = nextStates;
      return nextStates;
    });
    setDocumentModeStates((currentStates) => {
      const nextStates: typeof currentStates = {};
      for (const [documentId, state] of Object.entries(currentStates)) {
        nextStates[renamedDocumentId(documentId)] = state;
      }
      documentModeStatesRef.current = nextStates;
      return nextStates;
    });
    setSavedDocumentBodies((currentBodies) => {
      const nextBodies: typeof currentBodies = {};
      for (const [documentId, body] of Object.entries(currentBodies)) {
        nextBodies[renamedDocumentId(documentId)] = body;
      }
      return nextBodies;
    });

    if (workspaceRootPath && localPathsMatch(workspaceRootPath, oldPath)) {
      setWorkspaceRootPath(newPath);
    }
  }

  function openRenameDialog(target: FileContextMenuState) {
    setFileContextMenu(null);
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }
    if (autosaveInFlightRef.current) {
      setStorageError(t("error.waitForAutosaveBeforeRename"));
      return;
    }

    setStorageError("");
    setRenameDialog({
      ...target,
      name: target.kind === "file" ? stripMarkdownExtension(target.title) : target.title,
      isSubmitting: false,
    });
  }

  async function performRenameWorkspaceEntry(target: WorkspaceActionTarget, nextName: string) {
    if (!nextName.trim()) {
      setStorageError(t("error.renameNameRequired"));
      return false;
    }

    setStorageError(t("status.renaming"));
    try {
      const renameEntry =
        target.source === "dropbox"
          ? target.kind === "directory"
            ? renameDropboxMarkdownDirectory
            : renameDropboxMarkdownFile
          : target.kind === "directory"
            ? renameMarkdownDirectory
            : renameMarkdownFile;
      const renamed = await renameEntry({
        path: target.path,
        name: nextName,
      });

      updateWorkspaceAfterRename(target, renamed);
      setStorageError("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "rename target already exists") {
        setStorageError(t("error.renameExists"));
      } else if (message === "rename name must not include folders") {
        setStorageError(t("error.renameNameNoFolders"));
      } else if (message === "rename name is empty") {
        setStorageError(t("error.renameNameRequired"));
      } else {
        setStorageError(translatedError(error));
      }
      return false;
    }
  }

  async function submitRenameWorkspaceEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameDialog || renameDialog.isSubmitting) return;

    setRenameDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: true } : currentDialog,
    );

    const renamed = await performRenameWorkspaceEntry(renameDialog, renameDialog.name);
    if (renamed) {
      setRenameDialog(null);
      return;
    }

    setRenameDialog((currentDialog) =>
      currentDialog ? { ...currentDialog, isSubmitting: false } : currentDialog,
    );
  }

  function closeRenameDialog() {
    if (renameDialog?.isSubmitting) return;

    setRenameDialog(null);
    setStorageError("");
  }

  function updateSelectedDocumentTags(nextTags: string[]) {
    if (!hasOpenDocument) return false;

    if (markdownHasMalformedFrontmatter(selectedDocument.body)) {
      setStorageError(t("tags.error.invalidFrontmatter"));
      return false;
    }

    const nextBody = writeMarkdownTags(selectedDocument.body, nextTags);
    if (nextBody === selectedDocument.body) return false;

    updateSelectedDocumentBody(nextBody, "user");
    setStorageError("");
    return true;
  }

  function addSelectedDocumentTag(tag: string) {
    const nextTag = normalizeTagInput(tag);
    if (!nextTag) return false;

    const existingTagKeys = new Set(selectedDocumentTags.map(tagDedupeKey));
    setTagDraft("");
    if (existingTagKeys.has(tagDedupeKey(nextTag))) return false;

    const added = updateSelectedDocumentTags([...selectedDocumentTags, nextTag]);
    if (added) {
      setDocumentTagsExpanded(true);
    }
    return added;
  }

  function closeMobileTagPicker() {
    tagInputRef.current?.blur();
    setTagDraft("");
    setMobileTagPickerOpen(false);
  }

  function selectMobileDocumentTag(tag: string) {
    if (addSelectedDocumentTag(tag)) {
      closeMobileTagPicker();
    }
  }

  function submitSelectedDocumentTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addSelectedDocumentTag(tagDraft) && isMobileViewport) {
      closeMobileTagPicker();
    }
  }

  function submitMobileTagPicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existingTag = documentTagSuggestionGroups.find(
      (group) => group.key === normalizedTagDraftKey,
    );
    selectMobileDocumentTag(existingTag?.label ?? tagDraft);
  }

  function handleTagSuggestionKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLButtonElement>,
  ) {
    if (event.key === "Escape") {
      tagInputRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const mobilePicker = event.currentTarget.closest(".mobile-tag-picker-sheet");
    const suggestionRoot = mobilePicker ?? event.currentTarget.form;
    const suggestionSelector = mobilePicker
      ? ".mobile-tag-picker-result:not(:disabled), .mobile-tag-picker-create"
      : ".document-tags__suggestion:not(:disabled)";
    const suggestions = Array.from(
      suggestionRoot?.querySelectorAll<HTMLButtonElement>(suggestionSelector) ?? [],
    );
    if (suggestions.length === 0) return;

    event.preventDefault();
    const currentIndex = suggestions.indexOf(event.currentTarget as HTMLButtonElement);
    const nextIndex =
      currentIndex < 0
        ? event.key === "ArrowDown"
          ? 0
          : suggestions.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
          suggestions.length;
    suggestions[nextIndex]?.focus();
  }

  function removeSelectedDocumentTag(tagToRemove: string) {
    const removedTagKey = tagDedupeKey(tagToRemove);
    updateSelectedDocumentTags(
      selectedDocumentTags.filter((tag) => tagDedupeKey(tag) !== removedTagKey),
    );
  }

  function showFileSearchMode(mode: FileSearchMode) {
    setFileSearchMode(mode);
    setExactTagSearchKey("");
    setLocalFileSearchResults([]);
    setFileSearchError("");
  }

  function openTagSearch(tag: string) {
    if (noteLibraryOpen) {
      closeNoteLibrary({ restoreDirectoryPane: false });
    }
    setFileSearchMode("tags");
    setFileSearchQuery(tag);
    setExactTagSearchKey(tagDedupeKey(tag));
    setLocalFileSearchResults([]);
    setFileSearchError("");
    setMobileSelectedWorkspaceEntryKey("");
    setDirectoryPaneOpen(true);
  }

  function updateSelectedDocumentBody(
    body: string,
    source: EditorChangeSource,
    anchorTransform?: BodyAnchorTransform,
  ) {
    if (noteEditModalActiveRef.current) return;
    const documentId = selectedDocumentIdRef.current;
    const currentDocument = documentsRef.current.find((document) => document.id === documentId);
    if (!currentDocument || body === currentDocument.body) return;

    const previousBody = currentDocument.body;
    const bodyAnchorTransform: BodyAnchorTransform =
      anchorTransform ??
      ((anchor, nextBody) => transformAnchorWithBodyChange(anchor, previousBody, nextBody));
    const savedBody = savedDocumentBodiesRef.current[documentId] ?? currentDocument.body;
    const nextDocuments = documentsRef.current.map((document) =>
      document.id === documentId ? { ...document, body } : document,
    );
    const nextNotes = notesRef.current.map((note) =>
      note.documentId === documentId && note.status === "active"
        ? {
            ...note,
            anchor: bodyAnchorTransform(note.anchor, body),
          }
        : note,
    );
    const nextGlossaryBindings = glossaryBindingsRef.current.map((binding) =>
      binding.documentId === documentId && binding.status === "active"
        ? {
            ...binding,
            anchor: bodyAnchorTransform(binding.anchor, body),
          }
        : binding,
    );

    documentsRef.current = nextDocuments;
    notesRef.current = nextNotes;
    glossaryBindingsRef.current = nextGlossaryBindings;
    setDocuments(nextDocuments);
    setNotes(nextNotes);
    setGlossaryBindings(nextGlossaryBindings);
    markDocumentBodyDirty(documentId, !(source === "undo" && body === savedBody));
  }

  function selectDocument(
    documentId: string,
    options: { tabBehavior?: DocumentTabBehavior; userInitiated?: boolean } = {},
  ) {
    if (options.userInitiated !== false) {
      manualDocumentSelectionRevisionRef.current += 1;
    }

    const currentDocumentId = selectedDocumentIdRef.current;
    if (
      isMobileViewport &&
      options.userInitiated !== false &&
      currentDocumentId &&
      currentDocumentId !== documentId &&
      isDraftDocumentId(currentDocumentId)
    ) {
      // Mobile shows one document at a time, so leaving an unnamed file asks about it first.
      void prepareDraftDocumentForLeaving(currentDocumentId).then((result) => {
        if (result.status === "blocked") return;
        selectDocument(documentId, { ...options, userInitiated: false });
      });
      return;
    }

    const nextDocument = documentsRef.current.find((document) => document.id === documentId);
    if (!nextDocument) return;

    window.getSelection()?.removeAllRanges();
    discardTransientEmptySelectionNote();
    discardTransientEmptyGlossary();
    applyDocumentTabBehavior(documentId, options.tabBehavior ?? "replace");
    setSelectedWorkspaceDocumentIds(new Set());
    setActiveDocumentId(documentId);
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
    if (isDraftDocumentId(nextDocument.id)) {
      return;
    }

    if (documentIsFromDropbox(nextDocument)) {
      rememberLastOpenedDropboxWorkspace(
        workspaceRootPath ??
          readLastOpenedDropboxWorkspace()?.workspacePath ??
          dropboxParentDirectoryPath(nextDocument.path),
        nextDocument.path,
      );
    } else {
      rememberLastOpenedMarkdownPath(nextDocument.filePath);
    }
  }

  async function openMarkdownLink(href: string) {
    const sourceDocument = documentsRef.current.find(
      (document) => document.id === selectedDocumentIdRef.current,
    );
    if (!sourceDocument) return;

    const source = documentIsFromDropbox(sourceDocument) ? "dropbox" : "local";
    const target = resolveMarkdownLinkTarget(
      href,
      sourceDocument.filePath ?? sourceDocument.path,
      source,
    );

    if (target.kind === "external") {
      try {
        await openExternalUrl(target.href);
        setStorageError("");
      } catch (error) {
        setStorageError(translatedError(error));
      }
      return;
    }
    if (target.kind !== "document") return;

    if (!/\.(md|markdown|mdown)$/i.test(target.path)) {
      try {
        await openLinkedFile({ path: target.path, source });
        setStorageError("");
      } catch (error) {
        setStorageError(translatedError(error, "error.openFileFailed"));
      }
      return;
    }

    const loadedDocument = documentsRef.current.find((document) =>
      source === "dropbox"
        ? documentIsFromDropbox(document) && document.path === target.path
        : !documentIsFromDropbox(document) && localPathsMatch(document.filePath, target.path),
    );
    if (loadedDocument) {
      selectDocument(loadedDocument.id);
      return;
    }

    if (source === "dropbox") {
      await openDropboxMarkdownFilePath(target.path);
      return;
    }
    if (!nativeStorageAvailable) {
      setStorageError(t("error.nativeRuntimeRequired"));
      return;
    }

    setStorageError(t("status.openingFile"));
    try {
      const loaded = await openMarkdownFile({
        path: target.path,
      });
      mergeLoadedFilesIntoDocumentState([loaded]);
      selectDocument(loaded.path);
      rememberLastOpenedMarkdownPath(loaded.path);
      setStorageError("");
    } catch (error) {
      setStorageError(translatedError(error, "error.openFileFailed"));
    }
  }

  function handleDocumentTabPointerDown(
    documentId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") return;

    const visibleDocumentId = documentTabIdAtPoint(
      Array.from(
        documentTabsScrollerRef.current?.querySelectorAll<HTMLElement>(
          ".document-tab[data-document-id]",
        ) ?? [],
      ).map((tab) => {
        const bounds = tab.getBoundingClientRect();
        return {
          documentId: tab.dataset.documentId ?? "",
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      }),
      event.clientX,
      event.clientY,
      documentId,
    );

    documentTabPointerActivationRef.current = visibleDocumentId;
    window.getSelection()?.removeAllRanges();
    selectDocument(visibleDocumentId, { tabBehavior: "none" });
  }

  function showDocumentTabContextMenu(documentId: string, left: number, top: number) {
    setFileContextMenu(null);
    setDocumentTabContextMenu({ documentId, left, top });
  }

  function openDocumentTabContextMenu(
    documentId: string,
    event: MouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    cancelDocumentTabLongPress();
    showDocumentTabContextMenu(documentId, event.clientX, event.clientY);
  }

  function cancelDocumentTabLongPress() {
    window.clearTimeout(documentTabLongPressTimerRef.current);
    documentTabLongPressTimerRef.current = 0;
  }

  function handleDocumentTabTouchStart(
    documentId: string,
    event: ReactTouchEvent<HTMLButtonElement>,
  ) {
    if (event.touches.length !== 1) {
      cancelDocumentTabLongPress();
      documentTabTouchStateRef.current = null;
      return;
    }

    const touch = event.touches[0];
    const touchState = {
      documentId,
      longPressTriggered: false,
      moved: false,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    documentTabTouchStateRef.current = touchState;
    cancelDocumentTabLongPress();
    documentTabLongPressTimerRef.current = window.setTimeout(() => {
      if (documentTabTouchStateRef.current !== touchState || touchState.moved) return;

      touchState.longPressTriggered = true;
      suppressedDocumentTabClickRef.current = {
        documentId,
        until: Date.now() + 1000,
      };
      showDocumentTabContextMenu(documentId, touchState.startX, touchState.startY);
    }, mobileContextMenuLongPressMs);
  }

  function handleDocumentTabTouchMove(
    documentId: string,
    event: ReactTouchEvent<HTMLButtonElement>,
  ) {
    const touchState = documentTabTouchStateRef.current;
    if (!touchState || touchState.documentId !== documentId || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchState.startX);
    const deltaY = Math.abs(touch.clientY - touchState.startY);

    if (
      deltaX > mobileContextMenuLongPressMoveTolerancePx ||
      deltaY > mobileContextMenuLongPressMoveTolerancePx
    ) {
      touchState.moved = true;
      cancelDocumentTabLongPress();
    }
  }

  function handleDocumentTabTouchEnd(
    documentId: string,
    event: ReactTouchEvent<HTMLButtonElement>,
  ) {
    const touchState = documentTabTouchStateRef.current;
    cancelDocumentTabLongPress();
    documentTabTouchStateRef.current = null;

    if (!touchState || touchState.documentId !== documentId || touchState.moved) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    if (touchState.longPressTriggered) return;

    documentTabPointerActivationRef.current = documentId;
    window.getSelection()?.removeAllRanges();
    selectDocument(documentId, { tabBehavior: "none" });
  }

  function handleDocumentTabTouchCancel() {
    cancelDocumentTabLongPress();
    documentTabTouchStateRef.current = null;
  }

  function handleDocumentTabClick(
    documentId: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    const suppressedClick = suppressedDocumentTabClickRef.current;
    if (suppressedClick?.documentId === documentId && Date.now() < suppressedClick.until) {
      suppressedDocumentTabClickRef.current = null;
      return;
    }

    const clickSelection = documentTabClickSelection(
      documentTabPointerActivationRef.current,
      documentId,
      event.detail > 0,
    );
    documentTabPointerActivationRef.current = "";
    if (clickSelection.shouldSelect) {
      selectDocument(clickSelection.documentId, { tabBehavior: "none" });
    }
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

    transientSelectionNoteIdRef.current = "";
    window.setTimeout(() => {
      notesRef.current = notesRef.current.filter((candidate) => candidate.id !== noteId);
      setNotes((currentNotes) => currentNotes.filter((candidate) => candidate.id !== noteId));
      markDocumentNotesDirty(note.documentId);
    }, 0);
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

    transientGlossaryBindingIdRef.current = "";
    transientGlossaryTermIdRef.current = "";

    window.setTimeout(() => {
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
      markDocumentNotesDirty(binding?.documentId ?? selectedDocument.id);
    }, 0);
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
    noteEditorShouldRefocusRef.current = false;
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

  function flushActiveNoteMarkdownEditor() {
    const editableElement = noteEditorRootRef.current?.querySelector<HTMLElement>(
      ".note-markdown-editor__textarea, .markdown-preview[contenteditable='true']",
    );
    if (!editableElement || document.activeElement !== editableElement) return;

    editableElement.blur();
  }

  function closeNotePanel() {
    flushActiveNoteMarkdownEditor();
    clearNotePanelCloseTimer();
    clearReturnToViewTimer();
    resetNoteTextareaCompositionState();
    setSelectionWarningPosition(null);
    setNotePanelExpanded(false);
    setActiveNoteEditorKey("");
    noteEditorShouldRefocusRef.current = false;

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

  function handleNoteEditorCompositionStart(event: CompositionEvent<HTMLElement>) {
    noteEditorIsComposingRef.current = true;
    noteEditorEnterIgnoredDuringCompositionRef.current = false;
    noteEditorPostCompositionGuardUntilRef.current = 0;
    const shell = event.currentTarget.closest(".milkdown-markdown-editor-shell");
    if (shell) shell.classList.add("is-composing");
  }

  function handleNoteEditorCompositionEnd(event: CompositionEvent<HTMLElement>) {
    const hadEnterDuringComposition = noteEditorEnterIgnoredDuringCompositionRef.current;
    noteEditorIsComposingRef.current = false;
    noteEditorEnterIgnoredDuringCompositionRef.current = false;
    noteEditorPostCompositionGuardUntilRef.current = Date.now() + (hadEnterDuringComposition ? 500 : 180);
    const shell = event.currentTarget.closest(".milkdown-markdown-editor-shell");
    if (shell) shell.classList.remove("is-composing");
  }

  function handleNoteEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && keyboardEventIsComposing(event)) {
      noteEditorEnterIgnoredDuringCompositionRef.current = true;
      return;
    }

    if (event.key === "Enter" && event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && Date.now() < noteEditorPostCompositionGuardUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
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

    if (event.key === "Enter" && keyboardEventIsComposing(event)) {
      noteEditorEnterIgnoredDuringCompositionRef.current = true;
      return;
    }

    if (event.key === "Enter" && event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && Date.now() < noteEditorPostCompositionGuardUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
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

    if (mobileAnnotationKeyboardShouldStayClosed && !pendingGlossaryTerm) {
      const glossaryAnchor = glossaryModeActive
        ? normalizeGlossarySelectionAnchor(anchor)
        : null;
      const selectionAnchor = glossaryAnchor ?? anchor;

      if (glossaryModeActive && !isGlossarySelectionCandidate(selectionAnchor)) {
        return;
      }

      if (selectionShouldSuppressNewAnnotation(selectionAnchor)) {
        return;
      }

      if (glossaryModeActive) {
        startGlossaryFlowForAnchor(selectionAnchor);
        return;
      }

      confirmSelectionNoteForAnchor(anchor);
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
    if (glossaryModeActive) {
      return selectionOverlapsActiveGlossary(anchor);
    }

    return selectionOverlapsActiveNote(anchor);
  }

  function selectionShouldSuppressNewAnnotation(anchor: TextSelectionAnchor) {
    if (mobileAnnotationKeyboardShouldStayClosed && !glossaryModeActive) {
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
    const noteIsEmpty = !selectionNoteHasContent(note);
    noteEditorShouldRefocusRef.current =
      noteIsEmpty && !mobileAnnotationKeyboardShouldStayClosed;
    setActiveNoteEditorKey(noteIsEmpty ? noteEditorKey("floating", note.id) : "");
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
    noteEditorShouldRefocusRef.current =
      !termHasContent && !mobileAnnotationKeyboardShouldStayClosed;
    notePanelHasContentRef.current = true;
    return true;
  }

  function openExistingAnnotationForSelection(anchor: TextSelectionAnchor) {
    if (glossaryModeActive) {
      const overlappingGlossaryBinding = activeGlossaryBindingOverlappingSelection(anchor);
      if (overlappingGlossaryBinding) {
        return openGlossaryBindingPanel(overlappingGlossaryBinding);
      }

      return false;
    }

    const overlappingNote = activeNoteOverlappingSelection(anchor);
    if (overlappingNote) {
      openSelectionNoteViewer(overlappingNote);
      return true;
    }

    return false;
  }

  function handleSelectionEnter(
    anchor: TextSelectionAnchor,
    context?: TextSelectionEnterContext,
  ) {
    const contextAnchorRect = textRangeRectFromSelectionEnterContext(context);
    const glossaryAnchor = glossaryModeActive
      ? normalizeGlossarySelectionAnchor(anchor)
      : null;
    const selectionAnchor = glossaryAnchor ?? anchor;

    if (!hasOpenDocument) return false;
    if (
      settingsViewOpen ||
      createEntryDialog ||
      duplicateFileDialog ||
      dropboxDirectoryPicker ||
      notePanelModalActive ||
      noteEditModalActive
    ) {
      return false;
    }
    if (!noteModeEnabled) return false;
    if (glossaryModeActive && !isGlossarySelectionCandidate(selectionAnchor)) {
      return false;
    }

    if (selectionShouldSuppressNewAnnotation(selectionAnchor)) {
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      if (contextAnchorRect) {
        floatingNoteAnchorRectRef.current = contextAnchorRect;
      }
      openExistingAnnotationForSelection(selectionAnchor);
      return true;
    }

    if (glossaryModeActive) {
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      startGlossaryFlowForAnchor(selectionAnchor, { anchorRect: contextAnchorRect });
      return true;
    }

    if (isSelectionCompleteMarkdownBlock(selectedDocument.body, anchor)) {
      if (noteLibraryOpen) {
        setNoteLibraryOpen(false);
      }
      createSelectionNoteForAnchor(anchor, {
        anchorRect: contextAnchorRect,
        startEditing: true,
      });
      return true;
    }

    if (noteLibraryOpen) {
      setNoteLibraryOpen(false);
    }

    createSelectionNoteForAnchor(anchor, {
      anchorRect: contextAnchorRect,
      startEditing: true,
    });
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
    alignFocusedAnnotationToViewport(annotationId, "smooth");
  }

  function focusAdjacentFloatingAnnotation(direction: -1 | 1) {
    if (activeNoteId) {
      const navigationNotes = noteLibraryNotes.filter((note) => activeNoteAnchorRect(note.id));
      const currentIndex = navigationNotes.findIndex((note) => note.id === activeNoteId);
      const nextIndex = wrappedNavigationIndex(
        currentIndex,
        navigationNotes.length,
        direction,
      );
      const nextNoteId = nextIndex >= 0 ? navigationNotes[nextIndex]?.id : "";
      if (!nextNoteId) return false;

      scrollTextAnnotationIntoView(nextNoteId);
      showNoteViewer(nextNoteId);
      return true;
    }

    if (activeGlossaryBindingId) {
      const navigationBindings = glossaryNavigationBindings.filter((binding) =>
        activeGlossaryAnchorRect(binding.id),
      );
      const currentIndex = navigationBindings.findIndex(
        (binding) => binding.id === activeGlossaryBindingId,
      );
      const nextIndex = wrappedNavigationIndex(
        currentIndex,
        navigationBindings.length,
        direction,
      );
      const nextBindingId =
        nextIndex >= 0 ? navigationBindings[nextIndex]?.id : "";
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

  function startGlossaryFlowForAnchor(
    anchor: TextSelectionAnchor,
    options: { anchorRect?: TextRangeRect | null } = {},
  ) {
    if (!glossaryModeActive) return;
    const selectionAnchor = normalizeGlossarySelectionAnchor(anchor);
    if (!selectionAnchor || !isGlossarySelectionCandidate(selectionAnchor)) return;

    discardTransientEmptySelectionNote();
    setSelectionWarningPosition(null);
    const anchorRect =
      options.anchorRect ??
      currentSelectionAnchorRect() ??
      activeNoteAnchorRect(pendingAnchorAnnotationId) ??
      floatingNoteAnchorRectRef.current ??
      lastPointerAnchorRectRef.current;
    if (anchorRect) {
      floatingNoteAnchorRectRef.current = anchorRect;
    }

    const existingTerm = glossaryTermForAnchor(selectionAnchor);
    if (existingTerm) {
      clearNotePanelCloseTimer();
      clearReturnToViewTimer();
      setIsNotePanelClosing(false);
      setPendingAnchor(selectionAnchor);
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
    const termText = selectionAnchor.selectedText.replace(/\s+/g, " ").trim();
    const term: GlossaryTerm = {
      id: crypto.randomUUID(),
      term: termText,
      normalizedTerm: normalizeGlossaryTerm(termText),
      definition: "",
      createdAt: now,
      updatedAt: now,
    };

    setGlossaryTerms((currentTerms) => [term, ...currentTerms]);
    const binding = createGlossaryBinding(term, selectionAnchor);
    transientGlossaryBindingIdRef.current = binding.id;
    transientGlossaryTermIdRef.current = term.id;
    setPendingAnchor(null);
    setPendingGlossaryTerm(null);
    setActiveNoteId("");
    setActiveGlossaryBindingId(binding.id);
    setActiveGlossaryTermId(term.id);
    setActiveGlossaryMode("edit");
    setGlossaryDraft("");
    noteEditorShouldRefocusRef.current = !mobileAnnotationKeyboardShouldStayClosed;
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

  function confirmSelectionNoteForAnchor(
    anchor: TextSelectionAnchor,
    options: { anchorRect?: TextRangeRect | null } = {},
  ) {
    if (!noteModeEnabled) return;

    createSelectionNoteForAnchor(anchor, {
      anchorRect: options.anchorRect,
      startEditing: true,
    });
  }

  function createSelectionNoteForAnchor(
    anchor: TextSelectionAnchor,
    options: { anchorRect?: TextRangeRect | null; startEditing?: boolean } = {},
  ) {
    const { startEditing = false } = options;
    const anchorRect =
      options.anchorRect ?? currentSelectionAnchorRect() ?? activeNoteAnchorRect(pendingAnchorAnnotationId);
    if (!hasRenderableAnchor(anchor) || !anchorRect) return;

    discardTransientEmptySelectionNote();
    setSelectionWarningPosition(null);
    floatingNoteAnchorRectRef.current = anchorRect;

    const note: SelectionNote = {
      id: crypto.randomUUID(),
      documentId: selectedDocument.id,
      status: "active",
      selectedText: anchor.selectedText,
      anchor,
      tone: toneForNewSelectionNote(anchor),
      body: "",
      createdAt: nowLabel(),
      updatedAt: nowLabel(),
      deletedAt: null,
    };

    updateNotesState((currentNotes) => [note, ...currentNotes]);
    transientSelectionNoteIdRef.current = note.id;
    noteEditorShouldRefocusRef.current =
      startEditing && !mobileAnnotationKeyboardShouldStayClosed;
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
    }

    setActiveDocumentModeState({
      editorMode: nextNoteModeEnabled ? "preview" : editorModeRef.current,
      noteModeEnabled: nextNoteModeEnabled,
      glossaryModeEnabled: nextNoteModeEnabled ? glossaryModeEnabled : false,
    });
  }

  function toggleGlossaryMode() {
    if (!annotationToolsAvailable) return;
    if (!noteModeEnabled) return;

    const nextGlossaryModeEnabled = !glossaryModeEnabled;
    if (!nextGlossaryModeEnabled) {
      resetGlossaryModeInteractionState();
    } else {
      setNoteLibraryOpen(false);
      setFocusedLibraryNoteId("");
    }

    setActiveDocumentModeState({
      noteModeEnabled: true,
      glossaryModeEnabled: nextGlossaryModeEnabled,
    });
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
    const copyActionKey = `library-card:${note.id}`;
    const noteCopied = copiedNoteActionKey === copyActionKey;

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
          <div className="note-library-card__header-actions">
            <button
              className={`note-library-card__copy-button ${
                noteCopied ? "is-copy-success" : ""
              }`}
              type="button"
              aria-label={noteCopied ? t("note.copy.copied") : t("note.copy")}
              title={noteCopied ? t("note.copy.copied") : t("note.copy")}
              onClick={(event) => {
                event.stopPropagation();
                clearTouchButtonFocus(event.currentTarget);
                void copyNoteContent(note, copyActionKey);
              }}
            >
              {noteCopyButtonIcon(copyActionKey)}
            </button>
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
        </div>
        <NoteMarkdownEditor
          ariaLabel={t("note.edit")}
          autoFocusOnEdit={noteEditorShouldRefocusRef.current}
          className="note-library-card__editor"
          editing={activeNoteEditorKey === editorKey}
          mermaidEmptyDefinitionLabel={t("mermaid.empty")}
          mermaidErrorLabel={t("mermaid.error")}
          mermaidLoadingLabel={t("mermaid.loading")}
          value={note.body}
          placeholder={t("note.placeholder")}
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
            noteEditorShouldRefocusRef.current = true;
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

  function toggleMobileFilesPane() {
    if (isMobileViewport) {
      if (!directoryPaneOpen && fileSearchMode === "tags") {
        resetFileSearch();
      }
    }
    toggleDirectoryPane();
  }

  async function selectMobileDropboxSource() {
    returnToMobileDataSourceOnPickerCancelRef.current =
      isMobileViewport && mobileDataSourceOpen;
    setMobileDataSourceOpen(false);
    if (dropboxConnected) {
      await openDropboxCloudSource();
      return;
    }
    await connectDropbox({ pickerModeAfterAuth: "directory" });
  }

  function mobileOpenUsesDropbox() {
    return workspaceSource === "dropbox" || (workspaceSource === null && dropboxConnected);
  }

  async function openMobileFileFromCurrentSource() {
    if (!mobileOpenUsesDropbox()) {
      const selected = await openMarkdownFileFromPicker();
      if (selected) {
        completeMobileLocationPicker();
      } else {
        cancelMobileLocationPicker();
      }
      return;
    }
    if (!dropboxConnected) {
      await connectDropbox({ pickerModeAfterAuth: "file" });
      return;
    }

    await openDropboxCloudSource({ pickerMode: "file" });
  }

  async function openMobileFolderFromCurrentSource() {
    if (!mobileOpenUsesDropbox()) {
      const selected = await openMarkdownFolder();
      if (selected) {
        completeMobileLocationPicker();
      } else {
        cancelMobileLocationPicker();
      }
      return;
    }
    if (!dropboxConnected) {
      await connectDropbox({ pickerModeAfterAuth: "directory" });
      return;
    }

    await openDropboxCloudSource({ pickerMode: "directory" });
  }

  function runMobileSourceAction(action: () => Promise<void> | void) {
    if (isMobileViewport) {
      setFileContextMenu(null);
      setMobileDataSourceOpen(false);
      setDirectoryPaneOpen(false);
      if (noteLibraryOpen) {
        closeNoteLibrary({ restoreDirectoryPane: false });
      }
    }

    void action();
  }

  function runMobileLocationPickerAction(action: () => Promise<void> | void) {
    returnToMobileDataSourceOnPickerCancelRef.current =
      isMobileViewport && mobileDataSourceOpen;
    runMobileSourceAction(action);
  }

  function completeMobileLocationPicker() {
    returnToMobileDataSourceOnPickerCancelRef.current = false;
  }

  function cancelMobileLocationPicker() {
    const shouldReturn = returnToMobileDataSourceOnPickerCancelRef.current;
    returnToMobileDataSourceOnPickerCancelRef.current = false;
    if (shouldReturn && isMobileViewport) {
      setMobileDataSourceOpen(true);
    }
  }

  const floatingNotePanelStyle: CSSProperties = floatingNotePanelExpanded
    ? {}
    : floatingNotePanelPosition
      ? {
          left: floatingNotePanelPosition.left,
          maxWidth: floatingNotePanelPosition.maxWidth,
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

  const floatingNoteConnectorStyle: CSSProperties | null =
    floatingNotePanelExpanded || !floatingNotePanelPosition?.connector
      ? null
      : {
          left: floatingNotePanelPosition.connector.left,
          top: floatingNotePanelPosition.connector.top,
          transform: `translateY(-50%) rotate(${floatingNotePanelPosition.connector.angle}deg)`,
          width: floatingNotePanelPosition.connector.width,
        };
  const previewEditorReadOnly =
    notePanelModalActive || (noteModeEnabled && mobileAnnotationKeyboardShouldStayClosed);
  const mobileCommittedSelectionAnchor =
    pendingAnchor ?? activeNote?.anchor ?? activeGlossaryBinding?.anchor ?? null;
  const mobileCommittedSelectionKey =
    mobileAnnotationKeyboardShouldStayClosed &&
    noteModeEnabled &&
    mobileCommittedSelectionAnchor &&
    hasRenderableAnchor(mobileCommittedSelectionAnchor)
      ? `selection:${selectedDocument.id}:${mobileCommittedSelectionAnchor.from}:${mobileCommittedSelectionAnchor.to}:${mobileCommittedSelectionAnchor.selectedText.length}`
      : "";
  const fileContextMenuActions: FileContextMenuAction[] = fileContextMenu
    ? (() => {
        if (fileContextMenu.kind === "directory") {
          return [
            {
              id: "rename",
              label: t("rename.action"),
              icon: <PencilIcon />,
              onSelect: () => {
                openRenameDialog(fileContextMenu);
              },
            },
            {
              id: "delete",
              label: t("directory.delete"),
              icon: <TrashIcon />,
              tone: "danger",
              onSelect: () => {
                void deleteWorkspaceDirectory(fileContextMenu);
              },
            },
          ];
        }

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
          icon: <NoteCopyIcon />,
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
        const openInNewTabAction = {
          id: "open-new-tab",
          label: t("file.openInNewTab"),
          icon: <OpenTabIcon />,
          onSelect: () => {
            void openFileInNewTab(fileContextMenu);
          },
        };
        const renameAction = {
          id: "rename",
          label: t("rename.action"),
          icon: <PencilIcon />,
          onSelect: () => {
            openRenameDialog(fileContextMenu);
          },
        };

        if (exportDocumentCount > 1) {
          return [exportPdfAction, deleteFileAction];
        }

        return [
          openInNewTabAction,
          renameAction,
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
  const fileContextMenuTitleHeight =
    isMobileViewport && fileContextMenu?.kind === "file"
      ? mobileFileContextMenuTitleHeight
      : 0;
  const fileContextMenuViewportRect = currentFloatingNoteViewportRect();

  const fileContextMenuStyle: CSSProperties | undefined = fileContextMenu
    ? {
        left: Math.round(
          clampNumber(fileContextMenu.left, 8, Math.max(8, window.innerWidth - 214)),
        ),
        top: Math.round(
          clampNumber(
            fileContextMenu.top,
            fileContextMenuViewportRect.top + 8,
            Math.max(
              fileContextMenuViewportRect.top + 8,
              fileContextMenuViewportRect.bottom -
                (24 + fileContextMenuTitleHeight + fileContextMenuActions.length * 34),
            ),
          ),
        ),
      }
    : undefined;
  const documentTabContextMenuActions: FileContextMenuAction[] = documentTabContextMenu
    ? [
        {
          id: "close-other-tabs",
          label: t("documentTab.closeOthers"),
          icon: <SearchCloseIcon />,
          onSelect: () => {
            void closeOtherDocumentTabs(documentTabContextMenu.documentId);
          },
        },
        {
          id: "close-all-tabs",
          label: t("documentTab.closeAll"),
          icon: <SearchCloseIcon />,
          onSelect: () => {
            void closeAllDocumentTabs();
          },
        },
        {
          id: "open-in-new-window",
          label: t("documentTab.openInNewWindow"),
          icon: <OpenTabIcon />,
          onSelect: () => {
            void openDocumentTabInNewWindow(documentTabContextMenu.documentId);
          },
        },
      ]
    : [];
  const documentTabContextMenuStyle: CSSProperties | undefined = documentTabContextMenu
    ? {
        left: Math.round(
          clampNumber(documentTabContextMenu.left, 8, Math.max(8, window.innerWidth - 214)),
        ),
        top: Math.round(
          clampNumber(
            documentTabContextMenu.top,
            8,
            Math.max(
              8,
              window.innerHeight - (24 + documentTabContextMenuActions.length * 34),
            ),
          ),
        ),
      }
    : undefined;
  const floatingPanelIsGlossary = Boolean(
    pendingGlossaryTerm ||
      activeGlossaryTerm ||
      activeGlossaryIsEditing ||
      (pendingAnchor && pendingAnchorIsGlossaryTerm),
  );
  const floatingPanelIsGlossaryCreate = Boolean(
    activeGlossaryIsEditing &&
      activeGlossaryTerm?.id === transientGlossaryTermIdRef.current,
  );
  const floatingNoteTone = activeNote
    ? (activeNoteToneById.get(activeNote.id) ?? activeNote.tone ?? 0)
    : 0;
  const selectionWarningMessage = glossaryModeActive
    ? t("selection.warning.glossary")
    : t("selection.warning.note");
  const trimmedFileSearchQuery = fileSearchQuery.trim();
  const fileSearchActive = trimmedFileSearchQuery.length > 0;
  const normalizedFileSearchTagKey = tagDedupeKey(trimmedFileSearchQuery);
  const exactTagSearchActive =
    Boolean(exactTagSearchKey) && exactTagSearchKey === normalizedFileSearchTagKey;
  const matchingDocumentTagGroups = documentTagGroups.filter((group) =>
    exactTagSearchActive
      ? group.key === normalizedFileSearchTagKey
      : group.key.includes(normalizedFileSearchTagKey),
  );
  const indexedTagSearchResults = new Map<
    string,
    { entry: WorkspaceFileEntry; matchedTags: string[] }
  >();
  matchingDocumentTagGroups.forEach((group) => {
    group.entries.forEach((entry) => {
      const result = indexedTagSearchResults.get(entry.documentId);
      if (result) {
        result.matchedTags.push(group.label);
      } else {
        indexedTagSearchResults.set(entry.documentId, {
          entry,
          matchedTags: [group.label],
        });
      }
    });
  });
  const localRecursiveFileSearchActive =
    fileSearchActive &&
    workspaceSource === "local" &&
    Boolean(workspaceRootPath) &&
    nativeStorageAvailable;
  const visibleWorkspaceEntries =
    fileSearchMode === "files" && fileSearchActive && !localRecursiveFileSearchActive
      ? filterWorkspaceEntriesForSearch(workspaceEntries, trimmedFileSearchQuery)
      : workspaceEntries;
  const visibleTagSearchResultsByPath = new Map<string, SearchMarkdownFileResult>();
  if (workspaceSource === "local") {
    localFileSearchResults.forEach((result) => {
      visibleTagSearchResultsByPath.set(result.path, result);
    });
  }
  indexedTagSearchResults.forEach(({ entry, matchedTags }) => {
    const indexedResult: SearchMarkdownFileResult = {
      entry,
      matchedTags,
      parentPath: null,
      path: entry.path,
      relativePath: entry.path,
      title: entry.title,
    };
    const existingResult = visibleTagSearchResultsByPath.get(entry.path);
    visibleTagSearchResultsByPath.set(
      entry.path,
      existingResult
        ? {
            ...existingResult,
            matchedTags: Array.from(
              new Set([...existingResult.matchedTags, ...indexedResult.matchedTags]),
            ),
          }
        : indexedResult,
    );
  });
  const visibleTagSearchResults = Array.from(visibleTagSearchResultsByPath.values()).sort(
    (left, right) => left.relativePath.localeCompare(right.relativePath),
  );
  const tagSearchPending =
    fileSearchMode === "tags" && workspaceSource === "dropbox" && dropboxTagIndexLoading;
  const activeFileSearchPending = fileSearchPending || tagSearchPending;
  const fileSearchHasNoResults =
    fileSearchActive &&
    !activeFileSearchPending &&
    !fileSearchError &&
    (fileSearchMode === "tags"
      ? visibleTagSearchResults.length === 0
      : localRecursiveFileSearchActive
        ? localFileSearchResults.length === 0
        : visibleWorkspaceEntries.length === 0);
  const fileSearchModesVisible =
    fileSearchFocused || fileSearchActive || fileSearchMode === "tags";
  const visibleDropboxPickerEntries = dropboxDirectoryPicker
    ? flattenDropboxDirectoryPickerNodes(dropboxDirectoryPicker.directories)
    : [];
  const selectedDropboxPickerEntry = visibleDropboxPickerEntries.find(
    ({ node }) => node.path === dropboxDirectoryPicker?.selectedPath,
  )?.node;
  const mobileSourceActions: Array<{
    id: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
  }> = [
    {
      id: "open-file",
      label: t("mobileSource.openFile"),
      icon: <DocumentGlyphIcon kind="file" />,
      onSelect: () => runMobileLocationPickerAction(openMobileFileFromCurrentSource),
    },
    {
      id: "open-folder",
      label: t("mobileSource.openFolder"),
      icon: <DocumentGlyphIcon kind="folder" />,
      onSelect: () => runMobileLocationPickerAction(openMobileFolderFromCurrentSource),
    },
    {
      id: "new-file",
      label: t("mobileSource.newFile"),
      icon: <DocumentGlyphIcon kind="file" />,
      onSelect: () => void newMarkdownFile(),
    },
    {
      id: "new-folder",
      label: t("mobileSource.newFolder"),
      icon: <DocumentGlyphIcon kind="folder" />,
      onSelect: () => void newMarkdownFolder(),
    },
  ];
  const mobileLocationActions = mobileSourceActions.filter((action) =>
    action.id.startsWith("open-"),
  );
  const mobileWorkspaceActions = mobileSourceActions.filter((action) =>
    action.id.startsWith("new-"),
  );
  const mobileWorkspaceActive = workspaceSource !== null;
  const mobileWorkspaceCanCreate = mobileWorkspaceActive && workspaceRootPath !== null;
  const mobileFilePanelCreateActions = mobileWorkspaceCanCreate
    ? mobileWorkspaceActions
    : workspaceSource === null
      ? mobileWorkspaceActions.slice(0, 1)
      : [];
  const mobileEmptyActions = [
    {
      id: "dropbox",
      label:
        workspaceSource === "dropbox"
          ? t("mobileSource.changeDropboxFolder")
          : t("mobileSource.openDropbox"),
      icon: <MobileCloudIcon />,
      onSelect: () => runMobileSourceAction(openDropboxCloudSource),
    },
    ...mobileLocationActions,
    mobileWorkspaceActions[0],
  ];
  const mobileFavoriteDirectoryShortcuts = savedLocations.favoriteDirectories.filter(
    (location) => location.kind === "directory",
  );
  const mobileCurrentWorkspaceLocationKey =
    workspaceSource === null
      ? ""
      : nativeLocationKey({
          kind: "directory",
          path: workspaceRootPath ?? "",
          source: workspaceSource,
        });
  const mobileQuickLocationShortcuts = [
    ...mobileFavoriteDirectoryShortcuts,
    ...savedLocations.recent,
  ].filter(
    (location, index, locations) =>
      locations.findIndex(
        (candidate) => nativeLocationKey(candidate) === nativeLocationKey(location),
      ) === index && nativeLocationKey(location) !== mobileCurrentWorkspaceLocationKey,
  );
  const mobileSavedLocationsVisible = nativeStorageAvailable;
  const mobileDataSources = [
    {
      id: "dropbox" as const,
      label: t("dropbox.label"),
      connected: dropboxConnected,
      connecting: dropboxConnecting,
      statusLabel: dropboxConnecting
        ? t("dropbox.connecting")
        : dropboxConnected
          ? t("dropbox.connected")
          : t("dropbox.disconnected"),
      actionLabel: dropboxConnected
        ? t("mobileDataSource.choose")
        : t("mobileDataSource.connect"),
      onSelect: selectMobileDropboxSource,
    },
  ];
  const visibleMobileDataSources = mobileDataSources.filter(
    (source) => !source.connected || workspaceSource === "local",
  );
  const mobileConnectedDataSource = mobileDataSources.find((source) => source.connected);
  const mobileLocationAvailable =
    nativeStorageAvailable || mobileWorkspaceActive || Boolean(mobileConnectedDataSource);
  const mobileDataSourceLabel =
    workspaceSource === "local"
      ? t("mobileDataSource.local")
      : workspaceSource === "dropbox"
        ? t("dropbox.label")
        : mobileConnectedDataSource?.label ?? t("mobileDataSource.choose");
  const mobileWorkspaceDisplayTitle =
    workspaceSource === "local"
      ? `${mobileDataSourceLabel} / ${workspaceTitle}`
      : workspaceTitle;
  const storageLoading = [
    t("status.openingFile"),
    t("status.openingFolder"),
    t("status.openingLastFile"),
    t("dropbox.status.loadingRoot"),
    t("dropbox.status.openingFolder"),
    t("dropbox.status.openingFile"),
    t("dropbox.status.restoringLastFile"),
  ].includes(storageError);
  const storageFeedbackVisible = Boolean(
    !settingsViewOpen &&
      storageError &&
      !createEntryDialog &&
      !draftFileDialog &&
      !openPathDialog &&
      !duplicateFileDialog &&
      !renameDialog &&
      !dropboxDirectoryPicker,
  );
  const startupActive = mobileStartupPhase !== "hidden" && !settingsViewOpen;

  useEffect(() => {
    if (!storageFeedbackVisible || storageLoading || dropboxConnecting) return;

    const dismiss = () => setStorageError("");
    const dismissTimer = window.setTimeout(dismiss, storageFeedbackAutoDismissMs);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);

    return () => {
      window.clearTimeout(dismissTimer);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [dropboxConnecting, storageError, storageFeedbackVisible, storageLoading]);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;

    function showStartupLogo() {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      setMobileStartupLogoVisible(false);
      if (!startupActive || !mobileStartupLogoLoaded || document.hidden) return;

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setMobileStartupLogoVisible(true));
      });
    }

    showStartupLogo();
    document.addEventListener("visibilitychange", showStartupLogo);

    return () => {
      document.removeEventListener("visibilitychange", showStartupLogo);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [startupActive, mobileStartupLogoLoaded]);

  const shellClassName = [
    "scholium-shell",
    startupActive ? "has-mobile-startup" : "",
    isMobileSafeLayoutViewport ? "is-mobile-safe-layout" : "",
    directoryPaneOpen ? "" : "is-directory-pane-closed",
    !settingsViewOpen && noteModeEnabled && noteLibraryOpen ? "is-note-library-open" : "",
    !settingsViewOpen && noteLibraryFocusActive ? "is-note-library-focus-active" : "",
    !settingsViewOpen && libraryNotePanelExpanded ? "is-note-library-expanded" : "",
    !settingsViewOpen && notePanelModalActive ? "is-note-panel-modal-active" : "",
    !settingsViewOpen && expandedNotePanelActive ? "is-note-panel-expanded" : "",
    documentTabsVisible ? "has-document-tabs" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const activeEditorFocusRequest =
    editorFocusRequest?.documentId === selectedDocument.id &&
    editorFocusRequest.mode === editorMode
      ? editorFocusRequest
      : null;

  useLayoutEffect(() => {
    const snapshot = pendingEditorModeScrollSnapshotRef.current;
    if (snapshot) {
      pendingEditorModeScrollSnapshotRef.current = null;
      restoreEditorModeScrollSnapshot(snapshot);
    }

    const documentPosition = pendingDocumentScrollPositionRef.current;
    if (documentPosition) {
      pendingDocumentScrollPositionRef.current = null;
      restoreDocumentScrollPosition(documentPosition);
    }
  }, [editorMode, selectedDocumentId]);

  const documentPaneWidth = estimateDocumentPaneWidth(workspaceTitle, workspaceEntries);
  const shellStyle = {
    "--document-pane-measured-width": `${documentPaneWidth}px`,
  } as CSSProperties;
  const settingsCustomSections = [
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
  ];

  return (
    <main
      className={shellClassName}
      style={shellStyle}
      onMouseDownCapture={handleShellMouseDownCapture}
      onPointerDownCapture={handleShellPointerDownCapture}
    >
      <section
        aria-hidden={!startupActive}
        aria-label={isMobileViewport ? t("mobileStartup.title") : "Scholium"}
        className={`mobile-startup ${startupActive ? "is-active" : ""}`}
      >
        <div className="mobile-startup__center">
          <img
            alt="Scholium"
            className={`mobile-startup__logo ${
              mobileStartupLogoVisible ? "is-visible" : ""
            }`}
            onLoad={() => setMobileStartupLogoLoaded(true)}
            src={appIconUrl}
          />
          {mobileStartupPhase === "welcome" && dropboxConnectionChecked ? (
            <div className="mobile-startup__actions">
              <button
                className="mobile-startup__cloud-button"
                onClick={() => void openDropboxCloudSource()}
                type="button"
              >
                {t("mobileStartup.openCloudFiles")}
              </button>
              <button
                className="mobile-startup__skip-button"
                onClick={() => setMobileStartupPhase("hidden")}
                type="button"
              >
                {t("mobileStartup.skip")}
              </button>
            </div>
          ) : null}
        </div>
      </section>
      {!settingsViewOpen && noteLibraryFocusActive ? (
        <div
          aria-hidden="true"
          className={`note-library-focus-backdrop ${
            libraryNotePanelExpanded ? "is-scroll-through" : ""
          }`}
          onWheel={handleNoteLibraryFocusBackdropWheel}
        />
      ) : null}
      {documentTabsVisible ? (
        <nav className="document-tabs" aria-label={t("documentTabs.label")}>
          <div
            className="document-tabs__scroller"
            ref={documentTabsScrollerRef}
            role="tablist"
          >
            <span
              aria-hidden="true"
              className="document-tabs__active-indicator"
              style={documentTabIndicatorStyle}
            />
            {openDocumentTabs.map((document) => {
              const tabActive = document.id === selectedDocument.id;

              return (
                <div
                  className={`document-tab ${tabActive ? "is-active" : ""}`}
                  data-document-id={document.id}
                  key={document.id}
                  onContextMenu={(event) => openDocumentTabContextMenu(document.id, event)}
                >
                  <button
                    aria-selected={tabActive}
                    className="document-tab__main"
                    onClick={(event) => handleDocumentTabClick(document.id, event)}
                    onPointerDown={(event) =>
                      handleDocumentTabPointerDown(document.id, event)
                    }
                    onTouchCancel={handleDocumentTabTouchCancel}
                    onTouchEnd={(event) => handleDocumentTabTouchEnd(document.id, event)}
                    onTouchMove={(event) => handleDocumentTabTouchMove(document.id, event)}
                    onTouchStart={(event) => handleDocumentTabTouchStart(document.id, event)}
                    role="tab"
                    title={document.title}
                    type="button"
                  >
                    <span className="document-tab__title">{document.title}</span>
                  </button>
                  <button
                    aria-label={`${t("documentTab.close")}: ${document.title}`}
                    className="document-tab__close"
                    onClick={(event) => {
                      void closeDocumentTab(document.id, event);
                    }}
                    title={t("documentTab.close")}
                    type="button"
                  >
                    <SearchCloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            aria-label={t("mobileSource.newFile")}
            className="document-tabs__new-button"
            onClick={newMarkdownFile}
            title={t("mobileSource.newFile")}
            type="button"
          >
            +
          </button>
        </nav>
      ) : null}
      <aside
        className="document-pane"
        aria-label={t("app.documents")}
      >
        <div className="pane-header">
          <div>
            <h1>{t("app.documents")}</h1>
          </div>
        </div>

        <div
          className="document-browser-search"
          onBlurCapture={(event) => {
            const nextFocused = event.relatedTarget;
            if (!(nextFocused instanceof Node) || !event.currentTarget.contains(nextFocused)) {
              setFileSearchFocused(false);
            }
          }}
        >
          <div className="document-browser-controls">
            <label className="file-search" aria-label={t("fileSearch.label")}>
              <input
                aria-label={t("fileSearch.label")}
                autoComplete="off"
                placeholder={t("fileSearch.label")}
                type="search"
                value={fileSearchQuery}
                onChange={(event) => {
                  setExactTagSearchKey("");
                  setFileSearchQuery(event.target.value);
                }}
                onFocus={() => setFileSearchFocused(true)}
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
            <label className="workspace-sort-control">
              <span>{t("documentSort.label")}</span>
              <select
                aria-label={t("documentSort.label")}
                value={workspaceSortMode}
                onChange={(event) => {
                  const nextMode = event.currentTarget.value as WorkspaceSortMode;
                  workspaceSortModeRef.current = nextMode;
                  setWorkspaceSortMode(nextMode);
                  setWorkspaceEntries((entries) =>
                    sortWorkspaceEntriesForDirectory(entries, nextMode),
                  );
                }}
              >
                <option value="name">{t("documentSort.name")}</option>
                <option value="modified">{t("documentSort.modified")}</option>
              </select>
            </label>
          </div>

          <div className="document-browser-context">
            {isMobileViewport &&
            (mobileWorkspaceActive || mobileFilePanelCreateActions.length > 0) ? (
              <section
                className="mobile-workspace-section"
                aria-label={
                  mobileWorkspaceActive
                    ? t("mobileDataSource.currentLocation")
                    : t("mobileSource.newFile")
                }
              >
                {mobileWorkspaceActive ? (
                  <div
                    className="document-tree-root"
                    title={mobileWorkspaceDisplayTitle}
                  >
                    <DocumentGlyphIcon kind="folder" selected />
                    <span className="document-tree-root__title">{mobileWorkspaceDisplayTitle}</span>
                  </div>
                ) : null}
                {mobileFilePanelCreateActions.length > 0 ? (
                  <div
                    className="mobile-workspace-actions"
                    aria-label={
                      mobileWorkspaceActive
                        ? t("mobileSource.createInCurrentLocation")
                        : t("mobileSource.newFile")
                    }
                  >
                    {mobileFilePanelCreateActions.map((action) => (
                      <button key={action.id} onClick={action.onSelect} type="button">
                        {action.icon}
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {!isMobileViewport ? (
              <div
                className={`document-tree-root ${hasOpenDocument ? "" : "is-current"}`.trim()}
                title={workspaceRootPath ?? workspaceTitle}
              >
                <DocumentGlyphIcon kind="folder" selected={!hasOpenDocument} />
                <span className="document-tree-root__title">{workspaceTitle}</span>
              </div>
            ) : null}

            {fileSearchModesVisible ? (
              <div
                aria-label={t("documentBrowser.label")}
                className="file-search-mode-tabs"
                role="tablist"
              >
                <button
                  aria-selected={fileSearchMode === "files"}
                  className={fileSearchMode === "files" ? "is-active" : ""}
                  onClick={() => showFileSearchMode("files")}
                  role="tab"
                  type="button"
                >
                  {t("documentBrowser.files")}
                </button>
                <button
                  aria-selected={fileSearchMode === "tags"}
                  className={fileSearchMode === "tags" ? "is-active" : ""}
                  onClick={() => showFileSearchMode("tags")}
                  role="tab"
                  type="button"
                >
                  {t("documentBrowser.tags")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          aria-label={fileSearchMode === "tags" ? t("tagBrowser.label") : undefined}
          className={`document-list ${
            fileSearchMode === "tags" && !fileSearchActive ? "tag-search-browser" : ""
          }`}
        >
          {fileSearchMode === "tags" ? (
            <>
              {activeFileSearchPending ? (
                <p className="file-search-status" role="status">
                  {t("fileSearch.searching")}
                </p>
              ) : null}
              {fileSearchError ? (
                <p className="file-search-status is-error" role="status">
                  {fileSearchError}
                </p>
              ) : null}
              {!fileSearchActive && !activeFileSearchPending && !fileSearchError ? (
                documentTagGroups.length > 0 ? (
                  documentTagGroups.map((group) => (
                    <button
                      aria-label={t("tagBrowser.openTag", {
                        tag: group.label,
                        count: group.entries.length,
                      })}
                      className="tag-search-row"
                      key={group.key}
                      onClick={() => {
                        setFileSearchQuery(group.label);
                        setExactTagSearchKey(group.key);
                      }}
                      type="button"
                    >
                      <span className="tag-search-row__label">{group.label}</span>
                      <span className="tag-search-row__count">{group.entries.length}</span>
                    </button>
                  ))
                ) : (
                  <p className="tag-search-empty">{t("tagBrowser.empty")}</p>
                )
              ) : null}
              {fileSearchActive && !activeFileSearchPending && !fileSearchError
                ? visibleTagSearchResults.map((result) => {
                    const isSelected =
                      hasOpenDocument &&
                      (result.entry
                        ? result.entry.documentId === selectedDocument.id
                        : localPathsMatch(result.path, selectedDocument.id));

                    return (
                      <button
                        aria-describedby={fileNameTooltipDescribedBy(`tag:${result.path}`)}
                        className={`document-row file-search-result ${
                          isSelected ? "is-selected" : ""
                        }`}
                        key={result.path}
                        onClick={() => {
                          hideFileNameTooltip();
                          if (result.entry) {
                            openWorkspaceEntry(result.entry);
                          } else {
                            void openLocalFileSearchResult(result);
                          }
                        }}
                        onBlur={hideFileNameTooltip}
                        onFocus={(event) =>
                          showFocusedFileNameTooltip(
                            event,
                            `tag:${result.path}`,
                            result.title,
                            result.relativePath,
                          )
                        }
                        onKeyDown={handleFileNameTooltipKeyDown}
                        onMouseEnter={(event) =>
                          scheduleFileNameTooltip(
                            event.currentTarget,
                            `tag:${result.path}`,
                            result.title,
                            result.relativePath,
                          )
                        }
                        onMouseLeave={hideFileNameTooltip}
                        onPointerDown={hideFileNameTooltip}
                        type="button"
                      >
                        <span
                          className="document-disclosure is-placeholder"
                          aria-hidden="true"
                        />
                        <DocumentGlyphIcon kind="file" selected={isSelected} />
                        <span className="document-title">
                          <span className="document-title__primary" data-file-name-overflow>
                            {result.title}
                          </span>
                          <span className="document-title__meta" data-file-name-overflow>
                            {result.relativePath}
                          </span>
                          <span className="document-title__tags">
                            {result.matchedTags.map((tag) => `#${tag}`).join(" · ")}
                          </span>
                        </span>
                      </button>
                    );
                  })
                : null}
            </>
          ) : localRecursiveFileSearchActive ? (
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
                    const isCurrentDocument =
                      hasOpenDocument && localPathsMatch(result.path, selectedDocument.id);
                    const isSelected = isCurrentDocument;

                    return (
                      <button
                        aria-describedby={fileNameTooltipDescribedBy(`search:${result.path}`)}
                        className={`document-row file-search-result ${
                          isSelected ? "is-selected" : ""
                        }`}
                        key={result.path}
                        onClick={() => {
                          hideFileNameTooltip();
                          void openLocalFileSearchResult(result);
                        }}
                        onBlur={hideFileNameTooltip}
                        onFocus={(event) =>
                          showFocusedFileNameTooltip(
                            event,
                            `search:${result.path}`,
                            result.title,
                            result.relativePath,
                          )
                        }
                        onKeyDown={handleFileNameTooltipKeyDown}
                        onMouseEnter={(event) =>
                          scheduleFileNameTooltip(
                            event.currentTarget,
                            `search:${result.path}`,
                            result.title,
                            result.relativePath,
                          )
                        }
                        onMouseLeave={hideFileNameTooltip}
                        onPointerDown={hideFileNameTooltip}
                        type="button"
                      >
                        <span
                          className="document-disclosure is-placeholder"
                          aria-hidden="true"
                        />
                        <DocumentGlyphIcon kind="file" selected={isSelected} />
                        <span className="document-title">
                          <span className="document-title__primary" data-file-name-overflow>
                            {result.title}
                          </span>
                          <span className="document-title__meta" data-file-name-overflow>
                            {result.relativePath}
                          </span>
                        </span>
                      </button>
                    );
                  })
                : null}
            </>
          ) : (
            visibleWorkspaceEntries.map((entry, entryIndex) => {
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
              const nextEntry = visibleWorkspaceEntries[entryIndex + 1];
              const isExpandedDirectoryEmpty =
                isDirectory &&
                isExpanded &&
                !fileSearchActive &&
                (!nextEntry || (nextEntry.depth ?? 1) <= (entry.depth ?? 1));
              const rowStyle = {
                "--document-row-depth": entry.depth ?? 1,
              } as CSSProperties;
              const emptyStateStyle = {
                "--document-row-depth": (entry.depth ?? 1) + 1,
              } as CSSProperties;

              return (
                <Fragment key={entry.id}>
                  <button
                    aria-describedby={
                      entry.kind === "file" ? fileNameTooltipDescribedBy(entry.id) : undefined
                    }
                    aria-expanded={isDirectory ? isExpanded : undefined}
                    className={`document-row ${isDirectory ? "is-folder" : ""} ${
                      entry.kind === "file" ? "is-file" : ""
                    } ${isExpanded ? "is-expanded" : ""} ${isLoading ? "is-loading" : ""} ${
                      rowIsSelected ? "is-selected" : ""
                    } ${isBatchSelected ? "is-batch-selected" : ""}`}
                    style={rowStyle}
                    onClick={(event) => {
                      hideFileNameTooltip();
                      openWorkspaceEntry(entry, event);
                    }}
                    onBlur={entry.kind === "file" ? hideFileNameTooltip : undefined}
                    onContextMenu={(event) => {
                      if (entry.kind === "parent-directory") return;

                      hideFileNameTooltip();
                      cancelWorkspaceFileLongPress();
                      openFileContextMenu(entry, event);
                    }}
                    onFocus={
                      entry.kind === "file"
                        ? (event) => showFocusedFileNameTooltip(event, entry.id, entry.title)
                        : undefined
                    }
                    onKeyDown={
                      entry.kind === "file" ? handleFileNameTooltipKeyDown : undefined
                    }
                    onMouseEnter={
                      entry.kind === "file"
                        ? (event) =>
                            scheduleFileNameTooltip(event.currentTarget, entry.id, entry.title)
                        : undefined
                    }
                    onMouseLeave={entry.kind === "file" ? hideFileNameTooltip : undefined}
                    onPointerCancel={(event) => {
                      cancelWorkspaceFileLongPress(event.pointerId);
                    }}
                    onPointerDown={(event) => {
                      hideFileNameTooltip();
                      if (entry.kind === "parent-directory") return;

                      startWorkspaceFileLongPress(entry, event);
                    }}
                    onPointerMove={moveWorkspaceFileLongPress}
                    onPointerUp={(event) => {
                      cancelWorkspaceFileLongPress(event.pointerId);
                    }}
                    title={entry.kind === "file" ? undefined : entry.title}
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
                    <span
                      className="document-title"
                      data-file-name-overflow={entry.kind === "file" ? "" : undefined}
                    >
                      {entry.title}
                    </span>
                  </button>
                  {isExpandedDirectoryEmpty ? (
                    <p className="directory-empty-state" role="status" style={emptyStateStyle}>
                      {entry.source === "dropbox"
                        ? t("dropbox.emptyFolder")
                        : t("status.noFoldersOrMarkdown")}
                    </p>
                  ) : null}
                </Fragment>
              );
            })
          )}

          {fileSearchMode === "files" &&
          !fileSearchActive &&
          workspaceSource &&
          workspaceEntries.length === 0 ? (
            <p className="directory-empty-state is-root" role="status">
              {workspaceSource === "dropbox"
                ? t("dropbox.emptyFolder")
                : t("status.noFoldersOrMarkdown")}
            </p>
          ) : null}

          {fileSearchHasNoResults ? (
            <p className="file-search-status" role="status">
              {t("fileSearch.noResults")}
            </p>
          ) : null}
        </div>

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

      {isMobileViewport && mobileTagPickerOpen ? (
        <div className="mobile-tag-picker-backdrop" onPointerDown={closeMobileTagPicker}>
          <section
            aria-labelledby="mobile-tag-picker-title"
            aria-modal="true"
            className="mobile-tag-picker-sheet"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMobileTagPicker();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mobile-tag-picker-sheet__header">
              <h2 id="mobile-tag-picker-title">{t("tags.picker.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                onClick={closeMobileTagPicker}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="mobile-tag-picker-search" onSubmit={submitMobileTagPicker}>
              <input
                aria-label={t("tags.picker.search")}
                autoComplete="off"
                enterKeyHint="done"
                placeholder={t("tags.picker.search")}
                ref={tagInputRef}
                type="search"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.currentTarget.value)}
                onKeyDown={handleTagSuggestionKeyDown}
              />
            </form>
            <div
              aria-busy={tagPickerIndexPending || undefined}
              aria-label={t("tags.picker.results")}
              className="mobile-tag-picker-results"
            >
              {visibleTagPickerGroups.map((group) => {
                const alreadySelected = selectedDocumentTagKeys.has(group.key);
                return (
                  <button
                    aria-label={
                      alreadySelected
                        ? undefined
                        : t("tags.picker.select", {
                            tag: group.label,
                            count: group.documentCount,
                          })
                    }
                    className="mobile-tag-picker-result"
                    disabled={alreadySelected}
                    key={group.key}
                    onClick={() => selectMobileDocumentTag(group.label)}
                    onKeyDown={handleTagSuggestionKeyDown}
                    type="button"
                  >
                    <span className="mobile-tag-picker-result__label">
                      <span
                        aria-hidden="true"
                        className="mobile-tag-picker-result__icon"
                        dangerouslySetInnerHTML={{ __html: priceTagIconSvg }}
                      />
                      {group.label}
                    </span>
                    <small>
                      {alreadySelected
                        ? t("tags.picker.alreadyAdded")
                        : t("tagBrowser.documentCount", { count: group.documentCount })}
                    </small>
                  </button>
                );
              })}
              {matchingTagPickerGroups.length === 0 && tagPickerCanCreate ? (
                <button
                  aria-label={t("tags.picker.create", { tag: normalizedTagDraft })}
                  className="mobile-tag-picker-create"
                  onClick={() => selectMobileDocumentTag(normalizedTagDraft)}
                  onKeyDown={handleTagSuggestionKeyDown}
                  type="button"
                >
                  <span>{t("tags.picker.createButton")}</span>
                </button>
              ) : null}
              {mobileTagDraftAlreadySelected && normalizedTagDraft ? (
                <p className="mobile-tag-picker-empty">{t("tags.picker.alreadyAdded")}</p>
              ) : null}
              {!mobileTagDraftAlreadySelected &&
              !tagPickerIndexPending &&
              visibleTagPickerGroups.length === 0 &&
              !tagPickerCanCreate ? (
                <p className="mobile-tag-picker-empty">{t("tags.picker.empty")}</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {fileNameTooltip ? (
        <div
          className="file-name-tooltip"
          id={fileNameTooltipId}
          ref={fileNameTooltipRef}
          role="tooltip"
          style={{
            left: fileNameTooltip.position?.left ?? 0,
            top: fileNameTooltip.position?.top ?? 0,
            visibility: fileNameTooltip.position ? "visible" : "hidden",
          }}
        >
          <span className="file-name-tooltip__title">{fileNameTooltip.title}</span>
          {fileNameTooltip.detail ? (
            <span className="file-name-tooltip__detail">{fileNameTooltip.detail}</span>
          ) : null}
        </div>
      ) : null}

      {fileContextMenu ? (
        <div
          aria-label={fileContextMenu.kind === "file" ? fileContextMenu.title : undefined}
          className="file-context-menu"
          role="menu"
          style={fileContextMenuStyle}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isMobileViewport && fileContextMenu.kind === "file" ? (
            <div
              aria-hidden="true"
              className="file-context-menu__target-title"
              role="presentation"
            >
              {fileContextMenu.title}
            </div>
          ) : null}
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

      {documentTabContextMenu ? (
        <div
          className="file-context-menu document-tab-context-menu"
          role="menu"
          style={documentTabContextMenuStyle}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {documentTabContextMenuActions.map((action) => (
            <button
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

      {createEntryDialog ? (
        <div
          className="duplicate-file-dialog-backdrop"
          onMouseDown={closeCreateEntryDialog}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <form
            aria-labelledby="create-entry-dialog-title"
            aria-modal="true"
            className="duplicate-file-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submitCreateEntry}
            role="dialog"
          >
            <div className="duplicate-file-dialog__header">
              <h2 id="create-entry-dialog-title">
                {t(
                  createEntryDialog.kind === "file"
                    ? "mobileSource.newFile"
                    : "mobileSource.newFolder",
                )}
              </h2>
              <button
                aria-label={t("dialog.close")}
                className="duplicate-file-dialog__close"
                disabled={createEntryDialog.isSubmitting}
                onClick={closeCreateEntryDialog}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="duplicate-file-dialog__field">
              <span>
                {t(
                  createEntryDialog.kind === "file"
                    ? "newFile.namePrompt"
                    : "newFolder.namePrompt",
                )}
              </span>
              <span className="duplicate-file-dialog__file-name-control">
                <input
                  aria-describedby={
                    createEntryDialog.kind === "file"
                      ? "create-entry-dialog-extension"
                      : undefined
                  }
                  disabled={createEntryDialog.isSubmitting}
                  enterKeyHint="done"
                  ref={createEntryInputRef}
                  spellCheck={false}
                  type="text"
                  value={createEntryDialog.name}
                  onChange={(event) => {
                    const nextName =
                      createEntryDialog.kind === "file"
                        ? stripMarkdownExtension(event.target.value)
                        : event.target.value;
                    setCreateEntryDialog((currentDialog) =>
                      currentDialog ? { ...currentDialog, name: nextName } : currentDialog,
                    );
                  }}
                />
                {createEntryDialog.kind === "file" ? (
                  <span
                    className="duplicate-file-dialog__extension"
                    id="create-entry-dialog-extension"
                  >
                    .md
                  </span>
                ) : null}
              </span>
            </label>
            {storageError ? (
              <p className="duplicate-file-dialog__message" role="status">
                {storageError}
              </p>
            ) : null}
            <div className="note-actions duplicate-file-dialog__actions">
              <button
                disabled={createEntryDialog.isSubmitting}
                onClick={closeCreateEntryDialog}
                type="button"
              >
                {t("duplicate.cancel")}
              </button>
              <button
                className="is-primary"
                disabled={createEntryDialog.isSubmitting}
                type="submit"
              >
                {createEntryDialog.isSubmitting
                  ? t("duplicate.submitting")
                  : t("duplicate.submit")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {openPathDialog ? (
        <div
          className="duplicate-file-dialog-backdrop"
          onMouseDown={closeOpenPathDialog}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <form
            aria-labelledby="open-path-dialog-title"
            aria-modal="true"
            className="duplicate-file-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submitOpenPathDialog}
            role="dialog"
          >
            <div className="duplicate-file-dialog__header">
              <h2 id="open-path-dialog-title">{t("openPath.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                className="duplicate-file-dialog__close"
                disabled={openPathDialog.isSubmitting}
                onClick={closeOpenPathDialog}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="duplicate-file-dialog__field">
              <span>{t("openPath.prompt")}</span>
              <span className="duplicate-file-dialog__file-name-control">
                <input
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={openPathDialog.isSubmitting}
                  enterKeyHint="go"
                  placeholder={t("openPath.placeholder")}
                  ref={openPathInputRef}
                  spellCheck={false}
                  type="text"
                  value={openPathDialog.path}
                  onChange={(event) => {
                    const nextPath = event.target.value;
                    setOpenPathDialog((currentDialog) =>
                      currentDialog
                        ? { ...currentDialog, path: nextPath, error: "" }
                        : currentDialog,
                    );
                  }}
                />
              </span>
            </label>
            {openPathDialog.error ? (
              <p className="duplicate-file-dialog__message" role="status">
                {openPathDialog.error}
              </p>
            ) : null}
            <div className="note-actions duplicate-file-dialog__actions">
              <button
                disabled={openPathDialog.isSubmitting}
                onClick={closeOpenPathDialog}
                type="button"
              >
                {t("duplicate.cancel")}
              </button>
              <button
                className="is-primary"
                disabled={openPathDialog.isSubmitting || !openPathDialog.path.trim()}
                type="submit"
              >
                {t("openPath.submit")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {draftFileDialog ? (
        <div
          className="duplicate-file-dialog-backdrop"
          onMouseDown={cancelDraftFileDialog}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <form
            aria-describedby={
              draftFileDialog.reason === "close" ? "draft-file-dialog-message" : undefined
            }
            aria-labelledby="draft-file-dialog-title"
            aria-modal="true"
            className="duplicate-file-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submitDraftFileDialog}
            role="dialog"
          >
            <div className="duplicate-file-dialog__header">
              <h2 id="draft-file-dialog-title">{t("draftFile.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                className="duplicate-file-dialog__close"
                disabled={draftFileDialog.isSubmitting}
                onClick={cancelDraftFileDialog}
                type="button"
              >
                ×
              </button>
            </div>
            {draftFileDialog.reason === "close" ? (
              <p className="duplicate-file-dialog__description" id="draft-file-dialog-message">
                {t("draftFile.closeMessage")}
              </p>
            ) : null}
            <label className="duplicate-file-dialog__field">
              <span>{t("newFile.namePrompt")}</span>
              <span className="duplicate-file-dialog__file-name-control">
                <input
                  aria-describedby="draft-file-dialog-extension"
                  disabled={draftFileDialog.isSubmitting}
                  enterKeyHint="done"
                  ref={draftFileInputRef}
                  spellCheck={false}
                  type="text"
                  value={draftFileDialog.name}
                  onChange={(event) => {
                    const nextName = stripMarkdownExtension(event.target.value);
                    setDraftFileDialog((currentDialog) =>
                      currentDialog ? { ...currentDialog, name: nextName } : currentDialog,
                    );
                  }}
                />
                <span
                  className="duplicate-file-dialog__extension"
                  id="draft-file-dialog-extension"
                >
                  .md
                </span>
              </span>
            </label>
            {draftFileDialog.error ? (
              <p className="duplicate-file-dialog__message" role="status">
                {draftFileDialog.error}
              </p>
            ) : null}
            <div className="note-actions duplicate-file-dialog__actions">
              <button
                disabled={draftFileDialog.isSubmitting}
                onClick={cancelDraftFileDialog}
                type="button"
              >
                {t("duplicate.cancel")}
              </button>
              <button
                disabled={draftFileDialog.isSubmitting}
                onClick={discardDraftFileDialogDocument}
                type="button"
              >
                {t("draftFile.discard")}
              </button>
              <button
                className="is-primary"
                disabled={draftFileDialog.isSubmitting}
                type="submit"
              >
                {draftFileDialog.isSubmitting
                  ? t("duplicate.submitting")
                  : t("duplicate.submit")}
              </button>
            </div>
          </form>
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

      {renameDialog ? (
        <div
          className="duplicate-file-dialog-backdrop"
          onMouseDown={closeRenameDialog}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <form
            aria-labelledby="rename-dialog-title"
            aria-modal="true"
            className="duplicate-file-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={submitRenameWorkspaceEntry}
            role="dialog"
          >
            <div className="duplicate-file-dialog__header">
              <h2 id="rename-dialog-title">{t("rename.title")}</h2>
              <button
                aria-label={t("dialog.close")}
                className="duplicate-file-dialog__close"
                disabled={renameDialog.isSubmitting}
                onClick={closeRenameDialog}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="duplicate-file-dialog__field">
              <span>{t("rename.name")}</span>
              <span className="duplicate-file-dialog__file-name-control">
                <input
                  disabled={renameDialog.isSubmitting}
                  ref={renameInputRef}
                  type="text"
                  value={renameDialog.name}
                  onChange={(event) => {
                    const nextName =
                      renameDialog.kind === "file"
                        ? stripMarkdownExtension(event.target.value)
                        : event.target.value;
                    setRenameDialog((currentDialog) =>
                      currentDialog ? { ...currentDialog, name: nextName } : currentDialog,
                    );
                  }}
                />
                {renameDialog.kind === "file" ? (
                  <span className="duplicate-file-dialog__extension">.md</span>
                ) : null}
              </span>
            </label>
            {storageError ? (
              <p className="duplicate-file-dialog__message" role="status">
                {storageError}
              </p>
            ) : null}
            <div className="note-actions duplicate-file-dialog__actions">
              <button
                disabled={renameDialog.isSubmitting}
                onClick={closeRenameDialog}
                type="button"
              >
                {t("rename.cancel")}
              </button>
              <button
                className="is-primary"
                disabled={renameDialog.isSubmitting}
                type="submit"
              >
                {renameDialog.isSubmitting ? t("rename.submitting") : t("rename.submit")}
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
              <h2 id="dropbox-directory-dialog-title">
                {t(
                  dropboxDirectoryPicker.mode === "file"
                    ? "dropbox.picker.fileTitle"
                    : "dropbox.picker.title",
                )}
              </h2>
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
              visibleDropboxPickerEntries.length > 0 ? (
                <div
                  aria-label={t(
                    dropboxDirectoryPicker.mode === "file"
                      ? "dropbox.picker.itemList"
                      : "dropbox.picker.directoryList",
                  )}
                  className="dropbox-directory-dialog__list"
                  onWheel={handleDropboxDirectoryListWheel}
                  role="listbox"
                >
                  {visibleDropboxPickerEntries.map(({ node: entry, depth }) => {
                    const isSelected = entry.path === dropboxDirectoryPicker.selectedPath;
                    const rowStyle = {
                      "--dropbox-directory-indent": `${depth * 18}px`,
                    } as CSSProperties;

                    return (
                      <div
                        aria-selected={isSelected}
                        className={`dropbox-directory-dialog__row ${
                          entry.isExpanded ? "is-expanded" : ""
                        } ${entry.isLoading ? "is-loading" : ""} ${
                          isSelected ? "is-selected" : ""
                        }`}
                        key={entry.path}
                        role="option"
                        style={rowStyle}
                        title={entry.path}
                      >
                        {entry.kind === "directory" ? (
                          <button
                            aria-expanded={entry.isExpanded}
                            aria-label={t("dropbox.picker.enterFolder", {
                              name: entry.title,
                            })}
                            className="dropbox-directory-dialog__row-toggle"
                            disabled={dropboxDirectoryPicker.isOpening || entry.isLoading}
                            onClick={() => void toggleDropboxPickerDirectory(entry.path)}
                            type="button"
                          >
                            {entry.isLoading ? "..." : entry.isExpanded ? "⌄" : "›"}
                          </button>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="dropbox-directory-dialog__row-toggle"
                          />
                        )}
                        <button
                          className="dropbox-directory-dialog__row-main"
                          disabled={dropboxDirectoryPicker.isOpening}
                          onClick={() => {
                            if (
                              entry.kind === "directory" &&
                              dropboxDirectoryPicker.mode === "file"
                            ) {
                              void toggleDropboxPickerDirectory(entry.path);
                              return;
                            }
                            if (isMobileViewport && isSelected) {
                              void openSelectedDropboxPickerItem(entry.path);
                              return;
                            }

                            setDropboxDirectoryPicker((currentPicker) =>
                              currentPicker
                                ? { ...currentPicker, selectedPath: entry.path }
                                : currentPicker,
                            );
                          }}
                          onDoubleClick={() => {
                            if (
                              entry.kind === "directory" &&
                              dropboxDirectoryPicker.mode === "file"
                            ) {
                              void toggleDropboxPickerDirectory(entry.path);
                              return;
                            }
                            void openSelectedDropboxPickerItem(entry.path);
                          }}
                          type="button"
                        >
                          <DocumentGlyphIcon
                            kind={entry.kind === "directory" ? "folder" : "file"}
                            selected={isSelected}
                          />
                          <span>{entry.title}</span>
                        </button>
                        {entry.error ? (
                          <p className="dropbox-directory-dialog__row-message" role="status">
                            {entry.error}
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
                  selectedDropboxPickerEntry?.kind !== dropboxDirectoryPicker.mode
                }
                onClick={() => void openSelectedDropboxPickerItem()}
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
        {documentSearchVisible ? (
          <form
            aria-label={t("documentSearch.label")}
            className="document-search"
            data-has-query={documentSearchQuery.trim() ? "true" : "false"}
            data-expanded={documentSearchOpen ? "true" : "false"}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (
                isMobileViewport &&
                !(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))
              ) {
                closeDocumentSearch();
              }
            }}
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
                  if (isMobileViewport && !documentSearchOpen) {
                    openDocumentSearch(false);
                  }
                }}
                onKeyDown={handleDocumentSearchInputKeyDown}
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
        {hasOpenDocument && !settingsViewOpen ? (
          <button
            aria-label={
              editorMode === "edit" ? t("toolbar.previewMode.open") : t("toolbar.sourceMode.open")
            }
            aria-pressed={editorMode === "edit"}
            aria-disabled={noteModeEnabled}
            className={`editor-mode-toggle mobile-editor-mode-toggle ${
              editorMode === "edit" ? "is-active" : ""
            }`}
            onClick={toggleEditorMode}
            onPointerDown={(event) => event.preventDefault()}
            ref={mobileSourceModeButtonRef}
            type="button"
          >
            <SourceModeIcon />
          </button>
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
              aria-disabled={noteModeEnabled}
              className={`editor-mode-toggle ${editorMode === "edit" ? "is-active" : ""}`}
              onClick={toggleEditorMode}
              onPointerDown={(event) => event.preventDefault()}
              ref={desktopSourceModeButtonRef}
              title={
                editorMode === "edit" ? t("toolbar.previewMode.open") : t("toolbar.sourceMode.open")
              }
              type="button"
            >
              <SourceModeIcon />
            </button>
            <span aria-hidden="true" className="editor-toolbar__divider" />
            <button
              aria-checked={noteModeEnabled}
              aria-label={noteModeEnabled ? t("toolbar.noteMode.close") : t("toolbar.noteMode.open")}
              className="note-mode-switch note-mode-switch--primary"
              onClick={toggleNoteMode}
              role="switch"
              type="button"
            >
              <span
                aria-hidden="true"
                className="note-mode-switch__icon note-mode-switch__icon--note"
              />
              <span className="note-mode-switch__label">{t("mobileToolbar.note")}</span>
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
              <span
                aria-hidden="true"
                className="note-mode-switch__icon note-mode-switch__icon--glossary"
              />
              <span className="note-mode-switch__label">{t("mobileToolbar.terms")}</span>
            </button>
          </div>
        ) : null}
        <div className="editor-grid">
          <div className="editor-surface" style={editorSurfaceStyle}>
            {noteModeEnabled ? (
              <>
                {mobileNoteSelectionHintVisible && !noteModeSourceBlockedNoticePosition ? (
                  <div aria-hidden="true" className="mobile-feedback-backdrop" />
                ) : null}
                <p
                  aria-hidden={
                    !mobileNoteSelectionHintVisible && !noteModeSourceBlockedNoticePosition
                  }
                  className={`mobile-feedback-surface mobile-note-selection-hint ${
                    mobileNoteSelectionHintVisible || noteModeSourceBlockedNoticePosition
                      ? "is-visible"
                      : ""
                  } ${
                    mobileNoteSelectionHintVisible && !noteModeSourceBlockedNoticePosition
                      ? "has-backdrop"
                      : ""
                  } ${noteModeSourceBlockedNoticePosition ? "is-source-mode-blocked" : ""}`}
                  role="status"
                  style={noteModeSourceBlockedNoticePosition ?? undefined}
                >
                  {noteModeSourceBlockedNoticePosition
                    ? t("toolbar.sourceMode.blockedByNoteMode")
                    : t(
                        mobileAnnotationKeyboardShouldStayClosed
                          ? "selection.mobileNoteModeHint"
                          : "selection.desktopNoteModeHint",
                      )}
                </p>
              </>
            ) : null}
            <div className="editor-content-frame">
              {hasOpenDocument ? (
                <section className="document-tags" aria-label={t("tags.label")}>
                  {selectedDocumentTags.length > 0 ? (
                    <div
                      className={`document-tags__chips ${
                        documentTagsExpanded ? "is-expanded" : ""
                      }`}
                      ref={documentTagsListRef}
                    >
                      {selectedDocumentTags.map((tag) => (
                        <span className="document-tag-chip" key={tag}>
                          <button
                            aria-label={t("tags.open", { tag })}
                            className="document-tag-chip__label"
                            onClick={() => openTagSearch(tag)}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className="document-tag-chip__icon"
                              dangerouslySetInnerHTML={{ __html: priceTagIconSvg }}
                            />
                            {tag}
                          </button>
                          <button
                            aria-label={t("tags.remove", { tag })}
                            className="document-tag-chip__remove"
                            disabled={notePanelModalActive}
                            onClick={() => removeSelectedDocumentTag(tag)}
                            title={t("tags.remove", { tag })}
                            type="button"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="document-tags__controls">
                    {hiddenDocumentTagCount > 0 ? (
                      <button
                        aria-expanded={documentTagsExpanded}
                        aria-label={
                          documentTagsExpanded
                            ? t("tags.collapse")
                            : t("tags.expand", { count: hiddenDocumentTagCount })
                        }
                        className="document-tags__overflow-toggle"
                        onClick={() => setDocumentTagsExpanded((expanded) => !expanded)}
                        type="button"
                      >
                        {documentTagsExpanded
                          ? t("tags.collapse")
                          : t("tags.more", { count: hiddenDocumentTagCount })}
                      </button>
                    ) : null}
                    {isMobileViewport ? (
                      <button
                        aria-label={t("tags.add")}
                        className="document-tags__add-button"
                        disabled={notePanelModalActive}
                        onClick={() => setMobileTagPickerOpen(true)}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="document-tags__add-icon"
                          dangerouslySetInnerHTML={{ __html: plusSignIconSvg }}
                        />
                        <span>{t("documentBrowser.tags")}</span>
                      </button>
                    ) : (
                      <form className="document-tags__form" onSubmit={submitSelectedDocumentTag}>
                        <input
                          aria-label={t("tags.add")}
                          disabled={notePanelModalActive}
                          enterKeyHint="done"
                          placeholder={t("tags.placeholder")}
                          ref={tagInputRef}
                          type="text"
                          value={tagDraft}
                          onChange={(event) => setTagDraft(event.currentTarget.value)}
                          onKeyDown={handleTagSuggestionKeyDown}
                        />
                        {normalizedTagDraft ? (
                          <div
                            aria-label={t("tags.picker.results")}
                            className="document-tags__suggestions"
                          >
                            {visibleTagPickerGroups.map((group) => (
                              <button
                                className="document-tags__suggestion"
                                disabled={selectedDocumentTagKeys.has(group.key)}
                                key={group.key}
                                onClick={() => addSelectedDocumentTag(group.label)}
                                onKeyDown={handleTagSuggestionKeyDown}
                                onPointerDown={(event) => event.preventDefault()}
                                title={
                                  selectedDocumentTagKeys.has(group.key)
                                    ? t("tags.picker.alreadyAdded")
                                    : undefined
                                }
                                type="button"
                              >
                                <span
                                  aria-hidden="true"
                                  className="document-tags__suggestion-icon"
                                  dangerouslySetInnerHTML={{ __html: priceTagIconSvg }}
                                />
                                <span>{group.label}</span>
                              </button>
                            ))}
                            {matchingTagPickerGroups.length === 0 && tagPickerCanCreate ? (
                              <button
                                className="document-tags__suggestion document-tags__suggestion--create"
                                onClick={() => addSelectedDocumentTag(normalizedTagDraft)}
                                onKeyDown={handleTagSuggestionKeyDown}
                                onPointerDown={(event) => event.preventDefault()}
                                type="button"
                              >
                                <span
                                  aria-hidden="true"
                                  className="document-tags__suggestion-icon"
                                  dangerouslySetInnerHTML={{ __html: plusSignIconSvg }}
                                />
                                <span>{t("tags.picker.createButton")}</span>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </form>
                    )}
                  </div>
                </section>
              ) : null}
              {!hasOpenDocument ? (
                <div className="empty-editor-state">
                  <h2>
                    {workspaceHasMarkdownFileEntries
                      ? t("emptyDocumentSelection.title")
                      : t("emptyDirectory.title", { title: workspaceTitle })}
                  </h2>
                  <p>
                    {workspaceHasMarkdownFileEntries
                      ? t("emptyDocumentSelection.description")
                      : t("emptyDirectory.description")}
                  </p>
                  <div
                    className="empty-editor-actions mobile-empty-actions"
                    aria-label={t("mobileSource.label")}
                  >
                    {(workspaceHasMarkdownFileEntries
                      ? mobileEmptyActions
                      : mobileFilePanelCreateActions
                    ).map((action) => (
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
                  focusRequestKey={activeEditorFocusRequest?.requestKey}
                  key={selectedDocument.id}
                  mobileBlockSelectionEnabled={mobileAnnotationKeyboardShouldStayClosed}
                  mobileBlockSelectionHint={t(
                    glossaryModeActive
                      ? "selection.mobileGlossaryModeHint"
                      : "selection.dragToCreateNote",
                  )}
                  mobileSelectionKind={glossaryModeActive ? "glossary" : "note"}
                  mobileCommittedSelectionKey={mobileCommittedSelectionKey}
                  mobileCommittedSelectionTone={floatingNoteTone}
                  mobileSelectionToneForAnchor={toneForNewSelectionNote}
                  mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                  mermaidErrorLabel={t("mermaid.error")}
                  mermaidLoadingLabel={t("mermaid.loading")}
                  noteModeEnabled={noteModeEnabled}
                  readOnly={previewEditorReadOnly}
                  ref={activeDocumentEditorRef}
                  search={documentSearchState}
                  selectionToRestore={activeEditorFocusRequest?.selection ?? null}
                  selectAllRequestKey={editorSelectAllRequestKey}
                  toolbarEnabled={false}
                  value={selectedDocument.body}
                  codeBlockCopyLabel={t("codeBlock.copy")}
                  codeBlockCopiedLabel={t("codeBlock.copy.copied")}
                  codeBlockDeleteLabel={t("codeBlock.delete")}
                  onAnnotationClick={showAnnotationViewer}
                  onAnnotationDoubleClick={showAnnotationViewer}
                  onChange={updateSelectedDocumentBody}
                  onFocusRequestHandled={completeEditorFocusRequest}
                  onFocusTargetAnnotationPress={dismissFocusTargetAnnotationFromEditor}
                  onLinkClick={(href) => void openMarkdownLink(href)}
                  onSearchMatchCountChange={handleDocumentSearchMatchCountChange}
                  onSelectionChange={handleSelectionChange}
                  onSelectionEnter={handleSelectionEnter}
                />
              ) : (
                <MarkdownEditor
                  focusRequestKey={activeEditorFocusRequest?.requestKey}
                  ref={activeDocumentEditorRef}
                  search={documentSearchState}
                  selectionToRestore={activeEditorFocusRequest?.selection ?? null}
                  selectAllRequestKey={editorSelectAllRequestKey}
                  value={selectedDocument.body}
                  onChange={updateSelectedDocumentBody}
                  onFocusRequestHandled={completeEditorFocusRequest}
                  onSearchMatchCountChange={handleDocumentSearchMatchCountChange}
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
                    className={`note-library-expanded-panel__copy-button ${
                      copiedNoteActionKey === `library-expanded:${expandedLibraryNote.id}`
                        ? "is-copy-success"
                        : ""
                    }`}
                    type="button"
                    aria-label={
                      copiedNoteActionKey === `library-expanded:${expandedLibraryNote.id}`
                        ? t("note.copy.copied")
                        : t("note.copy")
                    }
                    title={
                      copiedNoteActionKey === `library-expanded:${expandedLibraryNote.id}`
                        ? t("note.copy.copied")
                        : t("note.copy")
                    }
                    onClick={(event) => {
                      clearTouchButtonFocus(event.currentTarget);
                      void copyNoteContent(
                        expandedLibraryNote,
                        `library-expanded:${expandedLibraryNote.id}`,
                      );
                    }}
                  >
                    {noteCopyButtonIcon(`library-expanded:${expandedLibraryNote.id}`)}
                  </button>
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
                  autoFocusOnEdit={noteEditorShouldRefocusRef.current}
                  className="note-library-expanded-panel__editor"
                  editing={activeNoteEditorKey === expandedLibraryNoteEditorKey}
                  mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                  mermaidErrorLabel={t("mermaid.error")}
                  mermaidLoadingLabel={t("mermaid.loading")}
                  value={expandedLibraryNote.body}
                  placeholder={t("note.placeholder")}
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
                    noteEditorShouldRefocusRef.current = true;
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

      {isMobileViewport && mobileDataSourceOpen && !settingsViewOpen ? (
        <div
          className="mobile-data-source-backdrop"
          onPointerDown={() => setMobileDataSourceOpen(false)}
        >
          <section
            aria-labelledby="mobile-data-source-title"
            aria-modal="true"
            className="mobile-data-source-sheet"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mobile-data-source-sheet__header">
              <div>
                <h2 id="mobile-data-source-title">{t("mobileDataSource.title")}</h2>
                <p>{t("mobileDataSource.description")}</p>
              </div>
              <button
                aria-label={t("dialog.close")}
                onClick={() => setMobileDataSourceOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="mobile-data-source-sheet__body">
              {mobileWorkspaceActive ? (
                <section
                  className="mobile-location-current"
                  aria-label={t("mobileDataSource.currentLocation")}
                >
                  <DocumentGlyphIcon kind="folder" selected />
                  <span className="mobile-location-current__text">
                    <span className="mobile-location-current__label">
                      {t("mobileDataSource.currentLocation")}
                    </span>
                    <strong className="mobile-location-current__title">{workspaceTitle}</strong>
                    {workspaceRootPath ? (
                      <span className="mobile-location-current__path">{workspaceRootPath}</span>
                    ) : null}
                  </span>
                </section>
              ) : null}

              <div
                className="mobile-location-actions"
                aria-label={t("mobileDataSource.openActions")}
              >
                {mobileLocationActions.map((action) => (
                  <button key={action.id} onClick={action.onSelect} type="button">
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              {visibleMobileDataSources.map((source) => (
                <button
                  className="mobile-data-source-option"
                  disabled={source.connecting}
                  key={source.id}
                  onClick={() => void source.onSelect()}
                  type="button"
                >
                  <span className="mobile-data-source-option__icon">
                    <MobileCloudIcon />
                  </span>
                  <span className="mobile-data-source-option__text">
                    <strong>{source.label}</strong>
                    <span>{source.statusLabel}</span>
                  </span>
                  <span className="mobile-data-source-option__action">
                    {source.actionLabel}
                  </span>
                </button>
              ))}

              {mobileSavedLocationsVisible && mobileQuickLocationShortcuts.length > 0 ? (
                <section
                  className="mobile-location-list"
                  aria-label={t("mobileSource.savedLocations")}
                >
                  <h3>{t("mobileSource.savedLocations")}</h3>
                  {mobileQuickLocationShortcuts.map((location) => (
                    <button
                      aria-label={t("mobileSource.openLocation", { title: location.title })}
                      className="mobile-location-shortcut"
                      key={nativeLocationKey(location)}
                      onClick={() => runMobileSourceAction(() => openNativeMenuLocation(location))}
                      title={location.path}
                      type="button"
                    >
                      <DocumentGlyphIcon
                        kind={location.kind === "directory" ? "folder" : "file"}
                        selected={false}
                      />
                      <span className="mobile-location-shortcut__text">
                        <span className="mobile-location-shortcut__title">{location.title}</span>
                        <span className="mobile-location-shortcut__path">
                          {location.source === "dropbox"
                            ? location.path
                              ? `${t("dropbox.label")} ${location.path}`
                              : t("dropbox.label")
                            : location.path}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {!settingsViewOpen ? (
        <nav className="mobile-command-bar" aria-label={t("app.editorTools")}>
          <button
            aria-label={
              directoryPaneOpen ? t("directory.bookmark.close") : t("directory.bookmark.open")
            }
            aria-pressed={directoryPaneOpen}
            className={directoryPaneOpen ? "is-active" : ""}
            onClick={toggleMobileFilesPane}
            type="button"
          >
            <MobileFilesIcon />
            <span>{t("app.documents")}</span>
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
            <span>{t("mobileToolbar.note")}</span>
          </button>
          <button
            aria-expanded={mobileDataSourceOpen}
            aria-label={t("mobileDataSource.open", { source: mobileDataSourceLabel })}
            className={`mobile-command-bar__source ${
              mobileDataSourceOpen || mobileLocationAvailable ? "is-active" : ""
            }`}
            onClick={() => setMobileDataSourceOpen((currentOpen) => !currentOpen)}
            type="button"
          >
            <span className="mobile-command-bar__source-content">
              <MobileToolbarCloudIcon />
              <span
                className={`mobile-command-bar__source-status ${
                  mobileLocationAvailable ? "is-connected" : "is-disconnected"
                }`}
              >
                {mobileDataSourceLabel}
              </span>
            </span>
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
            <span>{t("mobileToolbar.terms")}</span>
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
            <span>
              {t("noteLibrary.bookmark.label")}
              {noteLibraryNotes.length > 0 ? ` ${noteLibraryNotes.length}` : ""}
            </span>
          </button>
        </nav>
      ) : null}

      {storageFeedbackVisible ? (
        <div className="mobile-feedback-backdrop mobile-storage-loading-overlay">
          <p
            className={`mobile-feedback-surface mobile-storage-status ${
              storageLoading ? "is-loading" : dropboxConnecting ? "is-informational" : "is-error"
            }`}
            role="status"
          >
            {storageError}
          </p>
        </div>
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
                floatingNotePanelExpanded || isMobileViewport ? "is-passive" : ""
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
            } ${floatingPanelIsGlossaryCreate ? "is-glossary-create" : ""}`}
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
                  {floatingCopyActionKey ? (
                    <button
                      className={`floating-note-copy-button ${
                        copiedNoteActionKey === floatingCopyActionKey
                          ? "is-copy-success"
                          : ""
                      }`}
                      type="button"
                      aria-label={
                        copiedNoteActionKey === floatingCopyActionKey
                          ? floatingCopySuccessLabel
                          : floatingCopyLabel
                      }
                      title={
                        copiedNoteActionKey === floatingCopyActionKey
                          ? floatingCopySuccessLabel
                          : floatingCopyLabel
                      }
                      onClick={(event) => {
                        clearTouchButtonFocus(event.currentTarget);
                        void copyTextContent(floatingCopyContent, floatingCopyActionKey);
                      }}
                    >
                      {copiedNoteActionKey === floatingCopyActionKey ? (
                        <FloatingNoteCheckIcon />
                      ) : (
                        <FloatingNoteCopyIcon />
                      )}
                    </button>
                  ) : null}
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
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={toggleFloatingNotePanelExpanded}
                    >
                      {floatingNotePanelExpanded ? (
                        <FloatingNoteCollapseIcon />
                      ) : (
                        <FloatingNoteExpandIcon />
                      )}
                    </button>
                  ) : null}
                  <button
                    className="floating-note-close-button"
                    type="button"
                    aria-label={t("note.close")}
                    onPointerDown={flushActiveNoteMarkdownEditor}
                    onClick={closeNotePanel}
                  >
                    <FloatingNoteCloseIcon />
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
                    mermaidErrorLabel={t("mermaid.error")}
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
                      autoFocusOnEdit={noteEditorShouldRefocusRef.current}
                      className="floating-note-card__editor"
                      editing={activeNoteEditorKey === noteEditorKey("floating", activeNote.id)}
                      editorRootRef={(element) => {
                        noteEditorRootRef.current = element;
                      }}
                      mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                      mermaidErrorLabel={t("mermaid.error")}
                      mermaidLoadingLabel={t("mermaid.loading")}
                      value={activeNote.body}
                      placeholder={t("note.placeholder")}
                      onChange={updateActiveNoteDraft}
                      onCompositionStart={handleNoteEditorCompositionStart}
                      onCompositionEnd={handleNoteEditorCompositionEnd}
                      onEditingBlur={() =>
                        finishNoteEditorEditing(noteEditorKey("floating", activeNote.id))
                      }
                      onKeyDown={handleNoteEditorKeyDown}
                      onRequestEdit={() => {
                        noteEditorShouldRefocusRef.current = true;
                        setActiveNoteEditorKey(noteEditorKey("floating", activeNote.id));
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {!pendingAnchor && activeGlossaryTerm ? (
                <div className="floating-note-card__body-shell">
                  <div className="floating-note-card__body-measure">
                    <NoteMarkdownEditor
                      ariaLabel={t("glossary.edit")}
                      autoFocusOnEdit={noteEditorShouldRefocusRef.current}
                      className="floating-note-card__editor floating-note-card__editor--glossary"
                      editing={activeGlossaryIsEditing}
                      editorRootRef={(element) => {
                        noteEditorRootRef.current = element;
                      }}
                      mermaidEmptyDefinitionLabel={t("mermaid.empty")}
                      mermaidErrorLabel={t("mermaid.error")}
                      mermaidLoadingLabel={t("mermaid.loading")}
                      value={glossaryDraft}
                      onChange={updateActiveGlossaryDraft}
                      onCompositionStart={handleNoteEditorCompositionStart}
                      onCompositionEnd={handleNoteEditorCompositionEnd}
                      onKeyDown={handleNoteEditorKeyDown}
                      onRequestEdit={() => openGlossaryEditor(activeGlossaryTerm.id)}
                    />
                  </div>
                </div>
              ) : null}

              {!pendingAnchor && activeGlossaryTerm ? (
                <div
                  aria-hidden={activeGlossaryIsEditing || undefined}
                  className={`note-actions bottom-note-actions ${
                    activeGlossaryIsEditing ? "is-layout-placeholder" : ""
                  }`}
                >
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
