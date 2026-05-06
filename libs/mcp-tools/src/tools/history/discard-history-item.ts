import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { HistoryItemId } from "../../shared/ids";

const Input = z.object({ history_item_id: HistoryItemId });

const Output = z.object({ discarded: z.boolean() });

export const discardHistoryItem = defineTool({
  name: "discard_history_item",
  title: "Discard history item",
  description:
    "Removes a history item from the panel. Already-applied layers in documents are NOT removed. Idempotent.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
