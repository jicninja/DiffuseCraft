/**
 * Custom-node validation (C.1, C.2, FR-7, FR-8, NFR-2).
 *
 * On startup the server queries `/object_info` and checks that every
 * required custom-node package is represented by **all** its characteristic
 * node classes (per `required-nodes.ts`). The presence test catches the
 * common failure mode where a custom-node was cloned but its `pip install`
 * step partially failed.
 *
 * Behaviour:
 *   - **Managed mode**: missing nodes trigger the install pipeline (FR-8a).
 *     This module reports the diff; the supervisor decides what to do.
 *   - **External modes**: missing nodes refuse the start (Q5 — no auto-
 *     install in external modes). The error message names every missing
 *     package with a clickable install URL.
 */

import type { ComfyClient } from './client.js';
import { ComfyMissingNodesError } from './errors.js';
import { REQUIRED_NODES } from './required-nodes.js';
import type { RequiredNode, ValidationResult } from './types.js';

export interface ValidationOptions {
  /**
   * Override the required-node list for tests. Production uses the canonical
   * list from `required-nodes.ts`.
   */
  required?: ReadonlyArray<RequiredNode>;
}

/**
 * Validate a ComfyUI install by querying its node catalog. Returns a
 * structured result; never throws on network errors — the caller wraps
 * those in their own `ComfyUnreachableError`.
 */
export async function validateInstall(
  client: ComfyClient,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const required = options.required ?? REQUIRED_NODES;
  const objectInfo = await client.getObjectInfo();
  const present = new Set(Object.keys(objectInfo));

  const missing: RequiredNode[] = [];
  for (const node of required) {
    const allPresent = node.checks.every((cls) => present.has(cls));
    if (!allPresent) missing.push(node);
  }

  if (missing.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    missing,
    message: formatMissingMessage(missing),
  };
}

/**
 * Format an actionable error message for missing custom-node packages
 * (C.2). Lists every missing package by name + install URL on its own
 * line so the message reads cleanly in CLI output and HTTP error bodies.
 */
export function formatMissingMessage(missing: ReadonlyArray<RequiredNode>): string {
  if (missing.length === 0) return '';
  const lines = missing.map((n) => `  - ${n.name} (${n.install_url})`);
  return [
    `ComfyUI is missing ${missing.length} required custom-node ${missing.length === 1 ? 'package' : 'packages'}:`,
    ...lines,
    '',
    'Managed mode auto-installs these. In external modes you must install them yourself',
    'and restart ComfyUI before retrying.',
  ].join('\n');
}

/**
 * Convenience: throw a typed error when validation fails. The supervisor
 * uses this in external modes; managed mode handles the diff itself.
 */
export function assertValid(result: ValidationResult): void {
  if (result.ok) return;
  const packages = (result.missing ?? []).map((n) => n.name);
  throw new ComfyMissingNodesError(packages, result.message ?? 'missing required custom nodes');
}
