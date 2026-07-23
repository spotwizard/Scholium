export function documentTabIdsAfterClosingOthers(
  openDocumentTabIds: string[],
  documentId: string,
) {
  return openDocumentTabIds.includes(documentId) ? [documentId] : openDocumentTabIds;
}

export type DocumentTabSessionSource = "local" | "dropbox";

export type DocumentTabSessionState = {
  version: 1;
  source: DocumentTabSessionSource;
  workspacePath: string;
  openDocumentPaths: string[];
  activeDocumentPath: string;
};

function normalizedDocumentPaths(paths: unknown) {
  if (!Array.isArray(paths)) return [];

  const seenPaths = new Set<string>();
  return paths.flatMap((path) => {
    if (typeof path !== "string") return [];

    const normalizedPath = path.trim();
    if (!normalizedPath || seenPaths.has(normalizedPath)) return [];

    seenPaths.add(normalizedPath);
    return [normalizedPath];
  });
}

export function createDocumentTabSession(
  source: DocumentTabSessionSource,
  workspacePath: string,
  openDocumentPaths: string[],
  activeDocumentPath: string,
): DocumentTabSessionState | null {
  const normalizedOpenPaths = normalizedDocumentPaths(openDocumentPaths);
  if (normalizedOpenPaths.length === 0) return null;

  const normalizedActivePath = activeDocumentPath.trim();
  return {
    version: 1,
    source,
    workspacePath: workspacePath.trim(),
    openDocumentPaths: normalizedOpenPaths,
    activeDocumentPath: normalizedOpenPaths.includes(normalizedActivePath)
      ? normalizedActivePath
      : normalizedOpenPaths[0],
  };
}

export function parseDocumentTabSession(rawValue: string | null) {
  if (!rawValue) return null;

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<DocumentTabSessionState>;
    if (
      parsedValue.version !== 1 ||
      (parsedValue.source !== "local" && parsedValue.source !== "dropbox") ||
      typeof parsedValue.workspacePath !== "string" ||
      typeof parsedValue.activeDocumentPath !== "string"
    ) {
      return null;
    }

    return createDocumentTabSession(
      parsedValue.source,
      parsedValue.workspacePath,
      Array.isArray(parsedValue.openDocumentPaths)
        ? parsedValue.openDocumentPaths.filter(
            (path): path is string => typeof path === "string",
          )
        : [],
      parsedValue.activeDocumentPath,
    );
  } catch {
    return null;
  }
}

export function availableDocumentTabSession(
  session: DocumentTabSessionState,
  availableDocumentPaths: string[],
) {
  const availablePaths = new Set(availableDocumentPaths);
  const openDocumentPaths = session.openDocumentPaths.filter((path) =>
    availablePaths.has(path),
  );

  return {
    openDocumentPaths,
    activeDocumentPath: openDocumentPaths.includes(session.activeDocumentPath)
      ? session.activeDocumentPath
      : (openDocumentPaths[0] ?? ""),
  };
}
