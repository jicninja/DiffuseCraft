/**
 * Server lifecycle types.
 *
 * `ServerStatus` is a tagged union mirroring the explicit phases described in
 * `design.md` §5. `ServerLifecycleEvent` enumerates every event emitted via
 * `server.on(...)`.
 */

export type MountedTransports = {
  stdio: boolean;
  http?: { url: string };
  inMemory: true;
};

export type ServerStatus =
  | { phase: 'constructed' }
  | { phase: 'starting' }
  | { phase: 'running'; mounted: MountedTransports }
  | { phase: 'stopping' }
  | { phase: 'stopped' }
  | { phase: 'error'; error: Error };

export type ServerLifecycleEvent =
  | { kind: 'lifecycle.started'; status: ServerStatus }
  | { kind: 'lifecycle.start-failed'; error: Error }
  | { kind: 'lifecycle.stopped' }
  | { kind: 'lifecycle.stopped-with-orphan-jobs'; orphan_job_ids: string[] }
  | { kind: 'lifecycle.first-run-pairing-window-open'; expires_at: string }
  | { kind: 'lifecycle.first-run-pairing-window-expired' };

export type ServerLifecycleEventKind = ServerLifecycleEvent['kind'];

/**
 * Discriminated unsubscribe handle returned by every hook registration.
 */
export type Unsubscribe = () => void;
