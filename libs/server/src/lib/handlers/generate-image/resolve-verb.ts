/**
 * Verb resolution for `generate_image` (generation-workflow A.1, FR-1, FR-2).
 *
 * Pure function that maps `(strength, selection, selection_mode)` onto one of
 * the four resolved verbs:
 *
 *   | strength | selection | selection_mode |  →  verb                  |
 *   |----------|-----------|----------------|----------------------------|
 *   |   100    |   none    |      —         |  `generate`                |
 *   |  <100    |   none    |      —         |  `refine`                  |
 *   |   100    |  present  |   required     |  `fill` (with sub_mode)    |
 *   |  <100    |  present  |  defaults Fill |  `constrained_variation`   |
 *
 * IF `strength === 100` AND `selection` is present AND `selection_mode` is
 * missing, the resolver throws `VerbResolutionError` with code `INVALID_INPUT`
 * and field path `selection_mode` (FR-2).
 *
 * The function does NO I/O and runs in <1 ms (NFR-1). It is exported so the
 * tablet UI can use it client-side to derive the action-button label
 * preview without a server round-trip.
 */

import { SELECTION_SUB_MODES, type SelectionSubMode } from '../../comfy/graph/fill-config.js';

export type ResolvedVerbName = 'generate' | 'refine' | 'fill' | 'constrained_variation';

/** Same shape as `mcp-tools` `Selection` — duplicated to keep this module schema-free. */
export type SelectionShape =
  | { kind: 'none' }
  | { kind: 'rect'; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'mask'; mask: unknown };

export interface ResolveVerbInput {
  strength: number;
  selection?: SelectionShape | undefined;
  selection_mode?: SelectionSubMode | undefined;
}

export interface ResolvedVerb {
  verb: ResolvedVerbName;
  /** Present iff the verb is `fill` or `constrained_variation`. */
  sub_mode?: SelectionSubMode;
}

/**
 * Error class thrown by `resolveVerb` for the FR-2 unwanted case. Surfaces
 * `INVALID_INPUT` to the catalog error contract; the handler maps it onto a
 * `ServerError` for transport encoding.
 */
export class VerbResolutionError extends Error {
  public readonly code = 'INVALID_INPUT' as const;
  public readonly field_path: string;
  public readonly hint: string;

  constructor(args: { field_path: string; message: string; hint: string }) {
    super(args.message);
    this.name = 'VerbResolutionError';
    this.field_path = args.field_path;
    this.hint = args.hint;
  }
}

const SELECTION_PRESENT = (s: SelectionShape | undefined): boolean =>
  s !== undefined && s.kind !== 'none';

/** Resolve the verb according to the FR-1 decision table. */
export function resolveVerb(input: ResolveVerbInput): ResolvedVerb {
  const hasSelection = SELECTION_PRESENT(input.selection);
  const fullStrength = input.strength === 100;

  if (!hasSelection && fullStrength) return { verb: 'generate' };
  if (!hasSelection && !fullStrength) return { verb: 'refine' };
  if (hasSelection && fullStrength) {
    if (!input.selection_mode) {
      throw new VerbResolutionError({
        field_path: 'selection_mode',
        message: 'selection_mode is required when strength=100 with a selection',
        hint: `Valid sub-modes: ${SELECTION_SUB_MODES.join(', ')}`,
      });
    }
    return { verb: 'fill', sub_mode: input.selection_mode };
  }
  // hasSelection && !fullStrength — strength<100 + selection.
  return {
    verb: 'constrained_variation',
    sub_mode: input.selection_mode ?? 'Fill',
  };
}
