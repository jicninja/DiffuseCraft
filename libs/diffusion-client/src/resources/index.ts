/**
 * Resources barrel — re-exports the generated resource readers (D.1 + D.2 +
 * D.3).
 *
 * The generated module owns both the {@link TypedResourceReaders} mapped
 * type (consumed by the eventual `DiffuseCraftClient.resources` field,
 * design.md §3) and the runtime {@link createResourceReaders} factory the
 * client class uses to construct that field. Hand-written resource
 * wrappers (none in v1) would land here as a sibling factory.
 */
export {
  camelCaseSegments,
  createResourceReaders,
  fillResourceUri,
  isPaginatedSchema,
  parseResourceUri,
} from "./generated.js";

export type {
  ParamIterator,
  ParamReader,
  ParsedResourceUri,
  PaginatedPage,
  ResourceIterateOptions,
  ResourceNamespace,
  ResourceReadOptions,
  TypedResourceReaders,
  ZeroArgIterator,
  ZeroArgReader,
} from "./generated.js";
