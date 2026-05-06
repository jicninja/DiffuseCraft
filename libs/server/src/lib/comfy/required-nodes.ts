/**
 * Required ComfyUI custom-node packages (A.3, FR-7).
 *
 * The four packages below mirror krita-ai-diffusion's required-node list.
 * Validation in `validation.ts` checks for the **presence of every node
 * class** in `checks` on the `/object_info` endpoint. Missing packages yield
 * an actionable error in external modes (Q5: no auto-install) and trigger
 * the install pipeline in managed mode (FR-8).
 *
 * Pinned commit hashes are placeholders; the release captain replaces them
 * (Q4). `required-versions.ts` documents the bump policy.
 */

import type { RequiredNode } from './types.js';

export const REQUIRED_NODES: ReadonlyArray<RequiredNode> = [
  {
    name: 'ControlNet preprocessors',
    repo: 'https://github.com/Fannovel16/comfyui_controlnet_aux.git',
    commit: 'pending-release-captain',
    // Characteristic node classes shipped by the package. Presence of all
    // three is a strong signal the install is healthy.
    checks: ['CannyEdgePreprocessor', 'OpenposePreprocessor', 'DepthAnythingPreprocessor'],
    install_url: 'https://github.com/Fannovel16/comfyui_controlnet_aux',
  },
  {
    name: 'IP-Adapter',
    repo: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus.git',
    commit: 'pending-release-captain',
    checks: ['IPAdapter', 'IPAdapterUnifiedLoader'],
    install_url: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus',
  },
  {
    name: 'Inpaint nodes',
    repo: 'https://github.com/Acly/comfyui-inpaint-nodes.git',
    commit: 'pending-release-captain',
    checks: ['INPAINT_LoadFooocusInpaint', 'INPAINT_VAEEncodeInpaintConditioning', 'INPAINT_MaskedFill'],
    install_url: 'https://github.com/Acly/comfyui-inpaint-nodes',
  },
  {
    name: 'External tooling',
    repo: 'https://github.com/Acly/comfyui-tooling-nodes.git',
    commit: 'pending-release-captain',
    checks: ['ETN_LoadImageBase64', 'ETN_SendImageWebSocket'],
    install_url: 'https://github.com/Acly/comfyui-tooling-nodes',
  },
];

/**
 * Optional packages (FR-9). These MAY be detected and surfaced as feature
 * flags by `get_server_info`, but their absence does not block startup.
 */
export const OPTIONAL_NODES: ReadonlyArray<{ name: string; checks: ReadonlyArray<string> }> = [
  { name: 'GGUF support', checks: ['UnetLoaderGGUF'] },
  { name: 'Nunchaku', checks: ['NunchakuFluxDiTLoader'] },
];
