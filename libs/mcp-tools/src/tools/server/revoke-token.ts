import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { TokenId } from "../../shared/ids";

const Input = z.object({
  token_id: TokenId.describe("Id of the paired token to revoke."),
});

const Output = z.object({
  revoked: z.boolean(),
  revoked_at: z.string().datetime(),
});

export const revokeToken = defineTool({
  name: "revoke_token",
  title: "Revoke pairing token",
  description:
    "Revokes a paired device token by id. Idempotent: revoking an already-revoked token returns success with the original `revoked_at`. Subsequent requests bearing the token are rejected with `TOKEN_REVOKED`.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { token_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: { revoked: true, revoked_at: "2026-05-03T12:00:00.000Z" },
  },
  since: "1.0.0",
});
