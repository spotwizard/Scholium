import assert from "node:assert/strict";
import {
  ancestorDirectoryPathsForFile,
  dropboxDocumentId,
  dropboxDocumentIdPrefix,
  dropboxParentDirectoryPath,
  ensureMarkdownExtension,
  fileNameFromPath,
  filePathInDirectory,
  isDropboxDocumentId,
  localPathIsInsideDirectory,
  localPathsMatch,
  normalizeLocalPathForCompare,
  parentDirectoryPath,
  stripMarkdownExtension,
  workspacePathIsInsideDirectory,
} from "../src/workspacePaths.ts";

assert.equal(dropboxDocumentIdPrefix, "dropbox:");
assert.equal(dropboxDocumentId(""), "dropbox:/");
assert.equal(dropboxDocumentId("/notes/file.md"), "dropbox:/notes/file.md");
assert.equal(isDropboxDocumentId("dropbox:/notes/file.md"), true);
assert.equal(isDropboxDocumentId("/notes/file.md"), false);

assert.equal(ensureMarkdownExtension("notes/file"), "notes/file.md");
assert.equal(ensureMarkdownExtension("notes/file.MARKDOWN"), "notes/file.MARKDOWN");
assert.equal(stripMarkdownExtension("notes/file.md"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.markdown"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.mdown"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.MD"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.MARKDOWN"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.MDOWN"), "notes/file");
assert.equal(stripMarkdownExtension("notes/file.md.backup"), "notes/file.md.backup");

assert.equal(fileNameFromPath(null), "");
assert.equal(fileNameFromPath(""), "");
assert.equal(fileNameFromPath("/notes/file.md"), "file.md");
assert.equal(fileNameFromPath("C:\\notes\\file.md"), "file.md");
assert.equal(fileNameFromPath("C:\\notes/mixed.md"), "mixed.md");
assert.equal(fileNameFromPath("/notes/"), "notes");
assert.equal(fileNameFromPath(" /notes/file.md "), "file.md ");

assert.equal(filePathInDirectory(" /notes/ ", " file.md "), "/notes/file.md");
assert.equal(filePathInDirectory("C:\\notes\\", " file.md "), "C:\\notes\\file.md");
assert.equal(filePathInDirectory("/", "file.md"), "/file.md");

assert.equal(dropboxParentDirectoryPath("/"), "");
assert.equal(dropboxParentDirectoryPath("/notes/file.md"), "/notes");
assert.equal(dropboxParentDirectoryPath("/notes/drafts/file.md/"), "/notes/drafts");
assert.equal(parentDirectoryPath("/notes/file.md"), "/notes");
assert.equal(parentDirectoryPath("C:\\notes\\file.md"), "C:\\notes");

assert.equal(normalizeLocalPathForCompare(" C:\\Notes\\Drafts\\ "), "C:/Notes/Drafts");
assert.equal(localPathsMatch("C:\\Notes\\", "C:/Notes"), true);
assert.equal(localPathsMatch("C:/Notes", "c:/notes"), false);

assert.equal(localPathIsInsideDirectory("/notes", "/notes/"), true);
assert.equal(localPathIsInsideDirectory("/notes/drafts/file.md", "/notes"), true);
assert.equal(localPathIsInsideDirectory("/notes-archive/file.md", "/notes"), false);
assert.equal(localPathIsInsideDirectory("/Notes/file.md", "/notes"), false);

assert.equal(workspacePathIsInsideDirectory("/Notes", "/notes/", "dropbox"), true);
assert.equal(workspacePathIsInsideDirectory("/Notes/Drafts/file.md", "/notes", "dropbox"), true);
assert.equal(workspacePathIsInsideDirectory("/notes-archive/file.md", "/notes", "dropbox"), false);
assert.equal(workspacePathIsInsideDirectory("/Notes/file.md", "/notes", "local"), false);

assert.deepEqual(ancestorDirectoryPathsForFile("/notes", "/notes/a/b/file.md"), [
  "/notes/a",
  "/notes/a/b",
]);
assert.deepEqual(
  ancestorDirectoryPathsForFile("C:\\notes", "C:\\notes\\a\\b\\file.md"),
  ["C:/notes/a", "C:/notes/a/b"],
);
assert.deepEqual(ancestorDirectoryPathsForFile("/notes", "/notes/file.md"), []);
assert.deepEqual(ancestorDirectoryPathsForFile("/notes", "/other/file.md"), []);

console.log("workspace path regression: PASS");
