import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { ListInput, paginated } from "../../shared/pagination";
import { AuditEntry } from "../../shared/common";

const Input = ListInput.extend({
  token_name: z.string().optional().describe("Filter to a specific paired token."),
  operation: z.string().optional().describe("Filter by tool name."),
});

const Output = paginated(AuditEntry);

export const getAuditLog = defineTool({
  name: "get_audit_log",
  title: "Audit log",
  description:
    "Returns recent audit log entries paginated. Filter by `token_name` or `operation`. Each entry records the calling token, the tool, an args summary, and the outcome (FR-15). No side effects.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { limit: 1 },
    output: {
      items: [
        {
          id: "audit-01HZK",
          token_name: "iPad de Igna",
          operation: "generate_image",
          args_summary: 'prompt="neo-tokyo skyline at dawn", batch_size=4',
          outcome: "success",
          timestamp: "2026-05-03T12:00:00.000Z",
        },
      ],
      next_cursor: undefined,
    },
  },
  since: "1.0.0",
});
