use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DroppedMarkdownPath<'a> {
    File(&'a Path),
    Directory(&'a Path),
}

pub(crate) fn validate_markdown_file_name(file_name: &str) -> Result<PathBuf, String> {
    validate_path_name(
        file_name,
        "duplicate file name is empty",
        "duplicate file name must not include folders",
    )
}

pub(crate) fn validate_path_name(
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

pub(crate) fn is_markdown_path(path: &Path) -> bool {
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

pub(crate) fn validate_existing_markdown_file(
    path: &Path,
    not_file_error: &str,
) -> Result<(), String> {
    if !path.is_file() {
        return Err(not_file_error.to_string());
    }
    if !is_markdown_path(path) {
        return Err("selected file is not a Markdown file".to_string());
    }

    Ok(())
}

pub(crate) fn dropped_markdown_path(paths: &[String]) -> Result<DroppedMarkdownPath<'_>, String> {
    let [path] = paths else {
        return Err("drop requires exactly one .md file or directory".to_string());
    };
    let path = Path::new(path);

    if path.is_dir() {
        return Ok(DroppedMarkdownPath::Directory(path));
    }

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err("dropped file must use the .md extension".to_string());
    }

    Ok(DroppedMarkdownPath::File(path))
}

pub(crate) const TYPED_PATH_EMPTY_ERROR: &str = "typed path is empty";
pub(crate) const TYPED_PATH_NOT_ABSOLUTE_ERROR: &str = "typed path must be absolute";
pub(crate) const TYPED_PATH_NOT_FOUND_ERROR: &str = "typed path does not exist";
pub(crate) const TYPED_PATH_NOT_MARKDOWN_ERROR: &str = "typed file is not a Markdown file";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TypedMarkdownLocation {
    File(PathBuf),
    Directory(PathBuf),
}

/// Resolves a path typed by the user, accepting `~` for the home folder and
/// surrounding quotes left over from copying a path.
pub(crate) fn typed_markdown_location(
    input: &str,
    home_directory: Option<&Path>,
) -> Result<TypedMarkdownLocation, String> {
    let trimmed = input.trim();
    let unquoted = ['"', '\'']
        .iter()
        .find_map(|quote| {
            trimmed
                .strip_prefix(*quote)
                .and_then(|rest| rest.strip_suffix(*quote))
        })
        .unwrap_or(trimmed)
        .trim();
    if unquoted.is_empty() {
        return Err(TYPED_PATH_EMPTY_ERROR.to_string());
    }

    let path = match (unquoted.strip_prefix('~'), home_directory) {
        (Some(""), Some(home)) => home.to_path_buf(),
        (Some(rest), Some(home)) if rest.starts_with('/') => {
            home.join(rest.trim_start_matches('/'))
        }
        _ => PathBuf::from(unquoted),
    };
    if !path.is_absolute() {
        return Err(TYPED_PATH_NOT_ABSOLUTE_ERROR.to_string());
    }

    if path.is_dir() {
        return Ok(TypedMarkdownLocation::Directory(path));
    }
    if !path.is_file() {
        return Err(TYPED_PATH_NOT_FOUND_ERROR.to_string());
    }
    if !is_markdown_path(&path) {
        return Err(TYPED_PATH_NOT_MARKDOWN_ERROR.to_string());
    }

    Ok(TypedMarkdownLocation::File(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_path_resolves_home_quotes_and_kind() {
        let root = std::env::temp_dir().join(format!("scholium-typed-path-{}", std::process::id()));
        let notes = root.join("My Notes");
        std::fs::create_dir_all(&notes).unwrap();
        let markdown = notes.join("draft.md");
        let text = notes.join("draft.txt");
        std::fs::write(&markdown, "").unwrap();
        std::fs::write(&text, "").unwrap();

        assert_eq!(
            typed_markdown_location(&format!("  {}  ", notes.display()), None).unwrap(),
            TypedMarkdownLocation::Directory(notes.clone())
        );
        assert_eq!(
            typed_markdown_location(&format!("'{}'", markdown.display()), None).unwrap(),
            TypedMarkdownLocation::File(markdown.clone())
        );
        assert_eq!(
            typed_markdown_location("~/My Notes/draft.md", Some(&root)).unwrap(),
            TypedMarkdownLocation::File(markdown.clone())
        );
        assert_eq!(
            typed_markdown_location("~", Some(&root)).unwrap(),
            TypedMarkdownLocation::Directory(root.clone())
        );
        assert_eq!(
            typed_markdown_location(" \"\" ", None).unwrap_err(),
            TYPED_PATH_EMPTY_ERROR
        );
        assert_eq!(
            typed_markdown_location("My Notes/draft.md", Some(&root)).unwrap_err(),
            TYPED_PATH_NOT_ABSOLUTE_ERROR
        );
        assert_eq!(
            typed_markdown_location(&notes.join("missing.md").to_string_lossy(), None).unwrap_err(),
            TYPED_PATH_NOT_FOUND_ERROR
        );
        assert_eq!(
            typed_markdown_location(&text.to_string_lossy(), None).unwrap_err(),
            TYPED_PATH_NOT_MARKDOWN_ERROR
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dropped_path_must_be_one_md_file_or_directory() {
        let markdown = vec!["draft.MD".to_string()];
        assert_eq!(
            dropped_markdown_path(&markdown).unwrap(),
            DroppedMarkdownPath::File(Path::new("draft.MD"))
        );

        let directory =
            std::env::temp_dir().join(format!("scholium-dropped-directory-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(
            dropped_markdown_path(&[directory.to_string_lossy().into_owned()]).unwrap(),
            DroppedMarkdownPath::Directory(directory.as_path())
        );
        std::fs::remove_dir(directory).unwrap();

        assert!(is_markdown_path(Path::new("draft.md")));
        assert!(is_markdown_path(Path::new("draft.MARKDOWN")));
        assert!(is_markdown_path(Path::new("draft.MdOwN")));
        assert!(!is_markdown_path(Path::new("draft.txt")));
        assert_eq!(
            validate_markdown_file_name("  draft.md  ").unwrap(),
            Path::new("draft.md")
        );
        assert_eq!(
            validate_markdown_file_name(" ").unwrap_err(),
            "duplicate file name is empty"
        );
        assert_eq!(
            validate_markdown_file_name("folder/draft.md").unwrap_err(),
            "duplicate file name must not include folders"
        );
        assert_eq!(
            validate_path_name(" ", "empty", "folders").unwrap_err(),
            "empty"
        );
        assert_eq!(
            validate_path_name("folder/name", "empty", "folders").unwrap_err(),
            "folders"
        );
        assert!(dropped_markdown_path(&["draft.markdown".to_string()]).is_err());
        assert!(dropped_markdown_path(&["draft.mdown".to_string()]).is_err());
        assert!(dropped_markdown_path(&["draft.txt".to_string()]).is_err());
        assert!(dropped_markdown_path(&[]).is_err());
        assert!(dropped_markdown_path(&["one.md".to_string(), "two.md".to_string()]).is_err());
    }
}
