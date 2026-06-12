import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  EditorChangeSource,
  TextAnnotation,
  TextSelectionAnchor,
} from "./MarkdownEditor";

type MilkdownMarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
};

const milkdownAnnotationPluginKey = new PluginKey<DecorationSet>(
  "scholium-milkdown-annotations",
);

function normalizeSelectedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMarkdownForScholium(markdown: string) {
  return markdown
    .replace(/^(\s*)\*\s+/gm, "$1- ")
    .replace(
      /^(\s*(?:[-+]|\d+[.)])\s+\S[^\n]*)\n\n(?=\s*(?:[-+]|\d+[.)])\s+\S)/gm,
      "$1\n",
    );
}

function buildAnchor(markdown: string, selectedText: string): TextSelectionAnchor | null {
  const normalizedSelection = normalizeSelectedText(selectedText);
  if (!normalizedSelection) return null;

  const exactIndex = markdown.indexOf(selectedText);
  if (exactIndex >= 0) {
    return {
      from: exactIndex,
      to: exactIndex + selectedText.length,
      selectedText,
      prefix: markdown.slice(Math.max(0, exactIndex - 48), exactIndex),
      suffix: markdown.slice(
        exactIndex + selectedText.length,
        Math.min(markdown.length, exactIndex + selectedText.length + 48),
      ),
    };
  }

  const normalizedMarkdown = markdown.replace(/\u00a0/g, " ");
  const normalizedIndex = normalizedMarkdown.indexOf(normalizedSelection);
  if (normalizedIndex < 0) return null;

  return {
    from: normalizedIndex,
    to: normalizedIndex + normalizedSelection.length,
    selectedText: normalizedSelection,
    prefix: markdown.slice(Math.max(0, normalizedIndex - 48), normalizedIndex),
    suffix: markdown.slice(
      normalizedIndex + normalizedSelection.length,
      Math.min(markdown.length, normalizedIndex + normalizedSelection.length + 48),
    ),
  };
}

function selectionBelongsToRoot(root: HTMLElement, selection: Selection | null) {
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      selection.focusNode &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode),
  );
}

function nonCollapsedSelectionInRoot(
  root: HTMLElement,
  selection: Selection | null,
): selection is Selection & { anchorNode: Node; focusNode: Node } {
  return selectionBelongsToRoot(root, selection);
}

function buildNormalizedVisibleTextIndex(doc: ProseMirrorNode) {
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true;

    for (let offset = 0; offset < node.text.length; offset += 1) {
      const char = node.text[offset];
      const prosePosition = position + offset;
      if (/\s/.test(char)) {
        if (chars.length > 0 && chars[chars.length - 1] !== " ") {
          chars.push(" ");
          positions.push(prosePosition);
        }
        continue;
      }

      chars.push(char);
      positions.push(prosePosition);
    }

    return true;
  });

  return { positions, text: chars.join("") };
}

function countOccurrencesBefore(markdown: string, annotation: TextAnnotation, target: string) {
  if (!target) return 0;

  const beforeAnnotation = normalizeSelectedText(markdown.slice(0, annotation.from));
  let count = 0;
  let searchFrom = 0;

  while (searchFrom < beforeAnnotation.length) {
    const nextIndex = beforeAnnotation.indexOf(target, searchFrom);
    if (nextIndex < 0) break;
    count += 1;
    searchFrom = nextIndex + target.length;
  }

  return count;
}

function indexOfOccurrence(text: string, target: string, occurrence: number) {
  let searchFrom = 0;
  let currentOccurrence = 0;

  while (searchFrom <= text.length) {
    const nextIndex = text.indexOf(target, searchFrom);
    if (nextIndex < 0) return -1;
    if (currentOccurrence === occurrence) return nextIndex;

    currentOccurrence += 1;
    searchFrom = nextIndex + target.length;
  }

  return -1;
}

function buildAnnotationDecorations(
  doc: ProseMirrorNode,
  markdown: string,
  annotations: TextAnnotation[],
) {
  const { positions, text } = buildNormalizedVisibleTextIndex(doc);
  const decorations = annotations.flatMap((annotation) => {
    const target = normalizeSelectedText(
      annotation.selectedText || markdown.slice(annotation.from, annotation.to),
    );
    if (!target) return [];

    const occurrence = countOccurrencesBefore(markdown, annotation, target);
    const normalizedIndex = indexOfOccurrence(text, target, occurrence);
    if (normalizedIndex < 0) return [];

    const start = positions[normalizedIndex];
    const end = positions[normalizedIndex + target.length - 1] + 1;
    if (start === undefined || end === undefined || end <= start) return [];

    return Decoration.inline(start, end, {
      class: `milkdown-note-annotation ${
        annotation.kind === "glossary" ? "milkdown-glossary-annotation" : ""
      }`,
      "data-annotation-kind": annotation.kind ?? "note",
      "data-note-id": annotation.id,
      "data-note-tone": String(annotation.tone ?? 0),
    });
  });

  return DecorationSet.create(doc, decorations);
}

function noteIdFromAnnotationTarget(target: EventTarget | null) {
  const targetElement =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return (
    targetElement?.closest<HTMLElement>(".milkdown-note-annotation[data-note-id]")?.dataset
      .noteId ?? null
  );
}

function createAnnotationPlugin({
  getAnnotations,
  getMarkdown,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: {
  getAnnotations: () => TextAnnotation[];
  getMarkdown: () => string;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
}) {
  return new Plugin<DecorationSet>({
    key: milkdownAnnotationPluginKey,
    props: {
      decorations(state) {
        return milkdownAnnotationPluginKey.getState(state) ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        click(_view, event) {
          const noteId = noteIdFromAnnotationTarget(event.target);
          if (!noteId || !window.getSelection()?.isCollapsed) return false;

          event.preventDefault();
          onAnnotationClick(noteId);
          return true;
        },
        dblclick(_view, event) {
          const noteId = noteIdFromAnnotationTarget(event.target);
          if (!noteId) return false;

          event.preventDefault();
          onAnnotationDoubleClick(noteId);
          return true;
        },
      },
    },
    state: {
      init(_, state) {
        return buildAnnotationDecorations(state.doc, getMarkdown(), getAnnotations());
      },
      apply(transaction, decorations) {
        const mappedDecorations = decorations.map(transaction.mapping, transaction.doc);
        if (!transaction.getMeta(milkdownAnnotationPluginKey)) return mappedDecorations;

        return buildAnnotationDecorations(transaction.doc, getMarkdown(), getAnnotations());
      },
    },
  });
}

export function MilkdownMarkdownEditor({
  value,
  annotations,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: MilkdownMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const annotationsRef = useRef(annotations);
  const currentMarkdownRef = useRef(normalizeMarkdownForScholium(value));
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const [editorRevision, setEditorRevision] = useState(0);
  const annotationSignature = useMemo(
    () =>
      annotations
        .map(
          (annotation) =>
            `${annotation.id}:${annotation.from}:${annotation.to}:${annotation.selectedText ?? ""}:${
              annotation.tone ?? 0
            }:${annotation.kind ?? "note"}`,
        )
        .join("|"),
    [annotations],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onSelectionEnterRef.current = onSelectionEnter;
  }, [onSelectionEnter]);

  useEffect(() => {
    onAnnotationClickRef.current = onAnnotationClick;
  }, [onAnnotationClick]);

  useEffect(() => {
    onAnnotationDoubleClickRef.current = onAnnotationDoubleClick;
  }, [onAnnotationDoubleClick]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;

    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(milkdownAnnotationPluginKey, true));
      });
    } catch {
      // The editor can still be mounting when the first annotation props arrive.
    }
  }, [annotationSignature]);

  useEffect(() => {
    const normalizedValue = normalizeMarkdownForScholium(value);
    if (normalizedValue === currentMarkdownRef.current) return;

    currentMarkdownRef.current = normalizedValue;
    setEditorRevision((revision) => revision + 1);
  }, [value]);

  function anchorFromCurrentSelection() {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !nonCollapsedSelectionInRoot(root, selection)) return null;

    return buildAnchor(currentMarkdownRef.current, selection.toString());
  }

  function updateSelectionFromDom() {
    onSelectionChangeRef.current(anchorFromCurrentSelection());
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    root.innerHTML = "";

    const crepe = new Crepe({
      root,
      defaultValue: currentMarkdownRef.current,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.CodeMirror]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.TopBar]: false,
      },
    });
    crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => [
        ...plugins,
        createAnnotationPlugin({
          getAnnotations: () => annotationsRef.current,
          getMarkdown: () => currentMarkdownRef.current,
          onAnnotationClick: (noteId) => onAnnotationClickRef.current(noteId),
          onAnnotationDoubleClick: (noteId) => onAnnotationDoubleClickRef.current(noteId),
        }),
      ]);
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        const normalizedMarkdown = normalizeMarkdownForScholium(markdown);
        if (disposed || normalizedMarkdown === currentMarkdownRef.current) return;

        currentMarkdownRef.current = normalizedMarkdown;
        onChangeRef.current(normalizedMarkdown, "user");
      });

      listener.selectionUpdated(() => {
        window.requestAnimationFrame(updateSelectionFromDom);
      });
    });

    crepeRef.current = crepe;
    void crepe.create().catch((error: unknown) => {
      console.error("failed to create Milkdown editor", error);
    });

    return () => {
      disposed = true;
      crepeRef.current = null;
      void crepe.destroy();
      root.innerHTML = "";
    };
  }, [editorRevision]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const isPlainEnter =
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey;
    if (!isPlainEnter) return;

    const anchor = anchorFromCurrentSelection();
    if (!anchor) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectionEnterRef.current(anchor);
  }

  return (
    <div
      className="milkdown-markdown-editor"
      onKeyDownCapture={handleKeyDown}
      onKeyUp={updateSelectionFromDom}
      onMouseUp={updateSelectionFromDom}
      ref={rootRef}
    />
  );
}
