export function availableDocumentTabIds(
  documentTabIds: string[],
  availableDocumentIds: string[],
) {
  const availableIds = new Set(availableDocumentIds);
  const nextIds: string[] = [];
  const seenIds = new Set<string>();

  documentTabIds.forEach((documentId) => {
    if (!availableIds.has(documentId) || seenIds.has(documentId)) return;

    nextIds.push(documentId);
    seenIds.add(documentId);
  });

  return nextIds;
}

export function documentTabIdsAfterOpening(
  openDocumentTabIds: string[],
  activeDocumentId: string,
  documentId: string,
  mode: "add" | "replace",
  availableDocumentIds: string[],
) {
  if (mode === "replace" && openDocumentTabIds.includes(documentId)) {
    return openDocumentTabIds;
  }

  if (mode === "add") {
    return availableDocumentTabIds(
      [...openDocumentTabIds, documentId],
      availableDocumentIds,
    );
  }

  const activeIndex = openDocumentTabIds.indexOf(activeDocumentId);
  if (activeIndex < 0) {
    return availableDocumentTabIds(
      openDocumentTabIds.length > 0
        ? [documentId, ...openDocumentTabIds]
        : [documentId],
      availableDocumentIds,
    );
  }

  const nextIds = [...openDocumentTabIds];
  nextIds[activeIndex] = documentId;
  return availableDocumentTabIds(nextIds, availableDocumentIds);
}

export type DocumentTabTransition = {
  openDocumentTabIds: string[];
  nextActiveDocumentId?: string | null;
};

export function documentTabsAfterClosing(
  openDocumentTabIds: string[],
  activeDocumentId: string,
  documentId: string,
): DocumentTabTransition {
  const closedIndex = openDocumentTabIds.indexOf(documentId);
  if (closedIndex < 0) {
    return { openDocumentTabIds };
  }

  const nextIds = openDocumentTabIds.filter((currentId) => currentId !== documentId);
  if (documentId !== activeDocumentId) {
    return { openDocumentTabIds: nextIds };
  }

  return {
    openDocumentTabIds: nextIds,
    nextActiveDocumentId:
      nextIds.length === 0
        ? null
        : nextIds[Math.min(closedIndex, nextIds.length - 1)],
  };
}

export function documentTabsAfterClosingOthers(
  openDocumentTabIds: string[],
  activeDocumentId: string,
  documentId: string,
): DocumentTabTransition {
  if (!openDocumentTabIds.includes(documentId)) {
    return { openDocumentTabIds };
  }

  return {
    openDocumentTabIds: [documentId],
    ...(activeDocumentId === documentId
      ? {}
      : { nextActiveDocumentId: documentId }),
  };
}

export type DocumentTabHitTarget = {
  documentId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function documentTabIdAtPoint(
  targets: DocumentTabHitTarget[],
  clientX: number,
  clientY: number,
  fallbackDocumentId: string,
) {
  return (
    targets.find(
      (target) =>
        clientX >= target.left &&
        clientX < target.right &&
        clientY >= target.top &&
        clientY < target.bottom,
    )?.documentId ?? fallbackDocumentId
  );
}

export function documentTabClickSelection(
  pointerActivatedDocumentId: string,
  clickedDocumentId: string,
  pointerTriggeredClick: boolean,
) {
  const pointerDocumentId = pointerTriggeredClick ? pointerActivatedDocumentId : "";
  return {
    documentId: pointerDocumentId || clickedDocumentId,
    shouldSelect: !pointerDocumentId,
  };
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
