/**
 * ComfyUI integration errors.
 *
 * `ComfyError` is the umbrella thrown by `ComfyClient` for HTTP / WS failures
 * and protocol-level surprises. Specific subclasses give callers structured
 * branches to handle (validation rejection vs network-down, etc.).
 *
 * These errors are server-internal; they never leak verbatim to MCP clients.
 * The handler middleware translates them into appropriate `ServerError`
 * subclasses before they cross a transport boundary.
 */

/** Base class for every error originating in `lib/comfy/`. */
export class ComfyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ComfyError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** ComfyUI rejected the submitted graph (4xx with `node_errors`). */
export class ComfyValidationError extends ComfyError {
  constructor(public readonly node_errors: Record<string, unknown>, message = 'graph rejected by ComfyUI') {
    super(message);
    this.name = 'ComfyValidationError';
  }
}

/** Health probe failed or the server cannot be reached. */
export class ComfyUnreachableError extends ComfyError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ComfyUnreachableError';
  }
}

/** One or more required custom-node packages are missing (FR-8). */
export class ComfyMissingNodesError extends ComfyError {
  constructor(public readonly packages: ReadonlyArray<string>, message: string) {
    super(message);
    this.name = 'ComfyMissingNodesError';
  }
}

/** Integrity check failed during model download (FR-12 / G.5). */
export class ComfyIntegrityError extends ComfyError {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`integrity-check-failed: expected=${expected} actual=${actual}`);
    this.name = 'ComfyIntegrityError';
  }
}
