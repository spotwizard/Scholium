import { useMemo, useState } from "react";
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
  updatedAt: string;
  body: string;
};

type MarkdownBlock = {
  id: string;
  type: string;
  title: string;
  preview: string;
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

const documentsSeed: MarkdownDocument[] = [
  {
    id: "roadmap",
    title: "Scholium Roadmap",
    path: "workspace/roadmap.md",
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

function getBlockType(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("#")) return "Heading";
  if (trimmed.startsWith(">")) return "Quote";
  if (trimmed.startsWith("```")) return "Code";
  if (/^[-*]\s/.test(trimmed)) return "List";
  return "Paragraph";
}

function getBlockTitle(text: string) {
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.replace(/^#+\s*/, "").replace(/^[-*>]\s*/, "") || "Untitled block";
}

function parseMarkdownBlocks(documentId: string, markdown: string): MarkdownBlock[] {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => ({
    id: `${documentId}-block-${index + 1}`,
    type: getBlockType(block),
    title: getBlockTitle(block),
    preview: summarizeText(block),
  }));
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

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0].id);
  const [activeBlockId, setActiveBlockId] = useState("roadmap-block-2");
  const [notes, setNotes] = useState(notesSeed);
  const [pendingAnchor, setPendingAnchor] = useState<TextSelectionAnchor | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [activeNoteId, setActiveNoteId] = useState("note-1");

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];

  const blocks = useMemo(
    () => parseMarkdownBlocks(selectedDocument.id, selectedDocument.body),
    [selectedDocument],
  );

  const activeBlock = blocks.find((block) => block.id === activeBlockId) ?? blocks[0];
  const documentNotes = notes.filter(
    (note) => note.documentId === selectedDocument.id && note.status !== "deleted",
  );
  const activeNotes = documentNotes.filter((note) => note.status === "active");
  const orphanedNotes = documentNotes.filter((note) => note.status === "orphaned");
  const activeNote = documentNotes.find((note) => note.id === activeNoteId);

  const annotations: TextAnnotation[] = activeNotes.map((note) => ({
    id: note.id,
    from: note.anchor.from,
    to: note.anchor.to,
  }));
  const canSaveSelectionNote = Boolean(pendingAnchor && noteDraft.trim());

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
  }

  function selectDocument(documentId: string) {
    const nextDocument = documents.find((document) => document.id === documentId);
    if (!nextDocument) return;

    setSelectedDocumentId(documentId);
    setActiveBlockId(`${nextDocument.id}-block-1`);
    setPendingAnchor(null);
    setNoteDraft("");
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
  }

  return (
    <main className="scholium-shell">
      <aside className="document-pane" aria-label="Documents">
        <div className="pane-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Scholium</h1>
          </div>
          <button className="icon-button" type="button" aria-label="Create document">
            +
          </button>
        </div>

        <div className="document-list">
          {documents.map((document) => (
            <button
              className={`document-row ${
                document.id === selectedDocument.id ? "is-selected" : ""
              }`}
              key={document.id}
              onClick={() => selectDocument(document.id)}
              type="button"
            >
              <span className="document-title">{document.title}</span>
              <span className="document-path">{document.path}</span>
              <span className="document-meta">{document.updatedAt}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="editor-pane" aria-label="Markdown editor">
        <header className="editor-header">
          <div>
            <p className="eyebrow">{selectedDocument.path}</p>
            <h2>{selectedDocument.title}</h2>
          </div>
          <div className="editor-actions" aria-label="Editor actions">
            <button type="button">Preview</button>
            <button type="button">Save</button>
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

          <div className="block-map" aria-label="Markdown blocks">
            {blocks.map((block) => (
              <button
                className={`block-row ${block.id === activeBlock?.id ? "is-active" : ""}`}
                key={block.id}
                onClick={() => setActiveBlockId(block.id)}
                type="button"
              >
                <span className="block-type">{block.type}</span>
                <span className="block-title">{block.title}</span>
                <span className="block-preview">{block.preview}</span>
              </button>
            ))}
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
