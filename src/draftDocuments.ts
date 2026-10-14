import type { WorkspaceSource } from "./tauriGateway.ts";

const draftDocumentIdPrefix = "draft:";

export function draftDocumentId(source: WorkspaceSource | null) {
  return `${draftDocumentIdPrefix}${source ?? "local"}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function isDraftDocumentId(documentId: string) {
  return documentId.startsWith(draftDocumentIdPrefix);
}

export function draftDocumentSource(documentId: string): WorkspaceSource {
  return documentId.startsWith(`${draftDocumentIdPrefix}dropbox:`) ? "dropbox" : "local";
}

export function draftDocumentHasContent(
  body: string,
  noteCount: number,
  glossaryBindingCount: number,
) {
  return Boolean(body.trim() || noteCount > 0 || glossaryBindingCount > 0);
}

export type StoredDraftDocument<Note, GlossaryTerm, GlossaryBinding> = {
  version: 1;
  id: string;
  title: string;
  body: string;
  notes: Note[];
  glossaryTerms: GlossaryTerm[];
  glossaryBindings: GlossaryBinding[];
};

export function serializeStoredDraftDocument<Note, GlossaryTerm, GlossaryBinding>(
  draft: Omit<StoredDraftDocument<Note, GlossaryTerm, GlossaryBinding>, "version">,
) {
  return JSON.stringify({ version: 1, ...draft });
}

export function parseStoredDraftDocument<Note, GlossaryTerm, GlossaryBinding>(
  contents: string,
): StoredDraftDocument<Note, GlossaryTerm, GlossaryBinding> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const draft = parsed as Record<string, unknown>;
  if (
    draft.version !== 1 ||
    typeof draft.id !== "string" ||
    !isDraftDocumentId(draft.id) ||
    typeof draft.title !== "string" ||
    typeof draft.body !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    id: draft.id,
    title: draft.title,
    body: draft.body,
    notes: Array.isArray(draft.notes) ? (draft.notes as Note[]) : [],
    glossaryTerms: Array.isArray(draft.glossaryTerms)
      ? (draft.glossaryTerms as GlossaryTerm[])
      : [],
    glossaryBindings: Array.isArray(draft.glossaryBindings)
      ? (draft.glossaryBindings as GlossaryBinding[])
      : [],
  };
}

/** Draft ids embed their creation time: `draft:<source>:<milliseconds>:<random>`. */
export function draftDocumentCreatedAt(documentId: string) {
  const createdAt = Number(documentId.split(":")[2]);
  return Number.isFinite(createdAt) ? createdAt : 0;
}
