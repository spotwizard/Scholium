import { NodeSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

// ProseMirror scrolls the selection into view with scrollBy() and fractional
// distances. The macOS WebKit view applies a scrollBy() delta to what is shown
// on screen but rounds it away in the page's own scroll position, so when the
// typing line sits a fraction of a pixel past the scroll threshold, every
// keystroke asks for the same sub-pixel scroll again: the text creeps upward
// while clicks still land where the text used to be. Scrolling to an absolute
// whole-pixel position keeps the screen and the page in step.

type Rect = { left: number; right: number; top: number; bottom: number };
type Sides = number | Partial<Rect>;

export function wholePixelScrollPosition(current: number, move: number) {
  const roundedMove = move > 0 ? Math.ceil(move) : Math.floor(move);
  return Math.round(current) + roundedMove;
}

function side(value: Sides | undefined, name: keyof Rect, fallback: number) {
  if (typeof value === "number") return value;
  return value?.[name] ?? fallback;
}

function parentNode(node: Node): Node | null {
  const parent = (node as Element).assignedSlot || node.parentNode;
  return parent && parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    ? (parent as ShadowRoot).host
    : parent;
}

function windowRect(): Rect {
  const viewport = window.visualViewport;
  if (viewport) return { left: 0, right: viewport.width, top: 0, bottom: viewport.height };
  return {
    left: 0,
    right: document.documentElement.clientWidth,
    top: 0,
    bottom: document.documentElement.clientHeight,
  };
}

function clientRect(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  const scaleX = rect.width / element.offsetWidth || 1;
  const scaleY = rect.height / element.offsetHeight || 1;
  return {
    left: rect.left,
    right: rect.left + element.clientWidth * scaleX,
    top: rect.top,
    bottom: rect.top + element.clientHeight * scaleY,
  };
}

// Same walk as ProseMirror's scrollRectIntoView, but every scroll goes to a
// whole-pixel position instead of being a scrollBy() delta.
function scrollRectIntoViewWithWholePixels(view: EditorView, rect: Rect, startDOM: Node) {
  const threshold = (view.someProp("scrollThreshold") ?? 0) as Sides;
  const margin = (view.someProp("scrollMargin") ?? 5) as Sides;
  const doc = view.dom.ownerDocument;

  for (let parent: Node | null = startDOM; parent; ) {
    if (parent.nodeType !== Node.ELEMENT_NODE) {
      parent = parentNode(parent);
      continue;
    }

    const element = parent as HTMLElement;
    const atTop = element === doc.body;
    const bounding = atTop ? windowRect() : clientRect(element);
    let moveX = 0;
    let moveY = 0;
    if (rect.top < bounding.top + side(threshold, "top", 0)) {
      moveY = -(bounding.top - rect.top + side(margin, "top", 5));
    } else if (rect.bottom > bounding.bottom - side(threshold, "bottom", 0)) {
      moveY =
        rect.bottom - rect.top > bounding.bottom - bounding.top
          ? rect.top + side(margin, "top", 5) - bounding.top
          : rect.bottom - bounding.bottom + side(margin, "bottom", 5);
    }
    if (rect.left < bounding.left + side(threshold, "left", 0)) {
      moveX = -(bounding.left - rect.left + side(margin, "left", 5));
    } else if (rect.right > bounding.right - side(threshold, "right", 0)) {
      moveX = rect.right - bounding.right + side(margin, "right", 5);
    }

    if (moveX || moveY) {
      if (atTop) {
        const win = doc.defaultView ?? window;
        win.scrollTo(
          moveX ? wholePixelScrollPosition(win.scrollX, moveX) : win.scrollX,
          moveY ? wholePixelScrollPosition(win.scrollY, moveY) : win.scrollY,
        );
      } else {
        const startX = element.scrollLeft;
        const startY = element.scrollTop;
        if (moveY) element.scrollTop = wholePixelScrollPosition(startY, moveY);
        if (moveX) element.scrollLeft = wholePixelScrollPosition(startX, moveX);
        const dX = element.scrollLeft - startX;
        const dY = element.scrollTop - startY;
        rect = {
          left: rect.left - dX,
          top: rect.top - dY,
          right: rect.right - dX,
          bottom: rect.bottom - dY,
        };
      }
    }

    const position = atTop ? "fixed" : getComputedStyle(element).position;
    if (/^(fixed|sticky)$/.test(position)) break;
    parent = position === "absolute" ? element.offsetParent : parentNode(element);
  }
}

// For the editor's handleScrollToSelection prop.
export function scrollSelectionIntoViewWithWholePixels(view: EditorView) {
  const domSelection = (view.root as Document).getSelection?.() ?? window.getSelection();
  const startDOM = domSelection?.focusNode;
  if (!startDOM) return false;
  const startElement = startDOM.nodeType === Node.ELEMENT_NODE ? startDOM : startDOM.parentNode;
  if (!startElement || !view.dom.contains(startElement)) return false;

  const { selection } = view.state;
  if (selection instanceof NodeSelection) {
    const target = view.nodeDOM(selection.from);
    if (target instanceof HTMLElement) {
      scrollRectIntoViewWithWholePixels(view, target.getBoundingClientRect(), startDOM);
    }
    return true;
  }

  scrollRectIntoViewWithWholePixels(view, view.coordsAtPos(selection.head, 1), startDOM);
  return true;
}
