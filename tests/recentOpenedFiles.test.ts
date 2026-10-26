import assert from "node:assert/strict";
import fs from "node:fs";
import {
  dropboxRecentPathIsMissing,
  lastOpenedFileAmong,
  lastOpenedFileInDirectory,
  parseRecentOpenedFiles,
  recentOpenedFilesAfterOpening,
  recentOpenedFilesLimit,
  recentOpenedFilesWithout,
} from "../src/recentOpenedFiles.ts";

assert.equal(
  dropboxRecentPathIsMissing('failed to open Dropbox file: Dropbox returned HTTP 409 Conflict: {"error_summary":"path/not_found/"}'),
  true,
);
assert.equal(dropboxRecentPathIsMissing("Dropbox returned HTTP 409: path/conflict"), false);
assert.equal(dropboxRecentPathIsMissing("Dropbox returned HTTP 401: path/not_found"), false);
assert.equal(dropboxRecentPathIsMissing("Dropbox connection timed out"), false);

assert.deepEqual(parseRecentOpenedFiles(null), []);
assert.deepEqual(parseRecentOpenedFiles("not json"), []);
assert.deepEqual(parseRecentOpenedFiles('{"source":"local"}'), []);
assert.deepEqual(
  parseRecentOpenedFiles(
    JSON.stringify([
      { source: "local", path: " /notes/a.md " },
      { source: "ftp", path: "/notes/b.md" },
      { source: "dropbox", path: "" },
      "oops",
    ]),
  ),
  [{ source: "local", path: "/notes/a.md" }],
);

let files = recentOpenedFilesAfterOpening([], "local", "/notes/a.md");
files = recentOpenedFilesAfterOpening(files, "local", "/notes/sub/b.md");
files = recentOpenedFilesAfterOpening(files, "local", "/elsewhere/c.md");
files = recentOpenedFilesAfterOpening(files, "dropbox", "/Notes/d.md");
assert.deepEqual(files, [
  { source: "dropbox", path: "/Notes/d.md" },
  { source: "local", path: "/elsewhere/c.md" },
  { source: "local", path: "/notes/sub/b.md" },
  { source: "local", path: "/notes/a.md" },
]);

assert.equal(
  lastOpenedFileInDirectory(files, "local", "/notes"),
  "/notes/sub/b.md",
  "a folder resolves to the latest file anywhere below it",
);
assert.equal(lastOpenedFileInDirectory(files, "local", "/notes/sub/"), "/notes/sub/b.md");
assert.equal(lastOpenedFileInDirectory(files, "local", "/not"), "", "a sibling prefix is not a parent");
assert.equal(lastOpenedFileInDirectory(files, "local", "/never-opened"), "");
assert.equal(lastOpenedFileInDirectory(files, "dropbox", "/notes"), "/Notes/d.md");
assert.equal(lastOpenedFileInDirectory(files, "dropbox", ""), "/Notes/d.md");
assert.equal(lastOpenedFileInDirectory(files, "local", "/elsewhere/c.md"), "");

files = recentOpenedFilesAfterOpening(files, "local", "/notes/a.md");
assert.equal(
  lastOpenedFileInDirectory(files, "local", "/notes"),
  "/notes/a.md",
  "reopening a file makes it the folder's latest file again",
);
assert.equal(files.filter((file) => file.path === "/notes/a.md").length, 1);

files = recentOpenedFilesWithout(files, "local", "/notes/a.md");
assert.equal(lastOpenedFileInDirectory(files, "local", "/notes"), "/notes/sub/b.md");

assert.equal(
  lastOpenedFileAmong(files, "dropbox", ["/notes/x.md", "/notes/d.md"]),
  "/notes/d.md",
  "Dropbox paths match without regard to case and return the listed spelling",
);
assert.equal(lastOpenedFileAmong(files, "local", ["/notes/x.md"]), "");

let manyFiles = recentOpenedFilesAfterOpening([], "local", "/first.md");
for (let index = 0; index < recentOpenedFilesLimit + 5; index += 1) {
  manyFiles = recentOpenedFilesAfterOpening(manyFiles, "local", `/folder/${index}.md`);
}
assert.equal(manyFiles.length, recentOpenedFilesLimit);
assert.equal(lastOpenedFileInDirectory(manyFiles, "local", "/"), `/folder/${recentOpenedFilesLimit + 4}.md`);
assert.equal(manyFiles.some((file) => file.path === "/first.md"), false);

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function functionBody(name: string) {
  const body = app.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n  \\}\\n`))?.[0];
  assert.ok(body, `${name} should exist`);
  return body;
}

const openFileBody = functionBody("openMarkdownFilePath");
assert.match(
  openFileBody,
  /const openSelectionRevision = \+\+manualDocumentSelectionRevisionRef\.current;/,
  "opening a chosen file interrupts an unfinished restore of the last file",
);
assert.match(
  openFileBody,
  /applyOpenedDirectory\(directoryWithSelectedFile\(context\), context\.selectedFile\.path\);/,
  "a chosen file is shown itself, not the folder's last opened file",
);
assert.doesNotMatch(openFileBody, /readLastOpenedFileInDirectory/);

const openDirectoryBody = functionBody("openDirectoryPath");
assert.match(openDirectoryBody, /\+\+manualDocumentSelectionRevisionRef\.current/);
assert.match(
  openDirectoryBody,
  /const lastOpenedFilePath = readLastOpenedFileInDirectory\("local", path\);/,
  "an opened folder shows the file last opened in it",
);
assert.match(
  openDirectoryBody,
  /restoreLastOpenedMarkdownWorkspace\(\n\s*path,\n\s*lastOpenedFilePath,/,
);
assert.match(openDirectoryBody, /forgetRecentOpenedFile\("local", lastOpenedFilePath\);/);

const restoreWorkspaceBody = functionBody("restoreLastOpenedMarkdownWorkspace");
assert.match(
  restoreWorkspaceBody,
  /if \(restoreWasInterrupted\(\)\) return false;/,
  "a restore that finishes late never replaces a file opened in the meantime",
);

const draftRestoreBody = functionBody("restoreStoredDraftDocuments");
assert.match(
  draftRestoreBody,
  /!startupOpenRequestedRef\.current &&\n\s*manualDocumentSelectionRevisionRef\.current === restoreSelectionRevision/,
  "restored unnamed files do not cover a file opened at launch",
);

assert.match(
  app,
  /if \(openedFilePaths\.length > 0\) \{\n\s*startupOpenRequestedRef\.current = true;\n\s*openDroppedMarkdownPathsHandlerRef\.current\(openedFilePaths\);/,
  "a file opened at launch skips restoring the last opened file",
);
assert.match(
  app,
  /if \(!storedDraftsRestoredRef\.current\) startupOpenRequestedRef\.current = true;\n\s*openDroppedMarkdownPathsHandlerRef\.current\(event\.payload\);/,
);
assert.match(
  app,
  /rememberRecentOpenedFile\("dropbox", selectedDocument\.path\);\n\s*\} else if \(selectedDocument\.filePath\) \{\n\s*rememberRecentOpenedFile\("local", selectedDocument\.filePath\);/,
  "the shown file is remembered for its folders",
);
