/**
 * Reversible-handler template (undo-redo-system Phase F.1).
 *
 * **Documentation-only.** This file is never registered with the
 * dispatcher; it exists so every reversible handler in this directory
 * has a single, typecheck-clean reference for the FR-34 contract that
 * realises steering principle P27 (Universal undo/redo). See
 * `libs/server/src/lib/undo-redo/README.md` for the full handler-author
 * guide; this template encodes the bare-minimum shape that satisfies the
 * conformance gate at `server.start()`.
 *
 *   1. **One write path: `ctx.undoRedo.execute(...)`** (design.md §11
 *      line 343). The handler builds a {@link Command} via
 *      {@link buildCommand} and lets the manager apply + push + emit
 *      `document.changed`. The handler MUST NOT pre-apply, MUST NOT set
 *      `ctx.scratch.command`, and MUST NOT publish `document.changed`
 *      itself for the same mutation.
 *
 *   2. **Deterministic apply / revert** (FR-2). Both closures must
 *      produce the same observable outcome on a given starting document
 *      state. `revert()` restores from pre-state captured in the handler
 *      scope; `apply()` performs the mutation and returns the result the
 *      catalog wire-shape expects.
 *
 *   3. **`affected_layer_ids` populated when known** (FR-13..FR-15
 *      conflict detection, design.md §7). Empty/undefined → "scope
 *      unknown" → never flagged as conflicting; the manager's conflict
 *      window relies on this list for cross-token overlap detection.
 *
 *   4. **Stack-key fallback for stdio** — the manager keys stacks by
 *      `(token_id, document_id)`. The stdio transport carries
 *      `ctx.token_id = null` (auth-trusted-by-process), so handlers
 *      fall back to `ctx.token_name` as the id (mirrors `undo.ts:61`).
 *
 * To produce a real handler, copy this file, swap the synthetic tool
 * stub for the catalog import (e.g., `addLayer as addLayerTool` from
 * `@diffusecraft/mcp-tools`), and replace the apply/revert bodies with
 * the spec-specific mutation + restore logic.
 */

import { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { buildCommand, type Command } from '../undo-redo/command.js';

/**
 * Synthetic Zod tool stub used purely so this file typechecks against
 * the real {@link ToolHandler} signature without depending on a specific
 * catalog import. Real handlers replace this with their tool's
 * `inputSchema` / `outputSchema`.
 */
const templateInputSchema = z.object({
  document_id: z.string().optional(),
  layer_id: z.string(),
});
const templateOutputSchema = z.object({
  applied: z.boolean(),
});

type Input = z.infer<typeof templateInputSchema>;
type Output = z.infer<typeof templateOutputSchema>;

/**
 * The canonical reversible-handler shape. Read top-down — the comments
 * call out each mandatory step from the FR-34 contract.
 */
export function createTemplateHandler(): ToolHandler<
  typeof templateInputSchema,
  typeof templateOutputSchema
> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    // 1. Resolve document_id. Reversible handlers are document-scoped
    //    (FR-1, FR-5); reject the call when neither input nor ctx
    //    carries one.
    const document_id =
      input.document_id ?? (ctx as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message:
          'reversible tool requires a document_id (explicit input or active document on the request).',
      });
    }

    // 2. Capture pre-state. Anything `revert()` will need to restore the
    //    document MUST be read here, BEFORE the apply closure runs —
    //    `apply()` runs inside `manager.execute()`, so by the time
    //    `revert()` is called the post-state has already been written.
    const before: { layer_id: string } = { layer_id: input.layer_id };

    // 3. Define apply + revert as closures over the captured pre-state
    //    and the input. Both run inside the manager:
    //      - `apply()` runs at execute() time (and again on every
    //        `redo` per FR-7, FR-23).
    //      - `revert()` runs only on `undo` (FR-6, FR-19).
    const apply = async (): Promise<Output> => {
      // The actual mutation. For real handlers, this is where SQL
      // updates / asset writes / store mutations happen.
      void before;
      return { applied: true };
    };
    const revert = async (): Promise<void> => {
      // Restore from `before`. For real handlers: write back the
      // captured pre-state.
      void before;
    };

    // 4. Build the parametric Command. `affected_layer_ids` MUST list
    //    every layer the apply touches when known — the conflict
    //    detector in `manager.execute()` relies on it.
    const command: Command<Output> = buildCommand<Output>({
      tool_name: 'template_tool',
      document_id,
      args_summary: `template_tool: layer=${input.layer_id}`,
      weight: 'small',
      affected_layer_ids: [input.layer_id],
      apply,
      revert,
    });

    // 5. Hand the Command to the manager. `execute` calls `apply()`,
    //    pushes onto the per-(token_id, document_id) undo stack, emits
    //    `document.changed`, and returns the apply result. The handler
    //    returns that result verbatim — no extra publishing, no extra
    //    enrolment, no `ctx.scratch.command`.
    //
    //    stdio carries `ctx.token_id === null` (auth-trusted-by-process),
    //    so we fall back to `ctx.token_name` as the stack-id. HTTP /
    //    in-memory always carry a real `token_id`.
    const tokenId = ctx.token_id ?? ctx.token_name;
    return ctx.undoRedo.execute(ctx.token_name, tokenId, document_id, command);
  };
}
