/**
 * `redo` handler (undo-redo-system task C.2 + C.3).
 *
 * Implements requirements.md §3.6 FR-20: pops + re-applies the calling
 * client's most recently undone operation on the specified or active
 * document. Idempotent (FR-20): when the redo stack is empty, returns
 * `{ reapplied: false }` without throwing.
 *
 * Adapts the parametric {@link UndoRedoManager.redo} return shape
 * (`RedoResult` — `{ no_op: true } | { redone_command_id, args_summary }`)
 * onto the catalog wire contract from
 * `libs/mcp-tools/src/tools/undo-redo/redo.ts`:
 *
 *   - manager → `{ no_op: true }`             ⇒ wire → `{ reapplied: false }`
 *   - manager → `{ redone_command_id, args_summary }`
 *                                             ⇒ wire → `{ reapplied: true,
 *                                                          command_description: args_summary }`
 *
 * The handler does NOT publish `document.changed` — the manager itself
 * publishes it on every successful `redo()` per design.md §5.
 *
 * Document resolution and stdio stack-key fallback follow the same
 * rules as `./undo.ts`; see that file's module docstring.
 */

import { redo as redoTool } from '@diffusecraft/mcp-tools';
import type { ToolHandler } from '../../types/handler-context.js';
import type { UndoRedoManager } from '../undo-redo/manager.js';
import { ServerError } from '../../types/errors.js';

export function createRedoHandler(
  undo: UndoRedoManager,
): ToolHandler<typeof redoTool.inputSchema, typeof redoTool.outputSchema> {
  return async (input, ctx) => {
    const document_id = input.document_id ?? ctx.document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message:
          'redo requires document_id (explicit input or active document on the request).',
      });
    }
    // stdio fallback: see ./undo.ts module docstring.
    const tokenId = ctx.token_id ?? ctx.token_name;
    const result = await undo.redo(ctx.token_name, tokenId, document_id);
    if ('no_op' in result) {
      return { reapplied: false };
    }
    return { reapplied: true, command_description: result.args_summary };
  };
}
