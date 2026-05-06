/**
 * `auto_select_subject` handler (Tier 2 stub — FR-15..FR-20).
 *
 * The spec requires the server to invoke a SAM-class segmentation model
 * via ComfyUI custom nodes (MobileSAM by default; Tier 3 swaps to a
 * heavier variant). The handler shape is registered now so the catalog
 * conformance check passes; the actual ComfyUI graph build, warm pool,
 * and cache (Phases C/D in tasks.md) ship progressively.
 *
 * Per FR-26 this handler returns `MODEL_NOT_FOUND` when the underlying
 * ComfyUI nodes aren't installed. The tablet UI (out of scope here)
 * hides the button when the catalog declares the tool as unsupported.
 */

import { autoSelectSubject as autoSelectSubjectTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';

import type { ToolHandler } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';

type Input = z.infer<typeof autoSelectSubjectTool.inputSchema>;
type Output = z.infer<typeof autoSelectSubjectTool.outputSchema>;

export interface AutoSelectSubjectDeps {
  /**
   * When defined, the handler delegates to the live ComfyUI segmentation
   * pipeline. Until {@link comfyui-management} wires this up, leaving it
   * `undefined` is the expected configuration: the handler returns
   * `MODEL_NOT_FOUND` so the tablet UI gracefully hides the button.
   */
  segmentationClient?: {
    autoSelectSubject(args: {
      document_id: string;
      layer_id?: string;
      tap_point?: { x: number; y: number };
      quality: 'fast' | 'high';
    }): Promise<{ active: boolean; bbox?: { x: number; y: number; w: number; h: number }; job_id?: string }>;
  };
}

export function createAutoSelectSubjectHandler(
  deps: AutoSelectSubjectDeps = {},
): ToolHandler<typeof autoSelectSubjectTool.inputSchema, typeof autoSelectSubjectTool.outputSchema> {
  return async (input: Input): Promise<Output> => {
    if (!deps.segmentationClient) {
      throw new ServerError({
        code: 'MODEL_NOT_FOUND',
        message:
          'auto_select_subject requires the MobileSAM (or compatible) ComfyUI custom node. Install it via comfyui-management and restart the server.',
      });
    }
    const document_id =
      input.document_id ?? '';
    const opts: {
      document_id: string;
      layer_id?: string;
      tap_point?: { x: number; y: number };
      quality: 'fast' | 'high';
    } = {
      document_id,
      quality: input.quality ?? 'fast',
    };
    if (input.layer_id) opts.layer_id = input.layer_id;
    if (input.tap_point) opts.tap_point = input.tap_point;
    const result = await deps.segmentationClient.autoSelectSubject(opts);
    return result;
  };
}
