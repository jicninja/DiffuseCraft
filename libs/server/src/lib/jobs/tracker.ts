/**
 * Job tracker (F.1–F.7, design.md §4.4).
 *
 * ComfyUI owns the queue; we mirror it. Each call to `submit()` records a
 * row in `jobs(id, prompt_id, status, ...)` and emits `job.progress` /
 * `job.completed` events translated from ComfyUI WS events.
 *
 * Skeletal completeness: the structure + persistence + cancellation +
 * reconciliation are wired. The actual ComfyUI graph construction lives in
 * `comfyui-management`; this class consumes whatever `GraphSpec` is built
 * upstream. History-item creation on success is stubbed pending B.4 +
 * generation-workflow integration.
 *
 * TODO(generation-workflow): create history_item rows on success.
 * TODO(comfyui-management): real WS event payloads.
 */

import type { Database as DB } from 'better-sqlite3';
import type { ComfyClient, GraphSpec } from '../comfy/client.js';
import type { OutputFetcher } from '../comfy/output-fetcher.js';
import type { EventBus } from '../events/bus.js';
import { newId } from '../id.js';

/** Optional dependency: injected by the host once `OutputFetcher` is wired. */
export interface JobTrackerDeps {
  output_fetcher?: OutputFetcher;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobMetadata {
  kind: string;
  token_id: string | null;
  token_name: string;
  document_id?: string;
  parameters_json: string;
  /**
   * Resolved verb — `generate` / `refine` / `fill` / `constrained_variation`
   * / `upscale`. Surfaced in the metadata payload so subscribers can filter
   * job streams without re-parsing `parameters_json`.
   */
  verb?: string;
  /** Fill sub-mode discriminator when applicable. */
  sub_mode?: string;
  /** Preset name in effect for the job, post-resolution. */
  preset?: string;
}

interface JobRow {
  id: string;
  prompt_id: string | null;
  kind: string;
  status: JobStatus;
  progress: number;
  parameters_json: string;
  metadata_json: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_json: string | null;
}

export class JobTracker {
  constructor(
    private readonly db: DB,
    private readonly comfy: ComfyClient,
    private readonly bus: EventBus,
    private readonly deps: JobTrackerDeps = {},
  ) {
    this.comfy.events.on('progress', (e) => this.onComfyProgress(e));
    this.comfy.events.on('executed', (e) => {
      void this.onComfyExecuted(e);
    });
    this.comfy.events.on('execution_error', (e) => this.onComfyError(e));
  }

  /**
   * Submit a graph to ComfyUI, mirror the row in `jobs`, emit initial
   * `job.progress`.
   */
  async submit(graph: GraphSpec, metadata: JobMetadata): Promise<string> {
    const job_id = newId();
    const submission = await this.comfy.submitGraph(graph);
    const status: JobStatus = submission.queue_position === 0 ? 'running' : 'queued';
    const now = new Date().toISOString();
    this.db
      .prepare<[string, string, string, JobStatus, number, string, string, string, string | null]>(
        'INSERT INTO jobs (id, prompt_id, kind, status, progress, parameters_json, metadata_json, created_at, started_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
      )
      .run(
        job_id,
        submission.prompt_id,
        metadata.kind,
        status,
        metadata.parameters_json,
        JSON.stringify({
          token_id: metadata.token_id,
          token_name: metadata.token_name,
          document_id: metadata.document_id ?? null,
          verb: metadata.verb ?? null,
          sub_mode: metadata.sub_mode ?? null,
          preset: metadata.preset ?? null,
        }),
        now,
        status === 'running' ? now : null,
      );
    this.bus.publish({
      name: 'job.progress',
      payload: { job_id, percent: 0, stage: status },
    });
    return job_id;
  }

  /**
   * Cancel a job: route to ComfyUI interrupt or dequeue depending on state.
   *
   * Idempotent — cancelling a job that is already `completed` / `failed` /
   * `cancelled` returns `{ cancelled: false, was_running: false }` (matches
   * `cancel_job` MCP contract). When the job was actively running, we
   * post `/interrupt` to ComfyUI; when only queued, we dequeue.
   *
   * @returns `{ cancelled: true, was_running }` on the first transition
   *  away from running/queued; `{ cancelled: false, was_running: false }`
   *  for unknown jobs and already-finished jobs.
   */
  async cancel(job_id: string): Promise<{ cancelled: boolean; was_running: boolean }> {
    const row = this.db
      .prepare<string, JobRow>('SELECT * FROM jobs WHERE id = ?')
      .get(job_id);
    if (!row) return { cancelled: false, was_running: false };
    if (row.status !== 'running' && row.status !== 'queued') {
      return { cancelled: false, was_running: false };
    }
    const wasRunning = row.status === 'running';
    if (wasRunning && row.prompt_id) {
      await this.comfy.interrupt(row.prompt_id);
    } else if (row.status === 'queued' && row.prompt_id) {
      await this.comfy.dequeue(row.prompt_id);
    }
    const now = new Date().toISOString();
    this.db
      .prepare<[JobStatus, string, string]>('UPDATE jobs SET status = ?, completed_at = ? WHERE id = ?')
      .run('cancelled', now, job_id);
    this.bus.publish({ name: 'job.completed', payload: { job_id, outcome: 'cancelled' } });
    return { cancelled: true, was_running: wasRunning };
  }

  /**
   * On `start()`, reconcile our `running`/`queued` rows against ComfyUI's
   * live queue. Anything we think is alive but ComfyUI doesn't recognise →
   * `failed { code: "LOST_DURING_RESTART" }` (FR-37, F.4).
   */
  async reconcileOnStartup(): Promise<{ marked_lost: number }> {
    const queue = await this.comfy.getQueue();
    const live = new Set(queue.map((q) => q.prompt_id));
    const ours = this.db
      .prepare<[], { id: string; prompt_id: string | null }>(
        "SELECT id, prompt_id FROM jobs WHERE status IN ('running','queued')",
      )
      .all();
    let marked = 0;
    for (const row of ours) {
      if (!row.prompt_id || live.has(row.prompt_id)) continue;
      this.db
        .prepare<[string, string, string]>(
          'UPDATE jobs SET status = ?, completed_at = ?, error_json = ? WHERE id = ?',
        )
        .run('failed', new Date().toISOString(), JSON.stringify({ code: 'LOST_DURING_RESTART' }), row.id);
      marked += 1;
    }
    return { marked_lost: marked };
  }

  private onComfyProgress(e: { prompt_id: string; step: number; max_steps: number }): void {
    const row = this.findByPromptId(e.prompt_id);
    if (!row) return;
    const pct = e.max_steps > 0 ? Math.floor((e.step / e.max_steps) * 100) : 0;
    this.db.prepare<[number, string]>('UPDATE jobs SET progress = ? WHERE id = ?').run(pct, row.id);
    this.bus.publish({ name: 'job.progress', payload: { job_id: row.id, percent: pct, stage: 'running' } });
  }

  private async onComfyExecuted(e: { prompt_id: string; outputs: Record<string, unknown> }): Promise<void> {
    const row = this.findFullByPromptId(e.prompt_id);
    if (!row) return;
    const now = new Date().toISOString();
    this.db
      .prepare<[string, string]>("UPDATE jobs SET status = 'completed', completed_at = ?, progress = 100 WHERE id = ?")
      .run(now, row.id);

    let history_item_id: string | null = null;
    if (this.deps.output_fetcher) {
      try {
        const meta = JSON.parse(row.metadata_json) as { document_id?: string | null };
        const result = await this.deps.output_fetcher.onJobCompleted({
          prompt_id: e.prompt_id,
          job_id: row.id,
          document_id: meta.document_id ?? '',
          // The reversible-command middleware persists `prompt` inside
          // parameters_json; the OutputFetcher stores both for traceability.
          prompt: extractPrompt(row.parameters_json),
          parameters_json: row.parameters_json,
        });
        history_item_id = result.history_item_id;
      } catch (err) {
        // Output fetch failure does not flip the job to failed — the model
        // succeeded. We just don't have a history_item_id; the caller can
        // re-fetch later if desired.
        this.bus.publish({
          name: 'job.output-fetch-failed',
          payload: { job_id: row.id, error: { message: (err as Error).message } },
        });
      }
    }

    if (history_item_id) {
      // Per generation-workflow §3 + generation-history contract: surface
      // the new history item as a first-class event so subscribers (history
      // strip, agents) do not need to re-derive it from `job.completed`.
      const meta = (() => {
        try {
          return JSON.parse(row.metadata_json) as {
            document_id?: string | null;
            verb?: string | null;
            sub_mode?: string | null;
          };
        } catch {
          return {} as Record<string, unknown>;
        }
      })();
      this.bus.publish({
        name: 'history.item-added',
        payload: {
          history_item_id,
          job_id: row.id,
          document_id: (meta as { document_id?: string | null }).document_id ?? null,
          verb: (meta as { verb?: string | null }).verb ?? null,
          sub_mode: (meta as { sub_mode?: string | null }).sub_mode ?? null,
        },
      });
    }

    this.bus.publish({
      name: 'job.completed',
      payload: {
        job_id: row.id,
        outcome: 'success',
        history_item_id,
        outputs: e.outputs,
      },
    });
  }

  private onComfyError(e: { prompt_id: string; message: string; cause?: unknown }): void {
    const row = this.findByPromptId(e.prompt_id);
    if (!row) return;
    const now = new Date().toISOString();
    this.db
      .prepare<[string, string, string]>(
        "UPDATE jobs SET status = 'failed', completed_at = ?, error_json = ? WHERE id = ?",
      )
      .run(now, JSON.stringify({ message: e.message, cause: e.cause }), row.id);
    this.bus.publish({
      name: 'job.completed',
      payload: { job_id: row.id, outcome: 'failure', error: { message: e.message } },
    });
  }

  private findByPromptId(promptId: string): { id: string } | null {
    return (
      this.db.prepare<string, { id: string }>('SELECT id FROM jobs WHERE prompt_id = ?').get(promptId) ?? null
    );
  }

  private findFullByPromptId(promptId: string): JobRow | null {
    return (
      (this.db.prepare<string, JobRow>('SELECT * FROM jobs WHERE prompt_id = ?').get(promptId) as JobRow | undefined) ??
      null
    );
  }
}

/**
 * Extract the prompt text from a job's `parameters_json` payload. Returns
 * the empty string if the JSON is malformed or `prompt` is missing — this
 * function is on the success path of `executed`, so we never throw.
 */
function extractPrompt(parameters_json: string): string {
  try {
    const o = JSON.parse(parameters_json) as { prompt?: string };
    return typeof o.prompt === 'string' ? o.prompt : '';
  } catch {
    return '';
  }
}
