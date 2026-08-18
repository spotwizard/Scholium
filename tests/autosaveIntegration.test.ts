import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function sourceBetween(startMarker: string, endMarker: string) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return app.slice(start, end);
}

assert.doesNotMatch(app, /autosaveRequestedWhileSavingRef/);
assert.doesNotMatch(app, /scheduleAutosaveForDirtyDocuments/);
assert.equal(
  app.match(/}, autosaveDelayMs\);/g)?.length,
  1,
  "the effect owns the only 500ms autosave scheduler",
);
assert.match(
  sourceBetween(
    "function flushDirtyDocumentsAfterCurrentEvent()",
    "function finishNoteEditorEditing(",
  ),
  /window\.setTimeout\([\s\S]*void saveDirtyDocuments\(\);[\s\S]*}, 0\);/,
);

const coordinatorSetup = sourceBetween(
  "const autosaveCoordinatorRef = useRef<",
  "const selectedDocumentIdRef = useRef(",
);
assert.match(coordinatorSetup, /createAutosaveCoordinator\(/);
assert.match(coordinatorSetup, /documentsRef\.current\s*\.filter\(/);
assert.match(
  coordinatorSetup,
  /hasDirtyState\(dirtyDocumentStatesRef\.current\[document\.id\]\)/,
);
assert.match(coordinatorSetup, /\.map\(\(document\) => document\.id\)/);
assert.match(
  coordinatorSetup,
  /documentsRef\.current\.find\(\(candidate\) => candidate\.id === documentId\)/,
);
assert.match(
  coordinatorSetup,
  /hasDirtyState\(dirtyDocumentStatesRef\.current\[documentId\]\)/,
);
assert.match(coordinatorSetup, /saveDocumentHandlerRef\.current\(document\)/);
assert.match(app, /saveDocumentHandlerRef\.current = saveDocument;/);

const translatedError = sourceBetween(
  "const translatedError =",
  "const mobileAnnotationKeyboardShouldStayClosed",
);
assert.match(app, /import \{ localRecoveryErrorTranslationKey \} from "\.\/localRecoveryError";/);
assert.match(
  translatedError,
  /return t\(localRecoveryErrorTranslationKey\(error\) \?\? key\);/,
);

const saveDirtyDocuments = sourceBetween(
  "async function saveDirtyDocuments()",
  "function defaultDuplicateFileName(",
);
assert.match(saveDirtyDocuments, /const wasSaving = autosaveCoordinator\.isSaving\(\);/);
assert.match(saveDirtyDocuments, /const saveRequest = autosaveCoordinator\.request\(\);/);
assert.match(saveDirtyDocuments, /if \(wasSaving\) \{[\s\S]*?await saveRequest;/);
assert.match(saveDirtyDocuments, /const failures = await saveRequest;/);
assert.match(saveDirtyDocuments, /unresolvedFailuresByDocumentId = new Map/);
assert.match(saveDirtyDocuments, /console\.error\(failure\.error\);/);
assert.match(
  saveDirtyDocuments,
  /hasDirtyState\(dirtyDocumentStatesRef\.current\[failure\.target\]\)/,
);
assert.match(
  saveDirtyDocuments,
  /unresolvedFailuresByDocumentId\.set\(failure\.target, failure\)/,
);
assert.match(saveDirtyDocuments, /externalFileChangedMessage/);
assert.match(saveDirtyDocuments, /externalFileFailure = unresolvedFailures\.find/);
assert.match(
  saveDirtyDocuments,
  /\.map\(\(\{ error \}\) => localRecoveryErrorTranslationKey\(error\)\)/,
);
assert.match(saveDirtyDocuments, /localRecoveryFailureKey[\s\S]*t\(localRecoveryFailureKey\)/);
assert.doesNotMatch(saveDirtyDocuments, /setStorageError\([^)]*failure\.error/);

function assertSaveSnapshotBeforeAwait(source: string, label: string) {
  const firstAwait = source.indexOf("await ");
  assert.ok(firstAwait >= 0, `${label} must perform an async save`);

  [
    "const bodyToSave",
    "const sourceNotes",
    "const sourceGlossaryTerms",
    "const sourceGlossaryBindings",
    "const notesToSave",
    "const glossaryBindingsToSave",
    "const glossaryTermsToSave",
    "const savedSidecarFingerprint",
  ].forEach((snapshotMarker) => {
    const snapshotIndex = source.indexOf(snapshotMarker);
    assert.ok(snapshotIndex >= 0, `${label} is missing ${snapshotMarker}`);
    assert.ok(snapshotIndex < firstAwait, `${label} must capture ${snapshotMarker} before awaiting`);
  });
}

const saveDocumentToDisk = sourceBetween(
  "async function saveDocumentToDisk(",
  "async function saveDocumentToDropbox(",
);
const saveDocumentToDropbox = sourceBetween(
  "async function saveDocumentToDropbox(",
  "async function saveDocument(",
);
assertSaveSnapshotBeforeAwait(saveDocumentToDisk, "local save");
assertSaveSnapshotBeforeAwait(saveDocumentToDropbox, "Dropbox save");
assert.match(
  saveDocumentToDisk,
  /saveMarkdownFile\(\{[\s\S]*body: bodyToSave,[\s\S]*notes: notesToSave,[\s\S]*glossaryTerms: glossaryTermsToSave,[\s\S]*glossaryBindings: glossaryBindingsToSave/,
);
assert.match(
  saveDocumentToDropbox,
  /saveDropboxMarkdownFile\(\{[\s\S]*body: bodyToSave,[\s\S]*notes: notesToSave,[\s\S]*glossaryTerms: glossaryTermsToSave,[\s\S]*glossaryBindings: glossaryBindingsToSave/,
);

[saveDocumentToDisk, saveDocumentToDropbox].forEach((saveSource) => {
  assert.match(saveSource, /const nextDocuments = documentsRef\.current\.map\(/);
  assert.match(
    saveSource,
    /const nextWorkspaceEntries = sortWorkspaceEntriesForDirectory\([\s\S]*workspaceEntriesRef\.current\.map\(/,
  );
  assert.ok(
    saveSource.indexOf("documentsRef.current = nextDocuments") <
      saveSource.indexOf("setDocuments(nextDocuments)"),
    "saved metadata must reach the document ref before React state",
  );
  assert.ok(
    saveSource.indexOf("workspaceEntriesRef.current = nextWorkspaceEntries") <
      saveSource.indexOf("setWorkspaceEntries(nextWorkspaceEntries)"),
    "saved metadata must reach the workspace ref before React state",
  );

  const metadataUpdate = saveSource.slice(
    saveSource.indexOf("const nextDocuments"),
    saveSource.indexOf("markDocumentSnapshotSaved"),
  );
  assert.doesNotMatch(
    metadataUpdate,
    /body: bodyToSave/,
    "metadata reconciliation must preserve the latest body from documentsRef",
  );
});
assert.match(saveDocumentToDropbox, /dropboxRev: saved\.rev \?\? null/);

const markDocumentSnapshotSaved = sourceBetween(
  "function markDocumentSnapshotSaved(",
  "async function saveDocumentToDisk(",
);
assert.match(markDocumentSnapshotSaved, /reconcileDirtyAfterSavedSnapshot\(/);
assert.ok(
  markDocumentSnapshotSaved.indexOf("savedDocumentBodiesRef.current = nextSavedBodies") <
    markDocumentSnapshotSaved.indexOf("setSavedDocumentBodies(nextSavedBodies)"),
  "the saved-body ref must update before React state",
);

const updateSelectedDocumentBody = sourceBetween(
  "function updateSelectedDocumentBody(",
  "function selectDocument(",
);
assert.match(
  updateSelectedDocumentBody,
  /const savedBody = savedDocumentBodiesRef\.current\[documentId\]/,
);
[
  ["documentsRef.current = nextDocuments", "setDocuments(nextDocuments)"],
  ["notesRef.current = nextNotes", "setNotes(nextNotes)"],
  ["glossaryBindingsRef.current = nextGlossaryBindings", "setGlossaryBindings(nextGlossaryBindings)"],
].forEach(([refUpdate, stateUpdate]) => {
  assert.ok(updateSelectedDocumentBody.indexOf(refUpdate) >= 0, `missing ${refUpdate}`);
  assert.ok(updateSelectedDocumentBody.indexOf(stateUpdate) >= 0, `missing ${stateUpdate}`);
  assert.ok(
    updateSelectedDocumentBody.indexOf(refUpdate) < updateSelectedDocumentBody.indexOf(stateUpdate),
    `${refUpdate} must happen before ${stateUpdate}`,
  );
});

console.log("autosave App integration contract: PASS");
