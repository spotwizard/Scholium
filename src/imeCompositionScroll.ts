// While an input method is composing (Zhuyin and similar), the macOS WebKit view
// nudges the editor's scroll position by a pixel or two on each keystroke even
// though the typing line has not moved anywhere that needs scrolling, so the page
// creeps upward while the user types. Scroll changes that small during
// composition are never wanted, so they are undone. Larger ones, such as a new
// line reaching the lower third of the window, and scrolling done by the user
// still go through.
export const IME_SCROLL_DRIFT_MAX_PX = 3;
export const IME_COMPOSITION_END_GRACE_MS = 150;
export const USER_SCROLL_GRACE_MS = 400;

export function imeScrollChangeIsDrift({
  deltaY,
  msSinceUserScroll,
}: {
  deltaY: number;
  msSinceUserScroll: number;
}) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return false;
  if (Math.abs(deltaY) > IME_SCROLL_DRIFT_MAX_PX) return false;
  return msSinceUserScroll > USER_SCROLL_GRACE_MS;
}

export function installImeCompositionScrollGuard(root: HTMLElement) {
  const knownScrollTops = new WeakMap<Element, number>();
  let composing = false;
  let compositionEndedAt = Number.NEGATIVE_INFINITY;
  let lastUserScrollAt = Number.NEGATIVE_INFINITY;

  function scrollContainers() {
    const containers: Element[] = [];
    if (document.scrollingElement) containers.push(document.scrollingElement);
    const editorPane = root.closest(".editor-pane");
    if (editorPane) containers.push(editorPane);
    return containers;
  }

  function guarding() {
    return composing || performance.now() - compositionEndedAt < IME_COMPOSITION_END_GRACE_MS;
  }

  function rememberScrollTops() {
    for (const container of scrollContainers()) {
      knownScrollTops.set(container, container.scrollTop);
    }
  }

  function handleCompositionStart() {
    composing = true;
    rememberScrollTops();
  }

  function handleCompositionEnd() {
    composing = false;
    compositionEndedAt = performance.now();
  }

  function handleUserScrollIntent() {
    lastUserScrollAt = performance.now();
  }

  function handleScroll(event: Event) {
    const target = event.target === document ? document.scrollingElement : event.target;
    if (!(target instanceof Element) || !scrollContainers().includes(target)) return;

    const previousTop = knownScrollTops.get(target);
    if (
      previousTop !== undefined &&
      guarding() &&
      imeScrollChangeIsDrift({
        deltaY: target.scrollTop - previousTop,
        msSinceUserScroll: performance.now() - lastUserScrollAt,
      })
    ) {
      target.scrollTop = previousTop;
      return;
    }

    knownScrollTops.set(target, target.scrollTop);
  }

  rememberScrollTops();
  root.addEventListener("compositionstart", handleCompositionStart, true);
  root.addEventListener("compositionend", handleCompositionEnd, true);
  window.addEventListener("wheel", handleUserScrollIntent, { capture: true, passive: true });
  window.addEventListener("touchmove", handleUserScrollIntent, { capture: true, passive: true });
  window.addEventListener("pointerdown", handleUserScrollIntent, true);
  document.addEventListener("scroll", handleScroll, true);

  return () => {
    root.removeEventListener("compositionstart", handleCompositionStart, true);
    root.removeEventListener("compositionend", handleCompositionEnd, true);
    window.removeEventListener("wheel", handleUserScrollIntent, true);
    window.removeEventListener("touchmove", handleUserScrollIntent, true);
    window.removeEventListener("pointerdown", handleUserScrollIntent, true);
    document.removeEventListener("scroll", handleScroll, true);
  };
}
