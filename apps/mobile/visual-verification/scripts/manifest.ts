/**
 * manifest.ts
 *
 * Reads `apps/mobile/design-snapshot/manifest.json`, normalises the artboard
 * list into an iteration-friendly shape, and surfaces snapshot_version +
 * `ref_changed` book-keeping for the rest of the pipeline.
 *
 * Every artboard returned has one of three statuses:
 *   - 'ok'              — preview PNG present; this artboard participates in
 *                         the diff.
 *   - 'export_failed'   — preview PNG missing; rendered as a "no-reference"
 *                         row in the report (FR-7 generalised: any artboard
 *                         that was supposed to have a baseline but doesn't).
 *   - 'component-board' — the `_components` swatch board is documentation,
 *                         not a route, and is excluded from the run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface ManifestArtboard {
  label: string;
  pen_node_id: string;
  size: [number, number];
  preview: string | null;
  preview_status: 'ok' | 'export_failed';
  preview_status_note?: string;
  role?: string;
}

export interface SnapshotManifest {
  snapshot_version: string;
  source_pen_path: string;
  extracted_at: string;
  extracted_by: string;
  tokens_file: string;
  artboards: ManifestArtboard[];
  summary: Record<string, unknown>;
  next_steps?: string[];
}

export interface NormalisedArtboard {
  label: string;
  /** Group used for filter chips in the report. */
  group: 'Splash' | 'Pairing' | 'Servers' | 'Documents' | 'Editor' | 'Settings' | 'Other';
  /** Absolute path to the reference PNG (only set when status === 'ok'). */
  referenceAbs: string | null;
  /** Path relative to the report directory, for use in <img src="…">. */
  referenceRel: string | null;
  /** Whether a reference baseline exists for this artboard. */
  hasReference: boolean;
  /** Companion flow file name without extension (e.g. '04-documents'). */
  flowFileBase: string;
  /** Native artboard size from the manifest. */
  size: [number, number];
}

export interface LoadResult {
  manifest: SnapshotManifest;
  artboards: NormalisedArtboard[];
  /** Snapshot version persisted from the previous run, if any. */
  previousSnapshotVersion: string | null;
  /** True if the persisted previous version differs from the current one. */
  refChanged: boolean;
  manifestPath: string;
  snapshotRoot: string;
}

const FLOW_BASENAME_BY_LABEL: Record<string, string> = {
  '01-Splash': '01-splash',
  '02-Pairing-mDNS': '02-pairing-mdns',
  '02b-Pairing-QR': '02b-pairing-qr',
  '02c-Pairing-Code': '02c-pairing-code',
  '02d-Pairing-Manual': '02d-pairing-manual',
  '03-ServerPicker': '03-serverpicker',
  '04-Documents': '04-documents',
  '05-Editor-Generate': '05-editor-generate',
  '05b-Editor-Inpaint': '05b-editor-inpaint',
  '05c-Editor-Live': '05c-editor-live',
  '05d-Editor-Chat-Open': '05d-editor-chat-open',
  '06-Settings': '06-settings',
  '06a-Settings-Connection': '06a-settings-connection',
};

function groupForLabel(label: string): NormalisedArtboard['group'] {
  if (label.startsWith('01-Splash')) return 'Splash';
  if (label.startsWith('02')) return 'Pairing';
  if (label.startsWith('03')) return 'Servers';
  if (label.startsWith('04')) return 'Documents';
  if (label.startsWith('05')) return 'Editor';
  if (label.startsWith('06')) return 'Settings';
  return 'Other';
}

/** List of capture labels owned by this spec (FR-1). Excludes _components. */
export const CAPTURE_LABELS = Object.keys(FLOW_BASENAME_BY_LABEL);

/** Settings detail routes intentionally without a baseline (FR-7). */
export const NO_REFERENCE_ROUTES: Array<{ route: string; deepLink: string; reason: string }> = [
  { route: 'Settings.Models', deepLink: 'diffusecraft://settings/models', reason: 'No .pen artboard yet (screens-implementation FR-18).' },
  { route: 'Settings.Agents', deepLink: 'diffusecraft://settings/agents', reason: 'Same.' },
  { route: 'Settings.Speech', deepLink: 'diffusecraft://settings/speech', reason: 'Same.' },
  { route: 'Settings.Appearance', deepLink: 'diffusecraft://settings/appearance', reason: 'Same.' },
  { route: 'Settings.AuditLog', deepLink: 'diffusecraft://settings/audit', reason: 'Same.' },
];

/**
 * Load and normalise the snapshot manifest. Pure I/O + shaping; the orchestrator
 * decides what to do with the result.
 *
 * @param snapshotRoot Absolute path to `apps/mobile/design-snapshot/`.
 * @param reportDir    Absolute path to `apps/mobile/visual-verification/report/`.
 *                     Used to resolve `previousSnapshotVersion` from the
 *                     `.last_snapshot_version` book-keeping file.
 */
export function loadManifest(snapshotRoot: string, reportDir: string): LoadResult {
  const manifestPath = resolve(snapshotRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json missing at ${manifestPath}`);
  }
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as SnapshotManifest;

  const artboards: NormalisedArtboard[] = [];
  for (const label of CAPTURE_LABELS) {
    const entry = manifest.artboards.find((a) => a.label === label);
    if (!entry) {
      // Artboard listed in the spec but missing from the manifest: treat as
      // no-reference rather than crash. Someone trimmed the manifest by hand.
      artboards.push({
        label,
        group: groupForLabel(label),
        referenceAbs: null,
        referenceRel: null,
        hasReference: false,
        flowFileBase: FLOW_BASENAME_BY_LABEL[label] ?? label.toLowerCase(),
        size: [1366, 1024],
      });
      continue;
    }
    const ok = entry.preview_status === 'ok' && entry.preview !== null;
    const referenceAbs = ok && entry.preview ? resolve(snapshotRoot, entry.preview) : null;
    const referenceRel = ok && entry.preview ? `../../design-snapshot/${entry.preview}` : null;
    artboards.push({
      label,
      group: groupForLabel(label),
      referenceAbs,
      referenceRel,
      hasReference: ok && referenceAbs !== null && existsSync(referenceAbs),
      flowFileBase: FLOW_BASENAME_BY_LABEL[label] ?? label.toLowerCase(),
      size: entry.size,
    });
  }

  // Snapshot version book-keeping (FR-10).
  const lastVersionFile = resolve(reportDir, '.last_snapshot_version');
  let previousSnapshotVersion: string | null = null;
  if (existsSync(lastVersionFile)) {
    try {
      previousSnapshotVersion = readFileSync(lastVersionFile, 'utf8').trim() || null;
    } catch {
      previousSnapshotVersion = null;
    }
  }
  const refChanged =
    previousSnapshotVersion !== null && previousSnapshotVersion !== manifest.snapshot_version;

  return {
    manifest,
    artboards,
    previousSnapshotVersion,
    refChanged,
    manifestPath,
    snapshotRoot,
  };
}

/**
 * Persist the current snapshot version so the next run can compute
 * `refChanged`. The file is gitignored alongside the rest of the report.
 */
export function persistSnapshotVersion(reportDir: string, version: string): void {
  const lastVersionFile = resolve(reportDir, '.last_snapshot_version');
  mkdirSync(dirname(lastVersionFile), { recursive: true });
  writeFileSync(lastVersionFile, `${version}\n`, 'utf8');
}
