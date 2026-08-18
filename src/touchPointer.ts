export function shouldClearTouchButtonFocus() {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia?.("(hover: none), (pointer: coarse)").matches,
  );
}

export function clearTouchButtonFocus(button: HTMLElement) {
  if (shouldClearTouchButtonFocus()) {
    button.blur();
  }
}
