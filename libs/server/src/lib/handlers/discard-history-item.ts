/**
 * `discard_history_item` handler (B.3, FR-5 §3.2).
 *
 * Sets `discarded_at = now()`. Idempotent — repeated calls return
 * `{ discarded: true }` without resetting the timestamp. Already-applied
 * layers in documents are NOT touched (FR-5 last sentence).
 *
 * The actual blob deletion is deferred to the GC sweep (Phase D); discarded
 * items remain readable until the daily sweep evicts them after the grace
 * window. This preserves "compare with discarded" UX (FR-18 §3.6).
 */

import { discardHistoryItem as discardHistoryItemTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';
import type { ToolHandler } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import type { HistoryStore } from '../history/store.js';

type Input = z.infer<typeof discardHistoryItemTool.inputSchema>;
type Output = z.infer<typeof discardHistoryItemTool.outputSchema>;

export function createDiscardHistoryItemHandler(
  store: HistoryStore,
): ToolHandler<typeof discardHistoryItemTool.inputSchema, typeof discardHistoryItemTool.outputSchema> {
  return async (input: Input, _ctx): Promise<Output> => {
    const row = store.getById(input.history_item_id);
    if (!row) {
      throw new ServerError({
        code: 'HISTORY_ITEM_NOT_FOUND',
        message: `history_item not found: ${input.history_item_id}`,
      });
    }
    if (!row.discarded_at) {
      store.markDiscarded({
        id: input.history_item_id,
        discarded_at: new Date().toISOString(),
      });
    }
    return { discarded: true };
  };
}
