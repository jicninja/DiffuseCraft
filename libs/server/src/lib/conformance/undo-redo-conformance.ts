/**
 * Undo/redo conformance check (undo-redo-system Phase F.9).
 *
 * Build-time invariant: every catalog tool flagged `reversible: true`
 * must have a registered handler that routes its mutation through
 * `ctx.undoRedo.execute(...)` (FR-34, design.md §11). Handlers that
 * still ride the legacy `ctx.scratch.command` bridge through
 * `reversibleCommandMw` are gated by an explicit allowlist below — each
 * entry tracked under its owning spec, scheduled for migration in a
 * later phase.
 *
 * **Detection.** v1 uses a source-level grep: at server start, after
 * every `dispatcher.register(...)` call has run, this module reads the
 * handler `.ts` files under `lib/handlers/` and looks for the literal
 * string `ctx.undoRedo.execute(`. A reversible tool whose handler file
 * does NOT contain that string AND is NOT on the legacy allowlist
 * fails conformance.
 *
 * **Why source-level.** Statically tagging handlers (e.g., a
 * `meta.usesUndoRedo = true` flag on registration) would also work but
 * adds a cross-cutting type/contract burden on every handler factory.
 * Source-level scan is zero-touch for handlers and matches the style
 * of `libs/mcp-tools/src/conformance/catalog-conformance.ts` (which
 * also performs targeted source/JSON inspection at boot).
 *
 * **Lives outside `__tests__/`** per the testing-steering exception
 * (mirrors `libs/mcp-tools/src/conformance/catalog-conformance.ts`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import type { ToolDefinition } from '../catalog/types.js';

/**
 * Tools whose handlers are still on the legacy `ctx.scratch.command`
 * bridge (`reversibleCommandMw` enrols their Command via
 * {@link UndoRedoManager.enrol}). Each entry is documented as "Phase F
 * partial migration; rest tracked in their owning specs". When a
 * handler is migrated, its tool name is removed here.
 */
export const KNOWN_LEGACY_PATHS: ReadonlySet<string> = new Set<string>([
  // Mask suite — owning spec: mask-system.
  'clear_mask',
  'fill_mask',
  'bake_mask',
  'selection_to_mask',
  'invert_mask',
  'mask_to_selection',
  'refine_mask',
  // Selection helpers — owning spec: selection-tools follow-up.
  'select_all',
  'invert_selection',
  'refine_selection',
]);

/**
 * Resolve a tool name like `paint_strokes` to the on-disk handler
 * filename (under `libs/server/src/lib/handlers/`). Convention: tool
 * name is snake_case; handler basename is kebab-case + `.ts`. Mask
 * tools live under `mask/`. Tools without a handler file resolve to
 * `null` (the catalog-conformance check is the gate for those — this
 * function only cares about reversible coverage of REGISTERED tools).
 */
function resolveHandlerPath(handlersDir: string, toolName: string): string | null {
  const basename = toolName.replace(/_/g, '-') + '.ts';
  const candidates: string[] = [
    path.join(handlersDir, basename),
    path.join(handlersDir, 'mask', basename),
    // `apply-history-item.ts`, `discard-history-item.ts`,
    // `get-history-item.ts` live at the top level — already covered by
    // the first candidate.
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Internal: cache of file → contents to avoid repeat reads on a hot start. */
const fileCache = new Map<string, string>();
function readSource(filePath: string): string {
  const cached = fileCache.get(filePath);
  if (cached !== undefined) return cached;
  const contents = fs.readFileSync(filePath, 'utf8');
  fileCache.set(filePath, contents);
  return contents;
}

export interface UndoRedoConformanceOptions {
  /**
   * Override for the handlers directory; defaults to a path computed
   * relative to this file at build/run time. Tests override this to
   * point at a fixture directory.
   */
  handlersDir?: string;
  /** Override for the legacy allowlist; defaults to {@link KNOWN_LEGACY_PATHS}. */
  legacyAllowlist?: ReadonlySet<string>;
}

const DEFAULT_HANDLERS_DIR = (() => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // `here` resolves to `lib/conformance` either in source (`src/`) or
  // bundled (`dist/`); the handlers directory is the sibling.
  return path.resolve(here, '..', 'handlers');
})();

/**
 * Throws if a reversible tool has neither (a) a handler that calls
 * `ctx.undoRedo.execute(`, NOR (b) an entry on the legacy allowlist.
 *
 * Pass the catalog manifest's tool list and the dispatcher's
 * registered-handler list. Tools that are reversible but UNREGISTERED
 * are skipped — those are the catalog-conformance check's domain
 * (`assertCatalogConformance`).
 */
export function assertUndoRedoConformance(
  catalog: ReadonlyArray<ToolDefinition>,
  registeredToolNames: ReadonlyArray<string>,
  opts: UndoRedoConformanceOptions = {},
): void {
  const handlersDir = opts.handlersDir ?? DEFAULT_HANDLERS_DIR;
  const allowlist = opts.legacyAllowlist ?? KNOWN_LEGACY_PATHS;
  const registeredSet = new Set(registeredToolNames);

  const violations: string[] = [];
  for (const tool of catalog) {
    if (!tool.reversible) continue;
    if (!registeredSet.has(tool.name)) continue; // Catalog-conformance owns this gap.
    if (allowlist.has(tool.name)) continue; // Tracked legacy path.

    const filePath = resolveHandlerPath(handlersDir, tool.name);
    if (!filePath) {
      violations.push(
        `${tool.name}: registered + reversible but no handler file found under ${handlersDir} (tried ${tool.name.replace(/_/g, '-')}.ts and mask/ subdir)`,
      );
      continue;
    }
    const source = readSource(filePath);
    if (!source.includes('ctx.undoRedo.execute(')) {
      violations.push(
        `${tool.name}: handler ${path.relative(handlersDir, filePath)} does not call ctx.undoRedo.execute(...) and is not on the legacy allowlist`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `UNDO_REDO_CONFORMANCE_VIOLATION:\n  - ${violations.join('\n  - ')}`,
    );
  }
}
