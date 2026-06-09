use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

const MENU_NEW_FILE: &str = "file:new-file";
const MENU_OPEN_FILE: &str = "file:open-file";
const MENU_OPEN_FOLDER: &str = "file:open-folder";

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
struct NotesFile {
    version: u32,
    markdown_path: String,
    notes: Vec<SelectionNote>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMarkdownFile {
    path: String,
    notes_path: String,
    title: String,
    body: String,
    notes: Vec<SelectionNote>,
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

fn sidecar_path(markdown_path: &Path) -> Result<PathBuf, String> {
    let file_name = markdown_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid Markdown file path".to_string())?;

    Ok(markdown_path.with_file_name(format!("{file_name}.notes.json")))
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

fn read_markdown_directory(directory: PathBuf) -> Result<OpenMarkdownDirectory, String> {
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
                file: Some(read_markdown_file(path)?),
            });
        }
    }

    entries.sort_by_key(entry_sort_key);

    Ok(OpenMarkdownDirectory {
        title: directory_title(&directory),
        path: directory.to_string_lossy().to_string(),
        entries,
    })
}

fn read_markdown_file(markdown_path: PathBuf) -> Result<OpenMarkdownFile, String> {
    let body = fs::read_to_string(&markdown_path)
        .map_err(|error| format!("failed to read Markdown file: {error}"))?;
    let notes_path = sidecar_path(&markdown_path)?;

    let notes = if notes_path.exists() {
        let raw_notes = fs::read_to_string(&notes_path)
            .map_err(|error| format!("failed to read sidecar notes: {error}"))?;
        let parsed: NotesFile = serde_json::from_str(&raw_notes)
            .map_err(|error| format!("failed to parse sidecar notes: {error}"))?;

        parsed
            .notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .collect()
    } else {
        Vec::new()
    };

    Ok(OpenMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
        title: document_title(&markdown_path),
        body,
        notes,
    })
}

#[tauri::command]
fn open_markdown_file(path: String) -> Result<OpenMarkdownFile, String> {
    read_markdown_file(PathBuf::from(path))
}

#[tauri::command]
fn open_markdown_file_context(path: String) -> Result<OpenMarkdownFileContext, String> {
    let markdown_path = PathBuf::from(path);
    let directory = markdown_path
        .parent()
        .ok_or_else(|| "selected file has no parent directory".to_string())?
        .to_path_buf();
    let selected_file = read_markdown_file(markdown_path)?;
    let directory = read_markdown_directory(directory)?;

    Ok(OpenMarkdownFileContext {
        selected_file,
        directory,
    })
}

#[tauri::command]
fn open_markdown_directory(path: String) -> Result<OpenMarkdownDirectory, String> {
    let directory = PathBuf::from(path);
    if !directory.is_dir() {
        return Err("selected path is not a directory".to_string());
    }

    read_markdown_directory(directory)
}

#[tauri::command]
fn save_markdown_file(
    path: String,
    body: String,
    notes: Vec<SelectionNote>,
) -> Result<SaveMarkdownFile, String> {
    let markdown_path = PathBuf::from(path);
    let notes_path = sidecar_path(&markdown_path)?;

    fs::write(&markdown_path, body)
        .map_err(|error| format!("failed to write Markdown file: {error}"))?;

    let notes_file = NotesFile {
        version: 1,
        markdown_path: markdown_path.to_string_lossy().to_string(),
        notes: notes
            .into_iter()
            .filter(|note| note.status != "deleted")
            .collect(),
    };
    let serialized = serde_json::to_string_pretty(&notes_file)
        .map_err(|error| format!("failed to serialize sidecar notes: {error}"))?;

    fs::write(&notes_path, serialized)
        .map_err(|error| format!("failed to write sidecar notes: {error}"))?;

    Ok(SaveMarkdownFile {
        path: markdown_path.to_string_lossy().to_string(),
        notes_path: notes_path.to_string_lossy().to_string(),
    })
}

fn build_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

    Menu::with_items(
        app_handle,
        &[
            &Submenu::with_items(
                app_handle,
                "Scholium",
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
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
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            set_runtime_dock_icon();

            Ok(())
        })
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == MENU_NEW_FILE {
                let _ = app.emit("menu:new-file", ());
                let _ = app.emit("scholium-new-file", ());
            }
            if event.id() == MENU_OPEN_FILE {
                let _ = app.emit("menu:open-file", ());
                let _ = app.emit("scholium-open-file", ());
            }
            if event.id() == MENU_OPEN_FOLDER {
                let _ = app.emit("menu:open-folder", ());
                let _ = app.emit("scholium-open-folder", ());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_markdown_directory,
            open_markdown_file,
            open_markdown_file_context,
            save_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
