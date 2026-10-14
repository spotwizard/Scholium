use super::local_path_entry_exists;
#[cfg(test)]
use super::test_directory;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WritePdfFile {
    path: String,
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

fn write_pdf_bytes(
    path: PathBuf,
    data_base64: String,
    must_not_exist: bool,
) -> Result<WritePdfFile, String> {
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

    if must_not_exist {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| format!("failed to create PDF file: {error}"))?;
        output
            .write_all(&bytes)
            .map_err(|error| format!("failed to write PDF file: {error}"))?;
    } else {
        fs::write(&path, bytes).map_err(|error| format!("failed to write PDF file: {error}"))?;
    }

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

fn unique_pdf_path(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    let sanitized_file_name = sanitize_pdf_file_name(file_name);
    let requested_path = ensure_pdf_extension(directory.join(&sanitized_file_name));
    if !local_path_entry_exists(&requested_path)? {
        return Ok(requested_path);
    }

    let requested_stem = requested_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or("Scholium");

    for index in 2..10_000 {
        let candidate = directory.join(format!("{requested_stem} {index}.pdf"));
        if !local_path_entry_exists(&candidate)? {
            return Ok(candidate);
        }
    }

    let fallback = directory.join(format!("{requested_stem} {}.pdf", now_timestamp_millis()));
    if local_path_entry_exists(&fallback)? {
        return Err("failed to choose an unused PDF output path".to_string());
    }
    Ok(fallback)
}

#[tauri::command]
pub(crate) fn write_pdf_file(path: String, data_base64: String) -> Result<WritePdfFile, String> {
    write_pdf_bytes(PathBuf::from(path), data_base64, false)
}

#[tauri::command]
pub(crate) fn write_pdf_file_to_directory(
    directory: String,
    file_name: String,
    data_base64: String,
) -> Result<WritePdfFile, String> {
    let directory_path = PathBuf::from(directory);
    if !directory_path.is_dir() {
        return Err("PDF output directory does not exist".to_string());
    }

    write_pdf_bytes(
        unique_pdf_path(&directory_path, &file_name)?,
        data_base64,
        true,
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn automatic_pdf_output_skips_and_never_writes_through_dangling_symlinks() {
        let unresolved_root = test_directory("dangling-pdf-symlink");
        fs::create_dir_all(&unresolved_root).unwrap();
        let root = fs::canonicalize(&unresolved_root).unwrap();
        let requested_path = root.join("Report.pdf");
        let second_path = root.join("Report 2.pdf");
        let requested_target = root.join("missing-requested.pdf");
        let second_target = root.join("missing-second.pdf");
        symlink(Path::new("missing-requested.pdf"), &requested_path).unwrap();
        symlink(Path::new("missing-second.pdf"), &second_path).unwrap();

        assert_eq!(
            unique_pdf_path(&root, "Report.pdf").unwrap(),
            root.join("Report 3.pdf")
        );
        assert!(write_pdf_bytes(requested_path, STANDARD.encode(b"%PDF-1.7"), true).is_err());
        assert!(!requested_target.exists());
        assert!(!second_target.exists());

        fs::remove_dir_all(root).unwrap();
    }
}
