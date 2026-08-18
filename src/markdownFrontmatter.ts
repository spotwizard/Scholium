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
  const normalizedOffset = (splitMarkdownFrontmatter(markdown)?.bodyStart ?? 0) + bodyOffset;
  let sourceOffset = 0;
  let currentNormalizedOffset = 0;

  while (sourceOffset < markdown.length && currentNormalizedOffset < normalizedOffset) {
    if (markdown[sourceOffset] === "\r" && markdown[sourceOffset + 1] === "\n") {
      sourceOffset += 2;
    } else {
      sourceOffset += 1;
    }
    currentNormalizedOffset += 1;
  }

  return sourceOffset;
}

export function normalizeMarkdownTag(tag: string) {
  return tag.replace(/\s+/g, " ").trim();
}

export function markdownTagDedupeKey(tag: string) {
  return normalizeMarkdownTag(tag).toLocaleLowerCase();
}

function uniqueMarkdownTags(tags: string[]) {
  const seenTags = new Set<string>();
  const normalizedTags: string[] = [];

  tags.forEach((tag) => {
    const normalizedTag = normalizeMarkdownTag(tag);
    if (!normalizedTag) return;

    const dedupeKey = markdownTagDedupeKey(normalizedTag);
    if (seenTags.has(dedupeKey)) return;

    seenTags.add(dedupeKey);
    normalizedTags.push(normalizedTag);
  });

  return normalizedTags;
}

function scalarWithoutComment(value: string) {
  let quote: '"' | "'" | "" = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const previousCharacter = value[index - 1] ?? "";

    if (quote) {
      if (character === quote && previousCharacter !== "\\") {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "#" && (index === 0 || /\s/.test(previousCharacter))) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function parseYamlScalar(value: string) {
  const trimmedValue = scalarWithoutComment(value);
  if (!trimmedValue) return "";

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    try {
      return JSON.parse(trimmedValue) as string;
    } catch {
      return trimmedValue.slice(1, -1);
    }
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1).replace(/''/g, "'");
  }

  return trimmedValue;
}

function splitYamlInlineArray(value: string) {
  const innerValue = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  const items: string[] = [];
  let currentItem = "";
  let quote: '"' | "'" | "" = "";

  for (let index = 0; index < innerValue.length; index += 1) {
    const character = innerValue[index] ?? "";
    const previousCharacter = innerValue[index - 1] ?? "";

    if (quote) {
      currentItem += character;
      if (character === quote && previousCharacter !== "\\") {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      currentItem += character;
      continue;
    }

    if (character === ",") {
      items.push(currentItem);
      currentItem = "";
      continue;
    }

    currentItem += character;
  }

  if (currentItem.trim()) {
    items.push(currentItem);
  }

  return items;
}

function parseTagsFromFrontmatterLines(lines: string[]) {
  const tags: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const tagsMatch = lines[index]?.match(/^tags\s*:\s*(.*)$/);
    if (!tagsMatch) continue;

    const inlineValue = scalarWithoutComment(tagsMatch[1]?.trim() ?? "");
    if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
      return uniqueMarkdownTags(splitYamlInlineArray(inlineValue).map(parseYamlScalar));
    }

    if (inlineValue) {
      return uniqueMarkdownTags([parseYamlScalar(inlineValue)]);
    }

    let itemIndex = index + 1;
    while (itemIndex < lines.length) {
      const line = lines[itemIndex] ?? "";
      if (!line.trim()) {
        itemIndex += 1;
        continue;
      }

      if (line.trimStart().startsWith("#")) {
        itemIndex += 1;
        continue;
      }

      if (!/^\s/.test(line)) break;

      const itemMatch = line.match(/^\s*-\s*(.*)$/);
      if (!itemMatch) break;

      tags.push(parseYamlScalar(itemMatch[1] ?? ""));
      itemIndex += 1;
    }

    return uniqueMarkdownTags(tags);
  }

  return [];
}

function frontmatterContentLines(frontmatter: string) {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  const closingLineIndex = lines.findIndex(
    (line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line),
  );

  if (closingLineIndex < 0) return null;

  return {
    afterClosingLines: lines.slice(closingLineIndex),
    beforeClosingLines: lines.slice(1, closingLineIndex),
  };
}

function removeTagsFromFrontmatterLines(lines: string[]) {
  const nextLines: string[] = [];
  let insertionIndex = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^tags\s*:/.test(line)) {
      nextLines.push(line);
      continue;
    }

    insertionIndex = nextLines.length;
    index += 1;
    while (index < lines.length) {
      const continuationLine = lines[index] ?? "";
      if (continuationLine.trim() && !/^\s/.test(continuationLine)) {
        index -= 1;
        break;
      }
      index += 1;
    }
  }

  return { insertionIndex, lines: nextLines };
}

function frontmatterHasMeaningfulContent(lines: string[]) {
  return lines.some((line) => line.trim());
}

function yamlScalarNeedsQuotes(value: string) {
  return (
    !value ||
    value !== value.trim() ||
    /[\n\r\t]/.test(value) ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s| #/.test(value) ||
    /^(true|false|null|yes|no|on|off)$/i.test(value)
  );
}

function formatYamlTagScalar(value: string) {
  return yamlScalarNeedsQuotes(value) ? JSON.stringify(value) : value;
}

function formattedTagsBlock(tags: string[]) {
  if (tags.length === 0) return [];

  return ["tags:", ...tags.map((tag) => `  - ${formatYamlTagScalar(tag)}`)];
}

export function markdownHasMalformedFrontmatter(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  return normalizedMarkdown.startsWith("---\n") && !splitMarkdownFrontmatter(normalizedMarkdown);
}

export function readMarkdownTags(markdown: string) {
  const frontmatter = splitMarkdownFrontmatter(markdown);
  if (!frontmatter) return [];

  const content = frontmatterContentLines(frontmatter.frontmatter);
  if (!content) return [];

  return parseTagsFromFrontmatterLines(content.beforeClosingLines);
}

export function writeMarkdownTags(markdown: string, tags: string[]) {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const normalizedTags = uniqueMarkdownTags(tags);
  const frontmatter = splitMarkdownFrontmatter(normalizedMarkdown);
  const tagLines = formattedTagsBlock(normalizedTags);

  if (!frontmatter) {
    if (normalizedTags.length === 0) return normalizedMarkdown;

    return `---\n${tagLines.join("\n")}\n---\n${normalizedMarkdown}`;
  }

  const content = frontmatterContentLines(frontmatter.frontmatter);
  if (!content) return normalizedMarkdown;

  const cleanedContent = removeTagsFromFrontmatterLines(content.beforeClosingLines);
  const insertionIndex = Math.min(cleanedContent.insertionIndex, cleanedContent.lines.length);
  const nextContentLines = [
    ...cleanedContent.lines.slice(0, insertionIndex),
    ...tagLines,
    ...cleanedContent.lines.slice(insertionIndex),
  ];

  if (!frontmatterHasMeaningfulContent(nextContentLines)) {
    return frontmatter.body;
  }

  return [
    "---",
    ...nextContentLines,
    ...content.afterClosingLines,
  ].join("\n") + frontmatter.body;
}
