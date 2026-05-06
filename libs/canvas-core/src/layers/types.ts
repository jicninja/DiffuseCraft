/**
 * Layer type definitions (FR-5, FR-6).
 *
 * Four layer kinds: paint (raster RGBA), mask (alpha-only), control
 * (AI guidance — Reference / Style / Composition / etc.), region
 * (per-area conditioning referencing a paint layer).
 *
 * Layers carry only metadata + a server-side `content_blob_id`. Pixel
 * bytes never live here. Engines and adapters resolve the blob id to
 * actual data outside the document model.
 */

import type { LayerId, DocumentId } from '../shared/ids';
import type { BlendMode } from './blend-modes';

export type LayerKind = 'paint' | 'mask' | 'control' | 'region';

/**
 * Control-layer subtype. Names mirror krita-ai-diffusion's terminology so
 * agents and humans share a vocabulary. The full list is owned by
 * `control-layers` spec; this enum is the v1 minimum needed for the model.
 */
export type ControlType =
  | 'reference'
  | 'style'
  | 'composition'
  | 'face'
  | 'scribble'
  | 'line_art'
  | 'soft_edge'
  | 'canny'
  | 'depth'
  | 'normal'
  | 'pose'
  | 'segmentation';

/** Optional clip mask: this layer is clipped by `source_layer_id`'s alpha. */
export interface ClipMaskRef {
  readonly source_layer_id: LayerId;
}

/**
 * Region-data tied to a paint layer (FR-5 region row).
 * The paint layer's opacity defines the region's area; the prompt is the
 * per-region addition concatenated with the document root prompt.
 */
export interface RegionData {
  readonly paint_layer_id: LayerId;
  readonly prompt: string;
}

/**
 * Sub-discriminator for `kind: 'mask'` layers, owned by the `mask-system`
 * spec. Painted masks carry alpha bytes in `content_blob_id`; `from_layer`
 * masks reference another layer's alpha or luminance channel.
 *
 * Kept as a structural metadata field (rather than a discriminated layer
 * type) so that `Layer` remains a single shape and the mask spec layers on
 * top of `canvas-fundamentals` non-destructively.
 */
export type MaskData =
  | { readonly subkind: 'painted' }
  | {
      readonly subkind: 'from_layer';
      readonly source_layer_id: LayerId;
      readonly channel: 'alpha' | 'luminance';
      readonly invert: boolean;
    };

/**
 * Single layer record — invariant under value semantics. Pure operations
 * return a new object on edit; never mutate in place.
 */
export interface Layer {
  readonly id: LayerId;
  readonly document_id: DocumentId;
  readonly kind: LayerKind;
  readonly name: string;
  /** Stacking position (0 = bottom). Continuous integer, no fractions. */
  readonly position: number;
  /** 0..1 inclusive. */
  readonly opacity: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly blend_mode: BlendMode;
  readonly clip_mask?: ClipMaskRef;
  /** Group membership; `null` / undefined = at document root. */
  readonly group_id?: string;
  /** Reference to the server-side content blob (paint/mask/control). */
  readonly content_blob_id?: string;
  /** Set when `kind === 'control'`. */
  readonly control_type?: ControlType;
  /** Set when `kind === 'region'`. */
  readonly region_data?: RegionData;
  /** Set when `kind === 'mask'`. Owned by `mask-system` spec. */
  readonly mask_data?: MaskData;
  readonly created_at: string;
}

/**
 * Subset of `Layer` accepted by `updateLayer` patches. `id`, `document_id`,
 * `kind`, and `created_at` are immutable post-creation.
 */
export type LayerPatch = Partial<
  Pick<
    Layer,
    | 'name'
    | 'position'
    | 'opacity'
    | 'visible'
    | 'locked'
    | 'blend_mode'
    | 'clip_mask'
    | 'group_id'
    | 'content_blob_id'
    | 'control_type'
    | 'region_data'
    | 'mask_data'
  >
>;
