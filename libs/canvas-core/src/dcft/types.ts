/**
 * `.dcft v1` portable file format — Zod schemas.
 *
 * These schemas are the single source of truth for the on-disk shape of a
 * DiffuseCraft project archive (`.dcft`), imported and exported by both the
 * client and the server. They are intentionally **self-contained mirrors**
 * of the canvas-core `Layer` and `Document` interfaces — not `.extend`
 * derivations — so the persisted file format stays decoupled from internal
 * type evolution. When the in-memory `Layer` / `Document` shape changes in
 * a way that affects what is persisted, these schemas must be re-synced
 * manually and the format `version` bumped.
 *
 * Requirements: 2.3, 2.4, 2.6, 3.2, 3.10 (image-io spec).
 */

import { z } from 'zod';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;

/**
 * Mirrors `BLEND_MODES` in `../layers/blend-modes.ts` (FR-12). Kept in
 * lock-step manually; revalidate on FR-5 / FR-6 changes.
 */
const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color_dodge',
  'color_burn',
  'hard_light',
  'soft_light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear_burn',
  'linear_dodge',
  'linear_light',
  'pin_light',
]);

const ControlTypeSchema = z.enum([
  'reference',
  'style',
  'composition',
  'face',
  'scribble',
  'line_art',
  'soft_edge',
  'canny',
  'depth',
  'normal',
  'pose',
  'segmentation',
]);

export const DcftLayerEntrySchema = z.object({
  id: z.string().regex(ULID_REGEX),
  document_id: z.string().regex(ULID_REGEX),
  kind: z.enum(['paint', 'mask', 'control', 'region']),
  name: z.string(),
  position: z.number().int().nonnegative(),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  blend_mode: BlendModeSchema,
  clip_mask: z.object({ source_layer_id: z.string().regex(ULID_REGEX) }).optional(),
  group_id: z.string().optional(),
  control_type: ControlTypeSchema.optional(),
  region_data: z
    .object({
      paint_layer_id: z.string().regex(ULID_REGEX),
      prompt: z.string(),
    })
    .optional(),
  mask_data: z
    .union([
      z.object({ subkind: z.literal('painted') }),
      z.object({
        subkind: z.literal('from_layer'),
        source_layer_id: z.string().regex(ULID_REGEX),
        channel: z.enum(['alpha', 'luminance']),
        invert: z.boolean(),
      }),
    ])
    .optional(),
  created_at: z.string().datetime(),
  // `.dcft`-specific: replaces in-memory `content_blob_id`.
  raster_path: z.string().regex(/^layers\/[0-9A-HJKMNP-TV-Z]{26}\.png$/),
});

export const DcftDocumentJsonSchema = z.object({
  id: z.string().regex(ULID_REGEX),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  color_mode: z.literal('srgb'),
  layers: z.array(DcftLayerEntrySchema),
  // Persisted document fields used by the materializer.
  created_at: z.string().datetime(),
  modified_at: z.string().datetime(),
  // Note: `selection`, `active_layer_id`, `groups` are UI state and are
  // intentionally NOT persisted in v1 — the materialized doc starts with
  // a clean selection and no active layer; groups are deferred to a
  // future format bump.
});

export const DcftManifestSchema = z.object({
  version: z.literal(1),
  document_id: z.string().regex(ULID_REGEX),
  document_sha256: z.string().regex(SHA256_REGEX),
  layer_count: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  created_at: z.string().datetime(),
});

export type DcftManifest = z.infer<typeof DcftManifestSchema>;
export type DcftDocumentJson = z.infer<typeof DcftDocumentJsonSchema>;
export type DcftLayerEntry = z.infer<typeof DcftLayerEntrySchema>;
