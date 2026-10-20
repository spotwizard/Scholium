use std::path::Path;

pub fn is_linkable_name(name: &str) -> bool {
    !name.starts_with('.') && !name.ends_with(".notes.json")
}

pub fn local_sibling_names(path: &Path) -> Result<Vec<String>, String> {
    if !path.is_file() {
        return Err("目前檔案不存在，請先儲存檔案。".into());
    }
    let directory = path.parent().ok_or("目前檔案沒有上層目錄。")?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path() != path && entry.path().is_file() && is_linkable_name(&name) {
            names.push(name);
        }
    }
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn siblings_include_other_file_types_but_not_children_or_app_metadata() {
        let directory =
            std::env::temp_dir().join(format!("scholium-file-links-{}", std::process::id()));
        std::fs::create_dir_all(directory.join("child")).unwrap();
        for name in [
            "current.md",
            "other.md",
            "中文 (1).pdf",
            "current.md.notes.json",
            ".hidden",
            "child/nested.md",
        ] {
            std::fs::write(directory.join(name), "test").unwrap();
        }
        assert_eq!(
            local_sibling_names(&directory.join("current.md")).unwrap(),
            vec!["other.md", "中文 (1).pdf"]
        );
        assert!(local_sibling_names(&directory.join("missing.md")).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
