/**
 * Jobs store factory.
 *
 * Mirrors active and recent jobs. Active jobs map by job_id; recent is a
 * bounded ring buffer (default 50). Updated by SDK event dispatch
 * (`job.progress`, `job.completed`).
 *
 * Per FR-7, jobs state is NOT persisted: jobs are server-owned and the
 * client mirror is ephemeral.
 */
import { createStore, type StoreApi } from 'zustand';

import type {
  JobCompletedPayload,
  JobProgressPayload,
} from '../shared/types';

export interface Job {
  job_id: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  progress: number; // 0..1
  eta_seconds: number | null;
  step: string | null;
  error: { code: string; message: string } | null;
  /** ISO timestamps. */
  started_at: string;
  finished_at: string | null;
}

export interface JobsState {
  active: ReadonlyMap<string, Job>;
  recent: ReadonlyArray<Job>;

  trackJob(job: Job): void;
  applyProgress(payload: JobProgressPayload): void;
  applyCompleted(payload: JobCompletedPayload): void;
  /** Drop all active and recent. Called on disconnect. */
  clear(): void;
}

export type JobsStore = StoreApi<JobsState>;

export interface JobsStoreOptions {
  /** Max recent jobs retained. Defaults to 50. */
  recentCapacity?: number;
}

export function createJobsStore(options: JobsStoreOptions = {}): JobsStore {
  const recentCapacity = options.recentCapacity ?? 50;

  return createStore<JobsState>()((set, get) => ({
    active: new Map<string, Job>(),
    recent: [],

    trackJob: (job) => {
      const next = new Map(get().active);
      next.set(job.job_id, job);
      set({ active: next });
    },

    applyProgress: (payload) => {
      const current = get().active;
      const existing = current.get(payload.job_id);
      const next = new Map(current);
      const updated: Job = existing
        ? {
            ...existing,
            status: 'running',
            progress: payload.progress,
            eta_seconds: payload.eta_seconds ?? existing.eta_seconds,
            step: payload.step ?? existing.step,
          }
        : {
            job_id: payload.job_id,
            status: 'running',
            progress: payload.progress,
            eta_seconds: payload.eta_seconds ?? null,
            step: payload.step ?? null,
            error: null,
            started_at: new Date().toISOString(),
            finished_at: null,
          };
      next.set(payload.job_id, updated);
      set({ active: next });
    },

    applyCompleted: (payload) => {
      const current = get().active;
      const existing = current.get(payload.job_id);
      const completed: Job = existing
        ? {
            ...existing,
            status: payload.outcome,
            progress: payload.outcome === 'success' ? 1 : existing.progress,
            error: payload.error ?? null,
            finished_at: new Date().toISOString(),
          }
        : {
            job_id: payload.job_id,
            status: payload.outcome,
            progress: payload.outcome === 'success' ? 1 : 0,
            eta_seconds: null,
            step: null,
            error: payload.error ?? null,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          };
      const nextActive = new Map(current);
      nextActive.delete(payload.job_id);
      const nextRecent = [completed, ...get().recent].slice(0, recentCapacity);
      set({ active: nextActive, recent: nextRecent });
    },

    clear: () => {
      set({ active: new Map<string, Job>(), recent: [] });
    },
  }));
}
