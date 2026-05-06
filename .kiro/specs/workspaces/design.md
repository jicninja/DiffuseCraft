# workspaces — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `client-state-architecture`, `generation-workflow`, `upscale-and-tiling` (next), every editor spec.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No persistence across server restart.** Default to Generate. |
| Q2 | **No auto-switch from Inpaint without selection.** Show hint + disable action. |
| Q3 | **Hard-fail `TOOL_NOT_AVAILABLE_IN_WORKSPACE`.** Cleaner contract. |
| Q4 | **`set_workspace` reversible: false.** Session navigation, not document state. Update `mcp-tool-catalog`. |
| Q5 | **Per-session UI prefs persist** in `editorStore` UI prefs slice. |
| Q6 | **Live workspace ships in v0.2** with the Live tools. |

## 2. Module layout

```
libs/canvas-core/src/workspaces/
├── index.ts
├── types.ts                     # Workspace enum, ToolWorkspaceMap
├── tool-availability.ts         # checkToolInWorkspace(tool, workspace)

libs/server/src/lib/workspaces/
├── manager.ts                   # WorkspaceManager (per-token state)
├── filter-catalog.ts            # filter tools/list by workspace
├── handlers/
│   ├── set-workspace.ts
│   └── get-workspace.ts
└── disconnect-grace.ts          # preserve workspace across reconnect

libs/ui/src/workspaces/
├── WorkspaceTabs.tsx            # top tab bar (Generate / Inpaint / Upscale)
├── WorkspaceTransitions.tsx     # animated panel transitions
├── GenerateLayout.tsx
├── InpaintLayout.tsx
├── UpscaleLayout.tsx
└── workspace-store-slice.ts     # per-session UI prefs per workspace
```

## 3. Types

```typescript
// libs/canvas-core/src/workspaces/types.ts
export const WORKSPACES = ["Generate", "Inpaint", "Upscale", "Live", "CustomGraph", "Animation"] as const;
export type Workspace = typeof WORKSPACES[number];
export const V1_WORKSPACES: Workspace[] = ["Generate", "Inpaint", "Upscale"];
export const ALWAYS_AVAILABLE_WORKSPACE_TOOLS = [
  "get_server_info", "get_audit_log", "revoke_token",
  "set_active_document", "set_workspace", "get_workspace",
  "undo", "redo", "cancel_job", "get_job_status",
];
```

## 4. Tool-workspace map

Each tool in `@diffusecraft/mcp-tools` declares `workspace: Workspace[]` in its `defineTool` config. The map is built at compile time:

```typescript
// libs/canvas-core/src/workspaces/tool-availability.ts
import { catalog } from "@diffusecraft/mcp-tools";

const TOOL_WORKSPACE_MAP: Record<string, Workspace[]> = {};
for (const tool of catalog.tools) {
  TOOL_WORKSPACE_MAP[tool.name] = tool.workspace ?? V1_WORKSPACES;
}

export function checkToolInWorkspace(toolName: string, workspace: Workspace): boolean {
  if (ALWAYS_AVAILABLE_WORKSPACE_TOOLS.includes(toolName)) return true;
  const allowed = TOOL_WORKSPACE_MAP[toolName] ?? [];
  return allowed.includes(workspace);
}
```

Tool definitions update to declare workspace explicitly:

```typescript
// example: generate_image
export const generateImage = defineTool({
  name: "generate_image",
  // ...
  workspace: ["Generate", "Inpaint", "Live"],
});

// example: upscale_image
export const upscaleImage = defineTool({
  name: "upscale_image",
  // ...
  workspace: ["Generate", "Inpaint", "Upscale"],
});

// example: paint_strokes (editor-only; not in Upscale)
export const paintStrokes = defineTool({
  name: "paint_strokes",
  // ...
  workspace: ["Generate", "Inpaint"],
});
```

## 5. Server-side WorkspaceManager

```typescript
// libs/server/src/lib/workspaces/manager.ts
export class WorkspaceManager {
  private map = new Map<string, Workspace>();   // key: token_id

  get(tokenId: string): Workspace {
    return this.map.get(tokenId) ?? "Generate";
  }

  set(tokenId: string, workspace: Workspace): void {
    if (!V1_WORKSPACES.includes(workspace)) {
      throw new ServerError({
        code: "WORKSPACE_NOT_AVAILABLE",
        message: `Workspace "${workspace}" not available in v1.`,
        hint: `Available: ${V1_WORKSPACES.join(", ")}`,
      });
    }
    this.map.set(tokenId, workspace);
    this.bus.publish({
      name: "workspace.changed",
      payload: { token_id: tokenId, workspace },
    });
  }

  /** Called when a token disconnects; preserve for grace window. */
  onDisconnect(tokenId: string): void {
    // grace timer is owned by pairing-protocol's disconnect manager
    // this manager just keeps the entry; clean-up signal comes via clear()
  }

  clear(tokenId: string): void {
    this.map.delete(tokenId);
  }
}
```

The pairing-protocol's grace handler calls `WorkspaceManager.clear(tokenId)` after grace expiry; before that, workspace is preserved.

## 6. Catalog filtering middleware

```typescript
// libs/server/src/lib/workspaces/filter-catalog.ts
export function filterToolsList(allTools: ToolDefinition[], workspace: Workspace): ToolDefinition[] {
  return allTools.filter((t) =>
    ALWAYS_AVAILABLE_WORKSPACE_TOOLS.includes(t.name) || (t.workspace ?? V1_WORKSPACES).includes(workspace)
  );
}

// In MCP server's tools/list handler:
async function handleToolsList(ctx: RequestContext) {
  const workspace = ctx.workspaceManager.get(ctx.tokenId);
  const all = catalog.tools;
  return filterToolsList(all, workspace);
}
```

## 7. Tool invocation enforcement (middleware)

Add a middleware step to `server-architecture` D.x dispatcher:

```typescript
// libs/server/src/lib/dispatcher/middleware/workspace-check.ts
export const workspaceCheckMw: Middleware = async (ctx, next) => {
  const workspace = ctx.workspaceManager.get(ctx.tokenId);
  if (!checkToolInWorkspace(ctx.toolName, workspace)) {
    throw new ServerError({
      code: "TOOL_NOT_AVAILABLE_IN_WORKSPACE",
      message: `Tool "${ctx.toolName}" is not active in workspace "${workspace}".`,
      hint: `Set workspace to one of: ${TOOL_WORKSPACE_MAP[ctx.toolName].join(", ")}`,
    });
  }
  return next();
};
```

Inserted in middleware chain before `executeMw` (per `server-architecture` D.8).

## 8. Inpaint extra validation

```typescript
// libs/server/src/lib/handlers/generate-image.ts (extension)
async function generateImageHandler(input, ctx) {
  const workspace = ctx.workspaceManager.get(ctx.tokenId);
  if (workspace === "Inpaint") {
    if (!input.selection || input.selection.kind === "none") {
      throw new ServerError({
        code: "INPAINT_REQUIRES_SELECTION",
        message: "Inpaint workspace requires an active selection.",
        hint: "Make a selection or switch to Generate workspace.",
      });
    }
    // default sub-mode and strength to Fill semantics
    input.selection_mode ??= "Fill";
    input.strength ??= 100;
  }
  // ... rest of the handler from generation-workflow spec
}
```

## 9. Tablet UX

### 9.1 Workspace tab bar

```typescript
// libs/ui/src/workspaces/WorkspaceTabs.tsx
export const WorkspaceTabs: React.FC = () => {
  const current = useEditorStore((s) => s.workspace);
  const onSwitch = (ws: Workspace) => client.tools.setWorkspace({ workspace: ws });

  return (
    <TabBar>
      {V1_WORKSPACES.map((ws) => (
        <Tab
          key={ws}
          label={ws}
          active={current === ws}
          onPress={() => onSwitch(ws)}
        />
      ))}
    </TabBar>
  );
};
```

The bar is at the top of the document UI, always visible. Selected tab gets a primary-color underline + bold weight.

### 9.2 Layouts

Three layout components: `<GenerateLayout>`, `<InpaintLayout>`, `<UpscaleLayout>`. The shell renders the active layout based on workspace state:

```typescript
// libs/ui/src/workspaces/WorkspaceShell.tsx
export const WorkspaceShell: React.FC = () => {
  const workspace = useEditorStore((s) => s.workspace);
  return (
    <View>
      <WorkspaceTabs />
      <AnimatePresence>
        {workspace === "Generate" && <GenerateLayout key="g" />}
        {workspace === "Inpaint" && <InpaintLayout key="i" />}
        {workspace === "Upscale" && <UpscaleLayout key="u" />}
      </AnimatePresence>
    </View>
  );
};
```

`AnimatePresence` (or equivalent) handles the slide transitions.

### 9.3 Per-workspace UI state

```typescript
// libs/ui/src/workspaces/workspace-store-slice.ts (extension to editorStore)
export const workspaceUiSlice = (set, get) => ({
  workspace: "Generate" as Workspace,
  workspace_ui_prefs: {
    Generate: { /* prompt expanded? history visible? */ },
    Inpaint: { /* selection sub-mode last used */ },
    Upscale: { factor: 2, model: "4x-UltraSharp", tile_size: 512, overlap: 64 },
  },
  setWorkspace: (ws: Workspace) => {
    set({ workspace: ws });
    // server tool call from a side effect, not the slice itself
  },
});
```

## 10. Catalog impact

**No new tools.** This spec:
- Adds `workspace` field to existing tool schemas in `@diffusecraft/mcp-tools`.
- Adds `workspace.changed` event.
- Adds resource `diffusecraft://session/workspace`.
- Updates `set_workspace` to `reversible: false`.

Catalog count stays at ~57 (within cap 60). Footprint unchanged.

## 11. Cross-spec references

- **`mcp-tool-catalog`**: every tool's `workspace` field set per FR-7. `set_workspace` flipped to `reversible: false`.
- **`server-architecture`**: middleware `workspaceCheckMw` added before `executeMw`. `WorkspaceManager` instantiated in `start()`.
- **`pairing-protocol`**: disconnect grace handler calls `WorkspaceManager.clear(tokenId)` after grace expiry.
- **`generation-workflow`**: `generate_image` handler does Inpaint-mode validation (FR-18).
- **`upscale-and-tiling` (next)**: defines what `upscale_image` does in detail; this spec only defines that Upscale workspace surfaces it.

## 12. Acceptance criteria

1. Three v1 workspaces switchable via tablet UX + MCP tool.
2. Tool filtering at handshake + invocation enforcement work.
3. Inpaint mode requires selection.
4. UI transitions ≤250 ms; server switch ≤50 ms.
5. Per-token state preserved across disconnect grace.
6. Catalog impact 0 new tools.
