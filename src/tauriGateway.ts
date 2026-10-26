import { invoke } from "@tauri-apps/api/core";
import type { GlossaryBinding, GlossaryTerm, SelectionNote } from "./documentTypes";

export type MarkdownImageFileResult = {
  path: string;
  mimeType: string;
  dataUrl: string;
};

export type OpenMarkdownFileResult = {
  path: string;
  notesPath: string;
  title: string;
  modifiedAt?: number | null;
  body: string;
  notes: SelectionNote[];
  glossaryTerms?: GlossaryTerm[];
  glossaryBindings?: GlossaryBinding[];
};

export type OpenDirectoryEntryResult =
  | {
      kind: "directory";
      path: string;
      title: string;
      modifiedAt?: number | null;
      file: null;
    }
  | {
      kind: "file";
      path: string;
      title: string;
      modifiedAt?: number | null;
      file: OpenMarkdownFileResult;
    };

export type OpenMarkdownDirectoryResult = {
  path: string;
  parentPath: string | null;
  title: string;
  entries: OpenDirectoryEntryResult[];
};

export type SearchMarkdownFileResult = {
  path: string;
  parentPath: string | null;
  title: string;
  relativePath: string;
  matchedTags: string[];
};

export type OpenMarkdownFileContextResult = {
  selectedFile: OpenMarkdownFileResult;
  directory: OpenMarkdownDirectoryResult;
};

export type DropboxOAuthStatusResult = {
  connected: boolean;
};

export type NativeLocationKind = "directory" | "file";
export type WorkspaceSource = "local" | "dropbox";

export type NativeLocation = {
  kind: NativeLocationKind;
  path: string;
  title: string;
  source: WorkspaceSource;
};

export type SavedLocationsResult = {
  recent: NativeLocation[];
  favoriteDirectories: NativeLocation[];
};

export type OpenLocationEventPayload = NativeLocation;

export type SaveMarkdownFileResult = {
  path: string;
  notesPath: string;
  modifiedAt?: number | null;
};

export type DeleteMarkdownFileResult = {
  path: string;
  notesPath: string;
};

export type RenamePathResult = {
  path: string;
  title: string;
  notesPath?: string | null;
};

export type WritePdfFileResult = {
  path: string;
};

export type StartDropboxOAuthResult = {
  authUrl: string;
  redirectUri: string;
};

export type DropboxDirectoryEntryResult = {
  kind: "directory" | "file";
  path: string;
  title: string;
  size?: number | null;
  serverModified?: string | null;
};

export type OpenDropboxMarkdownDirectoryResult = {
  path: string;
  parentPath: string | null;
  title: string;
  entries: DropboxDirectoryEntryResult[];
};

export type OpenDropboxMarkdownFileResult = {
  path: string;
  notesPath: string;
  title: string;
  body: string;
  notes: SelectionNote[];
  glossaryTerms?: GlossaryTerm[];
  glossaryBindings?: GlossaryBinding[];
  rev?: string | null;
  serverModified?: string | null;
};

export type ReadMarkdownImageFileArgs = {
  markdownPath: string;
  imageSrc: string;
};

export type OpenMarkdownFileArgs = { path: string };
export type OpenMarkdownFileContextArgs = { path: string };
export type OpenMarkdownDirectoryArgs = { path: string };

export type SearchMarkdownFilesArgs = {
  exactTag: boolean;
  rootPath: string;
  query: string;
  searchTags: boolean;
};

export type ListDropboxMarkdownDirectoryArgs = { path: string };
export type OpenDropboxMarkdownFileArgs = { path: string };
export type ReadDropboxMarkdownBodyArgs = { path: string };

export type SetAppLanguageArgs = { language: string };
export type SetEditorInsertFileMenuArgs = { enabled: boolean; title: string };
export type ListSiblingFilesArgs = { path: string };
export type ListDropboxDirectoryFilesArgs = { path: string };
export type OpenLinkedFileArgs = { path: string };

export type SiblingFileResult = {
  path: string;
  title: string;
  fileName: string;
};
export type RememberRecentLocationArgs = NativeLocation;
export type ForgetSavedLocationArgs = Pick<NativeLocation, "kind" | "path" | "source">;
export type SetCurrentDirectoryLocationArgs = Pick<NativeLocation, "path" | "title" | "source">;

export type CreateNewWindowArgs = {
  documentTarget: OpenLocationEventPayload;
  requesterSceneIdentifier: string | null;
};

export type ValidateDroppedMarkdownPathArgs = { paths: string[] };
export type ResolveTypedMarkdownPathArgs = { path: string };
export type StoreDraftDocumentArgs = { id: string; contents: string };
export type DeleteStoredDraftDocumentArgs = { id: string };
export type DroppedMarkdownPathResult = {
  kind: "directory" | "file";
  path: string;
};
export type SetNativeFolderPickerListViewArgs = { enabled: boolean };

export type WritePdfFileArgs = {
  path: string;
  dataBase64: string;
};

export type WritePdfFileToDirectoryArgs = {
  directory: string;
  fileName: string;
  dataBase64: string;
};

export type SaveMarkdownFileArgs = {
  path: string;
  body: string;
  notes: SelectionNote[];
  glossaryTerms: GlossaryTerm[];
  glossaryBindings: GlossaryBinding[];
};

export type SaveDropboxMarkdownFileArgs = SaveMarkdownFileArgs & {
  rev: string | null;
};

export type CreateMarkdownFileArgs = {
  parentPath: string;
  fileName: string;
};

export type CreateMarkdownDirectoryArgs = {
  parentPath: string;
  name: string;
};

export type DuplicateMarkdownFileArgs = {
  path: string;
  fileName: string;
};

export type DeleteMarkdownFileArgs = { path: string };

export type DeleteMarkdownDirectoryArgs = {
  path: string;
  rootPath: string;
};

export type RenameMarkdownPathArgs = {
  path: string;
  name: string;
};

export type StartDropboxOAuthArgs = { appKey: string };

export type CompleteDropboxOAuthArgs = {
  code: string;
  state: string;
};

export function readMarkdownImageFile(args: ReadMarkdownImageFileArgs) {
  return invoke<MarkdownImageFileResult>("read_markdown_image_file", args);
}

export function openMarkdownFile(args: OpenMarkdownFileArgs) {
  return invoke<OpenMarkdownFileResult>("open_markdown_file", args);
}

export function openMarkdownFileContext(args: OpenMarkdownFileContextArgs) {
  return invoke<OpenMarkdownFileContextResult>("open_markdown_file_context", args);
}

export function openMarkdownDirectory(args: OpenMarkdownDirectoryArgs) {
  return invoke<OpenMarkdownDirectoryResult>("open_markdown_directory", args);
}

export function searchMarkdownFiles(args: SearchMarkdownFilesArgs) {
  return invoke<SearchMarkdownFileResult[]>("search_markdown_files", args);
}

export function listDropboxMarkdownDirectory(args: ListDropboxMarkdownDirectoryArgs) {
  return invoke<OpenDropboxMarkdownDirectoryResult>("list_dropbox_markdown_directory", args);
}

export function openDropboxMarkdownFile(args: OpenDropboxMarkdownFileArgs) {
  return invoke<OpenDropboxMarkdownFileResult>("open_dropbox_markdown_file", args);
}

export function readDropboxMarkdownBody(args: ReadDropboxMarkdownBodyArgs) {
  return invoke<string>("read_dropbox_markdown_body", args);
}

export function dropboxOAuthStatus() {
  return invoke<DropboxOAuthStatusResult>("dropbox_oauth_status");
}

export function setAppLanguage(args: SetAppLanguageArgs) {
  return invoke<void>("set_app_language", args);
}

export function setEditorInsertFileMenu(args: SetEditorInsertFileMenuArgs) {
  return invoke<void>("set_editor_insert_file_menu", args);
}

export function listSiblingFiles(args: ListSiblingFilesArgs) {
  return invoke<SiblingFileResult[]>("list_sibling_files", args);
}

export function listDropboxDirectoryFiles(args: ListDropboxDirectoryFilesArgs) {
  return invoke<OpenDropboxMarkdownDirectoryResult>("list_dropbox_directory_files", args);
}

export function openLinkedFile(args: OpenLinkedFileArgs) {
  return invoke<void>("open_linked_file", args);
}

export function takeNewWindowDocumentTarget() {
  return invoke<OpenLocationEventPayload | null>("take_new_window_document_target");
}

export function takeOpenedFilePaths() {
  return invoke<string[]>("take_opened_file_paths");
}

export function rememberRecentLocation(args: RememberRecentLocationArgs) {
  return invoke<void>("remember_recent_location", args);
}

export function forgetSavedLocation(args: ForgetSavedLocationArgs) {
  return invoke<void>("forget_saved_location", args);
}

export function setCurrentDirectoryLocation(args: SetCurrentDirectoryLocationArgs) {
  return invoke<void>("set_current_directory_location", args);
}

export function savedLocations() {
  return invoke<SavedLocationsResult>("saved_locations");
}

export function createNewWindow(args: CreateNewWindowArgs) {
  return invoke<string>("create_new_window", args);
}

export function checkDropboxConnection() {
  return invoke<DropboxOAuthStatusResult>("check_dropbox_connection");
}

export function validateDroppedMarkdownPath(args: ValidateDroppedMarkdownPathArgs) {
  return invoke<DroppedMarkdownPathResult>("validate_dropped_markdown_path", args);
}

export function resolveTypedMarkdownPath(args: ResolveTypedMarkdownPathArgs) {
  return invoke<DroppedMarkdownPathResult>("resolve_typed_markdown_path", args);
}

export function storeDraftDocument(args: StoreDraftDocumentArgs) {
  return invoke<void>("save_draft_document", args);
}

export function listStoredDraftDocuments() {
  return invoke<string[]>("list_draft_documents");
}

export function deleteStoredDraftDocument(args: DeleteStoredDraftDocumentArgs) {
  return invoke<void>("delete_draft_document", args);
}

export function focusAndFullscreenAppWindow() {
  return invoke<void>("focus_and_fullscreen_app_window");
}

export function setNativeFolderPickerListView(args: SetNativeFolderPickerListViewArgs) {
  return invoke<void>("set_native_folder_picker_list_view", args);
}

export function writePdfFileToDirectory(args: WritePdfFileToDirectoryArgs) {
  return invoke<WritePdfFileResult>("write_pdf_file_to_directory", args);
}

export function writePdfFile(args: WritePdfFileArgs) {
  return invoke<WritePdfFileResult>("write_pdf_file", args);
}

export function saveMarkdownFile(args: SaveMarkdownFileArgs) {
  return invoke<SaveMarkdownFileResult>("save_markdown_file", args);
}

export function duplicateMarkdownFile(args: DuplicateMarkdownFileArgs) {
  return invoke<OpenMarkdownFileResult>("duplicate_markdown_file", args);
}

export function deleteMarkdownFile(args: DeleteMarkdownFileArgs) {
  return invoke<DeleteMarkdownFileResult>("delete_markdown_file", args);
}

export function deleteMarkdownDirectory(args: DeleteMarkdownDirectoryArgs) {
  return invoke<void>("delete_markdown_directory", args);
}

export function renameMarkdownFile(args: RenameMarkdownPathArgs) {
  return invoke<OpenMarkdownFileResult>("rename_markdown_file", args);
}

export function renameMarkdownDirectory(args: RenameMarkdownPathArgs) {
  return invoke<RenamePathResult>("rename_markdown_directory", args);
}

export function createMarkdownDirectory(args: CreateMarkdownDirectoryArgs) {
  return invoke<RenamePathResult>("create_markdown_directory", args);
}

export function startDropboxOAuth(args: StartDropboxOAuthArgs) {
  return invoke<StartDropboxOAuthResult>("start_dropbox_oauth", args);
}

export function completeDropboxOAuth(args: CompleteDropboxOAuthArgs) {
  return invoke<DropboxOAuthStatusResult>("complete_dropbox_oauth", args);
}

export function disconnectDropbox() {
  return invoke<DropboxOAuthStatusResult>("disconnect_dropbox");
}

export function saveDropboxMarkdownFile(args: SaveDropboxMarkdownFileArgs) {
  return invoke<OpenDropboxMarkdownFileResult>("save_dropbox_markdown_file", args);
}

export function createDropboxMarkdownFile(args: CreateMarkdownFileArgs) {
  return invoke<OpenDropboxMarkdownFileResult>("create_dropbox_markdown_file", args);
}

export function createDropboxMarkdownDirectory(args: CreateMarkdownDirectoryArgs) {
  return invoke<RenamePathResult>("create_dropbox_markdown_directory", args);
}

export function duplicateDropboxMarkdownFile(args: DuplicateMarkdownFileArgs) {
  return invoke<OpenDropboxMarkdownFileResult>("duplicate_dropbox_markdown_file", args);
}

export function deleteDropboxMarkdownFile(args: DeleteMarkdownFileArgs) {
  return invoke<OpenDropboxMarkdownFileResult>("delete_dropbox_markdown_file", args);
}

export function deleteDropboxMarkdownDirectory(args: DeleteMarkdownDirectoryArgs) {
  return invoke<void>("delete_dropbox_markdown_directory", args);
}

export function renameDropboxMarkdownFile(args: RenameMarkdownPathArgs) {
  return invoke<RenamePathResult>("rename_dropbox_markdown_file", args);
}

export function renameDropboxMarkdownDirectory(args: RenameMarkdownPathArgs) {
  return invoke<RenamePathResult>("rename_dropbox_markdown_directory", args);
}
