/**
 * Local-file id parser (G.3, FR-12).
 *
 * Format: `file:<absolute-path>`. Used when a user has a model already on
 * disk and wants the registry to track it without re-downloading.
 */

import * as path from 'node:path';

import { ComfyError } from '../../errors.js';

export interface FileResolved {
  registry: 'file';
  absolute_path: string;
}

export function parseFile(id: string): FileResolved {
  if (!id.startsWith('file:')) throw new ComfyError(`expected file: prefix, got ${id}`);
  const raw = id.slice('file:'.length);
  if (!path.isAbsolute(raw)) {
    throw new ComfyError(`file: id requires an absolute path, got "${raw}"`);
  }
  return { registry: 'file', absolute_path: raw };
}
