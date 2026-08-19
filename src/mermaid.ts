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

let mermaidModulePromise: Promise<(typeof import("mermaid"))["default"]> | null = null;

export function loadScholiumMermaid() {
  return (mermaidModulePromise ??= import("mermaid").then((module) => {
    module.default.initialize(mermaidConfig);
    return module.default;
  }));
}
