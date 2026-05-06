/**
 * reportAssets.ts
 *
 * Inline CSS + JS for the self-contained `report/index.html`. Kept in a
 * separate module so report.ts stays under the 250-line cap.
 *
 * Raw-hex policy: design.md §5.2 carves out an exception for the report
 * generator's HTML output (the values MUST be inlined so the file opens
 * stand-alone without a stylesheet round-trip). The CI raw-hex guard does
 * not scan `apps/mobile/visual-verification/`.
 */

export const REPORT_STYLE = `
  :root {
    color-scheme: dark;
    --bg: #0b0d10;
    --surface: #14171c;
    --surface-2: #1c2127;
    --border: #2a3138;
    --text: #e7eaee;
    --text-dim: #98a0aa;
    --accent: #8b6cf3;
    --ok: #2ea968;
    --warn: #d49a2c;
    --alert: #d24c4c;
    --noref: #6b7280;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header.page { padding: 24px 28px; border-bottom: 1px solid var(--border); }
  header.page h1 { font-size: 20px; margin: 0 0 4px; font-weight: 600; }
  header.page .meta { color: var(--text-dim); font-size: 12px; display: flex; gap: 16px; flex-wrap: wrap; }
  .summary { padding: 14px 28px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; }
  .summary span { display: inline-flex; align-items: center; gap: 6px; }
  .summary .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
  .filter-bar { padding: 12px 28px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .filter-bar label { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; cursor: pointer; user-select: none; font-size: 12px; }
  .filter-bar input { display: none; }
  .filter-bar input:checked + span { color: var(--accent); }
  .filter-bar label:has(input:checked) { border-color: var(--accent); background: rgba(139,108,243,0.08); }
  main { padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; }
  .row { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .row-head { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .row-label { display: flex; align-items: center; gap: 10px; }
  .row-label .label { font-weight: 600; font-size: 14px; }
  .row-meta { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 12px; }
  .row-meta .ratio { font-variant-numeric: tabular-nums; color: var(--text); }
  .row-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px; background: var(--border); }
  .row-grid figure { margin: 0; padding: 8px; background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
  .row-grid figcaption { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .row-grid img { width: 100%; height: auto; border-radius: 4px; background: var(--bg); display: block; }
  .row-grid .missing { padding: 24px; text-align: center; color: var(--text-dim); border: 1px dashed var(--border); border-radius: 4px; }
  .row-error { padding: 10px 16px; border-top: 1px solid var(--border); color: var(--alert); font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .badge-ok { background: rgba(46,169,104,0.15); color: var(--ok); }
  .badge-warn { background: rgba(212,154,44,0.18); color: var(--warn); }
  .badge-alert { background: rgba(210,76,76,0.18); color: var(--alert); }
  .badge-noref { background: rgba(107,114,128,0.2); color: var(--noref); }
  .badge-error { background: rgba(210,76,76,0.18); color: var(--alert); }
  .ref-changed { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(139,108,243,0.18); color: var(--accent); font-weight: 600; }
  .link { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: var(--text-dim); }
  section.no-ref, section.errors, section.skipped { padding: 18px 28px; border-top: 1px solid var(--border); }
  section.no-ref h2, section.errors h2, section.skipped h2 { font-size: 14px; margin: 0 0 10px; }
  section ul { margin: 0; padding-left: 18px; color: var(--text-dim); font-size: 13px; }
  section.errors ul li { color: var(--alert); }
  body.f-splash main .row:not([data-group="Splash"]) { display: none; }
  body.f-pairing main .row:not([data-group="Pairing"]) { display: none; }
  body.f-servers main .row:not([data-group="Servers"]) { display: none; }
  body.f-documents main .row:not([data-group="Documents"]) { display: none; }
  body.f-editor main .row:not([data-group="Editor"]) { display: none; }
  body.f-settings main .row:not([data-group="Settings"]) { display: none; }
`;

export const REPORT_SCRIPT = `
  (function () {
    var groups = ['all','splash','pairing','servers','documents','editor','settings'];
    var bar = document.querySelector('.filter-bar');
    if (!bar) return;
    bar.addEventListener('change', function () {
      var inputs = bar.querySelectorAll('input[type=radio]:checked');
      var picked = inputs[0] && inputs[0].value || 'all';
      groups.forEach(function (g) { document.body.classList.remove('f-' + g); });
      if (picked !== 'all') document.body.classList.add('f-' + picked);
    });
  })();
`;

export const DEEP_LINK_BY_LABEL: Record<string, string> = {
  '01-Splash': 'diffusecraft://',
  '02-Pairing-mDNS': 'diffusecraft://pair',
  '02b-Pairing-QR': 'diffusecraft://pair/qr',
  '02c-Pairing-Code': 'diffusecraft://pair/code',
  '02d-Pairing-Manual': 'diffusecraft://pair/manual',
  '03-ServerPicker': 'diffusecraft://servers',
  '04-Documents': 'diffusecraft://documents',
  '05-Editor-Generate': 'diffusecraft://editor/mock-doc-1?workspace=generate',
  '05b-Editor-Inpaint': 'diffusecraft://editor/mock-doc-1?workspace=inpaint',
  '05c-Editor-Live': 'diffusecraft://editor/mock-doc-1?workspace=live',
  '05d-Editor-Chat-Open': 'diffusecraft://editor/mock-doc-1?chat=true',
  '06-Settings': 'diffusecraft://settings',
  '06a-Settings-Connection': 'diffusecraft://settings/connection',
};
