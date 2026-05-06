/**
 * Mask layer subtypes (mask-system A.1, FR-1 / FR-15).
 *
 * Two mask kinds layered on top of `Layer` (kind: 'mask'):
 *
 *   - `painted`     — alpha bytes stored in `content_blob_id`. Brush-paint,
 *                     fill, erase, refine all act here.
 *   - `from_layer`  — derived live from another layer's `alpha` channel or
 *                     RGB `luminance`. Optionally inverted. Modifying the
 *                     source layer changes the derived mask automatically.
 *
 * The structural metadata lives on `Layer.mask_data` (declared in
 * `layers/types.ts`); this module re-exports the relevant types and
 * provides type guards that narrow `Layer` to the mask-specific shape.
 */
import type { Layer, MaskData } from '../layers/types';

/** Sub-discriminator for `kind: 'mask'` layers (FR-1). */
export type MaskSubKind = MaskData['subkind'];

/** Channel selector for `from_layer` masks (FR-15). */
export type FromLayerChannel = 'alpha' | 'luminance';

/** Re-export so callers can speak in mask-system vocabulary. */
export type { MaskData } from '../layers/types';

/**
 * `Layer` carries `mask_data` only when `kind === 'mask'`. Type-guarded
 * helpers below narrow to `MaskLayer` for typesafe access.
 */
export interface MaskLayer extends Layer {
  readonly kind: 'mask';
  readonly mask_data: MaskData;
}

/** Type guard: is this a mask layer with metadata? */
export const isMaskLayer = (layer: Layer): layer is MaskLayer =>
  layer.kind === 'mask' && layer.mask_data !== undefined;

/** Type guard: is this a `painted` mask? */
export const isPaintedMask = (
  layer: Layer,
): layer is MaskLayer & { readonly mask_data: { readonly subkind: 'painted' } } =>
  isMaskLayer(layer) && layer.mask_data.subkind === 'painted';

/** Type guard: is this a `from_layer` mask? */
export const isFromLayerMask = (
  layer: Layer,
): layer is MaskLayer & {
  readonly mask_data: Extract<MaskData, { subkind: 'from_layer' }>;
} => isMaskLayer(layer) && layer.mask_data.subkind === 'from_layer';
