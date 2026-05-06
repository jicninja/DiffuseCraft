#!/usr/bin/env tsx
/**
 * tools/snapshot-pen.ts
 *
 * STUB — the canonical snapshot in apps/mobile/design-snapshot/ was extracted
 * by the orchestrator session via the pencil MCP server (see manifest.json's
 * `extracted_by` field). This script is the planned re-extraction entry point
 * referenced by design-system-foundation T1.
 *
 * To re-extract:
 *   - PENCIL_MCP_BIN=/path/to/pencil-mcp-server \
 *     DIFFUSECRAFT_PEN_PATH=/Users/ignaciocastro/ia/DiffuseCraft/untitled.pen \
 *     pnpm snapshot:pen
 *   - OR re-run the orchestrator session, which talks to the pencil MCP via
 *     the parent IDE's MCP host directly.
 *
 * TODO(real-implementation): replace this stub with the script described in
 * .kiro/specs/design-system-foundation/design.md §6:
 *   1. Spawn the pencil MCP server (path from PENCIL_MCP_BIN env). Connect
 *      via @modelcontextprotocol/sdk Client + StdioClientTransport.
 *   2. open_document(DIFFUSECRAFT_PEN_PATH).
 *   3. get_variables() -> apps/mobile/design-snapshot/tokens.json.
 *   4. For each artboard label in TARGET_ARTBOARDS:
 *      - export_nodes(artboard) -> nodes.json
 *      - get_screenshot(artboard) -> preview.png
 *      - snapshot_layout(artboard) -> layout.json
 *   5. Write manifest.json with the schema in design.md §6.2.
 *   6. Disconnect cleanly.
 *
 * Per FR-11 / design.md §6.4, when the .pen is not yet available the script
 * should still write a placeholder manifest with the 13 expected artboard
 * labels. The current snapshot has snapshot_version: "1.0.0" so the placeholder
 * branch is unused — kept here so the spec's pre-.pen path remains documented.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const SNAPSHOT_DIR = resolve(REPO_ROOT, 'apps/mobile/design-snapshot');
const MANIFEST_PATH = resolve(SNAPSHOT_DIR, 'manifest.json');

const TARGET_ARTBOARDS = [
  '01-Splash',
  '02-Pairing-mDNS',
  '02b-Pairing-QR',
  '02c-Pairing-Code',
  '02d-Pairing-Manual',
  '03-ServerPicker',
  '04-Documents',
  '05-Editor-Generate',
  '05b-Editor-Inpaint',
  '05c-Editor-Live',
  '05d-Editor-Chat-Open',
  '06-Settings',
  '06a-Settings-Connection',
] as const;

function main(): number {
  // eslint-disable-next-line no-console
  console.log('tools/snapshot-pen.ts — stub.\n');

  if (existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      snapshot_version?: string | number;
      artboards?: unknown[];
    };
    // eslint-disable-next-line no-console
    console.log(
      [
        `The canonical snapshot already exists at ${SNAPSHOT_DIR}.`,
        `  snapshot_version: ${String(manifest.snapshot_version)}`,
        `  artboards: ${manifest.artboards?.length ?? 0} (target: ${TARGET_ARTBOARDS.length})`,
        '',
        'To re-extract, run this script with PENCIL_MCP_BIN set, OR re-run the',
        'orchestrator session that has direct pencil MCP access.',
        '',
        'TODO(real-implementation): replace this stub with the StdioClientTransport-',
        'based extractor described in design-system-foundation/design.md §6.',
      ].join('\n'),
    );
    return 0;
  }

  // eslint-disable-next-line no-console
  console.error(
    [
      `No manifest at ${MANIFEST_PATH}.`,
      'Real extraction is not yet implemented in this stub.',
      'The orchestrator session is currently the canonical extraction path.',
    ].join('\n'),
  );
  return 1;
}

process.exit(main());
