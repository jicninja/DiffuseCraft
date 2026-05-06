# undo-redo-system — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `canvas-fundamentals`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No branching undo in v1.** Fresh op clears redo. |
| Q2 | **Revert ignores `discarded_at` of source history item.** Captures layer state. |
| Q3 | **No `clear_undo_stack` tool in v1.** |
| Q4 | **Fixed `N=20` snapshot frequency** in v1; adaptive deferred. |
| Q5 | **Memory budget enforces eviction** with logged events. |
| Q6 | **Group transform = single Command** restoring all children. |

## 2. Module layout

```
libs/server/src/lib/undo-redo/
├── index.ts                    # public exports
├── manager.ts                  # UndoRedoManager
├── stack.ts                    # ClientDocumentStack (per token+doc)
├── command.ts                  # Command interface + base helpers
├── snapshot.ts                 # snapshot store + diff helpers
├── eviction.ts                 # memory budget enforcement
├── events.ts                   # emit document.changed + undo.eviction
└── __tests__/
```

## 3. The Command interface

```typescript
// libs/server/src/lib/undo-redo/command.ts
export interface Command<R = unknown> {
  readonly id: string;                            // ULID
  readonly tool_name: string;
  readonly document_id: DocumentId;
  readonly args_summary: string;                   // human-readable, ≤120 chars
  readonly weight: "small" | "medium" | "large";   // hints memory/snapshot policy
  readonly created_at: string;
  apply(): Promise<R>;
  revert(): Promise<void>;
  /** Captured during first apply for redo to return same payload. */
  readonly _result?: R;
}

export const buildCommand = <R>(
  spec: Omit<Command<R>, "id" | "created_at" | "_result">
): Command<R> => {
  let result: R | undefined;
  const cmd: Command<R> = {
    ...spec,
    id: ulid(),
    created_at: new Date().toISOString(),
    apply: async () => {
      const r = await spec.apply();
      Object.assign(cmd, { _result: r });
      return r;
    },
    revert: spec.revert,
  };
  return cmd;
};
```

## 4. Per-client per-document stack

```typescript
// libs/server/src/lib/undo-redo/stack.ts
export class ClientDocumentStack {
  private undo: Command[] = [];
  private redo: Command[] = [];
  private snapshots: SnapshotEntry[] = [];   // anchored to undo[i] for some i

  constructor(
    private readonly token_name: string,
    private readonly document_id: DocumentId,
    private readonly maxDepth: number,
    private readonly snapshotEvery: number
  ) {}

  push(command: Command, currentSnapshot?: DocumentSnapshot): void {
    this.undo.push(command);
    this.redo = [];                                  // clear redo (no branching)
    if (this.undo.length > this.maxDepth) {
      const evicted = this.undo.shift();             // drop oldest
      this.snapshots = this.snapshots.filter((s) => s.anchor_undo_index >= 0);
    }
    if (this.undo.length % this.snapshotEvery === 0 && currentSnapshot) {
      this.snapshots.push({
        anchor_undo_index: this.undo.length - 1,
        snapshot: currentSnapshot,
      });
    }
  }

  popUndo(): Command | undefined {
    const cmd = this.undo.pop();
    if (cmd) this.redo.push(cmd);
    return cmd;
  }

  popRedo(): Command | undefined {
    const cmd = this.redo.pop();
    if (cmd) this.undo.push(cmd);
    return cmd;
  }

  getUndoSummary(): CommandSummary[] {
    return this.undo.slice().reverse().map(toSummary);   // newest first
  }
  getRedoSummary(): CommandSummary[] {
    return this.redo.slice().reverse().map(toSummary);
  }

  totalMemoryBytes(): number {
    return estimateBytes(this.undo) + estimateBytes(this.redo) + estimateBytes(this.snapshots);
  }
}
```

## 5. The manager

```typescript
// libs/server/src/lib/undo-redo/manager.ts
export class UndoRedoManager {
  private stacks = new Map<string, ClientDocumentStack>();   // key: `${token_id}:${document_id}`
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private eviction: EvictionPolicy;

  constructor(
    private readonly db: SQLite,
    private readonly bus: EventBus,
    private readonly config: ServerConfig["undo"]
  ) {
    this.eviction = new EvictionPolicy(this, config);
    setInterval(() => this.eviction.run(), 30_000);
  }

  async execute<R>(token_name: string, token_id: string, document_id: DocumentId, command: Command<R>): Promise<R> {
    const stack = this.getOrCreateStack(token_id, document_id);
    const result = await command.apply();
    const snapshot = await this.maybeSnapshot(stack, document_id);
    stack.push(command, snapshot);
    this.bus.publish({
      name: "document.changed",
      payload: {
        document_id,
        change_summary: command.args_summary,
        affected_layer_ids: deriveAffectedLayers(command),
        originating_token_name: token_name,
      },
    });
    return result;
  }

  async undo(token_name: string, token_id: string, document_id: DocumentId): Promise<UndoResult> {
    const stack = this.stacks.get(`${token_id}:${document_id}`);
    if (!stack) return { no_op: true };
    const cmd = stack.popUndo();
    if (!cmd) return { no_op: true };
    await cmd.revert();
    this.bus.publish({
      name: "document.changed",
      payload: { document_id, change_summary: `Undid: ${cmd.args_summary}`, originating_token_name: token_name, affected_layer_ids: [] },
    });
    return { reverted_command_id: cmd.id, args_summary: cmd.args_summary };
  }

  async redo(token_name: string, token_id: string, document_id: DocumentId): Promise<RedoResult> {
    const stack = this.stacks.get(`${token_id}:${document_id}`);
    if (!stack) return { no_op: true };
    const cmd = stack.popRedo();
    if (!cmd) return { no_op: true };
    await cmd.apply();
    this.bus.publish({
      name: "document.changed",
      payload: { document_id, change_summary: `Redid: ${cmd.args_summary}`, originating_token_name: token_name, affected_layer_ids: [] },
    });
    return { redone_command_id: cmd.id, args_summary: cmd.args_summary };
  }

  /** Called by server when a token's connection drops. Schedules discard. */
  onTokenDisconnect(token_id: string): void {
    const timer = setTimeout(() => this.discardForToken(token_id),
      this.config.retain_after_disconnect_seconds * 1000);
    this.disconnectTimers.set(token_id, timer);
  }

  /** Called when token reconnects. Cancels pending discard. */
  onTokenReconnect(token_id: string): void {
    const t = this.disconnectTimers.get(token_id);
    if (t) clearTimeout(t);
    this.disconnectTimers.delete(token_id);
  }

  /** Called on revoke or cleanup. */
  discardForToken(token_id: string): void {
    for (const key of this.stacks.keys()) {
      if (key.startsWith(`${token_id}:`)) this.stacks.delete(key);
    }
  }

  getUndoStack(token_id: string, document_id: DocumentId): CommandSummary[] {
    return this.stacks.get(`${token_id}:${document_id}`)?.getUndoSummary() ?? [];
  }
  getRedoStack(token_id: string, document_id: DocumentId): CommandSummary[] {
    return this.stacks.get(`${token_id}:${document_id}`)?.getRedoSummary() ?? [];
  }

  private getOrCreateStack(token_id: string, document_id: DocumentId): ClientDocumentStack {
    const key = `${token_id}:${document_id}`;
    let s = this.stacks.get(key);
    if (!s) {
      s = new ClientDocumentStack(token_id, document_id, this.config.max_depth_per_client, this.config.snapshot_every_n);
      this.stacks.set(key, s);
    }
    return s;
  }

  private async maybeSnapshot(stack: ClientDocumentStack, document_id: DocumentId): Promise<DocumentSnapshot | undefined> {
    if ((stack as any).undo.length % this.config.snapshot_every_n !== 0) return undefined;
    return await this.captureDocumentSnapshot(document_id);
  }
  private async captureDocumentSnapshot(document_id: DocumentId): Promise<DocumentSnapshot> {
    // delegated to documents service; full state copy
    return await this.db.getDocumentFullState(document_id);
  }
}
```

## 6. Eviction policy

```typescript
// libs/server/src/lib/undo-redo/eviction.ts
export class EvictionPolicy {
  constructor(private manager: UndoRedoManager, private config: UndoConfig) {}

  run(): void {
    const total = this.totalMemory();
    if (total <= this.config.max_total_memory_bytes) return;

    // 1. evict oldest snapshots first
    while (total > this.config.max_total_memory_bytes && this.snapshotsExist()) {
      this.evictOldestSnapshot();
    }
    // 2. if still over, drop oldest commands from deepest stacks
    while (total > this.config.max_total_memory_bytes) {
      const deepest = this.findDeepestStack();
      if (!deepest || deepest.depth <= 5) break;   // floor: keep at least 5 ops per stack
      const evicted = deepest.shiftOldest();
      this.bus.publish({
        name: "undo.eviction",
        payload: { token_id: deepest.token_id, document_id: deepest.document_id, ops_evicted: 1 },
      });
    }
  }

  // ...
}
```

## 7. Multi-client conflict semantics

```typescript
// in dispatcher's reversibleCommandMw
async function executeWithConflictDetection(token_name, token_id, document_id, command, ctx) {
  // Check if another client modified the same layer/property in the last N ms
  const recent = ctx.bus.recentEvents("document.changed", 1000);
  const myAffected = deriveAffectedLayers(command);
  const overlapping = recent.find((e) =>
    e.payload.document_id === document_id &&
    e.payload.originating_token_name !== token_name &&
    haveOverlap(e.payload.affected_layer_ids, myAffected)
  );

  const result = await ctx.undoRedo.execute(token_name, token_id, document_id, command);

  if (overlapping) {
    ctx.bus.publish({
      name: "document.changed",
      payload: {
        document_id,
        change_summary: `${command.args_summary} (conflicts with prior edit by ${overlapping.payload.originating_token_name})`,
        affected_layer_ids: myAffected,
        originating_token_name: token_name,
        conflict: true,
      },
    });
  }
  return result;
}
```

## 8. Tools `undo` and `redo`

```typescript
// libs/server/src/lib/handlers/undo.ts
export const undoHandler: Handler<typeof undoTool> = async (input, ctx) => {
  const document_id = input.document_id ?? ctx.activeDocumentId;
  if (!document_id) throw new ValidationError({ code: "INVALID_INPUT", field_path: "document_id" });
  return ctx.undoRedo.undo(ctx.tokenName, ctx.tokenId, document_id);
};
// redo.ts analogous
```

## 9. Resource handlers

```typescript
// libs/server/src/lib/resources/undo-stack.ts
export async function readUndoStack(uri: string, ctx: HandlerContext): Promise<Paginated<CommandSummary>> {
  const document_id = parseUriDocumentId(uri);
  return paginate(ctx.undoRedo.getUndoStack(ctx.tokenId, document_id));
}
// redo-stack.ts analogous
```

## 10. Tablet UX hooks

```typescript
// libs/ui/src/hooks/useUndoRedo.ts
export const useUndoRedo = () => {
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const undo = useCallback(async () => {
    if (!documentId) return;
    const result = await client.tools.undo({ document_id: documentId });
    if (!result.no_op) showToast(`Undo: ${result.args_summary}`);
  }, [documentId]);
  const redo = useCallback(async () => {
    if (!documentId) return;
    const result = await client.tools.redo({ document_id: documentId });
    if (!result.no_op) showToast(`Redo: ${result.args_summary}`);
  }, [documentId]);
  return { undo, redo };
};
```

Two-finger and three-finger tap gestures bind to these hooks (per `canvas-fundamentals` FR-28).

## 11. Cross-spec integration contract

Every editor spec that introduces a state-mutating tool MUST:

1. Mark the tool `reversible: true` in the catalog.
2. Implement the handler using `ctx.undoRedo.execute(token_name, token_id, document_id, command)`.
3. Provide a `revert()` that restores the prior state deterministically.
4. Provide an `args_summary` ≤120 chars suitable for UX/audit.
5. Estimate `weight: "small" | "medium" | "large"` for memory budgeting.

Specs that violate this contract (catalog says reversible but handler doesn't register a Command) SHALL fail the conformance test in CI.

## 12. Acceptance criteria

1. Every tool in `mcp-tool-catalog` marked `reversible: true` has a path through `ctx.undoRedo.execute`.
2. Multi-client tests: two tokens × two stacks × interleaved ops produce correct per-client undo behavior.
3. Memory budget eviction works under simulated load.
4. Disconnect/reconnect grace window restores stacks.
5. Resources expose stack contents accurately, paginated.
