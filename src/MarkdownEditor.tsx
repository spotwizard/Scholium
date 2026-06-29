import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Range, StateEffect, StateField } from "@codemirror/state";
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
  isFocusTarget?: boolean;
  kind?: "note" | "glossary";
  from: number;
  prefix?: string;
  selectedText?: string;
  suffix?: string;
  tone?: AnnotationTone;
  to: number;
};

export type EditorChangeSource = "user" | "undo";

type MarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  noteModeEnabled: boolean;
  readOnly?: boolean;
  onChange: (value: string, source: EditorChangeSource) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onSelectionEnter: (anchor: TextSelectionAnchor) => boolean;
  onAnnotationClick: (noteId: string) => void;
  onAnnotationDoubleClick: (noteId: string) => void;
  onFocusTargetAnnotationPress?: (noteId: string) => void;
};

type EditorAnnotationFrame = {
  borderRadius: string;
  frameKey: string;
  isFocusTarget?: boolean;
  noteId: string;
  kind: "note" | "glossary";
  tone: AnnotationTone;
  left: number;
  top: number;
  width: number;
  height: number;
};

type EditorAnnotationRect = {
  canExtendRight: boolean;
  left: number;
  lineRight: number;
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
const editorAnnotationFrameHorizontalPadding = 12;
const editorAnnotationLineJoinMaxGap = 20;
const editorAnnotationLineEndTolerance = 2;
const editorAnnotationFrameCornerRadius = "4px";
const annotationSelectionSuppressionMs = 1200;
const annotationClickDelayMs = 500;
const annotationFocusTargetPressSuppressionMs = annotationClickDelayMs + 350;
const imeSelectionSuppressionMs = 350;

function editorAnnotationFramePaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : editorAnnotationFramePadding;
}

function editorAnnotationFrameHorizontalPaddingForKind(kind: "note" | "glossary") {
  return kind === "glossary" ? 0 : editorAnnotationFrameHorizontalPadding;
}

function editorReadOnlyExtensions(readOnly: boolean) {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorState.transactionFilter.of((transaction) =>
      readOnly && transaction.docChanged ? [] : transaction,
    ),
  ];
}

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

function textIndices(text: string, query: string) {
  const indices: number[] = [];
  if (!query) return indices;

  let index = text.indexOf(query);
  while (index >= 0) {
    indices.push(index);
    index = text.indexOf(query, index + query.length);
  }

  return indices;
}

function closestTextIndex(indices: number[], approximateIndex: number) {
  if (indices.length === 0) return -1;

  return indices.reduce((closestIndex, index) =>
    Math.abs(index - approximateIndex) < Math.abs(closestIndex - approximateIndex)
      ? index
      : closestIndex,
  );
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
    const selectedTextIndex = closestTextIndex(
      textIndices(doc, selectedText),
      view.state.selection.main.from,
    );
    if (selectedTextIndex >= 0) {
      return buildAnchor(doc, selectedTextIndex, selectedTextIndex + selectedText.length);
    }
  }

  const range = view.state.selection.main;
  return buildAnchor(doc, range.from, range.to);
}

function markerIsPartOfLongerRun(doc: string, marker: "*" | "**", from: number, to: number) {
  if (marker !== "*") return false;

  return doc[from - 2] === "*" || doc[from] === "*" || doc[to - 1] === "*" || doc[to + 1] === "*";
}

function applyMarkdownInlineMark(view: EditorView, marker: "*" | "**") {
  const range = view.state.selection.main;
  const markerLength = marker.length;
  const doc = view.state.doc.toString();
  const { from, to } = range;

  if (from === to) {
    view.dispatch({
      changes: { from, insert: `${marker}${marker}` },
      selection: { anchor: from + markerLength },
      scrollIntoView: true,
    });
    return true;
  }

  const selectedText = doc.slice(from, to);
  const hasOuterMarkers =
    from >= markerLength &&
    doc.slice(from - markerLength, from) === marker &&
    doc.slice(to, to + markerLength) === marker &&
    !markerIsPartOfLongerRun(doc, marker, from, to);

  if (hasOuterMarkers) {
    view.dispatch({
      changes: [
        { from: from - markerLength, to: from },
        { from: to, to: to + markerLength },
      ],
      selection: { anchor: from - markerLength, head: to - markerLength },
      scrollIntoView: true,
    });
    return true;
  }

  const hasInnerMarkers =
    selectedText.length >= markerLength * 2 &&
    selectedText.startsWith(marker) &&
    selectedText.endsWith(marker);

  if (hasInnerMarkers) {
    view.dispatch({
      changes: [
        { from, to: from + markerLength },
        { from: to - markerLength, to },
      ],
      selection: { anchor: from, head: to - markerLength * 2 },
      scrollIntoView: true,
    });
    return true;
  }

  view.dispatch({
    changes: [
      { from, insert: marker },
      { from: to, insert: marker },
    ],
    selection: { anchor: from + markerLength, head: to + markerLength },
    scrollIntoView: true,
  });
  return true;
}

function buildDecorations(annotations: TextAnnotation[]) {
  const ranges: Range<Decoration>[] = annotations
    .filter((annotation) => annotation.to > annotation.from)
    .map((annotation) =>
      Decoration.mark({
        attributes: {
          "data-annotation-kind": annotation.kind ?? "note",
          "data-focus-target": annotation.isFocusTarget ? "true" : "false",
          "data-note-id": annotation.id,
          "data-note-tone": String(annotation.tone ?? 0),
        },
        class: [
          "cm-note-annotation",
          annotation.kind === "glossary" ? "cm-glossary-annotation" : "",
          annotation.isFocusTarget ? "is-focus-target" : "",
        ]
          .filter(Boolean)
          .join(" "),
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
  const focusByNoteId = new Map<string, boolean>();

  function annotationLineMetrics(annotation: HTMLElement, rect: DOMRect) {
    const scope = annotation.closest<HTMLElement>(".cm-line") ?? annotation.parentElement;
    if (!scope) {
      return {
        canExtendRight: true,
        lineRight: Math.min(rect.right, containerRect.right),
      };
    }

    const range = document.createRange();
    range.selectNodeContents(scope);
    const rectMidY = (rect.top + rect.bottom) / 2;
    const lineRects = Array.from(range.getClientRects()).filter(
      (lineRect) =>
        lineRect.width > 0 &&
        lineRect.height > 0 &&
        rectMidY >= lineRect.top - 1 &&
        rectMidY <= lineRect.bottom + 1,
    );

    if (lineRects.length === 0) {
      return {
        canExtendRight: true,
        lineRight: Math.min(rect.right, containerRect.right),
      };
    }

    const lineRight = Math.min(
      Math.max(...lineRects.map((lineRect) => lineRect.right)),
      containerRect.right,
    );

    return {
      canExtendRight: rect.right >= lineRight - editorAnnotationLineEndTolerance,
      lineRight,
    };
  }

  container
    .querySelectorAll<HTMLElement>(".cm-note-annotation[data-note-id]")
    .forEach((annotation) => {
      const noteId = annotation.dataset.noteId;
      if (!noteId) return;
      tonesByNoteId.set(noteId, annotation.dataset.noteTone === "1" ? 1 : 0);
      focusByNoteId.set(noteId, annotation.dataset.focusTarget === "true");
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
          const lineMetrics = annotationLineMetrics(annotation, rect);

          return {
            canExtendRight: lineMetrics.canExtendRight,
            left,
            lineRight: Math.min(lineMetrics.lineRight, containerRect.right),
            top,
            right,
            bottom,
          };
        })
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
      if (annotationRects.length === 0) return;

      rectsByNoteId.set(noteId, [...(rectsByNoteId.get(noteId) ?? []), ...annotationRects]);
    });

  return Array.from(rectsByNoteId.entries())
    .flatMap(([noteId, rects]) => {
      const kind = kindsByNoteId.get(noteId) ?? "note";
      const tone = tonesByNoteId.get(noteId) ?? 0;
      const isFocusTarget = focusByNoteId.get(noteId) ?? false;
      const sortedRects = rects.sort(
        (left, right) => left.top - right.top || left.left - right.left,
      );
      const extensionRightByRect = new Map<EditorAnnotationRect, number>();
      const borderRadiusByRect = new Map<EditorAnnotationRect, string>();
      let rectGroup: EditorAnnotationRect[] = [];

      function flushRectGroup() {
        if (rectGroup.length === 0) return;

        const extendableLineRights = rectGroup
          .filter((rect) => rect.canExtendRight)
          .map((rect) => Math.max(rect.right, rect.lineRight));
        if (extendableLineRights.length > 0) {
          const targetRight = Math.max(...extendableLineRights);
          rectGroup.forEach((rect) => {
            extensionRightByRect.set(
              rect,
              rect.canExtendRight ? Math.max(rect.right, targetRight) : rect.right,
            );
          });
        }

        rectGroup.forEach((rect, groupIndex) => {
          const isFirstRect = groupIndex === 0;
          const isLastRect = groupIndex === rectGroup.length - 1;
          borderRadiusByRect.set(
            rect,
            [
              isFirstRect ? editorAnnotationFrameCornerRadius : "0",
              isFirstRect ? editorAnnotationFrameCornerRadius : "0",
              isLastRect ? editorAnnotationFrameCornerRadius : "0",
              isLastRect ? editorAnnotationFrameCornerRadius : "0",
            ].join(" "),
          );
        });
        rectGroup = [];
      }

      if (kind !== "glossary") {
        sortedRects.forEach((rect) => {
          const previousRect = rectGroup[rectGroup.length - 1];
          const lineGap = previousRect ? rect.top - previousRect.bottom : 0;
          if (
            previousRect &&
            (lineGap < 0 || lineGap > editorAnnotationLineJoinMaxGap)
          ) {
            flushRectGroup();
          }

          rectGroup.push(rect);
        });
        flushRectGroup();
      }

      return sortedRects.map((rect, rectIndex) => {
        const framePadding = editorAnnotationFramePaddingForKind(kind);
        const frameHorizontalPadding = editorAnnotationFrameHorizontalPaddingForKind(kind);
        const shouldJoinFrameLines = kind !== "glossary";
        let top = rect.top - framePadding;
        let bottom = rect.bottom + framePadding;
        const previousRect = sortedRects[rectIndex - 1];
        const nextRect = sortedRects[rectIndex + 1];

        if (shouldJoinFrameLines && previousRect) {
          const previousGap = rect.top - previousRect.bottom;
          if (previousGap >= 0 && previousGap <= editorAnnotationLineJoinMaxGap) {
            top = Math.min(top, previousRect.bottom + previousGap / 2 - 1);
          }
        }

        if (shouldJoinFrameLines && nextRect) {
          const nextGap = nextRect.top - rect.bottom;
          if (nextGap >= 0 && nextGap <= editorAnnotationLineJoinMaxGap) {
            bottom = Math.max(bottom, rect.bottom + nextGap / 2 + 1);
          }
        }

        return {
          borderRadius: borderRadiusByRect.get(rect) ?? editorAnnotationFrameCornerRadius,
          frameKey: `${kind}:${noteId}:source:${rectIndex}`,
          isFocusTarget,
          noteId,
          kind,
          tone,
          left: roundEditorFrameValue(rect.left - containerRect.left - frameHorizontalPadding),
          top: roundEditorFrameValue(Math.max(0, top - containerRect.top)),
          width: roundEditorFrameValue(
            (extensionRightByRect.get(rect) ?? rect.right) -
              rect.left +
              frameHorizontalPadding * 2,
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
      leftFrame.isFocusTarget === rightFrame.isFocusTarget &&
      leftFrame.borderRadius === rightFrame.borderRadius &&
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
  noteModeEnabled,
  readOnly = false,
  onChange,
  onSelectionChange,
  onSelectionEnter,
  onAnnotationClick,
  onAnnotationDoubleClick,
  onFocusTargetAnnotationPress,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const annotationsRef = useRef(annotations);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionEnterRef = useRef(onSelectionEnter);
  const onAnnotationClickRef = useRef(onAnnotationClick);
  const onAnnotationDoubleClickRef = useRef(onAnnotationDoubleClick);
  const onFocusTargetAnnotationPressRef = useRef(onFocusTargetAnnotationPress);
  const noteModeEnabledRef = useRef(noteModeEnabled);
  const readOnlyRef = useRef(readOnly);
  const readOnlyCompartment = useMemo(() => new Compartment(), []);
  const animationFrameRef = useRef(0);
  const selectionFrameRef = useRef(0);
  const selectionFallbackTimerRef = useRef(0);
  const annotationClickTimerRef = useRef(0);
  const suppressedFocusTargetAnnotationPressRef = useRef<{
    noteId: string;
    until: number;
  } | null>(null);
  const mouseSelectionStartedRef = useRef(false);
  const annotationInteractionUntilRef = useRef(0);
  const imeCompositionActiveRef = useRef(false);
  const imeSelectionSuppressedUntilRef = useRef(0);
  const suppressNextChangeRef = useRef(false);
  const [annotationFrames, setAnnotationFrames] = useState<EditorAnnotationFrame[]>([]);

  const annotationSignature = useMemo(
    () =>
      annotations
        .map(
          (annotation) =>
            `${annotation.id}:${annotation.from}:${annotation.to}:${annotation.tone ?? 0}:${
              annotation.isFocusTarget ? 1 : 0
            }`,
        )
        .join("|"),
    [annotations],
  );

  useEffect(
    () => () => {
      window.clearTimeout(annotationClickTimerRef.current);
    },
    [],
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
    onFocusTargetAnnotationPressRef.current = onFocusTargetAnnotationPress;
  }, [onFocusTargetAnnotationPress]);

  useEffect(() => {
    noteModeEnabledRef.current = noteModeEnabled;
    if (!noteModeEnabled) {
      onSelectionChangeRef.current(null);
      setAnnotationFrames([]);
    } else {
      scheduleAnnotationFrameUpdate();
    }
  }, [noteModeEnabled]);

  useEffect(() => {
    readOnlyRef.current = readOnly;

    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: readOnlyCompartment.reconfigure(editorReadOnlyExtensions(readOnly)),
    });

    if (readOnly && document.activeElement instanceof Node && view.dom.contains(document.activeElement)) {
      view.contentDOM.blur();
      window.getSelection()?.removeAllRanges();
    }
  }, [readOnly, readOnlyCompartment]);

  function updateAnnotationFrames() {
    const container = containerRef.current;
    if (!container) return;

    if (!noteModeEnabledRef.current) {
      setAnnotationFrames((currentFrames) => (currentFrames.length === 0 ? currentFrames : []));
      return;
    }

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
    if (!noteModeEnabledRef.current) {
      mouseSelectionStartedRef.current = false;
      return;
    }
    if (Date.now() < annotationInteractionUntilRef.current) return;
    if (selectionPublishSuppressedByIme()) return;

    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      if (Date.now() < annotationInteractionUntilRef.current) return;
      if (selectionPublishSuppressedByIme()) return;

      const anchor = buildAnchorFromSelection(view);
      onSelectionChangeRef.current(anchor);
      selectionFrameRef.current = 0;
    });
  }

  function selectionPublishSuppressedByIme() {
    return (
      imeCompositionActiveRef.current ||
      Date.now() < imeSelectionSuppressedUntilRef.current
    );
  }

  function suppressSelectionPublishForIme() {
    imeSelectionSuppressedUntilRef.current = Date.now() + imeSelectionSuppressionMs;
    window.clearTimeout(selectionFallbackTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    mouseSelectionStartedRef.current = false;
  }

  function handleImeCompositionStart() {
    imeCompositionActiveRef.current = true;
    suppressSelectionPublishForIme();
    onSelectionChangeRef.current(null);
  }

  function handleImeCompositionEnd() {
    imeCompositionActiveRef.current = false;
    suppressSelectionPublishForIme();
    onSelectionChangeRef.current(null);
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
          event.clientX >= rect.left - editorAnnotationFrameHorizontalPadding &&
          event.clientX <= rect.right + editorAnnotationFrameHorizontalPadding &&
          event.clientY >= rect.top - editorAnnotationFramePadding &&
          event.clientY <= rect.bottom + editorAnnotationFramePadding,
      );

      if (hitAnnotation) return noteId;
    }

    return null;
  }

  function annotationIsFocusTarget(noteId: string) {
    return annotationsRef.current.some(
      (annotation) => annotation.id === noteId && annotation.isFocusTarget,
    );
  }

  function suppressFocusTargetAnnotationPress(noteId: string) {
    suppressedFocusTargetAnnotationPressRef.current = {
      noteId,
      until: Date.now() + annotationFocusTargetPressSuppressionMs,
    };
  }

  function focusTargetAnnotationPressIsSuppressed(noteId: string) {
    const suppressedPress = suppressedFocusTargetAnnotationPressRef.current;
    if (!suppressedPress) return false;

    if (Date.now() > suppressedPress.until) {
      suppressedFocusTargetAnnotationPressRef.current = null;
      return false;
    }

    return suppressedPress.noteId === noteId;
  }

  function handleFocusTargetAnnotationPress(noteId: string) {
    if (!annotationIsFocusTarget(noteId) && !focusTargetAnnotationPressIsSuppressed(noteId)) {
      return false;
    }

    clearQueuedAnnotationClick();

    if (!focusTargetAnnotationPressIsSuppressed(noteId)) {
      suppressFocusTargetAnnotationPress(noteId);
      onFocusTargetAnnotationPressRef.current?.(noteId);
    }

    return true;
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

  function clearQueuedAnnotationClick() {
    window.clearTimeout(annotationClickTimerRef.current);
    annotationClickTimerRef.current = 0;
  }

  function selectedEditorText(view: EditorView | null = viewRef.current) {
    const selection = window.getSelection();
    if (view && browserSelectionBelongsToView(view, selection)) {
      return selection.toString().trim();
    }

    if (!view || view.state.selection.main.empty) return "";

    const range = view.state.selection.main;
    return view.state.doc.sliceString(range.from, range.to).trim();
  }

  function queueAnnotationClick(noteId: string) {
    clearQueuedAnnotationClick();
    annotationClickTimerRef.current = window.setTimeout(() => {
      annotationClickTimerRef.current = 0;
      if (focusTargetAnnotationPressIsSuppressed(noteId)) return;
      if (selectedEditorText()) return;

      onAnnotationClickRef.current(noteId);
    }, annotationClickDelayMs);
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
        } else if (readOnlyRef.current) {
          onSelectionChangeRef.current(null);
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
          const noteId = noteModeEnabledRef.current
            ? noteIdFromAnnotationPointerEvent(event)
            : null;
          if (noteId && handleFocusTargetAnnotationPress(noteId)) {
            mouseSelectionStartedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          }

          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      pointerdown(event) {
        if (event.button === 0) {
          const noteId = noteModeEnabledRef.current
            ? noteIdFromAnnotationPointerEvent(event)
            : null;
          if (noteId && handleFocusTargetAnnotationPress(noteId)) {
            mouseSelectionStartedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          }

          mouseSelectionStartedRef.current = true;
        }
        return false;
      },
      compositionstart() {
        handleImeCompositionStart();
        return false;
      },
      compositionend() {
        handleImeCompositionEnd();
        return false;
      },
      mouseup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteModeEnabledRef.current
          ? noteIdFromAnnotationPointerEvent(event)
          : null;
        if (noteId) {
          if (editorHasTextSelection(view)) {
            mouseSelectionStartedRef.current = false;
            clearQueuedAnnotationClick();
            publishSelectionAfterMouseUp(view);
            return false;
          }

          mouseSelectionStartedRef.current = false;
          return false;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      pointerup(event, view) {
        if (event.button !== 0) return false;

        const noteId = noteModeEnabledRef.current
          ? noteIdFromAnnotationPointerEvent(event)
          : null;
        if (noteId) {
          if (editorHasTextSelection(view)) {
            mouseSelectionStartedRef.current = false;
            clearQueuedAnnotationClick();
            publishSelectionAfterMouseUp(view);
            return false;
          }

          mouseSelectionStartedRef.current = false;
          return false;
        }

        mouseSelectionStartedRef.current = false;
        publishSelectionAfterMouseUp(view);
        return false;
      },
      click(event) {
        if (!noteModeEnabledRef.current) return false;
        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (!noteId) return false;
        const view = viewRef.current;
        if (view && editorHasTextSelection(view)) {
          clearQueuedAnnotationClick();
          return false;
        }

        event.preventDefault();
        if (event.detail >= 2) {
          clearQueuedAnnotationClick();
        } else if (handleFocusTargetAnnotationPress(noteId)) {
          return true;
        } else {
          queueAnnotationClick(noteId);
        }
        return true;
      },
      dblclick(event) {
        if (!noteModeEnabledRef.current) return false;
        const noteId = noteIdFromAnnotationPointerEvent(event);
        if (!noteId) return false;
        const view = viewRef.current;
        if (view && editorHasTextSelection(view)) {
          clearQueuedAnnotationClick();
          return false;
        }

        clearQueuedAnnotationClick();
        return false;
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
        readOnlyCompartment.of(editorReadOnlyExtensions(readOnly)),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-b",
            run(view) {
              return applyMarkdownInlineMark(view, "**");
            },
          },
          {
            key: "Mod-i",
            run(view) {
              return applyMarkdownInlineMark(view, "*");
            },
          },
          {
            key: "Enter",
            run(view) {
              if (selectionPublishSuppressedByIme()) return false;

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
      if (!noteModeEnabledRef.current) return;

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
      if (!noteModeEnabledRef.current) return;
      window.clearTimeout(selectionFallbackTimerRef.current);
      selectionFallbackTimerRef.current = window.setTimeout(() => {
        if (Date.now() < annotationInteractionUntilRef.current) {
          window.getSelection()?.removeAllRanges();
          return;
        }
        if (selectionPublishSuppressedByIme()) return;
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
    annotationsRef.current = annotations;
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
            className={`cm-annotation-frame ${
              frame.isFocusTarget ? "is-focus-target" : ""
            }`}
            data-annotation-kind={frame.kind}
            data-focus-target={frame.isFocusTarget ? "true" : "false"}
            data-note-id={frame.noteId}
            data-note-tone={frame.tone}
            key={frame.frameKey}
            style={{
              borderRadius: frame.borderRadius,
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
