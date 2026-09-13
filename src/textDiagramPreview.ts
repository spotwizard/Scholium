export type TextDiagramPreviewLine = {
  depth: number;
  kind: "blank" | "branch" | "connector" | "node";
  label: string;
  prefix: string;
  source: string;
};

const textDiagramBranchPattern = /^(\s*(?:[│ ]*[├└]─{2,}[►→]?|[►→])\s*)(.*)$/;
const textDiagramContinuationPattern = /^(\s*│\s+)((?![│▼↓]\s*$)\S.*)$/;
const textDiagramConnectorPattern = /^[\s│▼↓]+$/;
const commentedFileTreeLinePattern =
  /(?:^|\s)(?:[\w@.-]+\/|[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9][\w.-]*)\s+#\s+\S/;

function hasCommentedFileTreeLine(lines: string[]) {
  return lines.some((line) => {
    const branch = line.match(textDiagramBranchPattern);
    return Boolean(branch?.[2] && commentedFileTreeLinePattern.test(branch[2]));
  });
}

export function isCommentedFileTreeCodeBlock(language: string, content: string) {
  if (language.trim().toLowerCase() !== "text") return false;

  const sourceLines = content.replace(/\r\n/g, "\n").split("\n");
  const branchCount = sourceLines.filter((line) => textDiagramBranchPattern.test(line)).length;
  return branchCount >= 2 && hasCommentedFileTreeLine(sourceLines);
}

export function parseTextDiagramPreview(language: string, content: string) {
  if (language.trim().toLowerCase() !== "text") return null;

  const source = content.replace(/\r\n/g, "\n");
  // Keep boxed diagrams intact; their bottom borders also match tree branches.
  if (/┌[─┬]+┐/.test(source)) return null;
  const sourceLines = source.split("\n");
  const branchCount = sourceLines.filter((line) => textDiagramBranchPattern.test(line)).length;
  if (branchCount < 2) return null;
  // File-tree comments rely on monospace spacing; diagram chips break that alignment.
  if (isCommentedFileTreeCodeBlock(language, content)) return null;

  return sourceLines.map<TextDiagramPreviewLine>((line) => {
    if (!line.trim()) {
      return { depth: 0, kind: "blank", label: "", prefix: "", source: line };
    }

    const branch = line.match(textDiagramBranchPattern);
    if (branch) {
      const prefix = branch[1] ?? "";
      return {
        depth: prefix.search(/[├└]/) >= 16 ? 2 : 1,
        kind: "branch",
        label: branch[2] ?? "",
        prefix,
        source: line,
      };
    }

    const continuation = line.match(textDiagramContinuationPattern);
    if (continuation) {
      return {
        depth: 1,
        kind: "branch",
        label: continuation[2] ?? "",
        prefix: continuation[1] ?? "",
        source: line,
      };
    }

    if (textDiagramConnectorPattern.test(line)) {
      return { depth: 0, kind: "connector", label: "", prefix: line, source: line };
    }

    const labelStart = line.search(/\S/);
    const prefix = labelStart > 0 ? line.slice(0, labelStart) : "";
    return {
      depth: 0,
      kind: "node",
      label: line.slice(prefix.length),
      prefix,
      source: line,
    };
  });
}

export function textDiagramPreviewSource(lines: TextDiagramPreviewLine[]) {
  return lines.map((line) => line.source).join("\n");
}
