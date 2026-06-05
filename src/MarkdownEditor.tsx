import { useEffect, useMemo, useRef } from "react";
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

type MarkdownEditorProps = {
  value: string;
  annotations: TextAnnotation[];
  onChange: (value: string) => void;
  onSelectionChange: (anchor: TextSelectionAnchor | null) => void;
  onAnnotationClick: (noteId: string) => void;
};

const setAnnotationsEffect = StateEffect.define<TextAnnotation[]>();

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
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onAnnotationClickRef = useRef(onAnnotationClick);

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
    if (!containerRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }

      if (update.selectionSet || update.docChanged) {
        const range = update.state.selection.main;
        const anchor = buildAnchor(update.state.doc.toString(), range.from, range.to);
        onSelectionChangeRef.current(anchor);
      }
    });

    const annotationClickHandler = EditorView.domEventHandlers({
      click(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        const annotation = target.closest<HTMLElement>(".cm-note-annotation");
        const noteId = annotation?.dataset.noteId;
        if (!noteId) return false;

        onAnnotationClickRef.current(noteId);
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

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (value === currentValue) return;

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
  }, [annotationSignature, annotations]);

  return <div className="markdown-editor-host" ref={containerRef} />;
}
