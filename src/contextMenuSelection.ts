const editorSelector = ".editor-pane .milkdown-markdown-editor, .editor-pane .markdown-editor-host";

export function preserveEditorContextMenuSelection(doc: Document) {
  let saved: {
    editor: Element;
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
  } | null = null;

  function editorAtTarget(target: EventTarget | null) {
    if (!(target instanceof Element) || target.closest("input, textarea, button, select")) return null;
    return target.closest(editorSelector);
  }

  function rememberSelection(event: MouseEvent) {
    saved = null;
    const secondaryClick = event.button === 2 ||
      (event.button === 0 && event.ctrlKey && /Mac/.test(doc.defaultView?.navigator.platform ?? ""));
    const editor = secondaryClick ? editorAtTarget(event.target) : null;
    if (!editor) return;
    const selection = doc.getSelection();
    const belongsToEditor = selection?.anchorNode && editor.contains(selection.anchorNode) &&
      selection.focusNode && editor.contains(selection.focusNode);
    saved = {
      editor,
      anchorNode: belongsToEditor ? selection.anchorNode : null,
      anchorOffset: belongsToEditor ? selection.anchorOffset : 0,
      focusNode: belongsToEditor ? selection.focusNode : null,
      focusOffset: belongsToEditor ? selection.focusOffset : 0,
    };
    event.preventDefault();
  }

  function restoreSelection(event: MouseEvent) {
    const snapshot = saved;
    saved = null;
    if (!snapshot || editorAtTarget(event.target) !== snapshot.editor) return;
    const selection = doc.getSelection();
    if (!selection) return;
    // WebKit selects the nearest word before dispatching contextmenu, even in whitespace.
    if (snapshot.anchorNode?.isConnected && snapshot.focusNode?.isConnected) {
      selection.setBaseAndExtent(snapshot.anchorNode, snapshot.anchorOffset, snapshot.focusNode, snapshot.focusOffset);
    } else {
      selection.removeAllRanges();
    }
  }

  doc.addEventListener("mousedown", rememberSelection, true);
  doc.addEventListener("contextmenu", restoreSelection, true);
  return () => {
    doc.removeEventListener("mousedown", rememberSelection, true);
    doc.removeEventListener("contextmenu", restoreSelection, true);
  };
}
