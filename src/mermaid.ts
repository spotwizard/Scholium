const mermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  theme: "base",
  themeVariables: {
    background: "#fcfcfd",
    primaryColor: "#dbeafe",
    primaryTextColor: "#202329",
    primaryBorderColor: "#3b82c4",
    lineColor: "#2f333b",
    secondaryColor: "#dff7ef",
    tertiaryColor: "#f3f4f6",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  flowchart: {
    htmlLabels: false,
  },
} as const;

let mermaidInitialized = false;
let mermaidModulePromise: Promise<(typeof import("mermaid"))["default"]> | null = null;

export async function loadScholiumMermaid() {
  mermaidModulePromise ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidModulePromise;

  if (!mermaidInitialized) {
    mermaid.initialize(mermaidConfig);
    mermaidInitialized = true;
  }

  return mermaid;
}
