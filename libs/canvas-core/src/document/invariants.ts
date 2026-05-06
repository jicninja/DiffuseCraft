/**
 * Document invariants (B.6).
 *
 * Pure assertion helpers run after each operation in tests / dev builds.
 * Production callers can opt out by skipping the call. Returns a list of
 * violations; an empty list means the document is well-formed.
 */

import type { Document } from './document';
import { groupDepth } from './groups';
import { MAX_GROUP_DEPTH } from '../layers/group';

export type InvariantViolation = {
  readonly code: string;
  readonly message: string;
};

const issue = (code: string, message: string): InvariantViolation => ({ code, message });

/**
 * Run all document-level invariants and return any violations.
 *
 * Checks:
 *  - layer positions are unique non-negative integers (or compactable);
 *  - layer ids are unique;
 *  - group ids are unique;
 *  - every layer's `group_id` (if set) refers to an existing group;
 *  - every group's `child_layer_ids` refer to existing layers and match
 *    the layer's own `group_id`;
 *  - group nesting depth ≤ `MAX_GROUP_DEPTH`;
 *  - active_layer_id (if set) refers to an existing layer.
 */
export const checkInvariants = (doc: Document): ReadonlyArray<InvariantViolation> => {
  const violations: InvariantViolation[] = [];

  // Layer ids unique.
  const layerIds = new Set<string>();
  for (const l of doc.layers) {
    if (layerIds.has(l.id)) {
      violations.push(issue('DUPLICATE_LAYER_ID', `Duplicate layer id ${l.id}.`));
    }
    layerIds.add(l.id);
    if (!Number.isInteger(l.position) || l.position < 0) {
      violations.push(
        issue(
          'INVALID_LAYER_POSITION',
          `Layer ${l.id} has invalid position ${l.position}.`,
        ),
      );
    }
    if (l.opacity < 0 || l.opacity > 1) {
      violations.push(
        issue('INVALID_OPACITY', `Layer ${l.id} opacity ${l.opacity} not in [0,1].`),
      );
    }
  }

  // Position uniqueness.
  const seenPositions = new Set<number>();
  for (const l of doc.layers) {
    if (seenPositions.has(l.position)) {
      violations.push(
        issue(
          'DUPLICATE_LAYER_POSITION',
          `Two layers share position ${l.position}; tiebreaker by created_at applies.`,
        ),
      );
    }
    seenPositions.add(l.position);
  }

  // Group ids unique.
  const groupIds = new Set<string>();
  for (const g of doc.groups) {
    if (groupIds.has(g.id)) {
      violations.push(issue('DUPLICATE_GROUP_ID', `Duplicate group id ${g.id}.`));
    }
    groupIds.add(g.id);
  }

  // Layer.group_id refers to existing group.
  for (const l of doc.layers) {
    if (l.group_id !== undefined && !groupIds.has(l.group_id)) {
      violations.push(
        issue(
          'ORPHAN_LAYER_GROUP_REF',
          `Layer ${l.id} references unknown group ${l.group_id}.`,
        ),
      );
    }
  }

  // Group.child_layer_ids ↔ Layer.group_id consistency.
  for (const g of doc.groups) {
    for (const childId of g.child_layer_ids) {
      const layer = doc.layers.find((l) => l.id === childId);
      if (!layer) {
        violations.push(
          issue(
            'ORPHAN_GROUP_CHILD',
            `Group ${g.id} references missing layer ${childId}.`,
          ),
        );
      } else if (layer.group_id !== g.id) {
        violations.push(
          issue(
            'GROUP_MEMBERSHIP_MISMATCH',
            `Layer ${childId} listed as child of ${g.id} but layer.group_id=${
              layer.group_id ?? 'null'
            }.`,
          ),
        );
      }
    }
    if (g.parent_group_id !== undefined && !groupIds.has(g.parent_group_id)) {
      violations.push(
        issue(
          'ORPHAN_GROUP_PARENT',
          `Group ${g.id} references unknown parent ${g.parent_group_id}.`,
        ),
      );
    }
  }

  // Nesting depth.
  for (const g of doc.groups) {
    try {
      const depth = groupDepth(doc, g.id);
      if (depth >= MAX_GROUP_DEPTH) {
        violations.push(
          issue(
            'GROUP_NESTING_TOO_DEEP',
            `Group ${g.id} at depth ${depth} exceeds max ${MAX_GROUP_DEPTH}.`,
          ),
        );
      }
    } catch (err) {
      violations.push(
        issue('GROUP_CYCLE', `Cycle detected: ${(err as Error).message}.`),
      );
    }
  }

  // Active layer.
  if (doc.active_layer_id !== null && !layerIds.has(doc.active_layer_id)) {
    violations.push(
      issue(
        'ORPHAN_ACTIVE_LAYER',
        `active_layer_id ${doc.active_layer_id} not in layer set.`,
      ),
    );
  }

  return violations;
};

/** Throw if the document violates any invariant. */
export const assertInvariants = (doc: Document): void => {
  const violations = checkInvariants(doc);
  if (violations.length > 0) {
    throw new Error(
      `Document invariants violated:\n${violations
        .map((v) => `  - ${v.code}: ${v.message}`)
        .join('\n')}`,
    );
  }
};
