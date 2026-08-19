use std::path::{Path, PathBuf};

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

pub(crate) fn dropped_markdown_path(paths: &[String]) -> Result<&Path, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_file_must_be_one_md_path() {
        let markdown = vec!["draft.MD".to_string()];
        assert_eq!(
            dropped_markdown_path(&markdown).unwrap(),
            Path::new("draft.MD")
        );

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
