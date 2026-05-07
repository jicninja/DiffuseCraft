/**
 * `ImageIoAdapter` — single platform-agnostic seam for picking files and
 * delivering byte buffers to the OS share-sheet (native) or browser
 * download (web).
 *
 * This file declares the public types and a stub `imageIoAdapter` value.
 * Platform-specific implementations live in `adapter.native.ts` (Expo
 * modules) and `adapter.web.ts` (browser File API). Metro and the web
 * bundler resolve `.native.ts` / `.web.ts` over the bare `.ts` shim
 * automatically; the stub below exists only as a guard for environments
 * where neither override is picked up so callers see a clear diagnostic
 * instead of `undefined`.
 *
 * Spec: `.kiro/specs/image-io/design.md` § "canvas-skia / platform"
 * Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 3.3, 4.5, 5.3, 5.5
 */

/**
 * Minimal `Result<T, E>` discriminated union, defined locally because
 * `@diffusecraft/core` does not yet ship one. Adding it to `core` is a
 * wider refactor outside this task's boundary.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Output of a successful `pickImageFile` / `pickProjectFile` call. The
 * returned `bytes` buffer lives on the JS heap; callers are responsible
 * for releasing it once consumed.
 */
export type PickResult = {
  bytes: Uint8Array;
  filename: string;
  mimeReportedByOs: string;
};

/**
 * Input to `deliverFile`. The `mime` is constrained to the formats this
 * spec ships in v1 (`.dcft v1` archive plus PNG / JPEG raster export).
 */
export type DeliverInput = {
  bytes: Uint8Array;
  filename: string;
  mime: 'image/png' | 'image/jpeg' | 'application/x-dcft';
};

/**
 * Discriminated error union surfaced by every adapter method. The UI
 * layer matches on `kind` to localize messages without parsing strings.
 */
export type ImageIoError =
  | { kind: 'cancelled' }
  | { kind: 'unsupported_mime'; reportedMime: string }
  | { kind: 'too_large'; bytesSize: number; capBytes: number }
  | { kind: 'platform_unavailable'; platform: 'ios' | 'android' | 'web'; reason: string }
  | { kind: 'io_failure'; cause: string };

/**
 * Platform-agnostic file pick / deliver seam. See file header for the
 * design context. All methods are non-throwing and return a discriminated
 * `Result`; cancellation is a normal `Err({ kind: 'cancelled' })` outcome,
 * not a thrown error.
 *
 * Preconditions: caller holds a UI-thread context (the underlying OS
 * picker requires a user-gesture activation on web).
 *
 * Postconditions on `Ok`: returned bytes live on the JS heap; the
 * adapter performs no further work on them.
 *
 * Invariants: never mutates document or layer state; never performs
 * network I/O.
 */
export interface ImageIoAdapter {
  /**
   * Open the OS image picker, scoped to PNG / JPEG / WebP. Resolves to
   * the picked image's bytes and OS-reported metadata, or to a typed
   * error.
   */
  pickImageFile(signal?: AbortSignal): Promise<Result<PickResult, ImageIoError>>;
  /**
   * Open the OS document picker, scoped to `.dcft` (or `application/zip`
   * with a `.dcft` filename suffix on platforms that don't recognize the
   * custom MIME). Resolves to the picked archive's bytes or to a typed
   * error.
   */
  pickProjectFile(signal?: AbortSignal): Promise<Result<PickResult, ImageIoError>>;
  /**
   * Hand a byte buffer off to the OS share-sheet (native) or trigger a
   * browser download (web). The adapter owns any temporary file it
   * allocates and removes it on completion or cancellation.
   */
  deliverFile(input: DeliverInput, signal?: AbortSignal): Promise<Result<void, ImageIoError>>;
}

/**
 * Stub `ImageIoAdapter` used only when neither the `.native.ts` nor the
 * `.web.ts` override resolves. Returns a `platform_unavailable` error so
 * misconfigurations surface loudly during development instead of
 * crashing on a missing method.
 */
export const imageIoAdapter: ImageIoAdapter = {
  async pickImageFile() {
    return {
      ok: false,
      error: {
        kind: 'platform_unavailable',
        platform: 'web',
        reason: 'image-io-adapter-not-implemented-for-platform',
      },
    };
  },
  async pickProjectFile() {
    return {
      ok: false,
      error: {
        kind: 'platform_unavailable',
        platform: 'web',
        reason: 'image-io-adapter-not-implemented-for-platform',
      },
    };
  },
  async deliverFile() {
    return {
      ok: false,
      error: {
        kind: 'platform_unavailable',
        platform: 'web',
        reason: 'image-io-adapter-not-implemented-for-platform',
      },
    };
  },
};
