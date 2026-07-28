import { useEffect, useMemo, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  selectAll as selectAllCodeMirror,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  ViewUpdate,
} from "@codemirror/view";
import {
  findDocumentSearchMatches,
  type DocumentSearchState,
} from "./documentSearch";

export type TextSelectionAnchor = {
  from: number;
  to: number;
  selectedText: string;
  prefix: string;
  suffix: string;
};

export type TextSelectionViewportRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  targetBottom: number;
  targetTop: number;
  targetX: number;
  targetY: number;
  top: number;
  width: number;
};

export type TextSelectionEnterContext = {
  anchorRect?: TextSelectionViewportRect | null;
  source?: "keyboard" | "touch-block";
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
  search?: DocumentSearchState;
  selectAllRequestKey?: number;
  onSearchMatchCountChange?: (count: number) => void;
  onChange: (value: string, source: EditorChangeSource) => void;
};

const setSearchEffect = StateEffect.define<DocumentSearchState>();

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

function buildSearchDecorations(doc: string, search: DocumentSearchState) {
  const ranges = findDocumentSearchMatches(doc, search.query).map((match, index) =>
    Decoration.mark({
      class: [
        "cm-document-search-match",
        index === search.activeIndex ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }).range(match.from, match.to),
  );

  return Decoration.set(ranges, true);
}

const searchField = StateField.define<DecorationSet>({
  create(state) {
    return buildSearchDecorations(state.doc.toString(), { activeIndex: 0, query: "" });
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setSearchEffect)) {
        nextDecorations = buildSearchDecorations(transaction.newDoc.toString(), effect.value);
      }
    }

    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function MarkdownEditor({
  value,
  search = { activeIndex: 0, query: "" },
  selectAllRequestKey = 0,
  onSearchMatchCountChange,
  onChange,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSearchMatchCountChangeRef = useRef(onSearchMatchCountChange);
  const suppressNextChangeRef = useRef(false);
  const searchMatchCount = useMemo(
    () => findDocumentSearchMatches(value, search.query).length,
    [search.query, value],
  );
  const searchSignature = `${search.query}\n${search.activeIndex}\n${searchMatchCount}`;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSearchMatchCountChangeRef.current = onSearchMatchCountChange;
  }, [onSearchMatchCountChange]);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;

      if (suppressNextChangeRef.current) {
        suppressNextChangeRef.current = false;
        return;
      }

      const source = update.transactions.some((transaction) =>
        transaction.isUserEvent("undo"),
      )
        ? "undo"
        : "user";

      onChangeRef.current(update.state.doc.toString(), source);
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        searchField,
        updateListener,
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
          ...defaultKeymap,
          ...historyKeymap,
        ]),
      ],
    });

    const view = new EditorView({
      parent: containerRef.current,
      state,
    });

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
    if (selectAllRequestKey === 0) return;

    const view = viewRef.current;
    if (!view) return;

    view.focus();
    selectAllCodeMirror(view);
  }, [selectAllRequestKey]);

  useEffect(() => {
    onSearchMatchCountChangeRef.current?.(searchMatchCount);
  }, [searchMatchCount]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: setSearchEffect.of(search),
    });

    const matches = findDocumentSearchMatches(view.state.doc.toString(), search.query);
    const activeMatch = matches[search.activeIndex];
    if (!activeMatch) return;

    view.dispatch({
      effects: EditorView.scrollIntoView(activeMatch.from, { y: "center" }),
    });
  }, [searchSignature, search]);

  return <div className="markdown-editor-host" ref={containerRef} />;
}
