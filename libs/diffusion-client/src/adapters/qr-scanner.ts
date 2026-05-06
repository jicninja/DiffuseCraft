/**
 * `QrScannerAdapter` (G.2, design.md §2 / §12, requirements §3.7 FR-22).
 *
 * The pluggable seam through which the SDK obtains the raw QR payload
 * string scanned from a server's pairing screen. Consumers parse the
 * returned string with {@link PairingClient.parseQr} (F.4); the SDK never
 * reaches into the camera stack itself.
 *
 * Concrete implementations live in consumer packages so the SDK stays
 * platform-neutral:
 *
 *   - `apps/mobile` (RN/Expo) wraps `expo-camera` + a barcode-scanning
 *     plugin (ML Kit / Vision Kit) and resolves with the first detected
 *     QR payload.
 *   - MeshCraft does NOT implement this adapter — desktop pairing uses
 *     the manual-paste flow ({@link PairingClient.parseManual}).
 *   - Tests pass an in-memory stub that resolves with a canned payload.
 *
 * ## Lifecycle
 *
 *   - `scanOnce(opts?)`: open the camera, await the first detected QR
 *     code, return its raw payload string, then release the camera.
 *     Implementations MUST resolve at most once per call — if multiple
 *     codes appear in rapid succession, only the first is surfaced and
 *     the rest are dropped. The `timeout_ms` slot is a soft hint;
 *     implementations SHOULD reject with an error whose `name` is
 *     `'TimeoutError'` when the deadline elapses without a detection so
 *     consumers can pattern-match.
 *
 * The contract is intentionally minimal — no streaming, no continuous
 * scanning. The pairing flow needs exactly one payload and the consumer's
 * UI handles retry / cancel concerns (a "tap to scan again" button calls
 * `scanOnce()` afresh).
 */

/**
 * Options accepted by {@link QrScannerAdapter.scanOnce}.
 *
 *   - `timeout_ms`: optional upper bound on the scan attempt. The
 *     adapter SHOULD reject with `name: 'TimeoutError'` once elapsed.
 *     The SDK does NOT enforce an outer deadline here (unlike
 *     {@link MdnsAdapter.scan}) — consumers wrap the call with
 *     `Promise.race(...)` or `AbortSignal.timeout(...)` if they need a
 *     hard cap independent of the adapter.
 */
export interface QrScannerScanOptions {
  timeout_ms?: number;
}

/**
 * Pluggable QR scanner. Implementations are typically thin wrappers
 * around a platform camera + barcode-decode pipeline; they MUST resolve
 * with the raw payload string (the SDK runs base64url decode + Zod
 * validation downstream in {@link PairingClient.parseQr}).
 */
export interface QrScannerAdapter {
  /**
   * Scan once and resolve with the decoded QR payload. Returns the raw
   * payload string verbatim — no decoding, no parsing. Reject when no
   * payload is detected within `timeout_ms` (when supplied) or when the
   * platform camera permission is denied.
   */
  scanOnce(opts?: QrScannerScanOptions): Promise<string>;
}
