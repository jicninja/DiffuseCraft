#!/usr/bin/env tsx
/**
 * Standalone runner for the @diffusecraft/core store tests.
 *
 * Mirrors the pattern in `libs/mcp-tools/src/__tests__/run-tests.ts`. Each
 * case is a synchronous-or-async function that throws on failure. Exits
 * non-zero on the first failed case.
 *
 * Run via: `pnpm -F @diffusecraft/core test`.
 */
import { strict as assert } from 'node:assert';

import {
  buildPersistOptions,
  createConnectionStore,
  createEditorStore,
  createHistoryStore,
  createJobsStore,
  createMcpCatalogStore,
  createMemorySecureTokenAdapter,
  createMemoryStorage,
  createModelsStore,
  PERSISTENCE_SCHEMA_VERSION,
  runOptimistic,
  tokenKey,
  type DiffuseCraftClientLike,
  type ServerEvent,
} from '../index';

type Case = [name: string, run: () => void | Promise<void>];

// ----- Helpers -----

function makeMockClient(): DiffuseCraftClientLike & {
  emit(event: ServerEvent): void;
} {
  const handlers = new Set<(e: ServerEvent) => void>();
  return {
    events: {
      subscribe: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    invokeTool: async <TArgs, TResult>(_name: string, _args: TArgs) => {
      return undefined as unknown as TResult;
    },
    emit: (event) => {
      for (const h of handlers) h(event);
    },
  };
}

const cases: Case[] = [
  // ---- Phase A ----
  [
    'PERSISTENCE_SCHEMA_VERSION is a positive integer',
    () => {
      assert.equal(typeof PERSISTENCE_SCHEMA_VERSION, 'number');
      assert.ok(PERSISTENCE_SCHEMA_VERSION >= 1);
    },
  ],
  [
    'buildPersistOptions returns expected name + version',
    () => {
      const opts = buildPersistOptions<{ a: number }, { a: number }>({
        name: 'connection',
        partialize: (s) => ({ a: s.a }),
        storage: createMemoryStorage(),
      });
      assert.equal(opts.name, 'diffusecraft-connection');
      assert.equal(opts.version, PERSISTENCE_SCHEMA_VERSION);
    },
  ],

  // ---- Phase B: editor slices ----
  [
    'editor canvas slice round-trips document',
    () => {
      const store = createEditorStore();
      store.getState().setDocument({
        id: 'doc-1',
        width: 1024,
        height: 768,
        last_applied_result_uri: null,
      });
      assert.equal(store.getState().document?.id, 'doc-1');
      assert.equal(store.getState().document?.width, 1024);
    },
  ],
  [
    'editor layers slice setLayers + setActiveLayer + patchLayer',
    () => {
      const store = createEditorStore();
      store.getState().setLayers([
        { id: 'l1', name: 'Background', visible: true, locked: false, opacity: 1 },
      ]);
      store.getState().setActiveLayer('l1');
      assert.equal(store.getState().layers.length, 1);
      assert.equal(store.getState().activeLayerId, 'l1');
      store.getState().patchLayer('l1', { visible: false });
      assert.equal(store.getState().layers[0]!.visible, false);
    },
  ],
  [
    'editor selection slice toggles between rect and none',
    () => {
      const store = createEditorStore();
      assert.equal(store.getState().selection.kind, 'none');
      store.getState().setSelection({ kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } });
      assert.equal(store.getState().selection.kind, 'rect');
      store.getState().setSelectionMode('add');
      assert.equal(store.getState().selectionMode, 'add');
    },
  ],
  [
    'editor brush slice partial set merges',
    () => {
      const store = createEditorStore();
      const before = store.getState().brush;
      store.getState().setBrush({ size: 32 });
      const after = store.getState().brush;
      assert.equal(after.size, 32);
      assert.equal(after.hardness, before.hardness);
    },
  ],
  [
    'editor active-tool slice changes tool + settings',
    () => {
      const store = createEditorStore();
      store.getState().setActiveTool('lasso');
      store.getState().setActiveToolSettings({ feather: 4 });
      assert.equal(store.getState().activeTool, 'lasso');
      assert.equal(store.getState().activeToolSettings.feather, 4);
    },
  ],
  [
    'editor transform slice begin / handle / patch / end',
    () => {
      const store = createEditorStore();
      store.getState().beginTransform({ x: 10, y: 20 });
      assert.equal(store.getState().transform.active, true);
      store.getState().setTransformHandle('top-left');
      assert.equal(store.getState().transform.activeHandle, 'top-left');
      store.getState().patchTransform({ rotation: 0.5 });
      assert.equal(store.getState().transform.rotation, 0.5);
      store.getState().endTransform();
      assert.equal(store.getState().transform.active, false);
    },
  ],
  [
    'editor loadDocument populates a sentinel document',
    async () => {
      const store = createEditorStore();
      const client = makeMockClient();
      store.getState().attachClient(client);
      await store.getState().loadDocument('doc-x');
      assert.equal(store.getState().document?.id, 'doc-x');
      assert.equal(store.getState().layers.length, 0);
    },
  ],
  [
    'editor applyDocumentChanged ignores unrelated documents',
    () => {
      const store = createEditorStore();
      store.getState().setDocument({
        id: 'doc-A',
        width: 0,
        height: 0,
        last_applied_result_uri: null,
      });
      store.getState().applyDocumentChanged({
        document_id: 'doc-B',
        change: {
          kind: 'layers',
          layers: [
            { id: 'x', name: 'x', visible: true, locked: false, opacity: 1 },
          ],
        },
      });
      assert.equal(store.getState().layers.length, 0);
    },
  ],
  [
    'editor applyDocumentChanged updates layers slice on match',
    () => {
      const store = createEditorStore();
      store.getState().setDocument({
        id: 'doc-A',
        width: 0,
        height: 0,
        last_applied_result_uri: null,
      });
      store.getState().setLayers([
        { id: 'old', name: 'x', visible: true, locked: false, opacity: 1 },
      ]);
      store.getState().setActiveLayer('old');
      store.getState().applyDocumentChanged({
        document_id: 'doc-A',
        change: {
          kind: 'layers',
          layers: [
            { id: 'new', name: 'y', visible: true, locked: false, opacity: 1 },
          ],
        },
      });
      assert.equal(store.getState().layers[0]!.id, 'new');
      assert.equal(
        store.getState().activeLayerId,
        null,
        'active layer cleared when removed by reconciliation',
      );
    },
  ],
  [
    'editor clearDocument resets all slices',
    () => {
      const store = createEditorStore();
      store.getState().setDocument({
        id: 'doc-1',
        width: 100,
        height: 100,
        last_applied_result_uri: null,
      });
      store.getState().setActiveTool('lasso');
      store.getState().setBrush({ size: 99 });
      store.getState().clearDocument();
      assert.equal(store.getState().document, null);
      assert.equal(store.getState().activeTool, 'brush');
      assert.equal(store.getState().brush.size, 16);
    },
  ],

  // ---- Phase C: connection store ----
  [
    'connection store starts disconnected with empty paired list',
    () => {
      const store = createConnectionStore();
      assert.equal(store.getState().connectionStatus, 'disconnected');
      assert.equal(store.getState().pairedBackends.length, 0);
      assert.equal(store.getState().routerStatus, 'no-paired');
    },
  ],
  [
    'connection pairBackend stores token in secure adapter, not in state',
    async () => {
      const secureTokens = createMemorySecureTokenAdapter();
      const store = createConnectionStore({ secureTokens });
      await store
        .getState()
        .pairBackend(
          { id: 'srv-1', name: 'Studio PC', origin: 'mdns' },
          'opaque-token-xyz',
        );
      assert.equal(store.getState().pairedBackends.length, 1);
      assert.equal(store.getState().pairedBackends[0]!.id, 'srv-1');
      // Token must NOT be in any in-memory state.
      const dump = JSON.stringify(store.getState());
      assert.ok(!dump.includes('opaque-token-xyz'));
      // Token must be in the secure adapter under the canonical key.
      const token = await secureTokens.getItemAsync(tokenKey('srv-1'));
      assert.equal(token, 'opaque-token-xyz');
    },
  ],
  [
    'connection removeBackend clears token + state',
    async () => {
      const secureTokens = createMemorySecureTokenAdapter();
      const store = createConnectionStore({ secureTokens });
      await store
        .getState()
        .pairBackend({ id: 'srv-1', name: 'A', origin: 'qr' }, 'tok');
      store.getState().setCurrentBackend('srv-1');
      await store.getState().removeBackend('srv-1');
      assert.equal(store.getState().pairedBackends.length, 0);
      assert.equal(store.getState().currentBackendId, null);
      const tok = await secureTokens.getItemAsync(tokenKey('srv-1'));
      assert.equal(tok, null);
    },
  ],
  [
    'connection setConnectionStatus drives routerStatus derivation',
    async () => {
      const store = createConnectionStore();
      await store
        .getState()
        .pairBackend({ id: 'srv-1', name: 'A', origin: 'manual' }, 'tok');
      assert.equal(store.getState().routerStatus, 'paired-no-active');
      store.getState().setCurrentBackend('srv-1');
      store.getState().setConnectionStatus('connected');
      assert.equal(store.getState().routerStatus, 'connected');
      store.getState().setConnectionStatus('disconnected');
      assert.equal(store.getState().routerStatus, 'paired-no-active');
    },
  ],
  [
    'connection getToken resolves from secure store',
    async () => {
      const secureTokens = createMemorySecureTokenAdapter();
      const store = createConnectionStore({ secureTokens });
      await store
        .getState()
        .pairBackend({ id: 'srv-1', name: 'A', origin: 'manual' }, 'top-secret');
      const tok = await store.getState().getToken('srv-1');
      assert.equal(tok, 'top-secret');
    },
  ],
  [
    'connection persistence round-trips paired list (no tokens)',
    async () => {
      const storage = createMemoryStorage();
      const secureTokens = createMemorySecureTokenAdapter();
      const storeA = createConnectionStore({ storage, secureTokens, persistKey: 'rt' });
      await storeA
        .getState()
        .pairBackend({ id: 'srv-1', name: 'A', origin: 'mdns' }, 'tok');
      storeA.getState().setCurrentBackend('srv-1');
      // Wait for the persist middleware to flush.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const storeB = createConnectionStore({ storage, secureTokens, persistKey: 'rt' });
      // Hydration completes asynchronously; await one tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(storeB.getState().pairedBackends.length, 1);
      assert.equal(storeB.getState().pairedBackends[0]!.id, 'srv-1');
      assert.equal(storeB.getState().currentBackendId, 'srv-1');
      // The persisted blob in storage must NOT contain the token.
      const blob = await storage.getItem('diffusecraft-rt');
      assert.ok(blob !== null);
      assert.ok(!blob!.includes('tok'));
    },
  ],
  [
    'connection __debugCycle walks no-paired → paired-no-active → connected',
    () => {
      const store = createConnectionStore();
      assert.equal(store.getState().routerStatus, 'no-paired');
      store.getState().__debugCycle();
      assert.equal(store.getState().routerStatus, 'paired-no-active');
      store.getState().__debugCycle();
      assert.equal(store.getState().routerStatus, 'connected');
      store.getState().__debugCycle();
      assert.equal(store.getState().routerStatus, 'no-paired');
    },
  ],
  [
    'connection __debugSetStatus aligns paired list with target status',
    () => {
      const store = createConnectionStore();
      store.getState().__debugSetStatus('paired-no-active');
      assert.equal(store.getState().routerStatus, 'paired-no-active');
      assert.ok(store.getState().pairedBackends.length >= 1);
      store.getState().__debugSetStatus('connected');
      assert.equal(store.getState().routerStatus, 'connected');
      assert.equal(store.getState().currentBackendId, 'imac-de-igna');
    },
  ],

  // ---- Phase D: jobs / models / history / mcp-catalog ----
  [
    'jobs store applyProgress + applyCompleted moves job to recent',
    () => {
      const store = createJobsStore({ recentCapacity: 5 });
      store.getState().applyProgress({ job_id: 'j1', progress: 0.5 });
      assert.equal(store.getState().active.size, 1);
      store.getState().applyCompleted({ job_id: 'j1', outcome: 'success' });
      assert.equal(store.getState().active.size, 0);
      assert.equal(store.getState().recent.length, 1);
      assert.equal(store.getState().recent[0]!.status, 'success');
    },
  ],
  [
    'jobs store recent buffer is bounded',
    () => {
      const store = createJobsStore({ recentCapacity: 3 });
      for (let i = 0; i < 5; i++) {
        store.getState().applyCompleted({ job_id: `j${i}`, outcome: 'success' });
      }
      assert.equal(store.getState().recent.length, 3);
    },
  ],
  [
    'models store refresh bumps lastRefresh',
    async () => {
      const store = createModelsStore();
      assert.equal(store.getState().lastRefresh, null);
      await store.getState().refresh();
      assert.ok(store.getState().lastRefresh !== null);
    },
  ],
  [
    'models store applyDownloadProgress records bytes by model id',
    () => {
      const store = createModelsStore();
      store.getState().applyDownloadProgress({
        model_id: 'sdxl-1.0',
        bytes_downloaded: 100,
        bytes_total: 200,
      });
      assert.equal(store.getState().downloads['sdxl-1.0']?.bytes_downloaded, 100);
    },
  ],
  [
    'history store loadFor sets documentId and seeds empty items',
    async () => {
      const store = createHistoryStore();
      await store.getState().loadFor('doc-1');
      assert.equal(store.getState().documentId, 'doc-1');
      assert.equal(store.getState().items.length, 0);
    },
  ],
  [
    'history applyDocumentChanged appends new items, dedupes by id',
    async () => {
      const store = createHistoryStore();
      await store.getState().loadFor('doc-1');
      store.getState().applyDocumentChanged({
        document_id: 'doc-1',
        change: {
          kind: 'history',
          itemsAdded: [
            {
              id: 'h1',
              document_id: 'doc-1',
              created_at: '2026-05-03T00:00:00Z',
              thumbnail_uri: null,
              applied: false,
              discarded: false,
            },
          ],
        },
      });
      // Apply again with same id — should not duplicate.
      store.getState().applyDocumentChanged({
        document_id: 'doc-1',
        change: {
          kind: 'history',
          itemsAdded: [
            {
              id: 'h1',
              document_id: 'doc-1',
              created_at: '2026-05-03T00:00:00Z',
              thumbnail_uri: null,
              applied: false,
              discarded: false,
            },
          ],
        },
      });
      assert.equal(store.getState().items.length, 1);
    },
  ],
  [
    'mcp-catalog hasTool reflects loaded handshake',
    () => {
      const store = createMcpCatalogStore();
      store.getState().loadFromHandshake('srv-1', {
        catalogVersion: '1.0.0',
        tools: [
          {
            name: 'generate_image',
            title: 'Generate',
            description: '',
            category: 'job',
            idempotent: false,
            reversible: true,
            since: '1.0.0',
          },
        ],
        resources: [],
        prompts: [],
        capabilities: {
          catalog_version_range: ['1.0.0', '1.0.0'],
          comfyui_status: 'ready',
          supported_workspaces: ['Generate'],
          sampling_supported: true,
          audit_log_enabled: true,
        },
      });
      assert.equal(store.getState().hasTool('generate_image'), true);
      assert.equal(store.getState().hasTool('start_live_session'), false);
    },
  ],

  // ---- Phase F: optimistic ----
  [
    'runOptimistic returns commit result on success',
    async () => {
      let applied = false;
      let reverted = false;
      const result = await runOptimistic({
        apply: () => {
          applied = true;
        },
        commit: async () => 42,
        revert: () => {
          reverted = true;
        },
      });
      assert.equal(result, 42);
      assert.equal(applied, true);
      assert.equal(reverted, false);
    },
  ],
  [
    'runOptimistic reverts and rethrows on commit failure',
    async () => {
      let reverted = false;
      const error = new Error('boom');
      let caught: unknown = null;
      try {
        await runOptimistic({
          apply: () => {
            /* noop */
          },
          commit: async () => {
            throw error;
          },
          revert: () => {
            reverted = true;
          },
        });
      } catch (err) {
        caught = err;
      }
      assert.equal(caught, error);
      assert.equal(reverted, true);
    },
  ],

  // ---- Provider-level wiring ----
  [
    'mock client event dispatch routes to jobs / editor / history / models',
    () => {
      // Assemble manually to avoid pulling React into the test runtime.
      const editor = createEditorStore();
      const jobs = createJobsStore();
      const models = createModelsStore();
      const history = createHistoryStore();
      const client = makeMockClient();

      editor.getState().attachClient(client);
      models.getState().attachClient(client);
      history.getState().attachClient(client);

      const unsubscribe = client.events.subscribe((event) => {
        switch (event.name) {
          case 'job.progress':
            jobs.getState().applyProgress(event.payload);
            return;
          case 'job.completed':
            jobs.getState().applyCompleted(event.payload);
            return;
          case 'document.changed':
            editor.getState().applyDocumentChanged(event.payload);
            history.getState().applyDocumentChanged(event.payload);
            return;
          case 'model.download.progress':
            models.getState().applyDownloadProgress(event.payload);
            return;
          case 'audit.entry':
            return;
          default:
            return;
        }
      });

      client.emit({
        name: 'job.progress',
        payload: { job_id: 'j1', progress: 0.25 },
      });
      assert.equal(jobs.getState().active.size, 1);
      client.emit({
        name: 'model.download.progress',
        payload: { model_id: 'm1', bytes_downloaded: 1, bytes_total: 2 },
      });
      assert.ok(models.getState().downloads['m1']);
      unsubscribe();
    },
  ],
];

let failed = 0;

async function main() {
  for (const [name, run] of cases) {
    try {
      await run();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} test(s) passed.`);
  }
}

void main();
