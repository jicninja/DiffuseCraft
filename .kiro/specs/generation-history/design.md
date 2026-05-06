# generation-history — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `generation-workflow`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | Applied items stay in strip with ✓ badge by default. |
| Q2 | Per-document history; cross-document panel is future. |
| Q3 | Virtualized list + GC; bounded storage. |
| Q4 | Surface batch info via `batch_summary` field per item. |
| Q5 | `apply_history_item` always creates new layer in v1. |
| Q6 | GC pauses on shutdown; missing-blob items at startup → mark `discarded_at`. |

## 2. SQLite schema

```sql
-- libs/server/src/lib/db/migrations/00X-history-items.ts
CREATE TABLE history_items (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents(id),
  job_id          TEXT NOT NULL REFERENCES jobs(id),
  prompt          TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  image_blob_id   TEXT NOT NULL,
  thumbnail_blob_id TEXT NOT NULL,
  applied_to_layer_id TEXT NULL,
  applied_at      TEXT NULL,
  discarded_at    TEXT NULL,
  created_at      TEXT NOT NULL,
  -- batch grouping (FR-21)
  batch_size      INTEGER NOT NULL DEFAULT 1,
  batch_position  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_history_doc_created ON history_items(document_id, created_at DESC);
CREATE INDEX idx_history_job ON history_items(job_id);
CREATE INDEX idx_history_applied ON history_items(applied_to_layer_id) WHERE applied_to_layer_id IS NOT NULL;
CREATE INDEX idx_history_discarded ON history_items(discarded_at) WHERE discarded_at IS NOT NULL;
```

## 3. Apply positioning logic

```typescript
// libs/server/src/lib/handlers/apply-history-item.ts
export const applyHistoryItemHandler: Handler<typeof applyHistoryItem> = async (input, ctx) => {
  const item = ctx.db.queryOne<HistoryItem>(
    "SELECT * FROM history_items WHERE id = ?", input.history_item_id
  );
  if (!item) throw new NotFoundError("history_item", input.history_item_id);

  const params = JSON.parse(item.parameters_json) as GenerateImageInput & { resolved_verb: ResolvedVerb };
  const document = ctx.db.queryOne<Document>("SELECT * FROM documents WHERE id = ?", item.document_id);

  // Determine insertion position by verb
  const position = await resolveInsertionPosition(document, params, ctx);

  // Construct command (reversible per P27)
  const layerId = ulid();
  const command: Command = {
    id: ulid(),
    apply: async () => {
      await ctx.layers.create({
        id: layerId,
        document_id: item.document_id,
        kind: "paint",
        name: `Generated: ${item.prompt.slice(0, 40)}`,
        position,
        opacity: 1,
        visible: true,
        blend_mode: "normal",
        content_blob_id: item.image_blob_id,
        clip_mask: params.selection,    // for fill / constrained_variation
      });
      ctx.db.exec(
        "UPDATE history_items SET applied_to_layer_id=?, applied_at=? WHERE id=?",
        layerId, now(), item.id
      );
      ctx.bus.publish({
        name: "document.changed",
        payload: {
          document_id: item.document_id,
          change_summary: `Applied history item ${item.id}`,
          affected_layer_ids: [layerId],
          originating_token_name: ctx.tokenName,
        },
      });
      return { layer_id: layerId, position };
    },
    revert: async () => {
      await ctx.layers.remove(layerId);
      ctx.db.exec(
        "UPDATE history_items SET applied_to_layer_id=NULL, applied_at=NULL WHERE id=? AND applied_to_layer_id=?",
        item.id, layerId
      );
      ctx.bus.publish({
        name: "document.changed",
        payload: {
          document_id: item.document_id,
          change_summary: `Reverted apply of history item ${item.id}`,
          affected_layer_ids: [],
          originating_token_name: ctx.tokenName,
        },
      });
    },
  };

  return await ctx.undoRedo.execute(ctx.tokenName, item.document_id, command);
};

async function resolveInsertionPosition(
  document: Document,
  params: GenerateImageInput & { resolved_verb: ResolvedVerb; source_layer_id?: string },
  ctx: HandlerContext
): Promise<number> {
  const layers = await ctx.layers.listOrdered(document.id);
  switch (params.resolved_verb) {
    case "generate":
      return layers.length;  // top
    case "refine":
    case "constrained_variation":
    case "fill":
      const sourceIdx = params.source_layer_id
        ? layers.findIndex((l) => l.id === params.source_layer_id)
        : -1;
      if (sourceIdx === -1) {
        // FR-8: source layer no longer exists; insert at top, surface notification
        ctx.notify({ kind: "warning", message: "Source layer no longer exists; applied at top." });
        return layers.length;
      }
      return sourceIdx + 1;
  }
}
```

## 4. Resource: paginated history list

```typescript
// libs/server/src/lib/resources/history-list.ts
export async function readHistoryList(
  query: { document_id?: string; applied?: boolean; since?: string; fields?: string[]; cursor?: string; limit?: number }
): Promise<Paginated<HistoryItemSummary>> {
  let sql = `SELECT * FROM history_items WHERE 1=1`;
  const params: any[] = [];
  if (query.document_id) { sql += ` AND document_id = ?`; params.push(query.document_id); }
  if (query.applied !== undefined) {
    sql += query.applied ? ` AND applied_to_layer_id IS NOT NULL` : ` AND applied_to_layer_id IS NULL`;
  }
  if (query.since) { sql += ` AND created_at > ?`; params.push(query.since); }
  if (query.cursor) { sql += ` AND id < ?`; params.push(query.cursor); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(query.limit ?? 20);

  const rows = ctx.db.query<HistoryItem>(sql, ...params);
  const items = rows.map((r) => projectFields(toSummary(r), query.fields));
  return {
    items,
    next_cursor: items.length === (query.limit ?? 20) ? items[items.length - 1].id : undefined,
  };
}
```

## 5. Garbage collection

```typescript
// libs/server/src/lib/history/gc.ts
export class HistoryGc {
  constructor(private db: SQLite, private blobs: BlobStore, private config: HistoryConfig, private bus: EventBus) {}

  start() {
    this.timer = setInterval(() => this.run(), 24 * 60 * 60 * 1000);  // daily
  }

  async run() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Discarded items older than 7 days
    const discarded = this.db.query<HistoryItem>(
      "SELECT * FROM history_items WHERE discarded_at < ?",
      new Date(now - 7 * dayMs).toISOString()
    );

    // Unreferenced items older than retention_days
    const unreferenced = this.db.query<HistoryItem>(
      "SELECT * FROM history_items WHERE applied_to_layer_id IS NULL AND created_at < ?",
      new Date(now - this.config.retention_days * dayMs).toISOString()
    );

    let bytesFreed = 0;
    let itemsDeleted = 0;
    for (const item of [...discarded, ...unreferenced]) {
      bytesFreed += await this.blobs.delete(item.image_blob_id);
      bytesFreed += await this.blobs.delete(item.thumbnail_blob_id);
      this.db.exec("DELETE FROM history_items WHERE id = ?", item.id);
      itemsDeleted++;
    }

    // Storage budget enforcement
    const total = await this.blobs.totalSize();
    if (total > this.config.max_size_bytes) {
      const oldest = this.db.query<HistoryItem>(
        "SELECT * FROM history_items WHERE applied_to_layer_id IS NULL ORDER BY created_at ASC LIMIT 50"
      );
      for (const item of oldest) {
        if ((await this.blobs.totalSize()) <= this.config.max_size_bytes) break;
        bytesFreed += await this.blobs.delete(item.image_blob_id);
        bytesFreed += await this.blobs.delete(item.thumbnail_blob_id);
        this.db.exec("DELETE FROM history_items WHERE id = ?", item.id);
        itemsDeleted++;
      }
    }

    this.bus.publish({
      name: "history.gc-completed",
      payload: { items_deleted: itemsDeleted, bytes_freed: bytesFreed, ts: new Date().toISOString() },
    });
  }
}
```

## 6. Tablet history strip

### 6.1 Component

```typescript
// libs/ui/src/components/HistoryStrip.tsx
export const HistoryStrip: React.FC = () => {
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const showDiscarded = useUserPrefsStore((s) => s.history.show_discarded);
  const items = useHistoryStore((s) =>
    s.items.filter((i) =>
      i.document_id === documentId &&
      (showDiscarded || !i.discarded_at)
    )
  );

  return (
    <FlatList
      horizontal
      inverted   // newest on the right
      data={items}
      renderItem={({ item }) => <HistoryThumbnail item={item} />}
      keyExtractor={(i) => i.id}
      // virtualization for performance (FR NFR-2)
      windowSize={5}
      initialNumToRender={20}
    />
  );
};

const HistoryThumbnail: React.FC<{ item: HistoryItem }> = ({ item }) => {
  const status = item.applied_to_layer_id ? "applied" : item.discarded_at ? "discarded" : "fresh";

  const { onTap, onDoubleTap, onLongPress, onSwipeUp, onSwipeDown } = useGestureHandlers({
    onTap: () => openPreview(item),
    onDoubleTap: () => client.tools.applyHistoryItem({ history_item_id: item.id }),
    onLongPress: () => openContextMenu(item),
    onSwipeUp: () => client.tools.applyHistoryItem({ history_item_id: item.id }),
    onSwipeDown: () => client.tools.discardHistoryItem({ history_item_id: item.id }),
  });

  return (
    <Pressable {...handlers}>
      <ThumbnailImage src={item.thumbnail_ref} />
      <Badge status={status} />
      {/* batch indicator if part of a batch */}
      {item.batch_summary && item.batch_summary.batch_size > 1 && (
        <BatchBadge size={item.batch_summary.batch_size} />
      )}
    </Pressable>
  );
};
```

### 6.2 Preview overlay

When the user taps a thumbnail (single tap), an overlay shows the full image scaled to fit, dimming the canvas underneath. Tap "Apply" or swipe up confirms; tap dismisses.

### 6.3 Compare view

Long-press → "Compare" enters a mode where the user picks a second item; both render side by side or as before/after slider. Tapping the slider edge animates between them.

## 7. Mirror reconciliation in `historyStore`

```typescript
// libs/core/src/stores/history/index.ts
export const createHistoryStore = () =>
  create<HistoryState>()((set, get) => ({
    items: [],
    async loadFor(documentId: string) {
      const result = await get().client.resources.historyList({ document_id: documentId });
      set({ items: result.items });
    },
    applyDocumentChanged(payload: DocumentChangedPayload) {
      // Re-fetch history list if change_summary references history (cheap; only metadata)
      if (payload.change_summary.includes("history")) {
        const docId = payload.document_id;
        get().loadFor(docId);
      }
    },
  }));
```

## 8. Acceptance criteria for `design.md`

1. SQLite schema covers all needed fields with appropriate indexes for hot queries.
2. Apply positioning logic (§3) implements the FR-7 table.
3. Resource list query supports all four params (document_id, applied, since, fields).
4. GC respects all retention rules.
5. Tablet history strip implements all gestures + virtualization.
