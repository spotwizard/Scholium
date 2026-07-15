use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(desktop)]
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[cfg(desktop)]
const MENU_NEW_WINDOW: &str = "file:new-window";
const MENU_NEW_FILE: &str = "file:new-file";
const MENU_OPEN_FILE: &str = "file:open-file";
const MENU_OPEN_FOLDER: &str = "file:open-folder";
const MENU_CLOUD_DROPBOX: &str = "file:cloud:dropbox";
const MENU_OPEN_SETTINGS: &str = "app:open-settings";
const MENU_FAVORITE_DIRECTORIES: &str = "file:favorite-directories";
const MENU_RECENT_LOCATIONS: &str = "file:recent-locations";
const MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES: &str = "file:add-current-directory-to-favorites";
const MENU_CLEAR_FAVORITE_DIRECTORIES: &str = "file:clear-favorite-directories";
const MENU_CLEAR_RECENT_LOCATIONS: &str = "file:clear-recent-locations";
const MENU_FAVORITE_DIRECTORY_PREFIX: &str = "file:favorite-directory:";
const MENU_RECENT_LOCATION_PREFIX: &str = "file:recent-location:";
const MAX_RECENT_LOCATIONS: usize = 12;
const MAX_FILE_SEARCH_RESULTS: usize = 200;
const MAX_LOCAL_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const NOTES_STORE_DIRECTORY: &str = "notes";
const DEFAULT_APP_LANGUAGE: &str = "zh-Hant";
const DROPBOX_OAUTH_REDIRECT_PORT: u16 = 53682;
const DROPBOX_OAUTH_CALLBACK_PATH: &str = "/dropbox/oauth/callback";
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
    redirect_uri: String,
    state: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DropboxTokenStore {
    app_key: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
}

#[derive(Default)]
struct DropboxState {
    oauth_session: Mutex<Option<DropboxOAuthSession>>,
    tokens: Mutex<Option<DropboxTokenStore>>,
}

#[derive(Default)]
struct OpenedFileQueue {
    frontend_ready: bool,
    pending_paths: Vec<String>,
}

#[derive(Default)]
struct OpenedFileState(Mutex<OpenedFileQueue>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenLocationPayload {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritePdfFile {
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalImageFile {
    path: String,
    mime_type: String,
    data_url: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Deserialize)]
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

fn validate_markdown_file_name(file_name: &str) -> Result<PathBuf, String> {
    let trimmed_file_name = file_name.trim();
    if trimmed_file_name.is_empty() {
        return Err("duplicate file name is empty".to_string());
    }

    let file_name_path = PathBuf::from(trimmed_file_name);
    if file_name_path.components().count() != 1 {
        return Err("duplicate file name must not include folders".to_string());
    }

    Ok(file_name_path)
}

fn validate_path_name(
    name: &str,
    empty_error: &str,
    folders_error: &str,
) -> Result<PathBuf, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(empty_error.to_string());
    }

    let name_path = PathBuf::from(trimmed_name);
    if name_path.components().count() != 1 {
        return Err(folders_error.to_string());
    }

    Ok(name_path)
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

fn notes_store_path(app: &AppHandle, markdown_path: &Path) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let normalized_path = normalized_markdown_path_string(markdown_path);
    let notes_file_name = format!("{:016x}.notes.json", stable_notes_hash(&normalized_path));

    Ok(app_data_dir
        .join(NOTES_STORE_DIRECTORY)
        .join(notes_file_name))
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
        markdown_path: document_path,
        notes: notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .collect(),
        glossary_terms,
        glossary_bindings: glossary_bindings
            .into_iter()
            .filter(|binding| binding.status != "deleted")
            .collect(),
    }
}

fn path_is_local_dropbox_synced_path(markdown_path: &Path) -> bool {
    let normalized_path = normalized_markdown_path_string(markdown_path).replace('\\', "/");
    let normalized_path = normalized_path.to_lowercase();

    normalized_path.contains("/dropbox/")
        || normalized_path.contains("/library/cloudstorage/dropbox/")
}

fn mirror_notes_file_to_local_dropbox_sidecar(
    markdown_path: &Path,
    notes_file: &NotesFile,
) -> Result<(), String> {
    if !path_is_local_dropbox_synced_path(markdown_path) {
        return Ok(());
    }

    let sidecar_path = legacy_sidecar_path(markdown_path)?;
    if notes_file_is_empty(notes_file) {
        if sidecar_path.exists() {
            fs::remove_file(&sidecar_path)
                .map_err(|error| format!("failed to remove Dropbox sidecar notes: {error}"))?;
        }
        return Ok(());
    }

    let serialized = serde_json::to_string_pretty(notes_file)
        .map_err(|error| format!("failed to serialize Dropbox sidecar notes: {error}"))?;
    fs::write(&sidecar_path, serialized)
        .map_err(|error| format!("failed to write Dropbox sidecar notes: {error}"))
}

fn read_document_notes(
    app: &AppHandle,
    markdown_path: &Path,
) -> Result<
    (
        String,
        Vec<SelectionNote>,
        Vec<GlossaryTerm>,
        Vec<GlossaryBinding>,
    ),
    String,
> {
    let notes_path = notes_store_path(app, markdown_path)?;
    let notes_file = read_notes_file(app, markdown_path)?;
    let (notes, glossary_terms, glossary_bindings) = match notes_file {
        Some(notes_file) => {
            mirror_notes_file_to_local_dropbox_sidecar(markdown_path, &notes_file)?;
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

fn write_document_notes(
    app: &AppHandle,
    markdown_path: &Path,
    document_path: String,
    notes: Vec<SelectionNote>,
    glossary_terms: Vec<GlossaryTerm>,
    glossary_bindings: Vec<GlossaryBinding>,
) -> Result<PathBuf, String> {
    let notes_file =
        notes_file_for_document(document_path, notes, glossary_terms, glossary_bindings);
    let notes_path = write_notes_file(app, markdown_path, notes_file.clone())?;

    mirror_notes_file_to_local_dropbox_sidecar(markdown_path, &notes_file)?;

    Ok(notes_path)
}

fn remove_document_notes(app: &AppHandle, markdown_path: &Path) -> Result<PathBuf, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    let legacy_notes_path = legacy_sidecar_path(markdown_path)?;

    if notes_path.exists() {
        fs::remove_file(&notes_path).map_err(|error| format!("failed to delete notes: {error}"))?;
    }

    if legacy_notes_path.exists() {
        fs::remove_file(&legacy_notes_path)
            .map_err(|error| format!("failed to delete legacy sidecar notes: {error}"))?;
    }

    Ok(notes_path)
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

fn dropbox_redirect_uri() -> String {
    format!("http://127.0.0.1:{DROPBOX_OAUTH_REDIRECT_PORT}{DROPBOX_OAUTH_CALLBACK_PATH}")
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
    let raw_store = fs::read_to_string(store_path).ok()?;

    serde_json::from_str(&raw_store).ok()
}

fn replace_dropbox_tokens(
    app_handle: &tauri::AppHandle,
    tokens: Option<DropboxTokenStore>,
) -> Result<(), String> {
    let state = app_handle.state::<DropboxState>();
    let mut current_tokens = state
        .tokens
        .lock()
        .map_err(|_| "failed to lock Dropbox token store".to_string())?;

    *current_tokens = tokens;
    Ok(())
}

fn write_dropbox_tokens(
    app_handle: &tauri::AppHandle,
    tokens: &DropboxTokenStore,
) -> Result<(), String> {
    let store_path = dropbox_token_store_path(app_handle)?;
    let serialized = serde_json::to_string_pretty(tokens)
        .map_err(|error| format!("failed to serialize Dropbox tokens: {error}"))?;

    fs::write(store_path, serialized)
        .map_err(|error| format!("failed to write Dropbox tokens: {error}"))
}

fn remove_dropbox_tokens(app_handle: &tauri::AppHandle) -> Result<(), String> {
    replace_dropbox_tokens(app_handle, None)?;

    let store_path = dropbox_token_store_path(app_handle)?;
    if store_path.exists() {
        fs::remove_file(store_path)
            .map_err(|error| format!("failed to remove Dropbox tokens: {error}"))?;
    }

    Ok(())
}

fn current_dropbox_tokens(
    app_handle: &tauri::AppHandle,
) -> Result<Option<DropboxTokenStore>, String> {
    app_handle
        .state::<DropboxState>()
        .tokens
        .lock()
        .map(|tokens| tokens.clone())
        .map_err(|_| "failed to lock Dropbox token store".to_string())
}

fn dropbox_oauth_callback_payload(error: String) -> DropboxOAuthCallbackPayload {
    DropboxOAuthCallbackPayload {
        status: "error".to_string(),
        code: None,
        state: None,
        error: Some(error),
    }
}

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

fn wait_for_dropbox_oauth_callback(listener: TcpListener) -> DropboxOAuthCallbackPayload {
    if let Err(error) = listener.set_nonblocking(true) {
        return dropbox_oauth_callback_payload(format!(
            "failed to prepare Dropbox callback listener: {error}"
        ));
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
                        return dropbox_oauth_callback_payload(format!(
                            "failed to read Dropbox callback: {error}"
                        ));
                    }
                };
                let request = String::from_utf8_lossy(&buffer[..read_bytes]);
                let request_target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1));
                let Some(request_target) = request_target else {
                    let _ = write_dropbox_oauth_http_response(&mut stream, false);
                    return dropbox_oauth_callback_payload(
                        "Dropbox callback request was empty".to_string(),
                    );
                };
                let Ok(url) = Url::parse(&format!("http://127.0.0.1{request_target}")) else {
                    let _ = write_dropbox_oauth_http_response(&mut stream, false);
                    return dropbox_oauth_callback_payload(
                        "Dropbox callback URL could not be parsed".to_string(),
                    );
                };
                let query_pairs: std::collections::HashMap<String, String> =
                    url.query_pairs().into_owned().collect();
                let code = query_pairs.get("code").cloned();
                let state = query_pairs.get("state").cloned();
                let error = query_pairs
                    .get("error_description")
                    .or_else(|| query_pairs.get("error"))
                    .cloned();
                let is_success = code.is_some() && error.is_none();
                let _ = write_dropbox_oauth_http_response(&mut stream, is_success);

                if let Some(error) = error {
                    return dropbox_oauth_callback_payload(error);
                }

                if code.is_none() {
                    return dropbox_oauth_callback_payload(
                        "Dropbox callback did not include an authorization code".to_string(),
                    );
                }

                return DropboxOAuthCallbackPayload {
                    status: "success".to_string(),
                    code,
                    state,
                    error: None,
                };
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return dropbox_oauth_callback_payload(
                        "Dropbox authorization timed out".to_string(),
                    );
                }

                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return dropbox_oauth_callback_payload(format!(
                    "failed to accept Dropbox callback: {error}"
                ));
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

    if let Ok(parsed) = serde_json::from_str::<DropboxErrorResponse>(&raw_body) {
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
    tokens: DropboxTokenStore,
) -> Result<DropboxTokenStore, String> {
    let refresh_token = tokens
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
        ("client_id", tokens.app_key.as_str()),
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
        app_key: tokens.app_key,
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token.or(tokens.refresh_token),
        expires_at: token_response
            .expires_in
            .map(|expires_in| now_unix_seconds() + expires_in),
    };

    replace_dropbox_tokens(app_handle, Some(refreshed_tokens.clone()))?;
    write_dropbox_tokens(app_handle, &refreshed_tokens)?;

    Ok(refreshed_tokens)
}

async fn dropbox_access_token(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let tokens = current_dropbox_tokens(app_handle)?
        .ok_or_else(|| "Dropbox is not connected.".to_string())?;
    let tokens = if tokens_expire_soon(&tokens) {
        refresh_dropbox_access_token(app_handle, tokens).await?
    } else {
        tokens
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

fn is_markdown_dropbox_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "md" | "markdown" | "mdown"
            )
        })
        .unwrap_or(false)
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
        read_document_notes(app, &notes_markdown_path)?;

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
) -> Result<
    (
        String,
        Vec<SelectionNote>,
        Vec<GlossaryTerm>,
        Vec<GlossaryBinding>,
    ),
    String,
> {
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

    read_document_notes(app, &notes_markdown_path)
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
    if !is_markdown_dropbox_path(&normalized_path) {
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

async fn read_dropbox_list_page(
    client: &reqwest::Client,
    access_token: &str,
    path: &str,
) -> Result<DropboxListFolderResponse, String> {
    let response = client
        .post(DROPBOX_LIST_FOLDER_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "path": path,
            "recursive": false,
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
        ("en", "openFile") => "Open File",
        ("en", "openFolder") => "Open Folder",
        ("en", "cloud") => "Cloud",
        ("en", "dropbox") => "Dropbox",
        ("en", "settings") => "Settings...",
        ("en", "fileMenu") => "File",
        ("en", "editMenu") => "Edit",
        ("en", "viewMenu") => "View",
        ("en", "windowMenu") => "Window",
        ("en", "helpMenu") => "Help",
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
        ("zh-Hans", "openFile") => "打开文件",
        ("zh-Hans", "openFolder") => "打开文件夹",
        ("zh-Hans", "cloud") => "云端",
        ("zh-Hans", "dropbox") => "Dropbox",
        ("zh-Hans", "settings") => "设置...",
        ("zh-Hans", "fileMenu") => "文件",
        ("zh-Hans", "editMenu") => "编辑",
        ("zh-Hans", "viewMenu") => "视图",
        ("zh-Hans", "windowMenu") => "窗口",
        ("zh-Hans", "helpMenu") => "帮助",
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
        (_, "openFile") => "開啟檔案",
        (_, "openFolder") => "開啟資料夾",
        (_, "cloud") => "雲端",
        (_, "dropbox") => "Dropbox",
        (_, "settings") => "設定...",
        (_, "fileMenu") => "檔案",
        (_, "editMenu") => "編輯",
        (_, "viewMenu") => "檢視",
        (_, "windowMenu") => "視窗",
        (_, "helpMenu") => "說明",
        _ => "",
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

    let window = tauri::WebviewWindowBuilder::from_config(app_handle, &window_config)
        .map_err(|error| format!("failed to prepare new window: {error}"))?
        .fullscreen(start_fullscreen)
        .focused(true)
        .build()
        .map_err(|error| format!("failed to create new window: {error}"))?;

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

    webview_windows
        .iter()
        .find_map(|(label, window)| match window.is_focused() {
            Ok(true) => Some(label.clone()),
            _ => None,
        })
        .or_else(|| webview_windows.keys().next().cloned())
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
    language: &str,
) -> Result<LocationEntry, String> {
    if kind != "directory" && kind != "file" {
        return Err("unsupported location kind".to_string());
    }

    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("location path is empty".to_string());
    }

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
    let Ok(raw_store) = fs::read_to_string(store_path) else {
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

    fs::write(store_path, serialized)
        .map_err(|error| format!("failed to write location store: {error}"))
}

fn recent_location_exists(location: &LocationEntry) -> bool {
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

    store
        .recent
        .retain(|location| location.kind != entry.kind || location.path != entry.path);
    store.recent.insert(0, entry);
    store.recent.truncate(MAX_RECENT_LOCATIONS);

    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

fn remember_favorite_directory_entry(
    app_handle: &tauri::AppHandle,
    entry: LocationEntry,
) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store
        .favorite_directories
        .retain(|location| location.path != entry.path);
    store.favorite_directories.insert(0, entry);

    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

fn clear_recent_locations(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store.recent.clear();
    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

fn clear_favorite_directories(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let mut store = current_location_store(app_handle);

    store.favorite_directories.clear();
    replace_current_location_store(app_handle, store.clone())?;
    write_location_store(app_handle, &store)?;
    refresh_app_menu(app_handle)
}

fn location_menu_label(location: &LocationEntry) -> String {
    let path = Path::new(&location.path);
    let parent = path
        .parent()
        .and_then(|parent| parent.to_str())
        .filter(|parent| !parent.is_empty());

    match parent {
        Some(parent) => format!("{} — {}", location.title, parent),
        None => location.title.clone(),
    }
}

fn indexed_location<'a>(
    locations: &'a [LocationEntry],
    event_id: &str,
    prefix: &str,
) -> Option<&'a LocationEntry> {
    let index = event_id.strip_prefix(prefix)?.parse::<usize>().ok()?;

    locations.get(index)
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "md" | "markdown" | "mdown"
            )
        })
        .unwrap_or(false)
}

fn dropped_markdown_path(paths: &[String]) -> Result<&Path, String> {
    let [path] = paths else {
        return Err("drop requires exactly one .md file".to_string());
    };
    let path = Path::new(path);

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err("dropped file must use the .md extension".to_string());
    }

    Ok(path)
}

fn hex_digit_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn decode_url_path(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (
                hex_digit_value(bytes[index + 1]),
                hex_digit_value(bytes[index + 2]),
            ) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).to_string()
}

fn strip_local_url_suffix(src: &str) -> &str {
    let query_index = src.find('?').unwrap_or(src.len());
    let fragment_index = src.find('#').unwrap_or(src.len());
    let end_index = query_index.min(fragment_index);

    &src[..end_index]
}

fn local_image_mime_type(path: &Path) -> Option<&'static str> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| match extension.to_lowercase().as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "webp" => Some("image/webp"),
            "bmp" => Some("image/bmp"),
            "avif" => Some("image/avif"),
            _ => None,
        })
}

fn markdown_image_file_path(markdown_path: &Path, image_src: &str) -> Result<PathBuf, String> {
    let trimmed_src = image_src.trim();
    if trimmed_src.is_empty() {
        return Err("image source is empty".to_string());
    }

    let local_src = strip_local_url_suffix(trimmed_src);
    if local_src.is_empty() {
        return Err("image source is empty".to_string());
    }

    if let Ok(url) = Url::parse(local_src) {
        if url.scheme() != "file" {
            return Err("image source is not a local file".to_string());
        }

        return url
            .to_file_path()
            .map_err(|_| "failed to resolve file image source".to_string());
    }

    let decoded_src = decode_url_path(local_src);
    let image_path = PathBuf::from(decoded_src);
    if image_path.is_absolute() {
        return Ok(image_path);
    }

    let markdown_directory = markdown_path
        .parent()
        .ok_or_else(|| "Markdown file has no parent directory".to_string())?;

    Ok(markdown_directory.join(image_path))
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

fn search_markdown_directory(
    root: &Path,
    directory: &Path,
    query: &str,
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

        if !file_type.is_file()
            || !is_markdown_path(&path)
            || !file_search_matches(&path, root, query)
        {
            continue;
        }

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
        });

        if results.len() >= MAX_FILE_SEARCH_RESULTS {
            return Ok(());
        }
    }

    child_paths.sort_by_key(|path| path.to_string_lossy().to_lowercase());

    for child_path in child_paths {
        search_markdown_directory(root, &child_path, query, results)?;
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

fn parse_notes_file(notes_path: &Path) -> Result<NotesFile, String> {
    let raw_notes =
        fs::read_to_string(notes_path).map_err(|error| format!("failed to read notes: {error}"))?;

    serde_json::from_str(&raw_notes).map_err(|error| format!("failed to parse notes: {error}"))
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

fn move_notes_for_renamed_markdown_path(
    app: &AppHandle,
    source_path: &Path,
    target_path: &Path,
) -> Result<(), String> {
    if let Some(notes_file) = read_notes_file(app, source_path)? {
        let target_path_string = target_path.to_string_lossy().to_string();
        let notes_file = move_notes_file_for_document(notes_file, &target_path_string);
        write_notes_file(app, target_path, notes_file)?;
        remove_document_notes(app, source_path)?;
    }

    Ok(())
}

fn move_notes_for_renamed_directory(
    app: &AppHandle,
    source_directory: &Path,
    target_directory: &Path,
) -> Result<(), String> {
    if !target_directory.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(target_directory)
        .map_err(|error| format!("failed to read renamed directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read renamed directory item: {error}"))?;
        let target_path = entry.path();
        let relative_path = match target_path.strip_prefix(target_directory) {
            Ok(relative_path) => relative_path,
            Err(_) => continue,
        };
        let source_path = source_directory.join(relative_path);

        if target_path.is_dir() {
            move_notes_for_renamed_directory(app, &source_path, &target_path)?;
        } else if is_markdown_path(&target_path) {
            move_notes_for_renamed_markdown_path(app, &source_path, &target_path)?;
        }
    }

    Ok(())
}

fn read_notes_file(app: &AppHandle, markdown_path: &Path) -> Result<Option<NotesFile>, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    if notes_path.exists() {
        return parse_notes_file(&notes_path).map(Some);
    }

    let legacy_notes_path = legacy_sidecar_path(markdown_path)?;
    if legacy_notes_path.exists() {
        return parse_notes_file(&legacy_notes_path).map(Some);
    }

    Ok(None)
}

fn write_notes_file(
    app: &AppHandle,
    markdown_path: &Path,
    notes_file: NotesFile,
) -> Result<PathBuf, String> {
    let notes_path = notes_store_path(app, markdown_path)?;
    let legacy_notes_path = legacy_sidecar_path(markdown_path)?;

    if notes_file_is_empty(&notes_file) {
        if notes_path.exists() {
            fs::remove_file(&notes_path)
                .map_err(|error| format!("failed to remove empty notes file: {error}"))?;
        }
        if legacy_notes_path.exists() {
            fs::remove_file(&legacy_notes_path)
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
    fs::write(&notes_path, serialized)
        .map_err(|error| format!("failed to write notes: {error}"))?;

    if legacy_notes_path.exists() {
        fs::remove_file(&legacy_notes_path)
            .map_err(|error| format!("failed to remove legacy sidecar notes: {error}"))?;
    }

    Ok(notes_path)
}

fn read_markdown_file(app: &AppHandle, markdown_path: PathBuf) -> Result<OpenMarkdownFile, String> {
    let body = fs::read_to_string(&markdown_path)
        .map_err(|error| format!("failed to read Markdown file: {error}"))?;
    let (notes_path, notes, glossary_terms, glossary_bindings) =
        read_document_notes(app, &markdown_path)?;

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
fn read_markdown_image_file(
    markdown_path: String,
    image_src: String,
) -> Result<LocalImageFile, String> {
    let markdown_path = PathBuf::from(markdown_path);
    if !markdown_path.is_file() {
        return Err("selected Markdown path is not a file".to_string());
    }
    if !is_markdown_path(&markdown_path) {
        return Err("selected file is not a Markdown file".to_string());
    }

    let image_path = markdown_image_file_path(&markdown_path, &image_src)?;
    let mime_type = local_image_mime_type(&image_path)
        .ok_or_else(|| "embedded file is not a supported image".to_string())?;
    let metadata = fs::metadata(&image_path)
        .map_err(|error| format!("failed to read embedded image metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("embedded image path is not a file".to_string());
    }
    if metadata.len() > MAX_LOCAL_IMAGE_BYTES {
        return Err("embedded image is too large".to_string());
    }

    let bytes =
        fs::read(&image_path).map_err(|error| format!("failed to read embedded image: {error}"))?;
    let resolved_path = fs::canonicalize(&image_path).unwrap_or(image_path);
    let encoded = STANDARD.encode(bytes);

    Ok(LocalImageFile {
        path: resolved_path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        data_url: format!("data:{mime_type};base64,{encoded}"),
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
    root_path: String,
    query: String,
) -> Result<Vec<SearchMarkdownFile>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    search_markdown_directory(&root, &root, &normalized_query, &mut results)?;
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

    fs::write(&markdown_path, body)
        .map_err(|error| format!("failed to write Markdown file: {error}"))?;

    let notes_path = write_document_notes(
        &app,
        &markdown_path,
        markdown_path.to_string_lossy().to_string(),
        notes,
        glossary_terms,
        glossary_bindings,
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
    if !source_path.is_file() {
        return Err("selected path is not a file".to_string());
    }
    if !is_markdown_path(&source_path) {
        return Err("selected file is not a Markdown file".to_string());
    }

    let target_file_name = validate_markdown_file_name(&file_name)?;
    let mut target_path = source_path.with_file_name(target_file_name);
    if !is_markdown_path(&target_path) {
        target_path.set_extension("md");
    }
    if target_path.exists() {
        return Err("duplicate file already exists".to_string());
    }

    fs::copy(&source_path, &target_path)
        .map_err(|error| format!("failed to duplicate Markdown file: {error}"))?;

    if let Some(parsed) = read_notes_file(&app, &source_path)? {
        let target_path_string = target_path.to_string_lossy().to_string();
        let parsed = duplicate_notes_file_for_document(parsed, &target_path_string)?;

        write_notes_file(&app, &target_path, parsed)?;
    }

    read_markdown_file(&app, target_path)
}

#[tauri::command]
fn delete_markdown_file(app: AppHandle, path: String) -> Result<DeleteMarkdownFile, String> {
    let markdown_path = PathBuf::from(path);
    if !markdown_path.is_file() {
        return Err("selected path is not a file".to_string());
    }
    if !is_markdown_path(&markdown_path) {
        return Err("selected file is not a Markdown file".to_string());
    }

    fs::remove_file(&markdown_path)
        .map_err(|error| format!("failed to delete Markdown file: {error}"))?;

    let notes_path = remove_document_notes(&app, &markdown_path)?;

    Ok(DeleteMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn rename_markdown_file(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<OpenMarkdownFile, String> {
    let source_path = PathBuf::from(path);
    if !source_path.is_file() {
        return Err("selected path is not a file".to_string());
    }
    if !is_markdown_path(&source_path) {
        return Err("selected file is not a Markdown file".to_string());
    }

    let target_file_name = normalized_markdown_file_name(&name)?;
    let target_path = source_path.with_file_name(target_file_name);
    if source_path == target_path {
        return read_markdown_file(&app, target_path);
    }
    if target_path.exists() {
        return Err("rename target already exists".to_string());
    }

    let notes_file = read_notes_file(&app, &source_path)?;

    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("failed to rename Markdown file: {error}"))?;

    if notes_file.is_some() {
        move_notes_for_renamed_markdown_path(&app, &source_path, &target_path)?;
    }

    read_markdown_file(&app, target_path)
}

#[tauri::command]
fn rename_markdown_directory(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<RenamedPath, String> {
    let source_path = PathBuf::from(path);
    if !source_path.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

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
    if target_path.exists() {
        return Err("rename target already exists".to_string());
    }

    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("failed to rename directory: {error}"))?;
    move_notes_for_renamed_directory(&app, &source_path, &target_path)?;

    Ok(RenamedPath {
        title: directory_title(&target_path),
        path: target_path.to_string_lossy().to_string(),
        notes_path: None,
    })
}

fn ensure_pdf_extension(mut path: PathBuf) -> PathBuf {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        path.set_extension("pdf");
    }

    path
}

fn write_pdf_bytes(path: PathBuf, data_base64: String) -> Result<WritePdfFile, String> {
    let path = ensure_pdf_extension(path);
    let parent = path
        .parent()
        .ok_or_else(|| "PDF output path has no parent directory".to_string())?;
    if !parent.is_dir() {
        return Err("PDF output directory does not exist".to_string());
    }

    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|error| format!("failed to decode PDF data: {error}"))?;
    if bytes.is_empty() {
        return Err("PDF data is empty".to_string());
    }

    fs::write(&path, bytes).map_err(|error| format!("failed to write PDF file: {error}"))?;

    Ok(WritePdfFile {
        path: path.to_string_lossy().to_string(),
    })
}

fn sanitize_pdf_file_name(file_name: &str) -> String {
    let fallback = "Scholium.pdf";
    let mut sanitized = file_name
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();

    while sanitized.ends_with('.') || sanitized.ends_with(' ') {
        sanitized.pop();
    }

    if sanitized.is_empty() {
        sanitized = fallback.to_string();
    }
    if !sanitized.to_lowercase().ends_with(".pdf") {
        sanitized.push_str(".pdf");
    }

    sanitized
}

fn now_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn unique_pdf_path(directory: &Path, file_name: &str) -> PathBuf {
    let sanitized_file_name = sanitize_pdf_file_name(file_name);
    let requested_path = ensure_pdf_extension(directory.join(&sanitized_file_name));
    if !requested_path.exists() {
        return requested_path;
    }

    let requested_stem = requested_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or("Scholium");

    for index in 2..10_000 {
        let candidate = directory.join(format!("{requested_stem} {index}.pdf"));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!("{requested_stem} {}.pdf", now_timestamp_millis()))
}

#[tauri::command]
fn write_pdf_file(path: String, data_base64: String) -> Result<WritePdfFile, String> {
    write_pdf_bytes(PathBuf::from(path), data_base64)
}

#[tauri::command]
fn write_pdf_file_to_directory(
    directory: String,
    file_name: String,
    data_base64: String,
) -> Result<WritePdfFile, String> {
    let directory_path = PathBuf::from(directory);
    if !directory_path.is_dir() {
        return Err("PDF output directory does not exist".to_string());
    }

    write_pdf_bytes(unique_pdf_path(&directory_path, &file_name), data_base64)
}

#[tauri::command]
fn remember_recent_location(
    app: tauri::AppHandle,
    kind: String,
    path: String,
    title: String,
) -> Result<(), String> {
    let language = current_app_language(&app);
    let entry = sanitize_location_entry(&kind, path, title, &language)?;

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
) -> Result<(), String> {
    let language = current_app_language(&app);
    let entry = sanitize_location_entry("directory", path, title, &language)?;
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

#[tauri::command]
fn set_app_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let normalized_language = normalize_app_language(&language).to_string();
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
    app_key: String,
) -> Result<DropboxOAuthStart, String> {
    let app_key = app_key.trim().to_string();
    if app_key.is_empty() {
        return Err("Dropbox app key is required.".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", DROPBOX_OAUTH_REDIRECT_PORT))
        .map_err(|error| format!("failed to start Dropbox callback listener: {error}"))?;
    let redirect_uri = dropbox_redirect_uri();
    let state = random_url_token(32)?;
    let code_verifier = random_url_token(64)?;
    let code_challenge = pkce_code_challenge(&code_verifier);

    {
        let dropbox_state = app.state::<DropboxState>();
        let mut oauth_session = dropbox_state
            .oauth_session
            .lock()
            .map_err(|_| "failed to lock Dropbox OAuth session".to_string())?;

        *oauth_session = Some(DropboxOAuthSession {
            app_key: app_key.clone(),
            code_verifier,
            redirect_uri: redirect_uri.clone(),
            state: state.clone(),
        });
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

    let app_for_callback = app.clone();
    std::thread::spawn(move || {
        let payload = wait_for_dropbox_oauth_callback(listener);
        let _ = app_for_callback.emit("scholium-dropbox-oauth-callback", payload);
    });

    Ok(DropboxOAuthStart {
        auth_url: authorize_url.to_string(),
        redirect_uri,
    })
}

#[tauri::command]
async fn complete_dropbox_oauth(
    app: tauri::AppHandle,
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
        let mut oauth_session = dropbox_state
            .oauth_session
            .lock()
            .map_err(|_| "failed to lock Dropbox OAuth session".to_string())?;
        let Some(session) = oauth_session.as_ref() else {
            return Err("Dropbox OAuth session was not started.".to_string());
        };
        if session.state != state {
            return Err("Dropbox OAuth state did not match.".to_string());
        }

        oauth_session.take().expect("Dropbox OAuth session exists")
    };

    let response = reqwest::Client::new()
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

    replace_dropbox_tokens(&app, Some(tokens.clone()))?;
    write_dropbox_tokens(&app, &tokens)?;

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
    let normalized_path = normalize_dropbox_path(&path);
    let access_token = dropbox_access_token(&app).await?;
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
                    if is_downloadable == Some(false) || !is_markdown_dropbox_path(&path) {
                        continue;
                    }

                    entries.push(DropboxDirectoryEntry {
                        kind: "file".to_string(),
                        path,
                        title: document_title(Path::new(&name)),
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
    if !is_markdown_dropbox_path(&normalized_path) {
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
    if !is_markdown_dropbox_path(&normalized_path) {
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
    upload_dropbox_notes_file(&app, &saved.path, notes_file).await?;

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
async fn duplicate_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
    file_name: String,
) -> Result<DropboxMarkdownFile, String> {
    let source_path = normalize_dropbox_path(&path);
    if !is_markdown_dropbox_path(&source_path) {
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
        upload_dropbox_notes_file(&app, &target_path, parsed).await?;
    }

    open_dropbox_markdown_file(app, target_path).await
}

#[tauri::command]
async fn delete_dropbox_markdown_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<DropboxMarkdownFile, String> {
    let normalized_path = normalize_dropbox_path(&path);
    if !is_markdown_dropbox_path(&normalized_path) {
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
) -> Result<DropboxMarkdownFile, String> {
    let source_path = normalize_dropbox_path(&path);
    if !is_markdown_dropbox_path(&source_path) {
        return Err("selected Dropbox file is not a Markdown file".to_string());
    }

    let target_file_name = normalized_markdown_file_name(&name)?;
    let parent_path = dropbox_parent_path(&source_path).unwrap_or_default();
    let target_path = dropbox_child_path(&parent_path, &target_file_name);
    if source_path == target_path {
        return open_dropbox_markdown_file(app, target_path).await;
    }

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
        upload_dropbox_notes_file(&app, &target_path, notes_file).await?;
        delete_dropbox_notes_file(&app, &source_path).await?;
        remove_document_notes(&app, &source_notes_markdown_path)?;
    }

    open_dropbox_markdown_file(app, target_path).await
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
    let about_metadata = AboutMetadata {
        name: Some("Scholium".to_string()),
        version: Some(app_handle.package_info().version.to_string()),
        ..Default::default()
    };
    let new_window = MenuItem::with_id(
        app_handle,
        MENU_NEW_WINDOW,
        menu_text(&language, "newWindow"),
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let new_file = MenuItem::with_id(
        app_handle,
        MENU_NEW_FILE,
        menu_text(&language, "newFile"),
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_file = MenuItem::with_id(
        app_handle,
        MENU_OPEN_FILE,
        menu_text(&language, "openFile"),
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let open_folder = MenuItem::with_id(
        app_handle,
        MENU_OPEN_FOLDER,
        menu_text(&language, "openFolder"),
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let open_settings = MenuItem::with_id(
        app_handle,
        MENU_OPEN_SETTINGS,
        menu_text(&language, "settings"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let cloud_dropbox = MenuItem::with_id(
        app_handle,
        MENU_CLOUD_DROPBOX,
        menu_text(&language, "dropbox"),
        true,
        None::<&str>,
    )?;
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
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                menu_text(&language, "fileMenu"),
                true,
                &[
                    &new_window,
                    &new_file,
                    &open_file,
                    &open_folder,
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
                    &PredefinedMenuItem::select_all(app_handle, None)?,
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
) -> Result<String, String> {
    let start_fullscreen = window
        .is_fullscreen()
        .map_err(|error| format!("failed to read current window fullscreen state: {error}"))?;

    create_new_scholium_window(&app, start_fullscreen)
}

#[cfg(mobile)]
#[tauri::command]
async fn create_new_window(_app: tauri::AppHandle) -> Result<String, String> {
    Err("New windows are only available on desktop.".to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn validate_dropped_markdown_file(paths: Vec<String>) -> Result<String, String> {
    let path = dropped_markdown_path(&paths)?;

    if !path.is_file() {
        return Err("dropped path is not an existing file".to_string());
    }

    Ok(path.to_string_lossy().into_owned())
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
        .manage(LocationMenuState::default())
        .manage(DropboxState::default())
        .manage(OpenedFileState::default())
        .setup(|app| {
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

            let dropbox_tokens = read_dropbox_tokens_from_disk(app.handle());
            if let Err(error) = replace_dropbox_tokens(app.handle(), dropbox_tokens) {
                eprintln!("{error}");
            }

            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.menu(build_app_menu).on_menu_event(|app, event| {
        let event_id = event.id().as_ref();

        if event_id == MENU_NEW_WINDOW {
            let app_handle = app.clone();
            let start_fullscreen = target_window_is_fullscreen(app);
            std::thread::spawn(move || {
                if let Err(error) = create_new_scholium_window(&app_handle, start_fullscreen) {
                    eprintln!("{error}");
                }
            });
        } else if event_id == MENU_NEW_FILE {
            let _ = emit_to_target_webview_window(app, "menu:new-file", ());
            let _ = emit_to_target_webview_window(app, "scholium-new-file", ());
        } else if event_id == MENU_OPEN_SETTINGS {
            let _ = emit_to_target_webview_window(app, "menu:open-settings", ());
            let _ = emit_to_target_webview_window(app, "scholium-open-settings", ());
        } else if event_id == MENU_OPEN_FILE {
            let _ = emit_to_target_webview_window(app, "menu:open-file", ());
            let _ = emit_to_target_webview_window(app, "scholium-open-file", ());
        } else if event_id == MENU_OPEN_FOLDER {
            let _ = emit_to_target_webview_window(app, "menu:open-folder", ());
            let _ = emit_to_target_webview_window(app, "scholium-open-folder", ());
        } else if event_id == MENU_CLOUD_DROPBOX {
            let _ = emit_to_target_webview_window(app, "menu:open-dropbox", ());
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
                };
                let _ = emit_to_target_webview_window(app, "menu:open-location", &payload);
                let _ = emit_to_target_webview_window(app, "scholium-open-location", payload);
            }
        }
    });

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_new_window,
            greet,
            validate_dropped_markdown_file,
            take_opened_file_paths,
            open_markdown_directory,
            open_markdown_file,
            open_markdown_file_context,
            read_markdown_image_file,
            search_markdown_files,
            duplicate_markdown_file,
            delete_markdown_file,
            rename_markdown_file,
            rename_markdown_directory,
            write_pdf_file,
            write_pdf_file_to_directory,
            save_markdown_file,
            remember_recent_location,
            saved_locations,
            set_current_directory_location,
            set_app_language,
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
            duplicate_dropbox_markdown_file,
            delete_dropbox_markdown_file,
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
    fn dropped_file_must_be_one_md_path() {
        let markdown = vec!["draft.MD".to_string()];
        assert_eq!(
            dropped_markdown_path(&markdown).unwrap(),
            Path::new("draft.MD")
        );

        assert!(dropped_markdown_path(&["draft.txt".to_string()]).is_err());
        assert!(dropped_markdown_path(&[]).is_err());
        assert!(dropped_markdown_path(&["one.md".to_string(), "two.md".to_string()]).is_err());
    }
}
