import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  createElement,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
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
      kind: "paragraph" | "quote" | "code";
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

function makePreviewAnchor(
  body: string,
  block: MarkdownPreviewBlock | undefined,
  selectedText: string,
) {
  const normalizedSelection = selectedText.replace(/\s+/g, " ").trim();
  if (!normalizedSelection) return null;

  if (block) {
    const blockRange = getBlockRange(body, block);
    const blockSource = body.slice(blockRange.start, blockRange.end);
    const blockIndex = blockSource.indexOf(normalizedSelection);

    if (blockIndex >= 0) {
      const from = blockRange.start + blockIndex;
      return makeAnchorFromRange(body, from, from + normalizedSelection.length, normalizedSelection);
    }
  }

  const fallbackIndex = body.indexOf(normalizedSelection);
  if (fallbackIndex < 0) return null;

  return makeAnchorFromRange(
    body,
    fallbackIndex,
    fallbackIndex + normalizedSelection.length,
    normalizedSelection,
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

function renderAnnotatedPlainText(
  text: string,
  keyPrefix: string,
  notes: SelectionNote[],
  onAnnotationClick: (noteId: string) => void,
) {
  const ranges = notes
    .map((note) => ({
      note,
      start: text.indexOf(note.selectedText),
      end: text.indexOf(note.selectedText) + note.selectedText.length,
    }))
    .filter((range) => range.start >= 0 && range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, rangeIndex) => {
    if (range.start < cursor) return;

    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }

    nodes.push(
      <span
        className="preview-note-annotation"
        data-note-id={range.note.id}
        key={`${keyPrefix}-note-${rangeIndex}`}
        onClick={(event) => {
          event.stopPropagation();
          onAnnotationClick(range.note.id);
        }}
      >
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderPreviewInline(
  text: string,
  keyPrefix: string,
  notes: SelectionNote[],
  onAnnotationClick: (noteId: string) => void,
) {
  if (notes.length === 0) {
    return renderInlineMarkdown(text, keyPrefix);
  }

  const ranges = notes
    .map((note) => ({
      note,
      start: text.indexOf(note.selectedText),
      end: text.indexOf(note.selectedText) + note.selectedText.length,
    }))
    .filter((range) => range.start >= 0 && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  if (ranges.length === 0) {
    return renderInlineMarkdown(text, keyPrefix);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, rangeIndex) => {
    if (range.start < cursor) return;

    if (range.start > cursor) {
      nodes.push(...renderInlineMarkdown(text.slice(cursor, range.start), `${keyPrefix}-before-${rangeIndex}`));
    }

    nodes.push(
      <span
        className="preview-note-annotation"
        data-note-id={range.note.id}
        key={`${keyPrefix}-note-${rangeIndex}`}
        onClick={(event) => {
          event.stopPropagation();
          onAnnotationClick(range.note.id);
        }}
      >
        {renderInlineMarkdown(text.slice(range.start, range.end), `${keyPrefix}-marked-${rangeIndex}`)}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(...renderInlineMarkdown(text.slice(cursor), `${keyPrefix}-after`));
  }

  return nodes;
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
}: {
  block: MarkdownPreviewBlock;
  markdown: string;
  notes: SelectionNote[];
  onChange: (block: MarkdownPreviewBlock, text: string) => void;
  onAnnotationClick: (noteId: string) => void;
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

    return createElement(
      tagName,
      {
        ...editableProps,
        className: "markdown-preview-editable",
      },
      renderPreviewInline(block.text, `${block.key}-heading`, blockNotes, onAnnotationClick),
    );
  }

  if (block.kind === "quote") {
    return (
      <blockquote
        {...editableProps}
        className="markdown-preview-editable"
        key={block.key}
      >
        {block.text.split("\n").map((quoteLine, quoteIndex) => (
          <p key={`${block.key}-quote-${quoteIndex}`}>
            {renderPreviewInline(
              quoteLine,
              `${block.key}-quote-${quoteIndex}`,
              blockNotes,
              onAnnotationClick,
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
        {block.items.map((item, itemIndex) => (
          <li key={`${block.key}-item-${itemIndex}`}>
            {renderPreviewInline(
              item,
              `${block.key}-item-${itemIndex}`,
              blockNotes,
              onAnnotationClick,
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
            block.text,
            `${block.key}-code`,
            blockNotes,
            onAnnotationClick,
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
        {renderPreviewInline(block.text, `${block.key}-paragraph`, blockNotes, onAnnotationClick)}
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
}: {
  value: string;
  notes: SelectionNote[];
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onAnnotationClick: (noteId: string) => void;
}) {
  const blocks = parseMarkdownPreviewBlocks(value);

  function handlePreviewSelection(
    event: MouseEvent<HTMLDivElement> | ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";

    if (!selection || selection.isCollapsed || !selectedText.trim()) {
      onSelectionChange(null);
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const blockElement = target.closest<HTMLElement>("[data-preview-block-key]");
    const block = blocks.find(
      (previewBlock) => previewBlock.key === blockElement?.dataset.previewBlockKey,
    );

    onSelectionChange(makePreviewAnchor(value, block, selectedText));
  }

  function updatePreviewBlock(block: MarkdownPreviewBlock, text: string) {
    const nextBlock = markdownFromPreviewBlock(block, text);
    const nextValue = replaceMarkdownBlock(value, block, nextBlock);

    onChange(nextValue, "user");
  }

  return (
    <div
      className="markdown-preview"
      onKeyUp={handlePreviewSelection}
      onMouseUp={handlePreviewSelection}
    >
      {blocks.map((block) => (
        <MarkdownPreviewBlockView
          block={block}
          key={block.key}
          markdown={value}
          notes={notes}
          onAnnotationClick={onAnnotationClick}
          onChange={updatePreviewBlock}
        />
      ))}
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
  const [activeNoteId, setActiveNoteId] = useState("note-1");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [dirtyDocumentStates, setDirtyDocumentStates] = useState<
    Record<string, DirtyDocumentState>
  >({});
  const [savedDocumentBodies, setSavedDocumentBodies] = useState<Record<string, string>>(() =>
    savedBodiesFromDocuments(documentsSeed),
  );
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
  const selectedDocumentIsDirty = hasDirtyState(dirtyDocumentStates[selectedDocument.id]);

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

  useEffect(() => {
    function handleModeShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;

      event.preventDefault();
      setPendingAnchor(null);
      setNoteDraft("");
      setEditorMode((currentMode) => (currentMode === "preview" ? "edit" : "preview"));
    }

    window.addEventListener("keydown", handleModeShortcut);

    return () => {
      window.removeEventListener("keydown", handleModeShortcut);
    };
  }, []);

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
    setActiveNoteId(
      loadedNotes.find((note) => note.documentId === firstDocument.id && note.status !== "deleted")
        ?.id ?? "",
    );
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
    markLoadedDocumentsClean(loadedDocuments);

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
    markDocumentNotesDirty();
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
    markDocumentNotesDirty();
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
    markDocumentNotesDirty();
  }

  function togglePreviewMode() {
    setPendingAnchor(null);
    setNoteDraft("");
    setEditorMode((currentMode) => (currentMode === "preview" ? "edit" : "preview"));
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
                onAnnotationClick={setActiveNoteId}
                onChange={updateSelectedDocumentBody}
                onSelectionChange={setPendingAnchor}
              />
            ) : (
              <>
                <MarkdownEditor
                  annotations={annotations}
                  value={selectedDocument.body}
                  onAnnotationClick={setActiveNoteId}
                  onChange={updateSelectedDocumentBody}
                  onSelectionChange={setPendingAnchor}
                />

              </>
            )}

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
