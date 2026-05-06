/**
 * Civitai id parser (G.3, FR-12).
 *
 * Format: `civitai:<modelVersionId>[:filename]`. Civitai's stable download
 * endpoint is `/api/download/models/<modelVersionId>` and follows redirects
 * to a CDN URL with the actual filename.
 */

import { ComfyError } from '../../errors.js';

export interface CivitaiResolved {
  registry: 'civitai';
  model_version_id: string;
  filename?: string;
  url: string;
}

export function parseCivitai(id: string): CivitaiResolved {
  if (!id.startsWith('civitai:')) throw new ComfyError(`expected civitai: prefix, got ${id}`);
  const rest = id.slice('civitai:'.length);
  const sep = rest.indexOf(':');
  const versionId = sep === -1 ? rest : rest.slice(0, sep);
  const filename = sep === -1 ? undefined : rest.slice(sep + 1);
  if (!/^\d+$/.test(versionId)) {
    throw new ComfyError(`civitai modelVersionId must be numeric, got "${versionId}"`);
  }
  return {
    registry: 'civitai',
    model_version_id: versionId,
    ...(filename !== undefined ? { filename } : {}),
    url: `https://civitai.com/api/download/models/${versionId}`,
  };
}
