/**
 * Catalog-wide error codes (FR-20-ter).
 *
 * The enum is the **stable contract**; messages may evolve. Every error
 * response carries a `code`, a human-readable `message`, and may include
 * a `hint` (actionable suggestion), a `field_path` (for input errors),
 * and a `retry_after_ms` for retryable errors.
 */
import { z } from "zod";

export const ErrorCode = z.enum([
  // Generic client mistakes
  "NOT_FOUND",
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "FORBIDDEN",
  // Limits & quotas
  "QUEUE_FULL",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  // Versioning
  "UNSUPPORTED_CATALOG_VERSION",
  "UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION",
  "VERSION_MISMATCH",
  // Backend conditions
  "COMFYUI_DISCONNECTED",
  "MODEL_NOT_FOUND",
  "INTERNAL_ERROR",
  "DOCUMENT_LOCKED",
  "RESOURCE_GONE",
  // Workspace / mode
  "TOOL_NOT_AVAILABLE_IN_WORKSPACE",
  "WORKSPACE_NOT_AVAILABLE",
  "INPAINT_REQUIRES_SELECTION",
  // Brushes & regions
  "BRUSH_NOT_FOUND",
  "REGION_ALREADY_EXISTS",
  "TOO_MANY_REGIONS",
  "TOO_MANY_CONTROL_LAYERS",
  // Scripting sandbox (added by script-execution spec; reserved here)
  "SCRIPT_DISALLOWED_IMPORT",
  "SCRIPT_FORBIDDEN_CALL",
  "SCRIPT_OOM",
  "SCRIPT_TIMEOUT",
  "SCRIPT_EXCEPTION",
  "SCRIPT_INVALID_OUTPUT",
  "SCRIPT_EXECUTION_NOT_AVAILABLE",
  // Sampling & enhancement
  "SAMPLING_NOT_SUPPORTED",
  "ENHANCEMENT_RESPONSE_INVALID",
  "ENHANCEMENT_TIMEOUT",
  "ENHANCEMENT_REFUSED",
  // Pairing
  "PAIRING_WINDOW_CLOSED",
  "INTERNET_PAIRING_NOT_SUPPORTED",
  "PAIRING_REJECTED",
  "PAIRING_TOKEN_ALREADY_CLAIMED",
  "TOKEN_REVOKED",
  // Misc backend
  "UPSCALE_VRAM_EXHAUSTED",
  "LOST_DURING_RESTART",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Standard error response envelope. ≤1 KB target per FR-48.
 */
export const ErrorResponse = z.object({
  code: ErrorCode,
  message: z.string(),
  hint: z.string().optional(),
  retry_after_ms: z.number().int().nonnegative().optional(),
  field_path: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
