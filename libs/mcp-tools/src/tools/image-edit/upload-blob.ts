import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { BlobId } from "../../shared/ids";

const Input = z.object({
  format: z.enum(["png", "jpeg", "webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z
    .string()
    .describe(
      "Base64-encoded image bytes. Server enforces a 16 MB cap (Q7-bis); larger uploads should be chunked via standard MCP resource upload semantics.",
    ),
});

const Output = z.object({
  blob_id: BlobId,
  uri: z
    .string()
    .describe("`diffusecraft://blob/<ULID>` — usable wherever an ImageEnvelope ref is accepted."),
  expires_at: z.string().datetime(),
});

export const uploadBlob = defineTool({
  name: "upload_blob",
  title: "Upload blob",
  description:
    "Uploads image bytes once and returns a `diffusecraft://blob/<ULID>` URI. Subsequent tool calls reference the URI instead of inlining bytes — saves bandwidth when the same image is consumed by multiple tools. Blobs are short-lived (5 min default) and scoped to the calling token.",
  category: "write",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
