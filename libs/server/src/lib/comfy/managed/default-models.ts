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
 * Hashes are pinned to the upstream LFS oids served by Hugging Face / a
 * canonical mirror. `--no-default-models` lets users skip the download
 * (FR-15 mitigation in `tasks.md` Risks).
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
   * Expected SHA-256 (lowercase hex). The downloader rejects the file if the
   * hash doesn't match.
   */
  readonly sha256: string;
  /** Exact size on disk in bytes (matches the LFS oid above). */
  readonly approx_bytes: number;
}

export const DEFAULT_MODELS: ReadonlyArray<DefaultModel> = [
  {
    id: 'hf:stabilityai/stable-diffusion-xl-base-1.0:sd_xl_base_1.0.safetensors',
    type: 'checkpoint',
    subdir: 'checkpoints',
    filename: 'sd_xl_base_1.0.safetensors',
    sha256: '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b',
    approx_bytes: 6_938_078_334,
  },
  {
    id: 'hf:lllyasviel/Annotators:RealESRGAN_x4plus.pth',
    type: 'upscale',
    subdir: 'upscale_models',
    filename: 'RealESRGAN_x4plus.pth',
    sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
    approx_bytes: 67_040_989,
  },
  {
    id: 'hf:h94/IP-Adapter:sdxl_models/ip-adapter_sdxl.safetensors',
    type: 'ip_adapter',
    subdir: 'ipadapter',
    filename: 'ip-adapter_sdxl.safetensors',
    sha256: 'ba1002529e783604c5f326d49f0122025392d1d20ac8d573b3eeb3e6dea4ebb6',
    approx_bytes: 702_585_376,
  },
];

/** Total approximate bytes for the default set (used by the install UI). */
export function totalApproxBytes(): number {
  let total = 0;
  for (const m of DEFAULT_MODELS) total += m.approx_bytes;
  return total;
}
