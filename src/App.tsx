import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import "./App.css";
import {
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

const markdownFilters = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown"],
  },
];

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

function summarizeText(text: string, maxLength = 150) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}...`
    : normalized;
}

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
  const [activeNoteId, setActiveNoteId] = useState("note-1");
  const [dirtyDocumentIds, setDirtyDocumentIds] = useState<Set<string>>(new Set());
  const [storageError, setStorageError] = useState("");
  const [isSavingFile, setIsSavingFile] = useState(false);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];

  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const nativeStorageAvailable = hasNativeStorageAccess();
  const activeNotes = documentNotes.filter((note) => note.status === "active");
  const orphanedNotes = documentNotes.filter((note) => note.status === "orphaned");
  const activeNote = documentNotes.find((note) => note.id === activeNoteId);
  const selectedDocumentIsDirty = dirtyDocumentIds.has(selectedDocument.id);

  const annotations: TextAnnotation[] = activeNotes.map((note) => ({
    id: note.id,
    from: note.anchor.from,
    to: note.anchor.to,
  }));
  const canSaveSelectionNote = Boolean(pendingAnchor && noteDraft.trim());

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

  function markDocumentDirty(documentId = selectedDocument.id) {
    setDirtyDocumentIds((currentIds) => new Set(currentIds).add(documentId));
  }

  function markDocumentClean(documentId: string) {
    setDirtyDocumentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(documentId);
      return nextIds;
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
    setActiveNoteId(
      loadedNotes.find((note) => note.documentId === firstDocument.id && note.status !== "deleted")
        ?.id ?? "",
    );
    loadedDocuments.forEach((document) => markDocumentClean(document.id));
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
    loadedDocuments.forEach((document) => markDocumentClean(document.id));

    if (documentToSelect) {
      setSelectedDocumentId(documentToSelect.id);
      setActiveNoteId(
        loadedNotes.find(
          (note) => note.documentId === documentToSelect.id && note.status !== "deleted",
        )?.id ?? "",
      );
    } else {
      setActiveNoteId("");
    }

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
      markDocumentClean(selectedDocument.id);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingFile(false);
    }
  }

  function updateSelectedDocumentBody(body: string) {
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === selectedDocument.id ? { ...document, body } : document,
      ),
    );
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.documentId === selectedDocument.id ? reconcileNote(note, body) : note,
      ),
    );
    markDocumentDirty();
  }

  function selectDocument(documentId: string) {
    const nextDocument = documents.find((document) => document.id === documentId);
    if (!nextDocument) return;

    setSelectedDocumentId(documentId);
    setPendingAnchor(null);
    setNoteDraft("");
    setStorageError("");
    setActiveNoteId(
      notes.find((note) => note.documentId === documentId && note.status !== "deleted")?.id ?? "",
    );
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
    setActiveNoteId(note.id);
    setPendingAnchor(null);
    setNoteDraft("");
    markDocumentDirty();
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
    markDocumentDirty();
  }

  function deleteNote(noteId: string) {
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
      setActiveNoteId("");
    }
    markDocumentDirty();
  }

  function rebindNote(noteId: string) {
    if (!pendingAnchor) return;

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              status: "active",
              selectedText: pendingAnchor.selectedText,
              anchor: pendingAnchor,
              updatedAt: nowLabel(),
            }
          : note,
      ),
    );
    setActiveNoteId(noteId);
    setPendingAnchor(null);
    markDocumentDirty();
  }

  return (
    <main className="scholium-shell">
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
            <button type="button">Preview</button>
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
            <MarkdownEditor
              annotations={annotations}
              value={selectedDocument.body}
              onAnnotationClick={setActiveNoteId}
              onChange={updateSelectedDocumentBody}
              onSelectionChange={setPendingAnchor}
            />

            {pendingAnchor ? (
              <div className="selection-popover">
                <p className="eyebrow">Selection</p>
                <blockquote>{summarizeText(pendingAnchor.selectedText, 96)}</blockquote>
                <textarea
                  aria-label="Selection note"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.currentTarget.value)}
                  placeholder="Add a note..."
                />
                <div className="popover-actions">
                  <button type="button" onClick={() => setPendingAnchor(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createNoteFromSelection}
                    disabled={!canSaveSelectionNote}
                  >
                    Save note
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="notes-pane" aria-label="Selection notes">
        <div className="pane-header notes-header">
          <div>
            <p className="eyebrow">Text notes</p>
            <h2>{activeNote ? summarizeText(activeNote.selectedText, 54) : "No note selected"}</h2>
          </div>
          <span className="note-count">{activeNotes.length}</span>
        </div>

        {activeNote ? (
          <div className="note-editor">
            <p className="eyebrow">{activeNote.status}</p>
            <blockquote>{activeNote.selectedText}</blockquote>
            <textarea
              aria-label="Edit note"
              value={activeNote.body}
              onChange={(event) => updateNoteBody(activeNote.id, event.currentTarget.value)}
            />
            <div className="note-actions">
              {activeNote.status === "orphaned" ? (
                <button
                  type="button"
                  onClick={() => rebindNote(activeNote.id)}
                  disabled={!pendingAnchor}
                >
                  Rebind
                </button>
              ) : null}
              <button type="button" onClick={() => deleteNote(activeNote.id)}>
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-notes">No active note.</div>
        )}

        {orphanedNotes.length > 0 ? (
          <div className="orphaned-notes">
            <p className="eyebrow">Unbound notes</p>
            {orphanedNotes.map((note) => (
              <button
                className={`note-link ${note.id === activeNoteId ? "is-active" : ""}`}
                key={note.id}
                onClick={() => setActiveNoteId(note.id)}
                type="button"
              >
                <span>{note.selectedText}</span>
                <small>{note.body}</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="document-note-index">
          <p className="eyebrow">Marked ranges</p>
          {activeNotes.map((note) => (
            <button
              className={`note-link ${note.id === activeNoteId ? "is-active" : ""}`}
              key={note.id}
              onClick={() => setActiveNoteId(note.id)}
              type="button"
            >
              <span>{note.selectedText}</span>
              <small>{note.body}</small>
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}

export default App;
