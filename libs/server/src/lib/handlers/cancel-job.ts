/**
 * `cancel_job` handler (generation-workflow FR-21 / FR-22).
 *
 * Idempotent thin wrapper around `JobTracker.cancel`. Returns
 * `{ cancelled, was_running }` matching the catalog contract:
 *
 *   - Cancellable (queued/running) → `{ cancelled: true, was_running }`
 *   - Already finished/cancelled/unknown → `{ cancelled: false, was_running: false }`
 *
 * Emits `job.completed { outcome: "cancelled" }` via the tracker when the
 * cancellation succeeds.
 */

import { cancelJob } from '@diffusecraft/mcp-tools';
import type { ToolHandler } from '../../types/handler-context.js';
import type { JobTracker } from '../jobs/tracker.js';

export function createCancelJobHandler(
  tracker: JobTracker,
): ToolHandler<typeof cancelJob.inputSchema, typeof cancelJob.outputSchema> {
  return async (input) => {
    const result = await tracker.cancel(input.job_id);
    return result;
  };
}
