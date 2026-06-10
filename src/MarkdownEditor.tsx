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

export type AnnotationTone = 0 | 1;

export type TextAnnotation = {
  id: string;
  kind?: "note" | "glossary";
  from: number;
  tone?: AnnotationTone;
  to: number;
};

export type EditorChangeSource = "user" | "undo";

type MarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
};

type EditorAnnotationFrame = {
  frameKey: string;
  noteId: string;
  kind: "note" | "glossary";
  tone: AnnotationTone;
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
const editorAnnotationLineJoinMaxGap = 20;
const annotationSelectionSuppressionMs = 1200;

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
          "data-annotation-kind": annotation.kind ?? "note",
          "data-note-id": annotation.id,
          "data-note-tone": String(annotation.tone ?? 0),
        },
        class: `cm-note-annotation ${
          annotation.kind === "glossary" ? "cm-glossary-annotation" : ""
        }`,
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
  const tonesByNoteId = new Map<string, AnnotationTone>();
  const kindsByNoteId = new Map<string, "note" | "glossary">();

  container
    .querySelectorAll<HTMLElement>(".cm-note-annotation[data-note-id]")
    .forEach((annotation) => {
      const noteId = annotation.dataset.noteId;
      if (!noteId) return;
      tonesByNoteId.set(noteId, annotation.dataset.noteTone === "1" ? 1 : 0);
      kindsByNoteId.set(
        noteId,
        annotation.dataset.annotationKind === "glossary" ? "glossary" : "note",
      );

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
    .flatMap(([noteId, rects]) => {
      const kind = kindsByNoteId.get(noteId) ?? "note";
      const tone = tonesByNoteId.get(noteId) ?? 0;
      const sortedRects = rects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );

      return sortedRects.map((rect, rectIndex) => {
        let top = rect.top - editorAnnotationFramePadding;
        let bottom = rect.bottom + editorAnnotationFramePadding;
        const previousRect = sortedRects[rectIndex - 1];
        const nextRect = sortedRects[rectIndex + 1];

        if (previousRect) {
          const previousGap = rect.top - previousRect.bottom;
          if (previousGap >= 0 && previousGap <= editorAnnotationLineJoinMaxGap) {
            top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
          }
        }

        if (nextRect) {
          const nextGap = nextRect.top - rect.bottom;
          if (nextGap >= 0 && nextGap <= editorAnnotationLineJoinMaxGap) {
            bottom = Math.max(bottom, rect.bottom + nextGap / 2 + 1);
          }
        }

        return {
          frameKey: `${kind}:${noteId}:source:${rectIndex}`,
          noteId,
          kind,
          tone,
          left: roundEditorFrameValue(
            Math.max(0, rect.left - containerRect.left - editorAnnotationFramePadding),
          ),
          top: roundEditorFrameValue(Math.max(0, top - containerRect.top)),
          width: roundEditorFrameValue(
            rect.right - rect.left + editorAnnotationFramePadding * 2,
          ),
          height: roundEditorFrameValue(bottom - top),
        };
      });
    })
    .sort(
      (left, right) =>
        left.top - right.top ||
        left.left - right.left ||
        left.frameKey.localeCompare(right.frameKey),
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
      leftFrame.frameKey === rightFrame.frameKey &&
      leftFrame.noteId === rightFrame.noteId &&
      leftFrame.kind === rightFrame.kind &&
      leftFrame.tone === rightFrame.tone &&
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
  onSelectionEnter,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
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
        .map(
          (annotation) =>
            `${annotation.id}:${annotation.from}:${annotation.to}:${annotation.tone ?? 0}`,
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

  function collapseEditorSelection(view: EditorView, event?: MouseEvent | PointerEvent) {
    const position = event
      ? (view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head)
      : view.state.selection.main.head;

    view.dispatch({ selection: { anchor: position } });
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
    const targetElement =
      target instanceof HTMLElement
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;

    return targetElement?.closest<HTMLElement>(".cm-note-annotation")?.dataset.noteId ?? null;
  }

  function noteIdFromAnnotationPointerEvent(event: MouseEvent | PointerEvent) {
    const targetNoteId = noteIdFromAnnotationTarget(event.target);
    if (targetNoteId) return targetNoteId;

    const pointNoteId = noteIdFromAnnotationTarget(
      document.elementFromPoint(event.clientX, event.clientY),
    );
    if (pointNoteId) return pointNoteId;

    const container = containerRef.current;
    if (!container) return null;

    for (const frame of container.querySelectorAll<HTMLElement>(
      ".cm-annotation-frame[data-note-id]",
    )) {
      const noteId = frame.dataset.noteId;
      if (!noteId) continue;

      const rect = frame.getBoundingClientRect();
      const hitFrame =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (hitFrame) return noteId;
    }

    for (const annotation of container.querySelectorAll<HTMLElement>(
      ".cm-note-annotation[data-note-id]",
    )) {
      const noteId = annotation.dataset.noteId;
      if (!noteId) continue;

      const hitAnnotation = Array.from(annotation.getClientRects()).some(
        (rect) =>
          event.clientX >= rect.left - editorAnnotationFramePadding &&
          event.clientX <= rect.right + editorAnnotationFramePadding &&
          event.clientY >= rect.top - editorAnnotationFramePadding &&
          event.clientY <= rect.bottom + editorAnnotationFramePadding,
      );

      if (hitAnnotation) return noteId;
    }

    return null;
  }

  function suppressSelectionForAnnotationInteraction(
    view?: EditorView,
    event?: MouseEvent | PointerEvent,
  ) {
    annotationInteractionUntilRef.current = Date.now() + annotationSelectionSuppressionMs;
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    window.getSelection()?.removeAllRanges();
    if (view) collapseEditorSelection(view, event);
    mouseSelectionStartedRef.current = false;
  }

  function editorHasTextSelection(view: EditorView) {
    const browserSelection = window.getSelection();
    return (
      browserSelectionBelongsToView(view, browserSelection) ||
      view.state.selection.main.from !== view.state.selection.main.to
    );
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
        if (event.button === 0) {
          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      pointerdown(event) {
        if (event.button === 0) {
          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      mouseup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (noteId) {
          if (editorHasTextSelection(view)) {
            mouseSelectionStartedRef.current = false;
            publishSelectionAfterMouseUp(view);
            return false;
          }

          event.preventDefault();
          suppressSelectionForAnnotationInteraction(view, event);
          if (event.detail >= 2) {
            onAnnotationDoubleClickRef.current(noteId);
          } else {
            onAnnotationClickRef.current(noteId);
          }
          return true;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      pointerup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (noteId) {
          if (editorHasTextSelection(view)) {
            mouseSelectionStartedRef.current = false;
            publishSelectionAfterMouseUp(view);
            return false;
          }

          event.preventDefault();
          suppressSelectionForAnnotationInteraction(view, event);
          onAnnotationClickRef.current(noteId);
          return true;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      click(event) {
        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (!noteId) return false;
        const view = viewRef.current;
        if (view && editorHasTextSelection(view)) {
          return false;
        }

        event.preventDefault();
        suppressSelectionForAnnotationInteraction(view ?? undefined, event);
        if (event.detail >= 2) {
          onAnnotationDoubleClickRef.current(noteId);
        } else {
          onAnnotationClickRef.current(noteId);
        }
        return true;
      },
      dblclick(event) {
        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (!noteId) return false;
        const view = viewRef.current;
        if (view && editorHasTextSelection(view)) {
          return false;
        }

        event.preventDefault();
        suppressSelectionForAnnotationInteraction(view ?? undefined, event);
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
        keymap.of([
          {
            key: "Enter",
            run(view) {
              const anchor = buildAnchorFromSelection(view);
              if (!anchor) return false;

              return onSelectionEnterRef.current(anchor);
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
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
      if (noteIdFromAnnotationPointerEvent(event)) {
        if (editorHasTextSelection(view)) {
          mouseSelectionStartedRef.current = false;
          publishSelectionAfterMouseUp(view);
          return;
        }

        event.preventDefault();
        suppressSelectionForAnnotationInteraction(view, event);
        return;
      }

      const eventTargetIsInEditor =
        event.target instanceof Node ? view.dom.contains(event.target) : false;
      const selectionIsInEditor = browserSelectionBelongsToView(view, browserSelection);
      const editorHasFocus = activeElement ? view.dom.contains(activeElement) : false;

      if (!mouseSelectionStartedRef.current && !eventTargetIsInEditor) {
        return;
      }

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
        if (Date.now() < annotationInteractionUntilRef.current) {
          window.getSelection()?.removeAllRanges();
          return;
        }
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
            data-annotation-kind={frame.kind}
            data-note-id={frame.noteId}
            data-note-tone={frame.tone}
            key={frame.frameKey}
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
