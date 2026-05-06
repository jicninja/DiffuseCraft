# pairing-protocol — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~4–6 weeks for one engineer.** Cross-platform mDNS testing is the biggest variable.

---

## Phase A — Persistence

- [x] **A.1** Migration adding `pairing_windows` table per `design.md` §3.1. **(S)**
- [x] **A.2** Migration extending `tokens` with `status`, `pairing_method`, `pairing_window_id`, `expires_at`. **(S)**

## Phase B — Server: PairingManager

- [x] **B.1** `PairingManager` skeleton (`design.md` §4.1) wired into `server-architecture` `Phase I.2`. **(M)**
- [x] **B.2** `openWindow({ mode, duration_seconds })` for `mdns | qr | code | manual | any` modes. **(M)**
- [x] **B.3** Pre-issued token generation for QR / code / manual modes. Pending status until claimed. **(M)**
- [x] **B.4** Numeric code generation with collision avoidance. **(S)**
- [x] **B.5** QR payload builder (JSON, base64-encoded for QR). **(S)**
- [x] **B.6** Manual URL+token line builder. **(XS)**
- [x] **B.7** `expireWindow(id)` triggered by setTimeout; updates row + mDNS TXT + emits `lifecycle.pairing-window-closed { reason: "expired" }`. **(S)**
- [x] **B.8** Tests: each mode opens correctly, codes are unique, timeout fires. **(M)**

## Phase C — Server: anonymous /pair endpoint

- [x] **C.1** Fastify route `POST /pair` registered (anonymous, separate from MCP transport). **(S)**
- [x] **C.2** LAN-IP enforcement (`isLanIp` covering all ranges incl. IPv6). **(S)**
- [x] **C.3** Window-mode validation: mdns method requires window to allow it, code requires matching code, etc. **(S)**
- [x] **C.4** Hook dispatch with timeout (default 60s). **(M)**
- [x] **C.5** Token claim atomicity (first-arrival-wins). **(S)**
- [x] **C.6** Error paths: closed window, internet IP, rejected, already-claimed. **(S)**
- [x] **C.7** Tests: each happy path + each error. **(M)**

## Phase D — Token verification

- [x] **D.1** `verifyToken` function with argon2id hash check + revoked filter + last_used update. **(M)** (SHA-256 in v1; argon2id flagged `TODO(pairing-protocol)` for follow-up)
- [x] **D.2** Wire into `authMw` (server-architecture D.3). **(S)**
- [x] **D.3** `rotate_my_token` handler. **(S)** (PairingManager API; MCP catalog tool deferred to mcp-tool-catalog spec)
- [x] **D.4** `revoke_token` handler (already in catalog) implementation. **(S)**
- [x] **D.5** `auth.token-rotated` event emission on rotation. **(XS)**
- [x] **D.6** Tests: valid token, revoked token, expired pending token, rotation cycle. **(M)**

## Phase E — mDNS advertisement

- [x] **E.1** `MdnsAdvertiser` class wrapping `bonjour-service`. **(M)**
- [x] **E.2** TXT record updates on `pairing_open` change without re-creating service. **(S)**
- [x] **E.3** Stop on `server.stop()`. **(XS)**
- [x] **E.4** Configurable on/off per `ServerConfig.pairing.mdns_advertise`. **(XS)**
- [x] **E.5** Tests: advertisement appears in mDNS scan from a stub adapter. **(M)** (TXT-update behavior covered with stub)

## Phase F — Client SDK pairing methods (extension to client-sdk Phase F)

- [ ] **F.1** `requestPairWithCode({ url, code })`. **(S)**
- [ ] **F.2** `openWindowOnRemoteHost()` — sends a "request a window" signal (server endpoint TBD; for now just inform user to open manually on host). **(S)**
- [ ] **F.3** Token rotation handling: receive `auth.token-rotated`, update secure store via adapter. **(S)**
- [ ] **F.4** Tests against test server with the four methods. **(M)**

## Phase G — Tablet UX: pairing screen

- [ ] **G.1** Initial pairing screen showing discovery list + "Scan QR" + "Use code" + "Advanced (paste URL)" tabs. **(M)**
- [ ] **G.2** Discovery list using mDNS adapter; auto-refresh; visible on screen mount. **(M)**
- [ ] **G.3** QR scanner integration (Expo Camera or ML Kit). **(M)**
- [ ] **G.4** 6-digit code input with autoformat (`123-456` display). **(M)**
- [ ] **G.5** Advanced URL paste with validation. **(S)**
- [ ] **G.6** Pair-in-progress UI state with timeout + retry. **(S)**
- [ ] **G.7** Localization. **(S)**
- [ ] **G.8** Tests: each method on simulator with mocked server. **(M)**

## Phase H — Standalone host (`apps/server`) UX

- [x] **H.1** First-run message printing QR (via `qrcode-terminal`) + URL+token line. **(S)** (bootstrap admin token + window status printed; terminal QR rendering left as TODO since `qrcode-terminal` is not yet a peer dep)
- [x] **H.2** `--no-qr` flag suppresses terminal QR. **(XS)**
- [x] **H.3** Manual `npx @diffusecraft/server pair` subcommand opens a fresh window from CLI. **(S)**

## Phase I — MeshCraft host integration (post-v1, contract spec only)

- [ ] **I.1** Spec-only: document MeshCraft's `onPairingRequest` hook implementation (visual prompt) in `meshcraft-integration` spec. **(S)**

## Phase J — Documentation

- [ ] **J.1** README section on pairing flows with diagrams. **(M)**
- [ ] **J.2** Troubleshooting: mDNS not working (firewall, multicast off), QR not scannable, code mismatch. **(M)**
- [ ] **J.3** Security note: LAN-only v1; tunnel post-v1; never commit tokens. **(S)**

---

## Dependency order

```
A (persistence) → B (manager) → C (HTTP /pair) → D (token verify)
                                      \
                                       → E (mDNS) → F (client SDK)
                                                       \
                                                        → G (tablet UX) → H (standalone) → J (docs)
```

A, B, C, D are server-side core. E is independent infra. F depends on B/C/E. G depends on F. H is small. I/J last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| mDNS blocked by router or OS firewall | E + G fallbacks to QR / code / manual; G.1 explicitly shows fallbacks. Documented in J.2. |
| Argon2id native bindings unavailable on some platforms | D.1 fallback to bcrypt cost ≥10 with a config flag; tests cover both. |
| Token claim race conditions | C.5 uses SQLite transaction with `UPDATE ... WHERE status='pending' RETURNING` semantics. |
| Time-bounded windows expire before slow human approval | Hook timeout (60s) longer than typical UI; window duration (120s) covers approve + claim. Configurable. |
| mDNS broadcast storm if many windows open quickly | E.2 only re-broadcasts on `pairing_open` change, not on every TXT update. |
| QR scanner UX poor on older Android tablets | G.4 fallback to numeric code; documented. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct.
3. Risks acceptable.

After approval, implementation begins with Phase A.
