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

export function escapeListLeadingAsterisksForPreview(markdown: string) {
  return transformListLeadingAsterisks(markdown, true);
}

export function restoreListLeadingAsterisksFromPreview(markdown: string) {
  return transformListLeadingAsterisks(markdown, false);
}
