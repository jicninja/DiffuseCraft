/**
 * StampRenderer — full-raster, per-stroke pooled stamp renderer.
 *
 * Architecture (Procreate-style stroke preview):
 *
 *     pointer move → draw stamps DIRECTLY into a transient stroke SkSurface
 *                  → display reads `surface.makeImageSnapshot()` per frame
 *     pointer up   → caller bakes the stroke surface onto the layer surface
 *                  → stroke surface disposed
 *
 * Lifecycle (one instance per stroke):
 *
 *   1. `beginStroke(config)` allocates exactly one `SkPaint`, one `SkShader`,
 *      and one transient stroke `SkSurface` sized to the stroke buffer
 *      dimensions. The surface starts transparent.
 *   2. `drawStamps(stamps)` paints each stamp's pixels directly into the
 *      stroke surface. **No command list, no Picture replay.** The pixels
 *      live on the GPU side of the surface. O(new stamps).
 *   3. `takeImage()` returns `surface.makeImageSnapshot()` — a snapshot
 *      `SkImage` of the current pixels. Per-frame display cost is **O(1)**:
 *      one snapshot reference + one `<Image>` draw, regardless of how many
 *      stamps the stroke contains. This is the core scalability win over
 *      a Picture-based active stroke (which costs O(stamps) GPU-side per
 *      frame to replay every drawCircle command).
 *   4. `getSurface()` exposes the stroke surface so the commit worklet can
 *      `drawImage(strokeSnapshot)` onto the persistent layer surface.
 *   5. `endStroke()` disposes the paint, shader, and stroke surface.
 *      Idempotent.
 *
 * Why direct-to-surface instead of Picture chunks:
 *   `<Picture>` element on the visible canvas replays every recorded
 *   `drawCircle` command per frame; that cost grows linearly with stroke
 *   length. With a stroke surface, each new stamp pays its rasterization
 *   cost ONCE (when the stamp is drawn), then every subsequent display
 *   frame is just a single `drawImage` of the cached snapshot. Strokes of
 *   any length cost the same per frame to display.
 *
 * Resource pooling (Req 4.1, 4.2):
 *   - One `SkPaint` per stroke. Reused for every stamp; per-stamp variation
 *     is expressed through canvas transform + alpha modulation.
 *   - One `SkShader` per stroke (built from `hardness-shader.ts`).
 *   - One `SkSurface` per stroke. Sized to the working buffer dimensions
 *     (capped at 4096² by the pipeline). RGBA bytes ≈ width × height × 4.
 *
 * Worklet semantics:
 *   - All methods carry the `'worklet'` directive and are intended to be
 *     invoked from the worklet runtime that drives the active stroke
 *     image's `useDerivedValue`. State lives on a single mutable `state`
 *     object (not closure `let` bindings) because Reanimated does not
 *     preserve `let` reassignments across worklet invocations on the UI
 *     runtime.
 *
 * Design reference: brush-canvas-rendering §StampRenderer.
 */

import type { Stamp } from '@diffusecraft/canvas-core';
import {
  BlendMode,
  Skia,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkShader,
  type SkSurface,
} from '@shopify/react-native-skia';

import { buildHardnessShader } from './hardness-shader';

/**
 * Per-stroke configuration. Immutable for the stroke's lifetime — Req 7.2.
 */
export interface StampRendererConfig {
  /** Working buffer width in document pixels. */
  readonly width: number;
  /** Working buffer height in document pixels. */
  readonly height: number;
  /** Brush color in straight-alpha 0..1 channels. */
  readonly color: { r: number; g: number; b: number };
  /** Brush hardness 0..1 (sets the radial-gradient inner stop). */
  readonly hardness: number;
  /** When true, the stamp uses `BlendMode.DstOut` (eraser semantics). */
  readonly erase: boolean;
  /** When true, alpha is multiplied by the color's luminance (mask layer). */
  readonly maskOnly: boolean;
}

/** Public surface of the renderer. */
export interface StampRenderer {
  /**
   * Allocate paint + shader + transient stroke `SkSurface`. Worklet-callable.
   *
   * Calling `beginStroke` while already active disposes the prior stroke
   * first (defensive — the brush pipeline never does this in practice).
   */
  beginStroke(config: StampRendererConfig): void;

  /**
   * Paint each stamp directly onto the stroke surface. Worklet-callable.
   * O(new stamps). No-op when the renderer is not active.
   */
  drawStamps(stamps: ReadonlyArray<Stamp>): void;

  /**
   * Snapshot the stroke surface and return the resulting `SkImage`. The
   * returned handle reflects the surface's pixels at this moment;
   * subsequent draws to the surface MAY copy-on-write, but that is
   * RN-Skia's concern. Worklet-callable. O(1).
   *
   * Returns `null` when no stroke is active.
   */
  takeImage(): SkImage | null;

  /**
   * Direct accessor for the stroke surface, used by the commit worklet to
   * `drawImage` the stroke's pixels onto the persistent layer surface at
   * gesture end.
   *
   * Returns `null` when no stroke is active.
   */
  getSurface(): SkSurface | null;

  /**
   * Dispose the per-stroke paint, shader, and stroke surface. Idempotent.
   */
  endStroke(): void;

  /**
   * Whether `beginStroke` has been called and `endStroke` has not. Exposed
   * as a method (not a getter) so the Reanimated Worklets babel plugin can
   * workletize the containing object — getters on object literals trip the
   * plugin's function-wrap pass.
   */
  isActive(): boolean;
}

/**
 * Construct a fresh `StampRenderer`. The renderer owns no global state.
 *
 * **Why state lives on a single mutable object, not in `let` bindings.**
 * Reanimated's worklet runtime serializes captured-closure variables at the
 * moment a worklet is first read; subsequent reassignments to those captured
 * `let` bindings between worklet invocations are NOT preserved across the
 * JS↔UI boundary or across separate worklet invocations. Each `renderer.X()`
 * call ends up reading a frozen snapshot of the bindings, so changes made
 * by `beginStroke` are invisible to a later `takeImage` call. Plain object
 * MEMBER mutations DO survive across worklet invocations because Reanimated
 * tracks the object reference. The `IncrementalStampExpander` factory uses
 * the same pattern.
 */
export function createStampRenderer(): StampRenderer {
  const state: {
    active: boolean;
    config: StampRendererConfig | null;
    paint: SkPaint | null;
    shader: SkShader | null;
    /** Transient stroke buffer. Pixels live here for the gesture's lifetime;
     *  baked onto the layer surface at commit and disposed afterwards. */
    surface: SkSurface | null;
  } = {
    active: false,
    config: null,
    paint: null,
    shader: null,
    surface: null,
  };

  /**
   * Release any handle that exposes a `dispose()` method (RN-Skia JSI
   * objects). Defensive — some test fixtures stub these out, so we
   * optional-call.
   */
  const tryDispose = (handle: unknown): void => {
    'worklet';
    const d = handle as { dispose?: () => void } | null;
    d?.dispose?.();
  };

  /**
   * Tear down the per-stroke handles and reset state. Used by both
   * `beginStroke` (defensive cleanup before restart) and `endStroke`
   * (external idempotent dispose). Lives outside the `renderer` object so
   * the worklet plugin doesn't have to resolve a self-reference (`renderer`)
   * inside one of its own methods — the web bundle hoists those methods in
   * a way that hits a TDZ on `renderer` otherwise.
   */
  const disposeStroke = (): void => {
    'worklet';
    state.active = false;
    tryDispose(state.surface);
    tryDispose(state.paint);
    tryDispose(state.shader);
    state.surface = null;
    state.paint = null;
    state.shader = null;
    state.config = null;
  };

  /** Draw one stamp into the given canvas using the pooled paint. */
  const drawOne = (canvas: SkCanvas, stamp: Stamp): void => {
    'worklet';
    if (state.paint === null) return;
    // Per-stamp opacity is the only field that varies inside a stroke. We
    // express it through `paint.setAlphaf` so the shader's pre-baked
    // (color × stamp opacity) baseline is modulated without rebuilding the
    // shader. The hardness-shader is built at `beginStroke` with
    // opacity=1; per-stamp alpha lands here.
    state.paint.setAlphaf(stamp.opacity);

    canvas.save();
    canvas.translate(stamp.x, stamp.y);
    canvas.scale(stamp.size, stamp.size);
    canvas.drawCircle(0, 0, 0.5, state.paint);
    canvas.restore();
  };

  const renderer: StampRenderer = {
    beginStroke(next: StampRendererConfig): void {
      'worklet';
      if (state.active) {
        // Defensive: dispose the prior stroke before starting a new one.
        disposeStroke();
      }
      state.config = next;

      // Build the per-stroke shader. We bake the (color × baseline opacity
      // = 1) into the radial gradient; per-stamp alpha modulates via
      // `paint.setAlphaf` in `drawOne`. For mask layers, we substitute the
      // luminance of the brush color into the alpha channel so a "white"
      // brush adds and a "black" brush subtracts, matching the server-side
      // `composeStrokeIntoRaster` behavior.
      const renderColor = next.maskOnly ? { r: 1, g: 1, b: 1 } : next.color;
      const baseOpacity = next.maskOnly
        ? 0.299 * next.color.r + 0.587 * next.color.g + 0.114 * next.color.b
        : 1;
      state.shader = buildHardnessShader(next.hardness, renderColor, baseOpacity);

      const p = Skia.Paint();
      p.setAntiAlias(true);
      p.setShader(state.shader);
      p.setBlendMode(next.erase ? BlendMode.DstOut : BlendMode.SrcOver);
      state.paint = p;

      // Allocate the transient stroke buffer. Failure (null surface) leaves
      // the renderer inactive so the brush pipeline can cancel cleanly.
      state.surface = Skia.Surface.MakeOffscreen(next.width, next.height);
      if (state.surface === null) {
        tryDispose(state.paint);
        tryDispose(state.shader);
        state.paint = null;
        state.shader = null;
        state.config = null;
        return;
      }

      state.active = true;
    },

    drawStamps(stamps: ReadonlyArray<Stamp>): void {
      'worklet';
      if (!state.active || state.surface === null) return;
      const canvas = state.surface.getCanvas();
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (s !== undefined) drawOne(canvas, s);
      }
      // Flush GPU commands so the next snapshot reflects what we just drew.
      state.surface.flush();
    },

    takeImage(): SkImage | null {
      'worklet';
      if (!state.active || state.surface === null) return null;
      return state.surface.makeImageSnapshot();
    },

    getSurface(): SkSurface | null {
      'worklet';
      if (!state.active) return null;
      return state.surface;
    },

    endStroke(): void {
      'worklet';
      if (
        !state.active
        && state.paint === null
        && state.shader === null
        && state.surface === null
      ) {
        // Already disposed — idempotent.
        return;
      }
      disposeStroke();
    },

    isActive(): boolean {
      'worklet';
      return state.active;
    },
  };

  return renderer;
}
