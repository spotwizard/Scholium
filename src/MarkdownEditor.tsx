import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  ViewUpdate,
} from "@codemirror/view";

export type TextSelectionAnchor = {
  from: number;
  to: number;
  selectedText: string;
  prefix: string;
  suffix: string;
};

export type TextAnnotation = {
  id: string;
  from: number;
  to: number;
};

export type EditorChangeSource = "user" | "undo";

type MarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
};

type EditorAnnotationFrame = {
  noteId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type EditorAnnotationRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type EditorBrowserSelection = Selection & {
  anchorNode: Node;
  focusNode: Node;
};

const setAnnotationsEffect = StateEffect.define<TextAnnotation[]>();
const editorAnnotationFramePadding = 4;

function buildAnchor(value: string, from: number, to: number): TextSelectionAnchor | null {
  if (from === to) return null;

  const selectedText = value.slice(from, to);
  if (!selectedText.trim()) return null;

  return {
    from,
    to,
    selectedText,
    prefix: value.slice(Math.max(0, from - 48), from),
    suffix: value.slice(to, Math.min(value.length, to + 48)),
  };
}

function browserSelectionBelongsToView(
  view: EditorView,
  selection: Selection | null,
): selection is EditorBrowserSelection {
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      selection.focusNode &&
      view.dom.contains(selection.anchorNode) &&
      view.dom.contains(selection.focusNode),
  );
}

function buildAnchorFromSelection(view: EditorView): TextSelectionAnchor | null {
  const doc = view.state.doc.toString();
  const browserSelection = window.getSelection();

  if (browserSelectionBelongsToView(view, browserSelection)) {
    try {
      const anchorPosition = view.posAtDOM(
        browserSelection.anchorNode,
        browserSelection.anchorOffset,
      );
      const focusPosition = view.posAtDOM(
        browserSelection.focusNode,
        browserSelection.focusOffset,
      );

      return buildAnchor(
        doc,
        Math.min(anchorPosition, focusPosition),
        Math.max(anchorPosition, focusPosition),
      );
    } catch {
      // CodeMirror can reject DOM positions from transient browser selections.
    }

    const selectedText = browserSelection.toString();
    const selectedTextIndex = doc.indexOf(selectedText);
    if (selectedTextIndex >= 0) {
      return buildAnchor(doc, selectedTextIndex, selectedTextIndex + selectedText.length);
    }
  }

  const range = view.state.selection.main;
  return buildAnchor(doc, range.from, range.to);
}

function buildDecorations(annotations: TextAnnotation[]) {
  const ranges: Range<Decoration>[] = annotations
    .filter((annotation) => annotation.to > annotation.from)
    .map((annotation) =>
      Decoration.mark({
        attributes: {
          "data-note-id": annotation.id,
        },
        class: "cm-note-annotation",
      }).range(annotation.from, annotation.to),
    );

  return Decoration.set(ranges, true);
}

function roundEditorFrameValue(value: number) {
  return Math.round(value * 100) / 100;
}

function measureEditorAnnotationFrames(container: HTMLDivElement): EditorAnnotationFrame[] {
  const containerRect = container.getBoundingClientRect();
  const rectsByNoteId = new Map<string, EditorAnnotationRect[]>();

  container
    .querySelectorAll<HTMLElement>(".cm-note-annotation[data-note-id]")
    .forEach((annotation) => {
      const noteId = annotation.dataset.noteId;
      if (!noteId) return;

      const annotationRects = Array.from(annotation.getClientRects())
        .map((rect) => {
          const left = Math.max(rect.left, containerRect.left);
          const top = Math.max(rect.top, containerRect.top);
          const right = Math.min(rect.right, containerRect.right);
          const bottom = Math.min(rect.bottom, containerRect.bottom);

          return { left, top, right, bottom };
        })
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
      if (annotationRects.length === 0) return;

      rectsByNoteId.set(noteId, [...(rectsByNoteId.get(noteId) ?? []), ...annotationRects]);
    });

  return Array.from(rectsByNoteId.entries())
    .map(([noteId, rects]) => {
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));

      return {
        noteId,
        left: roundEditorFrameValue(
          Math.max(0, left - containerRect.left - editorAnnotationFramePadding),
        ),
        top: roundEditorFrameValue(
          Math.max(0, top - containerRect.top - editorAnnotationFramePadding),
        ),
        width: roundEditorFrameValue(right - left + editorAnnotationFramePadding * 2),
        height: roundEditorFrameValue(bottom - top + editorAnnotationFramePadding * 2),
      };
    })
    .sort(
      (left, right) =>
        left.top - right.top || left.left - right.left || left.noteId.localeCompare(right.noteId),
    );
}

function areEditorAnnotationFramesEqual(
  leftFrames: EditorAnnotationFrame[],
  rightFrames: EditorAnnotationFrame[],
) {
  if (leftFrames.length !== rightFrames.length) return false;

  return leftFrames.every((leftFrame, index) => {
    const rightFrame = rightFrames[index];

    return (
      leftFrame.noteId === rightFrame.noteId &&
      leftFrame.left === rightFrame.left &&
      leftFrame.top === rightFrame.top &&
      leftFrame.width === rightFrame.width &&
      leftFrame.height === rightFrame.height
    );
  });
}

const annotationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setAnnotationsEffect)) {
        nextDecorations = buildDecorations(effect.value);
      }
    }

    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function MarkdownEditor({
  value,
  annotations,
  onChange,
  onSelectionChange,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const animationFrameRef = useRef(0);
  const selectionFrameRef = useRef(0);
  const selectionFallbackTimerRef = useRef(0);
  const mouseSelectionStartedRef = useRef(false);
  const annotationInteractionUntilRef = useRef(0);
  const suppressNextChangeRef = useRef(false);
  const [annotationFrames, setAnnotationFrames] = useState<EditorAnnotationFrame[]>([]);

  const annotationSignature = useMemo(
    () =>
      annotations
        .map((annotation) => `${annotation.id}:${annotation.from}:${annotation.to}`)
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
    onAnnotationClickRef.current = onAnnotationClick;
  }, [onAnnotationClick]);

  useEffect(() => {
    onAnnotationDoubleClickRef.current = onAnnotationDoubleClick;
  }, [onAnnotationDoubleClick]);

  function updateAnnotationFrames() {
    const container = containerRef.current;
    if (!container) return;

    const nextFrames = measureEditorAnnotationFrames(container);
    setAnnotationFrames((currentFrames) =>
      areEditorAnnotationFramesEqual(currentFrames, nextFrames) ? currentFrames : nextFrames,
    );
  }

  function scheduleAnnotationFrameUpdate() {
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = window.requestAnimationFrame(updateAnnotationFrames);
  }

  function publishSelectionAfterMouseUp(view: EditorView) {
    if (Date.now() < annotationInteractionUntilRef.current) return;

    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      if (Date.now() < annotationInteractionUntilRef.current) return;

      const anchor = buildAnchorFromSelection(view);
      onSelectionChangeRef.current(anchor);
      selectionFrameRef.current = 0;
    });
  }

  function noteIdFromAnnotationTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return null;

    return target.closest<HTMLElement>(".cm-note-annotation")?.dataset.noteId ?? null;
  }

  function suppressSelectionForAnnotationInteraction() {
    annotationInteractionUntilRef.current = Date.now() + 500;
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    mouseSelectionStartedRef.current = false;
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scroller = container.querySelector<HTMLElement>(".cm-scroller");
    const resizeObserver = new ResizeObserver(scheduleAnnotationFrameUpdate);

    resizeObserver.observe(container);
    if (scroller) {
      resizeObserver.observe(scroller);
      scroller.addEventListener("scroll", scheduleAnnotationFrameUpdate);
    }
    window.addEventListener("resize", scheduleAnnotationFrameUpdate);
    scheduleAnnotationFrameUpdate();

    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect();
      scroller?.removeEventListener("scroll", scheduleAnnotationFrameUpdate);
      window.removeEventListener("resize", scheduleAnnotationFrameUpdate);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        if (suppressNextChangeRef.current) {
          suppressNextChangeRef.current = false;
        } else {
          const source = update.transactions.some((transaction) =>
            transaction.isUserEvent("undo"),
          )
            ? "undo"
            : "user";

          onChangeRef.current(update.state.doc.toString(), source);
        }
      }

      if (update.docChanged) {
        onSelectionChangeRef.current(null);
      }

      scheduleAnnotationFrameUpdate();
    });

    const annotationClickHandler = EditorView.domEventHandlers({
      mousedown(event) {
        if (noteIdFromAnnotationTarget(event.target)) {
          suppressSelectionForAnnotationInteraction();
          return false;
        }

        if (event.button === 0) {
          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      pointerdown(event) {
        if (noteIdFromAnnotationTarget(event.target)) {
          suppressSelectionForAnnotationInteraction();
          return false;
        }

        if (event.button === 0) {
          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      mouseup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteIdFromAnnotationTarget(event.target);
        if (noteId) {
          suppressSelectionForAnnotationInteraction();
          onAnnotationClickRef.current(noteId);
          return true;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      pointerup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteIdFromAnnotationTarget(event.target);
        if (noteId) {
          suppressSelectionForAnnotationInteraction();
          onAnnotationClickRef.current(noteId);
          return true;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      click(event) {
        const noteId = noteIdFromAnnotationTarget(event.target);
        if (!noteId) return false;

        suppressSelectionForAnnotationInteraction();
        onAnnotationClickRef.current(noteId);
        return true;
      },
      dblclick(event) {
        const noteId = noteIdFromAnnotationTarget(event.target);
        if (!noteId) return false;

        event.preventDefault();
        suppressSelectionForAnnotationInteraction();
        onAnnotationDoubleClickRef.current(noteId);
        return true;
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        annotationField,
        updateListener,
        annotationClickHandler,
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
    });

    const view = new EditorView({
      parent: containerRef.current,
      state,
    });

    view.dispatch({ effects: setAnnotationsEffect.of(annotations) });
    viewRef.current = view;

    function handleWindowMouseUp(event: MouseEvent) {
      handleWindowSelectionPointerEnd(event);
    }

    function handleWindowPointerUp(event: PointerEvent) {
      handleWindowSelectionPointerEnd(event);
    }

    function handleWindowSelectionPointerEnd(event: MouseEvent | PointerEvent) {
      const browserSelection = window.getSelection();
      const activeElement = document.activeElement;
      if (noteIdFromAnnotationTarget(event.target)) {
        suppressSelectionForAnnotationInteraction();
        return;
      }

      const eventTargetIsInEditor =
        event.target instanceof Node ? view.dom.contains(event.target) : false;
      const selectionIsInEditor = browserSelectionBelongsToView(view, browserSelection);
      const editorHasFocus = activeElement ? view.dom.contains(activeElement) : false;

      if (
        event.button !== 0 ||
        (!mouseSelectionStartedRef.current &&
          !eventTargetIsInEditor &&
          !selectionIsInEditor &&
          !editorHasFocus)
      ) {
        return;
      }

      mouseSelectionStartedRef.current = false;
      publishSelectionAfterMouseUp(view);
    }

    function handleDocumentSelectionChange() {
      window.clearTimeout(selectionFallbackTimerRef.current);
      selectionFallbackTimerRef.current = window.setTimeout(() => {
        if (Date.now() < annotationInteractionUntilRef.current) return;
        if (mouseSelectionStartedRef.current) return;
        if (!browserSelectionBelongsToView(view, window.getSelection())) return;

        publishSelectionAfterMouseUp(view);
      }, 220);
    }

    const scroller = containerRef.current.querySelector<HTMLElement>(".cm-scroller");
    scroller?.addEventListener("scroll", scheduleAnnotationFrameUpdate);
    document.addEventListener("selectionchange", handleDocumentSelectionChange);
    window.addEventListener("mouseup", handleWindowMouseUp, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    scheduleAnnotationFrameUpdate();

    return () => {
      window.cancelAnimationFrame(selectionFrameRef.current);
      window.clearTimeout(selectionFallbackTimerRef.current);
      scroller?.removeEventListener("scroll", scheduleAnnotationFrameUpdate);
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (value === currentValue) return;

    suppressNextChangeRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setAnnotationsEffect.of(annotations),
    });
    scheduleAnnotationFrameUpdate();
  }, [annotationSignature, annotations]);

  return (
    <div className="markdown-editor-host" ref={containerRef}>
      <div aria-hidden="true" className="cm-annotation-layer">
        {annotationFrames.map((frame) => (
          <span
            className="cm-annotation-frame"
            key={frame.noteId}
            style={{
              height: frame.height,
              left: frame.left,
              top: frame.top,
              width: frame.width,
            }}
          />
        ))}
      </div>
    </div>
  );
}
