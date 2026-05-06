/**
 * `select_by_prompt` handler (Tier 4 stub — FR-21..FR-25).
 *
 * The Tier 4 path uses MCP sampling to ask the calling agent for
 * bounding boxes that match a free-form prompt, then feeds the boxes
 * into MobileSAM (via ComfyUI) for the precise mask. The handler shape
 * is registered now so the catalog conformance check passes; the live
 * sampling-forwarder + ComfyUI wiring lands in Phase E of the spec.
 *
 * Until the segmentation client is provided this handler returns
 * `SAMPLING_NOT_SUPPORTED` so the tablet can gracefully hide the
 * button (FR-26).
 */

import { selectByPrompt as selectByPromptTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';

type Input = z.infer<typeof selectByPromptTool.inputSchema>;
type Output = z.infer<typeof selectByPromptTool.outputSchema>;

export interface SelectByPromptDeps {
  /**
   * When provided, the handler asks the calling agent for bounding
   * boxes matching the prompt, then passes them to MobileSAM. The
   * server-architecture spec (`comfyui-management`) builds and injects
   * this once Tier 4 lands.
   */
  segmentationClient?: {
    selectByPrompt(
      args: {
        document_id: string;
        layer_id?: string;
        prompt: string;
      },
      ctx: HandlerContext,
    ): Promise<{ active: boolean; bbox?: { x: number; y: number; w: number; h: number }; job_id?: string }>;
  };
}

export function createSelectByPromptHandler(
  deps: SelectByPromptDeps = {},
): ToolHandler<typeof selectByPromptTool.inputSchema, typeof selectByPromptTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    if (!deps.segmentationClient) {
      throw new ServerError({
        code: 'SAMPLING_NOT_SUPPORTED',
        message:
          'select_by_prompt requires both an MCP-sampling-capable agent (Claude / Codex / Gemini CLI) and the MobileSAM ComfyUI custom node. Use auto_select_subject with a tap point as a fallback.',
        cause: { hint: 'auto_select_subject' },
      });
    }
    const document_id = input.document_id ?? '';
    const opts: { document_id: string; layer_id?: string; prompt: string } = {
      document_id,
      prompt: input.prompt,
    };
    if (input.layer_id) opts.layer_id = input.layer_id;
    const result = await deps.segmentationClient.selectByPrompt(opts, ctx);
    return result;
  };
}
