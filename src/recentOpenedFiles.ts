import { localPathsMatch, workspacePathIsInsideDirectory } from "./workspacePaths.ts";

export type RecentOpenedFileSource = "local" | "dropbox";

export type RecentOpenedFile = {
  source: RecentOpenedFileSource;
  path: string;
};

export const recentOpenedFilesStorageKey = "scholium:recent-opened-files";

// Enough history to remember the last file of every folder a person keeps returning to.
export const recentOpenedFilesLimit = 200;

/** A missing Dropbox path is permanent; connection and authorization errors are not. */
export function dropboxRecentPathIsMissing(message: string) {
  return message.includes("Dropbox returned HTTP 409") && message.includes("not_found");
}

function recentOpenedFilePathsMatch(
  source: RecentOpenedFileSource,
  left: string,
  right: string,
) {
  if (source === "local") return localPathsMatch(left, right);

  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isRecentOpenedFile(value: unknown): value is RecentOpenedFile {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<RecentOpenedFile>;
  return (
    (candidate.source === "local" || candidate.source === "dropbox") &&
    typeof candidate.path === "string" &&
    candidate.path.trim().length > 0
  );
}

export function parseRecentOpenedFiles(rawValue: string | null): RecentOpenedFile[] {
  if (!rawValue) return [];

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .filter(isRecentOpenedFile)
      .map((file) => ({ source: file.source, path: file.path.trim() }))
      .slice(0, recentOpenedFilesLimit);
  } catch {
    return [];
  }
}

export function recentOpenedFilesWithout(
  files: RecentOpenedFile[],
  source: RecentOpenedFileSource,
  path: string,
) {
  return files.filter(
    (file) => file.source !== source || !recentOpenedFilePathsMatch(source, file.path, path),
  );
}

/** Moves the opened file to the front, so each folder resolves to its most recent file. */
export function recentOpenedFilesAfterOpening(
  files: RecentOpenedFile[],
  source: RecentOpenedFileSource,
  path: string,
  limit = recentOpenedFilesLimit,
) {
  const trimmedPath = path.trim();
  if (!trimmedPath) return files;

  return [
    { source, path: trimmedPath },
    ...recentOpenedFilesWithout(files, source, trimmedPath),
  ].slice(0, limit);
}

/** Returns the most recently opened file anywhere below the folder, or "" when none was opened. */
export function lastOpenedFileInDirectory(
  files: RecentOpenedFile[],
  source: RecentOpenedFileSource,
  directoryPath: string,
) {
  const isDropboxRoot = source === "dropbox" && !directoryPath.replace(/^\/+|\/+$/g, "").trim();

  return (
    files.find(
      (file) =>
        file.source === source &&
        (isDropboxRoot ||
          (!recentOpenedFilePathsMatch(source, file.path, directoryPath) &&
            workspacePathIsInsideDirectory(file.path, directoryPath, source))),
    )?.path ?? ""
  );
}

/** Returns whichever candidate was opened most recently, or "" when none of them was. */
export function lastOpenedFileAmong(
  files: RecentOpenedFile[],
  source: RecentOpenedFileSource,
  candidatePaths: string[],
) {
  for (const file of files) {
    if (file.source !== source) continue;

    const candidatePath = candidatePaths.find((path) =>
      recentOpenedFilePathsMatch(source, file.path, path),
    );
    if (candidatePath) return candidatePath;
  }

  return "";
}
