import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { HistoryItemId } from "../../shared/ids";
import { HistoryItemFull } from "../../shared/common";

const Input = z.object({ history_item_id: HistoryItemId });

export const getHistoryItem = defineTool({
  name: "get_history_item",
  title: "Get history item",
  description:
    "Returns metadata + thumbnail ref for a single history item. Fetch full image via `get_image({ scope: 'history_item', id })`.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: HistoryItemFull,
  since: "1.0.0",
});
