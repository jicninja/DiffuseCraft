#!/usr/bin/env tsx
/**
 * ComfyUI integration unit tests (B.5, C.3, F.3, G.8 partial, H.10/H.11
 * partial, J.5).
 *
 * Mocks the ComfyUI HTTP + WS surface in-process so the suite runs without
 * `ws` or a live ComfyUI install. The stand-in implements the subset of
 * endpoints `ComfyClient` actually calls (`/prompt`, `/queue`, `/interrupt`,
 * `/history`, `/object_info`, `/system_stats`, `/view`).
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/comfy.ts`.
 */
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

import { ComfyClient } from '../lib/comfy/client.js';
import { ComfyEventEmitter } from '../lib/comfy/events.js';
import {
  ComfyError,
  ComfyMissingNodesError,
  ComfyUnreachableError,
  ComfyValidationError,
} from '../lib/comfy/errors.js';
import { HealthMonitor } from '../lib/comfy/health.js';
import { ensureInstalled } from '../lib/comfy/managed/installer.js';
import { ModelDownloader } from '../lib/comfy/models/downloader.js';
import { ModelRegistry, extractAllNames } from '../lib/comfy/models/registry.js';
import { parseModelId } from '../lib/comfy/models/parsers/index.js';
import { REQUIRED_NODES } from '../lib/comfy/required-nodes.js';
import { isPinnedCommitPlaceholder } from '../lib/comfy/required-versions.js';
import { assertValid, formatMissingMessage, validateInstall } from '../lib/comfy/validation.js';
import { __setWsCtorForTests, ComfyWsTransport } from '../lib/comfy/ws.js';
import { buildGraph } from '../lib/comfy/graph/builder.js';
import { collectImages } from '../lib/comfy/output-fetcher.js';
import { planResolution } from '../lib/comfy/graph/helpers/resolution.js';
import { EventBus } from '../lib/events/bus.js';

// ---------------------------------------------------------------------------
// Silent logger (matches the helper used in pairing.ts).
// ---------------------------------------------------------------------------

const silentLogger: Logger = {
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
};

// ---------------------------------------------------------------------------
// Mock ComfyUI HTTP server (in-process, fetch-stub style).
// ---------------------------------------------------------------------------

interface MockServerState {
  next_prompt_id: number;
  /** Stub object_info response — defaults exclude required nodes. */
  object_info: Record<string, unknown>;
  /** Stub history responses, keyed by prompt_id. */
  history: Record<string, unknown>;
  /** Captured /prompt POST bodies for assertions. */
  submitted_graphs: unknown[];
  /** Counter for `/system_stats` calls. */
  health_calls: number;
  /** When set, /system_stats fails with the given error. */
  health_fail: { mode: 'timeout' | 'http-500' } | null;
  /** Captured /interrupt + /queue calls. */
  interrupts: number;
  dequeues: string[];
}

function makeState(overrides: Partial<MockServerState> = {}): MockServerState {
  return {
    next_prompt_id: 1,
    object_info: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model.safetensors'], {}] } } } },
    history: {},
    submitted_graphs: [],
    health_calls: 0,
    health_fail: null,
    interrupts: 0,
    dequeues: [],
    ...overrides,
  };
}

/** Drop-in replacement for global `fetch` that drives `MockServerState`. */
function makeMockFetch(state: MockServerState): typeof fetch {
  return async function mockFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    if (u.pathname === '/prompt' && method === 'POST') {
      state.submitted_graphs.push(JSON.parse(String(init?.body ?? '{}')));
      const prompt_id = `mock-${state.next_prompt_id++}`;
      return new Response(JSON.stringify({ prompt_id, number: 0 }), { status: 200 });
    }
    if (u.pathname === '/interrupt' && method === 'POST') {
      state.interrupts += 1;
      return new Response('{}', { status: 200 });
    }
    if (u.pathname === '/queue' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { delete?: string[] };
      for (const id of body.delete ?? []) state.dequeues.push(id);
      return new Response('{}', { status: 200 });
    }
    if (u.pathname === '/queue' && method === 'GET') {
      return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
    }
    if (u.pathname === '/object_info' && method === 'GET') {
      return new Response(JSON.stringify(state.object_info), { status: 200 });
    }
    if (u.pathname === '/system_stats' && method === 'GET') {
      state.health_calls += 1;
      if (state.health_fail?.mode === 'http-500') {
        return new Response('boom', { status: 500 });
      }
      if (state.health_fail?.mode === 'timeout') {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      return new Response(JSON.stringify({ system: { os: 'mock' } }), { status: 200 });
    }
    if (u.pathname.startsWith('/history/') && method === 'GET') {
      const id = u.pathname.slice('/history/'.length);
      return new Response(JSON.stringify({ [id]: state.history[id] ?? null }), { status: 200 });
    }
    if (u.pathname === '/view' && method === 'GET') {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  } as typeof fetch;
}

/** Inject every required-node class into a stub object_info catalog. */
function installAllRequiredClasses(state: MockServerState): void {
  for (const node of REQUIRED_NODES) {
    for (const cls of node.checks) {
      state.object_info[cls] = { input: { required: {} } };
    }
  }
}

// ---------------------------------------------------------------------------
// Mock WebSocket implementation. The transport's `__setWsCtorForTests` hook
// lets us inject this without monkey-patching the loader.
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  readyState: 0 | 1 | 2 | 3 = 0;
  constructor(public readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
    // Open asynchronously so callers can attach listeners first.
    setImmediate(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }
  override on(event: string, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    return this;
  }
  /** Simulate an inbound WS message. */
  push(msg: unknown): void {
    this.emit('message', JSON.stringify(msg));
  }
  /** Simulate the server closing the connection. */
  shutdown(code = 1011): void {
    this.readyState = 3;
    this.emit('close', code, Buffer.from('mock'));
  }
  close(): void {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from('shutdown'));
  }
}

// ---------------------------------------------------------------------------
// In-memory FakeDb shim — minimal subset for ModelRegistry + downloader path.
// ---------------------------------------------------------------------------

class FakeDb {
  models: Array<{
    id: string;
    name: string;
    type: string;
    file_path: string;
    size: number;
    integrity_hash: string | null;
  }> = [];
  open = true;
  inTransaction = false;
  pragma(): unknown { return null; }
  exec(sql: string): FakeDb {
    if (/^DELETE\s+FROM\s+models/i.test(sql.trim())) this.models = [];
    return this;
  }
  prepare(sql: string): unknown {
    const stmt = {
      run: (...params: unknown[]) => this.handleRun(sql, params),
      get: (...params: unknown[]) => this.handleGet(sql, params),
      all: (...params: unknown[]) => this.handleAll(sql, params),
      iterate: function* (): IterableIterator<unknown> { /* unused */ },
    };
    return stmt;
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => fn(...args)) as T;
  }
  close(): void { this.open = false; }
  private handleRun(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number } {
    const s = sql.trim();
    if (/^INSERT\s+INTO\s+models/i.test(s)) {
      const [id, name, type, file_path, size, integrity_hash] = params as [string, string, string, string, number, string | null];
      this.models.push({ id, name, type, file_path, size, integrity_hash });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^DELETE\s+FROM\s+models\s+WHERE\s+id\s*=/i.test(s)) {
      const [id] = params as [string];
      const before = this.models.length;
      this.models = this.models.filter((m) => m.id !== id);
      return { changes: before - this.models.length, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+models\s+SET/i.test(s)) {
      // We don't exercise updateMeta in the registry tests below.
      return { changes: 0, lastInsertRowid: 0 };
    }
    throw new Error(`fake-db.run: unhandled SQL: ${s}`);
  }
  private handleGet(sql: string, params: unknown[]): unknown {
    const s = sql.trim();
    if (/^SELECT[\s\S]+FROM\s+models\s+WHERE\s+name\s*=/i.test(s)) {
      const [name] = params as [string];
      return this.models.find((m) => m.name === name);
    }
    return undefined;
  }
  private handleAll(sql: string, params: unknown[]): unknown[] {
    const s = sql.trim();
    if (/^SELECT[\s\S]+FROM\s+models\s+WHERE\s+type\s*=/i.test(s)) {
      const [type] = params as [string];
      return this.models.filter((m) => m.type === type);
    }
    if (/^SELECT[\s\S]+FROM\s+models$/i.test(s)) {
      return [...this.models];
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- A/B.4: scaffolding + internal-only enforcement -----------------
  ['index.ts barrel never re-exports ComfyClient (FR-20 / B.4)', async () => {
    // FR-20 / B.4: ComfyClient is server-internal. The barrel surface is
    // the only public seam; `index.ts` must not export the class. We assert
    // by reading the barrel source — running it here would require the
    // peer deps, which aren't installed in this workspace per CLAUDE.md.
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const indexUrl = new URL('../index.ts', import.meta.url);
    const body = await fs.readFile(url.fileURLToPath(indexUrl), 'utf8');
    // Match any export form: `export { ComfyClient ... }`, `export *`, etc.
    assert.ok(
      !/\bexport\b[^;]*\bComfyClient\b/.test(body),
      'index.ts must not re-export ComfyClient (FR-20 / B.4 internal-only).',
    );
    // Same enforcement for `GraphSpec` — handlers read it through the
    // `JobTracker` accessor, never via the public surface.
    assert.ok(
      !/\bexport\b[^;]*\bGraphSpec\b/.test(body),
      'index.ts must not re-export GraphSpec (FR-20 / B.4 internal-only).',
    );
  }],
  ['REQUIRED_NODES has the four krita-ai-diffusion packages', () => {
    assert.equal(REQUIRED_NODES.length, 4);
    const names = REQUIRED_NODES.map((n) => n.name);
    assert.ok(names.includes('ControlNet preprocessors'));
    assert.ok(names.includes('IP-Adapter'));
    assert.ok(names.includes('Inpaint nodes'));
    assert.ok(names.includes('External tooling'));
    for (const node of REQUIRED_NODES) {
      assert.ok(node.checks.length > 0, `${node.name} must declare at least one check`);
      assert.ok(node.install_url.startsWith('https://'), `${node.name} install_url must be https`);
    }
  }],
  ['pinned commit hash is the placeholder until the release captain replaces it', () => {
    // The release-captain check guards managed-mode startup.
    assert.equal(isPinnedCommitPlaceholder(), true);
  }],

  // ---- B: ComfyClient HTTP --------------------------------------------
  ['ComfyClient.submitGraph returns prompt_id from /prompt', async () => {
    const state = makeState();
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state) },
    );
    const r = await client.submitGraph({ '1': { class_type: 'Noop', inputs: {} } });
    assert.equal(r.prompt_id, 'mock-1');
    assert.equal(r.queue_position, 0);
    assert.equal(state.submitted_graphs.length, 1);
  }],
  ['ComfyClient.submitGraph throws ComfyValidationError on 400', async () => {
    const state = makeState();
    state.next_prompt_id = -1; // forces the mock to skip /prompt's success branch
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      {
        fetch: (async () =>
          new Response(JSON.stringify({ node_errors: { '1': { errors: [{ message: 'bad' }] } } }), { status: 400 })) as typeof fetch,
      },
    );
    await assert.rejects(
      () => client.submitGraph({}),
      (err: unknown) => err instanceof ComfyValidationError,
    );
  }],
  ['ComfyClient.interrupt + dequeue post the right URLs', async () => {
    const state = makeState();
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state) },
    );
    await client.interrupt('mock-1');
    await client.dequeue('mock-2');
    assert.equal(state.interrupts, 1);
    assert.deepEqual(state.dequeues, ['mock-2']);
  }],
  ['ComfyClient.health throws ComfyUnreachableError on timeout', async () => {
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      {
        // Fast timeout so we don't hang the suite.
        request_timeout_ms: 50,
        fetch: ((_input: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              (err as { name: string }).name = 'AbortError';
              reject(err);
            });
          })) as typeof fetch,
      },
    );
    await assert.rejects(() => client.health(), (err: unknown) => err instanceof ComfyUnreachableError);
  }],

  // ---- C: validation --------------------------------------------------
  ['validateInstall reports missing required packages', async () => {
    const state = makeState();
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state) },
    );
    const result = await validateInstall(client);
    assert.equal(result.ok, false);
    assert.equal(result.missing?.length, REQUIRED_NODES.length);
    assert.match(result.message ?? '', /missing 4 required custom-node packages/);
  }],
  ['validateInstall passes when every node class is present', async () => {
    const state = makeState();
    installAllRequiredClasses(state);
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state) },
    );
    const result = await validateInstall(client);
    assert.equal(result.ok, true);
  }],
  ['assertValid throws ComfyMissingNodesError with package names', () => {
    assert.throws(
      () => assertValid({ ok: false, missing: REQUIRED_NODES, message: 'msg' }),
      (err: unknown) => err instanceof ComfyMissingNodesError && err.packages.length === 4,
    );
  }],
  ['formatMissingMessage lists every package on its own line', () => {
    const out = formatMissingMessage([REQUIRED_NODES[0]!]);
    assert.match(out, /ComfyUI is missing 1 required custom-node package/);
    assert.match(out, /ControlNet preprocessors/);
  }],

  // ---- D: managed install marker --------------------------------------
  ['ensureInstalled refuses to run while the pinned commit is the placeholder', async () => {
    const bus = new EventBus();
    await assert.rejects(
      () =>
        ensureInstalled({
          install_dir: '/tmp/diffusecraft-test-installer',
          bus,
          logger: silentLogger,
        }),
      (err: unknown) => err instanceof ComfyError && /placeholder/.test((err as Error).message),
    );
  }],

  // ---- F: health monitor ---------------------------------------------
  ['HealthMonitor flips to degraded after threshold consecutive failures', async () => {
    const bus = new EventBus();
    let received: string[] = [];
    bus.subscribe('comfyui.status', (p) => {
      received.push((p as { status: string }).status);
    });
    const state = makeState({ health_fail: { mode: 'http-500' } });
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state), request_timeout_ms: 100 },
    );
    const monitor = new HealthMonitor(client, bus, silentLogger, { failure_threshold: 2 });
    await monitor.probe();
    assert.equal(monitor.getStatus(), 'unknown');
    await monitor.probe();
    assert.equal(monitor.getStatus(), 'degraded');
    assert.deepEqual(received, ['degraded']);
    // Recover: stop failing, run another probe.
    state.health_fail = null;
    received = [];
    await monitor.probe();
    assert.equal(monitor.getStatus(), 'healthy');
    assert.deepEqual(received, ['healthy']);
  }],

  // ---- G: model parsers + registry -----------------------------------
  ['parseModelId(hf:) builds a huggingface URL', () => {
    const r = parseModelId('hf:owner/repo:weights.safetensors');
    assert.equal(r.registry, 'hf');
    assert.equal(r.url, 'https://huggingface.co/owner/repo/resolve/main/weights.safetensors');
  }],
  ['parseModelId(civitai:) requires numeric id', () => {
    const r = parseModelId('civitai:12345');
    assert.equal(r.registry, 'civitai');
    assert.match(r.url, /api\/download\/models\/12345$/);
    assert.throws(() => parseModelId('civitai:bad'));
  }],
  ['parseModelId(file:) requires absolute path', () => {
    const r = parseModelId('file:/abs/path/model.safetensors');
    assert.equal(r.registry, 'file');
    assert.throws(() => parseModelId('file:relative.safetensors'));
  }],
  ['parseModelId rejects unknown prefixes', () => {
    assert.throws(() => parseModelId('s3:bucket/file'));
  }],
  ['extractAllNames walks the loader map', () => {
    const out = extractAllNames({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a', 'b'], {}] } } },
      LoraLoader: { input: { required: { lora_name: [['lora.pt'], {}] } } },
    });
    const types = out.map(([t]) => t);
    assert.deepEqual(types.sort(), ['checkpoint', 'lora']);
  }],
  ['ModelRegistry.refresh persists names + can list / find them', async () => {
    const db = new FakeDb();
    const state = makeState();
    state.object_info = {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors'], {}] } } },
      LoraLoader: { input: { required: { lora_name: [['style.lora'], {}] } } },
    };
    const client = new ComfyClient(
      { mode: 'external-local', url: 'http://mock.test' },
      silentLogger,
      { fetch: makeMockFetch(state) },
    );
    const registry = new ModelRegistry(db as unknown as never);
    await registry.refresh(client);
    assert.equal(registry.list('checkpoint').length, 1);
    assert.equal(registry.findByName('style.lora')?.type, 'lora');
  }],
  ['ModelDownloader emits failure event on integrity mismatch', async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe('model.download.failed', () => {
      events.push('failed');
    });
    bus.subscribe('model.download.completed', () => {
      events.push('completed');
    });
    const downloader = new ModelDownloader(bus, silentLogger, {
      progress_throttle_ms: 0,
      // Deliver an empty body so the SHA does not match the expected hash.
      fetch: (async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '4' } })) as typeof fetch,
    });
    const tmpFile = `${process.env['TMPDIR'] ?? '/tmp'}/dc-comfy-test-${Date.now()}.bin`;
    await assert.rejects(
      () =>
        downloader.download({
          model_id: 'hf:owner/repo:weights.safetensors',
          target_path: tmpFile,
          sha256: 'deadbeef'.repeat(8), // bogus expected hash
        }),
    );
    assert.deepEqual(events, ['failed']);
  }],

  // ---- H: graph builders ---------------------------------------------
  ['buildGraph(generate) produces a valid 7-node txt2img scaffold', () => {
    const graph = buildGraph(
      'generate',
      { prompt: 'a red barn', batch_size: 2, seed: 42 },
      {
        job_id: 'job-1',
        document: { width: 1024, height: 1024 },
        preset: { model: 'sdxl.safetensors', sampler: 'dpmpp_2m', scheduler: 'karras', steps: 25, cfg: 7, loras: [], resolution_factor: 8 },
      },
    );
    const classes = Object.values(graph).map((n) => n.class_type);
    for (const required of [
      'CheckpointLoaderSimple',
      'CLIPTextEncode',
      'EmptyLatentImage',
      'KSampler',
      'VAEDecode',
      'SaveImage',
    ]) {
      assert.ok(classes.includes(required), `expected ${required} in generate graph`);
    }
    const save = Object.values(graph).find((n) => n.class_type === 'SaveImage');
    assert.match(String(save?.inputs['filename_prefix'] ?? ''), /^diffusecraft\/job-1$/);
  }],
  ['buildGraph(refine) requires source_image_blob_id', () => {
    assert.throws(() =>
      buildGraph('refine', { prompt: 'x' }, {
        job_id: 'j',
        document: { width: 512, height: 512 },
        preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
      }),
    );
  }],
  ['buildGraph(fill) requires selection_id', () => {
    assert.throws(() =>
      buildGraph('fill', { prompt: 'x', source_image_blob_id: 'b1' }, {
        job_id: 'j',
        document: { width: 512, height: 512 },
        preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
      }),
    );
  }],
  ['buildGraph(fill) emits the two-mask grow + feather pair (mask-system G.3)', () => {
    const graph = buildGraph(
      'fill',
      {
        prompt: 'fix the sky',
        source_image_blob_id: 'b1',
        selection_id: 'sel-blob-1',
        selection_mode: 'Fill',
      },
      {
        job_id: 'job-fill-1',
        document: { width: 1024, height: 1024 },
        preset: { model: 'sdxl.safetensors', sampler: 'dpmpp_2m', scheduler: 'karras', steps: 25, cfg: 7, loras: [], resolution_factor: 8 },
      },
    );
    const classes = Object.values(graph).map((n) => n.class_type);
    // Mask loader + 2 grow nodes + 2 feather nodes (one each per mask).
    assert.ok(classes.includes('ETN_LoadMaskBase64'), 'expected ETN_LoadMaskBase64');
    const grows = classes.filter((c) => c === 'INPAINT_GrowMask');
    const feathers = classes.filter((c) => c === 'INPAINT_FeatherMask');
    assert.equal(grows.length, 2, `expected 2 INPAINT_GrowMask nodes, got ${grows.length}`);
    assert.equal(feathers.length, 2, `expected 2 INPAINT_FeatherMask nodes, got ${feathers.length}`);
    // The denoise grow uses the submode's denoise_offset_px; blend grow uses 2x.
    const growNodes = Object.values(graph).filter((n) => n.class_type === 'INPAINT_GrowMask');
    const denoiseGrow = (growNodes[0]!.inputs['grow_px'] as number);
    const blendGrow = (growNodes[1]!.inputs['grow_px'] as number);
    // Fill submode default denoise_offset_px is 8, blend grow is 16.
    assert.equal(denoiseGrow, 8);
    assert.equal(blendGrow, 16);
  }],
  ['buildGraph(upscale) emits UpscaleModelLoader + ImageUpscaleWithModel', () => {
    const graph = buildGraph(
      'upscale',
      { prompt: '', source_image_blob_id: 'b1', factor: 2, upscaler_model: 'RealESRGAN_x4plus.pth' },
      {
        job_id: 'j',
        document: { width: 512, height: 512 },
        preset: { model: 'm', sampler: 's', scheduler: 'k', steps: 10, cfg: 5, loras: [], resolution_factor: 8 },
      },
    );
    const classes = Object.values(graph).map((n) => n.class_type);
    assert.ok(classes.includes('UpscaleModelLoader'));
    assert.ok(classes.includes('ImageUpscaleWithModel'));
  }],
  ['planResolution rounds to factor + flips hires_fix above 1.5x native', () => {
    const small = planResolution({ width: 1024, height: 1024, factor: 8 });
    assert.equal(small.hires_fix, false);
    const big = planResolution({ width: 2048, height: 2048, factor: 8 });
    assert.equal(big.hires_fix, true);
    const odd = planResolution({ width: 1023, height: 1023, factor: 8 });
    assert.equal(odd.width % 8, 0);
  }],

  // ---- I: output fetcher -----------------------------------------------
  ['collectImages walks the history outputs map', () => {
    const out = collectImages({
      outputs: {
        '5': { images: [{ filename: 'a.png', subfolder: 'sub', type: 'output' }] },
        '6': { images: [{ filename: 'b.png', subfolder: 'sub', type: 'output' }] },
        '7': {},
      },
    });
    assert.equal(out.length, 2);
    assert.equal(out[0]!.filename, 'a.png');
  }],

  // ---- B/J: WebSocket transport + reconnect ---------------------------
  ['ComfyWsTransport routes parsed events through ComfyEventEmitter', async () => {
    MockWebSocket.instances = [];
    __setWsCtorForTests(MockWebSocket as unknown as never);
    try {
      const events = new ComfyEventEmitter();
      const opens: number[] = [];
      const progresses: Array<{ step: number; max: number }> = [];
      events.on('open', () => {
        opens.push(1);
      });
      events.on('progress', (p) => {
        progresses.push({ step: p.step, max: p.max_steps });
      });
      const ws = new ComfyWsTransport('ws://mock.test/ws', events, silentLogger);
      await ws.start();
      // Wait one tick for setImmediate `open`.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(opens.length, 1);
      // Push a progress message the way ComfyUI would.
      MockWebSocket.instances[0]!.push({ type: 'progress', data: { prompt_id: 'p1', value: 5, max: 10 } });
      assert.equal(progresses.length, 1);
      assert.deepEqual(progresses[0], { step: 5, max: 10 });
      ws.stop();
    } finally {
      __setWsCtorForTests(null);
    }
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
    console.error(`\n${failed}/${cases.length} comfy test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} comfy test(s) passed.`);
  }
})();
