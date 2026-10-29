use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
#[cfg(not(mobile))]
use std::io::Read;
use std::io::Write;
#[cfg(not(mobile))]
use std::net::TcpListener;
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
#[cfg(not(mobile))]
use std::time::Instant;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(desktop)]
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(mobile)]
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

mod atomic_file;
mod draft_store;
mod dropbox_token_state;
#[cfg(target_os = "macos")]
mod editor_context_menu;
mod frontmatter_tags;
mod local_image;
mod local_save_recovery;
mod markdown_path;
mod pdf_export;

use atomic_file::{
    atomic_replace_private_file, read_private_file_to_string, read_regular_file_to_string,
};
use dropbox_token_state::{
    DropboxConnectionSnapshot, DropboxTokenSnapshot, DropboxTokenState, DropboxTokenStore,
};
use frontmatter_tags::{markdown_tags, normalize_tag_search_value};
use local_image::read_markdown_image_file;
use local_save_recovery::{
    create_durable_directory, lock_local_documents, pending_document_paths, recover_local_document,
    repair_local_sidecar, save_local_document, LocalDocumentGuard, LocalDocumentPaths,
    LocalDocumentPayload,
};
use markdown_path::{
    dropped_markdown_path, is_markdown_path, typed_markdown_location,
    validate_existing_markdown_file, validate_markdown_file_name, validate_path_name,
    DroppedMarkdownPath, TypedMarkdownLocation,
};
use pdf_export::{write_pdf_file, write_pdf_file_to_directory};

#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString, NSUserDefaults};

#[cfg(desktop)]
const MENU_QUIT: &str = "app:quit";
#[cfg(desktop)]
const MENU_NEW_WINDOW: &str = "file:new-window";
#[cfg(desktop)]
const MENU_NEW_FILE: &str = "file:new-file";
#[cfg(desktop)]
const MENU_NEW_FOLDER: &str = "file:new-folder";
#[cfg(desktop)]
const MENU_OPEN_FILE: &str = "file:open-file";
#[cfg(desktop)]
const MENU_OPEN_FOLDER: &str = "file:open-folder";
#[cfg(desktop)]
const MENU_OPEN_PATH: &str = "file:open-path";
#[cfg(desktop)]
const MENU_CLOUD_DROPBOX: &str = "file:cloud:dropbox";
#[cfg(desktop)]
const MENU_OPEN_SETTINGS: &str = "app:open-settings";
#[cfg(desktop)]
const MENU_FAVORITE_DIRECTORIES: &str = "file:favorite-directories";
#[cfg(desktop)]
const MENU_RECENT_LOCATIONS: &str = "file:recent-locations";
#[cfg(desktop)]
const MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES: &str = "file:add-current-directory-to-favorites";
#[cfg(desktop)]
const MENU_CLEAR_FAVORITE_DIRECTORIES: &str = "file:clear-favorite-directories";
#[cfg(desktop)]
const MENU_CLEAR_RECENT_LOCATIONS: &str = "file:clear-recent-locations";
#[cfg(desktop)]
const MENU_FAVORITE_DIRECTORY_PREFIX: &str = "file:favorite-directory:";
#[cfg(desktop)]
const MENU_RECENT_LOCATION_PREFIX: &str = "file:recent-location:";
#[cfg(desktop)]
const MENU_SELECT_ALL: &str = "edit:select-all";
const MAX_RECENT_LOCATIONS: usize = 12;
const MAX_FILE_SEARCH_RESULTS: usize = 200;
const MAX_LOCAL_SYMLINK_DEPTH: usize = 40;
const NOTES_STORE_DIRECTORY: &str = "notes";
const LOCAL_RECOVERY_DIRECTORY: &str = "recovery/local";
const DRAFT_STORE_DIRECTORY: &str = "drafts";
const DEFAULT_APP_LANGUAGE: &str = "zh-Hant";
#[cfg(not(mobile))]
const DROPBOX_OAUTH_REDIRECT_PORT: u16 = 53682;
#[cfg(not(mobile))]
const DROPBOX_OAUTH_CALLBACK_PATH: &str = "/dropbox/oauth/callback";
#[cfg(any(mobile, test))]
const DROPBOX_MOBILE_URL_SCHEME: &str = "db-bdv6guwbi6ol9mg";
const DROPBOX_OAUTH_AUTHORIZE_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_OAUTH_TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_LIST_FOLDER_URL: &str = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_LIST_FOLDER_CONTINUE_URL: &str =
    "https://api.dropboxapi.com/2/files/list_folder/continue";
const DROPBOX_DOWNLOAD_URL: &str = "https://content.dropboxapi.com/2/files/download";
const DROPBOX_UPLOAD_URL: &str = "https://content.dropboxapi.com/2/files/upload";
const DROPBOX_COPY_URL: &str = "https://api.dropboxapi.com/2/files/copy_v2";
const DROPBOX_DELETE_URL: &str = "https://api.dropboxapi.com/2/files/delete_v2";
const DROPBOX_MOVE_URL: &str = "https://api.dropboxapi.com/2/files/move_v2";
const DROPBOX_CREATE_FOLDER_URL: &str = "https://api.dropboxapi.com/2/files/create_folder_v2";
const DROPBOX_REQUIRED_SCOPES: &str =
    "files.metadata.read files.content.read files.metadata.write files.content.write";
const DROPBOX_TOKEN_REFRESH_ATTEMPTS: usize = 3;
const DROPBOX_TOKEN_REFRESH_RETRY_DELAY: Duration = Duration::from_millis(500);
#[cfg(desktop)]
static NEW_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationEntry {
    kind: String,
    path: String,
    title: String,
    #[serde(default = "default_location_source")]
    source: String,
}

#[derive(Default)]
struct NewWindowDocumentTargetState(Mutex<HashMap<String, LocationEntry>>);

#[derive(Default)]
struct FocusedWindowState(Mutex<Option<String>>);

fn default_location_source() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationStore {
    #[serde(default)]
    recent: Vec<LocationEntry>,
    #[serde(default)]
    favorite_directories: Vec<LocationEntry>,
}

struct LocationMenuState {
    current_directories: Mutex<HashMap<String, LocationEntry>>,
    language: Mutex<String>,
    store: Mutex<LocationStore>,
}

impl Default for LocationMenuState {
    fn default() -> Self {
        Self {
            current_directories: Mutex::new(HashMap::new()),
            language: Mutex::new(DEFAULT_APP_LANGUAGE.to_string()),
            store: Mutex::new(LocationStore::default()),
        }
    }
}

#[derive(Debug, Clone)]
struct DropboxOAuthSession {
    app_key: String,
    code_verifier: String,
    connection_snapshot: DropboxConnectionSnapshot,
    owner_window_label: String,
    redirect_uri: String,
    state: String,
}

#[derive(Default)]
struct DropboxState {
    oauth_sessions: Mutex<HashMap<String, DropboxOAuthSession>>,
    tokens: Mutex<DropboxTokenState>,
}

#[derive(Default)]
struct OpenedFileQueue {
    frontend_ready: bool,
    pending_paths: Vec<String>,
}

#[derive(Default)]
struct OpenedFileState(Mutex<OpenedFileQueue>);

#[cfg(desktop)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenLocationPayload {
    kind: String,
    path: String,
    source: String,
    title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedPathPayload {
    kind: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextSelectionAnchor {
    from: usize,
    to: usize,
    selected_text: String,
    prefix: String,
    suffix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionNote {
    id: String,
    document_id: String,
    status: String,
    selected_text: String,
    anchor: TextSelectionAnchor,
    tone: Option<u8>,
    body: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryTerm {
    id: String,
    term: String,
    normalized_term: String,
    definition: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryBinding {
    id: String,
    document_id: String,
    term_id: String,
    term: String,
    normalized_term: String,
    status: String,
    anchor: TextSelectionAnchor,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesFile {
    version: u32,
    markdown_path: String,
    notes: Vec<SelectionNote>,
    #[serde(default)]
    glossary_terms: Vec<GlossaryTerm>,
    #[serde(default)]
    glossary_bindings: Vec<GlossaryBinding>,
}

type DocumentNotes = (
    String,
    Vec<SelectionNote>,
    Vec<GlossaryTerm>,
    Vec<GlossaryBinding>,
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMarkdownFile {
    path: String,
    notes_path: String,
    title: String,
    modified_at: Option<i64>,
    body: String,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDirectoryEntry {
    kind: String,
    path: String,
    title: String,
    modified_at: Option<i64>,
    file: Option<OpenMarkdownFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMarkdownDirectory {
    path: String,
    parent_path: Option<String>,
    title: String,
    entries: Vec<OpenDirectoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMarkdownFile {
    path: String,
    parent_path: Option<String>,
    title: String,
    relative_path: String,
    matched_tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMarkdownFileContext {
    selected_file: OpenMarkdownFile,
    directory: OpenMarkdownDirectory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveMarkdownFile {
    path: String,
    notes_path: String,
    modified_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMarkdownFile {
    path: String,
    notes_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenamedPath {
    path: String,
    title: String,
    notes_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxOAuthStatus {
    connected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxOAuthStart {
    auth_url: String,
    redirect_uri: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxOAuthCallbackPayload {
    status: String,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct DropboxTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DropboxErrorResponse {
    #[serde(default)]
    error: Option<serde_json::Value>,
    #[serde(default)]
    error_summary: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DropboxListFolderResponse {
    entries: Vec<DropboxMetadata>,
    cursor: String,
    has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = ".tag")]
enum DropboxMetadata {
    #[serde(rename = "file")]
    File {
        name: String,
        #[serde(default)]
        path_display: Option<String>,
        #[serde(default)]
        path_lower: Option<String>,
        #[serde(default)]
        server_modified: Option<String>,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        is_downloadable: Option<bool>,
    },
    #[serde(rename = "folder")]
    Folder {
        name: String,
        #[serde(default)]
        path_display: Option<String>,
        #[serde(default)]
        path_lower: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct DropboxDownloadMetadata {
    name: String,
    #[serde(default)]
    path_display: Option<String>,
    #[serde(default)]
    path_lower: Option<String>,
    #[serde(default)]
    rev: Option<String>,
    #[serde(default)]
    server_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DropboxWriteMetadata {
    name: String,
    #[serde(default)]
    path_display: Option<String>,
    #[serde(default)]
    path_lower: Option<String>,
    #[serde(default)]
    rev: Option<String>,
    #[serde(default)]
    server_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxDirectoryEntry {
    kind: String,
    path: String,
    title: String,
    size: Option<u64>,
    server_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxMarkdownDirectory {
    path: String,
    parent_path: Option<String>,
    title: String,
    entries: Vec<DropboxDirectoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropboxMarkdownFile {
    path: String,
    notes_path: String,
    title: String,
    body: String,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
    rev: Option<String>,
    server_modified: Option<String>,
}

fn legacy_sidecar_path(markdown_path: &Path) -> Result<PathBuf, String> {
    let file_name = markdown_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid Markdown file path".to_string())?;

    Ok(markdown_path.with_file_name(format!("{file_name}.notes.json")))
}

fn normalized_markdown_path_string(markdown_path: &Path) -> String {
    fs::canonicalize(markdown_path)
        .unwrap_or_else(|_| markdown_path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn stable_notes_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn notes_store_path_in_app_data(
    app_data_directory: &Path,
    markdown_path: &Path,
) -> Result<PathBuf, String> {
    fs::create_dir_all(app_data_directory)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;
    let app_data_directory = fs::canonicalize(app_data_directory)
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let notes_directory = app_data_directory.join(NOTES_STORE_DIRECTORY);
    create_durable_directory(&notes_directory)
        .map_err(|error| format!("failed to create notes storage directory: {error}"))?;
    let normalized_path = normalized_markdown_path_string(markdown_path);
    let notes_file_name = format!("{:016x}.notes.json", stable_notes_hash(&normalized_path));

    Ok(notes_directory.join(notes_file_name))
}

fn notes_store_path(app: &AppHandle, markdown_path: &Path) -> Result<PathBuf, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    notes_store_path_in_app_data(&app_data_directory, markdown_path)
}

fn local_recovery_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data_directory)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;
    let app_data_directory = fs::canonicalize(&app_data_directory)
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_directory.join(LOCAL_RECOVERY_DIRECTORY))
}

fn draft_store_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data_directory)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;
    let app_data_directory = fs::canonicalize(&app_data_directory)
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_directory.join(DRAFT_STORE_DIRECTORY))
}

#[tauri::command]
fn save_draft_document(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    draft_store::save_draft(&draft_store_directory(&app)?, &id, &contents)
}

#[tauri::command]
fn list_draft_documents(app: AppHandle) -> Result<Vec<String>, String> {
    draft_store::list_drafts(&draft_store_directory(&app)?)
}

#[tauri::command]
fn delete_draft_document(app: AppHandle, id: String) -> Result<(), String> {
    draft_store::delete_draft(&draft_store_directory(&app)?, &id)
}

fn lock_local_document_store(app: &AppHandle) -> Result<(PathBuf, LocalDocumentGuard), String> {
    let recovery_directory = local_recovery_directory(app)?;
    let guard = lock_local_documents(&recovery_directory)?;
    Ok((recovery_directory, guard))
}

fn resolved_local_document_path(markdown_path: &Path) -> Result<PathBuf, String> {
    resolved_local_document_path_at_depth(markdown_path, 0)
}

fn resolved_local_document_path_at_depth(
    markdown_path: &Path,
    symlink_depth: usize,
) -> Result<PathBuf, String> {
    if symlink_depth >= MAX_LOCAL_SYMLINK_DEPTH {
        return Err("failed to resolve local Markdown path: too many symbolic links".to_string());
    }

    match fs::symlink_metadata(markdown_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(markdown_path)
                .map_err(|error| format!("failed to resolve local Markdown path: {error}"))?;
            let target = if target.is_absolute() {
                target
            } else {
                markdown_path
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                    .unwrap_or_else(|| Path::new("."))
                    .join(target)
            };
            return resolved_local_document_path_at_depth(&target, symlink_depth + 1);
        }
        Ok(_) => {
            return fs::canonicalize(markdown_path)
                .map_err(|error| format!("failed to resolve local Markdown path: {error}"));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("failed to inspect local Markdown path: {error}"));
        }
    }

    let file_name = markdown_path
        .file_name()
        .ok_or_else(|| "invalid Markdown file path".to_string())?;
    let parent = markdown_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("failed to resolve local Markdown directory: {error}"))?;
    Ok(parent.join(file_name))
}

fn local_path_entry_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("failed to inspect local path: {error}")),
    }
}

fn local_path_uses_symlink(path: &Path) -> Result<bool, String> {
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve current directory: {error}"))?
            .join(path)
    };
    let mut current = PathBuf::new();
    for component in absolute_path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(format!(
                    "failed to inspect local Markdown path components: {error}"
                ))
            }
        }
    }
    Ok(false)
}

fn local_document_paths(
    app: &AppHandle,
    markdown_path: &Path,
) -> Result<LocalDocumentPaths, String> {
    let document_path = resolved_local_document_path(markdown_path)?;
    let notes_path = notes_store_path(app, &document_path)?;
    let sidecar_path = legacy_sidecar_path(&document_path)?;
    let mirror_notes_to_sidecar = path_is_local_dropbox_synced_path(&document_path);

    Ok(LocalDocumentPaths::new(
        document_path,
        notes_path,
        sidecar_path,
        mirror_notes_to_sidecar,
    ))
}

fn recover_local_document_path(
    app: &AppHandle,
    markdown_path: &Path,
    guard: &LocalDocumentGuard,
) -> Result<LocalDocumentPaths, String> {
    let paths = local_document_paths(app, markdown_path)?;
    let recovery_directory = local_recovery_directory(app)?;
    recover_local_document(guard, &recovery_directory, &paths)?;
    Ok(paths)
}

fn repair_local_dropbox_sidecar_on_open(
    app: &AppHandle,
    markdown_path: &Path,
    paths: &LocalDocumentPaths,
    recovery_directory: &Path,
    guard: &LocalDocumentGuard,
) -> Result<(), String> {
    if !paths.mirrors_notes_to_sidecar() {
        return Ok(());
    }

    let notes_file = read_notes_file(app, markdown_path)?;
    let (document_id, desired_sidecar) = if let Some(notes_file) = notes_file
        .as_ref()
        .filter(|notes_file| notes_file_is_empty(notes_file))
    {
        // An empty sidecar saved through the Dropbox API names a `dropbox:` document, not this file.
        (
            empty_sidecar_document_id(&notes_file.markdown_path, markdown_path),
            None,
        )
    } else if let Some(serialized) = read_private_file_to_string(paths.notes())
        .map_err(|error| format!("failed to read stored notes: {error}"))?
    {
        let notes_file = notes_file.ok_or_else(|| "failed to read stored notes".to_string())?;
        (notes_file.markdown_path, Some(serialized))
    } else {
        return Ok(());
    };

    repair_local_sidecar(
        guard,
        recovery_directory,
        paths,
        document_id,
        desired_sidecar,
    )?;
    Ok(())
}

fn empty_sidecar_document_id(sidecar_document_id: &str, markdown_path: &Path) -> String {
    let names_this_document = resolved_local_document_path(Path::new(sidecar_document_id))
        .ok()
        .zip(resolved_local_document_path(markdown_path).ok())
        .is_some_and(|(sidecar_document, document)| sidecar_document == document);
    if names_this_document {
        sidecar_document_id.to_string()
    } else {
        markdown_path.to_string_lossy().to_string()
    }
}

fn recover_local_documents_in_directory(
    app: &AppHandle,
    directory: &Path,
    guard: &LocalDocumentGuard,
) -> Result<(), String> {
    let recovery_directory = local_recovery_directory(app)?;
    for document_path in pending_document_paths(guard, &recovery_directory)? {
        if document_path.starts_with(directory) {
            let paths = local_document_paths(app, &document_path)?;
            recover_local_document(guard, &recovery_directory, &paths)?;
        }
    }
    Ok(())
}

fn resolved_local_directory_mutation_path(path: &Path) -> Result<Option<PathBuf>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Ok(None),
        Ok(_) => fs::canonicalize(path)
            .map(Some)
            .map_err(|error| format!("failed to resolve selected directory: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            resolved_local_document_path(path).map(Some)
        }
        Err(error) => Err(format!("failed to inspect selected directory: {error}")),
    }
}

fn recover_local_directory_mutation_path(
    app: &AppHandle,
    path: &Path,
    guard: &LocalDocumentGuard,
) -> Result<Option<PathBuf>, String> {
    let resolved_path = resolved_local_directory_mutation_path(path)?;
    if let Some(resolved_path) = resolved_path.as_ref() {
        recover_local_documents_in_directory(app, resolved_path, guard)?;
    }
    Ok(resolved_path)
}

fn dropbox_notes_markdown_path(dropbox_path: &str) -> PathBuf {
    let normalized_path = normalize_dropbox_path(dropbox_path).to_lowercase();

    PathBuf::from(format!("dropbox:{normalized_path}"))
}

fn dropbox_notes_sidecar_path(dropbox_path: &str) -> String {
    let normalized_path = normalize_dropbox_path(dropbox_path);

    format!("{normalized_path}.notes.json")
}

fn visible_notes_from_file(
    notes_file: NotesFile,
) -> (Vec<SelectionNote>, Vec<GlossaryTerm>, Vec<GlossaryBinding>) {
    (
        notes_file
            .notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .collect(),
        notes_file.glossary_terms,
        notes_file
            .glossary_bindings
            .into_iter()
            .filter(|binding| binding.status != "deleted")
            .collect(),
    )
}

fn notes_file_for_document(
    document_path: String,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
) -> NotesFile {
    NotesFile {
        version: 1,
        markdown_path: document_path.clone(),
        notes: notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .map(|mut note| {
                note.document_id = document_path.clone();
                note
            })
            .collect(),
        glossary_terms,
        glossary_bindings: glossary_bindings
            .into_iter()
            .filter(|binding| binding.status != "deleted")
            .map(|mut binding| {
                binding.document_id = document_path.clone();
                binding
            })
            .collect(),
    }
}

fn path_is_local_dropbox_synced_path(markdown_path: &Path) -> bool {
    let normalized_path = normalized_markdown_path_string(markdown_path).replace('\\', "/");
    let normalized_path = normalized_path.to_lowercase();

    normalized_path.contains("/dropbox/")
        || normalized_path.contains("/library/cloudstorage/dropbox/")
}

fn write_legacy_sidecar(path: &Path, contents: &str) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            atomic_replace_private_file(path, contents.as_bytes())
        }
        Ok(metadata) if metadata.is_file() => {
            let mut file = fs::OpenOptions::new().write(true).open(path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;

                let opened_metadata = file.metadata()?;
                if opened_metadata.dev() != metadata.dev()
                    || opened_metadata.ino() != metadata.ino()
                {
                    return Err(std::io::Error::other(
                        "sidecar path changed before it could be written",
                    ));
                }
            }
            file.set_len(0)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;

                let opened_metadata = file.metadata()?;
                let current_metadata = fs::symlink_metadata(path)?;
                if current_metadata.file_type().is_symlink()
                    || opened_metadata.dev() != current_metadata.dev()
                    || opened_metadata.ino() != current_metadata.ino()
                {
                    return Err(std::io::Error::other(
                        "sidecar path changed while it was being written",
                    ));
                }
            }
            Ok(())
        }
        Ok(_) => Err(std::io::Error::other(
            "sidecar output path is not a regular file",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()
        }
        Err(error) => Err(error),
    }
}

fn remove_file_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn mirror_notes_file_to_local_dropbox_sidecar_legacy(
    markdown_path: &Path,
    notes_file: &NotesFile,
) -> Result<(), String> {
    if !path_is_local_dropbox_synced_path(markdown_path) {
        return Ok(());
    }

    let sidecar_path = legacy_sidecar_path(markdown_path)?;
    if notes_file_is_empty(notes_file) {
        remove_file_if_present(&sidecar_path)
            .map_err(|error| format!("failed to remove Dropbox sidecar notes: {error}"))?;
        return Ok(());
    }

    let serialized = serde_json::to_string_pretty(notes_file)
        .map_err(|error| format!("failed to serialize Dropbox sidecar notes: {error}"))?;
    write_legacy_sidecar(&sidecar_path, &serialized)
        .map_err(|error| format!("failed to write Dropbox sidecar notes: {error}"))
}

fn read_document_notes(
    app: &AppHandle,
    markdown_path: &Path,
    mirror_legacy_sidecar: bool,
) -> Result<DocumentNotes, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    let notes_file = read_notes_file(app, markdown_path)?;
    let (notes, glossary_terms, glossary_bindings) = match notes_file {
        Some(notes_file) => {
            if mirror_legacy_sidecar {
                mirror_notes_file_to_local_dropbox_sidecar_legacy(markdown_path, &notes_file)?;
            }
            visible_notes_from_file(notes_file)
        }
        None => (Vec::new(), Vec::new(), Vec::new()),
    };

    Ok((
        notes_path.to_string_lossy().to_string(),
        notes,
        glossary_terms,
        glossary_bindings,
    ))
}

fn remove_document_notes_at_paths(
    notes_path: PathBuf,
    legacy_notes_path: PathBuf,
    preserve_private_notes: bool,
) -> Result<PathBuf, String> {
    if !preserve_private_notes {
        remove_file_if_present(&notes_path)
            .map_err(|error| format!("failed to delete notes: {error}"))?;
    }

    remove_file_if_present(&legacy_notes_path)
        .map_err(|error| format!("failed to delete legacy sidecar notes: {error}"))?;

    Ok(notes_path)
}

fn document_notes_paths(
    app: &AppHandle,
    markdown_path: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    Ok((
        notes_store_path(app, markdown_path)?,
        legacy_sidecar_path(markdown_path)?,
    ))
}

fn remove_document_notes(app: &AppHandle, markdown_path: &Path) -> Result<PathBuf, String> {
    let (notes_path, legacy_notes_path) = document_notes_paths(app, markdown_path)?;
    remove_document_notes_at_paths(notes_path, legacy_notes_path, false)
}

fn document_title(markdown_path: &Path) -> String {
    markdown_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn directory_title(directory_path: &Path) -> String {
    directory_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace")
        .to_string()
}

fn location_title(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn normalize_app_language(language: &str) -> &'static str {
    match language {
        "en" => "en",
        "zh-Hans" => "zh-Hans",
        _ => DEFAULT_APP_LANGUAGE,
    }
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn random_url_token(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; byte_count];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("failed to generate secure random bytes: {error}"))?;

    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_code_challenge(code_verifier: &str) -> String {
    let digest = Sha256::digest(code_verifier.as_bytes());

    URL_SAFE_NO_PAD.encode(digest)
}

fn urlencoded_form_body(params: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in params {
        serializer.append_pair(key, value);
    }

    serializer.finish()
}

#[cfg(not(mobile))]
fn dropbox_redirect_uri() -> String {
    format!("http://127.0.0.1:{DROPBOX_OAUTH_REDIRECT_PORT}{DROPBOX_OAUTH_CALLBACK_PATH}")
}

#[cfg(mobile)]
fn dropbox_redirect_uri() -> String {
    format!("{DROPBOX_MOBILE_URL_SCHEME}://2/token")
}

fn dropbox_token_store_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(app_data_dir.join("dropbox.json"))
}

fn read_dropbox_tokens_from_disk(app_handle: &tauri::AppHandle) -> Option<DropboxTokenStore> {
    let store_path = dropbox_token_store_path(app_handle).ok()?;
    let raw_store = read_private_file_to_string(&store_path).ok()??;

    serde_json::from_str(&raw_store).ok()
}

fn load_dropbox_tokens(
    app_handle: &tauri::AppHandle,
    tokens: Option<DropboxTokenStore>,
) -> Result<(), String> {
    let state = app_handle.state::<DropboxState>();
    let mut current_tokens = state
        .tokens
        .lock()
        .map_err(|_| "failed to lock Dropbox token store".to_string())?;

    current_tokens.load(tokens);
    Ok(())
}

fn write_dropbox_tokens(
    app_handle: &tauri::AppHandle,
    tokens: &DropboxTokenStore,
) -> Result<(), String> {
    let store_path = dropbox_token_store_path(app_handle)?;
    let serialized = serde_json::to_string_pretty(tokens)
        .map_err(|error| format!("failed to serialize Dropbox tokens: {error}"))?;

    atomic_replace_private_file(&store_path, serialized.as_bytes())
        .map_err(|error| format!("failed to write Dropbox tokens: {error}"))
}

fn remove_dropbox_tokens(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let store_path = dropbox_token_store_path(app_handle)?;
    let state = app_handle.state::<DropboxState>();
    let mut tokens = state
        .tokens
        .lock()
        .map_err(|_| "failed to lock Dropbox token store".to_string())?;

    tokens.disconnect(|| match fs::remove_file(&store_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove Dropbox tokens: {error}")),
    })
}

fn current_dropbox_tokens(
    app_handle: &tauri::AppHandle,
) -> Result<Option<DropboxTokenStore>, String> {
    app_handle
        .state::<DropboxState>()
        .tokens
        .lock()
        .map(|tokens| tokens.current())
        .map_err(|_| "failed to lock Dropbox token store".to_string())
}

fn dropbox_token_snapshot(
    app_handle: &tauri::AppHandle,
) -> Result<Option<DropboxTokenSnapshot>, String> {
    app_handle
        .state::<DropboxState>()
        .tokens
        .lock()
        .map(|tokens| tokens.token_snapshot())
        .map_err(|_| "failed to lock Dropbox token store".to_string())
}

fn dropbox_connection_snapshot(
    app_handle: &tauri::AppHandle,
) -> Result<DropboxConnectionSnapshot, String> {
    app_handle
        .state::<DropboxState>()
        .tokens
        .lock()
        .map(|tokens| tokens.connection_snapshot())
        .map_err(|_| "failed to lock Dropbox token store".to_string())
}

fn commit_dropbox_token_refresh(
    app_handle: &tauri::AppHandle,
    snapshot: &DropboxTokenSnapshot,
    refreshed_tokens: DropboxTokenStore,
) -> Result<DropboxTokenStore, String> {
    let state = app_handle.state::<DropboxState>();
    let mut tokens = state
        .tokens
        .lock()
        .map_err(|_| "failed to lock Dropbox token store".to_string())?;

    tokens.commit_refresh(snapshot, refreshed_tokens, |tokens| {
        write_dropbox_tokens(app_handle, tokens)
    })
}

fn commit_dropbox_connection(
    app_handle: &tauri::AppHandle,
    snapshot: DropboxConnectionSnapshot,
    new_tokens: DropboxTokenStore,
) -> Result<(), String> {
    let state = app_handle.state::<DropboxState>();
    let mut tokens = state
        .tokens
        .lock()
        .map_err(|_| "failed to lock Dropbox token store".to_string())?;

    tokens.commit_connection(snapshot, new_tokens, |tokens| {
        write_dropbox_tokens(app_handle, tokens)
    })
}

fn dropbox_oauth_callback_payload(
    error: String,
    state: Option<String>,
) -> DropboxOAuthCallbackPayload {
    DropboxOAuthCallbackPayload {
        status: "error".to_string(),
        code: None,
        state,
        error: Some(error),
    }
}

fn dropbox_oauth_callback_from_url(url: &Url) -> DropboxOAuthCallbackPayload {
    let query_pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let code = query_pairs.get("code").cloned();
    let state = query_pairs.get("state").cloned();
    let error = query_pairs
        .get("error_description")
        .or_else(|| query_pairs.get("error"))
        .cloned();

    if let Some(error) = error {
        return dropbox_oauth_callback_payload(error, state);
    }

    if code.is_none() {
        return dropbox_oauth_callback_payload(
            "Dropbox callback did not include an authorization code".to_string(),
            state,
        );
    }

    DropboxOAuthCallbackPayload {
        status: "success".to_string(),
        code,
        state,
        error: None,
    }
}

fn dropbox_oauth_callback_matches_session(
    session: &DropboxOAuthSession,
    payload: &DropboxOAuthCallbackPayload,
) -> bool {
    payload.state.as_deref() == Some(session.state.as_str())
}

fn dropbox_oauth_callback_ends_session(payload: &DropboxOAuthCallbackPayload) -> bool {
    payload.status != "success" || payload.code.is_none() || payload.state.is_none()
}

fn emit_dropbox_oauth_callback_to_owner(
    app_handle: &tauri::AppHandle,
    payload: DropboxOAuthCallbackPayload,
) -> Result<(), String> {
    let Some(callback_state) = payload.state.as_deref() else {
        return Ok(());
    };
    let owner_window_label = {
        let dropbox_state = app_handle.state::<DropboxState>();
        let mut oauth_sessions = dropbox_state
            .oauth_sessions
            .lock()
            .map_err(|_| "failed to lock Dropbox OAuth session".to_string())?;
        let Some(session) = oauth_sessions.get(callback_state) else {
            return Ok(());
        };
        if !dropbox_oauth_callback_matches_session(session, &payload) {
            return Ok(());
        }

        let owner_window_label = session.owner_window_label.clone();
        if dropbox_oauth_callback_ends_session(&payload) {
            oauth_sessions.remove(callback_state);
        }
        owner_window_label
    };

    app_handle
        .emit_to(
            owner_window_label,
            "scholium-dropbox-oauth-callback",
            payload,
        )
        .map_err(|error| format!("failed to emit Dropbox OAuth callback: {error}"))
}

#[cfg(mobile)]
fn is_dropbox_mobile_callback(url: &Url) -> bool {
    url.scheme() == DROPBOX_MOBILE_URL_SCHEME
        && url.host_str() == Some("2")
        && url.path() == "/token"
}

#[cfg(not(mobile))]
fn write_dropbox_oauth_http_response(
    stream: &mut std::net::TcpStream,
    ok: bool,
) -> std::io::Result<()> {
    let body = if ok {
        "<!doctype html><html><body><h1>Dropbox authorization received.</h1><p>You can return to Scholium.</p></body></html>"
    } else {
        "<!doctype html><html><body><h1>Dropbox authorization failed.</h1><p>You can return to Scholium.</p></body></html>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );

    stream.write_all(response.as_bytes())
}

#[cfg(not(mobile))]
fn wait_for_dropbox_oauth_callback(
    listener: TcpListener,
    expected_state: String,
) -> DropboxOAuthCallbackPayload {
    if let Err(error) = listener.set_nonblocking(true) {
        return dropbox_oauth_callback_payload(
            format!("failed to prepare Dropbox callback listener: {error}"),
            Some(expected_state),
        );
    }

    let deadline = Instant::now() + Duration::from_secs(180);

    loop {
        match listener.accept() {
            Ok((mut stream, _address)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buffer = [0u8; 4096];
                let read_bytes = match stream.read(&mut buffer) {
                    Ok(read_bytes) => read_bytes,
                    Err(error) => {
                        let _ = write_dropbox_oauth_http_response(&mut stream, false);
                        return dropbox_oauth_callback_payload(
                            format!("failed to read Dropbox callback: {error}"),
                            Some(expected_state),
                        );
                    }
                };
                let request = String::from_utf8_lossy(&buffer[..read_bytes]);
                let request_target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1));
                let Some(request_target) = request_target else {
                    let _ = write_dropbox_oauth_http_response(&mut stream, false);
                    continue;
                };
                let Ok(url) = Url::parse(&format!("http://127.0.0.1{request_target}")) else {
                    let _ = write_dropbox_oauth_http_response(&mut stream, false);
                    continue;
                };
                let payload = dropbox_oauth_callback_from_url(&url);
                if payload.state.as_deref() != Some(expected_state.as_str()) {
                    let _ = write_dropbox_oauth_http_response(&mut stream, false);
                    continue;
                }
                let is_success = payload.status == "success";
                let _ = write_dropbox_oauth_http_response(&mut stream, is_success);
                return payload;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return dropbox_oauth_callback_payload(
                        "Dropbox authorization timed out".to_string(),
                        Some(expected_state),
                    );
                }

                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return dropbox_oauth_callback_payload(
                    format!("failed to accept Dropbox callback: {error}"),
                    Some(expected_state),
                );
            }
        }
    }
}

async fn dropbox_response_error(response: reqwest::Response, context: &str) -> String {
    let status = response.status();
    let raw_body = response.text().await.unwrap_or_default();
    dropbox_error_message(status, &raw_body, context)
}

fn dropbox_error_message(status: reqwest::StatusCode, raw_body: &str, context: &str) -> String {
    if raw_body.contains("missing_scope") || raw_body.contains("insufficient_scope") {
        return format!(
            "{context}: Dropbox permission is missing. Reauthorize Dropbox in Settings."
        );
    }

    if let Ok(parsed) = serde_json::from_str::<DropboxErrorResponse>(raw_body) {
        if let Some(description) = parsed.error_description {
            return format!("{context}: {description}");
        }
        if let Some(summary) = parsed.error_summary {
            return format!("{context}: {summary}");
        }
        if let Some(error) = parsed.error {
            return format!("{context}: {error}");
        }
    }

    if raw_body.trim().is_empty() {
        format!("{context}: Dropbox returned HTTP {status}")
    } else {
        format!("{context}: Dropbox returned HTTP {status}: {raw_body}")
    }
}

fn dropbox_error_is_not_found(status: reqwest::StatusCode, raw_body: &str) -> bool {
    status == StatusCode::CONFLICT && raw_body.contains("not_found")
}

async fn parse_dropbox_token_response(
    response: reqwest::Response,
    context: &str,
) -> Result<DropboxTokenResponse, String> {
    let status = response.status();
    let raw_body = response
        .text()
        .await
        .map_err(|error| format!("{context}: failed to read Dropbox token response: {error}"))?;
    if !status.is_success() {
        return Err(dropbox_error_message(status, &raw_body, context));
    }

    serde_json::from_str::<DropboxTokenResponse>(&raw_body).map_err(|error| {
        if let Ok(parsed) = serde_json::from_str::<DropboxErrorResponse>(&raw_body) {
            if let Some(description) = parsed.error_description {
                return format!("{context}: {description}");
            }
            if let Some(summary) = parsed.error_summary {
                return format!("{context}: {summary}");
            }
            if let Some(error_value) = parsed.error {
                return format!("{context}: {error_value}");
            }
        }

        format!("{context}: failed to parse Dropbox token response: {error}")
    })
}

fn tokens_expire_soon(tokens: &DropboxTokenStore) -> bool {
    tokens
        .expires_at
        .map(|expires_at| expires_at <= now_unix_seconds() + 90)
        .unwrap_or(false)
}

fn dropbox_token_refresh_retry_delay(failed_attempt: usize) -> Option<Duration> {
    (failed_attempt < DROPBOX_TOKEN_REFRESH_ATTEMPTS)
        .then(|| DROPBOX_TOKEN_REFRESH_RETRY_DELAY * failed_attempt as u32)
}

async fn refresh_dropbox_access_token(
    app_handle: &tauri::AppHandle,
    snapshot: DropboxTokenSnapshot,
) -> Result<DropboxTokenStore, String> {
    let refresh_token = snapshot
        .tokens
        .refresh_token
        .clone()
        .ok_or_else(|| "Dropbox session expired; reconnect Dropbox.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("failed to prepare Dropbox token refresh: {error}"))?;
    let form_body = urlencoded_form_body(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", snapshot.tokens.app_key.as_str()),
    ]);
    let mut failed_attempt = 0;
    let response = loop {
        failed_attempt += 1;
        match client
            .post(DROPBOX_OAUTH_TOKEN_URL)
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=utf-8",
            )
            .body(form_body.clone())
            .send()
            .await
        {
            Ok(response) => break response,
            Err(error) => {
                let Some(delay) = dropbox_token_refresh_retry_delay(failed_attempt) else {
                    return Err(format!("failed to refresh Dropbox token: {error}"));
                };
                tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay))
                    .await
                    .map_err(|wait_error| {
                        format!(
                            "failed to wait before retrying Dropbox token refresh: {wait_error}"
                        )
                    })?;
            }
        }
    };

    let token_response =
        parse_dropbox_token_response(response, "failed to refresh Dropbox token").await?;
    let refreshed_tokens = DropboxTokenStore {
        app_key: snapshot.tokens.app_key.clone(),
        access_token: token_response.access_token,
        refresh_token: token_response
            .refresh_token
            .or_else(|| snapshot.tokens.refresh_token.clone()),
        expires_at: token_response
            .expires_in
            .map(|expires_in| now_unix_seconds() + expires_in),
    };

    commit_dropbox_token_refresh(app_handle, &snapshot, refreshed_tokens)
}

async fn dropbox_access_token(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let snapshot = dropbox_token_snapshot(app_handle)?
        .ok_or_else(|| "Dropbox is not connected.".to_string())?;
    let tokens = if tokens_expire_soon(&snapshot.tokens) {
        refresh_dropbox_access_token(app_handle, snapshot).await?
    } else {
        snapshot.tokens
    };

    Ok(tokens.access_token)
}

fn normalize_dropbox_path(path: &str) -> String {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() || trimmed_path == "/" {
        return String::new();
    }

    if trimmed_path.starts_with('/') {
        trimmed_path.to_string()
    } else {
        format!("/{trimmed_path}")
    }
}

fn dropbox_parent_path(path: &str) -> Option<String> {
    let normalized_path = normalize_dropbox_path(path);
    if normalized_path.is_empty() {
        return None;
    }

    let trimmed_path = normalized_path.trim_matches('/');
    let Some((parent, _name)) = trimmed_path.rsplit_once('/') else {
        return Some(String::new());
    };

    Some(format!("/{parent}"))
}

fn dropbox_path_title(path: &str) -> String {
    let normalized_path = normalize_dropbox_path(path);
    if normalized_path.is_empty() {
        return "Dropbox".to_string();
    }

    normalized_path
        .trim_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("Dropbox")
        .to_string()
}

fn dropbox_metadata_path(
    path_display: Option<String>,
    path_lower: Option<String>,
    name: &str,
) -> String {
    path_display
        .or(path_lower)
        .unwrap_or_else(|| format!("/{name}"))
}

fn dropbox_entry_sort_key(entry: &DropboxDirectoryEntry) -> (u8, String, String) {
    let kind_order = if entry.kind == "directory" { 0 } else { 1 };

    (
        kind_order,
        entry.title.to_lowercase(),
        entry.path.to_lowercase(),
    )
}

fn normalized_markdown_file_name(file_name: &str) -> Result<String, String> {
    let mut target_file_name = validate_markdown_file_name(file_name)?;
    if !is_markdown_path(&target_file_name) {
        target_file_name.set_extension("md");
    }

    target_file_name
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| "duplicate file name is empty".to_string())
}

fn dropbox_child_path(parent_path: &str, file_name: &str) -> String {
    let normalized_parent_path = normalize_dropbox_path(parent_path);
    if normalized_parent_path.is_empty() {
        format!("/{file_name}")
    } else {
        format!(
            "{}/{}",
            normalized_parent_path.trim_end_matches('/'),
            file_name
        )
    }
}

fn dropbox_file_from_write_metadata(
    app: &tauri::AppHandle,
    metadata: DropboxWriteMetadata,
    fallback_body: String,
    fallback_path: String,
) -> Result<DropboxMarkdownFile, String> {
    let path = dropbox_metadata_path(metadata.path_display, metadata.path_lower, &metadata.name);
    let normalized_path = normalize_dropbox_path(&path);
    let path = if normalized_path.is_empty() {
        fallback_path
    } else {
        normalized_path
    };

    dropbox_file_with_notes(
        app,
        path,
        document_title(Path::new(&metadata.name)),
        fallback_body,
        metadata.rev,
        metadata.server_modified,
    )
}

fn dropbox_file_with_notes(
    app: &tauri::AppHandle,
    path: String,
    title: String,
    body: String,
    rev: Option<String>,
    server_modified: Option<String>,
) -> Result<DropboxMarkdownFile, String> {
    let notes_markdown_path = dropbox_notes_markdown_path(&path);
    let (notes_path, notes, glossary_terms, glossary_bindings) =
        read_document_notes(app, &notes_markdown_path, false)?;

    Ok(DropboxMarkdownFile {
        path,
        notes_path,
        title,
        body,
        notes,
        glossary_terms,
        glossary_bindings,
        rev,
        server_modified,
    })
}

async fn download_dropbox_notes_file(
    app: &tauri::AppHandle,
    dropbox_path: &str,
) -> Result<Option<NotesFile>, String> {
    let notes_sidecar_path = dropbox_notes_sidecar_path(dropbox_path);
    let access_token = dropbox_access_token(app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_DOWNLOAD_URL)
        .bearer_auth(access_token)
        .header(
            "Dropbox-API-Arg",
            serde_json::json!({ "path": notes_sidecar_path }).to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("failed to download Dropbox notes file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }

    let status = response.status();
    if !status.is_success() {
        let raw_body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("failed to read Dropbox error response: {error}"));
        if dropbox_error_is_not_found(status, &raw_body) {
            return Ok(None);
        }

        return Err(dropbox_error_message(
            status,
            &raw_body,
            "failed to download Dropbox notes file",
        ));
    }

    let raw_notes = response
        .text()
        .await
        .map_err(|error| format!("failed to read Dropbox notes file: {error}"))?;
    let notes_file = serde_json::from_str::<NotesFile>(&raw_notes)
        .map_err(|error| format!("failed to parse Dropbox notes file: {error}"))?;
    let notes_markdown_path = dropbox_notes_markdown_path(dropbox_path);

    write_notes_file(app, &notes_markdown_path, notes_file.clone())?;

    Ok(Some(notes_file))
}

async fn read_dropbox_document_notes(
    app: &tauri::AppHandle,
    dropbox_path: &str,
) -> Result<DocumentNotes, String> {
    if let Some(notes_file) = download_dropbox_notes_file(app, dropbox_path).await? {
        let notes_markdown_path = dropbox_notes_markdown_path(dropbox_path);
        let notes_path = notes_store_path(app, &notes_markdown_path)?;
        let (notes, glossary_terms, glossary_bindings) = visible_notes_from_file(notes_file);

        return Ok((
            notes_path.to_string_lossy().to_string(),
            notes,
            glossary_terms,
            glossary_bindings,
        ));
    }

    let notes_markdown_path = dropbox_notes_markdown_path(dropbox_path);
    if let Some(notes_file) = read_notes_file(app, &notes_markdown_path)? {
        let notes_path = notes_store_path(app, &notes_markdown_path)?;
        if !notes_file_is_empty(&notes_file) {
            upload_dropbox_notes_file(app, dropbox_path, notes_file.clone()).await?;
        }
        let (notes, glossary_terms, glossary_bindings) = visible_notes_from_file(notes_file);

        return Ok((
            notes_path.to_string_lossy().to_string(),
            notes,
            glossary_terms,
            glossary_bindings,
        ));
    }

    read_document_notes(app, &notes_markdown_path, false)
}

async fn dropbox_file_with_remote_notes(
    app: &tauri::AppHandle,
    path: String,
    title: String,
    body: String,
    rev: Option<String>,
    server_modified: Option<String>,
) -> Result<DropboxMarkdownFile, String> {
    let (notes_path, notes, glossary_terms, glossary_bindings) =
        read_dropbox_document_notes(app, &path).await?;

    Ok(DropboxMarkdownFile {
        path,
        notes_path,
        title,
        body,
        notes,
        glossary_terms,
        glossary_bindings,
        rev,
        server_modified,
    })
}

async fn upload_dropbox_notes_file(
    app: &tauri::AppHandle,
    dropbox_path: &str,
    notes_file: NotesFile,
) -> Result<(), String> {
    let notes_sidecar_path = dropbox_notes_sidecar_path(dropbox_path);
    let serialized = serde_json::to_string_pretty(&notes_file)
        .map_err(|error| format!("failed to serialize Dropbox notes: {error}"))?;
    let access_token = dropbox_access_token(app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_UPLOAD_URL)
        .bearer_auth(access_token)
        .header("Content-Type", "application/octet-stream")
        .header(
            "Dropbox-API-Arg",
            serde_json::json!({
                "path": notes_sidecar_path,
                "mode": "overwrite",
                "autorename": false,
                "mute": false,
                "strict_conflict": false
            })
            .to_string(),
        )
        .body(serialized)
        .send()
        .await
        .map_err(|error| format!("failed to upload Dropbox notes file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to upload Dropbox notes file").await);
    }

    Ok(())
}

async fn sync_dropbox_notes_file(
    app: &tauri::AppHandle,
    dropbox_path: &str,
    notes_file: NotesFile,
) -> Result<(), String> {
    // Local Dropbox folders sync the sidecar back to disk, so an empty one is removed instead.
    if notes_file_is_empty(&notes_file) {
        delete_dropbox_notes_file(app, dropbox_path).await
    } else {
        upload_dropbox_notes_file(app, dropbox_path, notes_file).await
    }
}

async fn delete_dropbox_notes_file(
    app: &tauri::AppHandle,
    dropbox_path: &str,
) -> Result<(), String> {
    let notes_sidecar_path = dropbox_notes_sidecar_path(dropbox_path);
    let access_token = dropbox_access_token(app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_DELETE_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "path": notes_sidecar_path }))
        .send()
        .await
        .map_err(|error| format!("failed to delete Dropbox notes file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }

    let status = response.status();
    if !status.is_success() {
        let raw_body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("failed to read Dropbox error response: {error}"));
        if dropbox_error_is_not_found(status, &raw_body) {
            return Ok(());
        }

        return Err(dropbox_error_message(
            status,
            &raw_body,
            "failed to delete Dropbox notes file",
        ));
    }

    Ok(())
}

async fn upload_dropbox_markdown_file(
    app: &tauri::AppHandle,
    path: String,
    body: String,
    mode: serde_json::Value,
) -> Result<DropboxMarkdownFile, String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&normalized_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let access_token = dropbox_access_token(app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_UPLOAD_URL)
        .bearer_auth(access_token)
        .header("Content-Type", "application/octet-stream")
        .header(
            "Dropbox-API-Arg",
            serde_json::json!({
                "path": normalized_path,
                "mode": mode,
                "autorename": false,
                "mute": false,
                "strict_conflict": true
            })
            .to_string(),
        )
        .body(body.clone())
        .send()
        .await
        .map_err(|error| format!("failed to upload Dropbox Markdown file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to upload Dropbox Markdown file").await,
        );
    }

    let metadata = response
        .json::<DropboxWriteMetadata>()
        .await
        .map_err(|error| format!("failed to parse Dropbox upload response: {error}"))?;

    dropbox_file_from_write_metadata(app, metadata, body, normalized_path)
}

async fn read_dropbox_list_page_with_recursive(
    client: &reqwest::Client,
    access_token: &str,
    path: &str,
    recursive: bool,
) -> Result<DropboxListFolderResponse, String> {
    let response = client
        .post(DROPBOX_LIST_FOLDER_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "path": path,
            "recursive": recursive,
            "include_media_info": false,
            "include_deleted": false,
            "include_has_explicit_shared_members": false,
            "include_mounted_folders": true,
            "include_non_downloadable_files": true
        }))
        .send()
        .await
        .map_err(|error| format!("failed to list Dropbox folder: {error}"))?;

    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to list Dropbox folder").await);
    }

    response
        .json::<DropboxListFolderResponse>()
        .await
        .map_err(|error| format!("failed to parse Dropbox folder response: {error}"))
}

async fn read_dropbox_list_page(
    client: &reqwest::Client,
    access_token: &str,
    path: &str,
) -> Result<DropboxListFolderResponse, String> {
    read_dropbox_list_page_with_recursive(client, access_token, path, false).await
}

async fn read_dropbox_list_continue_page(
    client: &reqwest::Client,
    access_token: &str,
    cursor: &str,
) -> Result<DropboxListFolderResponse, String> {
    let response = client
        .post(DROPBOX_LIST_FOLDER_CONTINUE_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "cursor": cursor }))
        .send()
        .await
        .map_err(|error| format!("failed to continue Dropbox folder listing: {error}"))?;

    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to continue Dropbox folder listing").await,
        );
    }

    response
        .json::<DropboxListFolderResponse>()
        .await
        .map_err(|error| format!("failed to parse Dropbox folder response: {error}"))
}

fn current_app_language(app_handle: &tauri::AppHandle) -> String {
    app_handle
        .state::<LocationMenuState>()
        .language
        .lock()
        .map(|language| normalize_app_language(language.as_str()).to_string())
        .unwrap_or_else(|_| DEFAULT_APP_LANGUAGE.to_string())
}

fn menu_text(language: &str, key: &str) -> &'static str {
    match (normalize_app_language(language), key) {
        ("en", "directoryFallback") => "Folder",
        ("en", "markdownFileFallback") => "Markdown file",
        ("en", "favoriteDirectories") => "Favorite Folders",
        ("en", "addCurrentDirectory") => "Add Current Folder",
        ("en", "noFavoriteDirectories") => "No favorite folders",
        ("en", "clearFavoriteDirectories") => "Clear Favorite Folders",
        ("en", "recentLocations") => "Recent",
        ("en", "noRecentLocations") => "No recent items",
        ("en", "clearItems") => "Clear Items",
        ("en", "newWindow") => "New Window",
        ("en", "newFile") => "New File",
        ("en", "newFolder") => "New Folder",
        ("en", "openFile") => "Open File",
        ("en", "openFolder") => "Open Folder",
        ("en", "openPath") => "Go to Path...",
        ("en", "cloud") => "Cloud",
        ("en", "dropbox") => "Dropbox",
        ("en", "settings") => "Settings...",
        ("en", "fileMenu") => "File",
        ("en", "editMenu") => "Edit",
        ("en", "selectAll") => "Select All",
        ("en", "viewMenu") => "View",
        ("en", "windowMenu") => "Window",
        ("en", "helpMenu") => "Help",
        ("en", "quit") => "Quit Scholium",
        ("zh-Hans", "directoryFallback") => "文件夹",
        ("zh-Hans", "markdownFileFallback") => "Markdown 文件",
        ("zh-Hans", "favoriteDirectories") => "收藏的文件夹",
        ("zh-Hans", "addCurrentDirectory") => "收藏当前文件夹",
        ("zh-Hans", "noFavoriteDirectories") => "尚未收藏文件夹",
        ("zh-Hans", "clearFavoriteDirectories") => "清除收藏的文件夹",
        ("zh-Hans", "recentLocations") => "最近打开",
        ("zh-Hans", "noRecentLocations") => "尚无最近打开项目",
        ("zh-Hans", "clearItems") => "清除项目",
        ("zh-Hans", "newWindow") => "新建窗口",
        ("zh-Hans", "newFile") => "新建文件",
        ("zh-Hans", "newFolder") => "新建文件夹",
        ("zh-Hans", "openFile") => "打开文件",
        ("zh-Hans", "openFolder") => "打开文件夹",
        ("zh-Hans", "openPath") => "前往路径...",
        ("zh-Hans", "cloud") => "云端",
        ("zh-Hans", "dropbox") => "Dropbox",
        ("zh-Hans", "settings") => "设置...",
        ("zh-Hans", "fileMenu") => "文件",
        ("zh-Hans", "editMenu") => "编辑",
        ("zh-Hans", "selectAll") => "全选",
        ("zh-Hans", "viewMenu") => "视图",
        ("zh-Hans", "windowMenu") => "窗口",
        ("zh-Hans", "helpMenu") => "帮助",
        ("zh-Hans", "quit") => "退出 Scholium",
        (_, "directoryFallback") => "資料夾",
        (_, "markdownFileFallback") => "Markdown 檔案",
        (_, "favoriteDirectories") => "常用資料夾",
        (_, "addCurrentDirectory") => "加入目前資料夾",
        (_, "noFavoriteDirectories") => "尚未加入常用資料夾",
        (_, "clearFavoriteDirectories") => "清除常用資料夾",
        (_, "recentLocations") => "最近開啟",
        (_, "noRecentLocations") => "尚無最近開啟項目",
        (_, "clearItems") => "清除項目",
        (_, "newWindow") => "新增視窗",
        (_, "newFile") => "新增檔案",
        (_, "newFolder") => "新增資料夾",
        (_, "openFile") => "開啟檔案",
        (_, "openFolder") => "開啟資料夾",
        (_, "openPath") => "前往路徑...",
        (_, "cloud") => "雲端",
        (_, "dropbox") => "Dropbox",
        (_, "settings") => "設定...",
        (_, "fileMenu") => "檔案",
        (_, "editMenu") => "編輯",
        (_, "selectAll") => "全選",
        (_, "viewMenu") => "檢視",
        (_, "windowMenu") => "視窗",
        (_, "helpMenu") => "說明",
        (_, "quit") => "結束 Scholium",
        _ => "",
    }
}

/// Closes windows through their close request so each window can ask about unnamed new files.
#[cfg(desktop)]
fn request_close_all_windows(app_handle: &tauri::AppHandle) {
    for window in app_handle.webview_windows().values() {
        if let Err(error) = window.close() {
            eprintln!("failed to request window close: {error}");
        }
    }
}

#[cfg(desktop)]
fn next_scholium_window_label(app_handle: &tauri::AppHandle) -> String {
    loop {
        let sequence = NEW_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let label = format!("scholium-window-{sequence}");

        if app_handle.get_webview_window(&label).is_none() {
            return label;
        }
    }
}

#[cfg(desktop)]
fn create_new_scholium_window(
    app_handle: &tauri::AppHandle,
    start_fullscreen: bool,
    document_target: Option<LocationEntry>,
) -> Result<String, String> {
    let label = next_scholium_window_label(app_handle);
    let mut window_config = app_handle
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing base window configuration".to_string())?;

    window_config.label = label.clone();
    window_config.url = tauri::WebviewUrl::App("index.html?scholium-window=secondary".into());
    window_config.fullscreen = start_fullscreen;
    window_config.focus = true;

    let window_builder = tauri::WebviewWindowBuilder::from_config(app_handle, &window_config)
        .map_err(|error| format!("failed to prepare new window: {error}"))?;

    if let Some(target) = document_target {
        app_handle
            .state::<NewWindowDocumentTargetState>()
            .0
            .lock()
            .map_err(|_| "failed to lock new-window document target state".to_string())?
            .insert(label.clone(), target);
    }

    let window = window_builder.build().map_err(|error| {
        if let Ok(mut targets) = app_handle.state::<NewWindowDocumentTargetState>().0.lock() {
            targets.remove(&label);
        }
        format!("failed to create new window: {error}")
    })?;

    window
        .set_focus()
        .map_err(|error| format!("failed to focus new window: {error}"))?;

    Ok(label)
}

#[cfg(desktop)]
fn target_window_is_fullscreen(app_handle: &tauri::AppHandle) -> bool {
    target_webview_window_label(app_handle)
        .and_then(|label| app_handle.get_webview_window(&label))
        .and_then(|window| window.is_fullscreen().ok())
        .unwrap_or(false)
}

#[cfg(desktop)]
fn target_webview_window_label(app_handle: &tauri::AppHandle) -> Option<String> {
    let webview_windows = app_handle.webview_windows();

    let focused_label =
        webview_windows
            .iter()
            .find_map(|(label, window)| match window.is_focused() {
                Ok(true) => Some(label.clone()),
                _ => None,
            });

    if let Some(label) = focused_label {
        if let Ok(mut last_focused_label) = app_handle.state::<FocusedWindowState>().0.lock() {
            *last_focused_label = Some(label.clone());
        }
        return Some(label);
    }

    let last_focused_label = app_handle
        .state::<FocusedWindowState>()
        .0
        .lock()
        .ok()
        .and_then(|label| label.clone())
        .filter(|label| webview_windows.contains_key(label));

    last_focused_label.or_else(|| webview_windows.keys().next().cloned())
}

#[cfg(desktop)]
fn emit_to_target_webview_window<S>(
    app_handle: &tauri::AppHandle,
    event: &str,
    payload: S,
) -> Result<(), String>
where
    S: Serialize + Clone,
{
    let Some(label) = target_webview_window_label(app_handle) else {
        return Ok(());
    };

    app_handle
        .emit_to(label, event, payload)
        .map_err(|error| format!("failed to emit menu event: {error}"))
}

#[cfg(desktop)]
fn current_directory_for_target_window(app_handle: &tauri::AppHandle) -> Option<LocationEntry> {
    let target_label = target_webview_window_label(app_handle);
    let state = app_handle.state::<LocationMenuState>();
    let current_directories = state.current_directories.lock().ok()?;

    if let Some(label) = target_label {
        return current_directories.get(&label).cloned();
    }

    current_directories.values().next().cloned()
}

fn sanitize_location_entry(
    kind: &str,
    path: String,
    title: String,
    source: String,
    language: &str,
) -> Result<LocationEntry, String> {
    if kind != "directory" && kind != "file" {
        return Err("unsupported location kind".to_string());
    }

    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("location path is empty".to_string());
    }
    let normalized_source = match source.trim() {
        "" | "local" => "local",
        "dropbox" => "dropbox",
        _ => return Err("unsupported location source".to_string()),
    };

    let fallback_title = if kind == "directory" {
        location_title(
            Path::new(trimmed_path),
            menu_text(language, "directoryFallback"),
        )
    } else {
        location_title(
            Path::new(trimmed_path),
            menu_text(language, "markdownFileFallback"),
        )
    };
    let trimmed_title = title.trim();

    Ok(LocationEntry {
        kind: kind.to_string(),
        path: trimmed_path.to_string(),
        title: if trimmed_title.is_empty() {
            fallback_title
        } else {
            trimmed_title.to_string()
        },
        source: normalized_source.to_string(),
    })
}

fn location_store_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(app_data_dir.join("locations.json"))
}

fn read_location_store_from_disk(app_handle: &tauri::AppHandle) -> LocationStore {
    let Ok(store_path) = location_store_path(app_handle) else {
        return LocationStore::default();
    };
    let Ok(Some(raw_store)) = read_private_file_to_string(&store_path) else {
        return LocationStore::default();
    };

    serde_json::from_str(&raw_store).unwrap_or_default()
}

fn current_location_store(app_handle: &tauri::AppHandle) -> LocationStore {
    app_handle
        .state::<LocationMenuState>()
        .store
        .lock()
        .map(|store| store.clone())
        .unwrap_or_default()
}

fn replace_current_location_store(
    app_handle: &tauri::AppHandle,
    store: LocationStore,
) -> Result<(), String> {
    let state = app_handle.state::<LocationMenuState>();
    let mut current_store = state
        .store
        .lock()
        .map_err(|_| "failed to lock location store".to_string())?;

    *current_store = store;
    Ok(())
}

fn write_location_store(
    app_handle: &tauri::AppHandle,
    store: &LocationStore,
) -> Result<(), String> {
    let store_path = location_store_path(app_handle)?;
    let serialized = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize location store: {error}"))?;

    atomic_replace_private_file(&store_path, serialized.as_bytes())
        .map_err(|error| format!("failed to write location store: {error}"))
}

fn recent_location_exists(location: &LocationEntry) -> bool {
    if location.source == "dropbox" {
        return true;
    }

    let path = Path::new(&location.path);

    match location.kind.as_str() {
        "file" => path.is_file(),
        "directory" => path.is_dir(),
        _ => false,
    }
}

fn prune_missing_recent_locations(store: &mut LocationStore) -> bool {
    let original_count = store.recent.len();

    store.recent.retain(recent_location_exists);

    store.recent.len() != original_count
}

fn remember_recent_location_entry(
    app_handle: &tauri::AppHandle,
    entry: LocationEntry,
) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store.recent.retain(|location| {
        location.source != entry.source
            || location.kind != entry.kind
            || location.path != entry.path
    });
    store.recent.insert(0, entry);
    store.recent.truncate(MAX_RECENT_LOCATIONS);

    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

#[cfg(desktop)]
fn remember_favorite_directory_entry(
    app_handle: &tauri::AppHandle,
    entry: LocationEntry,
) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store
        .favorite_directories
        .retain(|location| location.source != entry.source || location.path != entry.path);
    store.favorite_directories.insert(0, entry);

    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

#[cfg(desktop)]
fn clear_recent_locations(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store.recent.clear();
    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

#[cfg(desktop)]
fn clear_favorite_directories(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store.favorite_directories.clear();
    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

#[cfg(desktop)]
fn location_menu_label(location: &LocationEntry) -> String {
    let path = Path::new(&location.path);
    let parent = path
        .parent()
        .and_then(|parent| parent.to_str())
        .filter(|parent| !parent.is_empty());

    let location_detail = match (location.source.as_str(), parent) {
        ("dropbox", Some(parent)) => format!("Dropbox {parent}"),
        ("dropbox", None) => "Dropbox".to_string(),
        (_, Some(parent)) => parent.to_string(),
        _ => String::new(),
    };

    if location_detail.is_empty() {
        location.title.clone()
    } else {
        format!("{} — {}", location.title, location_detail)
    }
}

#[cfg(desktop)]
fn indexed_location<'a>(
    locations: &'a [LocationEntry],
    event_id: &str,
    prefix: &str,
) -> Option<&'a LocationEntry> {
    let index = event_id.strip_prefix(prefix)?.parse::<usize>().ok()?;

    locations.get(index)
}

fn is_hidden_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn modified_time_millis(path: &Path) -> Option<i64> {
    path.metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
}

fn entry_kind_order(kind: &str) -> u8 {
    if kind == "directory" {
        0
    } else {
        1
    }
}

fn entry_sort_key(entry: &OpenDirectoryEntry) -> (String, String) {
    (entry.title.to_lowercase(), entry.path.to_lowercase())
}

fn compare_directory_entries(
    left: &OpenDirectoryEntry,
    right: &OpenDirectoryEntry,
) -> std::cmp::Ordering {
    entry_kind_order(&left.kind)
        .cmp(&entry_kind_order(&right.kind))
        .then_with(|| {
            right
                .modified_at
                .unwrap_or(i64::MIN)
                .cmp(&left.modified_at.unwrap_or(i64::MIN))
        })
        .then_with(|| entry_sort_key(left).cmp(&entry_sort_key(right)))
}

fn compare_dropbox_entries(
    left: &DropboxDirectoryEntry,
    right: &DropboxDirectoryEntry,
) -> std::cmp::Ordering {
    entry_kind_order(&left.kind)
        .cmp(&entry_kind_order(&right.kind))
        .then_with(|| right.server_modified.cmp(&left.server_modified))
        .then_with(|| dropbox_entry_sort_key(left).cmp(&dropbox_entry_sort_key(right)))
}

fn file_search_matches(path: &Path, root: &Path, query: &str) -> bool {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let searchable_text =
        format!("{} {} {}", document_title(path), file_name, relative_path).to_lowercase();

    query
        .split_whitespace()
        .all(|term| searchable_text.contains(term))
}

fn matching_markdown_tags(
    _guard: &LocalDocumentGuard,
    path: &Path,
    query: &str,
    exact: bool,
) -> Vec<String> {
    let Ok(markdown) = fs::read_to_string(path) else {
        return Vec::new();
    };
    markdown_tags(&markdown)
        .into_iter()
        .filter(|tag| {
            let key = normalize_tag_search_value(tag);
            if exact {
                key == query
            } else {
                key.contains(query)
            }
        })
        .collect()
}

fn search_markdown_directory(
    root: &Path,
    directory: &Path,
    query: &str,
    tag_guard: Option<&LocalDocumentGuard>,
    exact_tag: bool,
    results: &mut Vec<SearchMarkdownFile>,
) -> Result<(), String> {
    if results.len() >= MAX_FILE_SEARCH_RESULTS {
        return Ok(());
    }

    let mut child_paths = Vec::new();

    for entry in fs::read_dir(directory)
        .map_err(|error| format!("failed to read Markdown directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();

        if is_hidden_path(&path) {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to read directory entry type: {error}"))?;

        if file_type.is_dir() {
            child_paths.push(path);
            continue;
        }

        if !file_type.is_file() || !is_markdown_path(&path) {
            continue;
        }

        let matched_tags = if let Some(guard) = tag_guard {
            let matched_tags = matching_markdown_tags(guard, &path, query, exact_tag);
            if matched_tags.is_empty() {
                continue;
            }
            matched_tags
        } else {
            if !file_search_matches(&path, root, query) {
                continue;
            }
            Vec::new()
        };

        results.push(SearchMarkdownFile {
            path: path.to_string_lossy().to_string(),
            parent_path: path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string()),
            title: document_title(&path),
            relative_path: path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/"),
            matched_tags,
        });

        if results.len() >= MAX_FILE_SEARCH_RESULTS {
            return Ok(());
        }
    }

    child_paths.sort_by_key(|path| path.to_string_lossy().to_lowercase());

    for child_path in child_paths {
        search_markdown_directory(root, &child_path, query, tag_guard, exact_tag, results)?;
        if results.len() >= MAX_FILE_SEARCH_RESULTS {
            return Ok(());
        }
    }

    Ok(())
}

fn read_markdown_directory(
    app: &AppHandle,
    directory: PathBuf,
) -> Result<OpenMarkdownDirectory, String> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("failed to read Markdown directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();

        if is_hidden_path(&path) {
            continue;
        }

        if path.is_dir() {
            entries.push(OpenDirectoryEntry {
                kind: "directory".to_string(),
                title: directory_title(&path),
                path: path.to_string_lossy().to_string(),
                modified_at: modified_time_millis(&path),
                file: None,
            });
        } else if is_markdown_path(&path) {
            entries.push(OpenDirectoryEntry {
                kind: "file".to_string(),
                title: document_title(&path),
                path: path.to_string_lossy().to_string(),
                modified_at: modified_time_millis(&path),
                file: Some(read_markdown_file(app, path)?),
            });
        }
    }

    entries.sort_by(compare_directory_entries);

    Ok(OpenMarkdownDirectory {
        title: directory_title(&directory),
        path: directory.to_string_lossy().to_string(),
        parent_path: directory
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .filter(|parent| !parent.is_empty()),
        entries,
    })
}

fn parse_optional_notes_file(
    notes_path: &Path,
    private: bool,
) -> Result<Option<NotesFile>, String> {
    let raw_notes = if private {
        read_private_file_to_string(notes_path)
    } else {
        read_regular_file_to_string(notes_path)
    }
    .map_err(|error| format!("failed to read notes: {error}"))?;
    let Some(raw_notes) = raw_notes else {
        return Ok(None);
    };

    serde_json::from_str(&raw_notes)
        .map(Some)
        .map_err(|error| format!("failed to parse notes: {error}"))
}

#[cfg(test)]
fn parse_notes_file(notes_path: &Path) -> Result<NotesFile, String> {
    parse_optional_notes_file(notes_path, false)?
        .ok_or_else(|| "failed to read notes: path is not a regular file".to_string())
}

fn notes_file_is_empty(notes_file: &NotesFile) -> bool {
    notes_file.notes.is_empty()
        && notes_file.glossary_terms.is_empty()
        && notes_file.glossary_bindings.is_empty()
}

fn random_sidecar_id(prefix: &str, used_ids: &mut HashSet<String>) -> Result<String, String> {
    for _ in 0..8 {
        let token = random_url_token(18)?;
        let id = format!("{prefix}-{token}");
        if used_ids.insert(id.clone()) {
            return Ok(id);
        }
    }

    Err("failed to generate unique sidecar id".to_string())
}

fn duplicate_notes_file_for_document(
    mut notes_file: NotesFile,
    target_document_id: &str,
) -> Result<NotesFile, String> {
    let mut used_ids = HashSet::new();
    let mut glossary_term_id_map = HashMap::new();
    let target_document_id = target_document_id.to_string();

    for note in notes_file.notes.iter() {
        used_ids.insert(note.id.clone());
    }
    for term in notes_file.glossary_terms.iter() {
        used_ids.insert(term.id.clone());
    }
    for binding in notes_file.glossary_bindings.iter() {
        used_ids.insert(binding.id.clone());
    }

    notes_file.markdown_path = target_document_id.clone();

    for term in notes_file.glossary_terms.iter_mut() {
        let source_id = term.id.clone();
        let copied_id = random_sidecar_id("glossary", &mut used_ids)?;

        term.id = copied_id.clone();
        glossary_term_id_map.insert(source_id, copied_id);
    }

    for note in notes_file.notes.iter_mut() {
        note.id = random_sidecar_id("note", &mut used_ids)?;
        note.document_id = target_document_id.clone();
    }

    for binding in notes_file.glossary_bindings.iter_mut() {
        let source_term_id = binding.term_id.clone();
        let copied_term_id = match glossary_term_id_map.get(&source_term_id) {
            Some(copied_id) => copied_id.clone(),
            None => {
                let copied_id = random_sidecar_id("glossary", &mut used_ids)?;
                glossary_term_id_map.insert(source_term_id, copied_id.clone());
                copied_id
            }
        };

        binding.id = random_sidecar_id("glossary-binding", &mut used_ids)?;
        binding.document_id = target_document_id.clone();
        binding.term_id = copied_term_id;
    }

    Ok(notes_file)
}

fn move_notes_file_for_document(mut notes_file: NotesFile, target_document_id: &str) -> NotesFile {
    let target_document_id = target_document_id.to_string();
    notes_file.markdown_path = target_document_id.clone();

    for note in notes_file.notes.iter_mut() {
        note.document_id = target_document_id.clone();
    }
    for binding in notes_file.glossary_bindings.iter_mut() {
        binding.document_id = target_document_id.clone();
    }

    notes_file
}

struct CapturedDocumentNotes {
    notes_path: PathBuf,
    legacy_notes_path: PathBuf,
    notes_file: NotesFile,
}

fn capture_document_notes(
    app: &AppHandle,
    source_path: &Path,
) -> Result<Option<CapturedDocumentNotes>, String> {
    let (notes_path, legacy_notes_path) = document_notes_paths(app, source_path)?;
    let notes_file = if let Some(notes_file) = parse_optional_notes_file(&notes_path, true)? {
        Some(notes_file)
    } else {
        parse_optional_notes_file(&legacy_notes_path, false)?
    };
    Ok(notes_file.map(|notes_file| CapturedDocumentNotes {
        notes_path,
        legacy_notes_path,
        notes_file,
    }))
}

fn move_captured_document_notes(
    app: &AppHandle,
    captured: CapturedDocumentNotes,
    target_path: &Path,
) -> Result<(), String> {
    let target_notes_path = notes_store_path(app, target_path)?;
    let target_legacy_notes_path = legacy_sidecar_path(target_path)?;
    move_captured_document_notes_at_paths(
        captured,
        target_path,
        target_notes_path,
        target_legacy_notes_path,
    )
}

fn move_captured_document_notes_at_paths(
    captured: CapturedDocumentNotes,
    target_path: &Path,
    target_notes_path: PathBuf,
    target_legacy_notes_path: PathBuf,
) -> Result<(), String> {
    let target_document_id = target_path.to_string_lossy().to_string();
    let notes_file = move_notes_file_for_document(captured.notes_file, &target_document_id);
    write_notes_file_at_paths(
        target_path,
        target_notes_path.clone(),
        target_legacy_notes_path.clone(),
        notes_file,
    )?;

    if captured.notes_path != target_notes_path {
        remove_file_if_present(&captured.notes_path)
            .map_err(|error| format!("failed to delete notes: {error}"))?;
    }
    if captured.legacy_notes_path != target_legacy_notes_path {
        remove_file_if_present(&captured.legacy_notes_path)
            .map_err(|error| format!("failed to delete legacy sidecar notes: {error}"))?;
    }

    Ok(())
}

fn read_notes_file(app: &AppHandle, markdown_path: &Path) -> Result<Option<NotesFile>, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    if let Some(notes_file) = parse_optional_notes_file(&notes_path, true)? {
        return Ok(Some(notes_file));
    }

    let legacy_notes_path = legacy_sidecar_path(markdown_path)?;
    parse_optional_notes_file(&legacy_notes_path, false)
}

fn write_notes_file(
    app: &AppHandle,
    markdown_path: &Path,
    notes_file: NotesFile,
) -> Result<PathBuf, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    let legacy_notes_path = legacy_sidecar_path(markdown_path)?;
    write_notes_file_at_paths(markdown_path, notes_path, legacy_notes_path, notes_file)
}

fn write_notes_file_at_paths(
    markdown_path: &Path,
    notes_path: PathBuf,
    legacy_notes_path: PathBuf,
    mut notes_file: NotesFile,
) -> Result<PathBuf, String> {
    if notes_file_is_empty(&notes_file) {
        let canonical_document_path = if local_path_uses_symlink(markdown_path)? {
            Some(resolved_local_document_path(markdown_path)?)
        } else {
            None
        };
        let canonical_legacy_notes_path = canonical_document_path
            .as_deref()
            .map(legacy_sidecar_path)
            .transpose()?
            .filter(|path| path != &legacy_notes_path);
        if path_is_local_dropbox_synced_path(markdown_path) {
            if let Some(canonical_document_path) = canonical_document_path {
                notes_file.markdown_path = canonical_document_path.to_string_lossy().to_string();
            }
            if let Some(parent) = notes_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("failed to create notes storage directory: {error}")
                })?;
            }
            let serialized = serde_json::to_string_pretty(&notes_file)
                .map_err(|error| format!("failed to serialize notes: {error}"))?;
            atomic_replace_private_file(&notes_path, serialized.as_bytes())
                .map_err(|error| format!("failed to write notes: {error}"))?;
        } else {
            remove_file_if_present(&notes_path)
                .map_err(|error| format!("failed to remove empty notes file: {error}"))?;
        }
        for sidecar_path in
            std::iter::once(&legacy_notes_path).chain(canonical_legacy_notes_path.as_ref())
        {
            remove_file_if_present(sidecar_path)
                .map_err(|error| format!("failed to remove legacy sidecar notes: {error}"))?;
        }
        return Ok(notes_path);
    }

    if let Some(parent) = notes_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create notes storage directory: {error}"))?;
    }

    let serialized = serde_json::to_string_pretty(&notes_file)
        .map_err(|error| format!("failed to serialize notes: {error}"))?;
    atomic_replace_private_file(&notes_path, serialized.as_bytes())
        .map_err(|error| format!("failed to write notes: {error}"))?;

    if path_is_local_dropbox_synced_path(markdown_path) {
        write_legacy_sidecar(&legacy_notes_path, &serialized)
            .map_err(|error| format!("failed to write Dropbox sidecar notes: {error}"))?;
    } else {
        remove_file_if_present(&legacy_notes_path)
            .map_err(|error| format!("failed to remove legacy sidecar notes: {error}"))?;
    }

    Ok(notes_path)
}

fn read_markdown_file_contents(
    app: &AppHandle,
    markdown_path: PathBuf,
    mirror_legacy_sidecar: bool,
) -> Result<OpenMarkdownFile, String> {
    let body = fs::read_to_string(&markdown_path)
        .map_err(|error| format!("failed to read Markdown file: {error}"))?;
    let (notes_path, notes, glossary_terms, glossary_bindings) =
        read_document_notes(app, &markdown_path, mirror_legacy_sidecar)?;

    Ok(OpenMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path,
        title: document_title(&markdown_path),
        modified_at: modified_time_millis(&markdown_path),
        body,
        notes,
        glossary_terms,
        glossary_bindings,
    })
}

fn read_markdown_file_locked(
    app: &AppHandle,
    markdown_path: PathBuf,
    guard: &LocalDocumentGuard,
) -> Result<OpenMarkdownFile, String> {
    let paths = recover_local_document_path(app, &markdown_path, guard)?;
    let recovery_directory = local_recovery_directory(app)?;
    repair_local_dropbox_sidecar_on_open(app, &markdown_path, &paths, &recovery_directory, guard)?;
    read_markdown_file_contents(app, markdown_path, false)
}

fn read_markdown_file(app: &AppHandle, markdown_path: PathBuf) -> Result<OpenMarkdownFile, String> {
    let (_, guard) = lock_local_document_store(app)?;
    let uses_legacy_symlink_path = local_path_uses_symlink(&markdown_path)?;
    if uses_legacy_symlink_path {
        recover_local_document_path(app, &markdown_path, &guard)?;
        return read_markdown_file_contents(app, markdown_path, true);
    }
    read_markdown_file_locked(app, markdown_path, &guard)
}

#[tauri::command]
fn open_markdown_file(app: AppHandle, path: String) -> Result<OpenMarkdownFile, String> {
    read_markdown_file(&app, PathBuf::from(path))
}

#[tauri::command]
fn open_markdown_file_context(
    app: AppHandle,
    path: String,
) -> Result<OpenMarkdownFileContext, String> {
    let markdown_path = PathBuf::from(path);
    let directory = markdown_path
        .parent()
        .ok_or_else(|| "selected file has no parent directory".to_string())?
        .to_path_buf();
    let selected_file = read_markdown_file(&app, markdown_path)?;
    let directory = read_markdown_directory(&app, directory)?;

    Ok(OpenMarkdownFileContext {
        selected_file,
        directory,
    })
}

#[tauri::command]
fn open_markdown_directory(app: AppHandle, path: String) -> Result<OpenMarkdownDirectory, String> {
    let directory = PathBuf::from(path);
    if !directory.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

    read_markdown_directory(&app, directory)
}

#[tauri::command]
fn search_markdown_files(
    app: AppHandle,
    root_path: String,
    query: String,
    search_tags: Option<bool>,
    exact_tag: Option<bool>,
) -> Result<Vec<SearchMarkdownFile>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

    let search_tags = search_tags.unwrap_or(false);
    let normalized_query = if search_tags {
        normalize_tag_search_value(&query)
    } else {
        query.trim().to_lowercase()
    };
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    // ponytail: store-wide guard; use per-document locks only if measured scans delay saves.
    let tag_guard = if search_tags {
        Some(lock_local_document_store(&app)?.1)
    } else {
        None
    };
    let mut results = Vec::new();
    search_markdown_directory(
        &root,
        &root,
        &normalized_query,
        tag_guard.as_ref(),
        exact_tag.unwrap_or(false),
        &mut results,
    )?;
    results.sort_by_key(|result| result.relative_path.to_lowercase());
    results.truncate(MAX_FILE_SEARCH_RESULTS);

    Ok(results)
}

#[tauri::command]
fn save_markdown_file(
    app: AppHandle,
    path: String,
    body: String,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
) -> Result<SaveMarkdownFile, String> {
    let markdown_path = PathBuf::from(path);
    let document_id = markdown_path.to_string_lossy().to_string();
    let notes_file = notes_file_for_document(
        document_id.clone(),
        notes,
        glossary_terms,
        glossary_bindings,
    );
    let serialized_notes =
        if notes_file_is_empty(&notes_file) && !path_is_local_dropbox_synced_path(&markdown_path) {
            None
        } else {
            Some(
                serde_json::to_string_pretty(&notes_file)
                    .map_err(|error| format!("failed to serialize notes: {error}"))?,
            )
        };
    let (recovery_directory, guard) = lock_local_document_store(&app)?;
    let uses_legacy_symlink_path = local_path_uses_symlink(&markdown_path)?;
    if uses_legacy_symlink_path {
        recover_local_document_path(&app, &markdown_path, &guard)?;
        fs::write(&markdown_path, body)
            .map_err(|error| format!("failed to write Markdown file: {error}"))?;
        let notes_path = write_notes_file(&app, &markdown_path, notes_file)?;
        return Ok(SaveMarkdownFile {
            path: markdown_path.to_string_lossy().to_string(),
            notes_path: notes_path.to_string_lossy().to_string(),
            modified_at: modified_time_millis(&markdown_path),
        });
    }
    let paths = local_document_paths(&app, &markdown_path)?;
    let notes_path = paths.notes().to_path_buf();
    save_local_document(
        &guard,
        &recovery_directory,
        paths,
        LocalDocumentPayload::new(document_id, body, serialized_notes),
    )?;

    Ok(SaveMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
        modified_at: modified_time_millis(&markdown_path),
    })
}

#[tauri::command]
fn duplicate_markdown_file(
    app: AppHandle,
    path: String,
    file_name: String,
) -> Result<OpenMarkdownFile, String> {
    let source_path = PathBuf::from(path);
    let (_, guard) = lock_local_document_store(&app)?;
    recover_local_document_path(&app, &source_path, &guard)?;
    validate_existing_markdown_file(&source_path, "selected path is not a file")?;

    let target_file_name = validate_markdown_file_name(&file_name)?;
    let mut target_path = source_path.with_file_name(target_file_name);
    if !is_markdown_path(&target_path) {
        target_path.set_extension("md");
    }
    if local_path_entry_exists(&target_path)? {
        return Err("duplicate file already exists".to_string());
    }
    recover_local_document_path(&app, &target_path, &guard)?;
    if local_path_entry_exists(&target_path)? {
        return Err("duplicate file already exists".to_string());
    }

    fs::copy(&source_path, &target_path)
        .map_err(|error| format!("failed to duplicate Markdown file: {error}"))?;

    if let Some(parsed) = read_notes_file(&app, &source_path)? {
        let target_path_string = target_path.to_string_lossy().to_string();
        let parsed = duplicate_notes_file_for_document(parsed, &target_path_string)?;

        write_notes_file(&app, &target_path, parsed)?;
    }

    if local_path_uses_symlink(&target_path)? {
        read_markdown_file_contents(&app, target_path, true)
    } else {
        read_markdown_file_locked(&app, target_path, &guard)
    }
}

#[tauri::command]
fn delete_markdown_file(app: AppHandle, path: String) -> Result<DeleteMarkdownFile, String> {
    let markdown_path = PathBuf::from(path);
    let (_, guard) = lock_local_document_store(&app)?;
    recover_local_document_path(&app, &markdown_path, &guard)?;
    validate_existing_markdown_file(&markdown_path, "selected path is not a file")?;
    let deletes_file_link = fs::symlink_metadata(&markdown_path)
        .map_err(|error| format!("failed to inspect selected Markdown file: {error}"))?
        .file_type()
        .is_symlink();
    let (notes_path, legacy_notes_path) = document_notes_paths(&app, &markdown_path)?;

    fs::remove_file(&markdown_path)
        .map_err(|error| format!("failed to delete Markdown file: {error}"))?;

    let notes_path =
        remove_document_notes_at_paths(notes_path, legacy_notes_path, deletes_file_link)?;

    Ok(DeleteMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
    })
}

fn markdown_paths_in_directory(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut markdown_paths = Vec::new();
    let mut directories = vec![directory.to_path_buf()];

    while let Some(current_directory) = directories.pop() {
        for entry in fs::read_dir(&current_directory)
            .map_err(|error| format!("failed to read directory for deletion: {error}"))?
        {
            let entry = entry
                .map_err(|error| format!("failed to read directory item for deletion: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("failed to read directory item type: {error}"))?;
            if file_type.is_dir() {
                directories.push(entry.path());
            } else if file_type.is_file() && is_markdown_path(&entry.path()) {
                markdown_paths.push(entry.path());
            }
        }
    }

    Ok(markdown_paths)
}

fn capture_renamed_directory_notes(
    app: &AppHandle,
    source_directory: &Path,
    target_directory: &Path,
) -> Result<Vec<(CapturedDocumentNotes, PathBuf)>, String> {
    let mut captured_notes = Vec::new();
    for source_path in markdown_paths_in_directory(source_directory)? {
        let relative_path = source_path
            .strip_prefix(source_directory)
            .map_err(|_| "failed to resolve renamed Markdown path".to_string())?;
        if let Some(captured) = capture_document_notes(app, &source_path)? {
            captured_notes.push((captured, target_directory.join(relative_path)));
        }
    }
    Ok(captured_notes)
}

fn validate_directory_delete_target(path: &Path, root_path: &Path) -> Result<PathBuf, String> {
    let root_path = root_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve workspace root: {error}"))?;
    let resolved_target_path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve selected directory: {error}"))?;

    if !resolved_target_path.is_dir() {
        return Err("selected path is not a directory".to_string());
    }
    if resolved_target_path == root_path || !resolved_target_path.starts_with(&root_path) {
        return Err("selected directory must be inside the workspace root".to_string());
    }

    Ok(path.to_path_buf())
}

#[tauri::command]
fn delete_markdown_directory(
    app: AppHandle,
    path: String,
    root_path: String,
) -> Result<(), String> {
    let (_, guard) = lock_local_document_store(&app)?;
    let directory_path = validate_directory_delete_target(Path::new(&path), Path::new(&root_path))?;
    if recover_local_directory_mutation_path(&app, &directory_path, &guard)?.is_none() {
        return fs::remove_file(&directory_path)
            .map_err(|error| format!("failed to delete directory link: {error}"));
    }
    let markdown_paths = markdown_paths_in_directory(&directory_path)?;
    let notes_paths = markdown_paths
        .iter()
        .map(|markdown_path| document_notes_paths(&app, markdown_path))
        .collect::<Result<Vec<_>, _>>()?;

    fs::remove_dir_all(&directory_path)
        .map_err(|error| format!("failed to delete directory: {error}"))?;
    for (notes_path, legacy_notes_path) in notes_paths {
        remove_document_notes_at_paths(notes_path, legacy_notes_path, false)?;
    }

    Ok(())
}

#[tauri::command]
fn rename_markdown_file(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<OpenMarkdownFile, String> {
    let source_path = PathBuf::from(path);
    let (_, guard) = lock_local_document_store(&app)?;
    let uses_legacy_symlink_path = local_path_uses_symlink(&source_path)?;
    recover_local_document_path(&app, &source_path, &guard)?;
    validate_existing_markdown_file(&source_path, "selected path is not a file")?;

    let target_file_name = normalized_markdown_file_name(&name)?;
    let target_path = source_path.with_file_name(target_file_name);
    if source_path == target_path {
        return if uses_legacy_symlink_path {
            read_markdown_file_contents(&app, target_path, true)
        } else {
            read_markdown_file_locked(&app, target_path, &guard)
        };
    }
    if local_path_entry_exists(&target_path)? {
        return Err("rename target already exists".to_string());
    }
    recover_local_document_path(&app, &target_path, &guard)?;
    if local_path_entry_exists(&target_path)? {
        return Err("rename target already exists".to_string());
    }

    let captured_notes = capture_document_notes(&app, &source_path)?;

    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("failed to rename Markdown file: {error}"))?;

    if let Some(captured_notes) = captured_notes {
        move_captured_document_notes(&app, captured_notes, &target_path)?;
    }

    if local_path_uses_symlink(&target_path)? {
        read_markdown_file_contents(&app, target_path, true)
    } else {
        read_markdown_file_locked(&app, target_path, &guard)
    }
}

#[tauri::command]
fn rename_markdown_directory(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let source_path = PathBuf::from(path);
    let (_, guard) = lock_local_document_store(&app)?;
    if !source_path.is_dir() {
        return Err("selected path is not a directory".to_string());
    }
    let resolved_source_path = recover_local_directory_mutation_path(&app, &source_path, &guard)?;

    let target_name = validate_path_name(
        &name,
        "rename name is empty",
        "rename name must not include folders",
    )?;
    let target_path = source_path.with_file_name(target_name);
    if source_path == target_path {
        return Ok(RenamedPath {
            title: directory_title(&target_path),
            path: target_path.to_string_lossy().to_string(),
            notes_path: None,
        });
    }
    if local_path_entry_exists(&target_path)? {
        return Err("rename target already exists".to_string());
    }
    if resolved_source_path.is_some() {
        recover_local_directory_mutation_path(&app, &target_path, &guard)?;
    }
    if local_path_entry_exists(&target_path)? {
        return Err("rename target already exists".to_string());
    }
    let captured_notes = if resolved_source_path.is_some() {
        capture_renamed_directory_notes(&app, &source_path, &target_path)?
    } else {
        Vec::new()
    };

    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("failed to rename directory: {error}"))?;
    for (captured_notes, target_document_path) in captured_notes {
        move_captured_document_notes(&app, captured_notes, &target_document_path)?;
    }

    Ok(RenamedPath {
        title: directory_title(&target_path),
        path: target_path.to_string_lossy().to_string(),
        notes_path: None,
    })
}

#[tauri::command]
fn create_markdown_directory(
    app: AppHandle,
    parent_path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let (_, guard) = lock_local_document_store(&app)?;
    let parent_path = PathBuf::from(parent_path);
    if !parent_path.is_dir() {
        return Err("parent path is not a directory".to_string());
    }

    let directory_name = validate_path_name(
        &name,
        "folder name is empty",
        "folder name must not include folders",
    )?;
    let target_path = parent_path.join(directory_name);
    recover_local_directory_mutation_path(&app, &target_path, &guard)?;
    if local_path_entry_exists(&target_path)? {
        return Err("folder already exists".to_string());
    }

    fs::create_dir(&target_path).map_err(|error| format!("failed to create directory: {error}"))?;

    Ok(RenamedPath {
        title: directory_title(&target_path),
        path: target_path.to_string_lossy().to_string(),
        notes_path: None,
    })
}

#[tauri::command]
fn remember_recent_location(
    app: tauri::AppHandle,
    kind: String,
    path: String,
    title: String,
    source: String,
) -> Result<(), String> {
    let language = current_app_language(&app);
    let entry = sanitize_location_entry(&kind, path, title, source, &language)?;

    remember_recent_location_entry(&app, entry)
}

#[tauri::command]
fn saved_locations(app: tauri::AppHandle) -> Result<LocationStore, String> {
    let mut store = current_location_store(&app);

    if prune_missing_recent_locations(&mut store) {
        replace_current_location_store(&app, store.clone())?;
        write_location_store(&app, &store)?;
        refresh_app_menu(&app)?;
    }

    Ok(store)
}

#[tauri::command]
fn set_current_directory_location(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    title: String,
    source: String,
) -> Result<(), String> {
    let language = current_app_language(&app);
    let entry = sanitize_location_entry("directory", path, title, source, &language)?;
    let state = app.state::<LocationMenuState>();

    {
        let mut current_directory = state
            .current_directories
            .lock()
            .map_err(|_| "failed to lock current directory state".to_string())?;
        current_directory.insert(window.label().to_string(), entry);
    }

    refresh_app_menu(&app)
}

/// System-provided UI such as WKWebView's context menu follows `AppleLanguages`, which macOS
/// reads when the app launches, so a language change reaches that UI after the next launch.
#[cfg(target_os = "macos")]
fn remember_native_ui_language(language: &str) {
    let apple_language = match language {
        "en" => "en",
        "zh-Hans" => "zh-Hans-CN",
        _ => "zh-Hant-TW",
    };
    let defaults = NSUserDefaults::standardUserDefaults();
    let languages = NSArray::from_retained_slice(&[NSString::from_str(apple_language)]);
    unsafe {
        defaults.setObject_forKey(Some(&languages), &NSString::from_str("AppleLanguages"));
    }
}

#[tauri::command]
fn set_editor_insert_file_menu(window: tauri::WebviewWindow, enabled: bool, title: String) {
    #[cfg(target_os = "macos")]
    editor_context_menu::set_target(window.label(), enabled, title);

    #[cfg(not(target_os = "macos"))]
    let _ = (window, enabled, title);
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SiblingFile {
    path: String,
    title: String,
    file_name: String,
}

/// Markdown files keep the extension-less title the file panel shows; other files keep their
/// full name so `report.pdf` and `report.docx` stay distinguishable.
fn sibling_file_title(path: &Path) -> String {
    if is_markdown_path(path) {
        document_title(path)
    } else {
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default()
    }
}

/// `article.md.notes.json` belongs to `article.md` and is not something to link to.
fn is_notes_sidecar_name(file_name: &str) -> bool {
    file_name
        .strip_suffix(".notes.json")
        .is_some_and(|markdown_name| is_markdown_path(Path::new(markdown_name)))
}

#[tauri::command]
fn list_sibling_files(path: String) -> Result<Vec<SiblingFile>, String> {
    let document_path = PathBuf::from(path);
    let Some(directory) = document_path.parent().filter(|parent| parent.is_dir()) else {
        return Err("document folder is not available".to_string());
    };

    let mut files = Vec::new();
    for entry in
        fs::read_dir(directory).map_err(|error| format!("failed to read directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();
        if is_hidden_path(&path) || !path.is_file() || path.file_name() == document_path.file_name()
        {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_notes_sidecar_name(&file_name) {
            continue;
        }

        files.push(SiblingFile {
            title: sibling_file_title(&path),
            file_name,
            path: path.to_string_lossy().to_string(),
        });
    }

    files.sort_by_key(|file| file.file_name.to_lowercase());
    Ok(files)
}

/// Extensions macOS would run instead of showing, so a link click never launches them.
const LAUNCHABLE_FILE_EXTENSIONS: &[&str] = &[
    "action",
    "app",
    "applescript",
    "bash",
    "command",
    "csh",
    "dmg",
    "fish",
    "jar",
    "ksh",
    "mpkg",
    "pkg",
    "py",
    "rb",
    "pl",
    "scpt",
    "scptd",
    "sh",
    "terminal",
    "tool",
    "workflow",
    "zsh",
];

fn is_launchable_file(path: &Path) -> bool {
    let has_launchable_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            LAUNCHABLE_FILE_EXTENSIONS.contains(&extension.to_lowercase().as_str())
        });
    #[cfg(unix)]
    let is_executable = {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(true)
    };
    #[cfg(not(unix))]
    let is_executable = false;

    has_launchable_extension || is_executable
}

#[tauri::command]
fn open_linked_file(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("linked file was not found".to_string());
    }
    if is_launchable_file(&path) {
        return Err("linked file is a program and was not opened".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| format!("failed to open linked file: {error}"))
}

#[tauri::command]
fn set_app_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let normalized_language = normalize_app_language(&language).to_string();
    #[cfg(target_os = "macos")]
    remember_native_ui_language(&normalized_language);
    let state = app.state::<LocationMenuState>();

    {
        let mut current_language = state
            .language
            .lock()
            .map_err(|_| "failed to lock app language state".to_string())?;

        if *current_language == normalized_language {
            return Ok(());
        }

        *current_language = normalized_language;
    }

    refresh_app_menu(&app)
}

#[tauri::command]
fn dropbox_oauth_status(app: tauri::AppHandle) -> Result<DropboxOAuthStatus, String> {
    Ok(DropboxOAuthStatus {
        connected: current_dropbox_tokens(&app)?.is_some(),
    })
}

#[tauri::command]
fn start_dropbox_oauth(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    app_key: String,
) -> Result<DropboxOAuthStart, String> {
    let app_key = app_key.trim().to_string();
    if app_key.is_empty() {
        return Err("Dropbox app key is required.".to_string());
    }
    let owner_window_label = window.label().to_string();

    #[cfg(not(mobile))]
    let listener = TcpListener::bind(("127.0.0.1", DROPBOX_OAUTH_REDIRECT_PORT))
        .map_err(|error| format!("failed to start Dropbox callback listener: {error}"))?;
    let redirect_uri = dropbox_redirect_uri();
    let state = random_url_token(32)?;
    let code_verifier = random_url_token(64)?;
    let code_challenge = pkce_code_challenge(&code_verifier);
    let connection_snapshot = dropbox_connection_snapshot(&app)?;

    {
        let dropbox_state = app.state::<DropboxState>();
        let mut oauth_sessions = dropbox_state
            .oauth_sessions
            .lock()
            .map_err(|_| "failed to lock Dropbox OAuth session".to_string())?;
        oauth_sessions.retain(|_, session| session.owner_window_label != owner_window_label);
        oauth_sessions.insert(
            state.clone(),
            DropboxOAuthSession {
                app_key: app_key.clone(),
                code_verifier,
                connection_snapshot,
                owner_window_label,
                redirect_uri: redirect_uri.clone(),
                state: state.clone(),
            },
        );
    }

    let mut authorize_url = Url::parse(DROPBOX_OAUTH_AUTHORIZE_URL)
        .map_err(|error| format!("failed to prepare Dropbox OAuth URL: {error}"))?;
    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", &app_key)
        .append_pair("scope", DROPBOX_REQUIRED_SCOPES)
        .append_pair("response_type", "code")
        .append_pair("token_access_type", "offline")
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state);

    #[cfg(not(mobile))]
    {
        let app_for_callback = app.clone();
        let callback_state = state.clone();
        std::thread::spawn(move || {
            let payload = wait_for_dropbox_oauth_callback(listener, callback_state);
            if let Err(error) = emit_dropbox_oauth_callback_to_owner(&app_for_callback, payload) {
                eprintln!("{error}");
            }
        });
    }

    Ok(DropboxOAuthStart {
        auth_url: authorize_url.to_string(),
        redirect_uri,
    })
}

#[tauri::command]
async fn complete_dropbox_oauth(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    code: String,
    state: String,
) -> Result<DropboxOAuthStatus, String> {
    let code = code.trim().to_string();
    let state = state.trim().to_string();
    if code.is_empty() {
        return Err("Dropbox authorization code is missing.".to_string());
    }

    let session = {
        let dropbox_state = app.state::<DropboxState>();
        let mut oauth_sessions = dropbox_state
            .oauth_sessions
            .lock()
            .map_err(|_| "failed to lock Dropbox OAuth session".to_string())?;
        let Some(session) = oauth_sessions.get(&state) else {
            return Err(if oauth_sessions.is_empty() {
                "Dropbox OAuth session was not started.".to_string()
            } else {
                "Dropbox OAuth state did not match.".to_string()
            });
        };
        if session.owner_window_label != window.label() {
            return Err("Dropbox OAuth session belongs to another window.".to_string());
        }

        oauth_sessions
            .remove(&state)
            .expect("Dropbox OAuth session exists")
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("failed to prepare Dropbox authorization exchange: {error}"))?;
    let response = client
        .post(DROPBOX_OAUTH_TOKEN_URL)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=utf-8",
        )
        .body(urlencoded_form_body(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("client_id", session.app_key.as_str()),
            ("code_verifier", session.code_verifier.as_str()),
            ("redirect_uri", session.redirect_uri.as_str()),
        ]))
        .send()
        .await
        .map_err(|error| format!("failed to exchange Dropbox authorization code: {error}"))?;

    let token_response =
        parse_dropbox_token_response(response, "failed to exchange Dropbox authorization code")
            .await?;
    let tokens = DropboxTokenStore {
        app_key: session.app_key,
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_at: token_response
            .expires_in
            .map(|expires_in| now_unix_seconds() + expires_in),
    };

    commit_dropbox_connection(&app, session.connection_snapshot, tokens)?;

    Ok(DropboxOAuthStatus { connected: true })
}

#[tauri::command]
fn disconnect_dropbox(app: tauri::AppHandle) -> Result<DropboxOAuthStatus, String> {
    remove_dropbox_tokens(&app)?;

    Ok(DropboxOAuthStatus { connected: false })
}

#[tauri::command]
async fn check_dropbox_connection(app: tauri::AppHandle) -> Result<DropboxOAuthStatus, String> {
    let access_token = dropbox_access_token(&app).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("failed to prepare Dropbox connection check: {error}"))?;
    let response = client
        .post(DROPBOX_LIST_FOLDER_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "path": "",
            "recursive": false,
            "include_media_info": false,
            "include_deleted": false,
            "include_has_explicit_shared_members": false,
            "include_mounted_folders": true,
            "include_non_downloadable_files": true,
            "limit": 1
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Dropbox connection timed out.".to_string()
            } else {
                format!("failed to check Dropbox connection: {error}")
            }
        })?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to check Dropbox connection").await);
    }

    Ok(DropboxOAuthStatus { connected: true })
}

#[tauri::command]
async fn list_dropbox_markdown_directory(
    app: tauri::AppHandle,
    path: String,
) -> Result<DropboxMarkdownDirectory, String> {
    list_dropbox_directory(&app, &path, true).await
}

#[tauri::command]
async fn list_dropbox_directory_files(
    app: tauri::AppHandle,
    path: String,
) -> Result<DropboxMarkdownDirectory, String> {
    list_dropbox_directory(&app, &path, false).await
}

async fn list_dropbox_directory(
    app: &tauri::AppHandle,
    path: &str,
    markdown_only: bool,
) -> Result<DropboxMarkdownDirectory, String> {
    let normalized_path = normalize_dropbox_path(path);
    let access_token = dropbox_access_token(app).await?;
    let client = reqwest::Client::new();
    let mut page = read_dropbox_list_page(&client, &access_token, &normalized_path).await?;
    let mut entries = Vec::new();

    loop {
        for entry in page.entries {
            match entry {
                DropboxMetadata::Folder {
                    name,
                    path_display,
                    path_lower,
                } => {
                    if name.starts_with('.') {
                        continue;
                    }

                    entries.push(DropboxDirectoryEntry {
                        kind: "directory".to_string(),
                        path: dropbox_metadata_path(path_display, path_lower, &name),
                        title: name,
                        size: None,
                        server_modified: None,
                    });
                }
                DropboxMetadata::File {
                    name,
                    path_display,
                    path_lower,
                    server_modified,
                    size,
                    is_downloadable,
                } => {
                    if name.starts_with('.') {
                        continue;
                    }

                    let path = dropbox_metadata_path(path_display, path_lower, &name);
                    if markdown_only
                        && (is_downloadable == Some(false) || !is_markdown_path(Path::new(&path)))
                    {
                        continue;
                    }
                    if !markdown_only && is_notes_sidecar_name(&name) {
                        continue;
                    }

                    entries.push(DropboxDirectoryEntry {
                        kind: "file".to_string(),
                        title: sibling_file_title(Path::new(&path)),
                        path,
                        size,
                        server_modified,
                    });
                }
                DropboxMetadata::Other => {}
            }
        }

        if !page.has_more {
            break;
        }

        page = read_dropbox_list_continue_page(&client, &access_token, &page.cursor).await?;
    }

    entries.sort_by(compare_dropbox_entries);

    Ok(DropboxMarkdownDirectory {
        title: dropbox_path_title(&normalized_path),
        path: normalized_path.clone(),
        parent_path: dropbox_parent_path(&normalized_path),
        entries,
    })
}

#[tauri::command]
async fn open_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<DropboxMarkdownFile, String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&normalized_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let access_token = dropbox_access_token(&app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_DOWNLOAD_URL)
        .bearer_auth(access_token)
        .header(
            "Dropbox-API-Arg",
            serde_json::json!({ "path": normalized_path }).to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("failed to download Dropbox Markdown file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to download Dropbox Markdown file").await,
        );
    }

    let metadata = response
        .headers()
        .get("dropbox-api-result")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| serde_json::from_str::<DropboxDownloadMetadata>(value).ok());
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read Dropbox Markdown response: {error}"))?;
    let body = String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("Dropbox Markdown file is not valid UTF-8: {error}"))?;
    let path = metadata
        .as_ref()
        .map(|metadata| {
            dropbox_metadata_path(
                metadata.path_display.clone(),
                metadata.path_lower.clone(),
                &metadata.name,
            )
        })
        .unwrap_or(normalized_path);
    let title = metadata
        .as_ref()
        .map(|metadata| document_title(Path::new(&metadata.name)))
        .unwrap_or_else(|| document_title(Path::new(&path)));

    dropbox_file_with_remote_notes(
        &app,
        path,
        title,
        body,
        metadata.as_ref().and_then(|metadata| metadata.rev.clone()),
        metadata.and_then(|metadata| metadata.server_modified),
    )
    .await
}

#[tauri::command]
async fn read_dropbox_markdown_body(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&normalized_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let access_token = dropbox_access_token(&app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_DOWNLOAD_URL)
        .bearer_auth(access_token)
        .header(
            "Dropbox-API-Arg",
            serde_json::json!({ "path": normalized_path }).to_string(),
        )
        .send()
        .await
        .map_err(|error| format!("failed to download Dropbox Markdown file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to download Dropbox Markdown file").await,
        );
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read Dropbox Markdown response: {error}"))?;
    String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("Dropbox Markdown file is not valid UTF-8: {error}"))
}

#[tauri::command]
async fn save_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
    body: String,
    rev: Option<String>,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
) -> Result<DropboxMarkdownFile, String> {
    let mode = rev
        .as_ref()
        .map(|rev| {
            serde_json::json!({
                ".tag": "update",
                "update": rev
            })
        })
        .unwrap_or_else(|| serde_json::json!("overwrite"));

    let saved = upload_dropbox_markdown_file(&app, path, body, mode).await?;
    let notes_markdown_path = dropbox_notes_markdown_path(&saved.path);
    let notes_file = notes_file_for_document(
        format!("dropbox:{}", saved.path),
        notes,
        glossary_terms,
        glossary_bindings,
    );

    write_notes_file(&app, &notes_markdown_path, notes_file.clone())?;
    sync_dropbox_notes_file(&app, &saved.path, notes_file).await?;

    dropbox_file_with_notes(
        &app,
        saved.path,
        saved.title,
        saved.body,
        saved.rev,
        saved.server_modified,
    )
}

#[tauri::command]
async fn create_dropbox_markdown_file(
    app: tauri::AppHandle,
    parent_path: String,
    file_name: String,
) -> Result<DropboxMarkdownFile, String> {
    let target_file_name = normalized_markdown_file_name(&file_name)?;
    let target_path = dropbox_child_path(&parent_path, &target_file_name);

    upload_dropbox_markdown_file(&app, target_path, String::new(), serde_json::json!("add")).await
}

#[tauri::command]
async fn create_dropbox_markdown_directory(
    app: tauri::AppHandle,
    parent_path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let directory_name = validate_path_name(
        &name,
        "folder name is empty",
        "folder name must not include folders",
    )?;
    let directory_name = directory_name
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "folder name is empty".to_string())?;
    let target_path = dropbox_child_path(&parent_path, directory_name);
    let access_token = dropbox_access_token(&app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_CREATE_FOLDER_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "path": target_path,
            "autorename": false
        }))
        .send()
        .await
        .map_err(|error| format!("failed to create Dropbox directory: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to create Dropbox directory").await);
    }

    Ok(RenamedPath {
        title: dropbox_path_title(&target_path),
        path: target_path,
        notes_path: None,
    })
}

#[tauri::command]
async fn duplicate_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
    file_name: String,
) -> Result<DropboxMarkdownFile, String> {
    let source_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&source_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let target_file_name = normalized_markdown_file_name(&file_name)?;
    let parent_path = dropbox_parent_path(&source_path).unwrap_or_default();
    let target_path = dropbox_child_path(&parent_path, &target_file_name);
    let access_token = dropbox_access_token(&app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_COPY_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "from_path": source_path,
            "to_path": target_path,
            "autorename": false,
            "allow_shared_folder": false,
            "allow_ownership_transfer": false
        }))
        .send()
        .await
        .map_err(|error| format!("failed to duplicate Dropbox Markdown file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to duplicate Dropbox Markdown file").await,
        );
    }

    let source_notes_markdown_path = dropbox_notes_markdown_path(&source_path);
    let source_notes_file = match download_dropbox_notes_file(&app, &source_path).await? {
        Some(parsed) => Some(parsed),
        None => read_notes_file(&app, &source_notes_markdown_path)?,
    };

    if let Some(parsed) = source_notes_file {
        let target_notes_markdown_path = dropbox_notes_markdown_path(&target_path);
        let target_document_id = format!("dropbox:{target_path}");
        let parsed = duplicate_notes_file_for_document(parsed, &target_document_id)?;

        write_notes_file(&app, &target_notes_markdown_path, parsed.clone())?;
        sync_dropbox_notes_file(&app, &target_path, parsed).await?;
    }

    open_dropbox_markdown_file(app, target_path).await
}

#[tauri::command]
async fn delete_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<DropboxMarkdownFile, String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&normalized_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let deleted_file = open_dropbox_markdown_file(app.clone(), normalized_path.clone()).await?;
    let access_token = dropbox_access_token(&app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_DELETE_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "path": normalized_path }))
        .send()
        .await
        .map_err(|error| format!("failed to delete Dropbox Markdown file: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(
            dropbox_response_error(response, "failed to delete Dropbox Markdown file").await,
        );
    }

    let notes_markdown_path = dropbox_notes_markdown_path(&normalized_path);
    delete_dropbox_notes_file(&app, &normalized_path).await?;
    remove_document_notes(&app, &notes_markdown_path)?;

    Ok(deleted_file)
}

fn dropbox_path_is_strict_descendant(path: &str, root_path: &str) -> bool {
    let path = normalize_dropbox_path(path).to_lowercase();
    let root_path = normalize_dropbox_path(root_path).to_lowercase();
    if path.is_empty() || path == root_path {
        return false;
    }

    root_path.is_empty() || path.starts_with(&format!("{}/", root_path.trim_end_matches('/')))
}

async fn dropbox_markdown_paths_in_directory(
    client: &reqwest::Client,
    access_token: &str,
    path: &str,
) -> Result<Vec<String>, String> {
    let mut page = read_dropbox_list_page_with_recursive(client, access_token, path, true).await?;
    let mut markdown_paths = Vec::new();

    loop {
        markdown_paths.extend(page.entries.into_iter().filter_map(|entry| match entry {
            DropboxMetadata::File {
                name,
                path_display,
                path_lower,
                ..
            } => {
                let path = dropbox_metadata_path(path_display, path_lower, &name);
                is_markdown_path(Path::new(&path)).then_some(path)
            }
            _ => None,
        }));

        if !page.has_more {
            break;
        }
        page = read_dropbox_list_continue_page(client, access_token, &page.cursor).await?;
    }

    Ok(markdown_paths)
}

#[tauri::command]
async fn delete_dropbox_markdown_directory(
    app: tauri::AppHandle,
    path: String,
    root_path: String,
) -> Result<(), String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !dropbox_path_is_strict_descendant(&normalized_path, &root_path) {
        return Err("selected Dropbox directory must be inside the workspace root".to_string());
    }

    let access_token = dropbox_access_token(&app).await?;
    let client = reqwest::Client::new();
    let markdown_paths =
        dropbox_markdown_paths_in_directory(&client, &access_token, &normalized_path).await?;
    let response = client
        .post(DROPBOX_DELETE_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "path": normalized_path }))
        .send()
        .await
        .map_err(|error| format!("failed to delete Dropbox directory: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to delete Dropbox directory").await);
    }

    for markdown_path in markdown_paths {
        remove_document_notes(&app, &dropbox_notes_markdown_path(&markdown_path))?;
    }

    Ok(())
}

async fn move_dropbox_path(
    app: &tauri::AppHandle,
    from_path: String,
    to_path: String,
) -> Result<(), String> {
    let access_token = dropbox_access_token(app).await?;
    let response = reqwest::Client::new()
        .post(DROPBOX_MOVE_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "from_path": from_path,
            "to_path": to_path,
            "autorename": false,
            "allow_shared_folder": false,
            "allow_ownership_transfer": false
        }))
        .send()
        .await
        .map_err(|error| format!("failed to rename Dropbox item: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("Dropbox authorization failed; reconnect Dropbox.".to_string());
    }
    if !response.status().is_success() {
        return Err(dropbox_response_error(response, "failed to rename Dropbox item").await);
    }

    Ok(())
}

#[tauri::command]
async fn rename_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let source_path = normalize_dropbox_path(&path);
    if !is_markdown_path(Path::new(&source_path)) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let target_file_name = normalized_markdown_file_name(&name)?;
    let parent_path = dropbox_parent_path(&source_path).unwrap_or_default();
    let target_path = dropbox_child_path(&parent_path, &target_file_name);
    if source_path != target_path {
        let source_notes_markdown_path = dropbox_notes_markdown_path(&source_path);
        let source_notes_file = match download_dropbox_notes_file(&app, &source_path).await? {
            Some(parsed) => Some(parsed),
            None => read_notes_file(&app, &source_notes_markdown_path)?,
        };

        move_dropbox_path(&app, source_path.clone(), target_path.clone()).await?;

        if let Some(notes_file) = source_notes_file {
            let target_notes_markdown_path = dropbox_notes_markdown_path(&target_path);
            let target_document_id = format!("dropbox:{target_path}");
            let notes_file = move_notes_file_for_document(notes_file, &target_document_id);

            write_notes_file(&app, &target_notes_markdown_path, notes_file.clone())?;
            sync_dropbox_notes_file(&app, &target_path, notes_file).await?;
            delete_dropbox_notes_file(&app, &source_path).await?;
            remove_document_notes(&app, &source_notes_markdown_path)?;
        }
    }

    let notes_path = notes_store_path(&app, &dropbox_notes_markdown_path(&target_path))?
        .to_string_lossy()
        .to_string();
    Ok(RenamedPath {
        title: dropbox_path_title(&target_path),
        path: target_path,
        notes_path: Some(notes_path),
    })
}

#[tauri::command]
async fn rename_dropbox_markdown_directory(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let source_path = normalize_dropbox_path(&path);
    let target_name = validate_path_name(
        &name,
        "rename name is empty",
        "rename name must not include folders",
    )?;
    let target_name = target_name
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "rename name is empty".to_string())?;
    let parent_path = dropbox_parent_path(&source_path).unwrap_or_default();
    let target_path = dropbox_child_path(&parent_path, target_name);
    if source_path == target_path {
        return Ok(RenamedPath {
            title: dropbox_path_title(&target_path),
            path: target_path,
            notes_path: None,
        });
    }

    move_dropbox_path(&app, source_path, target_path.clone()).await?;

    Ok(RenamedPath {
        title: dropbox_path_title(&target_path),
        path: target_path,
        notes_path: None,
    })
}

#[cfg(desktop)]
fn build_favorite_directories_submenu(
    app_handle: &tauri::AppHandle,
    store: &LocationStore,
    language: &str,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let has_current_directory = current_directory_for_target_window(app_handle).is_some();
    let submenu = Submenu::with_id(
        app_handle,
        MENU_FAVORITE_DIRECTORIES,
        menu_text(language, "favoriteDirectories"),
        true,
    )?;
    let add_current_directory = MenuItem::with_id(
        app_handle,
        MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES,
        menu_text(language, "addCurrentDirectory"),
        has_current_directory,
        None::<&str>,
    )?;

    submenu.append(&add_current_directory)?;
    submenu.append(&PredefinedMenuItem::separator(app_handle)?)?;

    if store.favorite_directories.is_empty() {
        let empty_item = MenuItem::with_id(
            app_handle,
            "file:favorite-directories-empty",
            menu_text(language, "noFavoriteDirectories"),
            false,
            None::<&str>,
        )?;
        submenu.append(&empty_item)?;
    } else {
        for (index, location) in store.favorite_directories.iter().enumerate() {
            let item = MenuItem::with_id(
                app_handle,
                format!("{MENU_FAVORITE_DIRECTORY_PREFIX}{index}"),
                location_menu_label(location),
                true,
                None::<&str>,
            )?;
            submenu.append(&item)?;
        }
    }

    submenu.append(&PredefinedMenuItem::separator(app_handle)?)?;
    let clear_item = MenuItem::with_id(
        app_handle,
        MENU_CLEAR_FAVORITE_DIRECTORIES,
        menu_text(language, "clearFavoriteDirectories"),
        !store.favorite_directories.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(submenu)
}

#[cfg(desktop)]
fn build_recent_locations_submenu(
    app_handle: &tauri::AppHandle,
    store: &LocationStore,
    language: &str,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let submenu = Submenu::with_id(
        app_handle,
        MENU_RECENT_LOCATIONS,
        menu_text(language, "recentLocations"),
        true,
    )?;

    if store.recent.is_empty() {
        let empty_item = MenuItem::with_id(
            app_handle,
            "file:recent-locations-empty",
            menu_text(language, "noRecentLocations"),
            false,
            None::<&str>,
        )?;
        submenu.append(&empty_item)?;
    } else {
        for (index, location) in store.recent.iter().enumerate() {
            let item = MenuItem::with_id(
                app_handle,
                format!("{MENU_RECENT_LOCATION_PREFIX}{index}"),
                location_menu_label(location),
                true,
                None::<&str>,
            )?;
            submenu.append(&item)?;
        }
    }

    submenu.append(&PredefinedMenuItem::separator(app_handle)?)?;
    let clear_item = MenuItem::with_id(
        app_handle,
        MENU_CLEAR_RECENT_LOCATIONS,
        menu_text(language, "clearItems"),
        !store.recent.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(submenu)
}

#[cfg(desktop)]
fn build_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let language = current_app_language(app_handle);
    let location_store = current_location_store(app_handle);
    let menu_item = |id: &str, key: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app_handle, id, menu_text(&language, key), true, accelerator)
    };
    let about_metadata = AboutMetadata {
        name: Some("Scholium".to_string()),
        version: Some(app_handle.package_info().version.to_string()),
        ..Default::default()
    };
    let new_window = menu_item(MENU_NEW_WINDOW, "newWindow", Some("CmdOrCtrl+Shift+N"))?;
    let new_file = menu_item(MENU_NEW_FILE, "newFile", Some("CmdOrCtrl+N"))?;
    let new_folder = menu_item(MENU_NEW_FOLDER, "newFolder", None)?;
    let open_file = menu_item(MENU_OPEN_FILE, "openFile", Some("CmdOrCtrl+O"))?;
    let open_folder = menu_item(MENU_OPEN_FOLDER, "openFolder", Some("CmdOrCtrl+Shift+O"))?;
    let open_path = menu_item(MENU_OPEN_PATH, "openPath", Some("CmdOrCtrl+Alt+O"))?;
    let open_settings = menu_item(MENU_OPEN_SETTINGS, "settings", Some("CmdOrCtrl+,"))?;
    let quit = menu_item(MENU_QUIT, "quit", Some("CmdOrCtrl+Q"))?;
    let select_all = menu_item(MENU_SELECT_ALL, "selectAll", None)?;
    let cloud_dropbox = menu_item(MENU_CLOUD_DROPBOX, "dropbox", None)?;
    let cloud = Submenu::with_items(
        app_handle,
        menu_text(&language, "cloud"),
        true,
        &[&cloud_dropbox],
    )?;
    let favorite_directories =
        build_favorite_directories_submenu(app_handle, &location_store, &language)?;
    let recent_locations = build_recent_locations_submenu(app_handle, &location_store, &language)?;

    Menu::with_items(
        app_handle,
        &[
            &Submenu::with_items(
                app_handle,
                "Scholium",
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
                    &open_settings,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                menu_text(&language, "fileMenu"),
                true,
                &[
                    &new_window,
                    &new_file,
                    &new_folder,
                    &open_file,
                    &open_folder,
                    &open_path,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &cloud,
                    &favorite_directories,
                    &recent_locations,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                menu_text(&language, "editMenu"),
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &select_all,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                menu_text(&language, "viewMenu"),
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &Submenu::with_items(
                app_handle,
                menu_text(&language, "windowMenu"),
                true,
                &[
                    &PredefinedMenuItem::minimize(app_handle, None)?,
                    &PredefinedMenuItem::maximize(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(app_handle, menu_text(&language, "helpMenu"), true, &[])?,
        ],
    )
}

#[cfg(desktop)]
fn refresh_app_menu(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let menu = build_app_menu(app_handle)
        .map_err(|error| format!("failed to rebuild app menu: {error}"))?;

    app_handle
        .set_menu(menu)
        .map(|_| ())
        .map_err(|error| format!("failed to set app menu: {error}"))
}

#[cfg(not(desktop))]
fn refresh_app_menu(_app_handle: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(desktop)]
#[tauri::command]
async fn create_new_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    document_target: Option<LocationEntry>,
    requester_scene_identifier: Option<String>,
) -> Result<String, String> {
    let _ = requester_scene_identifier;
    let document_target = document_target
        .map(|target| {
            sanitize_location_entry(
                "file",
                target.path,
                target.title,
                target.source,
                &current_app_language(&app),
            )
        })
        .transpose()?;
    let start_fullscreen = window
        .is_fullscreen()
        .map_err(|error| format!("failed to read current window fullscreen state: {error}"))?;

    create_new_scholium_window(&app, start_fullscreen, document_target)
}

#[cfg(mobile)]
#[tauri::command]
async fn create_new_window(
    _app: tauri::AppHandle,
    _document_target: Option<LocationEntry>,
    _requester_scene_identifier: Option<String>,
) -> Result<String, String> {
    Err("New windows are only available on desktop.".to_string())
}

#[tauri::command]
fn take_new_window_document_target(
    state: tauri::State<'_, NewWindowDocumentTargetState>,
    window: tauri::WebviewWindow,
) -> Result<Option<LocationEntry>, String> {
    state
        .0
        .lock()
        .map_err(|_| "failed to lock new-window document target state".to_string())
        .map(|mut targets| targets.remove(window.label()))
}

#[tauri::command]
fn resolve_typed_markdown_path(path: String) -> Result<DroppedPathPayload, String> {
    let home_directory = std::env::var_os("HOME").map(PathBuf::from);
    let (kind, path) = match typed_markdown_location(&path, home_directory.as_deref())? {
        TypedMarkdownLocation::File(path) => ("file", path),
        TypedMarkdownLocation::Directory(path) => ("directory", path),
    };

    Ok(DroppedPathPayload {
        kind: kind.to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn validate_dropped_markdown_path(paths: Vec<String>) -> Result<DroppedPathPayload, String> {
    let (kind, path) = match dropped_markdown_path(&paths)? {
        DroppedMarkdownPath::File(path) if path.is_file() => ("file", path),
        DroppedMarkdownPath::File(_) => {
            return Err("dropped path is not an existing file".to_string())
        }
        DroppedMarkdownPath::Directory(path) => ("directory", path),
    };

    Ok(DroppedPathPayload {
        kind: kind.to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn focus_and_fullscreen_app_window(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(label) = target_webview_window_label(&app) {
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| "target window is unavailable".to_string())?;
        window
            .unminimize()
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("failed to focus app window: {error}"))?;
        window
            .set_fullscreen(true)
            .map_err(|error| format!("failed to make app window fullscreen: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn take_opened_file_paths(state: tauri::State<'_, OpenedFileState>) -> Result<Vec<String>, String> {
    let mut queue = state
        .0
        .lock()
        .map_err(|_| "failed to access pending opened files".to_string())?;
    queue.frontend_ready = true;

    Ok(std::mem::take(&mut queue.pending_paths))
}

#[tauri::command]
fn set_native_folder_picker_list_view(enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        let defaults = NSUserDefaults::standardUserDefaults();
        for key in [
            "NSNavPanelFileLastListModeForOpenModeKey",
            "NSNavPanelFileListModeForOpenMode2",
        ] {
            let key = NSString::from_str(key);
            if enabled {
                defaults.setInteger_forKey(2, &key);
            } else {
                defaults.removeObjectForKey(&key);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = enabled;
}

#[cfg(target_os = "macos")]
fn handle_opened_file_urls(app_handle: &AppHandle, urls: Vec<Url>) {
    let paths = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return;
    }

    let should_emit = match app_handle.state::<OpenedFileState>().0.lock() {
        Ok(queue) if queue.frontend_ready => true,
        Ok(mut queue) => {
            queue.pending_paths.extend(paths.clone());
            false
        }
        Err(_) => true,
    };

    if should_emit {
        let _ = emit_to_target_webview_window(app_handle, "scholium-open-file-paths", paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(LocationMenuState::default())
        .manage(NewWindowDocumentTargetState::default())
        .manage(FocusedWindowState::default())
        .manage(DropboxState::default())
        .manage(OpenedFileState::default())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                if let Ok(mut last_focused_label) = window.state::<FocusedWindowState>().0.lock() {
                    *last_focused_label = Some(window.label().to_string());
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Ok(mut last_focused_label) = window.state::<FocusedWindowState>().0.lock() {
                    if last_focused_label.as_deref() == Some(window.label()) {
                        *last_focused_label = None;
                    }
                }
            }
            _ => {}
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                #[cfg(target_os = "macos")]
                editor_context_menu::install_on_webview(webview);
                if let Err(error) = webview.window().show() {
                    eprintln!("failed to show ready window: {error}");
                }
            }
        })
        .setup(|app| {
            #[cfg(mobile)]
            {
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if is_dropbox_mobile_callback(&url) {
                            let payload = dropbox_oauth_callback_from_url(&url);
                            if let Err(error) =
                                emit_dropbox_oauth_callback_to_owner(&app_handle, payload)
                            {
                                eprintln!("{error}");
                            }
                        }
                    }
                });
            }

            let mut location_store = read_location_store_from_disk(app.handle());
            let pruned_recent_locations = prune_missing_recent_locations(&mut location_store);
            if pruned_recent_locations {
                if let Err(error) = write_location_store(app.handle(), &location_store) {
                    eprintln!("{error}");
                }
            }

            if let Err(error) = replace_current_location_store(app.handle(), location_store)
                .and_then(|_| refresh_app_menu(app.handle()))
            {
                eprintln!("{error}");
            }

            #[cfg(target_os = "macos")]
            editor_context_menu::remember_app(app.handle());

            let dropbox_tokens = read_dropbox_tokens_from_disk(app.handle());
            if let Err(error) = load_dropbox_tokens(app.handle(), dropbox_tokens) {
                eprintln!("{error}");
            }

            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.menu(build_app_menu).on_menu_event(|app, event| {
        let event_id = event.id().as_ref();

        if event_id == MENU_QUIT {
            request_close_all_windows(app);
        } else if event_id == MENU_NEW_WINDOW {
            let app_handle = app.clone();
            let start_fullscreen = target_window_is_fullscreen(app);
            std::thread::spawn(move || {
                if let Err(error) = create_new_scholium_window(&app_handle, start_fullscreen, None)
                {
                    eprintln!("{error}");
                }
            });
        } else if event_id == MENU_NEW_FILE {
            let _ = emit_to_target_webview_window(app, "scholium-new-file", ());
        } else if event_id == MENU_NEW_FOLDER {
            let _ = emit_to_target_webview_window(app, "scholium-new-folder", ());
        } else if event_id == MENU_OPEN_SETTINGS {
            let _ = emit_to_target_webview_window(app, "scholium-open-settings", ());
        } else if event_id == MENU_SELECT_ALL {
            let _ = emit_to_target_webview_window(app, "scholium-select-all", ());
        } else if event_id == MENU_OPEN_FILE {
            let _ = emit_to_target_webview_window(app, "scholium-open-file", ());
        } else if event_id == MENU_OPEN_FOLDER {
            let _ = emit_to_target_webview_window(app, "scholium-open-folder", ());
        } else if event_id == MENU_OPEN_PATH {
            let _ = emit_to_target_webview_window(app, "scholium-open-path", ());
        } else if event_id == MENU_CLOUD_DROPBOX {
            let _ = emit_to_target_webview_window(app, "scholium-open-dropbox", ());
        } else if event_id == MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES {
            if let Some(directory) = current_directory_for_target_window(app) {
                let _ = remember_favorite_directory_entry(app, directory);
            }
        } else if event_id == MENU_CLEAR_FAVORITE_DIRECTORIES {
            let _ = clear_favorite_directories(app);
        } else if event_id == MENU_CLEAR_RECENT_LOCATIONS {
            let _ = clear_recent_locations(app);
        } else if event_id.starts_with(MENU_FAVORITE_DIRECTORY_PREFIX)
            || event_id.starts_with(MENU_RECENT_LOCATION_PREFIX)
        {
            let store = current_location_store(app);
            let location = indexed_location(
                &store.favorite_directories,
                event_id,
                MENU_FAVORITE_DIRECTORY_PREFIX,
            )
            .or_else(|| indexed_location(&store.recent, event_id, MENU_RECENT_LOCATION_PREFIX));

            if let Some(location) = location {
                let payload = OpenLocationPayload {
                    kind: location.kind.clone(),
                    path: location.path.clone(),
                    source: location.source.clone(),
                    title: location.title.clone(),
                };
                let _ = emit_to_target_webview_window(app, "scholium-open-location", payload);
            }
        }
    });

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_new_window,
            take_new_window_document_target,
            validate_dropped_markdown_path,
            resolve_typed_markdown_path,
            save_draft_document,
            list_draft_documents,
            delete_draft_document,
            focus_and_fullscreen_app_window,
            take_opened_file_paths,
            set_native_folder_picker_list_view,
            open_markdown_directory,
            open_markdown_file,
            open_markdown_file_context,
            read_markdown_image_file,
            search_markdown_files,
            duplicate_markdown_file,
            delete_markdown_file,
            delete_markdown_directory,
            rename_markdown_file,
            rename_markdown_directory,
            create_markdown_directory,
            write_pdf_file,
            write_pdf_file_to_directory,
            save_markdown_file,
            remember_recent_location,
            saved_locations,
            set_current_directory_location,
            set_app_language,
            set_editor_insert_file_menu,
            list_sibling_files,
            list_dropbox_directory_files,
            open_linked_file,
            dropbox_oauth_status,
            start_dropbox_oauth,
            complete_dropbox_oauth,
            disconnect_dropbox,
            check_dropbox_connection,
            list_dropbox_markdown_directory,
            open_dropbox_markdown_file,
            read_dropbox_markdown_body,
            save_dropbox_markdown_file,
            create_dropbox_markdown_file,
            create_dropbox_markdown_directory,
            duplicate_dropbox_markdown_file,
            delete_dropbox_markdown_file,
            delete_dropbox_markdown_directory,
            rename_dropbox_markdown_file,
            rename_dropbox_markdown_directory
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            handle_opened_file_urls(_app_handle, urls);
        }
    });
}

#[cfg(test)]
fn test_directory(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "scholium-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropbox_token_refresh_retries_twice_with_backoff() {
        assert_eq!(
            dropbox_token_refresh_retry_delay(1),
            Some(Duration::from_millis(500))
        );
        assert_eq!(
            dropbox_token_refresh_retry_delay(2),
            Some(Duration::from_millis(1_000))
        );
        assert_eq!(dropbox_token_refresh_retry_delay(3), None);
    }

    #[test]
    fn sibling_files_skip_current_hidden_folders_and_notes_sidecars() {
        let directory = test_directory("sibling-files");
        fs::create_dir_all(directory.join("nested.md")).unwrap();
        for name in [
            "current.md",
            "current.md.notes.json",
            "b.md",
            "A.markdown",
            ".hidden.md",
            "image.png",
            "data.notes.json",
        ] {
            fs::write(directory.join(name), "").unwrap();
        }

        let files =
            list_sibling_files(directory.join("current.md").to_string_lossy().to_string()).unwrap();
        let _ = fs::remove_dir_all(&directory);

        let names = files
            .iter()
            .map(|file| (file.file_name.as_str(), file.title.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                ("A.markdown", "A"),
                ("b.md", "b"),
                ("data.notes.json", "data.notes.json"),
                ("image.png", "image.png"),
            ]
        );
    }

    #[test]
    fn launchable_files_are_not_opened_from_links() {
        let directory = test_directory("launchable-files");
        fs::create_dir_all(&directory).unwrap();
        for name in ["run.command", "report.pdf"] {
            fs::write(directory.join(name), "").unwrap();
        }

        assert!(is_launchable_file(&directory.join("run.command")));
        assert!(!is_launchable_file(&directory.join("report.pdf")));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn markdown_file_names_keep_automatic_extension() {
        assert_eq!(normalized_markdown_file_name("draft").unwrap(), "draft.md");
        assert_eq!(
            normalized_markdown_file_name("draft.MARKDOWN").unwrap(),
            "draft.MARKDOWN"
        );
    }

    #[test]
    fn directory_delete_targets_must_be_strict_descendants() {
        assert!(dropbox_path_is_strict_descendant(
            "/Notes/Archive",
            "/Notes"
        ));
        assert!(dropbox_path_is_strict_descendant(
            "/Notes/Archive/2026",
            "/Notes"
        ));
        assert!(!dropbox_path_is_strict_descendant("/Notes", "/Notes"));
        assert!(!dropbox_path_is_strict_descendant("/Notes-Old", "/Notes"));
        assert!(!dropbox_path_is_strict_descendant("/Other", "/Notes"));

        let test_root = test_directory("directory-delete");
        let target = test_root.join("Archive");
        let nested = target.join("2026");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("note.md"), "# Note").unwrap();
        fs::write(nested.join("attachment.txt"), "attachment").unwrap();

        assert!(validate_directory_delete_target(&test_root, &test_root).is_err());
        let validated_target = validate_directory_delete_target(&target, &test_root).unwrap();
        assert_eq!(
            markdown_paths_in_directory(&validated_target)
                .unwrap()
                .len(),
            1
        );
        fs::remove_dir_all(&validated_target).unwrap();
        assert!(!target.exists());
        assert!(test_root.exists());

        fs::remove_dir_all(test_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn final_directory_symlink_delete_preserves_target_documents_and_notes() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("directory-link-delete");
        let target = unresolved_root.join("Target");
        let nested = target.join("Nested");
        fs::create_dir_all(&nested).unwrap();
        let body_path = nested.join("article.md");
        let sidecar_path = nested.join("article.md.notes.json");
        let private_notes_path = unresolved_root.join("app-data/article.notes.json");
        fs::create_dir_all(private_notes_path.parent().unwrap()).unwrap();
        fs::write(&body_path, "body").unwrap();
        fs::write(&sidecar_path, "sidecar").unwrap();
        fs::write(&private_notes_path, "private notes").unwrap();
        let alias = unresolved_root.join("Alias");
        symlink(&target, &alias).unwrap();

        let validated = validate_directory_delete_target(&alias, &unresolved_root).unwrap();
        assert_eq!(validated, alias);
        assert_eq!(
            resolved_local_directory_mutation_path(&validated).unwrap(),
            None
        );
        assert!(fs::symlink_metadata(&validated)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_file(&validated).unwrap();

        assert!(!alias.exists());
        assert!(target.is_dir());
        assert_eq!(fs::read_to_string(&body_path).unwrap(), "body");
        assert_eq!(fs::read_to_string(&sidecar_path).unwrap(), "sidecar");
        assert_eq!(
            fs::read_to_string(&private_notes_path).unwrap(),
            "private notes"
        );

        let parent_alias = unresolved_root.join("ParentAlias");
        symlink(&target, &parent_alias).unwrap();
        let through_parent_link = parent_alias.join("Nested");
        let validated_parent_path =
            validate_directory_delete_target(&through_parent_link, &unresolved_root).unwrap();
        assert_eq!(validated_parent_path, through_parent_link);
        assert_eq!(
            resolved_local_directory_mutation_path(&validated_parent_path)
                .unwrap()
                .unwrap(),
            fs::canonicalize(&nested).unwrap()
        );
        assert!(!fs::symlink_metadata(&validated_parent_path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(local_path_uses_symlink(&validated_parent_path).unwrap());

        fs::remove_dir_all(unresolved_root).unwrap();
    }

    #[test]
    fn parses_and_matches_frontmatter_tags() {
        assert_eq!(
            markdown_tags("---\ntags: [旅行, \"日本 行程\", 旅行]\n---\n內容"),
            vec!["旅行", "日本 行程"]
        );
        assert_eq!(
            markdown_tags("---\ntags:\n  - 旅行\n  - '日本 行程'\n---\n內容"),
            vec!["旅行", "日本 行程"]
        );

        let tags = markdown_tags("---\ntags: [旅行, 旅行規劃]\n---\n內容");
        let partial_matches = tags
            .iter()
            .filter(|tag| normalize_tag_search_value(tag).contains("旅行"))
            .collect::<Vec<_>>();
        let exact_matches = tags
            .iter()
            .filter(|tag| normalize_tag_search_value(tag) == "旅行")
            .collect::<Vec<_>>();
        assert_eq!(partial_matches.len(), 2);
        assert_eq!(exact_matches.len(), 1);
    }

    #[test]
    fn tag_search_requires_a_guard_while_filename_search_does_not() {
        let unresolved_root = test_directory("guarded-tag-search");
        let workspace = unresolved_root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(
            workspace.join("travel.md"),
            "---\ntags: [旅行, '日本 行程']\n---\n內容",
        )
        .unwrap();
        fs::write(workspace.join("meeting.md"), "# Meeting").unwrap();
        let root = fs::canonicalize(&workspace).unwrap();
        let recovery_directory = fs::canonicalize(&unresolved_root)
            .unwrap()
            .join("app-data/recovery/local");
        let guard = lock_local_documents(&recovery_directory).unwrap();

        let mut tag_results = Vec::new();
        search_markdown_directory(
            &root,
            &root,
            &normalize_tag_search_value("日本 行程"),
            Some(&guard),
            true,
            &mut tag_results,
        )
        .unwrap();

        assert_eq!(tag_results.len(), 1);
        assert_eq!(tag_results[0].relative_path, "travel.md");
        assert_eq!(tag_results[0].matched_tags, vec!["日本 行程"]);

        let mut filename_results = Vec::new();
        search_markdown_directory(&root, &root, "meeting", None, false, &mut filename_results)
            .unwrap();

        assert_eq!(filename_results.len(), 1);
        assert_eq!(filename_results[0].relative_path, "meeting.md");
        assert!(filename_results[0].matched_tags.is_empty());

        drop(guard);
        fs::remove_dir_all(unresolved_root).unwrap();
    }

    #[test]
    fn notes_v1_fixture_round_trips_without_schema_drift() {
        let raw_fixture = include_str!("../../tests/fixtures/notes-v1.json");
        let parsed: NotesFile = serde_json::from_str(raw_fixture).unwrap();

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.markdown_path, "/fixtures/article.md");
        assert_eq!(parsed.notes.len(), 1);
        assert_eq!(parsed.glossary_terms.len(), 1);
        assert_eq!(parsed.glossary_bindings.len(), 1);
        assert_eq!(
            parsed.glossary_bindings[0].term_id,
            parsed.glossary_terms[0].id
        );

        let fixture_value: serde_json::Value = serde_json::from_str(raw_fixture).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), fixture_value);
    }

    #[test]
    fn legacy_notes_v1_fixture_migrates_missing_glossary_fields() {
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1-legacy.json"))
                .unwrap();

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.markdown_path, "/fixtures/legacy-article.md");
        assert_eq!(parsed.notes.len(), 1);
        assert!(parsed.glossary_terms.is_empty());
        assert!(parsed.glossary_bindings.is_empty());

        let migrated = serde_json::to_value(parsed).unwrap();
        assert_eq!(migrated["glossaryTerms"], serde_json::json!([]));
        assert_eq!(migrated["glossaryBindings"], serde_json::json!([]));
    }

    #[test]
    fn saved_notes_and_bindings_use_the_manifest_document_id() {
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        let document_id = "/fixtures/renamed-article.md".to_string();

        let normalized = notes_file_for_document(
            document_id.clone(),
            parsed.notes,
            parsed.glossary_terms,
            parsed.glossary_bindings,
        );

        assert_eq!(normalized.markdown_path, document_id);
        assert!(normalized
            .notes
            .iter()
            .all(|note| note.document_id == normalized.markdown_path));
        assert!(normalized
            .glossary_bindings
            .iter()
            .all(|binding| binding.document_id == normalized.markdown_path));
    }

    #[test]
    fn equivalent_relative_and_dot_dot_paths_share_notes_identity() {
        let canonical_path =
            fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
        let current_directory = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let canonical_components = canonical_path.components().collect::<Vec<_>>();
        let current_components = current_directory.components().collect::<Vec<_>>();
        let common_length = canonical_components
            .iter()
            .zip(&current_components)
            .take_while(|(left, right)| left == right)
            .count();
        let mut relative_path = PathBuf::new();
        for _ in common_length..current_components.len() {
            relative_path.push("..");
        }
        for component in &canonical_components[common_length..] {
            relative_path.push(component.as_os_str());
        }
        let dot_dot_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("..")
            .join("Cargo.toml");

        assert!(!relative_path.is_absolute());
        assert_eq!(
            normalized_markdown_path_string(&relative_path),
            canonical_path.to_string_lossy()
        );
        assert_eq!(
            stable_notes_hash(&normalized_markdown_path_string(&relative_path)),
            stable_notes_hash(&normalized_markdown_path_string(&dot_dot_path))
        );
    }

    #[test]
    fn dot_dot_notes_keep_their_identity_across_rename_and_delete() {
        let unresolved_root = test_directory("dot-dot-notes");
        let workspace = unresolved_root.join("Dropbox/workspace");
        let app_data = unresolved_root.join("app-data");
        fs::create_dir_all(workspace.join("nested")).unwrap();
        let source_path = workspace.join("nested/../article.md");
        let target_path = workspace.join("nested/../renamed.md");
        fs::write(&source_path, "body").unwrap();

        let source_notes_path = app_data.join(NOTES_STORE_DIRECTORY).join(format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&source_path))
        ));
        let source_legacy_notes_path = legacy_sidecar_path(&source_path).unwrap();
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        let source_document_id = source_path.to_string_lossy().to_string();
        write_notes_file_at_paths(
            &source_path,
            source_notes_path.clone(),
            source_legacy_notes_path.clone(),
            notes_file_for_document(
                source_document_id,
                parsed.notes,
                parsed.glossary_terms,
                parsed.glossary_bindings,
            ),
        )
        .unwrap();
        let captured = CapturedDocumentNotes {
            notes_file: parse_notes_file(&source_notes_path).unwrap(),
            notes_path: source_notes_path.clone(),
            legacy_notes_path: source_legacy_notes_path.clone(),
        };

        fs::rename(&source_path, &target_path).unwrap();
        let missing_source_notes_path = app_data.join(NOTES_STORE_DIRECTORY).join(format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&source_path))
        ));
        assert_ne!(missing_source_notes_path, source_notes_path);

        let target_notes_path = app_data.join(NOTES_STORE_DIRECTORY).join(format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&target_path))
        ));
        let target_legacy_notes_path = legacy_sidecar_path(&target_path).unwrap();
        move_captured_document_notes_at_paths(
            captured,
            &target_path,
            target_notes_path.clone(),
            target_legacy_notes_path.clone(),
        )
        .unwrap();

        assert!(!source_notes_path.exists());
        assert!(!source_legacy_notes_path.exists());
        let moved = parse_notes_file(&target_notes_path).unwrap();
        let target_document_id = target_path.to_string_lossy().to_string();
        assert_eq!(moved.markdown_path, target_document_id);
        assert!(moved
            .notes
            .iter()
            .all(|note| note.document_id == moved.markdown_path));
        assert!(moved
            .glossary_bindings
            .iter()
            .all(|binding| binding.document_id == moved.markdown_path));
        assert!(target_legacy_notes_path.is_file());

        let deleted_notes_path = target_notes_path.clone();
        let deleted_legacy_notes_path = target_legacy_notes_path.clone();
        fs::remove_file(&target_path).unwrap();
        remove_document_notes_at_paths(target_notes_path, target_legacy_notes_path, false).unwrap();
        assert!(!deleted_notes_path.exists());
        assert!(!deleted_legacy_notes_path.exists());

        fs::remove_dir_all(unresolved_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_paths_use_the_legacy_storage_mode() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-policy");
        fs::create_dir_all(unresolved_root.join("Dropbox")).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let dropbox_directory = root.join("Dropbox");
        let target_path = dropbox_directory.join("article.md");
        fs::write(&target_path, "body").unwrap();
        let file_alias = dropbox_directory.join("alias.md");
        symlink(&target_path, &file_alias).unwrap();
        let parent_alias = root.join("DropboxAlias");
        symlink(&dropbox_directory, &parent_alias).unwrap();

        assert!(!local_path_uses_symlink(&target_path).unwrap());
        assert!(local_path_uses_symlink(&file_alias).unwrap());
        assert!(local_path_uses_symlink(&parent_alias.join("article.md")).unwrap());
        assert!(local_path_uses_symlink(&parent_alias.join("new.md")).unwrap());
        assert_eq!(
            resolved_local_document_path(&parent_alias.join("new.md")).unwrap(),
            dropbox_directory.join("new.md")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dangling_final_symlink_uses_referent_identity_and_blocks_target_collision() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("dangling-symlink");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let target_path = root.join("missing.md");
        let alias_path = root.join("alias.md");
        symlink(Path::new("missing.md"), &alias_path).unwrap();

        assert!(!alias_path.exists());
        assert!(fs::symlink_metadata(&alias_path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(local_path_uses_symlink(&alias_path).unwrap());
        assert_eq!(
            resolved_local_document_path(&alias_path).unwrap(),
            target_path
        );
        assert!(local_path_entry_exists(&alias_path).unwrap());
        assert!(!local_path_entry_exists(&target_path).unwrap());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_document_symlink_cycle_returns_a_stable_error() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-cycle");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let first_path = root.join("first.md");
        let second_path = root.join("second.md");
        symlink(Path::new("second.md"), &first_path).unwrap();
        symlink(Path::new("first.md"), &second_path).unwrap();

        assert_eq!(
            resolved_local_document_path(&first_path).unwrap_err(),
            "failed to resolve local Markdown path: too many symbolic links"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn notes_store_directory_symlink_never_accesses_external_files() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let unresolved_root = test_directory("notes-directory-symlink");
        let app_data_directory = unresolved_root.join("app-data");
        let external_directory = unresolved_root.join("external");
        fs::create_dir_all(&app_data_directory).unwrap();
        fs::create_dir_all(&external_directory).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let app_data_directory = root.join("app-data");
        let external_directory = root.join("external");
        let markdown_path = root.join("article.md");
        fs::write(&markdown_path, "body").unwrap();

        let notes_file_name = format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&markdown_path))
        );
        let external_notes_path = external_directory.join(&notes_file_name);
        let serialized = serde_json::to_string_pretty(&notes_file_for_document(
            markdown_path.to_string_lossy().to_string(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        ))
        .unwrap();
        fs::write(&external_notes_path, &serialized).unwrap();
        fs::set_permissions(&external_directory, fs::Permissions::from_mode(0o750)).unwrap();
        fs::set_permissions(&external_notes_path, fs::Permissions::from_mode(0o644)).unwrap();
        let original_directory_mode = fs::metadata(&external_directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let original_file_mode = fs::metadata(&external_notes_path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        symlink(
            &external_directory,
            app_data_directory.join(NOTES_STORE_DIRECTORY),
        )
        .unwrap();

        let read_result = notes_store_path_in_app_data(&app_data_directory, &markdown_path)
            .and_then(|path| parse_optional_notes_file(&path, true));
        assert!(read_result.is_err());
        assert_eq!(
            fs::read_to_string(&external_notes_path).unwrap(),
            serialized
        );
        assert_eq!(
            fs::metadata(&external_directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            original_directory_mode
        );
        assert_eq!(
            fs::metadata(&external_notes_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            original_file_mode
        );

        let populated_notes = || {
            let parsed: NotesFile =
                serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
            notes_file_for_document(
                markdown_path.to_string_lossy().to_string(),
                parsed.notes,
                parsed.glossary_terms,
                parsed.glossary_bindings,
            )
        };
        let legacy_notes_path = legacy_sidecar_path(&markdown_path).unwrap();
        let write_result = notes_store_path_in_app_data(&app_data_directory, &markdown_path)
            .and_then(|notes_path| {
                write_notes_file_at_paths(
                    &markdown_path,
                    notes_path,
                    legacy_notes_path.clone(),
                    populated_notes(),
                )
            });
        assert!(write_result.is_err());
        assert_eq!(
            fs::read_to_string(&external_notes_path).unwrap(),
            serialized
        );

        let remove_result = notes_store_path_in_app_data(&app_data_directory, &markdown_path)
            .and_then(|notes_path| {
                write_notes_file_at_paths(
                    &markdown_path,
                    notes_path,
                    legacy_notes_path,
                    notes_file_for_document(
                        markdown_path.to_string_lossy().to_string(),
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    ),
                )
            });
        assert!(remove_result.is_err());
        assert_eq!(
            fs::read_to_string(&external_notes_path).unwrap(),
            serialized
        );

        let new_markdown_path = root.join("new.md");
        fs::write(&new_markdown_path, "new body").unwrap();
        let new_external_notes_path = external_directory.join(format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&new_markdown_path))
        ));
        let create_result = notes_store_path_in_app_data(&app_data_directory, &new_markdown_path)
            .and_then(|notes_path| {
                write_notes_file_at_paths(
                    &new_markdown_path,
                    notes_path,
                    legacy_sidecar_path(&new_markdown_path)?,
                    populated_notes(),
                )
            });
        assert!(create_result.is_err());
        assert!(!new_external_notes_path.exists());
        assert_eq!(
            fs::read_to_string(&external_notes_path).unwrap(),
            serialized
        );
        assert_eq!(
            fs::metadata(&external_directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            original_directory_mode
        );
        assert_eq!(
            fs::metadata(&external_notes_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            original_file_mode
        );
        assert!(
            fs::symlink_metadata(app_data_directory.join(NOTES_STORE_DIRECTORY))
                .unwrap()
                .file_type()
                .is_symlink()
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn existing_notes_store_files_remain_readable_and_writable() {
        use std::os::unix::fs::PermissionsExt;

        let unresolved_root = test_directory("existing-notes-store");
        let app_data_directory = unresolved_root.join("app-data");
        let notes_directory = app_data_directory.join(NOTES_STORE_DIRECTORY);
        fs::create_dir_all(&notes_directory).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let app_data_directory = root.join("app-data");
        let notes_directory = app_data_directory.join(NOTES_STORE_DIRECTORY);
        let markdown_path = root.join("article.md");
        fs::write(&markdown_path, "body").unwrap();
        fs::set_permissions(&notes_directory, fs::Permissions::from_mode(0o755)).unwrap();

        let expected_notes_path = notes_directory.join(format!(
            "{:016x}.notes.json",
            stable_notes_hash(&normalized_markdown_path_string(&markdown_path))
        ));
        let existing = notes_file_for_document(
            markdown_path.to_string_lossy().to_string(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        fs::write(
            &expected_notes_path,
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        let notes_path = notes_store_path_in_app_data(&app_data_directory, &markdown_path).unwrap();
        assert_eq!(notes_path, expected_notes_path);
        assert_eq!(
            fs::metadata(&notes_directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            parse_optional_notes_file(&notes_path, true)
                .unwrap()
                .unwrap()
                .markdown_path,
            markdown_path.to_string_lossy()
        );

        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        write_notes_file_at_paths(
            &markdown_path,
            notes_path.clone(),
            legacy_sidecar_path(&markdown_path).unwrap(),
            notes_file_for_document(
                markdown_path.to_string_lossy().to_string(),
                parsed.notes,
                parsed.glossary_terms,
                parsed.glossary_bindings,
            ),
        )
        .unwrap();
        assert!(!parse_notes_file(&notes_path).unwrap().notes.is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn notes_reader_never_follows_final_symlinks() {
        use std::os::unix::fs::symlink;

        let root = test_directory("notes-read-symlink");
        fs::create_dir_all(&root).unwrap();
        let referent = root.join("referent.json");
        let notes_path = root.join("article.md.notes.json");
        let dangling_referent = root.join("missing.json");
        let serialized = serde_json::to_string_pretty(&notes_file_for_document(
            "article.md".to_string(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        ))
        .unwrap();
        fs::write(&referent, &serialized).unwrap();
        symlink(&referent, &notes_path).unwrap();

        assert!(parse_optional_notes_file(&notes_path, false)
            .unwrap()
            .is_none());
        assert_eq!(fs::read_to_string(&referent).unwrap(), serialized);

        fs::remove_file(&notes_path).unwrap();
        symlink(&dangling_referent, &notes_path).unwrap();
        assert!(parse_optional_notes_file(&notes_path, false)
            .unwrap()
            .is_none());

        fs::remove_file(&notes_path).unwrap();
        fs::write(&notes_path, &serialized).unwrap();
        assert_eq!(
            parse_optional_notes_file(&notes_path, false)
                .unwrap()
                .unwrap()
                .markdown_path,
            "article.md"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn legacy_sidecar_writes_and_removals_never_follow_symlinks() {
        use std::os::unix::fs::{symlink, MetadataExt};

        let unresolved_root = test_directory("sidecar-symlink");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let target_path = root.join("target.json");
        let sidecar_path = root.join("article.md.notes.json");
        fs::write(&target_path, "target contents").unwrap();
        symlink(&target_path, &sidecar_path).unwrap();

        write_legacy_sidecar(&sidecar_path, "sidecar contents").unwrap();
        assert_eq!(fs::read_to_string(&target_path).unwrap(), "target contents");
        assert_eq!(
            fs::read_to_string(&sidecar_path).unwrap(),
            "sidecar contents"
        );
        assert!(!fs::symlink_metadata(&sidecar_path)
            .unwrap()
            .file_type()
            .is_symlink());

        let sidecar_inode = fs::metadata(&sidecar_path).unwrap().ino();
        write_legacy_sidecar(&sidecar_path, "updated sidecar").unwrap();
        assert_eq!(fs::metadata(&sidecar_path).unwrap().ino(), sidecar_inode);

        remove_file_if_present(&sidecar_path).unwrap();
        let dangling_target = root.join("missing.json");
        symlink(&dangling_target, &sidecar_path).unwrap();
        remove_file_if_present(&sidecar_path).unwrap();
        assert!(fs::symlink_metadata(&sidecar_path).is_err());
        assert!(!dangling_target.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn duplicate_target_policy_is_not_inherited_from_source_symlink() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-duplicate-policy");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let canonical_source = root.join("article.md");
        fs::write(&canonical_source, "body").unwrap();
        let source_alias = root.join("alias.md");
        symlink(&canonical_source, &source_alias).unwrap();
        let duplicate_target = source_alias.with_file_name("copy.md");

        assert!(local_path_uses_symlink(&source_alias).unwrap());
        assert!(!local_path_uses_symlink(&duplicate_target).unwrap());
        fs::copy(&source_alias, &duplicate_target).unwrap();
        assert!(!local_path_uses_symlink(&duplicate_target).unwrap());
        assert_eq!(fs::read_to_string(&duplicate_target).unwrap(), "body");

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn final_file_symlink_delete_preserves_target_private_notes() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-file-delete");
        fs::create_dir_all(unresolved_root.join("Dropbox")).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let target_path = root.join("Dropbox/article.md");
        fs::write(&target_path, "body").unwrap();
        let alias_path = root.join("Dropbox/alias.md");
        symlink(&target_path, &alias_path).unwrap();
        let notes_path = root.join("app-data/article.notes.json");
        let alias_sidecar_path = legacy_sidecar_path(&alias_path).unwrap();
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            alias_sidecar_path.clone(),
            notes_file_for_document(
                alias_path.to_string_lossy().to_string(),
                parsed.notes,
                parsed.glossary_terms,
                parsed.glossary_bindings,
            ),
        )
        .unwrap();
        assert!(notes_path.is_file());
        assert!(alias_sidecar_path.is_file());

        let deletes_file_link = fs::symlink_metadata(&alias_path)
            .unwrap()
            .file_type()
            .is_symlink();
        fs::remove_file(&alias_path).unwrap();
        remove_document_notes_at_paths(
            notes_path.clone(),
            alias_sidecar_path.clone(),
            deletes_file_link,
        )
        .unwrap();

        assert!(target_path.is_file());
        assert!(notes_path.is_file());
        assert!(!alias_sidecar_path.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_legacy_empty_save_keeps_private_tombstone_and_removes_sidecar() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-empty-notes");
        fs::create_dir_all(unresolved_root.join("Dropbox")).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let target_path = root.join("Dropbox/article.md");
        fs::write(&target_path, "body").unwrap();
        let alias_path = root.join("Dropbox/alias.md");
        symlink(&target_path, &alias_path).unwrap();
        let notes_path = root.join("app-data/article.notes.json");
        let sidecar_path = legacy_sidecar_path(&alias_path).unwrap();
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        let document_id = alias_path.to_string_lossy().to_string();
        let nonempty = notes_file_for_document(
            document_id.clone(),
            parsed.notes,
            parsed.glossary_terms,
            parsed.glossary_bindings,
        );

        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            sidecar_path.clone(),
            nonempty,
        )
        .unwrap();
        assert!(notes_path.is_file());
        assert!(sidecar_path.is_file());

        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            sidecar_path.clone(),
            notes_file_for_document(document_id, Vec::new(), Vec::new(), Vec::new()),
        )
        .unwrap();
        let tombstone = parse_notes_file(&notes_path).unwrap();
        assert!(notes_file_is_empty(&tombstone));
        assert_eq!(
            tombstone.markdown_path,
            target_path.to_string_lossy().to_string()
        );
        assert!(!sidecar_path.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn empty_dropbox_api_sidecar_in_local_folder_is_removed_on_open() {
        let unresolved_root = test_directory("dropbox-api-empty-sidecar");
        fs::create_dir_all(unresolved_root.join("Dropbox/Notes")).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let markdown_path = root.join("Dropbox/Notes/article.md");
        fs::write(&markdown_path, "# Article").unwrap();
        let sidecar_path = legacy_sidecar_path(&markdown_path).unwrap();
        let dropbox_document_id = "dropbox:/Notes/article.md";
        let sidecar_notes = notes_file_for_document(
            dropbox_document_id.to_string(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        fs::write(
            &sidecar_path,
            serde_json::to_string_pretty(&sidecar_notes).unwrap(),
        )
        .unwrap();
        let recovery_directory = root.join("app-data/recovery/local");
        let paths = LocalDocumentPaths::new(
            markdown_path.clone(),
            root.join("app-data/notes/article.notes.json"),
            sidecar_path.clone(),
            true,
        );
        let guard = lock_local_documents(&recovery_directory).unwrap();

        let document_id = empty_sidecar_document_id(dropbox_document_id, &markdown_path);
        assert_eq!(document_id, markdown_path.to_string_lossy());
        assert!(
            repair_local_sidecar(&guard, &recovery_directory, &paths, document_id, None).unwrap()
        );
        assert!(!sidecar_path.exists());
        assert_eq!(
            empty_sidecar_document_id(&markdown_path.to_string_lossy(), &markdown_path),
            markdown_path.to_string_lossy()
        );

        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_and_canonical_empty_saves_do_not_revive_each_others_sidecars() {
        use std::os::unix::fs::symlink;

        let unresolved_root = test_directory("symlink-canonical-notes");
        fs::create_dir_all(unresolved_root.join("Dropbox")).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let target_path = root.join("Dropbox/article.md");
        fs::write(&target_path, "body").unwrap();
        let alias_path = root.join("Dropbox/alias.md");
        symlink(&target_path, &alias_path).unwrap();
        let notes_path = root.join("app-data/notes/article.notes.json");
        let alias_sidecar_path = legacy_sidecar_path(&alias_path).unwrap();
        let canonical_sidecar_path = legacy_sidecar_path(&target_path).unwrap();
        let recovery_directory = root.join("app-data/recovery/local");
        let parsed: NotesFile =
            serde_json::from_str(include_str!("../../tests/fixtures/notes-v1.json")).unwrap();
        let alias_document_id = alias_path.to_string_lossy().to_string();
        let nonempty = notes_file_for_document(
            alias_document_id.clone(),
            parsed.notes,
            parsed.glossary_terms,
            parsed.glossary_bindings,
        );

        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            alias_sidecar_path.clone(),
            nonempty,
        )
        .unwrap();
        let guard = lock_local_documents(&recovery_directory).unwrap();
        let canonical_paths = LocalDocumentPaths::new(
            target_path.clone(),
            notes_path.clone(),
            canonical_sidecar_path.clone(),
            true,
        );
        repair_local_sidecar(
            &guard,
            &recovery_directory,
            &canonical_paths,
            alias_document_id.clone(),
            Some(fs::read_to_string(&notes_path).unwrap()),
        )
        .unwrap();
        assert!(canonical_sidecar_path.is_file());

        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            alias_sidecar_path.clone(),
            notes_file_for_document(
                alias_document_id.clone(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
        )
        .unwrap();

        let alias_empty_tombstone = parse_notes_file(&notes_path).unwrap();
        assert!(notes_file_is_empty(&alias_empty_tombstone));
        assert_eq!(
            alias_empty_tombstone.markdown_path,
            target_path.to_string_lossy().to_string()
        );
        assert!(!alias_sidecar_path.exists());
        assert!(!canonical_sidecar_path.exists());

        write_notes_file_at_paths(
            &alias_path,
            notes_path.clone(),
            alias_sidecar_path.clone(),
            notes_file_for_document(
                alias_document_id.clone(),
                serde_json::from_str::<NotesFile>(include_str!(
                    "../../tests/fixtures/notes-v1.json"
                ))
                .unwrap()
                .notes,
                Vec::new(),
                Vec::new(),
            ),
        )
        .unwrap();
        repair_local_sidecar(
            &guard,
            &recovery_directory,
            &canonical_paths,
            alias_document_id,
            Some(fs::read_to_string(&notes_path).unwrap()),
        )
        .unwrap();
        assert!(alias_sidecar_path.is_file());
        assert!(canonical_sidecar_path.is_file());

        let canonical_document_id = target_path.to_string_lossy().to_string();
        let empty_notes = notes_file_for_document(
            canonical_document_id.clone(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        save_local_document(
            &guard,
            &recovery_directory,
            canonical_paths,
            LocalDocumentPayload::new(
                canonical_document_id,
                "body".to_string(),
                Some(serde_json::to_string_pretty(&empty_notes).unwrap()),
            ),
        )
        .unwrap();
        assert!(notes_file_is_empty(&parse_notes_file(&notes_path).unwrap()));
        assert!(!canonical_sidecar_path.exists());
        assert!(alias_sidecar_path.exists());

        let reopened_through_alias = parse_notes_file(&notes_path).unwrap();
        mirror_notes_file_to_local_dropbox_sidecar_legacy(&alias_path, &reopened_through_alias)
            .unwrap();
        assert!(notes_file_is_empty(&reopened_through_alias));
        assert!(!alias_sidecar_path.exists());

        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn regular_non_dropbox_empty_save_still_removes_private_notes() {
        let unresolved_root = test_directory("regular-empty-notes");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let markdown_path = root.join("article.md");
        fs::write(&markdown_path, "body").unwrap();
        let notes_path = root.join("app-data/article.notes.json");
        let sidecar_path = legacy_sidecar_path(&markdown_path).unwrap();
        fs::create_dir_all(notes_path.parent().unwrap()).unwrap();
        fs::write(&notes_path, "old notes").unwrap();
        fs::write(&sidecar_path, "old sidecar").unwrap();

        write_notes_file_at_paths(
            &markdown_path,
            notes_path.clone(),
            sidecar_path.clone(),
            notes_file_for_document(
                markdown_path.to_string_lossy().to_string(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
        )
        .unwrap();

        assert!(!notes_path.exists());
        assert!(!sidecar_path.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dropbox_list_folder_fixture_matches_the_api_schema() {
        let raw_fixture = include_str!("../../tests/fixtures/dropbox-list-folder.json");
        let parsed: DropboxListFolderResponse = serde_json::from_str(raw_fixture).unwrap();

        assert_eq!(parsed.cursor, "fixture-cursor");
        assert!(!parsed.has_more);
        assert_eq!(parsed.entries.len(), 2);
        assert!(matches!(
            &parsed.entries[0],
            DropboxMetadata::Folder { name, path_display, .. }
                if name == "Notes" && path_display.as_deref() == Some("/Notes")
        ));
        assert!(matches!(
            &parsed.entries[1],
            DropboxMetadata::File {
                name,
                size: Some(128),
                is_downloadable: Some(true),
                ..
            } if name == "article.md"
        ));
    }

    #[test]
    fn parses_dropbox_mobile_callback() {
        let callback =
            Url::parse("db-bdv6guwbi6ol9mg://2/token?code=authorization-code&state=csrf-state")
                .unwrap();
        let payload = dropbox_oauth_callback_from_url(&callback);

        assert_eq!(callback.scheme(), DROPBOX_MOBILE_URL_SCHEME);
        assert_eq!(payload.status, "success");
        assert_eq!(payload.code.as_deref(), Some("authorization-code"));
        assert_eq!(payload.state.as_deref(), Some("csrf-state"));
        assert!(payload.error.is_none());

        let session = DropboxOAuthSession {
            app_key: "app-key".to_string(),
            code_verifier: "verifier".to_string(),
            connection_snapshot: DropboxTokenState::default().connection_snapshot(),
            owner_window_label: "main".to_string(),
            redirect_uri: "db-bdv6guwbi6ol9mg://2/token".to_string(),
            state: "csrf-state".to_string(),
        };
        assert!(dropbox_oauth_callback_matches_session(&session, &payload));
        assert!(!dropbox_oauth_callback_ends_session(&payload));

        let denied_callback =
            Url::parse("db-bdv6guwbi6ol9mg://2/token?error=access_denied&state=csrf-state")
                .unwrap();
        let denied_payload = dropbox_oauth_callback_from_url(&denied_callback);
        assert_eq!(denied_payload.status, "error");
        assert_eq!(denied_payload.state.as_deref(), Some("csrf-state"));
        assert!(dropbox_oauth_callback_matches_session(
            &session,
            &denied_payload
        ));
        assert!(dropbox_oauth_callback_ends_session(&denied_payload));

        let wrong_state = dropbox_oauth_callback_from_url(
            &Url::parse("db-bdv6guwbi6ol9mg://2/token?code=code&state=wrong-state").unwrap(),
        );
        assert!(!dropbox_oauth_callback_matches_session(
            &session,
            &wrong_state
        ));

        let missing_state = dropbox_oauth_callback_from_url(
            &Url::parse("db-bdv6guwbi6ol9mg://2/token?code=code").unwrap(),
        );
        assert!(!dropbox_oauth_callback_matches_session(
            &session,
            &missing_state
        ));
    }
}
