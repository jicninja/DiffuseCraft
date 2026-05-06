/**
 * Public barrel for `undo-redo-system` (tasks A.3 + A.4).
 *
 * Re-exports the parametric {@link Command} / {@link CommandSpec} /
 * {@link buildCommand} (from `command.ts`), the stack types
 * ({@link ClientDocumentStack}, {@link CommandSummary},
 * {@link SnapshotEntry}, {@link DocumentId}), the concrete
 * {@link DocumentSnapshot} + {@link DocumentSnapshotProvider} +
 * {@link createSqliteSnapshotProvider} (from `snapshot.ts`), the
 * {@link UndoRedoManager} + its options/result types, and the legacy
 * {@link LegacyCommand} alias for ABI compatibility with the 12 existing
 * handler files that import `Command` from `./manager.js`.
 *
 * Note on {@link DocumentSnapshot}: `stack.ts` keeps its own
 * `DocumentSnapshot = unknown` opaque alias internally so the stack
 * stays decoupled from the SQLite layer. The barrel intentionally
 * shadows that alias with the concrete `DocumentSnapshot` shape from
 * `./snapshot.js` so downstream consumers (tests, server bootstrap,
 * Phase B's eviction policy) get a typed contract.
 *
 * Downstream code SHOULD prefer importing from this barrel
 * (`@diffusecraft/server/lib/undo-redo`) rather than the individual
 * files, with the lone exception of the legacy `import type { Command }
 * from '../undo-redo/manager.js'` line in handlers — that import path
 * is preserved verbatim until Phase F migrates handlers off the legacy
 * surface.
 */

export {
  buildCommand,
  type Command,
  type CommandSpec,
  type DocumentId,
} from './command.js';

export {
  ClientDocumentStack,
  type CommandSummary,
  type SnapshotEntry,
} from './stack.js';

export {
  createSqliteSnapshotProvider,
  type ControlLayerRow,
  type DocumentRow,
  type DocumentSnapshot,
  type DocumentSnapshotProvider,
  type LayerRow,
  type RegionRow,
  type SelectionRow,
} from './snapshot.js';

export {
  UndoRedoManager,
  type RedoResult,
  type TimerProvider,
  type UndoRedoOptions,
  type UndoResult,
  // Legacy `Command` alias under a non-conflicting name. The original
  // import path (`../undo-redo/manager.js`) still works for the 12
  // existing handlers because `manager.ts` exports the legacy
  // `Command` interface directly.
  type Command as LegacyCommand,
} from './manager.js';
