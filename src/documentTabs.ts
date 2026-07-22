export function documentTabIdsAfterClosingOthers(
  openDocumentTabIds: string[],
  documentId: string,
) {
  return openDocumentTabIds.includes(documentId) ? [documentId] : openDocumentTabIds;
}
