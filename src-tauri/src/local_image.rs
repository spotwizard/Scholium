#[cfg(test)]
use super::test_directory;
use super::validate_existing_markdown_file;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

const MAX_LOCAL_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalImageFile {
    path: String,
    mime_type: String,
    data_url: String,
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

#[tauri::command]
pub(crate) fn read_markdown_image_file(
    markdown_path: String,
    image_src: String,
) -> Result<LocalImageFile, String> {
    let markdown_path = PathBuf::from(markdown_path);
    validate_existing_markdown_file(&markdown_path, "selected Markdown path is not a file")?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_encoded_paths_and_strips_url_suffixes() {
        let markdown_path = Path::new("notes").join("draft.md");

        assert_eq!(
            markdown_image_file_path(
                &markdown_path,
                "assets/cover%20image.png?download=1#preview"
            )
            .unwrap(),
            Path::new("notes").join("assets/cover image.png")
        );
    }

    #[test]
    fn resolves_file_urls_and_rejects_empty_or_remote_sources() {
        let root = test_directory("local-image-file-url");
        let markdown_path = root.join("draft.md");
        let image_path = root.join("cover image.png");
        let image_url = format!(
            "{}?download=1#preview",
            Url::from_file_path(&image_path).unwrap()
        );

        assert_eq!(
            markdown_image_file_path(&markdown_path, &image_url).unwrap(),
            image_path
        );
        assert_eq!(
            markdown_image_file_path(&markdown_path, "  ").unwrap_err(),
            "image source is empty"
        );
        assert_eq!(
            markdown_image_file_path(&markdown_path, "https://example.com/cover.png").unwrap_err(),
            "image source is not a local file"
        );
    }

    #[test]
    fn reads_relative_percent_encoded_image_without_changing_the_response_schema() {
        let root = test_directory("read-local-image");
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let markdown_path = root.join("draft.md");
        let image_path = assets.join("cover image.PNG");
        fs::write(&markdown_path, "# Draft").unwrap();
        fs::write(&image_path, b"image bytes").unwrap();

        let image = read_markdown_image_file(
            markdown_path.to_string_lossy().to_string(),
            "assets/cover%20image.PNG?download=1#preview".to_string(),
        )
        .unwrap();

        assert_eq!(
            image.path,
            fs::canonicalize(&image_path).unwrap().to_string_lossy()
        );
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(
            image.data_url,
            format!("data:image/png;base64,{}", STANDARD.encode(b"image bytes"))
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unsupported_non_file_and_oversized_images() {
        let root = test_directory("reject-local-image");
        fs::create_dir_all(&root).unwrap();
        let markdown_path = root.join("draft.md");
        fs::write(&markdown_path, "# Draft").unwrap();

        let unsupported = root.join("diagram.svg");
        fs::write(&unsupported, "<svg/>").unwrap();
        assert_eq!(
            read_markdown_image_file(
                markdown_path.to_string_lossy().to_string(),
                unsupported.to_string_lossy().to_string()
            )
            .unwrap_err(),
            "embedded file is not a supported image"
        );

        let directory = root.join("folder.png");
        fs::create_dir_all(&directory).unwrap();
        assert_eq!(
            read_markdown_image_file(
                markdown_path.to_string_lossy().to_string(),
                directory.to_string_lossy().to_string()
            )
            .unwrap_err(),
            "embedded image path is not a file"
        );

        let oversized = root.join("oversized.png");
        fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_LOCAL_IMAGE_BYTES + 1)
            .unwrap();
        assert_eq!(
            read_markdown_image_file(
                markdown_path.to_string_lossy().to_string(),
                oversized.to_string_lossy().to_string()
            )
            .unwrap_err(),
            "embedded image is too large"
        );

        fs::remove_dir_all(root).unwrap();
    }
}
