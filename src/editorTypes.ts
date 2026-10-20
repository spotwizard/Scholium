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

export type EditorSelectionSnapshot = {
  association?: -1 | 0 | 1;
  anchor: number;
  head: number;
  viewportY?: number | null;
};

export type EditorSelectionHandle = {
  getSelectionSnapshot: () => EditorSelectionSnapshot | null;
  prepareFileInsertion?: (target: Element, x: number, y: number) =>
    ((file: import("./fileInsertion").InsertableFile) => boolean) | null;
};
