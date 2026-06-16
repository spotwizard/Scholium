use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

const MENU_NEW_FILE: &str = "file:new-file";
const MENU_OPEN_FILE: &str = "file:open-file";
const MENU_OPEN_FOLDER: &str = "file:open-folder";
const MENU_OPEN_SETTINGS: &str = "app:open-settings";
const MENU_FAVORITE_DIRECTORIES: &str = "file:favorite-directories";
const MENU_RECENT_LOCATIONS: &str = "file:recent-locations";
const MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES: &str = "file:add-current-directory-to-favorites";
const MENU_CLEAR_FAVORITE_DIRECTORIES: &str = "file:clear-favorite-directories";
const MENU_CLEAR_RECENT_LOCATIONS: &str = "file:clear-recent-locations";
const MENU_FAVORITE_DIRECTORY_PREFIX: &str = "file:favorite-directory:";
const MENU_RECENT_LOCATION_PREFIX: &str = "file:recent-location:";
const MAX_RECENT_LOCATIONS: usize = 12;
const NOTES_STORE_DIRECTORY: &str = "notes";

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

#[derive(Default)]
struct LocationMenuState {
    current_directory: Mutex<Option<LocationEntry>>,
    store: Mutex<LocationStore>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenLocationPayload {
    kind: String,
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextSelectionAnchor {
    from: usize,
    to: usize,
    selected_text: String,
    prefix: String,
    suffix: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionNote {
    id: String,
    document_id: String,
    status: String,
    selected_text: String,
    anchor: TextSelectionAnchor,
    body: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryTerm {
    id: String,
    term: String,
    normalized_term: String,
    definition: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
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
struct OpenMarkdownFileContext {
    selected_file: OpenMarkdownFile,
    directory: OpenMarkdownDirectory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveMarkdownFile {
    path: String,
    notes_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteMarkdownFile {
    path: String,
    notes_path: String,
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

fn sanitize_location_entry(
    kind: &str,
    path: String,
    title: String,
) -> Result<LocationEntry, String> {
    if kind != "directory" && kind != "file" {
        return Err("unsupported location kind".to_string());
    }

    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("location path is empty".to_string());
    }

    let fallback_title = if kind == "directory" {
        location_title(Path::new(trimmed_path), "目錄")
    } else {
        location_title(Path::new(trimmed_path), "Markdown 檔案")
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

fn is_hidden_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn entry_sort_key(entry: &OpenDirectoryEntry) -> (u8, String, String) {
    let kind_order = if entry.kind == "directory" { 0 } else { 1 };

    (
        kind_order,
        entry.title.to_lowercase(),
        entry.path.to_lowercase(),
    )
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
                file: None,
            });
        } else if is_markdown_path(&path) {
            entries.push(OpenDirectoryEntry {
                kind: "file".to_string(),
                title: document_title(&path),
                path: path.to_string_lossy().to_string(),
                file: Some(read_markdown_file(app, path)?),
            });
        }
    }

    entries.sort_by_key(entry_sort_key);

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
    let raw_notes = fs::read_to_string(notes_path)
        .map_err(|error| format!("failed to read notes: {error}"))?;

    serde_json::from_str(&raw_notes).map_err(|error| format!("failed to parse notes: {error}"))
}

fn notes_file_is_empty(notes_file: &NotesFile) -> bool {
    notes_file.notes.is_empty()
        && notes_file.glossary_terms.is_empty()
        && notes_file.glossary_bindings.is_empty()
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
    fs::write(&notes_path, serialized).map_err(|error| format!("failed to write notes: {error}"))?;

    if legacy_notes_path.exists() {
        fs::remove_file(&legacy_notes_path)
            .map_err(|error| format!("failed to remove legacy sidecar notes: {error}"))?;
    }

    Ok(notes_path)
}

fn read_markdown_file(app: &AppHandle, markdown_path: PathBuf) -> Result<OpenMarkdownFile, String> {
    let body = fs::read_to_string(&markdown_path)
        .map_err(|error| format!("failed to read Markdown file: {error}"))?;
    let notes_path = notes_store_path(app, &markdown_path)?;

    let notes_file = read_notes_file(app, &markdown_path)?;
    let (notes, glossary_terms, glossary_bindings) = notes_file
        .map(|parsed| {
            (
                parsed
                    .notes
                    .into_iter()
                    .filter(|note| note.status != "deleted")
                    .collect(),
                parsed.glossary_terms,
                parsed
                    .glossary_bindings
                    .into_iter()
                    .filter(|binding| binding.status != "deleted")
                    .collect(),
            )
        })
        .unwrap_or_else(|| (Vec::new(), Vec::new(), Vec::new()));

    Ok(OpenMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
        title: document_title(&markdown_path),
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
fn open_markdown_directory(app: AppHandle, path: String) -> Result<OpenMarkdownDirectory, String> {
    let directory = PathBuf::from(path);
    if !directory.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

    read_markdown_directory(&app, directory)
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

    let notes_file = NotesFile {
        version: 1,
        markdown_path: markdown_path.to_string_lossy().to_string(),
        notes: notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .collect(),
        glossary_terms,
        glossary_bindings: glossary_bindings
            .into_iter()
            .filter(|binding| binding.status != "deleted")
            .collect(),
    };
    let notes_path = write_notes_file(&app, &markdown_path, notes_file)?;

    Ok(SaveMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
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

    if let Some(mut parsed) = read_notes_file(&app, &source_path)? {
        let target_path_string = target_path.to_string_lossy().to_string();

        parsed.markdown_path = target_path_string.clone();
        for note in parsed.notes.iter_mut() {
            note.document_id = target_path_string.clone();
        }
        for binding in parsed.glossary_bindings.iter_mut() {
            binding.document_id = target_path_string.clone();
        }

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

    let notes_path = notes_store_path(&app, &markdown_path)?;
    let legacy_notes_path = legacy_sidecar_path(&markdown_path)?;

    fs::remove_file(&markdown_path)
        .map_err(|error| format!("failed to delete Markdown file: {error}"))?;

    if notes_path.exists() {
        fs::remove_file(&notes_path)
            .map_err(|error| format!("failed to delete notes: {error}"))?;
    }

    if legacy_notes_path.exists() {
        fs::remove_file(&legacy_notes_path)
            .map_err(|error| format!("failed to delete legacy sidecar notes: {error}"))?;
    }

    Ok(DeleteMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn remember_recent_location(
    app: tauri::AppHandle,
    kind: String,
    path: String,
    title: String,
) -> Result<(), String> {
    let entry = sanitize_location_entry(&kind, path, title)?;

    remember_recent_location_entry(&app, entry)
}

#[tauri::command]
fn set_current_directory_location(
    app: tauri::AppHandle,
    path: String,
    title: String,
) -> Result<(), String> {
    let entry = sanitize_location_entry("directory", path, title)?;
    let state = app.state::<LocationMenuState>();

    {
        let mut current_directory = state
            .current_directory
            .lock()
            .map_err(|_| "failed to lock current directory state".to_string())?;
        *current_directory = Some(entry);
    }

    refresh_app_menu(&app)
}

fn build_favorite_directories_submenu(
    app_handle: &tauri::AppHandle,
    store: &LocationStore,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let state = app_handle.state::<LocationMenuState>();
    let has_current_directory = state
        .current_directory
        .lock()
        .map(|current_directory| current_directory.is_some())
        .unwrap_or(false);
    let submenu = Submenu::with_id(app_handle, MENU_FAVORITE_DIRECTORIES, "常用目錄", true)?;
    let add_current_directory = MenuItem::with_id(
        app_handle,
        MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES,
        "加入目前目錄",
        has_current_directory,
        None::<&str>,
    )?;

    submenu.append(&add_current_directory)?;
    submenu.append(&PredefinedMenuItem::separator(app_handle)?)?;

    if store.favorite_directories.is_empty() {
        let empty_item = MenuItem::with_id(
            app_handle,
            "file:favorite-directories-empty",
            "尚未加入常用目錄",
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
        "清除常用目錄",
        !store.favorite_directories.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(submenu)
}

fn build_recent_locations_submenu(
    app_handle: &tauri::AppHandle,
    store: &LocationStore,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let submenu = Submenu::with_id(app_handle, MENU_RECENT_LOCATIONS, "最近開啟", true)?;

    if store.recent.is_empty() {
        let empty_item = MenuItem::with_id(
            app_handle,
            "file:recent-locations-empty",
            "尚無最近開啟項目",
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
        "清除項目",
        !store.recent.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear_item)?;

    Ok(submenu)
}

fn build_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let location_store = current_location_store(app_handle);
    let about_metadata = AboutMetadata {
        name: Some("Scholium".to_string()),
        version: Some(app_handle.package_info().version.to_string()),
        ..Default::default()
    };
    let new_file = MenuItem::with_id(
        app_handle,
        MENU_NEW_FILE,
        "新增檔案",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_file = MenuItem::with_id(
        app_handle,
        MENU_OPEN_FILE,
        "開啟檔案",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let open_folder = MenuItem::with_id(
        app_handle,
        MENU_OPEN_FOLDER,
        "開啟目錄",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let open_settings = MenuItem::with_id(
        app_handle,
        MENU_OPEN_SETTINGS,
        "設定...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let favorite_directories = build_favorite_directories_submenu(app_handle, &location_store)?;
    let recent_locations = build_recent_locations_submenu(app_handle, &location_store)?;

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
                "File",
                true,
                &[
                    &new_file,
                    &open_file,
                    &open_folder,
                    &favorite_directories,
                    &recent_locations,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "Edit",
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
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &Submenu::with_items(
                app_handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app_handle, None)?,
                    &PredefinedMenuItem::maximize(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(app_handle, "Help", true, &[])?,
        ],
    )
}

fn refresh_app_menu(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let menu = build_app_menu(app_handle)
        .map_err(|error| format!("failed to rebuild app menu: {error}"))?;

    app_handle
        .set_menu(menu)
        .map(|_| ())
        .map_err(|error| format!("failed to set app menu: {error}"))
}

#[cfg(target_os = "macos")]
fn set_runtime_dock_icon() {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage, NSImageView};
    use objc2_foundation::NSData;

    let icon_bytes = include_bytes!("../icons/icon.png");
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    let data = NSData::with_bytes(icon_bytes);

    if let Some(app_icon) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { app.setApplicationIconImage(Some(&app_icon)) };

        let image_view = NSImageView::imageViewWithImage(&app_icon, mtm);
        let dock_tile = app.dockTile();
        dock_tile.setContentView(Some(&image_view));
        dock_tile.display();
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LocationMenuState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            set_runtime_dock_icon();

            let location_store = read_location_store_from_disk(app.handle());
            if let Err(error) = replace_current_location_store(app.handle(), location_store)
                .and_then(|_| refresh_app_menu(app.handle()))
            {
                eprintln!("{error}");
            }

            Ok(())
        })
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let event_id = event.id().as_ref();

            if event_id == MENU_NEW_FILE {
                let _ = app.emit("menu:new-file", ());
                let _ = app.emit("scholium-new-file", ());
            } else if event_id == MENU_OPEN_SETTINGS {
                let _ = app.emit("menu:open-settings", ());
                let _ = app.emit("scholium-open-settings", ());
            } else if event_id == MENU_OPEN_FILE {
                let _ = app.emit("menu:open-file", ());
                let _ = app.emit("scholium-open-file", ());
            } else if event_id == MENU_OPEN_FOLDER {
                let _ = app.emit("menu:open-folder", ());
                let _ = app.emit("scholium-open-folder", ());
            } else if event_id == MENU_ADD_CURRENT_DIRECTORY_TO_FAVORITES {
                let current_directory = app
                    .state::<LocationMenuState>()
                    .current_directory
                    .lock()
                    .ok()
                    .and_then(|current_directory| current_directory.clone());

                if let Some(directory) = current_directory {
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
                    let _ = app.emit("menu:open-location", &payload);
                    let _ = app.emit("scholium-open-location", payload);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_markdown_directory,
            open_markdown_file,
            open_markdown_file_context,
            duplicate_markdown_file,
            delete_markdown_file,
            save_markdown_file,
            remember_recent_location,
            set_current_directory_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
