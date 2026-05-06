/**
 * StampRenderer — single-recorder, per-stroke pooled stamp renderer.
 *
 * Lifecycle (one instance per stroke):
 *
 *   1. `beginStroke(config)` allocates exactly one `SkPaint` and (for the
 *      stroke's hardness/color) one `SkShader`, then opens a fresh
 *      `SkPictureRecorder`.
 *   2. `drawStamps(stamps)` records each stamp into the open recorder using
 *      the pooled paint + shader. O(stamps).
 *   3. `takePicture()` finalizes the recorder (returning the resulting
 *      `SkPicture`) and *immediately* opens a new recorder so subsequent
 *      `drawStamps` calls keep accumulating into a fresh picture.
 *   4. `endStroke()` releases the paint, shader, and any open recorder.
 *      Idempotent.
 *
 * Why a single picture per stroke instead of the legacy "chunks" model:
 *   - The active stroke is short-lived (one gesture). The picture is
 *     re-recorded each frame inside a `useDerivedValue` and disposed at
 *     commit, so the Picture's command list never persists across strokes.
 *   - One `finishRecordingAsPicture` + one `beginRecording` per frame is
 *     cheaper than maintaining per-100-stamp chunks and rebuilding a wrapper
 *     picture every frame (the legacy path's cost model).
 *
 * Resource pooling (Req 4.1, 4.2):
 *   - One `SkPaint` per stroke. Reused for every stamp. The shader is set
 *     once at `beginStroke`; per-stamp variation is expressed through
 *     canvas transforms (translate + scale) and per-call alpha modulation.
 *   - The shader is built from `hardness-shader.ts` (kept untouched). For
 *     a single stroke with a fixed hardness/color, one shader is enough.
 *
 * Worklet semantics:
 *   - All methods are intended to be called from the worklet runtime that
 *     drives the active picture's `useDerivedValue`. They do not allocate
 *     new paints or shaders inside `drawStamps`, so the per-event budget
 *     stays bounded by the stamp count.
 *
 * Design reference: brush-canvas-rendering §StampRenderer.
 */

import type { Stamp } from '@diffusecraft/canvas-core';
import {
  BlendMode,
  Skia,
  type SkCanvas,
  type SkPaint,
  type SkPicture,
  type SkPictureRecorder,
  type SkShader,
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
   * Allocate paint + shader, open the recorder. Worklet-callable.
   *
   * Calling `beginStroke` while already active disposes the prior stroke
   * first (defensive — the brush pipeline never does this in practice).
   */
  beginStroke(config: StampRendererConfig): void;

  /**
   * Append `stamps` to the open recorder. Worklet-callable. O(stamps).
   *
   * No-op when `beginStroke` was not called or `endStroke` already ran.
   */
  drawStamps(stamps: ReadonlyArray<Stamp>): void;

  /**
   * Finalize the open recorder and return the resulting picture.
   * Immediately opens a fresh recorder so subsequent `drawStamps` calls
   * keep recording without losing in-flight work.
   *
   * Returns `null` when no stroke is active. The previous picture handle
   * remains valid for replay until the caller releases it.
   */
  takePicture(): SkPicture | null;

  /**
   * Dispose the per-stroke paint, shader, and any open recorder.
   * Idempotent — safe to call multiple times.
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

/** Construct a fresh `StampRenderer`. The renderer owns no global state.
 *
 * **Why state is held in a single mutable object, not in `let` variables.**
 * Reanimated's worklet runtime serializes captured-closure variables at the
 * moment the worklet is read, but reassignments to those captured `let`
 * bindings between worklet invocations are NOT preserved across the JS↔UI
 * boundary or across separate worklet invocations on the UI runtime — each
 * `renderer.method()` call ends up reading a frozen snapshot of the bindings
 * captured when the method was first serialized. The symptom is
 * `takePicture()` always returning null at commit time because `active`
 * appears `false` even though `beginStroke` set it to `true`.
 *
 * Plain object MEMBER mutations DO survive across worklet invocations because
 * Reanimated tracks the object reference (this is the same pattern the
 * `IncrementalStampExpander` already uses). All renderer state therefore
 * lives on a single `state` object and the methods mutate `state.X` rather
 * than rebinding closure `let`s.
 */
export function createStampRenderer(): StampRenderer {
  const state: {
    active: boolean;
    config: StampRendererConfig | null;
    paint: SkPaint | null;
    shader: SkShader | null;
    recorder: SkPictureRecorder | null;
    canvas: SkCanvas | null;
  } = {
    active: false,
    config: null,
    paint: null,
    shader: null,
    recorder: null,
    canvas: null,
  };

  /**
   * Open a fresh `SkPictureRecorder` sized to the stroke buffer. Used by
   * `beginStroke` and re-used after every `takePicture`.
   */
  const openRecorder = (cfg: StampRendererConfig): void => {
    'worklet';
    const r = Skia.PictureRecorder();
    const c = r.beginRecording({
      x: 0,
      y: 0,
      width: cfg.width,
      height: cfg.height,
    });
    state.recorder = r;
    state.canvas = c;
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

  /** Draw one stamp into the open recorder using the pooled paint. */
  const drawOne = (stamp: Stamp): void => {
    'worklet';
    if (state.canvas === null || state.paint === null) return;
    // Per-stamp opacity is the only field that varies inside a stroke. We
    // express it through `paint.setAlphaf` so the shader's pre-baked
    // (color × stamp opacity) baseline is modulated without rebuilding the
    // shader. The hardness-shader is built at `beginStroke` with
    // opacity=1; per-stamp alpha lands here.
    state.paint.setAlphaf(stamp.opacity);

    state.canvas.save();
    state.canvas.translate(stamp.x, stamp.y);
    state.canvas.scale(stamp.size, stamp.size);
    state.canvas.drawCircle(0, 0, 0.5, state.paint);
    state.canvas.restore();
  };

  const renderer: StampRenderer = {
    beginStroke(next: StampRendererConfig): void {
      'worklet';
      if (state.active) {
        // Defensive: dispose the prior stroke before starting a new one.
        renderer.endStroke();
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

      openRecorder(next);
      state.active = true;
    },

    drawStamps(stamps: ReadonlyArray<Stamp>): void {
      'worklet';
      if (!state.active) return;
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (s !== undefined) drawOne(s);
      }
    },

    takePicture(): SkPicture | null {
      'worklet';
      if (!state.active || state.recorder === null || state.config === null) return null;
      const picture = state.recorder.finishRecordingAsPicture();
      // Immediately reopen a fresh recorder so further `drawStamps` calls
      // keep accumulating. The previous Picture is now immutable from the
      // recorder's perspective, but remains valid for replay.
      state.recorder = null;
      state.canvas = null;
      openRecorder(state.config);
      return picture;
    },

    endStroke(): void {
      'worklet';
      if (!state.active && state.paint === null && state.shader === null && state.recorder === null) {
        // Already disposed — idempotent.
        return;
      }
      state.active = false;
      // Drop any open recorder. We do not finalize it: an in-flight picture
      // that the caller hasn't taken is intentionally discarded (cancel
      // semantics). The recorder's resources release when `recorder` goes
      // out of scope.
      state.recorder = null;
      state.canvas = null;
      tryDispose(state.paint);
      tryDispose(state.shader);
      state.paint = null;
      state.shader = null;
      state.config = null;
    },

    isActive(): boolean {
      'worklet';
      return state.active;
    },
  };

  return renderer;
}
