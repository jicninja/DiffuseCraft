/**
 * `adapter.web.ts` — browser-backed implementation of `ImageIoAdapter`.
 *
 * Metro and the web bundler resolve this file over `adapter.ts` when
 * targeting the web entry, so consumers can `import { imageIoAdapter }
 * from './adapter'` unaware of the platform split.
 *
 * Spec: `.kiro/specs/image-io/design.md` § "canvas-skia / platform"
 * Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 3.3, 4.5, 5.3, 5.4, 5.5
 *
 * Strategy:
 * - Pick → hidden `<input type="file">` with the appropriate `accept`
 *   list. Read `File.arrayBuffer()` on change.
 * - Deliver → feature-detected `showSaveFilePicker` (Chromium) with
 *   `<a download>` fallback wrapping a `URL.createObjectURL(Blob)`.
 * - A separate `registerProjectFileDropTarget` helper exposes the
 *   drag-drop overlay path for `.dcft` (R5.4) without bloating the
 *   cross-platform interface.
 *
 * Project tsconfig already enables `lib: ["ES2022", "DOM"]`, so DOM
 * types are available without a triple-slash directive.
 */

import type {
  DeliverInput,
  ImageIoAdapter,
  ImageIoError,
  PickResult,
  Result,
} from './adapter';

const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const PROJECT_ACCEPT = '.dcft,application/x-dcft,application/zip';

/**
 * Lightweight contract for Chromium's File System Access API. We only
 * use the minimal surface we need; everything else is `unknown` so we
 * don't carry assumptions about the rest of the spec.
 */
type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: ReadonlyArray<{
    description?: string;
    accept: Record<string, ReadonlyArray<string>>;
  }>;
};

type FileSystemWritableLike = {
  write(data: ArrayBuffer | ArrayBufferView | Blob): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable(): Promise<FileSystemWritableLike>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike>;
};

/**
 * Copy a `Uint8Array` into a freshly-allocated `ArrayBuffer`. Required
 * because TS 5.7 narrowed `Uint8Array` to a generic `Uint8Array<TArr>`
 * and `Blob` / `WritableStream.write` accept only `ArrayBuffer`-backed
 * views (not `ArrayBufferLike`, which would also include
 * `SharedArrayBuffer`). The copy is cheap relative to the surrounding
 * file I/O and removes an entire class of cross-thread aliasing
 * concerns.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Build a `Result.Err` with a stable `cause` string for any thrown
 * value. Centralized so every catch block lands in the same
 * discriminant.
 */
function ioFailure(reason: unknown): Result<never, ImageIoError> {
  const cause =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'unknown-error';
  return { ok: false, error: { kind: 'io_failure', cause } };
}

/**
 * Web environment guard. Returns a `platform_unavailable` error when
 * the browser primitives we need are missing — covers SSR (Node /
 * Metro pre-render), worker contexts without DOM, and policy-locked
 * embedded webviews. Returns `null` when the environment is healthy.
 *
 * The narrow return type (only the `Err` branch, never the `Ok` branch
 * of `Result`) keeps callers' inferred `Promise<Result<T, ...>>` clean
 * — otherwise TS widens to include `{ ok: true; value: void }`.
 */
function ensureWebPlatform():
  | { ok: false; error: ImageIoError }
  | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      ok: false,
      error: {
        kind: 'platform_unavailable',
        platform: 'web',
        reason: 'document-or-window-undefined',
      },
    };
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return {
      ok: false,
      error: {
        kind: 'platform_unavailable',
        platform: 'web',
        reason: 'url-create-object-url-unavailable',
      },
    };
  }
  return null;
}

/**
 * Read a `File` into a `Uint8Array`. The buffer returned by
 * `arrayBuffer()` is a fresh copy owned by the JS heap.
 */
async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Translate a freshly-picked `File` into a typed `PickResult` while
 * checking it against the allow-list of MIME types accepted for image
 * import. Filename validation for `.dcft` archives lives at the call
 * site because the predicate differs (extension instead of MIME).
 */
async function imagePickResultFromFile(
  file: File,
): Promise<Result<PickResult, ImageIoError>> {
  const reportedMime = file.type || 'application/octet-stream';
  if (!ALLOWED_IMAGE_MIMES.has(reportedMime)) {
    return {
      ok: false,
      error: { kind: 'unsupported_mime', reportedMime },
    };
  }
  try {
    const bytes = await readFileAsBytes(file);
    return {
      ok: true,
      value: { bytes, filename: file.name, mimeReportedByOs: reportedMime },
    };
  } catch (err) {
    return ioFailure(err);
  }
}

/**
 * Translate a freshly-picked `.dcft` archive into a typed `PickResult`.
 * Browsers rarely have the custom `application/x-dcft` MIME registered,
 * so the filename suffix is the actual gate. Some File System Access
 * implementations report `application/zip` for `.dcft` — both are
 * accepted as long as the extension matches.
 */
async function projectPickResultFromFile(
  file: File,
): Promise<Result<PickResult, ImageIoError>> {
  if (!file.name.toLowerCase().endsWith('.dcft')) {
    return {
      ok: false,
      error: {
        kind: 'unsupported_mime',
        reportedMime: file.type || 'application/octet-stream',
      },
    };
  }
  try {
    const bytes = await readFileAsBytes(file);
    return {
      ok: true,
      value: {
        bytes,
        filename: file.name,
        mimeReportedByOs: file.type || 'application/x-dcft',
      },
    };
  } catch (err) {
    return ioFailure(err);
  }
}

/**
 * Open a hidden `<input type="file">`, wait for the user to choose a
 * file or cancel, and return the selected `File`. Modern browsers
 * dispatch a `cancel` event on dismissal; older ones don't, in which
 * case the promise stays pending until the next change. Because the
 * picker is modal from the user's perspective, an unresolved promise
 * is acceptable — the caller's `AbortSignal` provides the escape
 * hatch.
 */
function openFilePicker(
  accept: string,
  signal: AbortSignal | undefined,
): Promise<File | null> {
  return new Promise<File | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = false;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';

    let settled = false;
    const cleanup = (): void => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const onChange = (): void => {
      if (settled) return;
      settled = true;
      const file = input.files && input.files.length > 0 ? input.files[0] : null;
      cleanup();
      resolve(file ?? null);
    };

    const onCancel = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    document.body.appendChild(input);

    try {
      // `showPicker` is the spec-blessed entry point; fall back to
      // `click()` on browsers that haven't shipped it yet.
      const inputWithPicker = input as HTMLInputElement & {
        showPicker?: () => void;
      };
      if (typeof inputWithPicker.showPicker === 'function') {
        inputWithPicker.showPicker();
      } else {
        input.click();
      }
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
  });
}

/**
 * Web (browser) `ImageIoAdapter` implementation.
 */
export const imageIoAdapter: ImageIoAdapter = {
  async pickImageFile(signal) {
    const platformErr = ensureWebPlatform();
    if (platformErr) return platformErr;

    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    let file: File | null;
    try {
      file = await openFilePicker(IMAGE_ACCEPT, signal);
    } catch (err) {
      return ioFailure(err);
    }

    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    if (file === null) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    return imagePickResultFromFile(file);
  },

  async pickProjectFile(signal) {
    const platformErr = ensureWebPlatform();
    if (platformErr) return platformErr;

    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    let file: File | null;
    try {
      file = await openFilePicker(PROJECT_ACCEPT, signal);
    } catch (err) {
      return ioFailure(err);
    }

    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    if (file === null) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    return projectPickResultFromFile(file);
  },

  async deliverFile(input, signal) {
    const platformErr = ensureWebPlatform();
    if (platformErr) return platformErr;

    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    const win = window as WindowWithSavePicker;
    if ('showSaveFilePicker' in win && typeof win.showSaveFilePicker === 'function') {
      try {
        const handle = await win.showSaveFilePicker({
          suggestedName: input.filename,
          types: [
            {
              description: input.mime,
              accept: { [input.mime]: [extensionFor(input.mime)] },
            },
          ],
        });
        if (signal?.aborted) {
          return { ok: false, error: { kind: 'cancelled' } };
        }
        const writable = await handle.createWritable();
        try {
          // The writable stream copies the bytes immediately so the
          // JS heap buffer can be released by the caller after this
          // call returns. We copy into a fresh `ArrayBuffer` first so
          // the type-system isn't faced with `SharedArrayBuffer`.
          await writable.write(toArrayBuffer(input.bytes));
        } finally {
          await writable.close();
        }
        return { ok: true, value: undefined };
      } catch (err) {
        // Chromium reports user dismissal as `AbortError`. Quota or
        // policy errors (`SecurityError`, `NotAllowedError`) flow into
        // the `<a download>` fallback below; that path is supported
        // everywhere and gives the user another shot.
        const name = (err as { name?: string }).name;
        if (name === 'AbortError') {
          return { ok: false, error: { kind: 'cancelled' } };
        }
        // Fall through to anchor-based fallback.
      }
    }

    // Anchor-based fallback: works on every browser including Safari
    // and embedded webviews. The synthetic click bypasses pop-up
    // blockers because it inherits the originating user gesture.
    try {
      // Copy into an `ArrayBuffer` so the `Blob` constructor's
      // `BlobPart` parameter (which excludes `SharedArrayBuffer`) is
      // satisfied without an unsafe cast.
      const blob = new Blob([toArrayBuffer(input.bytes)], { type: input.mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = input.filename;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Defer revocation so Safari has time to start the download
      // before the object URL becomes unreachable. Four seconds is the
      // value MDN's example uses; in practice browsers latch onto the
      // blob within milliseconds.
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 4000);
      return { ok: true, value: undefined };
    } catch (err) {
      return ioFailure(err);
    }
  },
};

/**
 * Map a delivered MIME to a canonical filename extension. Used to
 * populate the `accept` map in the `showSaveFilePicker` options dialog.
 */
function extensionFor(
  mime: 'image/png' | 'image/jpeg' | 'application/x-dcft',
): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'application/x-dcft':
      return '.dcft';
  }
}

/**
 * Disposer returned by `registerProjectFileDropTarget`. Calling it
 * detaches every event listener registered on the target element and
 * restores its prior `over`-class state.
 */
export type ProjectFileDropDisposer = () => void;

/**
 * Register a drag-drop overlay on `element` that resolves dropped
 * `.dcft` files through the same code path as the `<input>` picker
 * (R5.4). The handler receives a `Result<PickResult, ImageIoError>` —
 * identical shape to `imageIoAdapter.pickProjectFile()` — so consumers
 * can plumb both inputs into one command without branching.
 *
 * Web-only addon. Native targets simply don't import this function;
 * the bundler tree-shakes it out of the native build.
 *
 * Returns a disposer that detaches every listener.
 */
export function registerProjectFileDropTarget(
  element: HTMLElement,
  onDrop: (result: Result<PickResult, ImageIoError>) => void,
): ProjectFileDropDisposer {
  // Browsers fire `dragenter` / `dragleave` per child, which causes
  // jitter on a single-overlay UI. We track depth so the overlay only
  // toggles on actual enter / exit transitions of `element` itself.
  let depth = 0;

  const onDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    depth += 1;
    element.classList.add('dcft-drop-active');
  };

  const onDragOver = (event: DragEvent): void => {
    // `preventDefault` here is required for the `drop` event to fire.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragLeave = (event: DragEvent): void => {
    event.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      element.classList.remove('dcft-drop-active');
    }
  };

  const onDropEvent = (event: DragEvent): void => {
    event.preventDefault();
    depth = 0;
    element.classList.remove('dcft-drop-active');

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      onDrop({ ok: false, error: { kind: 'cancelled' } });
      return;
    }

    const file = files[0];
    if (!file) {
      onDrop({ ok: false, error: { kind: 'cancelled' } });
      return;
    }

    void projectPickResultFromFile(file).then(onDrop, (err: unknown) => {
      onDrop(ioFailure(err));
    });
  };

  element.addEventListener('dragenter', onDragEnter);
  element.addEventListener('dragover', onDragOver);
  element.addEventListener('dragleave', onDragLeave);
  element.addEventListener('drop', onDropEvent);

  return () => {
    element.removeEventListener('dragenter', onDragEnter);
    element.removeEventListener('dragover', onDragOver);
    element.removeEventListener('dragleave', onDragLeave);
    element.removeEventListener('drop', onDropEvent);
    element.classList.remove('dcft-drop-active');
  };
}
