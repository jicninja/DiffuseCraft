/**
 * @diffusecraft/mcp-tools — schema-only canonical MCP tool catalog.
 *
 * Zod schemas + descriptions + examples for every tool, resource, event,
 * and prompt DiffuseCraft exposes. The build step in
 * `scripts/emit-json-schema.ts` emits `dist/catalog.json` (JSON Schema)
 * for the MCP handshake. Server registers handlers against these schemas;
 * client SDK consumes them for typed call sites.
 *
 * Per `tech.md`, the only allowed runtime dependency is `zod`.
 */
export * from "./shared";
export * from "./version";
export * from "./manifest";
export * from "./types";
// Per-tool re-exports so server-side handler registrations can import the
// canonical `ToolDefinition` instances by name.
export * from "./tools/server";
export * from "./tools/generation";
export * from "./tools/speech-enhance";
export * from "./tools/history";
export * from "./tools/image-edit";
export * from "./tools/selection";
export * from "./tools/layers";
export * from "./tools/masks";
export * from "./tools/undo-redo";
