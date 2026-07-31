export function markdownCopyTextFromRange(markdown: string, rangeFrom: number, rangeTo: number) {
  let from = rangeFrom;
  let to = rangeTo;
  const pairedMarkers = ["**", "__", "`", "*", "_"] as const;

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const marker of pairedMarkers) {
      if (
        from >= marker.length &&
        markdown.slice(from - marker.length, from) === marker &&
        markdown.slice(to, to + marker.length) === marker
      ) {
        from -= marker.length;
        to += marker.length;
        expanded = true;
        break;
      }
    }
  }

  if (from > 0 && markdown[from - 1] === "[" && markdown.slice(to, to + 2) === "](") {
    const linkEnd = markdown.indexOf(")", to + 2);
    if (linkEnd > to + 2) {
      from -= 1;
      to = linkEnd + 1;
    }
  }

  const lineStart = markdown.lastIndexOf("\n", from - 1) + 1;
  const blockPrefix = /^([ \t]*)(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]+$/.exec(
    markdown.slice(lineStart, from),
  );
  if (blockPrefix) {
    from = lineStart;
  }

  const copiedMarkdown = markdown.slice(from, to);
  const indentation = blockPrefix?.[1] ?? "";
  if (!indentation) return copiedMarkdown;

  return copiedMarkdown
    .split("\n")
    .map((line) => (line.startsWith(indentation) ? line.slice(indentation.length) : line))
    .join("\n");
}
