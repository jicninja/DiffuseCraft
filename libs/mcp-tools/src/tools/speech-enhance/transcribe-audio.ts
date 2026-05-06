import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { JobId } from "../../shared/ids";

const AudioEnvelope = z.object({
  format: z.enum(["wav", "mp3", "flac", "ogg", "m4a"]),
  sample_rate: z.number().int().positive().optional(),
  inline: z
    .object({
      encoding: z.literal("base64"),
      data: z.string(),
    })
    .optional(),
  ref: z
    .object({
      uri: z.string().describe("`diffusecraft://blob/<ULID>` for previously uploaded blobs."),
    })
    .optional(),
});

const Input = z.object({
  audio: AudioEnvelope,
  language_hint: z
    .string()
    .optional()
    .describe("BCP-47 hint (e.g., `es`, `en`). Optional; engine auto-detects."),
});

const Output = z.object({
  job_id: JobId,
});

export const transcribeAudio = defineTool({
  name: "transcribe_audio",
  title: "Transcribe audio",
  description:
    "Transcribes an audio clip via server-side Whisper (P24: independent of `enhance_prompt`). Returns a job handle; subscribe to `job.completed` for the resulting transcript text. OS-native STT on the client is preferred when available.",
  category: "job",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
