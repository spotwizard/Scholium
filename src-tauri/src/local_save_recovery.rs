use crate::atomic_file::{
    atomic_replace_private_file, open_private_lock_file, read_private_file_no_follow,
    read_regular_file_no_follow, NoFollowFileRead,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

const MANIFEST_VERSION: u32 = 1;
const MANIFEST_EXTENSION: &str = "json";
const STORE_LOCK_FILE: &str = ".store.lock";
const INJECTED_FAILURE: &str = "injected local save failure";
pub(crate) const RECOVERY_CONFLICT_ERROR: &str = "local document recovery conflict";
pub(crate) const INVALID_MANIFEST_ERROR: &str = "local document recovery manifest is invalid";

static LOCAL_DOCUMENT_MUTEX: Mutex<()> = Mutex::new(());
static MANIFEST_STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) struct LocalDocumentGuard {
    _process_guard: MutexGuard<'static, ()>,
    _store_lock: File,
}

pub(crate) fn lock_local_documents(
    recovery_directory: &Path,
) -> Result<LocalDocumentGuard, String> {
    let process_guard = LOCAL_DOCUMENT_MUTEX
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    create_durable_directory(recovery_directory)
        .map_err(|error| format!("failed to create local recovery directory: {error}"))?;

    let lock_path = recovery_directory.join(STORE_LOCK_FILE);
    let (store_lock, lock_created) = open_private_lock_file(&lock_path)
        .map_err(|error| format!("failed to open local recovery lock: {error}"))?;
    if lock_created {
        store_lock
            .sync_all()
            .and_then(|_| sync_directory(recovery_directory))
            .map_err(|error| format!("failed to sync local recovery lock: {error}"))?;
    }
    store_lock
        .lock()
        .map_err(|error| format!("failed to lock local recovery store: {error}"))?;

    Ok(LocalDocumentGuard {
        _process_guard: process_guard,
        _store_lock: store_lock,
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDocumentPaths {
    document: PathBuf,
    notes: PathBuf,
    sidecar: PathBuf,
    mirror_notes_to_sidecar: bool,
}

impl LocalDocumentPaths {
    pub(crate) fn new(
        document: PathBuf,
        notes: PathBuf,
        sidecar: PathBuf,
        mirror_notes_to_sidecar: bool,
    ) -> Self {
        Self {
            document,
            notes,
            sidecar,
            mirror_notes_to_sidecar,
        }
    }

    pub(crate) fn notes(&self) -> &Path {
        &self.notes
    }

    pub(crate) fn mirrors_notes_to_sidecar(&self) -> bool {
        self.mirror_notes_to_sidecar
    }
}

#[derive(Debug)]
pub(crate) struct LocalDocumentPayload {
    document_id: String,
    body: String,
    notes: Option<String>,
}

impl LocalDocumentPayload {
    pub(crate) fn new(document_id: String, body: String, notes: Option<String>) -> Self {
        Self {
            document_id,
            body,
            notes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSnapshot {
    contents: Option<String>,
    sha256: String,
}

impl FileSnapshot {
    fn new(contents: Option<String>) -> Self {
        let sha256 = contents_hash(contents.as_deref());
        Self { contents, sha256 }
    }

    fn validate(&self) -> bool {
        self.sha256 == contents_hash(self.contents.as_deref())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSnapshot {
    body: FileSnapshot,
    notes: FileSnapshot,
    sidecar: FileSnapshot,
}

impl DocumentSnapshot {
    fn validate(&self) -> bool {
        self.body.validate() && self.notes.validate() && self.sidecar.validate()
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSaveManifest {
    version: u32,
    document_id: String,
    document_id_sha256: String,
    paths: LocalDocumentPaths,
    before: DocumentSnapshot,
    after: DocumentSnapshot,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesPayloadHeader {
    version: u32,
    markdown_path: String,
    notes: Vec<serde_json::Value>,
    #[serde(default)]
    glossary_terms: Vec<serde_json::Value>,
    #[serde(default)]
    glossary_bindings: Vec<serde_json::Value>,
}

impl NotesPayloadHeader {
    fn is_empty(&self) -> bool {
        self.notes.is_empty() && self.glossary_terms.is_empty() && self.glossary_bindings.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SnapshotPosition {
    Before,
    After,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SaveStage {
    Manifest,
    Body,
    Notes,
    Sidecar,
    Verification,
}

fn contents_hash(contents: Option<&str>) -> String {
    let mut digest = Sha256::new();
    match contents {
        Some(contents) => {
            digest.update(b"present\0");
            digest.update(contents.as_bytes());
        }
        None => digest.update(b"absent\0"),
    }
    let digest = digest.finalize();
    format!("{digest:x}")
}

fn document_path_hash(path: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(path.to_string_lossy().as_bytes());
    let digest = digest.finalize();
    format!("{digest:x}")
}

fn text_hash(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    let digest = digest.finalize();
    format!("{digest:x}")
}

fn resolve_document_id(document_id: &str) -> io::Result<PathBuf> {
    let path = Path::new(document_id);
    if path.exists() {
        return fs::canonicalize(path);
    }

    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "document id has no file name")
    })?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    Ok(fs::canonicalize(parent)?.join(file_name))
}

fn manifest_path(recovery_directory: &Path, document_path: &Path) -> PathBuf {
    recovery_directory.join(format!(
        "{}.{}",
        document_path_hash(document_path),
        MANIFEST_EXTENSION
    ))
}

fn read_surface(path: &Path) -> io::Result<FileSnapshot> {
    match fs::read(path) {
        Ok(contents) => String::from_utf8(contents)
            .map(|contents| FileSnapshot::new(Some(contents)))
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "surface is not UTF-8")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(FileSnapshot::new(None)),
        Err(error) => Err(error),
    }
}

fn snapshot_from_no_follow_read(read: NoFollowFileRead) -> FileSnapshot {
    FileSnapshot::new(match read {
        NoFollowFileRead::Missing => None,
        NoFollowFileRead::FinalSymlink => Some(String::new()),
        NoFollowFileRead::Contents(contents) => Some(contents),
    })
}

fn read_private_surface(path: &Path) -> io::Result<FileSnapshot> {
    read_private_file_no_follow(path).map(snapshot_from_no_follow_read)
}

fn read_sidecar_surface(path: &Path) -> io::Result<FileSnapshot> {
    read_regular_file_no_follow(path).map(snapshot_from_no_follow_read)
}

fn read_document_snapshot(paths: &LocalDocumentPaths) -> io::Result<DocumentSnapshot> {
    Ok(DocumentSnapshot {
        body: read_surface(&paths.document)?,
        notes: read_private_surface(&paths.notes)?,
        sidecar: read_sidecar_surface(&paths.sidecar)?,
    })
}

fn after_snapshot(
    paths: &LocalDocumentPaths,
    document_id: &str,
    body: String,
    notes: Option<String>,
) -> DocumentSnapshot {
    let sidecar = paths
        .mirror_notes_to_sidecar
        .then(|| notes.clone())
        .flatten()
        .filter(|notes| !notes_payload_is_empty(notes, document_id));

    DocumentSnapshot {
        body: FileSnapshot::new(Some(body)),
        notes: FileSnapshot::new(notes),
        sidecar: FileSnapshot::new(sidecar),
    }
}

fn snapshot_position(
    current: &FileSnapshot,
    before: &FileSnapshot,
    after: &FileSnapshot,
) -> SnapshotPosition {
    if current == after {
        SnapshotPosition::After
    } else if current == before {
        SnapshotPosition::Before
    } else {
        SnapshotPosition::Unknown
    }
}

fn document_positions(
    current: &DocumentSnapshot,
    manifest: &LocalSaveManifest,
) -> [SnapshotPosition; 3] {
    [
        snapshot_position(&current.body, &manifest.before.body, &manifest.after.body),
        snapshot_position(
            &current.notes,
            &manifest.before.notes,
            &manifest.after.notes,
        ),
        snapshot_position(
            &current.sidecar,
            &manifest.before.sidecar,
            &manifest.after.sidecar,
        ),
    ]
}

fn validate_notes_payload(payload: &str, document_id: &str) -> bool {
    serde_json::from_str::<NotesPayloadHeader>(payload)
        .is_ok_and(|header| header.version == 1 && header.markdown_path == document_id)
}

fn notes_payload_is_empty(payload: &str, document_id: &str) -> bool {
    serde_json::from_str::<NotesPayloadHeader>(payload).is_ok_and(|header| {
        header.version == 1 && header.markdown_path == document_id && header.is_empty()
    })
}

fn validate_manifest_shape(manifest: &LocalSaveManifest) -> bool {
    if manifest.version != MANIFEST_VERSION
        || manifest.document_id.is_empty()
        || manifest.document_id_sha256 != text_hash(&manifest.document_id)
        || !manifest.paths.document.is_absolute()
        || !manifest.paths.notes.is_absolute()
        || !manifest.paths.sidecar.is_absolute()
        || !manifest.before.validate()
        || !manifest.after.validate()
        || manifest.after.body.contents.is_none()
    {
        return false;
    }

    let notes_are_valid = manifest
        .after
        .notes
        .contents
        .as_deref()
        .is_none_or(|notes| validate_notes_payload(notes, &manifest.document_id));
    let sidecar_is_valid = if manifest.paths.mirror_notes_to_sidecar {
        manifest.after.sidecar == manifest.after.notes
            || (manifest.after.sidecar.contents.is_none()
                && manifest
                    .after
                    .notes
                    .contents
                    .as_deref()
                    .is_some_and(|notes| notes_payload_is_empty(notes, &manifest.document_id)))
    } else {
        manifest.after.sidecar.contents.is_none()
    };

    notes_are_valid && sidecar_is_valid
}

fn validate_manifest(
    manifest: &LocalSaveManifest,
    expected_paths: &LocalDocumentPaths,
) -> Result<(), String> {
    if validate_manifest_shape(manifest)
        && &manifest.paths == expected_paths
        && resolve_document_id(&manifest.document_id).ok().as_deref()
            == Some(expected_paths.document.as_path())
    {
        Ok(())
    } else {
        Err(INVALID_MANIFEST_ERROR.to_string())
    }
}

fn read_manifest(path: &Path) -> Result<LocalSaveManifest, String> {
    let raw =
        match read_regular_file_no_follow(path).map_err(|_| INVALID_MANIFEST_ERROR.to_string())? {
            NoFollowFileRead::Contents(contents) => contents,
            NoFollowFileRead::Missing | NoFollowFileRead::FinalSymlink => {
                return Err(INVALID_MANIFEST_ERROR.to_string())
            }
        };
    serde_json::from_str(&raw).map_err(|_| INVALID_MANIFEST_ERROR.to_string())
}

fn ensure_no_symlink_components(path: &Path) -> io::Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(io::Error::other(
                    "recovery directory path contains a symbolic link",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(unix)]
fn open_directory_no_follow(directory: &Path) -> io::Result<File> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    ensure_no_symlink_components(directory)?;
    let expected_metadata = fs::symlink_metadata(directory)?;
    if expected_metadata.file_type().is_symlink() || !expected_metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotADirectory,
            "recovery path is not a directory",
        ));
    }

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let directory_file = options.open(directory)?;
    let opened_metadata = directory_file.metadata()?;
    if !opened_metadata.is_dir()
        || opened_metadata.dev() != expected_metadata.dev()
        || opened_metadata.ino() != expected_metadata.ino()
    {
        return Err(io::Error::other(
            "recovery directory changed before it could be opened",
        ));
    }

    let current_metadata = fs::symlink_metadata(directory)?;
    if current_metadata.file_type().is_symlink()
        || opened_metadata.dev() != current_metadata.dev()
        || opened_metadata.ino() != current_metadata.ino()
    {
        return Err(io::Error::other(
            "recovery directory changed while it was open",
        ));
    }

    Ok(directory_file)
}

fn sync_directory(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        open_directory_no_follow(directory)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
        Ok(())
    }
}

pub(crate) fn create_durable_directory(directory: &Path) -> io::Result<()> {
    ensure_no_symlink_components(directory)?;
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            ensure_private_directory_permissions(directory)?;
            return Ok(());
        }
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "recovery path is not a directory",
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let mut missing = Vec::new();
    let mut current = directory;
    loop {
        match fs::symlink_metadata(current) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => break,
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::NotADirectory,
                    "recovery directory ancestor is not a directory",
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(current.to_path_buf());
                current = current.parent().ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "recovery directory has no existing ancestor",
                    )
                })?;
            }
            Err(error) => return Err(error),
        }
    }

    for path in missing.iter().rev() {
        let create_result = {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path)
        };
        match create_result {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let metadata = fs::symlink_metadata(path)?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(io::Error::new(
                        io::ErrorKind::NotADirectory,
                        "recovery path is not a directory",
                    ));
                }
            }
            Err(error) => return Err(error),
        }
        ensure_private_directory_permissions(path)?;
        sync_directory(path)?;
        if let Some(parent) = path.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

fn ensure_private_directory_permissions(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let directory_file = open_directory_no_follow(directory)?;
        if directory_file.metadata()?.permissions().mode() & 0o777 != 0o700 {
            directory_file.set_permissions(fs::Permissions::from_mode(0o700))?;
            directory_file.sync_all()?;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
    }
    Ok(())
}

fn manifest_stage_path(manifest_path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = MANIFEST_STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    manifest_path.with_extension(format!(
        "stage.{}.{}.{}",
        std::process::id(),
        timestamp,
        sequence
    ))
}

fn create_manifest(path: &Path, manifest: &LocalSaveManifest) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "local recovery path has no parent directory".to_string())?;
    create_durable_directory(directory)
        .map_err(|error| format!("failed to create local recovery directory: {error}"))?;

    let serialized = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("failed to serialize local recovery manifest: {error}"))?;
    let stage_path = manifest_stage_path(path);
    atomic_replace_private_file(&stage_path, &serialized)
        .map_err(|error| format!("failed to stage local recovery manifest: {error}"))?;
    let link_result = fs::hard_link(&stage_path, path);
    let _ = fs::remove_file(&stage_path);

    match link_result {
        Ok(()) => sync_directory(directory)
            .map_err(|error| format!("failed to sync local recovery directory: {error}")),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(RECOVERY_CONFLICT_ERROR.to_string())
        }
        Err(error) => Err(format!("failed to create local recovery manifest: {error}")),
    }
}

fn write_in_place(path: &Path, contents: &str) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true);
    if path.exists() {
        options.truncate(true);
    } else {
        options.create_new(true);
    }

    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    drop(file);
    sync_directory(path.parent().unwrap_or_else(|| Path::new(".")))
}

fn write_private_notes(path: &Path, contents: Option<&str>) -> io::Result<()> {
    match contents {
        Some(contents) => {
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            fs::create_dir_all(parent)?;
            atomic_replace_private_file(path, contents.as_bytes())?;
            sync_directory(parent)
        }
        None => match fs::remove_file(path) {
            Ok(()) => {
                let parent = path.parent().unwrap_or_else(|| Path::new("."));
                sync_directory(parent)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
    }
}

fn write_sidecar(path: &Path, contents: Option<&str>) -> io::Result<()> {
    match contents {
        Some(contents) => {
            crate::write_legacy_sidecar(path, contents)?;
            sync_directory(path.parent().unwrap_or_else(|| Path::new(".")))
        }
        None => match fs::remove_file(path) {
            Ok(()) => sync_directory(path.parent().unwrap_or_else(|| Path::new("."))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
    }
}

fn current_positions(manifest: &LocalSaveManifest) -> Result<[SnapshotPosition; 3], String> {
    let current = match read_document_snapshot(&manifest.paths) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::InvalidData => {
            return Err(RECOVERY_CONFLICT_ERROR.to_string())
        }
        Err(error) => {
            return Err(format!(
                "failed to inspect local recovery surfaces: {error}"
            ))
        }
    };
    let positions = document_positions(&current, manifest);
    if positions.contains(&SnapshotPosition::Unknown) {
        Err(RECOVERY_CONFLICT_ERROR.to_string())
    } else {
        Ok(positions)
    }
}

fn apply_after(
    manifest: &LocalSaveManifest,
    rewrite_unchanged_save: bool,
    fail_at: Option<SaveStage>,
) -> Result<(), String> {
    let positions = current_positions(manifest)?;
    if positions[0] != SnapshotPosition::After
        || (rewrite_unchanged_save && manifest.before.body == manifest.after.body)
    {
        write_in_place(
            &manifest.paths.document,
            manifest
                .after
                .body
                .contents
                .as_deref()
                .ok_or_else(|| INVALID_MANIFEST_ERROR.to_string())?,
        )
        .map_err(|error| format!("failed to write local Markdown body: {error}"))?;
    }
    fail_if_requested(SaveStage::Body, fail_at)?;

    let positions = current_positions(manifest)?;
    if positions[1] != SnapshotPosition::After
        || (rewrite_unchanged_save && manifest.before.notes == manifest.after.notes)
    {
        write_private_notes(
            &manifest.paths.notes,
            manifest.after.notes.contents.as_deref(),
        )
        .map_err(|error| format!("failed to write local document notes: {error}"))?;
    }
    fail_if_requested(SaveStage::Notes, fail_at)?;

    let positions = current_positions(manifest)?;
    if positions[2] != SnapshotPosition::After
        || (rewrite_unchanged_save && manifest.before.sidecar == manifest.after.sidecar)
    {
        write_sidecar(
            &manifest.paths.sidecar,
            manifest.after.sidecar.contents.as_deref(),
        )
        .map_err(|error| format!("failed to write local notes sidecar: {error}"))?;
    }
    fail_if_requested(SaveStage::Sidecar, fail_at)
}

fn fail_if_requested(stage: SaveStage, fail_at: Option<SaveStage>) -> Result<(), String> {
    if fail_at == Some(stage) {
        Err(INJECTED_FAILURE.to_string())
    } else {
        Ok(())
    }
}

fn verify_after(manifest: &LocalSaveManifest) -> Result<(), String> {
    let current = match read_document_snapshot(&manifest.paths) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::InvalidData => {
            return Err(RECOVERY_CONFLICT_ERROR.to_string())
        }
        Err(error) => return Err(format!("failed to verify local document save: {error}")),
    };
    if current == manifest.after {
        Ok(())
    } else {
        Err(RECOVERY_CONFLICT_ERROR.to_string())
    }
}

fn clear_manifest(path: &Path) -> Result<(), String> {
    fs::remove_file(path)
        .map_err(|error| format!("failed to clear local recovery manifest: {error}"))?;
    let directory = path
        .parent()
        .ok_or_else(|| "local recovery path has no parent directory".to_string())?;
    sync_directory(directory)
        .map_err(|error| format!("failed to sync local recovery directory: {error}"))
}

pub(crate) fn recover_local_document(
    _guard: &LocalDocumentGuard,
    recovery_directory: &Path,
    paths: &LocalDocumentPaths,
) -> Result<bool, String> {
    let path = manifest_path(recovery_directory, &paths.document);
    match fs::symlink_metadata(&path) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "failed to inspect local recovery manifest: {error}"
            ))
        }
    }

    let manifest = read_manifest(&path)?;
    validate_manifest(&manifest, paths)?;
    current_positions(&manifest)?;
    apply_after(&manifest, false, None)?;
    verify_after(&manifest)?;
    clear_manifest(&path)?;
    Ok(true)
}

pub(crate) fn save_local_document(
    guard: &LocalDocumentGuard,
    recovery_directory: &Path,
    paths: LocalDocumentPaths,
    payload: LocalDocumentPayload,
) -> Result<(), String> {
    save_local_document_with_failpoint(guard, recovery_directory, paths, payload, None)
}

pub(crate) fn repair_local_sidecar(
    guard: &LocalDocumentGuard,
    recovery_directory: &Path,
    paths: &LocalDocumentPaths,
    document_id: String,
    desired_sidecar: Option<String>,
) -> Result<bool, String> {
    repair_local_sidecar_with_failpoint(
        guard,
        recovery_directory,
        paths,
        document_id,
        desired_sidecar,
        None,
    )
}

fn repair_local_sidecar_with_failpoint(
    guard: &LocalDocumentGuard,
    recovery_directory: &Path,
    paths: &LocalDocumentPaths,
    document_id: String,
    desired_sidecar: Option<String>,
    fail_at: Option<SaveStage>,
) -> Result<bool, String> {
    recover_local_document(guard, recovery_directory, paths)?;
    let before = read_document_snapshot(paths)
        .map_err(|error| format!("failed to snapshot local document: {error}"))?;
    let after = DocumentSnapshot {
        body: before.body.clone(),
        notes: before.notes.clone(),
        sidecar: FileSnapshot::new(desired_sidecar),
    };
    if before.sidecar == after.sidecar {
        return Ok(false);
    }

    let manifest = LocalSaveManifest {
        version: MANIFEST_VERSION,
        document_id_sha256: text_hash(&document_id),
        document_id,
        paths: paths.clone(),
        before,
        after,
    };
    validate_manifest(&manifest, paths)?;

    let path = manifest_path(recovery_directory, &manifest.paths.document);
    create_manifest(&path, &manifest)?;
    fail_if_requested(SaveStage::Manifest, fail_at)?;
    apply_after(&manifest, false, fail_at)?;
    verify_after(&manifest)?;
    fail_if_requested(SaveStage::Verification, fail_at)?;
    clear_manifest(&path)?;
    Ok(true)
}

fn save_local_document_with_failpoint(
    guard: &LocalDocumentGuard,
    recovery_directory: &Path,
    paths: LocalDocumentPaths,
    payload: LocalDocumentPayload,
    fail_at: Option<SaveStage>,
) -> Result<(), String> {
    recover_local_document(guard, recovery_directory, &paths)?;
    let before = read_document_snapshot(&paths)
        .map_err(|error| format!("failed to snapshot local document: {error}"))?;
    let after = after_snapshot(&paths, &payload.document_id, payload.body, payload.notes);
    let manifest = LocalSaveManifest {
        version: MANIFEST_VERSION,
        document_id_sha256: text_hash(&payload.document_id),
        document_id: payload.document_id,
        paths,
        before,
        after,
    };

    validate_manifest(&manifest, &manifest.paths)?;

    let path = manifest_path(recovery_directory, &manifest.paths.document);
    create_manifest(&path, &manifest)?;
    fail_if_requested(SaveStage::Manifest, fail_at)?;
    apply_after(&manifest, true, fail_at)?;
    verify_after(&manifest)?;
    fail_if_requested(SaveStage::Verification, fail_at)?;
    clear_manifest(&path)
}

pub(crate) fn pending_document_paths(
    _guard: &LocalDocumentGuard,
    recovery_directory: &Path,
) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(recovery_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "failed to inspect local recovery directory: {error}"
            ))
        }
    };

    let mut documents = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to inspect local recovery manifest: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some(MANIFEST_EXTENSION) {
            continue;
        }

        let manifest = read_manifest(&path)?;
        if !validate_manifest_shape(&manifest)
            || path.file_name().and_then(|name| name.to_str())
                != manifest_path(recovery_directory, &manifest.paths.document)
                    .file_name()
                    .and_then(|name| name.to_str())
        {
            return Err(INVALID_MANIFEST_ERROR.to_string());
        }
        documents.push(manifest.paths.document);
    }

    documents.sort();
    documents.dedup();
    Ok(documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc, Barrier};

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    const STORE_LOCK_PROBE_PATH_ENV: &str = "SCHOLIUM_TEST_STORE_LOCK_PROBE_PATH";
    const STORE_LOCK_PROBE_MARKER_ENV: &str = "SCHOLIUM_TEST_STORE_LOCK_PROBE_MARKER";

    struct TestEnvironment {
        root: PathBuf,
        recovery: PathBuf,
        paths: LocalDocumentPaths,
    }

    impl TestEnvironment {
        fn new(name: &str, mirror_notes_to_sidecar: bool) -> Self {
            let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let unresolved_root = std::env::temp_dir().join(format!(
                "scholium-local-save-{name}-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&unresolved_root).unwrap();
            let root = fs::canonicalize(unresolved_root).unwrap();
            let document = root.join("workspace/article.md");
            let notes = root.join("app-data/notes/article.notes.json");
            let sidecar = root.join("workspace/article.md.notes.json");
            let recovery = root.join("app-data/recovery/local");
            fs::create_dir_all(document.parent().unwrap()).unwrap();
            fs::create_dir_all(notes.parent().unwrap()).unwrap();

            Self {
                root,
                recovery,
                paths: LocalDocumentPaths::new(document, notes, sidecar, mirror_notes_to_sidecar),
            }
        }

        fn seed_old_contents(&self) {
            fs::write(&self.paths.document, "old body").unwrap();
            fs::write(&self.paths.notes, notes_payload("old note")).unwrap();
            fs::write(&self.paths.sidecar, notes_payload("old note")).unwrap();
        }

        fn manifest_path(&self) -> PathBuf {
            super::manifest_path(&self.recovery, &self.paths.document)
        }
    }

    impl Drop for TestEnvironment {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn notes_payload(note: &str) -> String {
        serde_json::json!({
            "version": 1,
            "markdownPath": "PLACEHOLDER",
            "notes": [{"body": note}],
            "glossaryTerms": [],
            "glossaryBindings": []
        })
        .to_string()
    }

    fn valid_notes_payload(document_id: &str, note: &str) -> String {
        serde_json::json!({
            "version": 1,
            "markdownPath": document_id,
            "notes": [{"body": note}],
            "glossaryTerms": [],
            "glossaryBindings": []
        })
        .to_string()
    }

    fn payload(
        environment: &TestEnvironment,
        body: &str,
        note: Option<&str>,
    ) -> LocalDocumentPayload {
        let document_id = environment.paths.document.to_string_lossy().to_string();
        LocalDocumentPayload::new(
            document_id.clone(),
            body.to_string(),
            note.map(|note| valid_notes_payload(&document_id, note)),
        )
    }

    #[test]
    fn saves_body_notes_and_mirror_then_clears_manifest() {
        let environment = TestEnvironment::new("normal", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
        )
        .unwrap();

        let document_id = environment.paths.document.to_string_lossy().to_string();
        let expected_notes = valid_notes_payload(&document_id, "new note");
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "new body"
        );
        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            expected_notes
        );
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            expected_notes
        );
        assert!(!environment.manifest_path().exists());
    }

    #[test]
    fn replays_every_interrupted_stage() {
        for stage in [
            SaveStage::Manifest,
            SaveStage::Body,
            SaveStage::Notes,
            SaveStage::Sidecar,
            SaveStage::Verification,
        ] {
            let environment = TestEnvironment::new(&format!("replay-{stage:?}"), true);
            environment.seed_old_contents();
            let guard = lock_local_documents(&environment.recovery).unwrap();
            let result = save_local_document_with_failpoint(
                &guard,
                &environment.recovery,
                environment.paths.clone(),
                payload(&environment, "new body", Some("new note")),
                Some(stage),
            );

            assert_eq!(result.unwrap_err(), INJECTED_FAILURE);
            assert!(environment.manifest_path().exists());
            assert!(
                recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap()
            );

            let document_id = environment.paths.document.to_string_lossy().to_string();
            let expected_notes = valid_notes_payload(&document_id, "new note");
            assert_eq!(
                fs::read_to_string(&environment.paths.document).unwrap(),
                "new body"
            );
            assert_eq!(
                fs::read_to_string(&environment.paths.notes).unwrap(),
                expected_notes
            );
            assert_eq!(
                fs::read_to_string(&environment.paths.sidecar).unwrap(),
                expected_notes
            );
            assert!(!environment.manifest_path().exists());
        }
    }

    #[test]
    fn partial_or_external_body_is_unknown_and_never_overwritten() {
        let environment = TestEnvironment::new("unknown-body", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        fs::write(&environment.paths.document, "new").unwrap();

        let error =
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err();

        assert_eq!(error, RECOVERY_CONFLICT_ERROR);
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "new"
        );
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn non_utf8_partial_body_is_a_stable_unknown_conflict() {
        let environment = TestEnvironment::new("unknown-non-utf8-body", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        fs::write(&environment.paths.document, [0xff, 0xfe]).unwrap();

        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            RECOVERY_CONFLICT_ERROR
        );
        assert_eq!(fs::read(&environment.paths.document).unwrap(), [0xff, 0xfe]);
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn external_notes_are_unknown_and_never_overwritten() {
        let environment = TestEnvironment::new("unknown-notes", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Body),
        )
        .unwrap_err();
        fs::write(&environment.paths.notes, "external notes").unwrap();

        let error =
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err();

        assert_eq!(error, RECOVERY_CONFLICT_ERROR);
        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            "external notes"
        );
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn partial_sidecar_is_unknown_and_never_overwritten() {
        let environment = TestEnvironment::new("unknown-sidecar", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Notes),
        )
        .unwrap_err();
        fs::write(&environment.paths.sidecar, "partial sidecar").unwrap();

        let error =
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err();

        assert_eq!(error, RECOVERY_CONFLICT_ERROR);
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            "partial sidecar"
        );
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn missing_sidecar_repair_is_journaled_and_replayable() {
        let environment = TestEnvironment::new("repair-missing-sidecar", true);
        fs::write(&environment.paths.document, "body").unwrap();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let notes = valid_notes_payload(&document_id, "note");
        fs::write(&environment.paths.notes, &notes).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        assert_eq!(
            repair_local_sidecar_with_failpoint(
                &guard,
                &environment.recovery,
                &environment.paths,
                document_id,
                Some(notes.clone()),
                Some(SaveStage::Manifest),
            )
            .unwrap_err(),
            INJECTED_FAILURE
        );
        assert!(environment.manifest_path().exists());
        assert!(!environment.paths.sidecar.exists());
        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            notes
        );
    }

    #[test]
    fn stale_sidecar_is_repaired_but_identical_bytes_are_not_rewritten() {
        let environment = TestEnvironment::new("repair-stale-sidecar", true);
        fs::write(&environment.paths.document, "body").unwrap();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let notes = valid_notes_payload(&document_id, "note");
        fs::write(&environment.paths.notes, &notes).unwrap();
        fs::write(&environment.paths.sidecar, "stale").unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        assert!(repair_local_sidecar(
            &guard,
            &environment.recovery,
            &environment.paths,
            document_id.clone(),
            Some(notes.clone()),
        )
        .unwrap());
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            notes
        );
        let modified_at = fs::metadata(&environment.paths.sidecar)
            .unwrap()
            .modified()
            .unwrap();
        assert!(!repair_local_sidecar(
            &guard,
            &environment.recovery,
            &environment.paths,
            document_id,
            Some(fs::read_to_string(&environment.paths.notes).unwrap()),
        )
        .unwrap());
        assert_eq!(
            fs::metadata(&environment.paths.sidecar)
                .unwrap()
                .modified()
                .unwrap(),
            modified_at
        );
    }

    #[test]
    fn legacy_notes_without_glossary_fields_repair_missing_and_stale_sidecars() {
        for (name, stale_sidecar) in [("missing", false), ("stale", true)] {
            let environment = TestEnvironment::new(&format!("repair-legacy-{name}"), true);
            fs::write(&environment.paths.document, "body").unwrap();
            let document_id = environment.paths.document.to_string_lossy().to_string();
            let mut legacy_notes: serde_json::Value =
                serde_json::from_str(include_str!("../../tests/fixtures/notes-v1-legacy.json"))
                    .unwrap();
            legacy_notes["markdownPath"] = serde_json::json!(document_id);
            legacy_notes["notes"][0]["documentId"] = legacy_notes["markdownPath"].clone();
            let notes = legacy_notes.to_string();
            fs::write(&environment.paths.notes, &notes).unwrap();
            if stale_sidecar {
                fs::write(&environment.paths.sidecar, "stale").unwrap();
            }
            let guard = lock_local_documents(&environment.recovery).unwrap();

            assert!(repair_local_sidecar(
                &guard,
                &environment.recovery,
                &environment.paths,
                document_id,
                Some(notes.clone()),
            )
            .unwrap());
            assert_eq!(
                fs::read_to_string(&environment.paths.sidecar).unwrap(),
                notes
            );
        }
    }

    #[test]
    fn empty_notes_repair_removes_only_the_sidecar() {
        let environment = TestEnvironment::new("repair-empty-sidecar", true);
        fs::write(&environment.paths.document, "body").unwrap();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let empty_notes = serde_json::json!({
            "version": 1,
            "markdownPath": document_id,
            "notes": [],
            "glossaryTerms": [],
            "glossaryBindings": []
        })
        .to_string();
        fs::write(&environment.paths.notes, &empty_notes).unwrap();
        fs::write(&environment.paths.sidecar, &empty_notes).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        assert!(repair_local_sidecar(
            &guard,
            &environment.recovery,
            &environment.paths,
            document_id,
            None,
        )
        .unwrap());
        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            empty_notes
        );
        assert!(!environment.paths.sidecar.exists());
    }

    #[test]
    fn empty_notes_remove_private_and_sidecar_files() {
        let environment = TestEnvironment::new("empty-notes", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "new body"
        );
        assert!(!environment.paths.notes.exists());
        assert!(!environment.paths.sidecar.exists());
        assert!(!environment.manifest_path().exists());
    }

    #[test]
    fn mirrored_empty_notes_keep_private_tombstone_and_remove_sidecar() {
        let environment = TestEnvironment::new("empty-notes-tombstone", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let empty_notes = serde_json::json!({
            "version": 1,
            "markdownPath": document_id,
            "notes": [],
            "glossaryTerms": [],
            "glossaryBindings": []
        })
        .to_string();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            LocalDocumentPayload::new(
                document_id,
                "new body".to_string(),
                Some(empty_notes.clone()),
            ),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            empty_notes
        );
        assert!(!environment.paths.sidecar.exists());
        assert!(!environment.manifest_path().exists());
    }

    #[test]
    fn non_dropbox_sidecar_is_removed_instead_of_mirrored() {
        let environment = TestEnvironment::new("no-mirror", false);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
        )
        .unwrap();

        assert!(environment.paths.notes.exists());
        assert!(!environment.paths.sidecar.exists());
    }

    #[test]
    fn corrupt_or_tampered_manifest_is_retained_and_rejected() {
        let environment = TestEnvironment::new("corrupt", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(environment.manifest_path()).unwrap())
                .unwrap();
        manifest["after"]["body"]["sha256"] = serde_json::Value::String("tampered".into());
        fs::write(
            environment.manifest_path(),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();

        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            INVALID_MANIFEST_ERROR
        );
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn malformed_manifest_is_retained_and_rejected() {
        let environment = TestEnvironment::new("malformed-manifest", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        fs::write(environment.manifest_path(), "{").unwrap();

        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            INVALID_MANIFEST_ERROR
        );
        assert!(environment.manifest_path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn dangling_manifest_symlink_is_retained_and_rejected() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("dangling-manifest", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        let referent = environment.root.join("missing-manifest.json");
        let manifest_path = environment.manifest_path();
        symlink(&referent, &manifest_path).unwrap();

        assert!(!manifest_path.exists());
        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            INVALID_MANIFEST_ERROR
        );
        assert!(fs::symlink_metadata(&manifest_path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!referent.exists());
    }

    #[cfg(unix)]
    #[test]
    fn recover_accepts_a_valid_manifest_with_an_interrupted_stage_hard_link() {
        let environment = TestEnvironment::new("manifest-stage-hard-link", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        let manifest_path = environment.manifest_path();
        let interrupted_stage = manifest_path.with_extension("stage.interrupted");
        fs::hard_link(&manifest_path, &interrupted_stage).unwrap();

        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "new body"
        );
        assert!(!manifest_path.exists());
        assert!(interrupted_stage.exists());
    }

    #[cfg(unix)]
    #[test]
    fn manifest_is_created_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let environment = TestEnvironment::new("private-manifest", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        assert_eq!(
            fs::metadata(environment.manifest_path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn tampered_document_id_cannot_be_detached_from_the_body_path() {
        let environment = TestEnvironment::new("tampered-document-id", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        let unrelated_path = environment.paths.document.with_file_name("unrelated.md");
        fs::write(&unrelated_path, "unrelated").unwrap();
        let unrelated_id = unrelated_path.to_string_lossy().to_string();
        let mut manifest = read_manifest(&environment.manifest_path()).unwrap();
        manifest.document_id = unrelated_id.clone();
        manifest.document_id_sha256 = text_hash(&unrelated_id);
        manifest.after.notes =
            FileSnapshot::new(Some(valid_notes_payload(&unrelated_id, "new note")));
        manifest.after.sidecar = manifest.after.notes.clone();
        fs::write(
            environment.manifest_path(),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            INVALID_MANIFEST_ERROR
        );
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "old body"
        );
        assert!(environment.manifest_path().exists());
    }

    #[test]
    fn recovery_is_idempotent() {
        let environment = TestEnvironment::new("idempotent", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Notes),
        )
        .unwrap_err();

        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());
        assert!(
            !recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn canonical_pending_save_replays_before_alias_legacy_access() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("canonical-pending-alias", true);
        environment.seed_old_contents();
        let alias_path = environment.paths.document.with_file_name("alias.md");
        symlink(&environment.paths.document, &alias_path).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Notes),
        )
        .unwrap_err();

        assert!(environment.manifest_path().exists());
        assert_eq!(
            crate::resolved_local_document_path(&alias_path).unwrap(),
            environment.paths.document
        );
        assert!(
            recover_local_document(&guard, &environment.recovery, &environment.paths,).unwrap()
        );

        let document_id = environment.paths.document.to_string_lossy().to_string();
        let expected_notes = valid_notes_payload(&document_id, "new note");
        assert_eq!(fs::read_to_string(&alias_path).unwrap(), "new body");
        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            expected_notes
        );
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            expected_notes
        );
        assert!(!environment.manifest_path().exists());

        fs::write(&alias_path, "alias save after gate").unwrap();
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "alias save after gate"
        );
    }

    #[cfg(unix)]
    #[test]
    fn dangling_alias_still_hits_and_blocks_a_canonical_pending_manifest() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("canonical-pending-dangling-alias", false);
        environment.seed_old_contents();
        let alias_path = environment.paths.document.with_file_name("alias.md");
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        fs::remove_file(&environment.paths.document).unwrap();
        symlink(&environment.paths.document, &alias_path).unwrap();

        assert_eq!(
            crate::resolved_local_document_path(&alias_path).unwrap(),
            environment.paths.document
        );
        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            RECOVERY_CONFLICT_ERROR
        );
        assert!(environment.manifest_path().exists());
        assert!(fs::symlink_metadata(&alias_path)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn creates_a_new_document_from_an_absent_before_state() {
        let environment = TestEnvironment::new("new-document", false);
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "new body"
        );
    }

    #[cfg(unix)]
    #[test]
    fn regular_duplicate_target_recovers_pending_manifest_even_for_symlink_source() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("duplicate-target-pending", false);
        let canonical_source = environment.paths.document.with_file_name("source.md");
        let source_alias = environment.paths.document.with_file_name("alias.md");
        fs::write(&canonical_source, "source body").unwrap();
        symlink(&canonical_source, &source_alias).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "recovered target body", None),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        assert!(crate::local_path_uses_symlink(&source_alias).unwrap());
        assert!(!crate::local_path_uses_symlink(&environment.paths.document).unwrap());
        assert!(
            recover_local_document(&guard, &environment.recovery, &environment.paths,).unwrap()
        );
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "recovered target body"
        );
    }

    #[test]
    fn rejects_document_id_that_does_not_resolve_to_the_body_path() {
        let environment = TestEnvironment::new("document-id-mismatch", false);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        let unrelated_id = environment
            .paths
            .document
            .with_file_name("unrelated.md")
            .to_string_lossy()
            .to_string();
        let notes = valid_notes_payload(&unrelated_id, "new note");

        let error = save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            LocalDocumentPayload::new(unrelated_id, "new body".into(), Some(notes)),
        )
        .unwrap_err();

        assert_eq!(error, INVALID_MANIFEST_ERROR);
        assert_eq!(
            fs::read_to_string(&environment.paths.document).unwrap(),
            "old body"
        );
        assert!(!environment.manifest_path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn existing_markdown_file_keeps_its_identity() {
        use std::os::unix::fs::MetadataExt;

        let environment = TestEnvironment::new("identity", false);
        environment.seed_old_contents();
        let inode_before = fs::metadata(&environment.paths.document).unwrap().ino();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
        )
        .unwrap();

        assert_eq!(
            fs::metadata(&environment.paths.document).unwrap().ino(),
            inode_before
        );
    }

    #[cfg(unix)]
    #[test]
    fn existing_sidecar_keeps_its_identity_and_permissions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let environment = TestEnvironment::new("sidecar-identity", true);
        environment.seed_old_contents();
        fs::set_permissions(
            &environment.paths.sidecar,
            fs::Permissions::from_mode(0o640),
        )
        .unwrap();
        let metadata_before = fs::metadata(&environment.paths.sidecar).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
        )
        .unwrap();

        let metadata_after = fs::metadata(&environment.paths.sidecar).unwrap();
        assert_eq!(metadata_after.ino(), metadata_before.ino());
        assert_eq!(
            metadata_after.permissions().mode() & 0o777,
            metadata_before.permissions().mode() & 0o777
        );
    }

    #[cfg(unix)]
    #[test]
    fn journaled_sidecar_write_replaces_symlink_without_touching_its_referent() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("journal-sidecar-symlink", true);
        environment.seed_old_contents();
        let referent = environment.root.join("unrelated.json");
        fs::write(&referent, "unrelated contents").unwrap();
        fs::remove_file(&environment.paths.sidecar).unwrap();
        symlink(&referent, &environment.paths.sidecar).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        let manifest = read_manifest(&environment.manifest_path()).unwrap();
        assert_eq!(manifest.before.sidecar.contents.as_deref(), Some(""));
        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());

        let document_id = environment.paths.document.to_string_lossy().to_string();
        assert_eq!(fs::read_to_string(&referent).unwrap(), "unrelated contents");
        assert_eq!(
            fs::read_to_string(&environment.paths.sidecar).unwrap(),
            valid_notes_payload(&document_id, "new note")
        );
        assert!(!fs::symlink_metadata(&environment.paths.sidecar)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn journaled_empty_sidecar_removes_symlink_without_touching_its_referent() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("journal-empty-sidecar-symlink", true);
        environment.seed_old_contents();
        let referent = environment.root.join("unrelated-empty.json");
        fs::write(&referent, "unrelated contents").unwrap();
        fs::remove_file(&environment.paths.sidecar).unwrap();
        symlink(&referent, &environment.paths.sidecar).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        let manifest = read_manifest(&environment.manifest_path()).unwrap();
        assert_eq!(manifest.before.sidecar.contents.as_deref(), Some(""));
        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());

        assert_eq!(fs::read_to_string(&referent).unwrap(), "unrelated contents");
        assert!(fs::symlink_metadata(&environment.paths.sidecar).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn journal_never_reads_private_notes_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("journal-private-notes-symlink", true);
        environment.seed_old_contents();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let referent = environment.root.join("unrelated-private-notes.json");
        let referent_contents = valid_notes_payload(&document_id, "unrelated note");
        fs::write(&referent, &referent_contents).unwrap();
        fs::remove_file(&environment.paths.notes).unwrap();
        symlink(&referent, &environment.paths.notes).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        let manifest = read_manifest(&environment.manifest_path()).unwrap();
        assert_eq!(manifest.before.notes.contents.as_deref(), Some(""));
        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());

        assert_eq!(fs::read_to_string(&referent).unwrap(), referent_contents);
        assert_eq!(
            fs::read_to_string(&environment.paths.notes).unwrap(),
            valid_notes_payload(&document_id, "new note")
        );
        assert!(!fs::symlink_metadata(&environment.paths.notes)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn journaled_empty_private_notes_remove_symlink_without_touching_its_referent() {
        use std::os::unix::fs::symlink;

        let environment = TestEnvironment::new("journal-empty-private-notes-symlink", false);
        environment.seed_old_contents();
        let document_id = environment.paths.document.to_string_lossy().to_string();
        let referent = environment.root.join("unrelated-empty-private-notes.json");
        let referent_contents = valid_notes_payload(&document_id, "unrelated note");
        fs::write(&referent, &referent_contents).unwrap();
        fs::remove_file(&environment.paths.notes).unwrap();
        symlink(&referent, &environment.paths.notes).unwrap();
        let guard = lock_local_documents(&environment.recovery).unwrap();

        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", None),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();

        let manifest = read_manifest(&environment.manifest_path()).unwrap();
        assert_eq!(manifest.before.notes.contents.as_deref(), Some(""));
        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());

        assert_eq!(fs::read_to_string(&referent).unwrap(), referent_contents);
        assert!(fs::symlink_metadata(&environment.paths.notes).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_does_not_rewrite_surfaces_already_at_after() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let environment = TestEnvironment::new("skip-after", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Verification),
        )
        .unwrap_err();
        let notes_inode = fs::metadata(&environment.paths.notes).unwrap().ino();
        fs::set_permissions(
            &environment.paths.document,
            fs::Permissions::from_mode(0o400),
        )
        .unwrap();
        fs::set_permissions(
            &environment.paths.sidecar,
            fs::Permissions::from_mode(0o400),
        )
        .unwrap();

        assert!(recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap());
        assert_eq!(
            fs::metadata(&environment.paths.notes).unwrap().ino(),
            notes_inode
        );
    }

    #[test]
    fn pending_directory_operation_recovers_or_blocks_before_mutation() {
        let environment = TestEnvironment::new("destructive-block", true);
        environment.seed_old_contents();
        let guard = lock_local_documents(&environment.recovery).unwrap();
        save_local_document_with_failpoint(
            &guard,
            &environment.recovery,
            environment.paths.clone(),
            payload(&environment, "new body", Some("new note")),
            Some(SaveStage::Manifest),
        )
        .unwrap_err();
        fs::write(&environment.paths.document, "external").unwrap();

        let pending = pending_document_paths(&guard, &environment.recovery).unwrap();
        assert_eq!(pending, vec![environment.paths.document.clone()]);
        assert_eq!(
            recover_local_document(&guard, &environment.recovery, &environment.paths).unwrap_err(),
            RECOVERY_CONFLICT_ERROR
        );
        assert!(environment.paths.document.exists());
        assert!(environment.paths.document.parent().unwrap().exists());
    }

    #[test]
    fn global_lock_serializes_threads_without_timing_assumptions() {
        let environment = TestEnvironment::new("global-lock", false);
        let first_guard = lock_local_documents(&environment.recovery).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let (attempting_sender, attempting_receiver) = mpsc::channel();
        let (acquired_sender, acquired_receiver) = mpsc::channel();
        let thread_barrier = Arc::clone(&barrier);
        let thread_recovery = environment.recovery.clone();
        let thread = std::thread::spawn(move || {
            thread_barrier.wait();
            attempting_sender.send(()).unwrap();
            let _second_guard = lock_local_documents(&thread_recovery).unwrap();
            acquired_sender.send(()).unwrap();
        });

        barrier.wait();
        attempting_receiver.recv().unwrap();
        assert!(matches!(
            acquired_receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        drop(first_guard);
        acquired_receiver.recv().unwrap();
        thread.join().unwrap();
    }

    #[test]
    fn store_lock_blocks_an_independent_file_handle() {
        let environment = TestEnvironment::new("store-lock", false);
        let _guard = lock_local_documents(&environment.recovery).unwrap();
        let competing_lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(environment.recovery.join(STORE_LOCK_FILE))
            .unwrap();

        assert!(matches!(
            competing_lock.try_lock(),
            Err(std::fs::TryLockError::WouldBlock)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn store_lock_rejects_symlink_without_touching_its_referent() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let environment = TestEnvironment::new("store-lock-symlink", false);
        fs::create_dir_all(&environment.recovery).unwrap();
        let referent = environment.root.join("unrelated-lock-file");
        fs::write(&referent, "unrelated contents").unwrap();
        fs::set_permissions(&referent, fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&referent, environment.recovery.join(STORE_LOCK_FILE)).unwrap();

        assert!(lock_local_documents(&environment.recovery).is_err());
        assert_eq!(fs::read_to_string(&referent).unwrap(), "unrelated contents");
        assert_eq!(
            fs::metadata(&referent).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovery_directory_rejects_symlink_components_without_touching_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let environment = TestEnvironment::new("recovery-directory-symlink", false);
        let app_data = environment.root.join("app-data");
        let external = environment.root.join("external-recovery");
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::set_permissions(&external, fs::Permissions::from_mode(0o755)).unwrap();
        symlink(&external, app_data.join("recovery")).unwrap();
        let requested_recovery = app_data.join("recovery/local");

        assert!(lock_local_documents(&requested_recovery).is_err());
        assert_eq!(
            fs::metadata(&external).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(!external.join("local").exists());
        assert!(!external.join(STORE_LOCK_FILE).exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_store_is_private_on_first_creation() {
        use std::os::unix::fs::PermissionsExt;

        let environment = TestEnvironment::new("private-recovery-store", false);
        let _guard = lock_local_documents(&environment.recovery).unwrap();

        assert_eq!(
            fs::metadata(&environment.recovery)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(environment.recovery.join(STORE_LOCK_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn store_lock_blocks_a_second_process() {
        let environment = TestEnvironment::new("store-lock-process", false);
        let _guard = lock_local_documents(&environment.recovery).unwrap();
        let marker_path = environment.root.join("store-lock-child-ran");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("local_save_recovery::tests::store_lock_child_probe")
            .env(
                STORE_LOCK_PROBE_PATH_ENV,
                environment.recovery.join(STORE_LOCK_FILE),
            )
            .env(STORE_LOCK_PROBE_MARKER_ENV, &marker_path)
            .status()
            .unwrap();

        assert!(status.success());
        assert!(marker_path.is_file());
    }

    #[test]
    fn store_lock_child_probe() {
        let Some(lock_path) = std::env::var_os(STORE_LOCK_PROBE_PATH_ENV) else {
            return;
        };
        let competing_lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(lock_path)
            .unwrap();
        assert!(matches!(
            competing_lock.try_lock(),
            Err(std::fs::TryLockError::WouldBlock)
        ));
        fs::write(
            std::env::var_os(STORE_LOCK_PROBE_MARKER_ENV).unwrap(),
            b"blocked",
        )
        .unwrap();
    }
}
