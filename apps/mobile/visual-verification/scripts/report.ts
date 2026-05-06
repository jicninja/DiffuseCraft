/**
 * report.ts
 *
 * Aggregates diff JSON sidecars into a self-contained `index.html` viewer.
 * No external CDN, no JS framework — vanilla HTML + a small inline <style> +
 * minimal vanilla JS for filter chips. CSS / JS / deep-link table live in
 * `reportAssets.ts` to keep this module under the 250-line cap.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DiffResult } from './diff';
import { NO_REFERENCE_ROUTES, type NormalisedArtboard } from './manifest';
import { DEEP_LINK_BY_LABEL, REPORT_SCRIPT, REPORT_STYLE } from './reportAssets';

export interface ReportOptions {
  reportDir: string;
  artboards: NormalisedArtboard[];
  results: DiffResult[];
  /** Artboards that were skipped because they had no baseline (FR-7). */
  skipped: NormalisedArtboard[];
  /** Infra failures (Maestro crash, missing capture, diff tool error). */
  errors: Array<{ artboard: string; message: string }>;
  snapshotVersion: string;
  previousSnapshotVersion: string | null;
  refChanged: boolean;
  runTimestamp: string;
  gitSha: string | null;
  thresholds: { warn: number; alert: number };
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function badgeFor(r: DiffResult): { label: string; cls: string } {
  if (r.no_reference) return { label: 'no ref', cls: 'badge-noref' };
  if (r.error) return { label: 'error', cls: 'badge-error' };
  if (r.status === 'alert') return { label: 'alert', cls: 'badge-alert' };
  if (r.status === 'warn') return { label: 'warn', cls: 'badge-warn' };
  return { label: 'ok', cls: 'badge-ok' };
}

function toRel(reportDir: string, target: string): string {
  if (!target.startsWith('/')) return target;
  const dir = reportDir.endsWith('/') ? reportDir : `${reportDir}/`;
  return target.startsWith(dir) ? target.slice(dir.length) : target;
}

function renderRow(
  art: NormalisedArtboard,
  result: DiffResult | undefined,
  reportDir: string,
): string {
  const deepLink = DEEP_LINK_BY_LABEL[art.label] ?? '';
  const refSrc = art.referenceRel ?? '';
  const captureSrc = result ? toRel(reportDir, result.capture) : '';
  const diffSrc = result ? toRel(reportDir, result.diff) : '';
  const ratio = result ? pct(result.ratio) : '—';
  const badge = result ? badgeFor(result) : { label: 'pending', cls: 'badge-error' };
  const refChangedTag = result?.ref_changed
    ? '<span class="ref-changed" title="Snapshot baseline changed this run">ref ↻</span>'
    : '';
  const errorBlock = result?.error
    ? `<div class="row-error">${htmlEscape(result.error)}</div>`
    : '';
  const refImg = refSrc
    ? `<img loading="lazy" src="${htmlEscape(refSrc)}" alt="reference ${htmlEscape(art.label)}">`
    : '<div class="missing">no reference</div>';
  const capImg = captureSrc
    ? `<img loading="lazy" src="${htmlEscape(captureSrc)}" alt="capture ${htmlEscape(art.label)}">`
    : '<div class="missing">no capture</div>';
  const diffImg = diffSrc
    ? `<img loading="lazy" src="${htmlEscape(diffSrc)}" alt="diff ${htmlEscape(art.label)}">`
    : '<div class="missing">no diff</div>';
  return `
    <article class="row" data-group="${htmlEscape(art.group)}" data-status="${htmlEscape(badge.label)}">
      <header class="row-head">
        <div class="row-label">
          <span class="label">${htmlEscape(art.label)}</span>
          <span class="badge ${badge.cls}">${htmlEscape(badge.label)}</span>
          ${refChangedTag}
        </div>
        <div class="row-meta">
          <span class="ratio">${ratio}</span>
          <code class="link">${htmlEscape(deepLink)}</code>
        </div>
      </header>
      <div class="row-grid">
        <figure><figcaption>reference</figcaption>${refImg}</figure>
        <figure><figcaption>capture</figcaption>${capImg}</figure>
        <figure><figcaption>diff</figcaption>${diffImg}</figure>
      </div>
      ${errorBlock}
    </article>
  `;
}

function renderSkipped(skipped: NormalisedArtboard[]): string {
  if (!skipped.length) return '';
  const items = skipped
    .map(
      (a) =>
        `<li>${htmlEscape(a.label)} <code class="link">${htmlEscape(DEEP_LINK_BY_LABEL[a.label] ?? '')}</code></li>`,
    )
    .join('');
  return `<section class="skipped"><h2>Snapshot exports failed (${skipped.length})</h2>
    <ul>${items}</ul>
    <p style="font-size:12px;color:var(--text-dim);margin-top:8px;">Re-run <code>tools/snapshot-pen.ts</code> after the .pen exports succeed.</p>
  </section>`;
}

function renderNoRef(): string {
  const items = NO_REFERENCE_ROUTES.map(
    (r) =>
      `<li>${htmlEscape(r.route)} — <code class="link">${htmlEscape(r.deepLink)}</code> (${htmlEscape(r.reason)})</li>`,
  ).join('');
  return `<section class="no-ref"><h2>No-reference routes (${NO_REFERENCE_ROUTES.length})</h2><ul>${items}</ul></section>`;
}

function renderErrors(errors: ReportOptions['errors']): string {
  if (!errors.length) return '';
  const items = errors
    .map((e) => `<li><strong>${htmlEscape(e.artboard)}:</strong> ${htmlEscape(e.message)}</li>`)
    .join('');
  return `<section class="errors"><h2>Errors (${errors.length})</h2><ul>${items}</ul></section>`;
}

function summarise(results: DiffResult[], skipped: NormalisedArtboard[], errors: ReportOptions['errors']) {
  const counts = {
    passed: 0,
    warn: 0,
    alert: 0,
    noRef: skipped.length + NO_REFERENCE_ROUTES.length,
    refChanged: 0,
    errors: errors.length,
  };
  for (const r of results) {
    if (r.error || r.no_reference) continue;
    if (r.ref_changed) counts.refChanged += 1;
    if (r.status === 'ok') counts.passed += 1;
    else if (r.status === 'warn') counts.warn += 1;
    else counts.alert += 1;
  }
  return counts;
}

/**
 * Generate the aggregated HTML report. Returns the HTML string and writes it
 * to `<reportDir>/index.html`.
 */
export function generateReport(opts: ReportOptions): string {
  const { artboards, results, skipped, errors, thresholds } = opts;
  const byLabel = new Map(results.map((r) => [r.artboard, r]));
  const counts = summarise(results, skipped, errors);
  const rowsHtml = artboards
    .filter((a) => a.hasReference)
    .map((a) => renderRow(a, byLabel.get(a.label), opts.reportDir))
    .join('');
  const refBanner = opts.refChanged
    ? `<div style="background:rgba(139,108,243,0.12);padding:10px 28px;font-size:13px;color:var(--accent);">Snapshot baseline changed (was ${htmlEscape(opts.previousSnapshotVersion ?? '—')}, now ${htmlEscape(opts.snapshotVersion)}) — diffs expected this run.</div>`
    : '';

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DiffuseCraft visual verification — ${htmlEscape(opts.runTimestamp)}</title>
  <style>${REPORT_STYLE}</style>
</head>
<body>
  <header class="page">
    <h1>Visual Verification Report</h1>
    <div class="meta">
      <span>snapshot_version: <strong>${htmlEscape(opts.snapshotVersion)}</strong></span>
      <span>run: ${htmlEscape(opts.runTimestamp)}</span>
      <span>git: ${htmlEscape(opts.gitSha ?? 'n/a')}</span>
      <span>thresholds: warn ${pct(thresholds.warn)} · alert ${pct(thresholds.alert)}</span>
      <span>screens: ${artboards.filter((a) => a.hasReference).length}</span>
    </div>
  </header>
  ${refBanner}
  <div class="summary">
    <span><span class="dot" style="background:var(--ok)"></span>${counts.passed} passed</span>
    <span><span class="dot" style="background:var(--warn)"></span>${counts.warn} warn</span>
    <span><span class="dot" style="background:var(--alert)"></span>${counts.alert} alert</span>
    <span><span class="dot" style="background:var(--noref)"></span>${counts.noRef} no-reference</span>
    <span><span class="dot" style="background:var(--accent)"></span>${counts.refChanged} ref-changed</span>
    <span><span class="dot" style="background:var(--alert)"></span>${counts.errors} errors</span>
  </div>
  <nav class="filter-bar">
    <label><input type="radio" name="filter" value="all" checked><span>All</span></label>
    <label><input type="radio" name="filter" value="splash"><span>Splash</span></label>
    <label><input type="radio" name="filter" value="pairing"><span>Pairing</span></label>
    <label><input type="radio" name="filter" value="servers"><span>Servers</span></label>
    <label><input type="radio" name="filter" value="documents"><span>Documents</span></label>
    <label><input type="radio" name="filter" value="editor"><span>Editor</span></label>
    <label><input type="radio" name="filter" value="settings"><span>Settings</span></label>
  </nav>
  <main>${rowsHtml}</main>
  ${renderSkipped(skipped)}
  ${renderNoRef()}
  ${renderErrors(errors)}
  <script>${REPORT_SCRIPT}</script>
</body>
</html>`;

  const indexPath = resolve(opts.reportDir, 'index.html');
  mkdirSync(opts.reportDir, { recursive: true });
  writeFileSync(indexPath, body, 'utf8');
  return body;
}

/**
 * Convenience helper: load every `<artboard>.diff.json` sidecar from a
 * directory. Used by the orchestrator and ad-hoc tooling that re-renders
 * the index without re-running Maestro.
 */
export function loadResultsFromSidecars(reportDir: string): DiffResult[] {
  if (!existsSync(reportDir)) return [];
  const out: DiffResult[] = [];
  for (const name of readdirSync(reportDir)) {
    if (!name.endsWith('.diff.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(resolve(reportDir, name), 'utf8')) as DiffResult);
    } catch {
      // Skip malformed sidecars; they regenerate next run.
    }
  }
  return out;
}
