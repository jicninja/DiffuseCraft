/**
 * Default preset bundles (generation-workflow B.1, FR-26, FR-27).
 *
 * The server ships three presets in v1: `photographic`, `illustration`,
 * `concept-art`. Each bundles model + sampler + LoRAs + sane defaults so a
 * caller invoking `generate_image({ prompt: "..." })` always produces a
 * usable image without specifying anything else (FR-41 minimum invocation).
 *
 * Models reference SDXL-base with sub-300 MB LoRAs by default; hosts that
 * ship lighter models can override the registry at boot time. The values
 * mirror krita-ai-diffusion's `style.py` defaults; visual-regression
 * baselines (G.4) pin the numerics.
 */

import type { GraphPreset } from '../graph/types.js';

export interface NamedPreset extends GraphPreset {
  /** Stable id; persisted in the `presets` table when the host boots. */
  id: string;
  /** Display name surfaced by the tablet preset picker (FR-27). */
  name: string;
  /** Multi-line description for tooltip / agent context. */
  description: string;
}

export const DEFAULT_PRESET_PHOTOGRAPHIC: NamedPreset = {
  id: 'preset.default.photographic',
  name: 'photographic',
  description:
    'Photorealistic SDXL bundle with neutral colour grading. Good default for portraits, landscapes, product shots.',
  model: 'sdxl_base_1.0.safetensors',
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  steps: 25,
  cfg: 5.5,
  loras: [],
  resolution_factor: 8,
};

export const DEFAULT_PRESET_ILLUSTRATION: NamedPreset = {
  id: 'preset.default.illustration',
  name: 'illustration',
  description:
    'Illustration / digital-painting SDXL bundle. Painterly LoRA stack tuned for stylised composition.',
  model: 'sdxl_base_1.0.safetensors',
  sampler: 'euler_ancestral',
  scheduler: 'normal',
  steps: 28,
  cfg: 7.0,
  loras: [{ name: 'illustration_style.safetensors', strength_model: 0.6, strength_clip: 0.6 }],
  resolution_factor: 8,
};

export const DEFAULT_PRESET_CONCEPT_ART: NamedPreset = {
  id: 'preset.default.concept-art',
  name: 'concept-art',
  description:
    'Concept-art SDXL bundle for fast, varied composition exploration. High CFG + ancestral sampler.',
  model: 'sdxl_base_1.0.safetensors',
  sampler: 'dpmpp_sde',
  scheduler: 'karras',
  steps: 22,
  cfg: 8.0,
  loras: [{ name: 'concept_art_v2.safetensors', strength_model: 0.7, strength_clip: 0.7 }],
  resolution_factor: 8,
};

/**
 * Ordered tuple of the three default presets. The first entry is the
 * server-default if no preset is named in `generate_image` and the user has
 * not configured `default_preset` in the host config.
 */
export const DEFAULT_PRESETS: ReadonlyArray<NamedPreset> = [
  DEFAULT_PRESET_PHOTOGRAPHIC,
  DEFAULT_PRESET_ILLUSTRATION,
  DEFAULT_PRESET_CONCEPT_ART,
];

/** Stable name of the preset used when none is specified anywhere. */
export const DEFAULT_PRESET_NAME = DEFAULT_PRESET_PHOTOGRAPHIC.name;
