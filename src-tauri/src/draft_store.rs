use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic_file::atomic_replace_private_file;
use crate::local_save_recovery::create_durable_directory;

const DRAFT_ID_PREFIX: &str = "draft:";
const DRAFT_FILE_EXTENSION: &str = "json";
const MAX_DRAFT_ID_LENGTH: usize = 200;

/// Maps a draft document id such as `draft:local:1700000000000:abc123`
/// to the file that stores its unsaved content.
fn draft_file_path(directory: &Path, draft_id: &str) -> Result<PathBuf, String> {
    let is_valid = draft_id.starts_with(DRAFT_ID_PREFIX)
        && draft_id.len() <= MAX_DRAFT_ID_LENGTH
        && draft_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == ':');
    if !is_valid {
        return Err("invalid draft document id".to_string());
    }

    Ok(directory.join(format!(
        "{}.{DRAFT_FILE_EXTENSION}",
        draft_id.replace(':', "_")
    )))
}

fn sync_directory(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        fs::File::open(directory)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
        Ok(())
    }
}

/// Writes the draft durably: the content reaches the disk before the old copy
/// is replaced, so a power loss leaves either the previous or the new content.
pub(crate) fn save_draft(directory: &Path, draft_id: &str, contents: &str) -> Result<(), String> {
    let path = draft_file_path(directory, draft_id)?;
    create_durable_directory(directory)
        .map_err(|error| format!("failed to create draft directory: {error}"))?;
    atomic_replace_private_file(&path, contents.as_bytes())
        .map_err(|error| format!("failed to save draft: {error}"))?;
    sync_directory(directory).map_err(|error| format!("failed to save draft: {error}"))
}

/// Returns every stored draft. Unreadable files are skipped but never removed.
pub(crate) fn list_drafts(directory: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("failed to read drafts: {error}")),
    };

    let mut drafts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_draft_file = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with("draft_") && name.ends_with(&format!(".{DRAFT_FILE_EXTENSION}"))
            });
        if !is_draft_file || !path.is_file() {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(&path) {
            drafts.push(contents);
        }
    }

    Ok(drafts)
}

pub(crate) fn delete_draft(directory: &Path, draft_id: &str) -> Result<(), String> {
    let path = draft_file_path(directory, draft_id)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to delete draft: {error}")),
    }
    sync_directory(directory).map_err(|error| format!("failed to delete draft: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drafts_are_saved_listed_and_deleted_only_on_request() {
        let directory = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("scholium-drafts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);

        assert_eq!(list_drafts(&directory).unwrap(), Vec::<String>::new());

        save_draft(&directory, "draft:local:1:abc", "{\"body\":\"first\"}").unwrap();
        save_draft(&directory, "draft:dropbox:2:def", "{\"body\":\"second\"}").unwrap();
        save_draft(&directory, "draft:local:1:abc", "{\"body\":\"updated\"}").unwrap();
        fs::write(directory.join("notes.txt"), "ignored").unwrap();

        let mut drafts = list_drafts(&directory).unwrap();
        drafts.sort();
        assert_eq!(
            drafts,
            vec!["{\"body\":\"second\"}", "{\"body\":\"updated\"}"]
        );

        delete_draft(&directory, "draft:local:1:abc").unwrap();
        delete_draft(&directory, "draft:local:1:abc").unwrap();
        assert_eq!(
            list_drafts(&directory).unwrap(),
            vec!["{\"body\":\"second\"}"]
        );

        assert!(save_draft(&directory, "../escape", "{}").is_err());
        assert!(save_draft(&directory, "draft:../escape", "{}").is_err());
        assert!(delete_draft(&directory, "notes").is_err());

        fs::remove_dir_all(directory).unwrap();
    }
}
