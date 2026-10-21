export type FileLinkCandidate = {
  path: string;
  title: string;
  fileName: string;
};

export const fileLinkTriggerCharacters = new Set(["@", "＠"]);

// Characters that would end the link destination or be read as a query, fragment or
// percent escape by resolveMarkdownLinkTarget; everything else, CJK included, stays readable.
const linkDestinationEscapes: Record<string, string> = {
  " ": "%20",
  "#": "%23",
  "%": "%25",
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
  "?": "%3F",
  "\\": "%5C",
};

export function siblingFileLinkHref(fileName: string) {
  return Array.from(fileName, (character) => linkDestinationEscapes[character] ?? character).join(
    "",
  );
}

export function sourceMarkdownFileLink(label: string, href: string) {
  return `[${label.replace(/([\\[\]])/g, "\\$1")}](${href})`;
}

export function fileLinkTriggerHasBoundary(textBeforeTrigger: string) {
  return textBeforeTrigger === "" || /\s$/u.test(textBeforeTrigger);
}

export function filterFileLinkCandidates<File extends FileLinkCandidate>(
  files: File[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return files;

  return files.filter(
    (file) =>
      file.title.toLowerCase().includes(normalizedQuery) ||
      file.fileName.toLowerCase().includes(normalizedQuery),
  );
}
