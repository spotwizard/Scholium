import type { FlowDB } from "mermaid/dist/diagrams/flowchart/flowDb.js";

export type DiagramTextRange = { key: string; from: number; to: number; prefix: string; suffix: string };
type Token = { kind: string; text: string; from: number; to: number };
type FlowLexer = {
  options: Record<string, unknown>;
  setInput(source: string, yy: unknown): void;
  lex(): number;
  yytext: string;
  yylloc: { range: [number, number] };
};
type FlowParser = { lexer: FlowLexer; terminals_: Record<number, string>; yy: FlowDB; parse(source: string): unknown };
let flowParser: FlowParser | null = null;

/** Use Mermaid's own lexer on an isolated instance; never change its shared parser. */
export function registerFlowTextParser(parser: unknown) {
  const candidate = (parser as { parser?: FlowParser }).parser;
  if (!candidate?.lexer?.setInput || !candidate.terminals_ || !candidate.parse || !candidate.yy?.getVertices) throw new Error("Mermaid text locations unavailable");
  flowParser = candidate;
}

export function flowTextRanges(source: string, nodeIds: string[], groupIds: string[]): DiagramTextRange[] {
  if (!flowParser) throw new Error("Mermaid text parser is not loaded");
  const lexer = Object.create(flowParser.lexer) as FlowLexer;
  lexer.options = { ...lexer.options, ranges: true };
  const start = Math.max(0, source.search(/^[ \t]*(?:flowchart(?:-elk)?|graph)\b/m));
  lexer.setInput(source.slice(start), flowParser.yy);
  const tokens: Token[] = [];
  for (let count = 0; count <= source.length * 2 + 100; count++) {
    const token = lexer.lex();
    if (token === 1) break;
    const [from, to] = lexer.yylloc.range;
    tokens.push({ kind: flowParser.terminals_[token], text: lexer.yytext, from: from + start, to: to + start });
    if (count === source.length * 2 + 100) throw new Error("Mermaid lexer did not finish");
  }
  return flowTextRangesFromTokens(source, tokens, nodeIds, groupIds);
}

/** Decode restored labels with the same grammar as rendering, on a fresh DB. */
export function restoredFlowText(source: string) {
  if (!flowParser) throw new Error("Mermaid text parser is not loaded");
  const parser = Object.create(flowParser) as FlowParser;
  const Database = flowParser.yy.constructor as new () => FlowDB;
  parser.yy = new Database();
  const start = Math.max(0, source.search(/^[ \t]*(?:flowchart(?:-elk)?|graph)\b/m));
  parser.parse(source.slice(start) + "\n");
  return new Map<string, string>([
    ...[...parser.yy.getVertices().values()].map(node => [`node:${node.id}`, node.text ?? node.id] as const),
    ...parser.yy.getSubGraphs().map(group => [`group:${group.id}`, group.title] as const),
  ]);
}

export function flowTextRangesFromTokens(source: string, tokens: Token[], nodeIds: string[], groupIds: string[]) {
  const result = new Map<string, DiagramTextRange>();
  const closing: Record<string, string> = {
    SQS: "SQE", PS: "PE", DOUBLECIRCLESTART: "DOUBLECIRCLEEND", STADIUMSTART: "STADIUMEND",
    SUBROUTINESTART: "SUBROUTINEEND", CYLINDERSTART: "CYLINDEREND", DIAMOND_START: "DIAMOND_STOP",
    TAGEND: "SQE", TRAPSTART: "TRAPEND", INVTRAPSTART: "INVTRAPEND", "(-": "-)",
  };
  const ids = [...nodeIds, ...groupIds].sort((a, b) => b.length - a.length);
  let statementStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (["NEWLINE", "SEMI"].includes(token.kind)) { statementStart = i + 1; continue; }
    if (["GRAPH", "NODIR", "STYLE", "CLASS", "CLASSDEF", "CLICK", "LINKSTYLE"].includes(tokens[statementStart]?.kind)) continue;
    if (token.kind === "SPACE" && i === statementStart) { statementStart++; continue; }
    if (token.kind === "SHAPE_DATA" && source.slice(token.from, token.to) === "@{") {
      const before = source.slice(0, token.from).trimEnd();
      const id = nodeIds.find(id => before.endsWith(id) && !/[\w-]/.test(before.at(-id.length - 1) ?? ""));
      let last = i;
      while (tokens[last + 1]?.kind === "SHAPE_DATA") last++;
      if (id) {
        const body = source.slice(token.to, tokens[last].to);
        const label = /\blabel\s*:\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,\n}]+)/.exec(body);
        const key = `node:${id}`;
        if (label) {
          const from = token.to + label.index + label[0].indexOf(label[1]);
          result.set(key, { key, from, to: from + label[1].length, prefix: "", suffix: "" });
        } else result.set(key, { key, from: token.to, to: token.to, prefix: " label: ", suffix: "," });
      }
      i = last; continue;
    }
    const end = closing[token.kind];
    if (end) {
      const before = source.slice(0, token.from).trimEnd();
      const id = ids.find((id) => before.endsWith(id) && !/[\w-]/.test(before.at(-id.length - 1) ?? ""));
      if (!id) continue;
      let opening = i;
      while (tokens[opening + 1]?.kind === token.kind) opening++;
      const close = tokens.slice(opening + 1).findIndex((item) => item.kind === end ||
        (token.kind === "TRAPSTART" || token.kind === "INVTRAPSTART") && item.kind.endsWith("TRAPEND"));
      if (close < 0) continue;
      const j = opening + 1 + close;
      const key = `${groupIds.includes(id) ? "group" : "node"}:${id}`;
      result.set(key, { key, from: tokens[opening].to, to: tokens[j].from, prefix: "", suffix: "" });
      i = j;
    } else if (nodeIds.includes(token.text) && token.kind === "NODE_STRING") {
      const key = `node:${token.text}`;
      if (!result.has(key)) result.set(key, { key, from: token.to, to: token.to, prefix: "[", suffix: "]" });
    } else if (token.kind === "subgraph") {
      const next = tokens.slice(i + 1).find((item) => item.kind !== "SPACE");
      if (next && groupIds.includes(next.text)) {
        const key = `group:${next.text}`;
        result.set(key, { key, from: next.to, to: next.to, prefix: " [", suffix: "]" });
      }
    }
  }
  return [...result.values()];
}

export function encodeDiagramText(text: string) {
  const escaped = text.replace(/[#"&<>`]/g, (character) => `#${character.codePointAt(0)};`).replace(/\r\n?|\n/g, "<br/>");
  return escaped.replace(/^\s+|\s+$/g, (space) => [...space].map(character => `#${character.codePointAt(0)};`).join(""));
}

export function replaceDiagramText(source: string, ranges: DiagramTextRange[], key: string, text: string) {
  const range = ranges.find((item) => item.key === key);
  if (!range) throw new Error(`Diagram text location unavailable: ${key}`);
  const insert = `${range.prefix}"${encodeDiagramText(text)}"${range.suffix}`;
  const delta = insert.length - (range.to - range.from);
  return {
    source: source.slice(0, range.from) + insert + source.slice(range.to),
    ranges: ranges.map((item) => item.key === key ? { ...item, to: item.from + insert.length }
      : item.from >= range.to ? { ...item, from: item.from + delta, to: item.to + delta } : item),
  };
}
