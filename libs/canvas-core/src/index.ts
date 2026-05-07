/**
 * @diffusecraft/canvas-core — render-agnostic canvas logic.
 *
 * Implements the document model, layer/group operations, blend formulas,
 * hit-testing helpers, in-memory history (preliminary), and brush presets
 * per the canvas-fundamentals spec. Strictly pure TypeScript: no Skia,
 * no React Native, no DOM. Adapters (e.g., `@diffusecraft/canvas-skia`)
 * implement `CanvasRenderAdapter` against this surface.
 */

// ---- Layers ----
export * from './layers/types';
export * from './layers/blend-modes';
export * from './layers/group';

// ---- Document ----
export * from './document/document';
export * from './document/selection';
export * from './document/operations';
export * from './document/groups';
export * from './document/invariants';

// ---- Selection geometry (selection-tools) ----
export * from './selection';

// ---- Blend / compose ----
export * from './blend/formulas';
export * from './blend/compose';

// ---- Render adapter ----
export * from './render/adapter';
export * from './render/viewport';
export * from './render/hit-test';

// ---- History (preliminary, in-memory) ----
export * from './history/stack';

// ---- Brush presets ----
export * from './brush/presets';
export * from './brush/stroke';
export * from './brush/stamps';
export * from './brush/compose-stroke';
export * from './brush/incremental-stroke';

// ---- Transform geometry (transform-tools Phases A + B) ----
export * from './transform/index';

// ---- Mask system ----
export * from './mask';

// ---- Selection-as-clip primitive (selection-tools §3.8 / FR-34..FR-39) ----
export * from './composite';

// ---- Shared ----
export * from './shared/ulid';
export * from './shared/ids';

// ---- .dcft v1 portable file format (Zod schemas) ----
export * from './dcft/types';
export * from './dcft/limits';
