import type { EditorSelectionHandle } from "./editorTypes";
import { siblingFileLink, type InsertableFile } from "./fileInsertion.ts";

type FileMenuDocument = { id: string; path: string | null; source: "local" | "dropbox" };

export function createTextContextMenu(
  currentDocument: () => FileMenuDocument | null,
  currentEditor: () => EditorSelectionHandle | null,
  listFiles: (document: FileMenuDocument) => Promise<string[]>,
  reportError: (message: string) => void,
) {
  let request = 0;
  let pending: {
    document: FileMenuDocument;
    insert: ((file: InsertableFile) => boolean) | null;
    files: InsertableFile[];
  } | null = null;
  return {
    prepare(x: number, y: number) {
      request++;
      pending = null;
      const target = document.elementFromPoint(x, y);
      const source = currentDocument();
      if (!source || !target?.closest(".editor-pane .milkdown-markdown-editor, .editor-pane .markdown-editor-host")) return null;
      const insert = currentEditor()?.prepareFileInsertion?.(target, x, y) ?? null;
      pending = { document: source, insert, files: [] };
      return {
        request,
        canInsert: Boolean(source.path && insert),
        message: !source.path ? "請先儲存目前檔案" : !insert ? "請切換到可編輯文字的位置" : null,
      };
    },
    async files(expectedRequest: number) {
      const snapshot = pending;
      try {
        if (expectedRequest !== request || !snapshot?.document.path || !snapshot.insert) return { request: expectedRequest, names: [] };
        const names = await listFiles(snapshot.document);
        if (request !== expectedRequest || currentDocument()?.id !== snapshot.document.id) return { request: expectedRequest, names: [], message: "目前檔案已切換，請重新開啟選單" };
        snapshot.files = names.map(siblingFileLink);
        return { request, names };
      } catch {
        return { request: expectedRequest, names: [], message: "無法讀取同層檔案，請確認目錄與連線後重試" };
      }
    },
    insert(expectedRequest: number, index: number) {
      const snapshot = pending;
      if (expectedRequest !== request || !snapshot || currentDocument()?.id !== snapshot.document.id) return;
      const file = snapshot.files[index];
      pending = null;
      if (file && !snapshot.insert?.(file)) reportError("文字內容或編輯位置已變更，請重新選擇插入檔案。");
    },
  };
}

declare global {
  interface Window {
    __scholiumTextMenu?: ReturnType<typeof createTextContextMenu>;
  }
}
