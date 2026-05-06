import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { ServerInfo } from "../../shared/common";

const Input = z.object({}).strict();

export const getServerInfo = defineTool({
  name: "get_server_info",
  title: "Server info",
  description:
    "Returns server identity, supported catalog version range, mounted transports, ComfyUI status, and a recommended starting workflow for the active workspace. No side effects.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: ServerInfo,
  example: {
    input: {},
    output: {
      name: "diffusecraft-server",
      server_version: "1.0.0",
      catalog_version_range: ["1.0.0", "1.0.0"],
      comfyui_status: "ready",
      mounted_transports: ["http", "stdio", "in-memory"],
      audit_log_enabled: true,
      recommended_starting_workflow: {
        prompts: ["generate-and-iterate"],
        tools: ["generate_image", "apply_history_item"],
        summary: "Submit a prompt, iterate over results, apply the best one.",
      },
    },
  },
  since: "1.0.0",
});
