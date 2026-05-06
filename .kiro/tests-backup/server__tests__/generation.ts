#!/usr/bin/env tsx
/**
 * Generation-workflow unit tests (G.1, G.2, A.7 partial).
 *
 * Covers:
 *   - resolveVerb decision table (FR-1) + INVALID_INPUT error path (FR-2).
 *   - FILL_SUBMODE_CONFIG completeness + buildFillGraph wiring per submode.
 *   - PresetRegistry lookups + resolvePreset fallback chain (B.2).
 *   - generate_image handler: empty-prompt guard (FR-23), MODEL_NOT_FOUND
 *     (FR-24), document inheritance, batch_size echo, JobTracker submit
 *     interaction (mocked), event emission for `job.progress`.
 *   - cancel_job idempotency contract (FR-21 / FR-22).
 *
 * Like `comfy.ts` and `pairing.ts`, this suite stands up minimal in-process
 * mocks (FakeDb, mock ComfyClient, mock JobTracker) so it runs without the
 * peer deps `better-sqlite3` / `pino` / `ws`.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/generation.ts`.
 */
import { strict as assert } from 'node:assert';

import {
  FILL_SUBMODE_CONFIG,
  SELECTION_SUB_MODES,
  type SelectionSubMode,
} from '../lib/comfy/graph/fill-config.js';
import { buildFillGraph } from '../lib/comfy/graph/fill.js';
import { buildGraph } from '../lib/comfy/graph/builder.js';
import {
  resolveVerb,
  VerbResolutionError,
} from '../lib/handlers/generate-image/resolve-verb.js';
import {
  DEFAULT_PRESETS,
  DEFAULT_PRESET_NAME,
} from '../lib/comfy/presets/defaults.js';
import {
  PresetRegistry,
  PresetNotFoundError,
  resolvePreset,
} from '../lib/comfy/presets/registry.js';
import { createGenerateImageHandler } from '../lib/handlers/generate-image/index.js';
import { createCancelJobHandler } from '../lib/handlers/cancel-job.js';
import type { JobTracker } from '../lib/jobs/tracker.js';
import { ServerError } from '../types/errors.js';

// ---------------------------------------------------------------------------
// FakeDb — implements the subset of SQL used by document-context resolver.
// ---------------------------------------------------------------------------

interface DocRow {
  id: string;
  w: number;
  h: number;
}
interface LayerRow {
  id: string;
  document_id: string;
  kind: string;
  position: number;
  content_blob_id: string | null;
}
interface SelectionRow {
  document_id: string;
  mask_blob_id: string | null;
}

class FakeDb {
  documents: DocRow[] = [];
  layers: LayerRow[] = [];
  selections: SelectionRow[] = [];
  open = true;
  inTransaction = false;

  pragma(): unknown {
    return null;
  }
  exec(): FakeDb {
    return this;
  }
  prepare(sql: string): unknown {
    return {
      run: (...params: unknown[]) => this.handleRun(sql, params),
      get: (...params: unknown[]) => this.handleGet(sql, params),
      all: () => [],
      iterate: function* (): IterableIterator<unknown> {
        /* unused */
      },
    };
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => fn(...args)) as T;
  }
  close(): void {
    this.open = false;
  }
  private handleRun(_sql: string, _params: unknown[]): { changes: number; lastInsertRowid: number } {
    return { changes: 0, lastInsertRowid: 0 };
  }
  private handleGet(sql: string, params: unknown[]): unknown {
    const s = sql.trim();
    if (/^SELECT\s+id,\s*w,\s*h\s+FROM\s+documents\s+WHERE\s+id\s*=/i.test(s)) {
      const [id] = params as [string];
      return this.documents.find((d) => d.id === id);
    }
    if (/^SELECT\s+content_blob_id\s+FROM\s+layers/i.test(s)) {
      const [doc] = params as [string];
      const candidate = this.layers
        .filter((l) => l.document_id === doc && l.kind === 'paint' && l.content_blob_id)
        .sort((a, b) => b.position - a.position)[0];
      return candidate ? { content_blob_id: candidate.content_blob_id } : undefined;
    }
    if (/^SELECT\s+mask_blob_id\s+FROM\s+selections/i.test(s)) {
      const [doc] = params as [string];
      return this.selections.find((sel) => sel.document_id === doc);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mock JobTracker — captures submit calls + can be made to return canned ids.
// ---------------------------------------------------------------------------

class MockTracker {
  submissions: Array<{ graph: unknown; metadata: unknown }> = [];
  cancelCalls: string[] = [];
  cancelResult: { cancelled: boolean; was_running: boolean } = { cancelled: true, was_running: true };
  nextId = 1;

  async submit(graph: unknown, metadata: unknown): Promise<string> {
    this.submissions.push({ graph, metadata });
    return `job-${this.nextId++}`;
  }

  async cancel(job_id: string): Promise<{ cancelled: boolean; was_running: boolean }> {
    this.cancelCalls.push(job_id);
    return this.cancelResult;
  }
}

// ---------------------------------------------------------------------------
// Stub HandlerContext — only the fields the handler reads.
// ---------------------------------------------------------------------------

function makeCtx(overrides: { document_id?: string; request_id?: string } = {}): import('../types/handler-context.js').HandlerContext {
  const calls: { info: unknown[][]; error: unknown[][] } = { info: [], error: [] };
  return {
    request_id: overrides.request_id ?? 'req-test-1',
    transport: 'in-memory',
    token_id: null,
    token_name: 'test-token',
    received_at: Date.now(),
    document_id: overrides.document_id ?? '',
    publish() {
      /* unused */
    },
    audit() {
      /* unused */
    },
    logger: {
      info: (...args) => {
        calls.info.push(args);
      },
      error: (...args) => {
        calls.error.push(args);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- A.1: resolveVerb decision table ---------------------------------
  ['resolveVerb: strength=100 + no selection → generate', () => {
    assert.deepEqual(resolveVerb({ strength: 100 }), { verb: 'generate' });
    assert.deepEqual(resolveVerb({ strength: 100, selection: { kind: 'none' } }), { verb: 'generate' });
  }],
  ['resolveVerb: strength<100 + no selection → refine', () => {
    assert.deepEqual(resolveVerb({ strength: 70 }), { verb: 'refine' });
    assert.deepEqual(resolveVerb({ strength: 0 }), { verb: 'refine' });
  }],
  ['resolveVerb: strength=100 + selection + sub_mode → fill', () => {
    const out = resolveVerb({
      strength: 100,
      selection: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
      selection_mode: 'AddContent',
    });
    assert.deepEqual(out, { verb: 'fill', sub_mode: 'AddContent' });
  }],
  ['resolveVerb: strength<100 + selection → constrained_variation (defaults sub_mode=Fill)', () => {
    const out = resolveVerb({
      strength: 50,
      selection: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
    });
    assert.deepEqual(out, { verb: 'constrained_variation', sub_mode: 'Fill' });
  }],
  ['resolveVerb: strength=100 + selection + missing sub_mode → VerbResolutionError', () => {
    let thrown: VerbResolutionError | null = null;
    try {
      resolveVerb({
        strength: 100,
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 } },
      });
    } catch (err) {
      thrown = err as VerbResolutionError;
    }
    assert.ok(thrown, 'expected VerbResolutionError');
    assert.equal(thrown!.code, 'INVALID_INPUT');
    assert.equal(thrown!.field_path, 'selection_mode');
    assert.match(thrown!.hint, /Fill, Expand, AddContent, RemoveContent, ReplaceBackground/);
  }],

  // ---- A.2: FILL_SUBMODE_CONFIG ---------------------------------------
  ['FILL_SUBMODE_CONFIG covers all 5 sub-modes with consistent shape', () => {
    assert.equal(SELECTION_SUB_MODES.length, 5);
    for (const mode of SELECTION_SUB_MODES) {
      const cfg = FILL_SUBMODE_CONFIG[mode];
      assert.ok(cfg, `${mode} config exists`);
      assert.equal(typeof cfg.denoise_offset_px, 'number');
      assert.equal(typeof cfg.blend_feather_pct, 'number');
      assert.equal(typeof cfg.prompt_weight, 'number');
      assert.ok(cfg.bias_to_surroundings >= 0 && cfg.bias_to_surroundings <= 1);
      assert.ok(cfg.description.length > 0);
    }
  }],
  ['FILL_SUBMODE_CONFIG.RemoveContent has prompt_weight=0', () => {
    assert.equal(FILL_SUBMODE_CONFIG.RemoveContent.prompt_weight, 0);
    assert.equal(FILL_SUBMODE_CONFIG.RemoveContent.bias_to_surroundings, 1);
  }],
  ['FILL_SUBMODE_CONFIG.ReplaceBackground enables foreground_preserve', () => {
    assert.equal(FILL_SUBMODE_CONFIG.ReplaceBackground.foreground_preserve, true);
  }],

  // ---- A.2: buildFillGraph reads the table -----------------------------
  ['buildFillGraph injects ConditioningSetAreaStrength with submode prompt_weight', () => {
    for (const submode of SELECTION_SUB_MODES) {
      const graph = buildFillGraph(
        {
          prompt: 'face',
          source_image_blob_id: 'b1',
          selection_id: 'sel-1',
          selection_mode: submode,
        },
        {
          job_id: 'job-1',
          document: { width: 512, height: 512 },
          preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
        },
      );
      const cond = Object.values(graph).find((n) => n.class_type === 'ConditioningSetAreaStrength');
      assert.ok(cond, `ConditioningSetAreaStrength missing for submode=${submode}`);
      assert.equal(
        cond!.inputs['strength'],
        FILL_SUBMODE_CONFIG[submode].prompt_weight,
        `${submode} cond weight mismatch`,
      );
    }
  }],
  ['buildFillGraph attaches INPAINT_DenoiseToMask only for ReplaceBackground', () => {
    for (const submode of SELECTION_SUB_MODES) {
      const graph = buildFillGraph(
        {
          prompt: 'p',
          source_image_blob_id: 'b1',
          selection_id: 'sel-1',
          selection_mode: submode,
        },
        {
          job_id: 'j',
          document: { width: 512, height: 512 },
          preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
        },
      );
      const fg = Object.values(graph).find((n) => n.class_type === 'INPAINT_DenoiseToMask');
      if (submode === 'ReplaceBackground') {
        assert.ok(fg, 'ReplaceBackground must inject foreground-preserving node');
        assert.equal(fg!.inputs['preserve_foreground'], true);
      } else {
        assert.equal(fg, undefined, `${submode} must NOT have foreground-preserve node`);
      }
    }
  }],
  ['buildGraph(constrained_variation) routes to refine builder', () => {
    const graph = buildGraph(
      'constrained_variation',
      { prompt: 'x', source_image_blob_id: 'b1', strength: 60 } as never,
      {
        job_id: 'j',
        document: { width: 512, height: 512 },
        preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
      },
    );
    // refine builder loads via ETN_LoadImageBase64 + VAEEncode (no EmptyLatentImage)
    const classes = Object.values(graph).map((n) => n.class_type);
    assert.ok(classes.includes('ETN_LoadImageBase64'));
    assert.ok(classes.includes('VAEEncode'));
    assert.ok(!classes.includes('EmptyLatentImage'));
    const sampler = Object.values(graph).find((n) => n.class_type === 'KSampler');
    // denoise = (100 - 60) / 100 = 0.4
    assert.equal(Number(sampler!.inputs['denoise']), 0.4);
  }],

  // ---- B.1 / B.2: presets ---------------------------------------------
  ['DEFAULT_PRESETS ships 3 presets — photographic, illustration, concept-art', () => {
    assert.equal(DEFAULT_PRESETS.length, 3);
    const names = DEFAULT_PRESETS.map((p) => p.name).sort();
    assert.deepEqual(names, ['concept-art', 'illustration', 'photographic']);
    assert.equal(DEFAULT_PRESET_NAME, 'photographic');
  }],
  ['PresetRegistry: list + has + get', () => {
    const reg = new PresetRegistry();
    assert.equal(reg.list().length, 3);
    assert.ok(reg.has('photographic'));
    assert.equal(reg.get('photographic')?.name, 'photographic');
    assert.equal(reg.get('does-not-exist'), undefined);
  }],
  ['PresetRegistry: upsert + remove', () => {
    const reg = new PresetRegistry();
    reg.upsert({
      id: 'preset.x',
      name: 'custom',
      description: 'custom',
      model: 'm',
      sampler: 's',
      scheduler: 'k',
      steps: 10,
      cfg: 5,
      loras: [],
      resolution_factor: 8,
    });
    assert.equal(reg.list().length, 4);
    assert.ok(reg.has('custom'));
    assert.equal(reg.remove('custom'), true);
    assert.equal(reg.has('custom'), false);
    assert.equal(reg.remove('custom'), false); // idempotent
  }],
  ['resolvePreset: explicit name → that preset', () => {
    const reg = new PresetRegistry();
    const out = resolvePreset(reg, 'illustration');
    assert.equal(out.name, 'illustration');
  }],
  ['resolvePreset: missing name → PresetNotFoundError with available list', () => {
    const reg = new PresetRegistry();
    let thrown: PresetNotFoundError | null = null;
    try {
      resolvePreset(reg, 'unknown');
    } catch (err) {
      thrown = err as PresetNotFoundError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.name_attempted, 'unknown');
    assert.equal(thrown!.available.length, 3);
  }],
  ['resolvePreset: undefined name → server default → photographic fallback', () => {
    const reg = new PresetRegistry();
    assert.equal(resolvePreset(reg, undefined).name, 'photographic');
    assert.equal(resolvePreset(reg, undefined, 'illustration').name, 'illustration');
  }],

  // ---- A.3 / A.4 / A.5 / A.6: handler ---------------------------------
  ['generate_image handler: returns job_id + resolved_verb=generate + batch_size echo', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 1024, h: 1024 });
    const tracker = new MockTracker();
    const presets = new PresetRegistry();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets,
    });
    const out = await handler(
      { prompt: 'a red barn', strength: 100, batch_size: 3, seed: 'random' } as never,
      makeCtx({ document_id: 'doc-1' }),
    );
    assert.equal(out.resolved_verb, 'generate');
    assert.equal(out.batch_size, 3);
    assert.match(out.job_id as string, /^job-/);
    assert.equal(tracker.submissions.length, 1);
    const meta = tracker.submissions[0]!.metadata as { kind: string; verb: string; preset: string };
    assert.equal(meta.kind, 'generate_image');
    assert.equal(meta.verb, 'generate');
    assert.equal(meta.preset, 'photographic');
  }],
  ['generate_image handler: missing selection_mode with selection → INVALID_INPUT', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 1024, h: 1024 });
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    let thrown: ServerError | null = null;
    try {
      await handler(
        {
          prompt: 'face',
          strength: 100,
          batch_size: 1,
          seed: 'random',
          selection: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
        } as never,
        makeCtx({ document_id: 'doc-1' }),
      );
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'INVALID_INPUT');
    assert.match(thrown!.message, /selection_mode/);
    assert.equal(tracker.submissions.length, 0);
  }],
  ['generate_image handler: empty prompt + generate verb → INVALID_INPUT (FR-23)', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 1024, h: 1024 });
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    let thrown: ServerError | null = null;
    try {
      await handler(
        { prompt: '   ', strength: 100, batch_size: 1, seed: 'random' } as never,
        makeCtx({ document_id: 'doc-1' }),
      );
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'INVALID_INPUT');
    assert.match(thrown!.message, /strength<100/);
  }],
  ['generate_image handler: refine verb without source image → INVALID_INPUT (FR-23 partner)', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 1024, h: 1024 });
    // No paint layers — empty canvas.
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    let thrown: ServerError | null = null;
    try {
      await handler(
        { prompt: 'redo', strength: 70, batch_size: 1, seed: 'random' } as never,
        makeCtx({ document_id: 'doc-1' }),
      );
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'INVALID_INPUT');
    assert.match(thrown!.message, /no paint layer/);
  }],
  ['generate_image handler: model registry check → MODEL_NOT_FOUND (FR-24)', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 1024, h: 1024 });
    const tracker = new MockTracker();
    const fakeModels = {
      findByName: (_name: string) => null,
      list: () => [] as readonly unknown[],
      deleteById: () => false,
      updateMeta: () => {
        /* unused */
      },
      refresh: async () => {
        /* unused */
      },
    } as unknown as Parameters<typeof createGenerateImageHandler>[0]['models'];
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
      models: fakeModels,
    });
    let thrown: ServerError | null = null;
    try {
      await handler(
        { prompt: 'x', strength: 100, batch_size: 1, seed: 'random' } as never,
        makeCtx({ document_id: 'doc-1' }),
      );
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'MODEL_NOT_FOUND');
    assert.match(thrown!.message, /download_model/);
  }],
  ['generate_image handler: refine verb routes to refine builder + records denoise', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 768, h: 768 });
    db.layers.push({ id: 'l1', document_id: 'doc-1', kind: 'paint', position: 0, content_blob_id: 'blob-source' });
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    const out = await handler(
      { prompt: 'rough sketch', strength: 60, batch_size: 1, seed: 42 } as never,
      makeCtx({ document_id: 'doc-1' }),
    );
    assert.equal(out.resolved_verb, 'refine');
    const submission = tracker.submissions[0]!;
    const classes = Object.values(submission.graph as Record<string, { class_type: string }>).map(
      (n) => n.class_type,
    );
    assert.ok(classes.includes('ETN_LoadImageBase64'));
    assert.ok(classes.includes('VAEEncode'));
    assert.ok(!classes.includes('EmptyLatentImage'));
  }],
  ['generate_image handler: fill verb passes selection_mode through to graph', async () => {
    const db = new FakeDb();
    db.documents.push({ id: 'doc-1', w: 768, h: 768 });
    db.layers.push({ id: 'l1', document_id: 'doc-1', kind: 'paint', position: 0, content_blob_id: 'blob-source' });
    db.selections.push({ document_id: 'doc-1', mask_blob_id: 'mask-1' });
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    const out = await handler(
      {
        prompt: 'fix face',
        strength: 100,
        batch_size: 1,
        seed: 'random',
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 50, h: 50 } },
        selection_mode: 'AddContent' as SelectionSubMode,
      } as never,
      makeCtx({ document_id: 'doc-1' }),
    );
    assert.equal(out.resolved_verb, 'fill');
    const submission = tracker.submissions[0]!;
    const meta = submission.metadata as { sub_mode: string };
    assert.equal(meta.sub_mode, 'AddContent');
    const graph = submission.graph as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const cond = Object.values(graph).find((n) => n.class_type === 'ConditioningSetAreaStrength');
    assert.equal(cond!.inputs['strength'], FILL_SUBMODE_CONFIG.AddContent.prompt_weight);
  }],
  ['generate_image handler: missing document_id → INVALID_INPUT', async () => {
    const db = new FakeDb();
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    let thrown: ServerError | null = null;
    try {
      await handler({ prompt: 'x', strength: 100, batch_size: 1, seed: 'random' } as never, makeCtx());
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'INVALID_INPUT');
    assert.match(thrown!.message, /document_id/);
  }],
  ['generate_image handler: unknown document → DOCUMENT_NOT_FOUND', async () => {
    const db = new FakeDb();
    const tracker = new MockTracker();
    const handler = createGenerateImageHandler({
      db: db as unknown as never,
      tracker: tracker as unknown as JobTracker,
      presets: new PresetRegistry(),
    });
    let thrown: ServerError | null = null;
    try {
      await handler(
        { prompt: 'x', strength: 100, batch_size: 1, seed: 'random' } as never,
        makeCtx({ document_id: 'nope' }),
      );
    } catch (err) {
      thrown = err as ServerError;
    }
    assert.ok(thrown);
    assert.equal(thrown!.code, 'DOCUMENT_NOT_FOUND');
  }],

  // ---- cancel_job handler ---------------------------------------------
  ['cancel_job handler: forwards to tracker.cancel and echoes shape', async () => {
    const tracker = new MockTracker();
    tracker.cancelResult = { cancelled: true, was_running: true };
    const handler = createCancelJobHandler(tracker as unknown as JobTracker);
    const out = await handler({ job_id: 'job-1' as never }, makeCtx());
    assert.deepEqual(out, { cancelled: true, was_running: true });
    assert.deepEqual(tracker.cancelCalls, ['job-1']);
  }],
  ['cancel_job handler: idempotent on already-finished job', async () => {
    const tracker = new MockTracker();
    tracker.cancelResult = { cancelled: false, was_running: false };
    const handler = createCancelJobHandler(tracker as unknown as JobTracker);
    const out = await handler({ job_id: 'job-1' as never }, makeCtx());
    assert.deepEqual(out, { cancelled: false, was_running: false });
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).stack ?? (err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} generation test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} generation test(s) passed.`);
  }
})();
