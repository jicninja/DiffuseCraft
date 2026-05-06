#!/usr/bin/env tsx
/**
 * Integration smoke test (Review 3 — wiring sanity).
 *
 * The server skeleton's runtime peer dependencies (`better-sqlite3`,
 * `fastify`, `pino`, `ulid`, `bonjour-service`, `@modelcontextprotocol/sdk`)
 * are NOT installed in the monorepo at this stage — the implementation lands
 * the contract surface and typecheck-clean code, with peer deps installed by
 * downstream hosts (`apps/server`, MeshCraft).
 *
 * This smoke test exercises everything that runs without those peer deps:
 *   1. The `@diffusecraft/mcp-tools` manifest is what `@diffusecraft/server`
 *      defaults to (proves Review 2 step 8 wiring is done — not the
 *      local-fallback EMPTY_CATALOG).
 *   2. Catalog version, tool count, and required baseline tools are present.
 *   3. The server's local `ToolDefinition` type re-exports the mcp-tools
 *      shape, so a tool definition built against mcp-tools schemas is
 *      structurally compatible with the dispatcher's expected shape.
 *
 * A full boot smoke test (createDiffuseCraftServer → start → invokeTool)
 * lives in the integration suite and runs once peer deps are installed.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/smoke.ts`.
 */
import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { catalog as mcpCatalog, CATALOG_VERSION } from '@diffusecraft/mcp-tools';
import { defineTool } from '@diffusecraft/mcp-tools';
import {
  SUPPORTED_CATALOG_VERSION,
  type CatalogManifest,
  type ToolDefinition,
} from '../lib/catalog/types.js';
import { DEFAULT_CATALOG, EMPTY_CATALOG, assertCatalogConformance } from '../lib/catalog/registry.js';

const cases: Array<[string, () => void]> = [
  [
    'DEFAULT_CATALOG points at the real mcp-tools manifest (not EMPTY_CATALOG)',
    () => {
      assert.equal(DEFAULT_CATALOG.version, CATALOG_VERSION);
      assert.notEqual(DEFAULT_CATALOG.tools.length, 0, 'default must not be empty');
      assert.ok(
        DEFAULT_CATALOG.tools.length >= 38,
        `expected >=38 baseline tools, got ${DEFAULT_CATALOG.tools.length}`,
      );
    },
  ],
  [
    'EMPTY_CATALOG remains available for test isolation',
    () => {
      assert.equal(EMPTY_CATALOG.tools.length, 0);
      assert.equal(EMPTY_CATALOG.version, mcpCatalog.version);
    },
  ],
  [
    'SUPPORTED_CATALOG_VERSION matches mcp-tools CATALOG_VERSION',
    () => {
      assert.equal(SUPPORTED_CATALOG_VERSION, CATALOG_VERSION);
      assert.equal(SUPPORTED_CATALOG_VERSION, '1.0.0');
    },
  ],
  [
    'spot-check baseline tools are present',
    () => {
      const names = new Set(DEFAULT_CATALOG.tools.map((t) => t.name));
      for (const required of [
        'get_server_info',
        'generate_image',
        'add_layer',
        'add_control_layer',
        'apply_history_item',
      ]) {
        assert.ok(names.has(required), `default catalog missing baseline tool: ${required}`);
      }
    },
  ],
  [
    'mcp-tools ToolDefinition is assignable to server ToolDefinition',
    () => {
      // Build a fresh tool with mcp-tools defineTool; assign it through the
      // server-local alias type. If the server ever drifts from mcp-tools
      // shape, this assignment fails to typecheck.
      const probe = defineTool({
        name: 'meshcraft.echo',
        title: 'Echo',
        description: 'Smoke probe to assert server/mcp-tools shape parity.',
        category: 'read',
        idempotent: true,
        reversible: false,
        inputSchema: z.object({ message: z.string().min(1) }),
        outputSchema: z.object({ echoed: z.string() }),
        since: '1.0.0',
      });
      const asServerTool: ToolDefinition = probe;
      assert.equal(asServerTool.name, 'meshcraft.echo');
      assert.equal(asServerTool.category, 'read');
      assert.equal(asServerTool.reversible, false);
    },
  ],
  [
    'assertCatalogConformance is lenient by default and reports missing handlers',
    () => {
      let reported: readonly string[] = [];
      const emptyRegistry = { has: () => false, list: () => [] as readonly string[] };
      assertCatalogConformance(DEFAULT_CATALOG, emptyRegistry, {
        onMissing: (m) => {
          reported = m;
        },
      });
      // Skeleton: every tool is missing a handler (per-feature specs add them).
      assert.equal(reported.length, DEFAULT_CATALOG.tools.length);
    },
  ],
  [
    'assertCatalogConformance is strict on demand (FR-19 / D.12 contract)',
    () => {
      let threw = false;
      const emptyRegistry = { has: () => false, list: () => [] as readonly string[] };
      try {
        assertCatalogConformance(DEFAULT_CATALOG, emptyRegistry, { strict: true });
      } catch (err) {
        threw = true;
        assert.match((err as Error).message, /catalog conformance failed/);
      }
      assert.ok(threw, 'strict mode must throw when handlers are missing');
    },
  ],
  [
    'mcp-tools manifest type is structurally a CatalogManifest',
    () => {
      const _typeProbe: CatalogManifest = mcpCatalog as CatalogManifest;
      assert.equal(_typeProbe.version, '1.0.0');
      assert.ok(Array.isArray(_typeProbe.tools));
      assert.ok(Array.isArray(_typeProbe.resources));
      assert.ok(Array.isArray(_typeProbe.events));
      assert.ok(Array.isArray(_typeProbe.prompts));
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
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
  console.error(`\n${failed}/${cases.length} smoke test(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} smoke test(s) passed.`);
}
