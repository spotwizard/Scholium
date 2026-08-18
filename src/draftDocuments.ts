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
