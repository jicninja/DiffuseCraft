#!/usr/bin/env tsx
/**
 * scripts/emit-json-schema.ts
 *
 * Build step that walks the catalog manifest, runs `zod-to-json-schema`
 * for every tool/resource/event, and emits `dist/catalog.json`.
 *
 * Build asserts (G.2 / G.3 / FR-33 / FR-36):
 * - tool count ≤ 65
 * - JSON.stringify(catalog).length ≤ 100_000 bytes
 * - example inputs validate against `inputSchema` for tools that ship one
 *
 * Usage: `pnpm --filter @diffusecraft/mcp-tools build:catalog`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

import { catalog } from "../src/manifest";
import type { ToolDefinition } from "../src/shared/define-tool";
import { runConformance } from "../src/conformance/catalog-conformance";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "dist");
const OUT_FILE = resolve(OUT_DIR, "catalog.json");

// Hard caps from requirements §3.9.
const TOOL_CAP = 65;
const FOOTPRINT_CAP_BYTES = 100_000;

// ---------------------------------------------------------------------------
// 1. Walk the manifest into a JSON-Schema-friendly shape.
// ---------------------------------------------------------------------------

interface EmittedTool {
  name: string;
  title: string;
  description: string;
  category: string;
  idempotent: boolean;
  reversible: boolean;
  since: string;
  workspace?: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  example?: { input: unknown; output: unknown };
}

interface EmittedResource {
  uri: string;
  title: string;
  description: string;
  since: string;
  supports_since: boolean;
  supports_fields: boolean;
  contentSchema: unknown;
}

interface EmittedEvent {
  name: string;
  description: string;
  payloadSchema: unknown;
  since: string;
}

interface EmittedPrompt {
  name: string;
  description: string;
  arguments: unknown[];
  template: string;
  since: string;
}

interface EmittedCatalog {
  version: string;
  tools: EmittedTool[];
  resources: EmittedResource[];
  events: EmittedEvent[];
  prompts: EmittedPrompt[];
}

const stripSchemaMeta = (schema: unknown): unknown => {
  if (schema && typeof schema === "object") {
    const obj = schema as Record<string, unknown>;
    // `zod-to-json-schema` emits a `$schema` field; strip it for footprint.
    if ("$schema" in obj) delete obj.$schema;
    for (const key of Object.keys(obj)) {
      stripSchemaMeta(obj[key]);
    }
  }
  return schema;
};

const emitTool = (tool: ToolDefinition): EmittedTool => {
  const inputSchema = stripSchemaMeta(
    zodToJsonSchema(tool.inputSchema, { target: "openApi3" }),
  );
  const outputSchema = stripSchemaMeta(
    zodToJsonSchema(tool.outputSchema, { target: "openApi3" }),
  );
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    category: tool.category,
    idempotent: tool.idempotent,
    reversible: tool.reversible,
    since: tool.since,
    ...(tool.workspace ? { workspace: tool.workspace } : {}),
    inputSchema,
    outputSchema,
    ...(tool.example ? { example: tool.example } : {}),
  };
};

const emitted: EmittedCatalog = {
  version: catalog.version,
  tools: catalog.tools.map(emitTool),
  resources: catalog.resources.map((r) => ({
    uri: r.uri,
    title: r.title,
    description: r.description,
    since: r.since,
    supports_since: r.supports_since,
    supports_fields: r.supports_fields,
    contentSchema: stripSchemaMeta(
      zodToJsonSchema(r.contentSchema, { target: "openApi3" }),
    ),
  })),
  events: catalog.events.map((e) => ({
    name: e.name,
    description: e.description,
    since: e.since,
    payloadSchema: stripSchemaMeta(
      zodToJsonSchema(e.payloadSchema, { target: "openApi3" }),
    ),
  })),
  prompts: catalog.prompts.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments,
    template: p.template,
    since: p.since,
  })),
};

// ---------------------------------------------------------------------------
// 2. Build assertions (FR-33 / FR-36).
// ---------------------------------------------------------------------------

if (emitted.tools.length > TOOL_CAP) {
  throw new Error(
    `Tool count ${emitted.tools.length} exceeds cap ${TOOL_CAP} (FR-36).`,
  );
}

const json = JSON.stringify(emitted, null, 2);
const compactBytes = Buffer.byteLength(JSON.stringify(emitted), "utf8");

if (compactBytes > FOOTPRINT_CAP_BYTES) {
  throw new Error(
    `Compiled catalog.json ${compactBytes} bytes exceeds cap ${FOOTPRINT_CAP_BYTES} (FR-33).`,
  );
}

// Conformance assertions (H.1, H.4, H.6) — runs full coverage and budget checks.
const conformance = runConformance(JSON.stringify(emitted));
if (!conformance.ok) {
  const summary = conformance.failures
    .map((f) => `  [${f.rule}] ${f.detail}`)
    .join("\n");
  throw new Error(`Catalog conformance failed:\n${summary}`);
}

// ---------------------------------------------------------------------------
// 3. Write the artifact.
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, json + "\n", "utf8");

// eslint-disable-next-line no-console
console.log(
  `[mcp-tools] Wrote ${OUT_FILE} — ${emitted.tools.length} tools, ${emitted.resources.length} resources, ${emitted.events.length} events, ${emitted.prompts.length} prompts; ${compactBytes} bytes (cap ${FOOTPRINT_CAP_BYTES}).`,
);
