/**
 * `DocumentComposer` — client-side multi-layer flatten + encode.
 *
 * Walks the document's visible layers in stacking order, draws each one
 * onto a single composite `SkSurface` sized to canvas dimensions while
 * honoring `opacity` and `blend_mode`, and encodes the result to PNG or
 * JPEG bytes via `SkImage.encodeToBytes`.
 *
 * **Pure client-side** (R4.10): the composer never makes a network call.
 * Pixel data is read from the live `LayerSurfaceRegistry` (the same store
 * the visible canvas subscribes to), so the composite reflects exactly
 * what the user sees on the editor canvas at the moment of export.
 *
 * **Memory bound** (R9.4 risk note): peak handle count is the composite
 * surface plus at most one in-flight layer `SkImage` reference — the
 * registry owns the layer image's lifetime, so we do not dispose layer
 * images here; we only release our composite handles.
 *
 * **Cancellation** (R9.1, R9.3): the supplied `AbortSignal` is checked
 * before allocation, before each layer draw, and before encoding. On
 * cancellation we dispose any allocated composite surface / snapshot and
 * return `{ kind: 'cancelled' }` rather than throwing.
 *
 * **Web parity** (R9.1): on web, where canvaskit-wasm runs on the same
 * JS thread as the UI, we yield via `requestIdleCallback` between layer
 * draws so the canvas stays interactive during long composites. The
 * Skia API surface is identical on web and native, so this single file
 * targets both runtimes; no `.native.ts` / `.web.ts` split is needed.
 *
 * Spec: `.kiro/specs/image-io/design.md` § "canvas-skia / render /
 * DocumentComposer".
 * Requirements: 4.2, 4.3, 4.4, 4.10, 9.1, 9.4.
 */

import type { Document } from '@diffusecraft/canvas-core';
import {
  BlendMode,
  Skia,
  type SkImage,
  type SkSurface,
} from '@shopify/react-native-skia';
import { Platform } from 'react-native';

import { toSkBlendMode } from '../blend';
import type { LayerSurfaceRegistry } from '../brush/LayerSurfaceRegistry';
import type { Result } from './adapter';

/**
 * Output format selector for `composeDocumentToBytes`.
 *
 * `quality` only applies to JPEG and is clamped to `[50, 100]` inclusive
 * (R4.3 / R4.4). PNG ignores quality and always preserves alpha.
 */
export type ComposeFormat =
  | { kind: 'png' }
  | { kind: 'jpeg'; quality: number /* 50..100 inclusive */ };

/**
 * Per-layer progress callback. `fraction` is in `[0, 1]` and reaches 1.0
 * after the last layer is drawn (encoding is treated as a single tail
 * step that does not emit a separate progress tick).
 */
export type ComposeProgress = (fraction: number) => void;

/**
 * Discriminated error union for the composer. The UI matches on `kind`
 * to localize messages without parsing strings.
 *
 *  - `cancelled`     — caller's `AbortSignal` fired during composition.
 *  - `empty_document` — zero or non-positive canvas dims, or no layers.
 *  - `oom`           — `Skia.Surface.Make` returned null / threw; the
 *                      caller can fall back to a smaller canvas size.
 *  - `encode_failed` — `encodeToBytes` returned null / threw; `cause`
 *                      carries a short diagnostic string.
 */
export type ComposeError =
  | { kind: 'cancelled' }
  | { kind: 'empty_document' }
  | { kind: 'oom'; canvasMpx: number; layerCount: number }
  | { kind: 'encode_failed'; cause: string };

/**
 * Public service interface. See file header for the design context.
 *
 * Preconditions: every visible paint layer's bitmap is already present
 * in the `LayerSurfaceRegistry` (the registry is updated continuously
 * by the brush pipeline and the import-image command).
 *
 * Postconditions on `Ok`: the returned `Uint8Array` is encoded in the
 * chosen format, sRGB color space, dimensioned `(doc.width, doc.height)`.
 *
 * Invariants: never mutates document or layer state; never performs
 * network I/O.
 */
export interface DocumentComposer {
  composeDocumentToBytes(
    doc: Document,
    format: ComposeFormat,
    options?: { signal?: AbortSignal; onProgress?: ComposeProgress },
  ): Promise<Result<Uint8Array, ComposeError>>;
}

/**
 * Dependencies a real composer needs to resolve per-layer pixels. The
 * registry is the live source of truth for paint-layer bitmaps; passing
 * it in (rather than importing a singleton) keeps the composer testable
 * and avoids tying it to a specific `SkiaRenderAdapter` instance.
 */
export interface DocumentComposerDeps {
  readonly layerSurfaces: LayerSurfaceRegistry;
}

/**
 * Local handle to RN-Skia's `ImageFormat` enum value for PNG / JPEG.
 *
 * The local ambient d.ts in `src/types/skia.d.ts` is a structural subset
 * that does not declare `ImageFormat`. At runtime apps install the real
 * `@shopify/react-native-skia`, which exports the enum with `JPEG = 3`
 * and `PNG = 4`. We hard-code the integer values here so the file
 * typechecks in this workspace without modifying the shared ambient
 * stub. Apps that consume `canvas-skia` see the real package's types
 * (whose enum members carry the same numeric values), so the runtime
 * behavior matches.
 */
const ENCODE_FORMAT_PNG = 4 as const;
const ENCODE_FORMAT_JPEG = 3 as const;

/** JPEG quality clamp range (R4.3 acceptance criteria). */
const JPEG_QUALITY_MIN = 50;
const JPEG_QUALITY_MAX = 100;

/** Opaque white (RGBA = FF FF FF FF) for the JPEG flatten background. */
const OPAQUE_WHITE = 0xff_ff_ff_ff;

/** Cooperative dispose helper — RN-Skia handles expose `dispose()` but
 *  some test fixtures stub them. Optional-chain via a structural cast. */
const disposeIfPossible = (handle: unknown): void => {
  const d = handle as { dispose?: () => void } | null;
  d?.dispose?.();
};

/** True when running on web (canvaskit-wasm). The composer yields the
 *  JS thread between layer draws on web so the UI stays responsive. */
const isWeb = (): boolean => {
  if (Platform.OS === 'web') return true;
  // Belt-and-suspenders: some unit-test environments report `Platform.OS`
  // as 'web' but lack `requestIdleCallback`; some non-web environments
  // (jsdom shims) expose it. Yielding requires the function to actually
  // exist, so probe both.
  return typeof globalThis !== 'undefined'
    && typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback === 'function';
};

/** Yield to the UI thread between layer draws on web. Native runtimes
 *  resolve immediately because the work is off the JS thread already. */
const yieldToUi = (): Promise<void> => {
  if (!isWeb()) return Promise.resolve();
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => unknown })
    .requestIdleCallback;
  if (typeof ric !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => {
    ric(() => resolve());
  });
};

/** Map `format` → numeric `ImageFormat` enum + clamped quality. */
const resolveEncode = (
  format: ComposeFormat,
): { fmt: number; quality: number } => {
  if (format.kind === 'png') {
    return { fmt: ENCODE_FORMAT_PNG, quality: 100 };
  }
  const q = Number.isFinite(format.quality) ? format.quality : JPEG_QUALITY_MAX;
  const clamped = Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, q));
  return { fmt: ENCODE_FORMAT_JPEG, quality: clamped };
};

/**
 * Allocate the composite surface. Returns `null` on allocation failure —
 * caller maps this to `{ kind: 'oom' }`.
 *
 * Uses `Skia.Surface.Make` (CPU-backed raster) for the same reason the
 * `LayerSurfaceRegistry` does (see registry header): GPU-backed offscreen
 * surfaces had pixel-read races on iOS Simulator that produced empty
 * snapshots. CPU raster makes `makeImageSnapshot` synchronous w.r.t.
 * just-drawn pixels, which is exactly what the composer needs.
 */
const allocateCompositeSurface = (
  width: number,
  height: number,
): SkSurface | null => {
  // The local ambient stub for `Skia.Surface` only declares
  // `MakeOffscreen`; the real package also exposes `Make`. Use a narrow
  // cast so this file does not depend on the ambient stub being updated.
  const surfaceFactory = (Skia.Surface as unknown as {
    Make?: (w: number, h: number) => SkSurface | null;
    MakeOffscreen: (w: number, h: number) => SkSurface | null;
  });
  try {
    if (typeof surfaceFactory.Make === 'function') {
      return surfaceFactory.Make(width, height);
    }
    return surfaceFactory.MakeOffscreen(width, height);
  } catch {
    return null;
  }
};

/**
 * Real composer factory. Returns a `DocumentComposer` wired to the
 * supplied `LayerSurfaceRegistry`. Held by `client-sdk` once per editor
 * session.
 */
export const createDocumentComposer = (
  deps: DocumentComposerDeps,
): DocumentComposer => {
  const { layerSurfaces } = deps;

  return {
    async composeDocumentToBytes(doc, format, options) {
      const signal = options?.signal;
      const onProgress = options?.onProgress;

      // ---- 1. Validate inputs --------------------------------------------
      if (signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled' } };
      }
      if (
        doc.width <= 0
        || doc.height <= 0
        || doc.layers.length === 0
      ) {
        return { ok: false, error: { kind: 'empty_document' } };
      }

      // ---- 2. Filter visible layers in stacking order --------------------
      // `Document.layers` is documented as ordered by `position`, but we
      // re-sort defensively so a malformed document does not produce a
      // miscomposed export.
      const visibleLayers = doc.layers
        .filter((l) => l.visible)
        .slice()
        .sort((a, b) => a.position - b.position);
      if (visibleLayers.length === 0) {
        return { ok: false, error: { kind: 'empty_document' } };
      }

      const canvasMpx = (doc.width * doc.height) / 1_000_000;

      // ---- 3. Allocate the composite surface -----------------------------
      const composite = allocateCompositeSurface(doc.width, doc.height);
      if (composite === null) {
        return {
          ok: false,
          error: {
            kind: 'oom',
            canvasMpx,
            layerCount: visibleLayers.length,
          },
        };
      }

      // Helper: ensure the composite is released on every exit path that
      // does not return its bytes. We call this from each branch below;
      // the success path disposes after encoding.
      const releaseComposite = (snapshot: SkImage | null): void => {
        if (snapshot !== null) disposeIfPossible(snapshot);
        disposeIfPossible(composite);
      };

      // ---- 4. JPEG: pre-fill opaque white background (R4.4) --------------
      if (format.kind === 'jpeg') {
        const canvas = composite.getCanvas();
        const fill = Skia.Paint();
        fill.setColor(OPAQUE_WHITE);
        // `BlendMode.Src` overwrites whatever pixels exist with the paint
        // color — equivalent to clearing to opaque white.
        fill.setBlendMode(BlendMode.Src);
        canvas.drawRect(
          { x: 0, y: 0, width: doc.width, height: doc.height },
          fill,
        );
        disposeIfPossible(fill);
      }

      // ---- 5. Draw each visible layer sequentially ------------------------
      const total = visibleLayers.length;
      for (let i = 0; i < total; i++) {
        const layer = visibleLayers[i];
        if (layer === undefined) continue;

        if (signal?.aborted) {
          releaseComposite(null);
          return { ok: false, error: { kind: 'cancelled' } };
        }

        const layerImage = layerSurfaces.readLayerImage(layer.id);
        if (layerImage !== null) {
          const canvas = composite.getCanvas();
          const paint = Skia.Paint();
          paint.setAlphaf(layer.opacity);
          // `toSkBlendMode` returns `null` for the few modes Skia lacks
          // a native equivalent for (linear_burn, linear_light, pin_light).
          // Fall back to `SrcOver` so the export is at least viewable; a
          // future custom-shader pass (design F.4 follow-up) will replace
          // these.
          const skBlend = toSkBlendMode(layer.blend_mode) ?? BlendMode.SrcOver;
          paint.setBlendMode(skBlend);
          canvas.drawImage(layerImage, 0, 0, paint);
          disposeIfPossible(paint);
          // The layer SkImage is owned by `LayerSurfaceRegistry`; do NOT
          // dispose it here. Drop the local reference so the GC can reclaim
          // the JS-side wrapper between iterations (peak ≤ 2 simultaneous
          // surface handles: composite + current layer).
        }

        try {
          onProgress?.((i + 1) / total);
        } catch {
          // A misbehaving progress callback must not abort the composite.
          // Swallow to preserve composer's invariant.
        }

        // Yield between layers on web so the UI thread can paint. Native
        // runtimes resolve immediately.
        await yieldToUi();
      }

      // ---- 6. Encode the composite ---------------------------------------
      if (signal?.aborted) {
        releaseComposite(null);
        return { ok: false, error: { kind: 'cancelled' } };
      }

      let snapshot: SkImage | null = null;
      let bytes: Uint8Array | null = null;
      try {
        composite.flush();
        snapshot = composite.makeImageSnapshot();
        if (snapshot === null || snapshot === undefined) {
          releaseComposite(null);
          return {
            ok: false,
            error: {
              kind: 'encode_failed',
              cause: 'makeImageSnapshot returned null',
            },
          };
        }

        // The local ambient `SkImage.encodeToBytes()` declares zero args;
        // the real package signature is `encodeToBytes(fmt?, quality?)`.
        // Cast through `unknown` so this file typechecks against either
        // declaration.
        const encode = (snapshot as unknown as {
          encodeToBytes: (fmt?: number, quality?: number) => Uint8Array | null;
        }).encodeToBytes.bind(snapshot);

        const { fmt, quality } = resolveEncode(format);
        const result = encode(fmt, quality);
        if (result === null || result === undefined || result.length === 0) {
          releaseComposite(snapshot);
          return {
            ok: false,
            error: {
              kind: 'encode_failed',
              cause: 'encodeToBytes returned null',
            },
          };
        }
        bytes = result;
      } catch (err: unknown) {
        releaseComposite(snapshot);
        const cause = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { kind: 'encode_failed', cause } };
      }

      // ---- 7. Cleanup ----------------------------------------------------
      releaseComposite(snapshot);

      // ---- 8. Return -----------------------------------------------------
      return { ok: true, value: bytes };
    },
  };
};

/**
 * Default `documentComposer` singleton. Mirrors the `imageIoAdapter`
 * stub pattern: when nothing has wired the registry into the composer,
 * any call returns a typed `encode_failed` so misconfigurations surface
 * as a clear error instead of an `undefined`-method crash.
 *
 * Production callers should construct a session-scoped composer via
 * `createDocumentComposer({ layerSurfaces })` rather than relying on
 * this stub. The stub is exported only to satisfy the design's
 * "consumers import a `documentComposer` const" contract for code paths
 * (e.g. early bootstrapping diagnostics) that need a typed value before
 * the editor session is ready.
 */
export const documentComposer: DocumentComposer = {
  async composeDocumentToBytes() {
    return {
      ok: false,
      error: {
        kind: 'encode_failed',
        cause: 'document-composer-not-wired-to-layer-registry',
      },
    };
  },
};
