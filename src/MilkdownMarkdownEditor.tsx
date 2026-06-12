import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
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

function normalizeSelectedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMarkdownForScholium(markdown: string) {
  return markdown.replace(/^(\s*)\*\s+/gm, "$1- ");
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
  const currentMarkdownRef = useRef(normalizeMarkdownForScholium(value));
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const [editorRevision, setEditorRevision] = useState(0);

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
    void annotations;
    void onAnnotationClick;
    void onAnnotationDoubleClick;
  }, [annotations, onAnnotationClick, onAnnotationDoubleClick]);

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
