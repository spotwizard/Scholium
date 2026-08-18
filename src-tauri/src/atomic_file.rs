use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_TEMP_FILE_ATTEMPTS: u64 = 16;

fn private_temp_path(path: &Path, attempt: u64) -> io::Result<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);

    Ok(parent.join(format!(
        ".{file_name}.{}.{}.{sequence}.{attempt}.tmp",
        std::process::id(),
        timestamp
    )))
}

pub(crate) fn atomic_replace_private_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut opened_temp_file = None;

    for attempt in 0..MAX_TEMP_FILE_ATTEMPTS {
        let temp_path = private_temp_path(path, attempt)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }

        match options.open(&temp_path) {
            Ok(temp_file) => {
                opened_temp_file = Some((temp_path, temp_file));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }

    let (temp_path, mut temp_file) = opened_temp_file
        .ok_or_else(|| io::Error::new(io::ErrorKind::AlreadyExists, "no temp file available"))?;
    let write_result = temp_file
        .write_all(contents)
        .and_then(|_| temp_file.sync_all());
    drop(temp_file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

pub(crate) enum NoFollowFileRead {
    Missing,
    FinalSymlink,
    Contents(String),
}

fn configure_no_follow(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(not(unix))]
    let _ = options;
}

fn verify_opened_regular_file(
    file: &fs::File,
    expected_metadata: Option<&fs::Metadata>,
    private: bool,
) -> io::Result<()> {
    let opened_metadata = file.metadata()?;
    if !opened_metadata.is_file() {
        return Err(io::Error::other("opened input is not a regular file"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        if let Some(expected_metadata) = expected_metadata {
            if opened_metadata.dev() != expected_metadata.dev()
                || opened_metadata.ino() != expected_metadata.ino()
            {
                return Err(io::Error::other(
                    "input path changed before it could be opened",
                ));
            }
        }
        if private && opened_metadata.nlink() != 1 {
            return Err(io::Error::other("private input has multiple hard links"));
        }
        if private && opened_metadata.permissions().mode() & 0o777 != 0o600 {
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
    }
    #[cfg(not(unix))]
    let _ = (expected_metadata, private);

    Ok(())
}

fn verify_opened_file_still_matches_path(
    path: &Path,
    file: &fs::File,
    private: bool,
) -> io::Result<()> {
    let current_metadata = fs::symlink_metadata(path)?;
    if current_metadata.file_type().is_symlink() || !current_metadata.is_file() {
        return Err(io::Error::other("input path changed while it was open"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let opened_metadata = file.metadata()?;
        if opened_metadata.dev() != current_metadata.dev()
            || opened_metadata.ino() != current_metadata.ino()
            || (private && opened_metadata.nlink() != 1)
        {
            return Err(io::Error::other("input path changed while it was open"));
        }
    }
    #[cfg(not(unix))]
    let _ = (file, private);

    Ok(())
}

fn read_file_to_string_no_follow(path: &Path, private: bool) -> io::Result<NoFollowFileRead> {
    let path_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Ok(NoFollowFileRead::FinalSymlink)
        }
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Err(io::Error::other("input path is not a regular file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(NoFollowFileRead::Missing)
        }
        Err(error) => return Err(error),
    };
    let mut options = OpenOptions::new();
    options.read(true);
    configure_no_follow(&mut options);
    let mut file = options.open(path)?;
    verify_opened_regular_file(&file, Some(&path_metadata), private)?;

    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    verify_opened_file_still_matches_path(path, &file, private)?;

    Ok(NoFollowFileRead::Contents(contents))
}

pub(crate) fn open_private_lock_file(path: &Path) -> io::Result<(fs::File, bool)> {
    for _ in 0..3 {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(io::Error::other("lock path is a symbolic link"))
            }
            Ok(metadata) if metadata.is_file() => {
                let mut options = OpenOptions::new();
                options.read(true).write(true);
                configure_no_follow(&mut options);
                let file = match options.open(path) {
                    Ok(file) => file,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                };
                verify_opened_regular_file(&file, Some(&metadata), true)?;
                verify_opened_file_still_matches_path(path, &file, true)?;
                return Ok((file, false));
            }
            Ok(_) => return Err(io::Error::other("lock path is not a regular file")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let mut options = OpenOptions::new();
                options.read(true).write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                configure_no_follow(&mut options);
                match options.open(path) {
                    Ok(file) => {
                        verify_opened_regular_file(&file, None, true)?;
                        verify_opened_file_still_matches_path(path, &file, true)?;
                        return Ok((file, true));
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::other("lock path changed too many times"))
}

pub(crate) fn read_private_file_no_follow(path: &Path) -> io::Result<NoFollowFileRead> {
    read_file_to_string_no_follow(path, true)
}

pub(crate) fn read_regular_file_no_follow(path: &Path) -> io::Result<NoFollowFileRead> {
    read_file_to_string_no_follow(path, false)
}

fn optional_contents(read: NoFollowFileRead) -> Option<String> {
    match read {
        NoFollowFileRead::Contents(contents) => Some(contents),
        NoFollowFileRead::Missing | NoFollowFileRead::FinalSymlink => None,
    }
}

pub(crate) fn read_private_file_to_string(path: &Path) -> io::Result<Option<String>> {
    read_private_file_no_follow(path).map(optional_contents)
}

pub(crate) fn read_regular_file_to_string(path: &Path) -> io::Result<Option<String>> {
    read_regular_file_no_follow(path).map(optional_contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "scholium-atomic-file-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    #[cfg(unix)]
    fn assert_private_permissions(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn replaces_complete_file_without_leaving_temp_files() {
        let directory = test_directory("replace");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.json");
        fs::write(&path, br#"{"version":"old"}"#).unwrap();

        atomic_replace_private_file(&path, br#"{"version":"new"}"#).unwrap();

        assert_eq!(fs::read(&path).unwrap(), br#"{"version":"new"}"#);
        #[cfg(unix)]
        assert_private_permissions(&path);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn creates_private_file_on_first_write() {
        let directory = test_directory("create");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("dropbox.json");

        atomic_replace_private_file(&path, br#"{"accessToken":"secret"}"#).unwrap();

        assert_eq!(fs::read(&path).unwrap(), br#"{"accessToken":"secret"}"#);
        #[cfg(unix)]
        assert_private_permissions(&path);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn reads_and_restricts_permissions_on_an_existing_private_file() {
        use std::os::unix::fs::PermissionsExt;

        let directory = test_directory("permissions");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("dropbox.json");
        fs::write(&path, br#"{"accessToken":"secret"}"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(
            read_private_file_to_string(&path).unwrap().as_deref(),
            Some(r#"{"accessToken":"secret"}"#)
        );

        assert_private_permissions(&path);
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn private_reader_never_follows_final_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = test_directory("read-symlink");
        fs::create_dir_all(&directory).unwrap();
        let referent = directory.join("referent.json");
        let link = directory.join("dropbox.json");
        let dangling_referent = directory.join("missing.json");
        fs::write(&referent, br#"{"accessToken":"do-not-read"}"#).unwrap();
        fs::set_permissions(&referent, fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&referent, &link).unwrap();

        assert_eq!(read_private_file_to_string(&link).unwrap(), None);
        assert_eq!(
            fs::read(&referent).unwrap(),
            br#"{"accessToken":"do-not-read"}"#
        );
        assert_eq!(
            fs::metadata(&referent).unwrap().permissions().mode() & 0o777,
            0o644
        );

        fs::remove_file(&link).unwrap();
        symlink(&dangling_referent, &link).unwrap();
        assert_eq!(read_private_file_to_string(&link).unwrap(), None);
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());

        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn private_reader_rejects_hard_links_without_changing_the_shared_inode() {
        use std::os::unix::fs::PermissionsExt;

        let directory = test_directory("read-hard-link");
        fs::create_dir_all(&directory).unwrap();
        let referent = directory.join("referent.json");
        let link = directory.join("dropbox.json");
        fs::write(&referent, br#"{"accessToken":"do-not-read"}"#).unwrap();
        fs::set_permissions(&referent, fs::Permissions::from_mode(0o644)).unwrap();
        fs::hard_link(&referent, &link).unwrap();

        assert!(read_private_file_to_string(&link).is_err());
        assert_eq!(
            fs::read(&referent).unwrap(),
            br#"{"accessToken":"do-not-read"}"#
        );
        assert_eq!(
            fs::metadata(&referent).unwrap().permissions().mode() & 0o777,
            0o644
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn regular_reader_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = test_directory("read-regular");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("article.md.notes.json");
        fs::write(&path, "notes").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(
            read_regular_file_to_string(&path).unwrap().as_deref(),
            Some("notes")
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o644
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn removes_temp_file_when_replace_fails() {
        let directory = test_directory("failure");
        let target_directory = directory.join("target");
        fs::create_dir_all(&target_directory).unwrap();
        fs::write(target_directory.join("sentinel"), b"keep").unwrap();

        assert!(atomic_replace_private_file(&target_directory, b"replacement").is_err());

        assert_eq!(
            fs::read(target_directory.join("sentinel")).unwrap(),
            b"keep"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
