export const noteEditorHistoryGroupDelayMs = 500;

export type NoteEditorHistorySnapshot = {
  caretSourcePosition: number;
  value: string;
};

type NoteEditorInputGroup = {
  caretSourcePosition: number;
  lastChangeAt: number;
};

export type NoteEditorHistory = {
  inputGroup: NoteEditorInputGroup | null;
  redoStack: NoteEditorHistorySnapshot[];
  undoStack: NoteEditorHistorySnapshot[];
};

type NoteEditorTextChange = {
  from: number;
  nextTo: number;
  previousTo: number;
};

export function createNoteEditorHistory(): NoteEditorHistory {
  return { inputGroup: null, redoStack: [], undoStack: [] };
}

export function noteEditorTextChange(
  previousValue: string,
  nextValue: string,
): NoteEditorTextChange {
  let from = 0;
  const sharedLength = Math.min(previousValue.length, nextValue.length);
  while (from < sharedLength && previousValue[from] === nextValue[from]) {
    from += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousValue.length - from &&
    suffixLength < nextValue.length - from &&
    previousValue[previousValue.length - suffixLength - 1] ===
      nextValue[nextValue.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    from,
    nextTo: nextValue.length - suffixLength,
    previousTo: previousValue.length - suffixLength,
  };
}

export function recordNoteEditorChange(
  history: NoteEditorHistory,
  previousValue: string,
  nextValue: string,
  options: { input?: boolean; timestamp?: number } = {},
): NoteEditorHistory {
  if (previousValue === nextValue) return history;

  const change = noteEditorTextChange(previousValue, nextValue);
  const timestamp = options.timestamp ?? Date.now();
  const joinsInputGroup = Boolean(
    options.input &&
      history.inputGroup &&
      timestamp - history.inputGroup.lastChangeAt <= noteEditorHistoryGroupDelayMs &&
      (change.from === history.inputGroup.caretSourcePosition ||
        change.previousTo === history.inputGroup.caretSourcePosition),
  );
  const undoStack = joinsInputGroup
    ? history.undoStack
    : [
        ...history.undoStack,
        { caretSourcePosition: change.previousTo, value: previousValue },
      ].slice(-100);

  return {
    inputGroup: options.input
      ? { caretSourcePosition: change.nextTo, lastChangeAt: timestamp }
      : null,
    redoStack: [],
    undoStack,
  };
}

export function takeNoteEditorUndo(history: NoteEditorHistory, currentValue: string) {
  const snapshot = history.undoStack[history.undoStack.length - 1] ?? null;
  const redoSnapshot = snapshot
    ? {
        caretSourcePosition: noteEditorTextChange(snapshot.value, currentValue).nextTo,
        value: currentValue,
      }
    : null;

  return {
    history: {
      inputGroup: null,
      redoStack: redoSnapshot
        ? [...history.redoStack, redoSnapshot].slice(-100)
        : history.redoStack,
      undoStack: snapshot ? history.undoStack.slice(0, -1) : history.undoStack,
    },
    snapshot,
  };
}

export function takeNoteEditorRedo(history: NoteEditorHistory, currentValue: string) {
  const snapshot = history.redoStack[history.redoStack.length - 1] ?? null;
  const undoSnapshot = snapshot
    ? {
        caretSourcePosition: noteEditorTextChange(currentValue, snapshot.value).previousTo,
        value: currentValue,
      }
    : null;

  return {
    history: {
      inputGroup: null,
      redoStack: snapshot ? history.redoStack.slice(0, -1) : history.redoStack,
      undoStack: undoSnapshot
        ? [...history.undoStack, undoSnapshot].slice(-100)
        : history.undoStack,
    },
    snapshot,
  };
}
