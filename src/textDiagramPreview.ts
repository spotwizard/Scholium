export type TextDiagramPreviewLine = {
  depth: number;
  kind: "blank" | "branch" | "connector" | "node";
  label: string;
  prefix: string;
  source: string;
};

const textDiagramBranchPattern = /^(\s*[│ ]*[├└]──\s*)(.*)$/;
const textDiagramConnectorPattern = /^[\s│▼]+$/;

export function parseTextDiagramPreview(language: string, content: string) {
  if (language.trim().toLowerCase() !== "text") return null;

  const source = content.replace(/\r\n/g, "\n");
  const sourceLines = source.split("\n");
  const branchCount = sourceLines.filter((line) => textDiagramBranchPattern.test(line)).length;
  if (branchCount < 2) return null;

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
