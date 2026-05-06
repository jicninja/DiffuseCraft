/**
 * Hugging Face id parser (G.3, FR-12).
 *
 * Format: `hf:<repo>[:<filename>]` — e.g. `hf:stabilityai/stable-diffusion-xl-base-1.0`
 * or `hf:black-forest-labs/FLUX.1-dev:flux1-dev.safetensors`.
 *
 * Returns the resolved download URL on Hugging Face's CDN. The optional
 * filename suffix lets users target a specific shard within a repo; when
 * omitted we default to the canonical filename in the model registry — the
 * caller is expected to pass it explicitly for full reproducibility.
 */

import { ComfyError } from '../../errors.js';

export interface HfResolved {
  registry: 'hf';
  repo: string;
  filename: string;
  url: string;
}

export function parseHf(id: string, defaultFilename?: string): HfResolved {
  if (!id.startsWith('hf:')) throw new ComfyError(`expected hf: prefix, got ${id}`);
  const rest = id.slice(3);
  const sep = rest.indexOf(':');
  const repo = sep === -1 ? rest : rest.slice(0, sep);
  const filename = sep === -1 ? (defaultFilename ?? '') : rest.slice(sep + 1);
  if (!repo.includes('/')) {
    throw new ComfyError(`invalid hf repo "${repo}" — expected "owner/name"`);
  }
  if (!filename) {
    throw new ComfyError(`hf id "${id}" lacks a filename — pass it as ${id}:<filename> or via DefaultModel.filename`);
  }
  const url = `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(filename)}`;
  return { registry: 'hf', repo, filename, url };
}
