/**
 * Group node type (FR-8, FR-10, FR-11).
 *
 * Groups are tree nodes; children are layer ids and/or sub-group ids.
 * Composition isolates the children into a buffer that is then composited
 * with the group's own opacity + blend mode against the parent.
 */

import type { LayerId } from '../shared/ids';
import type { BlendMode } from './blend-modes';

/** Maximum group nesting depth (FR-11). */
export const MAX_GROUP_DEPTH = 5;

/**
 * Group tree node. Like layers, groups are immutable: edits return new objects.
 */
export interface GroupNode {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly opacity: number;
  readonly visible: boolean;
  readonly blend_mode: BlendMode;
  /** UI-only: collapsed in the layer panel. Not load-bearing for rendering. */
  readonly collapsed: boolean;
  /** Optional parent group; absent = root. */
  readonly parent_group_id?: string;
  /** Ordered child layer ids (interleaved-by-position with child groups). */
  readonly child_layer_ids: ReadonlyArray<LayerId>;
  /** Ordered child group ids. */
  readonly child_group_ids: ReadonlyArray<string>;
}

/** Subset of fields accepted by `updateGroup`. */
export type GroupPatch = Partial<
  Pick<
    GroupNode,
    | 'name'
    | 'position'
    | 'opacity'
    | 'visible'
    | 'blend_mode'
    | 'collapsed'
    | 'parent_group_id'
  >
>;
