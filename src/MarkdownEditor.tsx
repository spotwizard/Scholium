import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  selectAll as selectAllCodeMirror,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  findDocumentSearchMatches,
  type DocumentSearchState,
} from "./documentSearch";
import type {
  EditorChangeSource,
  EditorSelectionHandle,
  EditorSelectionSnapshot,
} from "./editorTypes";
import {
  fileLinkTriggerCharacters,
  fileLinkTriggerHasBoundary,
  sourceMarkdownFileLink,
} from "./fileLinkInsertion";
import { currentTypingLineBottomMargin } from "./editorTypingLine";
import { scheduleEditorViewportRestore } from "./editorViewport";

type MarkdownEditorProps = {
  value: string;
  focusRequestKey?: number;
  search?: DocumentSearchState;
  selectionToRestore?: EditorSelectionSnapshot | null;
  selectAllRequestKey?: number;
  onFocusRequestHandled?: (requestKey: number) => void;
  onSearchMatchCountChange?: (count: number) => void;
  onChange: (value: string, source: EditorChangeSource) => void;
  onFileLinkTrigger?: () => void;
};

const setSearchEffect = StateEffect.define<DocumentSearchState>();

const sourceMarkdownHighlightStyle = HighlightStyle.define([
  { tag: [tags.meta, tags.contentSeparator], color: "var(--color-source-syntax-meta)" },
  { tag: tags.quote, color: "var(--color-source-syntax-quote)" },
  { tag: tags.link, color: "var(--color-source-syntax-link)" },
  { tag: tags.url, color: "var(--color-source-syntax-url)" },
  { tag: tags.strong, color: "var(--color-source-syntax-strong)" },
  { tag: tags.emphasis, color: "var(--color-source-syntax-emphasis)" },
  { tag: tags.monospace, color: "var(--color-source-syntax-code)" },
  { tag: tags.heading, color: "var(--color-source-syntax-heading)" },
]);

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

function applySearchState(view: EditorView, search: DocumentSearchState, shouldScroll: boolean) {
  view.dispatch({
    effects: setSearchEffect.of(search),
  });

  const activeElement = document.activeElement;
  if (
    !shouldScroll ||
    !(activeElement instanceof Element && activeElement.closest(".document-search"))
  ) {
    return;
  }

  const matches = findDocumentSearchMatches(view.state.doc.toString(), search.query);
  const activeMatch = matches[search.activeIndex];
  if (!activeMatch) return;

  view.dispatch({
    effects: EditorView.scrollIntoView(activeMatch.from, { y: "center" }),
  });
}

export const MarkdownEditor = forwardRef<EditorSelectionHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      focusRequestKey = 0,
      search = { activeIndex: 0, query: "" },
      selectionToRestore = null,
      selectAllRequestKey = 0,
      onFocusRequestHandled,
      onSearchMatchCountChange,
      onChange,
      onFileLinkTrigger,
    },
    ref,
  ) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSearchMatchCountChangeRef = useRef(onSearchMatchCountChange);
  const onFileLinkTriggerRef = useRef(onFileLinkTrigger);
  const fileLinkTriggerRef = useRef<{ from: number; to: number } | null>(null);
  const suppressNextChangeRef = useRef(false);
  const handledSelectAllRequestKeyRef = useRef(selectAllRequestKey);
  const searchMatchCount = useMemo(
    () => findDocumentSearchMatches(value, search.query).length,
    [search.query, value],
  );
  const searchSignature = `${search.query}\n${search.activeIndex}\n${searchMatchCount}\n${search.scrollRequestKey ?? 0}`;

  useImperativeHandle(ref, () => ({
    getSelectionSnapshot() {
      const view = viewRef.current;
      const selection = view?.state.selection.main;
      return selection
        ? {
            association: selection.assoc,
            anchor: selection.anchor,
            head: selection.head,
            viewportY: view.coordsAtPos(selection.head)?.top ?? null,
          }
        : null;
    },
    insertFileLink({ href, label }) {
      const view = viewRef.current;
      if (!view) return false;

      const trigger = fileLinkTriggerRef.current;
      fileLinkTriggerRef.current = null;
      const selection = view.state.selection.main;
      const triggerIsIntact =
        trigger !== null &&
        trigger.to <= view.state.doc.length &&
        fileLinkTriggerCharacters.has(view.state.sliceDoc(trigger.from, trigger.to));
      const range = triggerIsIntact ? trigger : selection;
      const selectedText = triggerIsIntact ? "" : view.state.sliceDoc(range.from, range.to);
      const insert = sourceMarkdownFileLink(selectedText.trim() ? selectedText : label, href);

      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + insert.length },
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
      return true;
    },
    cancelFileLinkTrigger() {
      fileLinkTriggerRef.current = null;
      viewRef.current?.focus();
    },
  }));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSearchMatchCountChangeRef.current = onSearchMatchCountChange;
  }, [onSearchMatchCountChange]);

  useEffect(() => {
    onFileLinkTriggerRef.current = onFileLinkTrigger;
  }, [onFileLinkTrigger]);

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

      if (
        onFileLinkTriggerRef.current &&
        update.transactions.some((transaction) => transaction.isUserEvent("input.type"))
      ) {
        let trigger: { from: number; to: number } | null = null;
        update.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
          const text = inserted.toString();
          if (!fileLinkTriggerCharacters.has(text)) return;

          const line = update.state.doc.lineAt(fromB);
          if (fileLinkTriggerHasBoundary(update.state.sliceDoc(line.from, fromB))) {
            trigger = { from: fromB, to: toB };
          }
        });
        if (trigger) {
          fileLinkTriggerRef.current = trigger;
          onFileLinkTriggerRef.current();
        }
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(sourceMarkdownHighlightStyle),
        searchField,
        updateListener,
        EditorView.lineWrapping,
        EditorView.scrollMargins.of(() => ({ bottom: currentTypingLineBottomMargin() })),
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
          { key: "Mod-Shift-z", run: redo, preventDefault: true },
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

    if (focusRequestKey > 0) {
      if (selectionToRestore) {
        const documentLength = view.state.doc.length;
        const anchor = Math.min(Math.max(selectionToRestore.anchor, 0), documentLength);
        const head = Math.min(Math.max(selectionToRestore.head, 0), documentLength);
        view.dispatch({
          selection: EditorSelection.create([
            EditorSelection.range(
              anchor,
              head,
              undefined,
              undefined,
              selectionToRestore.association,
            ),
          ]),
        });
      }
      view.focus();
      if (selectionToRestore) {
        scheduleEditorViewportRestore(
          view.dom,
          selectionToRestore.viewportY,
          () => view.coordsAtPos(view.state.selection.main.head)?.top,
        );
      }
      onFocusRequestHandled?.(focusRequestKey);
    }

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
    if (handledSelectAllRequestKeyRef.current === selectAllRequestKey) return;
    handledSelectAllRequestKeyRef.current = selectAllRequestKey;

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

    applySearchState(view, search, true);
  }, [searchSignature, search]);

    return <div className="markdown-editor-host" ref={containerRef} />;
  },
);
