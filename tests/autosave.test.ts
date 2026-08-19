import assert from "node:assert/strict";
import {
  createAutosaveCoordinator,
  hasDirtyState,
  patchDirtyDocumentStates,
  reconcileDirtyAfterSavedSnapshot,
  sidecarFingerprint,
  type DirtyDocumentStates,
} from "../src/autosave.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

const cleanStates: DirtyDocumentStates = {};
const bodyDirtyStates = patchDirtyDocumentStates(cleanStates, "doc", { body: true });
assert.deepEqual(cleanStates, {}, "patches do not mutate the input");
assert.deepEqual(bodyDirtyStates, { doc: { body: true, notes: false } });
assert.equal(hasDirtyState(bodyDirtyStates.doc), true);

const bodyAndNotesDirtyStates = patchDirtyDocumentStates(bodyDirtyStates, "doc", {
  notes: true,
});
assert.deepEqual(bodyAndNotesDirtyStates, { doc: { body: true, notes: true } });
assert.deepEqual(patchDirtyDocumentStates(bodyAndNotesDirtyStates, "doc", { body: false }), {
  doc: { body: false, notes: true },
});
assert.deepEqual(
  patchDirtyDocumentStates(bodyAndNotesDirtyStates, "doc", { body: false, notes: false }),
  {},
);
assert.equal(hasDirtyState(undefined), false);

const savedFingerprint = sidecarFingerprint([{ id: "note" }], [{ id: "term" }], [
  { id: "binding" },
]);
assert.equal(
  savedFingerprint,
  '{"notes":[{"id":"note"}],"glossaryTerms":[{"id":"term"}],"glossaryBindings":[{"id":"binding"}]}',
);
assert.notEqual(sidecarFingerprint([{ id: "changed" }], [], []), savedFingerprint);

const bothDirty: DirtyDocumentStates = {
  doc: { body: true, notes: true },
  other: { body: false, notes: true },
};
assert.deepEqual(
  reconcileDirtyAfterSavedSnapshot(
    bothDirty,
    "doc",
    "saved body",
    "saved body",
    savedFingerprint,
    savedFingerprint,
  ),
  { other: { body: false, notes: true } },
);
assert.deepEqual(
  reconcileDirtyAfterSavedSnapshot(
    bothDirty,
    "doc",
    "new body",
    "saved body",
    savedFingerprint,
    savedFingerprint,
  ),
  { doc: { body: true, notes: false }, other: { body: false, notes: true } },
);
assert.deepEqual(
  reconcileDirtyAfterSavedSnapshot(
    bothDirty,
    "doc",
    "saved body",
    "saved body",
    "new sidecar",
    savedFingerprint,
  ),
  { doc: { body: false, notes: true }, other: { body: false, notes: true } },
);

const firstSave = deferred();
let coalescedSaveCount = 0;
let coalescedActiveCount = 0;
let coalescedMaxActiveCount = 0;
const coalescedCoordinator = createAutosaveCoordinator(
  () => ["doc"],
  async () => {
    coalescedSaveCount += 1;
    coalescedActiveCount += 1;
    coalescedMaxActiveCount = Math.max(coalescedMaxActiveCount, coalescedActiveCount);
    try {
      if (coalescedSaveCount === 1) await firstSave.promise;
    } finally {
      coalescedActiveCount -= 1;
    }
  },
);

const firstRequest = coalescedCoordinator.request();
const secondRequest = coalescedCoordinator.request();
const thirdRequest = coalescedCoordinator.request();
assert.strictEqual(secondRequest, firstRequest);
assert.strictEqual(thirdRequest, firstRequest);
assert.equal(coalescedCoordinator.isSaving(), true);
firstSave.resolve();
assert.deepEqual(await firstRequest, []);
assert.equal(coalescedSaveCount, 2, "concurrent requests add only one follow-up batch");
assert.equal(coalescedMaxActiveCount, 1, "save batches never overlap");
assert.equal(coalescedCoordinator.isSaving(), false);

const saveFailure = new Error("first failed");
const attemptedTargets: string[] = [];
let serialActiveCount = 0;
let serialMaxActiveCount = 0;
const failureCoordinator = createAutosaveCoordinator(
  () => ["first", "second", "third"],
  async (target) => {
    serialActiveCount += 1;
    serialMaxActiveCount = Math.max(serialMaxActiveCount, serialActiveCount);
    attemptedTargets.push(target);
    await Promise.resolve();
    serialActiveCount -= 1;
    if (target === "second") throw saveFailure;
  },
);

assert.deepEqual(await failureCoordinator.request(), [
  { target: "second", error: saveFailure },
]);
assert.deepEqual(attemptedTargets, ["first", "second", "third"]);
assert.equal(serialMaxActiveCount, 1, "targets save serially");

const firstOfTwoDocuments = deferred();
const currentBodies: Record<string, string> = {
  first: "first v1",
  second: "second v1",
};
const dirtyDocumentIds = new Set(["first", "second"]);
const savedDocumentSnapshots: string[] = [];
const latestSnapshotCoordinator = createAutosaveCoordinator(
  () => [...dirtyDocumentIds],
  async (documentId) => {
    const bodyToSave = currentBodies[documentId];
    savedDocumentSnapshots.push(`${documentId}:${bodyToSave}`);
    if (documentId === "first") await firstOfTwoDocuments.promise;
    if (currentBodies[documentId] === bodyToSave) dirtyDocumentIds.delete(documentId);
  },
);

const latestSnapshotRequest = latestSnapshotCoordinator.request();
assert.deepEqual(savedDocumentSnapshots, ["first:first v1"]);
currentBodies.second = "second v2";
firstOfTwoDocuments.resolve();
assert.deepEqual(await latestSnapshotRequest, []);
assert.deepEqual(
  savedDocumentSnapshots,
  ["first:first v1", "second:second v2"],
  "each queued document resolves its latest snapshot when its serial save begins",
);
assert.deepEqual([...dirtyDocumentIds], []);

let retryShouldFail = true;
let retryAttempts = 0;
const retryError = new Error("retry me");
const retryCoordinator = createAutosaveCoordinator(
  () => ["doc"],
  async () => {
    retryAttempts += 1;
    if (retryShouldFail) throw retryError;
  },
);

assert.deepEqual(await retryCoordinator.request(), [{ target: "doc", error: retryError }]);
assert.equal(retryCoordinator.isSaving(), false);
retryShouldFail = false;
assert.deepEqual(await retryCoordinator.request(), []);
assert.equal(retryAttempts, 2, "a failed target can be retried by the next request");

const transientFirstSave = deferred();
const transientError = new Error("transient");
let transientDirty = true;
let transientAttempts = 0;
const transientCoordinator = createAutosaveCoordinator(
  () => (transientDirty ? ["doc"] : []),
  async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) {
      await transientFirstSave.promise;
      throw transientError;
    }
    transientDirty = false;
  },
);

const transientRequest = transientCoordinator.request();
assert.strictEqual(
  transientCoordinator.request(),
  transientRequest,
  "a concurrent request schedules one follow-up on the shared drain",
);
transientFirstSave.resolve();
assert.deepEqual(await transientRequest, [{ target: "doc", error: transientError }]);
assert.equal(transientAttempts, 2);
assert.equal(transientDirty, false, "the follow-up can resolve a transient first-attempt failure");

let closingGapRequest: Promise<unknown> | null = null;
let closingGapSaveCount = 0;
const closingGapCoordinator = createAutosaveCoordinator(
  () => ["doc"],
  async () => {
    closingGapSaveCount += 1;
    if (closingGapSaveCount !== 1) return;

    queueMicrotask(() => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          closingGapRequest = closingGapCoordinator.request();
        });
      });
    });
  },
);

const closingGapInitialRequest = closingGapCoordinator.request();
await closingGapInitialRequest;
assert.ok(closingGapRequest);
await closingGapRequest;
assert.notStrictEqual(
  closingGapRequest,
  closingGapInitialRequest,
  "a request after the final follow-up check starts a new drain",
);
assert.equal(closingGapSaveCount, 2, "the closing-window request is not lost");

let currentBody = "version 1";
let raceDirtyStates: DirtyDocumentStates = { doc: { body: true, notes: false } };
const raceFirstSave = deferred();
const savedBodies: string[] = [];
const raceCoordinator = createAutosaveCoordinator(
  () => (hasDirtyState(raceDirtyStates.doc) ? ["doc"] : []),
  async () => {
    const bodyToSave = currentBody;
    savedBodies.push(bodyToSave);
    if (savedBodies.length === 1) await raceFirstSave.promise;
    raceDirtyStates = reconcileDirtyAfterSavedSnapshot(
      raceDirtyStates,
      "doc",
      currentBody,
      bodyToSave,
      "sidecar",
      "sidecar",
    );
  },
);

const raceRequest = raceCoordinator.request();
currentBody = "version 2";
raceDirtyStates = patchDirtyDocumentStates(raceDirtyStates, "doc", { body: true });
assert.strictEqual(raceCoordinator.request(), raceRequest);
raceFirstSave.resolve();
assert.deepEqual(await raceRequest, []);
assert.deepEqual(savedBodies, ["version 1", "version 2"]);
assert.deepEqual(raceDirtyStates, {});

let emptySaveCalls = 0;
const emptyCoordinator = createAutosaveCoordinator(
  () => [],
  async () => {
    emptySaveCalls += 1;
  },
);
assert.deepEqual(await emptyCoordinator.request(), []);
assert.equal(emptySaveCalls, 0);

console.log("autosave state and coordinator regression: PASS");
