export type MarkdownTableAlignment = "center" | "left" | "right" | null;

export type MarkdownTable = {
  alignments: MarkdownTableAlignment[];
  header: string[];
  rows: string[][];
};

export type MarkdownTableMatch = {
  endLine: number;
  startLine: number;
  table: MarkdownTable;
};

function splitMarkdownTableRow(line: string) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);

  return row
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function tableAlignment(delimiter: string): MarkdownTableAlignment {
  const value = delimiter.trim();
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  if (value.startsWith(":")) return "left";
  return null;
}

function normalizeTableRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

export function parseMarkdownTableAt(
  lines: string[],
  startLine: number,
): MarkdownTableMatch | null {
  const headerLine = lines[startLine] ?? "";
  const delimiterLine = lines[startLine + 1] ?? "";
  if (!headerLine.includes("|") || !delimiterLine.includes("|")) return null;

  const header = splitMarkdownTableRow(headerLine);
  const delimiters = splitMarkdownTableRow(delimiterLine);
  if (
    header.length === 0 ||
    delimiters.length !== header.length ||
    !delimiters.every((delimiter) => /^:?-{3,}:?$/.test(delimiter))
  ) {
    return null;
  }

  const rows: string[][] = [];
  let endLine = startLine + 1;
  while (endLine + 1 < lines.length) {
    const rowLine = lines[endLine + 1];
    if (!rowLine.trim() || !rowLine.includes("|")) break;
    rows.push(normalizeTableRow(splitMarkdownTableRow(rowLine), header.length));
    endLine += 1;
  }

  return {
    endLine,
    startLine,
    table: {
      alignments: delimiters.map(tableAlignment),
      header,
      rows,
    },
  };
}

export function markdownHasTable(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  return lines.some((_line, index) => parseMarkdownTableAt(lines, index) !== null);
}
