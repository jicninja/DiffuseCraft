/**
 * Convert between server-persisted selection envelopes and the
 * canvas-core `Selection` union used by the geometry helpers.
 *
 * The persisted shape uses `kind: "polygon"` (per the spec); canvas-core
 * keeps the historical `kind: "lasso"` to avoid breaking the canvas-skia
 * renderer. The two are point-set-identical; conversion is mechanical.
 */

import type { Selection as CoreSelection } from '@diffusecraft/canvas-core';
import type { LayerId } from '@diffusecraft/mcp-tools';
import type { PersistedSelection } from './store.js';

/**
 * Convert a {@link PersistedSelection} to a canvas-core {@link CoreSelection}.
 * Mask references stay symbolic — the caller resolves them via a
 * `resolveMask(layerId)` callback when invoking ops.
 */
export const persistedToCore = (sel: PersistedSelection): CoreSelection => {
  switch (sel.kind) {
    case 'none':
      return { kind: 'none' };
    case 'rect':
      return { kind: 'rect', rect: sel.rect };
    case 'polygon':
      return { kind: 'lasso', points: sel.points };
    case 'mask':
      return {
        kind: 'mask',
        // Mask selections in canvas-core reference a layer id; we
        // borrow the field to carry the blob id verbatim. The
        // resolveMask callback the handler passes to selectionToMask
        // is the one that knows how to translate it.
        layer_id: sel.blob_id as unknown as LayerId,
      };
    default: {
      const _exhaustive: never = sel;
      void _exhaustive;
      return { kind: 'none' };
    }
  }
};
