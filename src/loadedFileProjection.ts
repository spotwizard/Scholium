import type { GlossaryBinding, GlossaryTerm, SelectionNote } from "./documentTypes.ts";
import type { TextSelectionAnchor } from "./editorTypes.ts";
import type { OpenMarkdownFileResult } from "./tauriGateway.ts";
import { documentFromLoadedFileResult } from "./workspaceEntries.ts";

type LoadedAnchorRecovery = (
  body: string,
  anchor: TextSelectionAnchor,
) => TextSelectionAnchor;

export function loadedNoteForDocument(
  loadedFile: { body: string },
  note: SelectionNote,
  documentId: string,
  recoverAnchor: LoadedAnchorRecovery,
) {
  const anchorSourceText = note.anchor.selectedText || note.selectedText;
  const anchor = recoverAnchor(loadedFile.body, {
    ...note.anchor,
    selectedText: anchorSourceText,
  });

  return {
    ...note,
    documentId,
    selectedText: note.selectedText || anchor.selectedText,
    anchor,
  };
}

export function loadedGlossaryBindingForDocument(
  loadedFile: { body: string },
  binding: GlossaryBinding,
  documentId: string,
  recoverAnchor: LoadedAnchorRecovery,
) {
  return {
    ...binding,
    documentId,
    anchor: recoverAnchor(loadedFile.body, binding.anchor),
  };
}

export function projectLoadedLocalFiles(
  loadedFiles: OpenMarkdownFileResult[],
  recoverAnchor: LoadedAnchorRecovery,
) {
  const loadedDocuments = loadedFiles.map(documentFromLoadedFileResult);

  return {
    loadedDocuments,
    loadedDocumentIds: new Set(loadedDocuments.map((document) => document.id)),
    loadedNotes: loadedFiles.flatMap((loadedFile) =>
      loadedFile.notes.map((note) =>
        loadedNoteForDocument(loadedFile, note, loadedFile.path, recoverAnchor),
      ),
    ),
    loadedGlossaryBindings: loadedFiles.flatMap((loadedFile) =>
      (loadedFile.glossaryBindings ?? []).map((binding) =>
        loadedGlossaryBindingForDocument(
          loadedFile,
          binding,
          loadedFile.path,
          recoverAnchor,
        ),
      ),
    ),
    loadedGlossaryTerms: loadedFiles.flatMap(
      (loadedFile): GlossaryTerm[] => loadedFile.glossaryTerms ?? [],
    ),
  };
}
