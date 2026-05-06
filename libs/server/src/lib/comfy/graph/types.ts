/**
 * Graph-builder context types (design.md §6).
 *
 * The `GraphContext` carries everything a builder needs **beyond** the raw
 * MCP input: the active document dimensions, the resolved preset (model,
 * sampler, LoRAs), the job id (used for `SaveImage.filename_prefix`), and
 * a logger. Builders are pure functions of `(input, ctx)`; they do NOT
 * call ComfyUI themselves — the dispatcher does that.
 *
 * Per FR-19-quat, helpers communicate only through pure data structures.
 * This module declares the shared shapes; helpers import the parts they
 * need.
 */

export interface GraphPreset {
  /** Checkpoint filename as ComfyUI sees it. */
  model: string;
  /** Sampler name (e.g. `"dpmpp_2m"`). */
  sampler: string;
  /** Scheduler name (e.g. `"karras"`). */
  scheduler: string;
  /** Sampler steps. */
  steps: number;
  /** CFG scale. */
  cfg: number;
  /** LoRA stack. */
  loras: ReadonlyArray<{ name: string; strength_model: number; strength_clip: number }>;
  /** Multiples-of-N requirement of the underlying model (8 / 16 / 64). */
  resolution_factor: number;
}

export interface GraphContext {
  /** Logical job id — embedded in `SaveImage.filename_prefix`. */
  job_id: string;
  /** Document width × height in pixels. */
  document: { width: number; height: number };
  /** Resolved preset (preset name + model already merged). */
  preset: GraphPreset;
  /** Optional logger; the dispatcher passes one in. */
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

/**
 * Minimal v1 input shape consumed by every builder. The full
 * `generate_image` schema (with selection / region / control layers) is
 * defined in `mcp-tools/tools/generation/generate-image.ts`; this is the
 * subset the scaffold builders read.
 */
export interface BuilderInput {
  prompt: string;
  negative_prompt?: string;
  strength?: number;
  seed?: number | 'random';
  batch_size?: number;
  control_layer_ids?: ReadonlyArray<string>;
  region_ids?: ReadonlyArray<string>;
  selection_id?: string | null;
  /**
   * Fill sub-mode discriminator (`Fill` | `Expand` | `AddContent` |
   * `RemoveContent` | `ReplaceBackground`). Required by `buildFillGraph`
   * when `verb === "fill"`; defaulted to `"Fill"` for `constrained_variation`.
   */
  selection_mode?: string;
  /** Source image asset id (for refine / fill). */
  source_image_blob_id?: string;
  /** Upscale-only fields. */
  factor?: number;
  upscaler_model?: string;
  tile_size?: number;
}

/** Convenience: build a Comfy "node" object literal. */
export function node(class_type: string, inputs: Record<string, unknown>): { class_type: string; inputs: Record<string, never> } {
  return { class_type, inputs: inputs as Record<string, never> };
}
