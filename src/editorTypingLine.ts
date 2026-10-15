// The line being typed stays above the lower third of the window, so writing at
// the end of a document happens near a natural reading height instead of the
// bottom edge. The blank space after the document (--editor-end-scroll-room in
// App.css) has to be taller than this margin for the last line to get there.
export const TYPING_LINE_BOTTOM_MARGIN_RATIO = 1 / 3;

export function typingLineBottomMargin(viewportHeight: number) {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Math.round(viewportHeight * TYPING_LINE_BOTTOM_MARGIN_RATIO);
}

export function currentTypingLineBottomMargin() {
  return typingLineBottomMargin(window.visualViewport?.height ?? window.innerHeight);
}
