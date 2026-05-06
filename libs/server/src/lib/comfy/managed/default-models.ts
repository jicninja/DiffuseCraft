/**
 * Default model set for managed-mode auto-install (D.6, FR-15).
 *
 * Per FR-15 the default set covers SDXL base + a default upscaler + a
 * default IP-Adapter checkpoint. Total size kept under ~10 GB to bound
 * first-time install bandwidth.
 *
 * Model ids use the `<registry>:<id>` convention defined in
 * `mcp-tools/shared/common.ts`. The downloader (`models/downloader.ts`)
 * resolves the registry prefix to a concrete URL.
 *
 * Hashes are placeholders for v0.1; the release captain pins them before
 * tagging managed-mode shipping. `--no-default-models` lets users skip the
 * download (FR-15 mitigation in `tasks.md` Risks).
 */

export interface DefaultModel {
  /** Prefixed model id (e.g. `"hf:stabilityai/stable-diffusion-xl-base-1.0"`). */
  readonly id: string;
  /** Type bucket (`checkpoint`, `upscale`, `ip_adapter`, ...). */
  readonly type: 'checkpoint' | 'upscale' | 'ip_adapter' | 'controlnet' | 'vae';
  /** Subdirectory under ComfyUI's `models/` that should hold the file. */
  readonly subdir: string;
  /** Filename written to disk. */
  readonly filename: string;
  /**
   * Expected SHA-256. `null` means "no integrity check" (acceptable for the
   * placeholder default set; concrete hashes pinned before managed-mode
   * release).
   */
  readonly sha256: string | null;
  /** Approximate size on disk; used to estimate bandwidth before download. */
  readonly approx_bytes: number;
}

export const DEFAULT_MODELS: ReadonlyArray<DefaultModel> = [
  {
    id: 'hf:stabilityai/stable-diffusion-xl-base-1.0',
    type: 'checkpoint',
    subdir: 'checkpoints',
    filename: 'sd_xl_base_1.0.safetensors',
    sha256: null,
    approx_bytes: 6_938_000_000,
  },
  {
    id: 'hf:RealESRGAN/RealESRGAN_x4plus',
    type: 'upscale',
    subdir: 'upscale_models',
    filename: 'RealESRGAN_x4plus.pth',
    sha256: null,
    approx_bytes: 67_000_000,
  },
  {
    id: 'hf:h94/IP-Adapter',
    type: 'ip_adapter',
    subdir: 'ipadapter',
    filename: 'ip-adapter_sdxl.safetensors',
    sha256: null,
    approx_bytes: 705_000_000,
  },
];

/** Total approximate bytes for the default set (used by the install UI). */
export function totalApproxBytes(): number {
  let total = 0;
  for (const m of DEFAULT_MODELS) total += m.approx_bytes;
  return total;
}
