import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { JobId } from "../../shared/ids";

const Input = z.object({ job_id: JobId });
const Output = z.object({
  cancelled: z.boolean(),
  was_running: z.boolean(),
});

export const cancelJob = defineTool({
  name: "cancel_job",
  title: "Cancel job",
  description:
    "Cancels a running or queued job. Idempotent: cancelling an already-finished job returns `{ cancelled: false, was_running: false }`. Emits `job.completed` with `outcome: 'cancelled'` if the job was running.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { job_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: { cancelled: true, was_running: true },
  },
  since: "1.0.0",
});
