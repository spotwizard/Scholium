import type { AnnotationTone, TextSelectionAnchor } from "./editorTypes";

export type NoteStatus = "active" | "orphaned" | "deleted";

export type SelectionNote = {
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

export type GlossaryTerm = {
  id: string;
  term: string;
  normalizedTerm: string;
  definition: string;
  createdAt: string;
  updatedAt: string;
};

export type GlossaryBinding = {
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
