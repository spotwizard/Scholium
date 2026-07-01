export type MarkdownFrontmatterSplit = {
  body: string;
  bodyStart: number;
  frontmatter: string;
};

function lineIndexAtOffset(markdown: string, offset: number) {
  return markdown.slice(0, offset).split("\n").length - 1;
}

export function splitMarkdownFrontmatter(markdown: string): MarkdownFrontmatterSplit | null {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  if (!normalizedMarkdown.startsWith("---\n")) return null;

  let lineStart = 4;
  while (lineStart < normalizedMarkdown.length) {
    const lineEndIndex = normalizedMarkdown.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex >= 0 ? lineEndIndex : normalizedMarkdown.length;
    const line = normalizedMarkdown.slice(lineStart, lineEnd);

    if (/^(---|\.\.\.)\s*$/.test(line)) {
      let bodyStart = lineEndIndex >= 0 ? lineEndIndex + 1 : lineEnd;
      while (normalizedMarkdown[bodyStart] === "\n") {
        bodyStart += 1;
      }

      return {
        body: normalizedMarkdown.slice(bodyStart),
        bodyStart,
        frontmatter: normalizedMarkdown.slice(0, bodyStart),
      };
    }

    if (lineEndIndex < 0) return null;
    lineStart = lineEndIndex + 1;
  }

  return null;
}

export function stripMarkdownFrontmatter(markdown: string) {
  return splitMarkdownFrontmatter(markdown)?.body ?? markdown.replace(/\r\n/g, "\n");
}

export function markdownFrontmatterBodyStartLine(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const frontmatter = splitMarkdownFrontmatter(normalizedMarkdown);
  return frontmatter ? lineIndexAtOffset(normalizedMarkdown, frontmatter.bodyStart) : 0;
}

export function mergeMarkdownFrontmatter(sourceMarkdown: string, bodyMarkdown: string) {
  const frontmatter = splitMarkdownFrontmatter(sourceMarkdown);
  return frontmatter ? `${frontmatter.frontmatter}${bodyMarkdown}` : bodyMarkdown;
}

export function fullSourceOffsetFromFrontmatterBodyOffset(markdown: string, bodyOffset: number) {
  return (splitMarkdownFrontmatter(markdown)?.bodyStart ?? 0) + bodyOffset;
}
