# Security

DiffuseCraft's security baseline. Consolidates invariants currently spread across `principles.md` (P4, P18, P19, P26), `tech.md` (Backends model, Pairing & auth model), and feature specs. **If a change to code or specs would break any rule below, it is a steering change, not a feature change.**

## Threat model

DiffuseCraft is **single-user, single-server, LAN-first**. The threat model is shaped by that, not by SaaS multi-tenancy.

| In scope | Out of scope (v1) |
|---|---|
| Untrusted scripts the user (or their paired agent) executes against their own images via `apply_script` | Untrusted scripts from arbitrary remote callers — non-paired clients have no access at all (P18) |
| A paired agent that turns hostile mid-session (or uses up its credentials abusively) | A second tenant inside the same server instance — there is no second tenant |
| LLM/VLM provider seeing prompts/canvas summaries the agent forwards on the user's behalf | Provider-side data retention policy — that is the user's contract with their agent vendor, not ours |
| The user's local network being shared (Wi-Fi cafe, hotel) | Public-Internet exposure — v1 does not support it (LAN-only); post-v1 must use a tunnel (P18) |
| ComfyUI graph that includes filesystem/network nodes | The ComfyUI process being directly reachable by clients — it is not (P19) |
| Token leakage via screenshot, audit log copy, support paste | Hardware compromise of the server host — that defeats every assumption |

DiffuseCraft is **not** designed to defend a server-host machine against its own user. If the user runs `npx @diffusecraft/server` on their PC, the server inherits the user's authority on that PC. The boundary we defend is **client/agent → server**, not **user → OS**.

## Invariants (non-negotiable)

These rules are checked in code review, in `kiro-review`, and (where mechanizable) in lint/CI.

### I-1. Server holds zero AI-provider credentials

The server **never** stores, reads, or proxies an `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STABILITY_API_KEY`, `REPLICATE_TOKEN`, Gemini API key, or any equivalent. Features that require LLM/VLM reasoning (prompt enhancement, prompt-based selection, future captioning) delegate to the user's paired agent via **MCP sampling**. The agent brings its own credentials and is the only party that ever sees them.

**Why.** P4. Privacy by architecture; no exfiltration risk from a compromised server because there is nothing to exfiltrate. Also: licensing, cost-attribution, and audit clarity (the agent vendor's bill is the user's bill).

**Enforcement.** Lint check forbids reading those env vars in `libs/server`. PR review rejects any code path that adds a `Bearer` header to an LLM HTTP endpoint from server code.

### I-2. ComfyUI is never directly reachable by clients

The ComfyUI HTTP/WebSocket port is bound to `127.0.0.1` (managed mode) or only configured as the server's upstream (external modes). Clients (tablet app, paired agents, MeshCraft acting as MCP client) talk to **`@diffusecraft/server`**, which proxies, audits, and rate-limits every call. ComfyUI's own UI is never proxied.

**Why.** P19. ComfyUI has no auth and runs arbitrary graphs that can include filesystem/network nodes. A direct client→ComfyUI path would let any paired client (or a malicious graph snippet from an agent) read/write the host's filesystem.

**Enforcement.** `comfyui-management` spec covers bind address selection. CI may run a port-scan smoke test against managed mode.

### I-3. Pairing tokens are single-tier and audit-log-only

Every paired client (human device or agent) receives an opaque token. **Paired = full access; unpaired = 401.** There are no scopes, roles, or admin tiers. The optional human-readable token name (`"iPad de Igna"`) is **for audit display only — never for authorization**.

**Why.** P18. The previous "read/generate/admin" plan was overengineering for a single-user system. Audit lets the user *see* what happened; it does not gate what *can* happen.

**Enforcement.** Auth middleware checks token validity (existence + not revoked). It must not branch on token name, token age, or any "scope" field. The DB row has no scope column.

### I-4. Token storage uses hashing, not plaintext

Tokens are stored hashed in SQLite. The plaintext exists only on the wire during pairing handshake and on the client device's secure storage thereafter. Server logs never include the plaintext token; the `token_name` column is the only identifier in audit log rows.

**Why.** A SQLite file leak (laptop theft, accidental commit, support archive) must not let an attacker reuse paired sessions. Hash-only storage limits the blast radius to "they need to re-pair."

**Enforcement.** `pairing-protocol` spec mandates `bcrypt` (or equivalent) hashing. Code review rejects any `INSERT INTO tokens (..., plaintext, ...)` shape.

### I-5. Revocation is immediate and cannot be silently bypassed

Revoking a token sets `revoked_at` in SQLite. The server **must check on every request**, not only at session start. There is no "session cache" that survives a revocation. Long-lived WebSocket connections check on each MCP frame, not just on connect.

**Why.** Revocation is the only recourse when a tablet is lost or an agent is being abused. If revocation can be outrun by an open socket, it is theatre.

**Enforcement.** Auth middleware integration test (when testing resumes per `testing.md`) covers "revoke mid-stream → next frame 401". Until then, code review explicitly checks the path.

### I-6. The scripting sandbox is a hard boundary, not a courtesy

`apply_script` runs user-supplied Python or JavaScript in a strictly sandboxed subprocess (`tech.md` Backend class 3). All of the following are **mandatory**, not "best effort":

- **No network.** Network namespace isolation on Linux; `sandbox-exec` (or equivalent) on macOS. The subprocess cannot open a socket. No DNS, no HTTP, no IPC outside the explicit stdin/stdout pipe.
- **No filesystem outside scratch.** Read-only access to a whitelist of language stdlib paths. Read-write only to a per-invocation scratch directory that is destroyed after the call.
- **CPU + memory limits.** Default 30 s and 1 GB; configurable per host but never disable-able.
- **Subprocess UID drop where supported.**
- **AST-level import whitelist.** Python: `numpy`, `PIL`, `cv2`, `scipy`, `scikit-image`. JS: `sharp`, `jimp`. `import socket`, `import os`, `subprocess`, `eval`, `exec`, dynamic `__import__`, `require()` of unlisted modules, and `Function()` constructor are all rejected before execution.
- **I/O contract is bytes in, bytes out.** stdin = PNG + JSON header; stdout = PNG; stderr = log. The script never sees the canvas, the document store, the token, or any other user state.

**Why.** Scripts are user-supplied code. Once executed, anything the subprocess can reach, it can leak. The only safe assumption is that the script is hostile.

**Enforcement.** `script-execution` spec owns the conformance test set. The `apply_script` handler must *fail closed* if any sandbox primitive is unavailable on the host — no fallback to "best effort" mode.

### I-7. LAN-only in v1; tunnel-only post-v1; no port-forwarding ever

The standalone server (`npx @diffusecraft/server`) binds to local IPs by default and advertises via mDNS on the LAN. **It never advises, documents, or supports port-forwarding to the open Internet.** When Internet reachability is added post-v1 it must be via a tunnel (Tailscale-style mesh, Cloudflare Tunnel, or server-initiated relay) so the server has no listening port on the public Internet.

**Why.** P18. The user's GPU and model files are not advertised, scanned, or directly attackable. Tunnel-only collapses the attack surface from "every IP on Earth" to "every device the user authorized in their tunnel mesh."

**Enforcement.** README must not contain a "set up port forwarding" section. The `tech.md` "Decisions deferred → tunnel mechanism" line stays a deferred decision until v2 begins.

### I-8. Client never holds model weights or runs inference

The tablet/phone is **input + display + UI only**. No diffusion model, ControlNet, IP-Adapter, VAE, or upscaler ever loads on the client. There is no "lite mode."

**Why.** P26. Splitting inference between client and server breaks parity with what agents see (P5 — state queryable), encourages a second code path, and produces a degraded experience that pretends to be the real one.

**Enforcement.** `apps/mobile/package.json` must not depend on any inference runtime (`onnxruntime`, `coreml`, `tflite`, `mlc-llm`, etc.). Lint rule on lockfile.

### I-9. Logs do not contain tokens, prompts, or canvas pixels

Server logs (pino in `libs/server`, RN logger in `apps/mobile`) record:

- Tokens: **only** by `token_name` and a stable short hash prefix (e.g., first 6 chars of the hash). Never plaintext, never the full hash.
- Prompts: by length and language tag. Full prompt content is recorded **only** when explicit debug logging is enabled by the user (off by default), and then only at `debug` level.
- Canvas pixels: never. Layer IDs and dimensions only.
- Agent sampling traffic: tool name and outcome, not the round-trip content.

**Why.** Logs are the most-shared diagnostic artifact (support, GitHub issues, screenshots). They must be safe to paste.

**Enforcement.** A `redact()` helper in `libs/server/src/lib/logger.ts` is the only path through which token-/prompt-bearing structures reach the logger. Code review rejects bare `logger.info({ token, prompt })` shapes.

### I-10. The audit log is informational, not authoritative

Every MCP tool invocation appends `{ token_name, operation, args_summary, timestamp, outcome }` to the audit log, queryable via `get_audit_log`. The log **never gates access** — it cannot fail-closed, cannot be the reason a request is rejected, and cannot be relied on for security decisions. It is a record of what happened, for the user's awareness.

**Why.** P18. Log-based authorization couples reliability to disk health. Single-tier auth keeps gating in the auth layer, not in the log.

**Enforcement.** Auth middleware never reads the audit log table. PR review rejects any code path that conditions a 401/403 on audit-log content.

## Supply-chain posture

- **pnpm lockfile is committed and authoritative.** PRs that modify `pnpm-lock.yaml` without a `package.json` change are rejected (transitive bumps without an intent statement).
- **`@diffusecraft/mcp-tools` depends only on `zod`.** Anything else is a tag-rule violation enforced by `@nx/enforce-module-boundaries`. This package is the contract surface — every dependency it absorbs becomes part of the contract.
- **No competing libraries in the same role.** One UI kit (NativeWind + react-native-reusables — `tech.md`), one schema lib (zod), one logger per runtime (pino server / RN logger client), one state lib (Zustand). New packages that would create a second of any of those are rejected at PR time.
- **Native binaries that the server downloads (managed ComfyUI, custom nodes) ship pinned versions and recorded SHA256s.** The user can audit what was fetched. Updates are deliberate, not silent.

## Boundary diagram (mental model)

```
                  ┌──────────────────────────────────────────────┐
                  │                  USER's HOST                 │
                  │                                              │
   ┌───────────┐  │   ┌─────────────────────┐                    │
   │  Tablet   │──┼──▶│ @diffusecraft/server│ ◀─── MCP stdio ───▶│ Agent
   │ (Expo RN) │  │   │   (Node, Fastify)   │      sampling     │ (Claude/
   └───────────┘  │   │                     │                   │ Codex/
        ▲         │   │  ┌──────┐  ┌──────┐ │                   │ Gemini)
   bearer token   │   │  │Audit │  │SQLite│ │                   └──┬──┘
   over HTTP      │   │  │ log  │  │tokens│ │                      │
   (LAN only      │   │  └──────┘  └──────┘ │                      │
    in v1)        │   │                     │                      ▼
                  │   │       ┌─────────────┴──┐              ┌────────┐
                  │   │       │  ComfyUI HTTP+ │              │  LLM   │
                  │   │       │  WS (127.0.0.1)│              │ vendor │
                  │   │       └─────────────┬──┘              │  API   │
                  │   │                     │                 └────────┘
                  │   │  ┌──────────────────┴───┐
                  │   │  │ Sandboxed Python/JS  │
                  │   │  │ subprocess (no net,  │
                  │   │  │  scratch FS, limits) │
                  │   │  └──────────────────────┘
                  └──────────────────────────────────────────────┘

  Trust boundaries:
  ─── Bearer token (paired/unpaired)
  ─── Authenticated proxy (clients NEVER reach ComfyUI directly)
  ─── Sandbox boundary (script subprocess sees stdin/stdout only)
  ─── Credential boundary (LLM keys live with agent; server never sees them)
```

## Reference matrix

| Concern | Owner doc |
|---|---|
| Pairing flow, mDNS, QR, numeric, paste | `pairing-protocol` spec |
| Token verification, audit log | `auth-and-proxy` spec |
| ComfyUI proxy lifecycle | `comfyui-management` spec |
| Scripting sandbox primitives + AST whitelist | `script-execution` spec |
| MCP sampling boundary (server → agent) | `prompt-enhancement` spec, `external-agent-integration` spec |
| LLM-key-free architecture | P4 + this document |
| Network exposure stance | P18 + this document |

## TBD

- Whether to ship a default rate-limit on `apply_script` (per-token burst + sustained). Likely yes; specced in `script-execution`.
- Whether to add a "panic revoke all tokens" CLI command on the server host (`@diffusecraft/server panic-revoke`). Useful for "lost laptop" recovery; trivial to add; pending decision.
- Whether managed ComfyUI install should refuse to start if the host has known-vulnerable custom nodes pinned. Currently warns; may upgrade to refuse.
- Tunnel mechanism for post-v1 Internet reachability (tracked in `tech.md` deferred decisions).
