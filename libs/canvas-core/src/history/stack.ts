/**
 * In-memory undo/redo history stack.
 *
 * **Preliminary** implementation — the durable, persistent undo system is
 * owned by the `undo-redo-system` spec. canvas-fundamentals only needs an
 * in-memory shape so layer/document operations can register reversible
 * Commands per FR-15.
 *
 * Invariants:
 *  - Stack is bounded (default 50 entries; oldest dropped on overflow).
 *  - `push` clears any redo history (linear, no branching).
 *  - `undo` returns the entry to apply for "go back"; the caller is
 *    responsible for actually mutating its document and re-pushing on a
 *    subsequent `redo`.
 */

/**
 * One reversible operation. Both directions carry a payload the caller can
 * use to produce the new document; canvas-core does not interpret payloads.
 */
export interface HistoryEntry<TPayload = unknown> {
  /** Stable id assigned by the caller (tool name + ULID, etc.). */
  readonly id: string;
  /** Human-readable label for the UI ("Add layer", "Move layer", ...). */
  readonly label: string;
  /** Forward operation payload. Caller decides shape. */
  readonly forward: TPayload;
  /** Inverse operation payload. */
  readonly inverse: TPayload;
  /** Timestamp the entry was pushed. */
  readonly created_at: string;
}

/** Default capacity matches the per-spec instructions (50 entries). */
export const DEFAULT_HISTORY_CAPACITY = 50;

export interface HistoryStackState<TPayload = unknown> {
  readonly entries: ReadonlyArray<HistoryEntry<TPayload>>;
  /** Index of the latest applied entry; -1 means "fully undone / empty". */
  readonly cursor: number;
  readonly capacity: number;
}

/** Build an empty stack with the given capacity. */
export const createHistoryStack = <TPayload = unknown>(
  capacity: number = DEFAULT_HISTORY_CAPACITY,
): HistoryStackState<TPayload> => ({
  entries: [],
  cursor: -1,
  capacity: Math.max(1, Math.floor(capacity)),
});

/**
 * Push a new entry. Discards any redo branch above `cursor` and trims the
 * oldest entry when capacity is exceeded.
 */
export const pushHistory = <TPayload>(
  state: HistoryStackState<TPayload>,
  entry: HistoryEntry<TPayload>,
): HistoryStackState<TPayload> => {
  const truncated = state.entries.slice(0, state.cursor + 1);
  const next = [...truncated, entry];
  const trimmed = next.length > state.capacity ? next.slice(next.length - state.capacity) : next;
  return {
    ...state,
    entries: trimmed,
    cursor: trimmed.length - 1,
  };
};

/** Returns the entry to apply for "undo" along with the new state. */
export const undoHistory = <TPayload>(
  state: HistoryStackState<TPayload>,
): { state: HistoryStackState<TPayload>; entry: HistoryEntry<TPayload> | null } => {
  if (state.cursor < 0) return { state, entry: null };
  const entry = state.entries[state.cursor]!;
  return {
    state: { ...state, cursor: state.cursor - 1 },
    entry,
  };
};

/** Returns the entry to apply for "redo" along with the new state. */
export const redoHistory = <TPayload>(
  state: HistoryStackState<TPayload>,
): { state: HistoryStackState<TPayload>; entry: HistoryEntry<TPayload> | null } => {
  if (state.cursor >= state.entries.length - 1) return { state, entry: null };
  const nextCursor = state.cursor + 1;
  return {
    state: { ...state, cursor: nextCursor },
    entry: state.entries[nextCursor]!,
  };
};

/** Drop everything; useful when a new document is loaded. */
export const clearHistory = <TPayload>(
  state: HistoryStackState<TPayload>,
): HistoryStackState<TPayload> => ({ ...state, entries: [], cursor: -1 });

/** True if `undo` would have an entry to return. */
export const canUndo = (state: HistoryStackState): boolean => state.cursor >= 0;

/** True if `redo` would have an entry to return. */
export const canRedo = (state: HistoryStackState): boolean =>
  state.cursor < state.entries.length - 1;
