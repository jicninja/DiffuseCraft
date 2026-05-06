/**
 * Tools barrel — re-exports the generated tool surface (C.1).
 *
 * The generated module owns both the {@link TypedToolMethods} mapped type
 * (consumed by the eventual `DiffuseCraftClient.tools` field, design.md
 * §3) and the runtime {@link createToolMethods} factory the client class
 * uses to construct that field. C.2 lands the hand-written wrappers map.
 */
export {
  abortError,
  callToolWithAbort,
  createToolMethods,
  toCamelCase,
  validateToolInput,
} from "./generated";

export type {
  CamelCase,
  TypedToolMethods,
  ToolCallOptions,
  ToolMethodWrappers,
} from "./generated";
