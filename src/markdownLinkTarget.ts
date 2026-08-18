export type MarkdownLinkSource = "local" | "dropbox";

export function localMarkdownImageNeedsHydration(src: string) {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) return false;

  return !/^(https?:|data:|blob:|asset:|tauri:|ipc:|\/\/)/i.test(trimmedSrc);
}

export type MarkdownLinkTarget =
  | { kind: "document"; path: string }
  | { kind: "external"; href: string }
  | { kind: "fragment"; href: string }
  | { kind: "unsupported" };

const externalLinkPattern = /^(https?:|mailto:)/i;
const explicitSchemePattern = /^[a-z][a-z\d+.-]*:/i;
const absoluteLocalPathPattern = /^(?:[a-z]:[\\/]|[\\/])/i;

function linkPathWithoutQueryOrFragment(href: string) {
  const suffixIndexes = [href.indexOf("?"), href.indexOf("#")].filter(
    (index) => index >= 0,
  );
  const suffixIndex = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : href.length;
  return href.slice(0, suffixIndex);
}

function decodeLinkPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function parentPath(path: string, separatorPattern: RegExp) {
  const segments = path.split(separatorPattern);
  segments.pop();
  return segments.join(path.includes("\\") && !path.includes("/") ? "\\" : "/");
}

function resolveLocalDocumentPath(referencePath: string, documentPath: string) {
  const separator = documentPath.includes("\\") && !documentPath.includes("/") ? "\\" : "/";
  const normalizedReference =
    separator === "\\" ? referencePath.replace(/\//g, "\\") : referencePath.replace(/\\/g, "/");
  if (absoluteLocalPathPattern.test(normalizedReference)) return normalizedReference;

  const directoryPath = parentPath(documentPath, /[\\/]/);
  if (!directoryPath) return normalizedReference;
  return `${directoryPath.replace(/[\\/]+$/, "")}${separator}${normalizedReference}`;
}

function normalizeDropboxPath(path: string) {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

function resolveDropboxDocumentPath(referencePath: string, documentPath: string) {
  if (referencePath.startsWith("/")) return normalizeDropboxPath(referencePath);

  const directoryPath = parentPath(documentPath, /\//);
  return normalizeDropboxPath(`${directoryPath}/${referencePath}`);
}

function localPathFromFileUrl(href: string, documentPath: string) {
  try {
    let path = decodeLinkPath(new URL(href).pathname);
    if (/^[a-z]:\\/i.test(documentPath) && /^\/[a-z]:\//i.test(path)) {
      path = path.slice(1).replace(/\//g, "\\");
    }
    return path;
  } catch {
    return "";
  }
}

export function resolveMarkdownLinkTarget(
  href: string,
  documentPath: string | null | undefined,
  source: MarkdownLinkSource,
): MarkdownLinkTarget {
  const normalizedHref = href.trim();
  if (!normalizedHref) return { kind: "unsupported" };
  if (normalizedHref.startsWith("#")) {
    return { kind: "fragment", href: normalizedHref };
  }
  if (externalLinkPattern.test(normalizedHref)) {
    return { kind: "external", href: normalizedHref };
  }

  if (/^file:/i.test(normalizedHref)) {
    if (source !== "local" || !documentPath) return { kind: "unsupported" };
    const path = localPathFromFileUrl(normalizedHref, documentPath);
    return path ? { kind: "document", path } : { kind: "unsupported" };
  }

  let referenceHref = normalizedHref;
  if (/^tauri:\/\/localhost\//i.test(referenceHref)) {
    try {
      referenceHref = new URL(referenceHref).pathname.replace(/^\/+/, "");
    } catch {
      return { kind: "unsupported" };
    }
  } else if (
    explicitSchemePattern.test(referenceHref) &&
    !(source === "local" && absoluteLocalPathPattern.test(referenceHref))
  ) {
    return { kind: "unsupported" };
  }

  if (!documentPath) return { kind: "unsupported" };
  const referencePath = decodeLinkPath(linkPathWithoutQueryOrFragment(referenceHref));
  if (!referencePath) return { kind: "fragment", href: normalizedHref };

  return {
    kind: "document",
    path:
      source === "dropbox"
        ? resolveDropboxDocumentPath(referencePath, documentPath)
        : resolveLocalDocumentPath(referencePath, documentPath),
  };
}
