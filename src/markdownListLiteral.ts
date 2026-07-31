function transformListLeadingAsterisks(markdown: string, escape: boolean) {
  let inFencedCodeBlock = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) {
        inFencedCodeBlock = !inFencedCodeBlock;
        return line;
      }
      if (inFencedCodeBlock) return line;

      return escape
        ? line.replace(/^(\s*-\s+)\*(?=\s+\S)/, "$1\\*")
        : line.replace(/^(\s*-\s+)\\\*(?=\s+\S)/, "$1*");
    })
    .join("\n");
}

export function normalizeListItemStrongTrailingWhitespace(markdown: string) {
  let inFencedCodeBlock = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) {
        inFencedCodeBlock = !inFencedCodeBlock;
        return line;
      }
      if (inFencedCodeBlock) return line;
      if (!/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/.test(line)) return line;

      return line.replace(/(\*\*)([^*\n]*?\S)([ \t]+)\*\*/g, "$1$2**$3");
    })
    .join("\n");
}

export function escapeListLeadingAsterisksForPreview(markdown: string) {
  return transformListLeadingAsterisks(markdown, true);
}

export function restoreListLeadingAsterisksFromPreview(markdown: string) {
  return transformListLeadingAsterisks(markdown, false);
}
