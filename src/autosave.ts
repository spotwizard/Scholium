export type DirtyDocumentState = {
  body: boolean;
  notes: boolean;
};

export type DirtyDocumentStates = Record<string, DirtyDocumentState>;

export type AutosaveFailure<Target> = {
  target: Target;
  error: unknown;
};

export function hasDirtyState(state: DirtyDocumentState | undefined) {
  return Boolean(state?.body || state?.notes);
}

export function patchDirtyDocumentStates(
  states: DirtyDocumentStates,
  documentId: string,
  patch: Partial<DirtyDocumentState>,
) {
  const currentState = states[documentId] ?? { body: false, notes: false };
  const nextState = {
    ...currentState,
    ...patch,
  };
  const nextStates = { ...states };

  if (hasDirtyState(nextState)) {
    nextStates[documentId] = nextState;
  } else {
    delete nextStates[documentId];
  }

  return nextStates;
}

export function sidecarFingerprint(
  notes: readonly unknown[],
  glossaryTerms: readonly unknown[],
  glossaryBindings: readonly unknown[],
) {
  return JSON.stringify({ notes, glossaryTerms, glossaryBindings });
}

export function reconcileDirtyAfterSavedSnapshot(
  states: DirtyDocumentStates,
  documentId: string,
  currentBody: string,
  savedBody: string,
  currentSidecarFingerprint: string,
  savedSidecarFingerprint: string,
) {
  return patchDirtyDocumentStates(states, documentId, {
    body: currentBody !== savedBody,
    notes: currentSidecarFingerprint !== savedSidecarFingerprint,
  });
}

export function createAutosaveCoordinator<Target>(
  getTargets: () => readonly Target[],
  saveTarget: (target: Target) => Promise<void>,
) {
  let inFlight: Promise<AutosaveFailure<Target>[]> | null = null;
  let followUpRequested = false;

  async function saveCurrentTargets(failures: AutosaveFailure<Target>[]) {
    for (const target of getTargets()) {
      try {
        await saveTarget(target);
      } catch (error) {
        failures.push({ target, error });
      }
    }
  }

  async function drain() {
    const failures: AutosaveFailure<Target>[] = [];

    try {
      await saveCurrentTargets(failures);
      while (followUpRequested) {
        followUpRequested = false;
        await saveCurrentTargets(failures);
      }

      return failures;
    } finally {
      inFlight = null;
    }
  }

  return {
    request() {
      if (inFlight) {
        followUpRequested = true;
        return inFlight;
      }

      followUpRequested = false;
      inFlight = drain();
      return inFlight;
    },
    isSaving() {
      return inFlight !== null;
    },
  };
}
