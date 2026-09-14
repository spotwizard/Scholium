import type { FlowDB } from "mermaid/dist/diagrams/flowchart/flowDb.js";
import { routeDiagramConnections, type DiagramBox } from "./diagramRouting.ts";
import { isAppLanguage, translate } from "./i18n.ts";
import { flowTextRanges, replaceDiagramText, restoredFlowText, type DiagramTextRange } from "./mermaidText.ts";
import { EditorView as TextEditor, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";

export type DiagramEditing = {
  canEdit: () => boolean;
  change: (root: HTMLElement, previous: string, next: string) => boolean;
  history: (root: HTMLElement, redo: boolean) => string | undefined;
};

/** Keep the active text field mounted while the owning document accepts input. */
export function retainDiagramTextEditor(host: HTMLElement, source: string) {
  const active = document.activeElement;
  const root = active instanceof HTMLElement ? active.closest<HTMLElement>(".reading-diagram") : null;
  return Boolean(root && host.contains(root) && decodeURIComponent(root.dataset.readingSource ?? "") === source);
}

type ReadingNode = { id: string; label: string; shape: string; link?: string };
type ReadingGroup = { id: string; title: string; members: string[] };
type ReadingEdge = { source: string; target: string; label: string; marker: string; stroke: string };
export type ReadingGraph = { nodes: ReadingNode[]; groups: ReadingGroup[]; edges: ReadingEdge[] };
type FlowData = Pick<FlowDB, "getVertices" | "getSubGraphs" | "getEdges">;

export function restoreMermaidLiteralLineBreaks(value: string) {
  return value.replace(/\\r\\n|\\n|\\r/g, "\n");
}

function labelText(value: string) {
  // Mermaid has already parsed the label. Decode entities without inserting HTML.
  const restoredLineBreaks = restoreMermaidLiteralLineBreaks(value);
  const entities = restoredLineBreaks.replace(/ﬂ°°/g, "&#").replace(/ﬂ°/g, "&").replace(/¶ß/g, ";")
    .replace(/(?<!&)#(\d+|quot|amp|lt|gt);/g, (_match, entity: string) => `&${/^\d+$/.test(entity) ? "#" : ""}${entity};`);
  const document = new DOMParser().parseFromString(entities.replace(/<br\s*\/?\s*>/gi, "\n"), "text/html");
  return document.body.textContent ?? "";
}

export function flowReadingGraph(db: FlowData): ReadingGraph {
  const groups = db.getSubGraphs().map((group) => ({
    id: group.id, title: labelText(group.title), members: [...group.nodes],
  }));
  const groupIds = new Set(groups.map(({ id }) => id));
  return {
    groups,
    nodes: [...db.getVertices().values()].filter(({ id }) => !groupIds.has(id)).map((node) => ({
      id: node.id, label: labelText(node.text ?? node.id), shape: node.type ?? "square", link: node.link,
    })),
    // Invisible Mermaid edges are layout constraints, not visible relationships.
    edges: db.getEdges().filter((edge) => edge.stroke !== "invisible").map((edge) => ({
      source: edge.start, target: edge.end, label: labelText(edge.text ?? ""),
      marker: edge.type ?? "arrow_open", stroke: edge.stroke ?? "normal",
    })),
  };
}

function text(key: "mermaid.relations" | "mermaid.crossings" | "mermaid.layoutError" | "mermaid.editError" | "mermaid.overview") {
  const lang = document.documentElement.lang;
  return translate(isAppLanguage(lang) ? lang : "zh-Hant", key);
}

export function readingDiagramHtml(graph: ReadingGraph, id: string, source = "") {
  const root = document.createElement("div");
  root.className = "reading-diagram";
  root.dataset.readingModel = JSON.stringify(graph);
  root.dataset.readingId = id;
  // Source contains arrows and HTML-like labels; encode it as data so the
  // preview sanitizer never interprets it as markup or removes the attribute.
  root.dataset.readingSource = encodeURIComponent(source);
  root.contentEditable = "false";
  const legend = document.createElement("div");
  legend.className = "reading-diagram__legend";
  legend.textContent = text("mermaid.crossings");
  const stage = document.createElement("div");
  stage.className = "reading-diagram__stage";
  const paths = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  paths.classList.add("reading-diagram__connections");
  paths.setAttribute("aria-hidden", "true");
  stage.append(paths);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const byGroup = new Map(graph.groups.map((group) => [group.id, group]));
  const emitted = new Set<string>();
  function nodeElement(node: ReadingNode) {
    const button = document.createElement(node.link ? "a" : "button");
    if (button instanceof HTMLButtonElement) button.type = "button";
    if (button instanceof HTMLAnchorElement && node.link) {
      try {
        const target = new URL(node.link, window.location.href);
        if (["http:", "https:", "mailto:", "tauri:"].includes(target.protocol)) button.href = node.link;
      } catch { /* Invalid links must not prevent the rest of the graph from rendering. */ }
    }
    button.className = "reading-diagram__node";
    button.dataset.readingNode = node.id;
    button.dataset.shape = node.shape;
    button.setAttribute("aria-pressed", "false");
    const [first, ...rest] = node.label.split("\n");
    const name = document.createElement("span");
    name.className = "reading-diagram__name";
    name.dataset.diagramText = `node:${node.id}`;
    name.dataset.diagramPart = "name";
    name.textContent = first;
    button.append(name);
    if (rest.length) {
      const description = document.createElement("span");
      description.className = "reading-diagram__description";
      description.dataset.diagramText = `node:${node.id}`;
      description.dataset.diagramPart = "description";
      description.textContent = rest.join("\n");
      button.append(description);
    }
    return button;
  }
  function groupElement(group: ReadingGroup): HTMLElement {
    emitted.add(group.id);
    const section = document.createElement("section");
    section.className = "reading-diagram__group";
    const heading = document.createElement("div");
    heading.className = "reading-diagram__group-title";
    heading.dataset.readingGroup = group.id;
    heading.dataset.diagramText = `group:${group.id}`;
    heading.textContent = group.title;
    section.append(heading);
    let grid: HTMLElement | null = null;
    for (const member of group.members) {
      if (emitted.has(member)) continue;
      const childGroup = byGroup.get(member);
      if (childGroup) { section.append(groupElement(childGroup)); grid = null; continue; }
      const node = byId.get(member);
      if (!node) continue;
      if (!grid) { grid = document.createElement("div"); grid.className = "reading-diagram__nodes"; section.append(grid); }
      emitted.add(member); grid.append(nodeElement(node));
    }
    return section;
  }
  const nested = new Set(graph.groups.flatMap((group) => group.members.filter((id) => byGroup.has(id))));
  for (const group of graph.groups) if (!nested.has(group.id)) stage.append(groupElement(group));
  const ungrouped = graph.nodes.filter((node) => !emitted.has(node.id));
  if (ungrouped.length) {
    const grid = document.createElement("div"); grid.className = "reading-diagram__nodes";
    ungrouped.forEach((node) => grid.append(nodeElement(node)));
    stage.prepend(grid);
  }
  const body = document.createElement("div");
  body.className = "reading-diagram__body";
  const overview = document.createElement("nav");
  overview.className = "reading-diagram__overview";
  overview.setAttribute("aria-label", text("mermaid.overview"));
  const overviewTitle = document.createElement("strong");
  overviewTitle.textContent = text("mermaid.overview");
  overview.append(overviewTitle);
  const outlineNodes = new Set<string>();
  function outlineNode(node: ReadingNode) {
    if (outlineNodes.has(node.id)) return;
    outlineNodes.add(node.id);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.readingTarget = node.id;
    button.textContent = node.label.split("\n")[0];
    overview.append(button);
  }
  for (const group of graph.groups) {
    const title = document.createElement("span");
    title.className = "reading-diagram__overview-group";
    title.dataset.readingGroupTarget = group.id;
    title.textContent = group.title;
    overview.append(title);
    group.members.forEach((member) => { const node = byId.get(member); if (node) outlineNode(node); });
  }
  graph.nodes.forEach(outlineNode);
  const canvas = document.createElement("div");
  canvas.className = "reading-diagram__canvas";
  canvas.append(stage);
  body.append(overview, canvas);
  const relations = document.createElement("div");
  relations.className = "reading-diagram__relations";
  relations.setAttribute("aria-live", "polite");
  const error = document.createElement("div");
  error.className = "reading-diagram__error";
  error.hidden = true;
  root.append(legend, body, error, relations);
  return root.outerHTML;
}

function mountReadingDiagram(root: HTMLElement, editing?: DiagramEditing) {
  const graph = JSON.parse(root.dataset.readingModel ?? "") as ReadingGraph;
  const id = root.dataset.readingId!;
  const stage = root.querySelector<HTMLElement>(".reading-diagram__stage")!;
  const svg = root.querySelector<SVGSVGElement>(".reading-diagram__connections")!;
  const relations = root.querySelector<HTMLElement>(".reading-diagram__relations")!;
  const error = root.querySelector<HTMLElement>(".reading-diagram__error")!;
  const overview = root.querySelector<HTMLElement>(".reading-diagram__overview")!;
  const body = root.querySelector<HTMLElement>(".reading-diagram__body")!;
  const names = new Map([...graph.nodes.map((n) => [n.id, n.label.replace(/\n/g, " ")] as const), ...graph.groups.map((g) => [g.id, g.title] as const)]);
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-reading-node]")];
  const fields = [...root.querySelectorAll<HTMLElement>("[data-diagram-text]")];
  let source = decodeURIComponent(root.dataset.readingSource ?? "");
  let textRanges: DiagramTextRange[] = source ? flowTextRanges(source, graph.nodes.map(n => n.id), graph.groups.map(g => g.id)) : [];
  let composing = false;
  let syncingText = false;
  const textEditors = new Map<HTMLElement, { view: TextEditor; permission: Compartment; editable: boolean }>();
  const fieldFrom = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>("[data-diagram-text]") : null;
  const editableText = (field: HTMLElement) => textEditors.get(field)?.view.state.doc.toString() ?? field.textContent ?? "";
  function syncEditable() {
    const enabled = Boolean(editing?.canEdit());
    fields.forEach(field => {
      const editable = enabled && textRanges.some(range => range.key === field.dataset.diagramText);
      const editor = textEditors.get(field);
      if (!editor && editable) {
        const doc = editableText(field), permission = new Compartment();
        field.replaceChildren();
        const view = new TextEditor({ parent: field, doc, extensions: [
          TextEditor.lineWrapping,
          permission.of([EditorState.readOnly.of(false), TextEditor.editable.of(true)]),
          keymap.of([
            { key: "Mod-z", run: () => { runTextHistory(false); return true; } },
            { key: "Mod-Shift-z", run: () => { runTextHistory(true); return true; } },
            { key: "Mod-y", run: () => { runTextHistory(true); return true; } },
            ...defaultKeymap,
          ]),
          TextEditor.updateListener.of(update => { if (update.docChanged && !syncingText) commitText(field); }),
        ] });
        view.dom.style.color = "inherit";
        textEditors.set(field, { view, permission, editable });
      } else if (editor && editor.editable !== editable) {
        editor.editable = editable;
        editor.view.dispatch({ effects: editor.permission.reconfigure([EditorState.readOnly.of(!editable), TextEditor.editable.of(editable)]) });
      }
    });
  }
  function updateTextModel() {
    graph.nodes.forEach(node => {
      const owned = fields.filter(field => field.dataset.diagramText === `node:${node.id}`);
      node.label = owned.map(editableText).join("\n");
      names.set(node.id, node.label.replace(/\n/g, " "));
      root.querySelectorAll<HTMLElement>("[data-reading-target]").forEach(button => {
        if (button.dataset.readingTarget === node.id) button.textContent = node.label.split("\n")[0];
      });
    });
    graph.groups.forEach(group => {
      const field = fields.find(field => field.dataset.diagramText === `group:${group.id}`);
      if (field) {
        group.title = editableText(field); names.set(group.id, group.title);
        root.querySelectorAll<HTMLElement>("[data-reading-group-target]").forEach(title => {
          if (title.dataset.readingGroupTarget === group.id) title.textContent = group.title;
        });
      }
    });
    root.dataset.readingModel = JSON.stringify(graph);
    updateSelection(); schedule();
  }
  function commitText(field: HTMLElement) {
    if (!editing?.canEdit() || composing) return;
    const key = field.dataset.diagramText!;
    const owned = fields.filter(item => item.dataset.diagramText === key);
    const value = owned.map(editableText).join("\n");
    const current = key.startsWith("node:") ? graph.nodes.find(node => `node:${node.id}` === key)?.label : graph.groups.find(group => `group:${group.id}` === key)?.title;
    if (value === current) return;
    const next = replaceDiagramText(source, textRanges, key, value);
    const previous = source, previousRanges = textRanges;
    source = next.source; textRanges = next.ranges;
    root.dataset.readingSource = encodeURIComponent(source);
    if (!editing.change(root, previous, source)) {
      source = previous; textRanges = previousRanges; root.dataset.readingSource = encodeURIComponent(previous);
      error.hidden = false; error.textContent = text("mermaid.editError");
      return;
    }
    updateTextModel();
  }
  function runTextHistory(redo: boolean) {
    if (!editing?.canEdit() || composing) return;
    const active = fieldFrom(document.activeElement);
    const next = editing.history(root, redo);
    if (next === undefined || next === source) return;
    source = next; root.dataset.readingSource = encodeURIComponent(source);
    textRanges = flowTextRanges(source, graph.nodes.map(n => n.id), graph.groups.map(g => g.id));
    const labels = restoredFlowText(source);
    syncingText = true;
    fields.forEach(field => {
      const raw = labels.get(field.dataset.diagramText!);
      if (raw === undefined) return;
      const lines = labelText(raw).split("\n");
      const hasDescription = fields.some(item => item.dataset.diagramText === field.dataset.diagramText && item.dataset.diagramPart === "description");
      const value = field.dataset.diagramPart === "name" && hasDescription ? lines[0] : field.dataset.diagramPart === "description" ? lines.slice(1).join("\n") : lines.join("\n");
      const editor = textEditors.get(field)?.view;
      if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: Math.min(editor.state.selection.main.head, value.length) } });
      else field.textContent = value;
    });
    syncingText = false;
    updateTextModel();
    if (active) textEditors.get(active)?.view.focus();
  }
  function onTextBeforeInput(event: Event) {
    if (!fieldFrom(event.target)) return;
    const input = event as InputEvent;
    if (input.inputType === "historyUndo" || input.inputType === "historyRedo") {
      event.preventDefault(); event.stopPropagation(); runTextHistory(input.inputType === "historyRedo");
    }
  }
  function onTextKey(event: KeyboardEvent) {
    if (fieldFrom(event.target)) event.stopPropagation();
  }
  function onCompositionStart(event: Event) { if (fieldFrom(event.target)) composing = true; }
  function onCompositionEnd(event: Event) { const field = fieldFrom(event.target); if (field) { composing = false; commitText(field); } }
  root.addEventListener("pointerdown", syncEditable, true);
  root.addEventListener("beforeinput", onTextBeforeInput, true);
  root.addEventListener("keydown", onTextKey);
  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd);
  syncEditable();
  let selected: string | null = null;
  let frame = 0;
  let lastSize = "";
  let overviewOffset = 0;
  let overviewFrame = 0;
  function positionOverview() {
    overviewFrame = 0;
    if (!overview.offsetHeight) return;
    const rect = overview.getBoundingClientRect();
    const baseTop = rect.top - overviewOffset;
    let top = 60;
    for (let ancestor = overview.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.scrollHeight > ancestor.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(ancestor).overflowY)) {
        top = Math.max(top, ancestor.getBoundingClientRect().top + 16);
        break;
      }
    }
    // Containing editor scrollports prevent CSS sticky from following the page.
    // Keep the overview within this diagram and its actual scrolling viewport.
    overviewOffset = Math.min(Math.max(0, body.getBoundingClientRect().bottom - baseTop - rect.height), Math.max(0, top - baseTop));
    overview.style.transform = `translateY(${overviewOffset}px)`;
  }
  function scheduleOverview() { if (!overviewFrame) overviewFrame = requestAnimationFrame(positionOverview); }
  const nodeName = (id: string) => graph.nodes.find((node) => node.id === id)?.label.split("\n")[0] ?? names.get(id) ?? id;
  const connectionSymbol = (marker: string) => ({
    arrow_point: "→", double_arrow_point: "↔", arrow_circle: "—○", double_arrow_circle: "○—○",
    arrow_cross: "—×", double_arrow_cross: "×—×",
  }[marker] ?? "—");
  function updateSelection() {
    nodes.forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.readingNode === selected)));
    for (const node of root.querySelectorAll<HTMLElement>("[data-reading-target]")) node.setAttribute("aria-current", String(node.dataset.readingTarget === selected));
    for (const path of svg.querySelectorAll<SVGPathElement>(".reading-diagram__edge")) {
      const edge = graph.edges[Number(path.dataset.edge)];
      const active = selected === edge.source || selected === edge.target;
      path.classList.toggle("is-related", active);
    }
    relations.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = selected ? nodeName(selected) : text("mermaid.relations");
    relations.append(heading);
    graph.edges.forEach((edge) => {
      if (selected && selected !== edge.source && selected !== edge.target) return;
      const row = document.createElement("div");
      row.textContent = `${nodeName(edge.source)} ${connectionSymbol(edge.marker)} ${nodeName(edge.target)}${edge.label ? `：${edge.label}` : ""}`;
      relations.append(row);
    });
  }
  function element<Tag extends keyof SVGElementTagNameMap>(tag: Tag, attributes: Record<string, string>) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }
  function draw() {
    frame = 0;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const boxes: DiagramBox[] = [...nodes, ...root.querySelectorAll<HTMLElement>("[data-reading-group]")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.readingNode ?? node.dataset.readingGroup!, left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height };
    });
    const size = JSON.stringify(boxes);
    if (size === lastSize) return;
    lastSize = size;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    const defs = element("defs", {});
    for (const kind of ["point", "circle", "cross"]) {
      const marker = element("marker", { id: `${id}-${kind}`, viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
      marker.append(kind === "circle" ? element("circle", { cx: "4", cy: "4", r: "3", fill: "var(--color-surface)", stroke: "var(--reading-line)" }) : element("path", {
        d: kind === "cross" ? "M1 1L7 7M1 7L7 1" : "M0 0L8 4L0 8Z",
        fill: kind === "cross" ? "none" : "var(--reading-line)", stroke: "var(--reading-line)",
      }));
      defs.append(marker);
    }
    svg.append(defs);
    try {
      const routes = routeDiagramConnections(boxes, graph.edges, [], bounds.width, bounds.height);
      routes.forEach((points, index) => {
        const edge = graph.edges[index];
        const d = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
        svg.append(element("path", { d, class: "reading-diagram__edge-clearance" }));
        const path = element("path", { d, class: "reading-diagram__edge", "data-edge": String(index) });
        const marker = edge.marker.replace("double_", "").replace("arrow_", "");
        if (["point", "circle", "cross"].includes(marker)) {
          path.setAttribute("marker-end", `url(#${id}-${marker})`);
          if (edge.marker.startsWith("double_")) path.setAttribute("marker-start", `url(#${id}-${marker})`);
        }
        if (edge.stroke === "dotted") path.setAttribute("stroke-dasharray", "4 3");
        if (edge.stroke === "thick") path.style.strokeWidth = "3px";
        const title = element("title", {});
        title.textContent = `${nodeName(edge.source)} ${connectionSymbol(edge.marker)} ${nodeName(edge.target)}${edge.label ? `：${edge.label}` : ""}`;
        path.append(title); svg.append(path);
      });
      root.dataset.readingState = "ready";
      error.hidden = true;
    } catch (cause) {
      root.dataset.readingState = "error";
      error.hidden = false;
      error.textContent = text("mermaid.layoutError");
      console.error("Unable to route reading diagram", cause);
    }
    updateSelection();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); scheduleOverview(); }
  function onClick(event: MouseEvent) {
    const field = fieldFrom(event.target);
    if (field && editing?.canEdit()) { event.preventDefault(); textEditors.get(field)?.view.focus(); return; }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-target]") : null;
    if (target && root.contains(target)) {
      selected = target.dataset.readingTarget!;
      updateSelection();
      nodes.find((node) => node.dataset.readingNode === selected)?.scrollIntoView({ block: "center" });
      return;
    }
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reading-node]") : null;
    if (!node || !root.contains(node)) return;
    selected = selected === node.dataset.readingNode ? null : node.dataset.readingNode!;
    updateSelection();
  }
  root.addEventListener("click", onClick);
  window.addEventListener("scroll", scheduleOverview, true);
  window.addEventListener("resize", scheduleOverview);
  const observer = new ResizeObserver(schedule);
  observer.observe(stage);
  nodes.forEach((node) => observer.observe(node));
  // Initial layout must also render in a background WebKit window, where rAF
  // can be suspended until the window becomes foreground.
  updateSelection(); draw(); positionOverview();
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(overviewFrame);
    root.removeEventListener("click", onClick);
    root.removeEventListener("pointerdown", syncEditable, true);
    root.removeEventListener("beforeinput", onTextBeforeInput, true);
    root.removeEventListener("keydown", onTextKey);
    root.removeEventListener("compositionstart", onCompositionStart);
    root.removeEventListener("compositionend", onCompositionEnd);
    textEditors.forEach(({ view }) => view.destroy());
    window.removeEventListener("scroll", scheduleOverview, true);
    window.removeEventListener("resize", scheduleOverview);
  };
}

/** Milkdown sanitizes/replaces previews asynchronously; mount only after insertion. */
export function observeReadingDiagrams(host: HTMLElement, editing?: DiagramEditing) {
  const mounted = new Map<HTMLElement, () => void>();
  function sync() {
    for (const [root, dispose] of mounted) if (!host.contains(root)) { dispose(); mounted.delete(root); }
    for (const root of host.querySelectorAll<HTMLElement>("[data-reading-model]")) {
      if (!mounted.has(root)) mounted.set(root, mountReadingDiagram(root, editing));
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(host, { childList: true, subtree: true });
  sync();
  return () => { observer.disconnect(); mounted.forEach((dispose) => dispose()); mounted.clear(); };
}
