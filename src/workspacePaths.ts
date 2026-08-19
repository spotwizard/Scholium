export const dropboxDocumentIdPrefix = "dropbox:";
const markdownExtensionPattern = /\.(md|markdown|mdown)$/i;

export function ensureMarkdownExtension(path: string) {
  return markdownExtensionPattern.test(path) ? path : `${path}.md`;
}

export function stripMarkdownExtension(path: string) {
  return path.replace(markdownExtensionPattern, "");
}

export function fileNameFromPath(path: string | null | undefined) {
  const segments = path?.split(/[\\/]/).filter(Boolean) ?? [];

  return segments[segments.length - 1] ?? "";
}

export function filePathInDirectory(
  directoryPath: string | null | undefined,
  fileName: string,
) {
  const trimmedDirectoryPath = directoryPath?.trim() ?? "";
  const trimmedFileName = fileName.trim();
  if (!trimmedDirectoryPath || !trimmedFileName) return trimmedFileName;

  const separator =
    trimmedDirectoryPath.includes("\\") && !trimmedDirectoryPath.includes("/") ? "\\" : "/";
  const directoryWithoutTrailingSeparators = trimmedDirectoryPath.replace(/[\\/]+$/, "");
  if (!directoryWithoutTrailingSeparators) return `${separator}${trimmedFileName}`;

  return `${directoryWithoutTrailingSeparators}${separator}${trimmedFileName}`;
}

export function dropboxDocumentId(path: string) {
  return `${dropboxDocumentIdPrefix}${path || "/"}`;
}

export function isDropboxDocumentId(documentId: string) {
  return documentId.startsWith(dropboxDocumentIdPrefix);
}

export function dropboxParentDirectoryPath(path: string | null | undefined) {
  const normalizedPath = path?.trim() ?? "";
  if (!normalizedPath) return "";

  const trimmedPath = normalizedPath.replace(/^\/+|\/+$/g, "");
  if (!trimmedPath.includes("/")) return "";

  const parentPath = trimmedPath.split("/").slice(0, -1).join("/");
  return parentPath ? `/${parentPath}` : "";
}

export function parentDirectoryPath(path: string | null | undefined) {
  const normalizedPath = path?.trim();
  if (!normalizedPath) return "";

  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  if (separatorIndex <= 0) return "";

  return normalizedPath.slice(0, separatorIndex);
}

export function normalizeLocalPathForCompare(path: string | null | undefined) {
  let normalizedPath = path?.trim().replace(/\\/g, "/") ?? "";
  while (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}

export function localPathsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return normalizeLocalPathForCompare(left) === normalizeLocalPathForCompare(right);
}

export function localPathIsInsideDirectory(path: string, directoryPath: string) {
  const normalizedPath = normalizeLocalPathForCompare(path);
  const normalizedDirectoryPath = normalizeLocalPathForCompare(directoryPath);
  if (!normalizedPath || !normalizedDirectoryPath) return false;
  if (normalizedPath === normalizedDirectoryPath) return true;
  if (normalizedDirectoryPath === "/") return normalizedPath.startsWith("/");

  return normalizedPath.startsWith(`${normalizedDirectoryPath}/`);
}

export function workspacePathIsInsideDirectory(
  path: string,
  directoryPath: string,
  source: "local" | "dropbox",
) {
  if (source === "local") return localPathIsInsideDirectory(path, directoryPath);

  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  const normalizedDirectoryPath = directoryPath
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!normalizedPath || !normalizedDirectoryPath) return false;

  return (
    normalizedPath === normalizedDirectoryPath ||
    normalizedPath.startsWith(`${normalizedDirectoryPath}/`)
  );
}

export function ancestorDirectoryPathsForFile(rootDirectoryPath: string, filePath: string) {
  const rootPath = normalizeLocalPathForCompare(rootDirectoryPath);
  const selectedDirectoryPath = normalizeLocalPathForCompare(parentDirectoryPath(filePath));
  if (!rootPath || !selectedDirectoryPath) return [];
  if (selectedDirectoryPath === rootPath) return [];
  if (!localPathIsInsideDirectory(selectedDirectoryPath, rootPath)) return [];

  const ancestorPaths: string[] = [];
  let currentPath = selectedDirectoryPath;

  while (currentPath && currentPath !== rootPath) {
    ancestorPaths.unshift(currentPath);

    const parentPath = normalizeLocalPathForCompare(parentDirectoryPath(currentPath));
    if (!parentPath || parentPath === currentPath) return [];
    currentPath = parentPath;
  }

  return currentPath === rootPath ? ancestorPaths : [];
}
