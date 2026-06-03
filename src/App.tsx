import { useMemo, useState } from "react";
import "./App.css";

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

type BlockNote = {
  id: string;
  documentId: string;
  blockId: string;
  body: string;
  createdAt: string;
};

const documentsSeed: MarkdownDocument[] = [
  {
    id: "roadmap",
    title: "Scholium Roadmap",
    path: "workspace/roadmap.md",
    updatedAt: "Today",
    body: `# Scholium Roadmap

Scholium is a Markdown writing space for reading, drafting, and keeping block-level notes beside the source text.

## MVP Scope

The first product surface keeps documents, the editor, and notes visible at the same time.

## Block Notes

Notes belong to a Markdown block instead of the entire file, so a comment can stay close to the heading, paragraph, quote, or code sample that triggered it.`,
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

Define the first release around a calm editor, reliable local files, and notes that attach to blocks.

## Decisions

- Build the shell with Tauri
- Keep the first editor simple
- Add block anchoring after the layout is stable`,
  },
];

const notesSeed: BlockNote[] = [
  {
    id: "note-1",
    documentId: "roadmap",
    blockId: "roadmap-block-2",
    body: "This should become the first end-to-end workflow after the editor lands.",
    createdAt: "09:40",
  },
  {
    id: "note-2",
    documentId: "research",
    blockId: "research-block-3",
    body: "Sidecar storage keeps the Markdown file portable for other tools.",
    createdAt: "10:15",
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

function App() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [selectedDocumentId, setSelectedDocumentId] = useState(documentsSeed[0].id);
  const [activeBlockId, setActiveBlockId] = useState("roadmap-block-2");
  const [notes, setNotes] = useState(notesSeed);
  const [noteDraft, setNoteDraft] = useState("");

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];

  const blocks = useMemo(
    () => parseMarkdownBlocks(selectedDocument.id, selectedDocument.body),
    [selectedDocument],
  );

  const activeBlock = blocks.find((block) => block.id === activeBlockId) ?? blocks[0];
  const documentNotes = notes.filter((note) => note.documentId === selectedDocument.id);
  const activeBlockNotes = activeBlock
    ? documentNotes.filter((note) => note.blockId === activeBlock.id)
    : [];

  function updateSelectedDocumentBody(body: string) {
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === selectedDocument.id ? { ...document, body } : document,
      ),
    );
  }

  function selectDocument(documentId: string) {
    const nextDocument = documents.find((document) => document.id === documentId);
    if (!nextDocument) return;

    setSelectedDocumentId(documentId);
    setActiveBlockId(`${nextDocument.id}-block-1`);
    setNoteDraft("");
  }

  function createNote() {
    const body = noteDraft.trim();
    if (!body || !activeBlock) return;

    setNotes((currentNotes) => [
      {
        id: crypto.randomUUID(),
        documentId: selectedDocument.id,
        blockId: activeBlock.id,
        body,
        createdAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...currentNotes,
    ]);
    setNoteDraft("");
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
          <textarea
            aria-label="Markdown source"
            className="markdown-editor"
            value={selectedDocument.body}
            onChange={(event) => updateSelectedDocumentBody(event.currentTarget.value)}
            spellCheck="false"
            wrap="soft"
          />

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

      <aside className="notes-pane" aria-label="Block notes">
        <div className="pane-header notes-header">
          <div>
            <p className="eyebrow">{activeBlock?.type ?? "Block"}</p>
            <h2>{activeBlock?.title ?? "No block selected"}</h2>
          </div>
          <span className="note-count">{activeBlockNotes.length}</span>
        </div>

        <div className="note-composer">
          <textarea
            aria-label="New block note"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.currentTarget.value)}
            placeholder="Add a note..."
          />
          <button type="button" onClick={createNote} disabled={!noteDraft.trim()}>
            Add note
          </button>
        </div>

        <div className="note-list">
          {activeBlockNotes.length > 0 ? (
            activeBlockNotes.map((note) => (
              <article className="note-item" key={note.id}>
                <p>{note.body}</p>
                <time>{note.createdAt}</time>
              </article>
            ))
          ) : (
            <div className="empty-notes">No notes for this block.</div>
          )}
        </div>

        <div className="document-note-index">
          <p className="eyebrow">Document notes</p>
          {documentNotes.map((note) => {
            const block = blocks.find((item) => item.id === note.blockId);

            return (
              <button
                className={`note-link ${note.blockId === activeBlock?.id ? "is-active" : ""}`}
                key={note.id}
                onClick={() => setActiveBlockId(note.blockId)}
                type="button"
              >
                <span>{block?.title ?? "Unknown block"}</span>
                <small>{note.body}</small>
              </button>
            );
          })}
        </div>
      </aside>
    </main>
  );
}

export default App;
