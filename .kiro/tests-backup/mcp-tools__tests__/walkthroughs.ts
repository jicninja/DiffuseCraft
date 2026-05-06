/**
 * Walkthrough simulation (H.7).
 *
 * Each of the four agent walkthroughs from `design.md` §10 is
 * expressed as a sequence of `{ tool, args }` invocations against the
 * catalog. The test asserts:
 *   1. Every named tool is in the manifest.
 *   2. Every `args` object validates against the tool's `inputSchema`.
 *
 * No handlers are run — this is a contract-surface check that the
 * walkthroughs are expressible in the v1 catalog.
 */
import { strict as assert } from "node:assert";
import { catalog } from "../manifest";

interface Step {
  tool: string;
  args: unknown;
  /** When set, name of the resource expected to be referenced (informational). */
  resource?: string;
}

const VALID_ULID = "01HZK2X9VTVM7E9WX0H4QF6P5N";

const walkthroughA_claudeCodeOrchestration: Step[] = [
  // 4. generate_image
  {
    tool: "generate_image",
    args: {
      prompt: "neo-tokyo skyline at dawn",
      preset: "photographic",
      batch_size: 4,
    },
  },
  // 7. get_image x4 (one shape only here for validation)
  {
    tool: "get_image",
    args: { scope: "thumbnail", id: VALID_ULID, max_dimension: 256 },
  },
  // 9. apply_history_item
  { tool: "apply_history_item", args: { history_item_id: VALID_ULID } },
  // 11. export_image
  { tool: "export_image", args: { format: "png" } },
];

const walkthroughB_meshcraftPhase1: Step[] = [
  {
    tool: "create_document",
    args: { width: 1024, height: 1024, name: "char-A-concept" },
  },
  { tool: "set_workspace", args: { workspace: "Generate" } },
  {
    tool: "generate_image",
    args: {
      prompt: "a heroic character concept, full body, dramatic lighting",
      preset: "concept-art",
      batch_size: 8,
    },
  },
  {
    tool: "get_image",
    args: { scope: "history_item", id: VALID_ULID, max_dimension: 512 },
  },
  { tool: "apply_history_item", args: { history_item_id: VALID_ULID } },
  { tool: "export_image", args: { format: "png" } },
];

const walkthroughC_tabletInpaintFace: Step[] = [
  {
    tool: "set_selection",
    args: {
      shape: { kind: "rect", rect: { x: 100, y: 100, w: 256, h: 256 } },
    },
  },
  {
    tool: "transcribe_audio",
    args: {
      audio: {
        format: "wav",
        inline: { encoding: "base64", data: "AAAA" },
      },
    },
  },
  {
    tool: "enhance_prompt",
    args: { input: "make this face younger and softer", mode: "rewrite" },
  },
  {
    tool: "generate_image",
    args: {
      prompt: "young woman portrait, soft features, gentle lighting, 8k photo",
      strength: 100,
      selection: { kind: "rect", rect: { x: 100, y: 100, w: 256, h: 256 } },
      selection_mode: "Fill",
      batch_size: 3,
    },
  },
  { tool: "apply_history_item", args: { history_item_id: VALID_ULID } },
  { tool: "undo", args: {} },
];

const walkthroughD_batchAgent: Step[] = [
  {
    tool: "generate_image",
    args: {
      prompt: "an isometric medieval village at golden hour",
      preset: "default",
      batch_size: 1,
    },
  },
  { tool: "apply_history_item", args: { history_item_id: VALID_ULID } },
  { tool: "export_image", args: { format: "png", to_path: "/output/run-1.png" } },
];

export const runWalkthroughs = (): { ok: boolean; failures: string[] } => {
  const failures: string[] = [];
  const toolsByName = new Map(catalog.tools.map((t) => [t.name, t] as const));

  const allWalkthroughs: Array<[string, Step[]]> = [
    ["A — Claude Code orchestration (Story 4)", walkthroughA_claudeCodeOrchestration],
    ["B — MeshCraft phase 1 (Story 6)", walkthroughB_meshcraftPhase1],
    ["C — Tablet inpaint face (Story 1)", walkthroughC_tabletInpaintFace],
    ["D — Batch agent (Story 8)", walkthroughD_batchAgent],
  ];

  for (const [label, steps] of allWalkthroughs) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const tool = toolsByName.get(step.tool);
      if (!tool) {
        failures.push(`[${label}] step ${i}: tool '${step.tool}' not in catalog`);
        continue;
      }
      const result = tool.inputSchema.safeParse(step.args);
      if (!result.success) {
        failures.push(
          `[${label}] step ${i} (${step.tool}): args invalid: ${JSON.stringify(result.error.format())}`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures };
};

// Run when invoked directly via `tsx`.
const isMainModule = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMainModule) {
  const { ok, failures } = runWalkthroughs();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error("Walkthroughs failed:\n" + failures.map((f) => "  " + f).join("\n"));
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("All 4 walkthroughs validate against the catalog.");
  assert.ok(ok);
}
