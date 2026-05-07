/**
 * `adapter.native.ts` — Expo-backed implementation of `ImageIoAdapter`.
 *
 * Metro selects this file over `adapter.ts` when bundling for iOS or
 * Android, so consumers can `import { imageIoAdapter } from './adapter'`
 * unaware of the platform split.
 *
 * Spec: `.kiro/specs/image-io/design.md` § "canvas-skia / platform"
 * Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 3.3, 4.5, 5.3, 5.5
 *
 * Permission strings: `expo-image-picker` requires
 * `NSPhotoLibraryUsageDescription` on iOS at runtime. That entry must be
 * added to `apps/mobile/app.config.ts` when the runtime UI surface that
 * calls `pickImageFile()` lands (tracked alongside the integration task,
 * not this one — see the spec's task 9.x).
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';

import type { DeliverInput, ImageIoAdapter, ImageIoError, PickResult, Result } from './adapter';

const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * Map `Platform.OS` to the discriminant accepted by
 * `ImageIoError.platform_unavailable.platform`. Web isn't reachable from
 * `.native.ts`, but we narrow defensively so the union stays exhaustive.
 */
function nativePlatform(): 'ios' | 'android' {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

/**
 * Best-effort filename sanitizer for the share-sheet temp file. Strips
 * path separators and the parent-directory token; leaves the rest intact
 * so the share-sheet preview still shows the user's chosen name.
 */
function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/[/\\]/g, '_').replace(/^\.+/, '_').trim();
  return trimmed.length > 0 ? trimmed : 'untitled';
}

/**
 * Read an Expo asset URI (`file:///...` on iOS / Android) into a
 * `Uint8Array`. RN's `fetch` accepts file URIs and returns a Blob whose
 * `arrayBuffer()` yields the raw bytes — simpler and faster than the
 * legacy base64 round-trip via `expo-file-system`.
 */
async function readUriAsBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Build a `Result.Err` with a stable `cause` string for any thrown error.
 * Centralized so every catch block lands in the same discriminant.
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
 * Native (Expo-backed) `ImageIoAdapter` implementation.
 */
export const imageIoAdapter: ImageIoAdapter = {
  async pickImageFile(signal) {
    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (!permission.granted) {
        return {
          ok: false,
          error: {
            kind: 'platform_unavailable',
            platform: nativePlatform(),
            reason: 'photo-library-permission-denied',
          },
        };
      }

      if (signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled' } };
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
        base64: false,
      });

      if (result.canceled) {
        return { ok: false, error: { kind: 'cancelled' } };
      }

      const asset = result.assets[0];
      if (!asset) {
        return ioFailure('image-picker-returned-no-asset');
      }

      const reportedMime = asset.mimeType ?? 'application/octet-stream';
      if (!ALLOWED_IMAGE_MIMES.has(reportedMime)) {
        return {
          ok: false,
          error: { kind: 'unsupported_mime', reportedMime },
        };
      }

      const bytes = await readUriAsBytes(asset.uri);

      if (signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled' } };
      }

      const filename = asset.fileName ?? deriveFilenameFromUri(asset.uri) ?? 'image';

      return {
        ok: true,
        value: { bytes, filename, mimeReportedByOs: reportedMime },
      };
    } catch (err) {
      return ioFailure(err);
    }
  },

  async pickProjectFile(signal) {
    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    try {
      // We accept both the canonical `application/x-dcft` MIME and the
      // generic ZIP type (some platforms don't recognize the custom MIME
      // for picker filtering). `*/*` is added so iOS Files surfaces files
      // with the right extension regardless of UTI registration. The
      // filename suffix check below is the actual gate.
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/x-dcft', 'application/zip', '*/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return { ok: false, error: { kind: 'cancelled' } };
      }

      const asset = result.assets[0];
      if (!asset) {
        return ioFailure('document-picker-returned-no-asset');
      }

      const filename = asset.name;
      if (!filename.toLowerCase().endsWith('.dcft')) {
        return {
          ok: false,
          error: {
            kind: 'unsupported_mime',
            reportedMime: asset.mimeType ?? 'application/octet-stream',
          },
        };
      }

      const bytes = await readUriAsBytes(asset.uri);

      if (signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled' } };
      }

      return {
        ok: true,
        value: {
          bytes,
          filename,
          mimeReportedByOs: asset.mimeType ?? 'application/x-dcft',
        },
      };
    } catch (err) {
      return ioFailure(err);
    }
  },

  async deliverFile(input, signal) {
    if (signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled' } };
    }

    if (!(await Sharing.isAvailableAsync())) {
      return {
        ok: false,
        error: {
          kind: 'platform_unavailable',
          platform: nativePlatform(),
          reason: 'sharing-unavailable',
        },
      };
    }

    const safeName = sanitizeFilename(input.filename);
    let tempFile: File | null = null;
    let abortListener: (() => void) | null = null;

    /**
     * Best-effort cleanup. Swallows errors because the file may already
     * be gone (deleted by the OS or by an earlier branch); the UI must
     * not surface a secondary failure for a successful share.
     */
    const cleanup = (): void => {
      if (tempFile && tempFile.exists) {
        try {
          tempFile.delete();
        } catch {
          // intentional: cleanup is best-effort
        }
      }
    };

    try {
      tempFile = new File(Paths.cache, safeName);
      // `create({ overwrite: true })` is idempotent for our purposes; a
      // stale temp from a previous abort would otherwise block the write.
      tempFile.create({ overwrite: true });
      tempFile.write(input.bytes);

      if (signal?.aborted) {
        cleanup();
        return { ok: false, error: { kind: 'cancelled' } };
      }

      // Subscribe to the supplied AbortSignal so a late cancellation
      // still releases the temp file. The picker / sharer themselves
      // don't expose an abort hook, but cleanup must run on abort.
      if (signal) {
        abortListener = () => {
          cleanup();
        };
        signal.addEventListener('abort', abortListener);
      }

      await Sharing.shareAsync(tempFile.uri, {
        mimeType: input.mime,
        dialogTitle: input.filename,
        // iOS UTI mapping: PNG / JPEG have well-known UTIs; the custom
        // `.dcft` archive registers as a public.zip-archive subtype on
        // iOS today (no app declares the custom UTI), which keeps the
        // share-sheet honest about what the receiver is getting.
        UTI:
          input.mime === 'image/png'
            ? 'public.png'
            : input.mime === 'image/jpeg'
              ? 'public.jpeg'
              : 'public.zip-archive',
      });

      return { ok: true, value: undefined };
    } catch (err) {
      if (signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled' } };
      }
      return ioFailure(err);
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
      cleanup();
    }
  },
};

/**
 * Derive a filename from a `file:///...` URI when the picker omits
 * `fileName` (older Android variants). Returns `null` if the URI does
 * not contain a recognizable trailing segment.
 */
function deriveFilenameFromUri(uri: string): string | null {
  const lastSlash = uri.lastIndexOf('/');
  if (lastSlash < 0 || lastSlash === uri.length - 1) {
    return null;
  }
  const tail = uri.slice(lastSlash + 1);
  // Strip any query or fragment (defensive — file URIs shouldn't carry
  // them, but RN's URL synth has surprised us before).
  const stripped = tail.split(/[?#]/)[0];
  return stripped && stripped.length > 0 ? stripped : null;
}
