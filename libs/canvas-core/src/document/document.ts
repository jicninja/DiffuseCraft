/**
 * Document type + factory (FR-1, FR-3, FR-4).
 *
 * The document is the single root record for a canvas: dimensions,
 * ordered layer stack, group tree, selection, and timestamps. It is
 * immutable; pure operations in `./operations.ts` and `./groups.ts`
 * return new document values.
 */

import type { DocumentId, LayerId } from '../shared/ids';
import { ulid as makeUlid } from '../shared/ulid';
import type { Layer } from '../layers/types';
import type { GroupNode } from '../layers/group';
import type { Selection } from './selection';

export type ColorMode = 'srgb';

/**
 * Aspect-ratio presets accepted by `createDocument` (FR-4). Custom dims
 * must be multiples of 8 and ≤ 4096 — enforced by `assertCustomDims`.
 */
export const ASPECT_PRESETS = {
  square: { width: 1024, height: 1024 },
  portrait_2_3: { width: 1024, height: 1536 },
  landscape_3_2: { width: 1536, height: 1024 },
  mobile_portrait: { width: 1080, height: 1920 },
  mobile_landscape: { width: 1920, height: 1080 },
} as const;

export type AspectPreset = keyof typeof ASPECT_PRESETS;

/** Maximum custom canvas dimension (FR-4). */
export const MAX_CUSTOM_DIM = 4096;
/** Minimum custom canvas dimension. Multiples-of-8 enforces a floor of 8. */
export const MIN_CUSTOM_DIM = 8;

/** Throws if `width` or `height` are not valid custom dimensions. */
export const assertCustomDims = (width: number, height: number): void => {
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(value)) {
      throw new Error(`Document ${name} must be an integer; got ${value}.`);
    }
    if (value < MIN_CUSTOM_DIM || value > MAX_CUSTOM_DIM) {
      throw new Error(
        `Document ${name} must be between ${MIN_CUSTOM_DIM} and ${MAX_CUSTOM_DIM}; got ${value}.`,
      );
    }
    if (value % 8 !== 0) {
      throw new Error(`Document ${name} must be a multiple of 8; got ${value}.`);
    }
  }
};

/**
 * Document record. Single active document per session (FR-3).
 */
export interface Document {
  readonly id: DocumentId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly color_mode: ColorMode;
  /** Ordered by stacking position (index 0 = bottom). */
  readonly layers: ReadonlyArray<Layer>;
  /** Tree of group nodes; root groups have no `parent_group_id`. */
  readonly groups: ReadonlyArray<GroupNode>;
  readonly selection: Selection;
  readonly active_layer_id: LayerId | null;
  readonly created_at: string;
  readonly modified_at: string;
}

export interface CreateDocumentInput {
  /** Optional override; otherwise a fresh ULID is minted. */
  id?: DocumentId;
  name?: string;
  /** Either `preset` or both `width` + `height` must be supplied. */
  preset?: AspectPreset;
  width?: number;
  height?: number;
  /** `now` injection for deterministic tests. */
  now?: () => string;
}

/**
 * Build a fresh empty document. Per FR-4 dimensions come either from a
 * named preset or from custom values validated against the multiples-of-8
 * rule.
 *
 * @example
 * ```ts
 * const doc = createDocument({ preset: 'square' });
 * const custom = createDocument({ width: 2048, height: 1024 });
 * ```
 */
export const createDocument = (input: CreateDocumentInput): Document => {
  let width: number;
  let height: number;
  if (input.preset) {
    const preset = ASPECT_PRESETS[input.preset];
    width = preset.width;
    height = preset.height;
  } else if (typeof input.width === 'number' && typeof input.height === 'number') {
    assertCustomDims(input.width, input.height);
    width = input.width;
    height = input.height;
  } else {
    throw new Error("createDocument requires either 'preset' or 'width' + 'height'.");
  }
  const now = input.now ? input.now() : new Date().toISOString();
  return {
    id: (input.id ?? (makeUlid() as DocumentId)) as DocumentId,
    name: input.name ?? 'Untitled',
    width,
    height,
    color_mode: 'srgb',
    layers: [],
    groups: [],
    selection: { kind: 'none' },
    active_layer_id: null,
    created_at: now,
    modified_at: now,
  };
};

/** Resolve a layer by id, or return `undefined`. */
export const findLayer = (doc: Document, id: LayerId): Layer | undefined =>
  doc.layers.find((l) => l.id === id);

/** Resolve a group by id, or return `undefined`. */
export const findGroup = (doc: Document, id: string): GroupNode | undefined =>
  doc.groups.find((g) => g.id === id);
