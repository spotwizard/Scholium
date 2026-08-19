import { markdownFrontmatterBodyStartLine } from "./markdownFrontmatter.ts";
import { parseMarkdownTableAt, type MarkdownTable } from "./markdownTable.ts";

const markdownUnorderedListLinePattern = /^(\s*)[-*+]\s+(.*)$/;
const markdownOrderedListLinePattern = /^(\s*)\d+[.)]\s+(.*)$/;

export type MarkdownPreviewListKind = "unordered-list" | "ordered-list";

export type MarkdownPreviewListItem = {
  children: MarkdownPreviewList[];
  flatIndex: number;
  key: string;
  text: string;
};

export type MarkdownPreviewList = {
  kind: MarkdownPreviewListKind;
  items: MarkdownPreviewListItem[];
};

export type MarkdownPreviewBlock =
  | {
      kind: "heading";
      key: string;
      startLine: number;
      endLine: number;
      level: number;
      text: string;
    }
  | {
      kind: "paragraph";
      key: string;
      startLine: number;
      endLine: number;
      text: string;
    }
  | {
      kind: "quote";
      key: string;
      startLine: number;
      endLine: number;
      text: string;
    }
  | {
      kind: "code";
      key: string;
      startLine: number;
      endLine: number;
      info: string;
      language: string;
      text: string;
    }
  | {
      kind: MarkdownPreviewListKind;
      key: string;
      startLine: number;
      endLine: number;
      items: string[];
      list: MarkdownPreviewList;
      rawLines: string[];
    }
  | {
      kind: "rule";
      key: string;
      startLine: number;
      endLine: number;
    };

export type NoteMarkdownPreviewBlock =
  | MarkdownPreviewBlock
  | {
      kind: "table";
      key: string;
      table: MarkdownTable;
    };

export type ParsedMarkdownListLine = {
  indent: number;
  kind: MarkdownPreviewListKind;
  markerLength: number;
  text: string;
};

function normalizedMarkdownIndent(rawIndent: string) {
  return rawIndent.replace(/\t/g, "    ").length;
}

export function parseMarkdownListLine(line: string): ParsedMarkdownListLine | null {
  const unorderedMatch = line.match(markdownUnorderedListLinePattern);
  if (unorderedMatch) {
    return {
      indent: normalizedMarkdownIndent(unorderedMatch[1]),
      kind: "unordered-list",
      markerLength: unorderedMatch[0].length - unorderedMatch[2].length,
      text: unorderedMatch[2],
    };
  }

  const orderedMatch = line.match(markdownOrderedListLinePattern);
  if (orderedMatch) {
    return {
      indent: normalizedMarkdownIndent(orderedMatch[1]),
      kind: "ordered-list",
      markerLength: orderedMatch[0].length - orderedMatch[2].length,
      text: orderedMatch[2],
    };
  }

  return null;
}

function isMarkdownListLine(line: string) {
  return parseMarkdownListLine(line) !== null;
}

function buildMarkdownPreviewList(rawLines: string[], blockKey: string): MarkdownPreviewList {
  const parsedLines = rawLines
    .map((line, flatIndex) => {
      const parsedLine = parseMarkdownListLine(line);
      return parsedLine ? { ...parsedLine, flatIndex } : null;
    })
    .filter((line): line is ParsedMarkdownListLine & { flatIndex: number } => Boolean(line));
  const rootList: MarkdownPreviewList = {
    kind: parsedLines[0]?.kind ?? "unordered-list",
    items: [],
  };
  const rootIndent = parsedLines[0]?.indent ?? 0;
  const stack: Array<{
    indent: number;
    lastItem: MarkdownPreviewListItem | null;
    list: MarkdownPreviewList;
  }> = [{ indent: rootIndent, lastItem: null, list: rootList }];

  parsedLines.forEach((line) => {
    while (stack.length > 1 && line.indent < stack[stack.length - 1].indent) {
      stack.pop();
    }

    let current = stack[stack.length - 1];
    if (line.indent > current.indent && current.lastItem) {
      const childList: MarkdownPreviewList = { kind: line.kind, items: [] };
      current.lastItem.children.push(childList);
      current = { indent: line.indent, lastItem: null, list: childList };
      stack.push(current);
    } else if (line.indent === current.indent && line.kind !== current.list.kind) {
      const parent = stack.length > 1 ? stack[stack.length - 2] : null;
      if (parent?.lastItem) {
        const siblingList: MarkdownPreviewList = { kind: line.kind, items: [] };
        parent.lastItem.children.push(siblingList);
        current = { indent: line.indent, lastItem: null, list: siblingList };
        stack[stack.length - 1] = current;
      }
    }

    const item: MarkdownPreviewListItem = {
      children: [],
      flatIndex: line.flatIndex,
      key: `${blockKey}-item-${line.flatIndex}`,
      text: line.text,
    };
    current.list.items.push(item);
    current.lastItem = item;
    stack[stack.length - 1] = current;
  });

  return rootList;
}

function isMarkdownBlockStart(line: string) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isMarkdownListLine(line) ||
    /^```/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
  );
}

function parseCodeFenceInfo(line: string) {
  const info = line.trim().slice(3).trim();
  const language = info.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  return { info, language };
}

export function parseMarkdownPreviewBlocks(markdown: string): MarkdownPreviewBlock[] {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const blocks: MarkdownPreviewBlock[] = [];
  let index = markdownFrontmatterBodyStartLine(normalizedMarkdown);

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const key = `markdown-block-${index}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const { info, language } = parseCodeFenceInfo(trimmed);
      const startLine = index;
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      blocks.push({
        kind: "code",
        key,
        startLine,
        endLine: index,
        info,
        language,
        text: codeLines.join("\n"),
      });
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        key,
        startLine: index,
        endLine: index,
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({
        kind: "rule",
        key,
        startLine: index,
        endLine: index,
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      const startLine = index;

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({
        kind: "quote",
        key,
        startLine,
        endLine: index - 1,
        text: quoteLines.join("\n"),
      });
      continue;
    }

    const listLine = parseMarkdownListLine(line);
    if (listLine) {
      const rawLines: string[] = [];
      const startLine = index;

      while (index < lines.length && isMarkdownListLine(lines[index])) {
        rawLines.push(lines[index]);
        index += 1;
      }

      const list = buildMarkdownPreviewList(rawLines, key);

      blocks.push({
        kind: listLine.kind,
        key,
        startLine,
        endLine: index - 1,
        items: rawLines.map((rawLine) => parseMarkdownListLine(rawLine)?.text ?? ""),
        list,
        rawLines,
      });
      continue;
    }

    const paragraphLines: string[] = [];
    const startLine = index;

    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({
      kind: "paragraph",
      key,
      startLine,
      endLine: index - 1,
      text: paragraphLines.join("\n"),
    });
  }

  return blocks;
}

export function parseNoteMarkdownPreviewBlocks(markdown: string): NoteMarkdownPreviewBlock[] {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const blocks: NoteMarkdownPreviewBlock[] = [];
  let index = markdownFrontmatterBodyStartLine(normalizedMarkdown);
  let segmentStart = 0;
  let insideCodeFence = false;

  const appendMarkdownSegment = (startLine: number, endLine: number) => {
    if (endLine <= startLine) return;
    parseMarkdownPreviewBlocks(lines.slice(startLine, endLine).join("\n")).forEach((block) => {
      blocks.push({
        ...block,
        key: `note-${startLine}-${block.key}`,
      });
    });
  };

  while (index < lines.length) {
    if (lines[index].trim().startsWith("```")) {
      insideCodeFence = !insideCodeFence;
      index += 1;
      continue;
    }

    const tableMatch = insideCodeFence ? null : parseMarkdownTableAt(lines, index);
    if (!tableMatch) {
      index += 1;
      continue;
    }

    appendMarkdownSegment(segmentStart, tableMatch.startLine);
    blocks.push({
      kind: "table",
      key: `note-table-${tableMatch.startLine}`,
      table: tableMatch.table,
    });
    index = tableMatch.endLine + 1;
    segmentStart = index;
  }

  appendMarkdownSegment(segmentStart, lines.length);
  return blocks;
}
