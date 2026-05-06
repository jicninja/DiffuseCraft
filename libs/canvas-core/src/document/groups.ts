/**
 * Group operations (B.3) — pure functions over the document model.
 *
 * Group structure: a flat array of `GroupNode`s, each with optional
 * `parent_group_id` and ordered child layer / group id lists. Layers
 * carry `group_id` membership for fast lookup. Operations keep both
 * sides in sync.
 *
 * Nesting depth is capped at `MAX_GROUP_DEPTH` (FR-11).
 */

import type { LayerId } from '../shared/ids';
import { ulid as makeUlid } from '../shared/ulid';
import type { BlendMode } from '../layers/blend-modes';
import type { GroupNode, GroupPatch } from '../layers/group';
import { MAX_GROUP_DEPTH } from '../layers/group';
import type { Document } from './document';

const nowIso = (now?: () => string): string => (now ? now() : new Date().toISOString());

const touch = (doc: Document, now: string): Document => ({ ...doc, modified_at: now });

/** Compute group depth by walking `parent_group_id` chain. Root depth = 0. */
export const groupDepth = (doc: Document, group_id: string): number => {
  let depth = 0;
  let cursor: string | undefined = group_id;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error(`groupDepth: cycle detected at ${cursor}.`);
    }
    seen.add(cursor);
    const node = doc.groups.find((g) => g.id === cursor);
    if (!node) break;
    cursor = node.parent_group_id;
    if (cursor) depth += 1;
  }
  return depth;
};

export interface CreateGroupInput {
  name?: string;
  member_layer_ids?: ReadonlyArray<LayerId>;
  parent_group_id?: string;
  position?: number;
  opacity?: number;
  visible?: boolean;
  blend_mode?: BlendMode;
  collapsed?: boolean;
  id?: string;
  now?: () => string;
}

export const createGroup = (
  doc: Document,
  input: CreateGroupInput,
): { doc: Document; group: GroupNode } => {
  // Validate parent existence + depth.
  if (input.parent_group_id) {
    const parent = doc.groups.find((g) => g.id === input.parent_group_id);
    if (!parent) {
      throw new Error(`createGroup: parent group ${input.parent_group_id} not found.`);
    }
    if (groupDepth(doc, parent.id) + 1 >= MAX_GROUP_DEPTH) {
      throw new Error(`createGroup: would exceed max nesting depth of ${MAX_GROUP_DEPTH}.`);
    }
  }
  // Validate member layers exist.
  const members = input.member_layer_ids ?? [];
  for (const id of members) {
    if (!doc.layers.some((l) => l.id === id)) {
      throw new Error(`createGroup: layer ${id} not found.`);
    }
  }
  const id = input.id ?? makeUlid();
  const created_at = nowIso(input.now);
  const group: GroupNode = {
    id,
    name: input.name ?? `Group ${doc.groups.length + 1}`,
    position: input.position ?? doc.groups.length,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    blend_mode: input.blend_mode ?? 'normal',
    collapsed: input.collapsed ?? false,
    parent_group_id: input.parent_group_id,
    child_layer_ids: [...members],
    child_group_ids: [],
  };
  // Update parent's child_group_ids if any.
  let groups = [...doc.groups, group];
  if (input.parent_group_id) {
    groups = groups.map((g) =>
      g.id === input.parent_group_id
        ? { ...g, child_group_ids: [...g.child_group_ids, id] }
        : g,
    );
  }
  // Set group_id on member layers.
  const layers = doc.layers.map((l) =>
    members.includes(l.id) ? { ...l, group_id: id } : l,
  );
  return { doc: touch({ ...doc, groups, layers }, created_at), group };
};

/** Apply a patch to a group's mutable fields. */
export const updateGroup = (
  doc: Document,
  group_id: string,
  patch: GroupPatch,
): { doc: Document } => {
  const target = doc.groups.find((g) => g.id === group_id);
  if (!target) return { doc };
  if (patch.parent_group_id) {
    if (patch.parent_group_id === group_id) {
      throw new Error('updateGroup: a group cannot be its own parent.');
    }
    const parent = doc.groups.find((g) => g.id === patch.parent_group_id);
    if (!parent) {
      throw new Error(`updateGroup: parent group ${patch.parent_group_id} not found.`);
    }
    if (groupDepth(doc, parent.id) + 1 >= MAX_GROUP_DEPTH) {
      throw new Error(`updateGroup: would exceed max nesting depth of ${MAX_GROUP_DEPTH}.`);
    }
  }
  const updated: GroupNode = { ...target, ...patch };
  return {
    doc: touch(
      { ...doc, groups: doc.groups.map((g) => (g.id === group_id ? updated : g)) },
      nowIso(),
    ),
  };
};

/**
 * Flatten a group's children to siblings of the group's old position, then
 * remove the group node.
 */
export const ungroup = (doc: Document, group_id: string): { doc: Document } => {
  const target = doc.groups.find((g) => g.id === group_id);
  if (!target) return { doc };
  // Layers in this group lose their `group_id`.
  const layers = doc.layers.map((l) =>
    target.child_layer_ids.includes(l.id) ? { ...l, group_id: undefined } : l,
  );
  // Sub-groups get re-parented to this group's parent (or root).
  const groups = doc.groups
    .filter((g) => g.id !== group_id)
    .map((g) =>
      target.child_group_ids.includes(g.id)
        ? { ...g, parent_group_id: target.parent_group_id }
        : g.id === target.parent_group_id
          ? {
              ...g,
              child_group_ids: [
                ...g.child_group_ids.filter((id) => id !== group_id),
                ...target.child_group_ids,
              ],
            }
          : g,
    );
  return { doc: touch({ ...doc, groups, layers }, nowIso()) };
};

/** Add the listed layers to the group, removing them from any prior group. */
export const moveLayersIntoGroup = (
  doc: Document,
  group_id: string,
  layer_ids: ReadonlyArray<LayerId>,
): { doc: Document } => {
  const target = doc.groups.find((g) => g.id === group_id);
  if (!target) return { doc };
  for (const id of layer_ids) {
    if (!doc.layers.some((l) => l.id === id)) {
      throw new Error(`moveLayersIntoGroup: layer ${id} not found.`);
    }
  }
  // Remove these ids from any other group's child list, then add to target.
  const groups = doc.groups.map((g) => {
    if (g.id === group_id) {
      const next = [
        ...g.child_layer_ids.filter((id) => !layer_ids.includes(id)),
        ...layer_ids,
      ];
      return { ...g, child_layer_ids: next };
    }
    if (g.child_layer_ids.some((id) => layer_ids.includes(id))) {
      return {
        ...g,
        child_layer_ids: g.child_layer_ids.filter((id) => !layer_ids.includes(id)),
      };
    }
    return g;
  });
  const layers = doc.layers.map((l) =>
    layer_ids.includes(l.id) ? { ...l, group_id } : l,
  );
  return { doc: touch({ ...doc, groups, layers }, nowIso()) };
};

/** Remove a single layer from its group while keeping the group itself. */
export const removeLayerFromGroup = (
  doc: Document,
  layer_id: LayerId,
): { doc: Document } => {
  const layer = doc.layers.find((l) => l.id === layer_id);
  if (!layer || !layer.group_id) return { doc };
  const owning = layer.group_id;
  const groups = doc.groups.map((g) =>
    g.id === owning
      ? { ...g, child_layer_ids: g.child_layer_ids.filter((id) => id !== layer_id) }
      : g,
  );
  const layers = doc.layers.map((l) =>
    l.id === layer_id ? { ...l, group_id: undefined } : l,
  );
  return { doc: touch({ ...doc, groups, layers }, nowIso()) };
};
