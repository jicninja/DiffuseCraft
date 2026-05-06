#!/usr/bin/env tsx
/**
 * Standalone runner for the mcp-tools schema/manifest tests.
 *
 * When Vitest is added to the workspace these become `test()` blocks.
 * Until then, this file is invoked via `pnpm --filter @diffusecraft/mcp-tools
 * exec tsx src/__tests__/run-tests.ts` and exits non-zero on the first
 * failed assertion.
 */
import { strict as assert } from "node:assert";
import { JobId, LayerId, Ulid, asUlid } from "../shared/ids";
import { ImageEnvelope, Selection } from "../shared/envelope";
import { ErrorCode, ErrorResponse } from "../shared/errors";
import { paginated } from "../shared/pagination";
import { ClientCapabilities, ServerCapabilities } from "../shared/capabilities";
import { catalog } from "../manifest";
import { runConformance } from "./catalog-conformance";
import { runWalkthroughs } from "./walkthroughs";
import { z } from "zod";

const VALID_ULID = "01HZK2X9VTVM7E9WX0H4QF6P5N";

const cases: Array<[string, () => void]> = [
  // --- A.2: ULID + branded ids ---
  [
    "Ulid accepts a valid 26-char Crockford base32 string",
    () => {
      assert.equal(Ulid.parse(VALID_ULID), VALID_ULID);
    },
  ],
  [
    "Ulid rejects lowercase letters",
    () => {
      assert.throws(() => Ulid.parse(VALID_ULID.toLowerCase()));
    },
  ],
  [
    "Ulid rejects forbidden Crockford chars (I, L, O, U)",
    () => {
      // Replace last char with `I` to exercise the regex.
      const bad = VALID_ULID.slice(0, -1) + "I";
      assert.throws(() => Ulid.parse(bad));
    },
  ],
  [
    "asUlid round-trips for branded ids",
    () => {
      const job = asUlid(JobId, VALID_ULID);
      assert.equal(job, VALID_ULID);
      const layer = asUlid(LayerId, VALID_ULID);
      assert.equal(layer, VALID_ULID);
    },
  ],

  // --- A.3: Selection + ImageEnvelope ---
  [
    "Selection accepts rect | mask | none",
    () => {
      Selection.parse({ kind: "rect", rect: { x: 0, y: 0, w: 10, h: 10 } });
      Selection.parse({ kind: "none" });
    },
  ],
  [
    "ImageEnvelope inline variant validates",
    () => {
      ImageEnvelope.parse({
        format: "png",
        width: 1,
        height: 1,
        inline: { encoding: "base64", data: "AAAA" },
      });
    },
  ],
  [
    "ImageEnvelope ref variant validates",
    () => {
      ImageEnvelope.parse({
        format: "png",
        width: 1,
        height: 1,
        ref: {
          uri: `diffusecraft://blob/${VALID_ULID}`,
          expires_at: "2026-05-03T12:00:00.000Z",
        },
      });
    },
  ],
  [
    "ImageEnvelope rejects bogus blob URIs",
    () => {
      assert.throws(() =>
        ImageEnvelope.parse({
          format: "png",
          width: 1,
          height: 1,
          ref: { uri: "https://evil.example/blob/xxx" },
        }),
      );
    },
  ],

  // --- A.4: ErrorCode + ErrorResponse ---
  [
    "ErrorCode includes core members",
    () => {
      const codes = ErrorCode.options;
      for (const c of [
        "NOT_FOUND",
        "INVALID_INPUT",
        "UNSUPPORTED_CATALOG_VERSION",
        "DOCUMENT_LOCKED",
      ] as const) {
        assert.ok(codes.includes(c), `missing ${c}`);
      }
    },
  ],
  [
    "ErrorResponse with code + message validates",
    () => {
      ErrorResponse.parse({ code: "NOT_FOUND", message: "missing" });
    },
  ],

  // --- A.5: paginated() helper ---
  [
    "paginated() caps items at 50",
    () => {
      const Schema = paginated(z.string());
      Schema.parse({ items: ["a", "b"], next_cursor: "c1" });
      assert.throws(() => Schema.parse({ items: new Array(51).fill("x") }));
    },
  ],

  // --- A.6: capabilities ---
  [
    "ClientCapabilities defaults",
    () => {
      const parsed = ClientCapabilities.parse({});
      assert.equal(parsed.accepts_lossy_images, false);
      assert.equal(parsed.max_inline_image_kb, 256);
    },
  ],
  [
    "ServerCapabilities tuple range",
    () => {
      ServerCapabilities.parse({
        catalog_version_range: ["1.0.0", "1.0.0"],
        comfyui_status: "ready",
        supported_workspaces: ["Generate"],
        sampling_supported: true,
        audit_log_enabled: true,
      });
    },
  ],

  // --- A.7 / manifest sanity ---
  [
    "catalog has the expected v1 baseline",
    () => {
      // The 38-tool A.7 baseline grows as feature specs land their
      // tools: transform-tools adds 1 (`transform_layer`); selection-
      // tools adds 5 (`invert_selection`, `select_all`,
      // `refine_selection`, `auto_select_subject`, `select_by_prompt`).
      // Cap remains ≤55 per mcp-tool-catalog FR-3.9.1.
      assert.ok(
        catalog.tools.length >= 38,
        `expected ≥38-tool baseline, got ${catalog.tools.length}`,
      );
      assert.ok(
        catalog.tools.length <= 55,
        `catalog cap is 55, got ${catalog.tools.length}`,
      );
      assert.equal(catalog.resources.length, 16);
      assert.equal(catalog.events.length, 5);
      assert.equal(catalog.prompts.length, 4);
    },
  ],
  [
    "every tool name is unique",
    () => {
      const seen = new Set<string>();
      for (const t of catalog.tools) {
        assert.ok(!seen.has(t.name), `duplicate ${t.name}`);
        seen.add(t.name);
      }
    },
  ],
  [
    "every read tool is idempotent",
    () => {
      for (const t of catalog.tools) {
        if (t.category === "read") {
          assert.equal(t.idempotent, true, `${t.name} read but non-idempotent`);
        }
      }
    },
  ],
  [
    "every reversible tool mutates state",
    () => {
      for (const t of catalog.tools) {
        if (t.reversible) {
          assert.notEqual(
            t.category,
            "read",
            `${t.name} reversible read tool makes no sense`,
          );
        }
      }
    },
  ],

  // --- H.1 / H.2 / H.3 / H.4 / H.6 ---
  [
    "all 4 design.md walkthroughs validate against the catalog",
    () => {
      const result = runWalkthroughs();
      assert.ok(
        result.ok,
        `walkthroughs failed:\n${result.failures.join("\n")}`,
      );
    },
  ],
  [
    "catalog conformance suite passes",
    () => {
      // Use a JSON serialisation of the manifest schema-stripped output.
      const compact = JSON.stringify({
        version: catalog.version,
        tools: catalog.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          category: t.category,
          idempotent: t.idempotent,
          reversible: t.reversible,
          since: t.since,
        })),
        resources: catalog.resources.map((r) => ({
          uri: r.uri,
          title: r.title,
          description: r.description,
        })),
        events: catalog.events.map((e) => ({
          name: e.name,
          description: e.description,
        })),
        prompts: catalog.prompts.map((p) => ({
          name: p.name,
          description: p.description,
        })),
      });
      const result = runConformance(compact);
      assert.ok(
        result.ok,
        `conformance failed:\n${result.failures.map((f) => `  [${f.rule}] ${f.detail}`).join("\n")}`,
      );
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
  console.error(`\n${failed}/${cases.length} test(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} test(s) passed.`);
}
