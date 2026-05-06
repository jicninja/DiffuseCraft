/**
 * `undo` handler (undo-redo-system task C.1 + C.3).
 *
 * Implements requirements.md §3.6 FR-19: pops + reverts the calling
 * client's last reversible operation on the specified or active
 * document. Idempotent (FR-19): when the stack is empty, returns
 * `{ reverted: false }` without throwing.
 *
 * Adapts the parametric {@link UndoRedoManager.undo} return shape
 * (`UndoResult` — `{ no_op: true } | { reverted_command_id, args_summary }`)
 * onto the catalog wire contract from
 * `libs/mcp-tools/src/tools/undo-redo/undo.ts`:
 *
 *   - manager → `{ no_op: true }`             ⇒ wire → `{ reverted: false }`
 *   - manager → `{ reverted_command_id, args_summary }`
 *                                             ⇒ wire → `{ reverted: true,
 *                                                          command_description: args_summary }`
 *
 * The handler does NOT publish `document.changed` — the manager itself
 * publishes it on every successful `undo()` per design.md §5.
 *
 * **Document resolution (C.3).** Per FR-19 the input `document_id` is
 * optional. We resolve in order:
 *
 *   1. `input.document_id` (explicit caller intent).
 *   2. `ctx.document_id`   (active-document hint on the request).
 *
 * If neither is present we throw `ServerError { code: 'INVALID_INPUT' }`
 * matching the catalog error contract — undo is per-document and there
 * is no defensible default.
 *
 * **Stack-key fallback for stdio (FR-22 / FR-25).** The manager's new
 * surface keys stacks by `(token_id, document_id)`, but the stdio
 * transport carries `ctx.token_id = null` (auth-trusted-by-process per
 * `handler-context.ts`). We fall back to `ctx.token_name` as the stack
 * id in that case — every reversible call still ties to a stable stack
 * key, and stdio is single-eternal-session so there is no cross-token
 * disambiguation to perform. HTTP / in-memory always carry a real
 * `token_id` and take the primary path.
 */

import { undo as undoTool } from '@diffusecraft/mcp-tools';
import type { ToolHandler } from '../../types/handler-context.js';
import type { UndoRedoManager } from '../undo-redo/manager.js';
import { ServerError } from '../../types/errors.js';

export function createUndoHandler(
  undo: UndoRedoManager,
): ToolHandler<typeof undoTool.inputSchema, typeof undoTool.outputSchema> {
  return async (input, ctx) => {
    const document_id = input.document_id ?? ctx.document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message:
          'undo requires document_id (explicit input or active document on the request).',
      });
    }
    // stdio: token_id is null (auth-trusted-by-process). Use token_name
    // as the stack id fallback. See module docstring.
    const tokenId = ctx.token_id ?? ctx.token_name;
    const result = await undo.undo(ctx.token_name, tokenId, document_id);
    if ('no_op' in result) {
      return { reverted: false };
    }
    return { reverted: true, command_description: result.args_summary };
  };
}
