type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export function shouldHandlePreviewSelectAllShortcut(
  event: KeyboardShortcutEvent,
  editorOwnsShortcut: boolean,
  targetIsNestedEditor: boolean,
) {
  return (
    editorOwnsShortcut &&
    !targetIsNestedEditor &&
    (event.code === "KeyA" || event.key.toLowerCase() === "a") &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
