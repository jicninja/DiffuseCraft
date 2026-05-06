# pairing-protocol — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `server-architecture` (hooks, lifecycle), `client-sdk` (pairing client + adapters), `mcp-tool-catalog` (tools list, resources).
> **References:** P18 (zero-config pairing, single-tier, LAN-first, mDNS-first, tunnel-only Internet post-v1), `inspirations.md` (Plex, WhatsApp Web, Spotify Connect), Q3 / "pairing dead-simple <30s".

## 1. Purpose

This spec defines the wire-level protocol and UX for pairing a client (tablet, agent, MeshCraft external instance) with a DiffuseCraft server. It covers:

- The four pairing methods (mDNS auto-discovery, QR scan, numeric 6-digit code, manual URL+token paste) and when each is used.
- The mDNS service record format the server advertises.
- The QR / manual payload formats.
- The pairing window mechanism (server-side time-bounded acceptance).
- The approval flow (auto-during-window in standalone mode; UI prompt in MeshCraft).
- Token issuance, rotation, and revocation.
- Multi-device support (one server, many paired clients).
- LAN-only enforcement for v1 (Internet via tunnel deferred).

## 2. Stakeholders & user stories

### S1 — Tablet illustrator pairing for the first time
> **Story 1.** As a new user, I install the DiffuseCraft tablet app and `npx @diffusecraft/server` on my desktop. I open the app; it lists "DiffuseCraft on iMac de Igna" via mDNS. I tap it. A "Pairing" indicator shows briefly and I'm in. **Total time: ~10 seconds.**

### S2 — User on a network where mDNS is blocked (corporate, complex router)
> **Story 2.** As a user whose router blocks multicast, I open the app and don't see the server. I tap "Scan QR". The server shows a QR on its terminal output (or in MeshCraft's UI). I scan it; I'm paired.

### S3 — User without a phone camera (e.g., older Android tablet without working camera)
> **Story 3.** As a user with no working camera, I tap "Use code" in the app. The server shows `123-456`. I tap each digit on the tablet. Paired.

### S4 — Power user / agent over CLI
> **Story 4.** As a developer setting up an agent, I copy the URL+token line from the server log: `http://192.168.1.42:7860?t=A7H...`. I paste it into Claude Code's MCP config. The agent is paired.

### S5 — User adding a second device
> **Story 5.** As a user with a paired tablet, I add my partner's tablet. The server still has its mDNS advertisement; the second tablet discovers and pairs the same way. Both stay paired; both can see history; the server tracks two tokens.

### S6 — User revoking a stolen device
> **Story 6.** As a user whose tablet was stolen, I open MeshCraft's "Devices" panel, find "iPad de Igna", tap Revoke. From that moment, the stolen tablet's requests get 401.

### S7 — MeshCraft as host
> **Story 7.** As MeshCraft, on first launch I display a "Pair your tablet" dialog with QR + mDNS hint + a pairing-window countdown. When my user's tablet pairs, my dialog closes; subsequent attempts require explicit user approval via my dialog.

## 3. Functional requirements (EARS)

### 3.1 mDNS service advertisement

**FR-1 (Ubiquitous).** The server SHALL advertise via mDNS using:
- **Service type:** `_diffusecraft._tcp.local`
- **Service name:** `<host_name>` (from `ServerConfig.host_name`, default OS hostname)
- **Port:** the HTTP transport port from `ServerConfig.transports.http.port`
- **TXT records:**
  - `version` = catalog version (e.g., `1.0.0`)
  - `server_name` = human-readable name shown to discovering clients
  - `pairing_open` = `true` | `false` — whether a pairing window is currently open

**FR-2 (Ubiquitous).** mDNS advertisement SHALL be configurable on/off via `ServerConfig.pairing.mdns_advertise` (default `true`).

**FR-3 (Event-driven).** WHEN the pairing window opens or closes, the server SHALL update the `pairing_open` TXT record and re-broadcast.

### 3.2 Pairing window

**FR-4 (Ubiquitous).** A "pairing window" is a server-side time-bounded interval during which it accepts pair requests. Default duration `pairing.window_seconds = 120`. The server SHALL emit `lifecycle.pairing-window-open { expires_at }` when opened and `lifecycle.pairing-window-closed { reason: "expired" | "claimed" | "stopped" }` when closed.

**FR-5 (Event-driven).** ON FIRST RUN (no tokens in DB), the server SHALL automatically open a pairing window on startup (FR-38 of `server-architecture`).

**FR-6 (Ubiquitous).** Subsequent pairing windows SHALL be opened by the host (e.g., MeshCraft "Add device" button → host calls `server.pairing.openWindow({ duration_seconds })`). The server library exposes this as a programmatic API.

**FR-7 (Ubiquitous).** When the pairing window is **closed**, pair requests SHALL be rejected with `PAIRING_WINDOW_CLOSED` and a hint suggesting "ask the host to open a pairing window."

### 3.3 The four pairing methods

**FR-8 (Ubiquitous).** mDNS-first auto-discovery (default):
1. Tablet, on its pairing screen, calls `client.pairing.discover()` which uses the configured `MdnsAdapter`.
2. Tablet shows the list of discovered backends with `pairing_open: true` highlighted.
3. User taps one → tablet calls `requestPair(backend)`.
4. Server invokes `onPairingRequest` hook (FR-12 of `server-architecture`); hook returns approve/reject.
5. On approval, server issues a token, stores it, and responds `200 { token, server_name, token_id, token_name }`.
6. Tablet stores token in secure store, transitions to connected state.

**FR-9 (Ubiquitous).** QR fallback:
- Server can be requested to display a QR encoding the JSON payload (FR-15 below).
- Tablet uses `QrScannerAdapter` to scan; result fed into `client.pairing.parseQr(payload)` which returns the decoded URL+token.
- Tablet then performs a normal connect (token already issued; no claim needed since QR carries it).

**FR-10 (Ubiquitous).** Numeric 6-digit code fallback:
- Tablet UI offers "Use code".
- Server-side, host invokes `server.pairing.openWindowWithCode({ duration_seconds })` which opens a window AND generates a 6-digit code displayed in the host UI / log.
- Tablet calls `client.pairing.requestPairWithCode({ url, code })` (URL discovered or typed manually); server checks the code matches the active window's code, then proceeds as in mDNS path.

**FR-11 (Ubiquitous).** Manual URL+token paste:
- Server log / host UI shows a line: `http://192.168.1.42:7860?t=<token>` during a pairing window or any time the host CLI explicitly emits one for a power user.
- Client calls `client.pairing.parseManual(input)` which constructs a paired connection directly.

### 3.4 Payload formats

**FR-12 (Ubiquitous).** mDNS service record:
```
_diffusecraft._tcp.local
  service_name: "iMac de Igna"
  port: 7860
  TXT:
    version=1.0.0
    server_name=iMac de Igna
    pairing_open=true
```

**FR-13 (Ubiquitous).** QR payload (JSON, base64-encoded for QR robustness):
```json
{
  "v": 1,
  "url": "http://192.168.1.42:7860",
  "ip": "192.168.1.42",
  "port": 7860,
  "token": "<opaque-32-byte-base32>",
  "server_name": "iMac de Igna",
  "issued_at": "2026-05-04T12:00:00Z",
  "expires_at": "2026-05-04T12:02:00Z"
}
```
The `token` field is already-issued at QR generation time; the QR window itself is one-shot (FR-19).

**FR-14 (Ubiquitous).** Numeric code: 6 ASCII digits, formatted with a hyphen for display (`"123-456"`). Internally a 6-digit number; collision-free within a single open window.

**FR-15 (Ubiquitous).** Manual URL+token line: `http://<ip>:<port>?t=<token>` (the `t` query param carries the token).

### 3.5 Token issuance

**FR-16 (Ubiquitous).** Tokens SHALL be opaque random strings of at least 32 bytes, base32-encoded for human-handling robustness. Format: `dcft_<32-byte-base32>` (the `dcft_` prefix is informational, useful in logs).

**FR-17 (Ubiquitous).** Each issued token SHALL be persisted in the `tokens` table with:
- `id` (ULID)
- `name` (suggested by client during pair request: e.g., "iPad de Igna"; default = `<candidate_name>`)
- `hash` (bcrypt or argon2id of the token; cleartext NEVER stored)
- `created_at`
- `last_used_at`
- `revoked_at` (null until revoked)
- `pairing_method` (`mdns` | `qr` | `code` | `manual`) — for audit only
- `pairing_window_id` (FK to the pairing window, for forensics)

**FR-18 (Ubiquitous).** Cleartext token SHALL only be returned **once**, at issuance. The client stores it in secure store; the server never returns it again.

**FR-19 (Ubiquitous).** A QR / numeric-code / manual-URL pairing slot SHALL be one-shot: once a client uses the token for the first request, the pairing window for that specific token closes (other slots remain open if multiple were issued).

### 3.6 Approval flow

**FR-20 (Event-driven).** WHEN a pair request arrives during an open window, THE server SHALL:
1. Validate the candidate's request shape.
2. Verify the pairing window is open and the request matches the window's mode (e.g., code matches if numeric mode).
3. Invoke `onPairingRequest` hook with `{ candidate_name, source: { mdns | qr | code | manual }, window_id }`.
4. If hook approves (or no hook + auto-during-window default), issue token; respond `200 { token, ... }`.
5. If hook rejects, respond `403 PAIRING_REJECTED`.
6. If hook times out (default 60 s), treat as rejected.

**FR-21 (Ubiquitous).** Default behavior when no `onPairingRequest` hook is registered: auto-approve during the window. This applies to `npx @diffusecraft/server` running headless with an open window.

**FR-22 (Ubiquitous).** MeshCraft and any host with UI SHALL register `onPairingRequest` to display a confirmation dialog: name + source + Approve/Reject buttons.

### 3.7 Token rotation & long-lived sessions

**FR-23 (Ubiquitous).** v1 tokens SHALL be **non-expiring** (no `expires_at`); they remain valid until revoked. Per P18, this matches the simplified single-tier model.

**FR-24 (Ubiquitous).** Token rotation SHALL be possible: a paired client may call `rotate_my_token` (write tool, MCP) to receive a new token; the old token is marked `revoked_at` immediately. Rotation cycles do not require pairing window.

**FR-25 (Unwanted).** IF rotation is requested with the wrong current token, THE server SHALL respond 401 and not rotate.

### 3.8 Revocation

**FR-26 (Ubiquitous).** `revoke_token({ token_id })` (already in `mcp-tool-catalog`) sets `revoked_at = now()`. From that moment, requests carrying the revoked token SHALL receive 401 with reason `TOKEN_REVOKED`.

**FR-27 (Ubiquitous).** Revoking the **calling client's own token** SHALL succeed and immediately disconnect that session.

**FR-28 (Ubiquitous).** A revoked token SHALL NOT be reusable; a new pairing is required to re-pair the device.

### 3.9 Multi-device

**FR-29 (Ubiquitous).** Multiple devices MAY be paired simultaneously; each owns its own token. Server enforces no per-device locking — concurrent operations are allowed (per `mcp-tool-catalog` multi-client rules and undo/redo per-client stacks).

**FR-30 (Ubiquitous).** Resource `diffusecraft://server/paired-devices` lists all paired (non-revoked) devices with `id`, `name`, `created_at`, `last_used_at`, `pairing_method`. Used by the host UI's "Devices" panel.

### 3.10 LAN-only enforcement

**FR-31 (Ubiquitous).** v1 SHALL refuse pairing requests where the source IP is not on a private/LAN range:
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16` (link-local)
- `127.0.0.1/8` (loopback)
- IPv6 equivalents (`fe80::/10`, `fc00::/7`, `::1`)

**FR-32 (Unwanted).** IF a pair request arrives from a non-LAN address, THE server SHALL respond `403 INTERNET_PAIRING_NOT_SUPPORTED` with hint pointing to the post-v1 tunnel-based mechanism.

**FR-33 (Ubiquitous).** Internet pairing via tunnel is post-v1 (separate spec); the protocol design above is forward-compatible since tunnels present LAN-like addresses to the server.

### 3.11 UX latency budget

**FR-34 (Ubiquitous).** mDNS discovery → first server appears in tablet's list SHALL be < 5 s on a typical home network.

**FR-35 (Ubiquitous).** From tap-to-pair → connected SHALL be < 5 s when no human approval is required (auto-during-window).

**FR-36 (Ubiquitous).** Total onboarding (open app → first generation possible) SHALL be < 30 s end-to-end on the happy path (mDNS path with auto-window).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Token generation SHALL use a cryptographically-secure RNG (`crypto.randomBytes` in Node).

**NFR-2 (Ubiquitous).** Token hashes SHALL use argon2id (or bcrypt cost ≥10 if argon2 native bindings are unavailable).

**NFR-3 (Ubiquitous).** mDNS broadcast SHALL not flood the network: re-broadcasts at most every 30 s on stable state; immediate re-broadcast when `pairing_open` changes.

## 5. Out of scope

- **Internet reachability via tunnel** — post-v1 separate spec.
- **Token expiration / TTL** — explicitly excluded per P18 simplified model.
- **Account-based identity** (logging in with a Suquía Bytes account) — not v1; cloud sync is not a v1 feature.
- **Web-PKI TLS** — LAN HTTP is acceptable; tunnel mechanisms supply transport encryption when added.

## 6. Open questions

### Q1 — Should mDNS continue advertising even when no pairing window is open?
Pros: clients can find the server pre-emptively. Cons: network noise.

**Recommendation:** **yes**, with `pairing_open=false`. Discovery happens always; pairing only during windows. UX: tablet shows the server with a "tap to request pairing" → which sends a request that triggers the host to open a window.

### Q2 — Should the server display the QR automatically on first run, or only on demand?
First-run could be surprising if no display is available.

**Recommendation:** standalone (`npx`) prints a QR to terminal **and** logs the URL+token line. MeshCraft displays QR in its UI dialog. Optional `--no-qr` flag silences terminal output for headless deployments.

### Q3 — How does the tablet authenticate the **first** request (e.g., trying to discover or send pair request) given it has no token yet?
Pair request endpoint needs an open path.

**Recommendation:** the pair request endpoint (`POST /pair`) is **anonymous** (no token required) but only honored during an open window AND from a LAN address. After issuance, all subsequent requests require the token.

### Q4 — Token storage on first issuance: who is responsible for syncing rotation?
The connection store needs to be updated when rotation happens.

**Recommendation:** rotation handler returns the new token AND emits `auth.token-rotated` event. The client SDK listens, updates secure store via the configured adapter, and re-uses the new token for subsequent requests. Documented in `client-sdk` design.

### Q5 — Race conditions on simultaneous pair requests during one window
Two tablets scan the same QR (one-shot) at the same time.

**Recommendation:** First arrival wins (atomic claim in SQLite). Second receives `PAIRING_TOKEN_ALREADY_CLAIMED`. UX: second user retries with a fresh QR.

### Q6 — Numeric code length and collision
6 digits = 1M codes. With 100 windows per day (rare), collision is effectively zero per-window.

**Recommendation:** 6 digits is enough. Re-roll if collision detected within an open window (atomic check in SQLite).

## 7. Acceptance criteria

This spec is APPROVED when:

1. The seven user stories (§2) are satisfied by the FRs.
2. mDNS service record format (§3.1, §3.4) is unambiguous and aligns with the SDK's `MdnsAdapter`.
3. All four pairing methods cover their respective edge cases.
4. Token lifecycle (issue → rotate → revoke) has no security gaps.
5. LAN-only enforcement is explicit and tested.
6. UX latency budgets (§3.11) are achievable on typical home networks.
7. Open questions have acceptable recommendations.
