import type { FlowDB } from "mermaid/dist/diagrams/flowchart/flowDb.js";
import { flowReadingGraph, readingDiagramHtml } from "./mermaidReading.ts";
import { registerFlowTextParser } from "./mermaidText.ts";

const mermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  theme: "base",
  // Unboxed labels sit on the page, unlike labels inside filled nodes.
  themeCSS: `
    .edgeLabel text, .actor-man text.actor > tspan { fill: #202329; }
    .actor-man line, .actor-man circle { stroke: #9a7044; }
    .node rect.basic, rect.actor { rx: 6px; ry: 6px; }
  `,
  themeVariables: {
    background: "#fffdf8",
    primaryColor: "#6e1b2b",
    primaryTextColor: "#fff1de",
    primaryBorderColor: "#cdb48f",
    lineColor: "#9a7044",
    textColor: "#202329",
    secondaryColor: "#fff4df",
    secondaryTextColor: "#202329",
    secondaryBorderColor: "#cdb48f",
    tertiaryColor: "#f8efe3",
    tertiaryTextColor: "#202329",
    tertiaryBorderColor: "#e7dcca",
    edgeLabelBackground: "#fffdf8",
    noteBkgColor: "#fff4df",
    noteTextColor: "#202329",
    noteBorderColor: "#cdb48f",
    actorLineColor: "#cdb48f",
    signalColor: "#9a7044",
    signalTextColor: "#202329",
    labelTextColor: "#fff1de",
    loopTextColor: "#202329",
    taskTextColor: "#fff1de",
    taskTextLightColor: "#fff1de",
    taskTextDarkColor: "#202329",
    taskTextOutsideColor: "#202329",
    activeTaskBkgColor: "#f0dfc4",
    activeTaskBorderColor: "#9a7044",
    doneTaskBkgColor: "#e7dcca",
    doneTaskBorderColor: "#cdb48f",
    sectionBkgColor2: "#fff4df",
    gridColor: "#e7dcca",
    todayLineColor: "#6e1b2b",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", sans-serif',
  },
  flowchart: {
    curve: "linear",
    htmlLabels: false,
  },
  gantt: {
    leftPadding: 220,
    fontSize: 16,
    sectionFontSize: 16,
  },
} as const;

let mermaidModulePromise: Promise<(typeof import("mermaid"))["default"]> | null = null;

export function loadScholiumMermaid() {
  return (mermaidModulePromise ??= import("mermaid").then((module) => {
    module.default.initialize(mermaidConfig);
    return module.default;
  }));
}

export async function renderScholiumMermaid(id: string, definition: string) {
  const mermaid = await loadScholiumMermaid();
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(definition);
  if (diagram.type.startsWith("flowchart")) {
    registerFlowTextParser(diagram.parser);
    return { svg: readingDiagramHtml(flowReadingGraph(diagram.db as FlowDB), id, definition) };
  }
  return mermaid.render(id, definition);
}
