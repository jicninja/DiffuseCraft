import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { JobId } from "../../shared/ids";
import { JobSummary } from "../../shared/common";

const Input = z.object({ job_id: JobId });

export const getJobStatus = defineTool({
  name: "get_job_status",
  title: "Job status",
  description:
    "Returns current job state, progress percent, ETA, and outcome (when complete). Prefer subscribing to `job.progress` and `job.completed` events instead of polling.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: JobSummary,
  since: "1.0.0",
});
