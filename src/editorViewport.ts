export function scheduleEditorViewportRestore(
  editorElement: HTMLElement,
  targetViewportY: number | null | undefined,
  measureViewportY: () => number | null | undefined,
) {
  if (targetViewportY == null || !Number.isFinite(targetViewportY)) return;

  const restore = () => {
    const currentViewportY = measureViewportY();
    if (currentViewportY == null || !Number.isFinite(currentViewportY)) return;

    const editorPane = editorElement.closest<HTMLElement>(".editor-pane");
    const scrollContainer =
      editorPane && editorPane.scrollHeight > editorPane.clientHeight
        ? editorPane
        : document.scrollingElement;
    if (!scrollContainer) return;

    scrollContainer.scrollTop += currentViewportY - targetViewportY;
  };

  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}
