/**
 * Unified model-id parser (G.3, FR-12).
 *
 * Dispatches by prefix to the per-registry parsers. Throws `ComfyError`
 * for unknown prefixes so callers can branch on the typed exception.
 */

import { ComfyError } from '../../errors.js';
import { parseCivitai, type CivitaiResolved } from './civitai.js';
import { parseFile, type FileResolved } from './file.js';
import { parseHf, type HfResolved } from './hf.js';

export type ResolvedModelId = HfResolved | CivitaiResolved | FileResolved;

export function parseModelId(id: string, defaultFilename?: string): ResolvedModelId {
  if (id.startsWith('hf:')) return parseHf(id, defaultFilename);
  if (id.startsWith('civitai:')) return parseCivitai(id);
  if (id.startsWith('file:')) return parseFile(id);
  throw new ComfyError(`unknown model-id prefix in "${id}" (expected hf:, civitai:, or file:)`);
}

export type { CivitaiResolved } from './civitai.js';
export type { FileResolved } from './file.js';
export type { HfResolved } from './hf.js';
export { parseCivitai } from './civitai.js';
export { parseFile } from './file.js';
export { parseHf } from './hf.js';
