import assert from "node:assert/strict";
import test from "node:test";
import type { GlossaryBinding, GlossaryTerm, SelectionNote } from "../src/documentTypes.ts";
import type { TextSelectionAnchor } from "../src/editorTypes.ts";
import {
  loadedGlossaryBindingForDocument,
  loadedNoteForDocument,
  projectLoadedLocalFiles,
} from "../src/loadedFileProjection.ts";
import type { OpenMarkdownFileResult } from "../src/tauriGateway.ts";

const anchor: TextSelectionAnchor = {
  from: 0,
  to: 2,
  selectedText: "",
  prefix: "",
  suffix: "",
};
const note: SelectionNote = {
  id: "note-1",
  documentId: "stale-document",
  status: "active",
  selectedText: "圈選",
  anchor,
  body: "筆記",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  deletedAt: null,
};
const binding: GlossaryBinding = {
  id: "binding-1",
  documentId: "stale-document",
  termId: "term-1",
  term: "名詞",
  normalizedTerm: "名詞",
  status: "active",
  anchor,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  deletedAt: null,
};
const term: GlossaryTerm = {
  id: "term-1",
  term: "名詞",
  normalizedTerm: "名詞",
  definition: "解釋",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};
const loadedFile: OpenMarkdownFileResult = {
  path: "/notes/article.md",
  notesPath: "/private/article.notes.json",
  title: "article.md",
  modifiedAt: 123,
  body: "圈選本文",
  notes: [note],
  glossaryTerms: [term],
  glossaryBindings: [binding],
};
const recoverAnchor = (body: string, sourceAnchor: TextSelectionAnchor) => ({
  ...sourceAnchor,
  from: sourceAnchor.from + 1,
  to: sourceAnchor.to + 1,
  selectedText: `${body}:${sourceAnchor.selectedText}`,
});

test("local loaded files project documents and sidecars with the file identity", () => {
  const projected = projectLoadedLocalFiles([loadedFile], recoverAnchor);

  assert.deepEqual(projected.loadedDocuments, [
    {
      id: loadedFile.path,
      title: loadedFile.title,
      path: loadedFile.path,
      filePath: loadedFile.path,
      notesPath: loadedFile.notesPath,
      updatedAt: "",
      modifiedAt: 123,
      body: loadedFile.body,
    },
  ]);
  assert.deepEqual([...projected.loadedDocumentIds], [loadedFile.path]);
  assert.equal(projected.loadedNotes[0]?.documentId, loadedFile.path);
  assert.equal(projected.loadedNotes[0]?.selectedText, note.selectedText);
  assert.deepEqual(projected.loadedNotes[0]?.anchor, {
    ...anchor,
    from: 1,
    to: 3,
    selectedText: `${loadedFile.body}:${note.selectedText}`,
  });
  assert.equal(projected.loadedGlossaryBindings[0]?.documentId, loadedFile.path);
  assert.equal(projected.loadedGlossaryBindings[0]?.anchor.from, 1);
  assert.deepEqual(projected.loadedGlossaryTerms, [term]);
});

test("local and Dropbox hydration use the caller's document identity", () => {
  const localNote = loadedNoteForDocument(
    loadedFile,
    note,
    loadedFile.path,
    recoverAnchor,
  );
  const dropboxNote = loadedNoteForDocument(
    loadedFile,
    note,
    "dropbox:/notes/article.md",
    recoverAnchor,
  );
  const dropboxBinding = loadedGlossaryBindingForDocument(
    loadedFile,
    binding,
    "dropbox:/notes/article.md",
    recoverAnchor,
  );

  assert.equal(localNote.documentId, loadedFile.path);
  assert.equal(dropboxNote.documentId, "dropbox:/notes/article.md");
  assert.equal(dropboxBinding.documentId, "dropbox:/notes/article.md");
  assert.equal(dropboxNote.anchor.selectedText, `${loadedFile.body}:${note.selectedText}`);
});
