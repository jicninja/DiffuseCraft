# pairing-protocol — Design

> **Companion to:** `requirements.md`. **References:** `server-architecture` §4.8 (mDNS), §4.9 (HookRegistry), §3.4 (embedding hooks); `client-sdk` §9 (PairingClient); P18.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **mDNS always on** with `pairing_open` flag; tablets can request a window when none open. |
| Q2 | **Standalone prints QR + URL+token line** on terminal; MeshCraft renders in UI; `--no-qr` flag available. |
| Q3 | **Pair endpoint is anonymous** during open window from LAN address; everything else requires token. |
| Q4 | **`auth.token-rotated` event** emitted on rotation; client SDK syncs secure store. |
| Q5 | **First-arrival-wins atomic claim** in SQLite; second gets `PAIRING_TOKEN_ALREADY_CLAIMED`. |
| Q6 | **6-digit numeric code is enough.** Re-roll on collision within window. |

## 2. Wire protocol

### 2.1 mDNS service record

```
TYPE: _diffusecraft._tcp.local
NAME: <host_name>             ; e.g., "iMac de Igna"
PORT: <http port>
TXT (per record, semicolon-separated):
  v=1                          ; protocol version
  cv=1.0.0                     ; catalog version
  sn=iMac de Igna              ; server_name (human-readable)
  po=true|false                ; pairing_open
  pm=mdns,qr,code,manual       ; supported pairing methods
```

### 2.2 HTTP endpoints (anonymous during pairing)

```
POST /pair
  Headers: (no Authorization)
  Body (JSON):
    {
      "v": 1,
      "method": "mdns" | "qr" | "code" | "manual",
      "candidate_name": "iPad de Igna",
      "code": "123456"           // only for method=code
    }

  Responses:
    200 OK
    {
      "token": "dcft_<base32>",
      "token_id": "01HZK...",
      "token_name": "iPad de Igna",
      "server_name": "iMac de Igna",
      "catalog_version": "1.0.0"
    }

    403 PAIRING_WINDOW_CLOSED { hint: "Ask host to open a window." }
    403 INTERNET_PAIRING_NOT_SUPPORTED { hint: "Use a tunnel; see docs." }
    403 PAIRING_REJECTED { reason }
    403 PAIRING_TOKEN_ALREADY_CLAIMED
    400 INVALID_INPUT { field_path, hint }
```

### 2.3 QR payload (JSON, base64-encoded for QR robustness)

```json
{
  "v": 1,
  "url": "http://192.168.1.42:7860",
  "ip": "192.168.1.42",
  "port": 7860,
  "token": "dcft_<32B-base32>",
  "token_id": "01HZK...",
  "server_name": "iMac de Igna",
  "issued_at": "2026-05-04T12:00:00Z",
  "expires_at": "2026-05-04T12:02:00Z"
}
```

The QR mode is special: token is **pre-issued** at QR generation time and stored as `pending` in `tokens` table. On first use, `pending` flips to `active`. After `expires_at`, the token is auto-revoked if still pending.

### 2.4 Numeric code mode

Server generates a 6-digit code; binds it to a pre-issued pending token. Client posts:
```
POST /pair { method: "code", code: "123456", candidate_name: "..." }
```
Server matches code, flips token from `pending` to `active`, returns it.

### 2.5 Manual URL+token paste

Server log line:
```
http://192.168.1.42:7860?t=dcft_<base32>
```
Client connects directly to the URL with the token in `Authorization: Bearer`. No `/pair` call.

The `t` query parameter is for convenience; the server **never** accepts the token via query string for normal operations — only at first-connect to "claim" the manually-distributed token, which then gets stored properly.

## 3. Data model

### 3.1 `pairing_windows` table

```sql
CREATE TABLE pairing_windows (
  id              TEXT PRIMARY KEY,
  opened_at       TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  closed_at       TEXT NULL,
  close_reason    TEXT NULL,         -- "expired" | "claimed" | "stopped"
  mode            TEXT NOT NULL,      -- "mdns" | "qr" | "code" | "manual" | "any"
  numeric_code    TEXT NULL,          -- only for code mode
  pre_issued_token_id TEXT NULL       -- only for qr / code / manual modes
);
```

### 3.2 Extension to `tokens` table

```sql
ALTER TABLE tokens ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
   -- "pending" | "active" | "revoked"
ALTER TABLE tokens ADD COLUMN pairing_method TEXT NULL;
ALTER TABLE tokens ADD COLUMN pairing_window_id TEXT NULL;
ALTER TABLE tokens ADD COLUMN expires_at TEXT NULL;
   -- only for pending tokens; null for active (single-tier non-expiring)
```

## 4. Server-side implementation

### 4.1 Pairing manager

```typescript
// libs/server/src/lib/pairing/manager.ts
export class PairingManager {
  constructor(
    private db: SQLite,
    private bus: EventBus,
    private hooks: HookRegistry,
    private mdns: MdnsAdvertiser,
    private logger: Logger,
    private config: ServerConfig["pairing"]
  ) {}

  /** Open a pairing window. Called on first run + by host UI ("Add device"). */
  async openWindow(opts: { duration_seconds?: number; mode?: "any" | "mdns" | "qr" | "code"; preGenerateCode?: boolean }): Promise<{ window_id: string; numeric_code?: string; qr_payload?: string; manual_url?: string }> {
    const id = ulid();
    const now = new Date();
    const expires = new Date(now.getTime() + (opts.duration_seconds ?? this.config.window_seconds) * 1000);
    let numeric_code: string | undefined;
    let pre_issued_token_id: string | undefined;
    let qr_payload: string | undefined;
    let manual_url: string | undefined;

    if (opts.mode === "code") numeric_code = await this.generateUniqueCode();
    if (opts.mode === "qr" || opts.mode === "code" || opts.mode === "manual") {
      const { token_id, cleartext } = await this.issuePendingToken(id, expires);
      pre_issued_token_id = token_id;
      if (opts.mode === "qr") qr_payload = this.buildQrPayload(cleartext, expires);
      if (opts.mode === "manual") manual_url = this.buildManualUrl(cleartext);
    }

    this.db.exec(
      "INSERT INTO pairing_windows (id, opened_at, expires_at, mode, numeric_code, pre_issued_token_id) VALUES (?,?,?,?,?,?)",
      id, now.toISOString(), expires.toISOString(), opts.mode ?? "any", numeric_code, pre_issued_token_id
    );

    this.mdns.updateTxt({ pairing_open: true });
    this.bus.publish({ name: "lifecycle.pairing-window-open", payload: { window_id: id, expires_at: expires.toISOString() } });

    setTimeout(() => this.expireWindow(id), expires.getTime() - now.getTime());

    return { window_id: id, numeric_code, qr_payload, manual_url };
  }

  /** Handle anonymous POST /pair from a candidate. */
  async handlePairRequest(req: PairRequest, sourceIp: string): Promise<PairResponse> {
    if (!isLanIp(sourceIp)) {
      throw new HttpError(403, "INTERNET_PAIRING_NOT_SUPPORTED", "Internet pairing requires a tunnel; see docs.");
    }
    const window = await this.findOpenWindow(req.method, req.code);
    if (!window) throw new HttpError(403, "PAIRING_WINDOW_CLOSED");

    // hook approval
    const decision = await this.hooks.dispatchPairingRequest(
      { candidate_name: req.candidate_name, source: { method: req.method }, window_id: window.id },
      this.config.hook_timeout_ms ?? 60_000
    );
    if (!decision.approved) throw new HttpError(403, "PAIRING_REJECTED", decision.reason);

    // issue or claim token
    let cleartext: string;
    let token_id: string;
    if (window.pre_issued_token_id) {
      // QR / code / manual: claim the pre-issued
      const claimed = await this.claimPendingToken(window.pre_issued_token_id, req.candidate_name);
      if (!claimed) throw new HttpError(403, "PAIRING_TOKEN_ALREADY_CLAIMED");
      cleartext = claimed.cleartext;
      token_id = window.pre_issued_token_id;
    } else {
      // mdns / any: issue fresh
      ({ cleartext, token_id } = await this.issueActiveToken(req.candidate_name, window.id, req.method));
    }

    return {
      token: cleartext,
      token_id,
      token_name: req.candidate_name,
      server_name: this.config.server_name ?? this.config.host_name,
      catalog_version: CATALOG_VERSION,
    };
  }

  private async generateUniqueCode(): Promise<string> {
    while (true) {
      const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      const exists = this.db.queryOne(
        "SELECT id FROM pairing_windows WHERE numeric_code = ? AND closed_at IS NULL", code
      );
      if (!exists) return code;
    }
  }

  // ...issuePendingToken, claimPendingToken, expireWindow, etc.
}
```

### 4.2 Token verification (used by `authMw`)

```typescript
// libs/server/src/lib/pairing/verify.ts
export async function verifyToken(rawToken: string, db: SQLite): Promise<TokenContext | null> {
  // Hash check via constant-time comparison
  const tokens = db.query<TokenRow>("SELECT id, name, hash, status, revoked_at FROM tokens WHERE status = 'active'");
  for (const t of tokens) {
    if (await argon2id.verify(t.hash, rawToken)) {
      if (t.revoked_at) return null;
      db.exec("UPDATE tokens SET last_used_at = ? WHERE id = ?", new Date().toISOString(), t.id);
      return { token_id: t.id, token_name: t.name };
    }
  }
  return null;
}
```

Note: linear scan is acceptable for typical paired-device counts (< 50). For larger deployments, store an HMAC-of-token as a search key alongside the hash.

### 4.3 Token rotation

```typescript
// libs/server/src/lib/handlers/rotate-my-token.ts
export const rotateMyTokenHandler: Handler<typeof rotateMyToken> = async (input, ctx) => {
  const oldToken = ctx.tokenId;   // from authMw
  const cleartext = await generateToken();
  const hash = await argon2id.hash(cleartext);
  ctx.db.transaction(() => {
    ctx.db.exec("INSERT INTO tokens (id, name, hash, status, created_at) VALUES (?,?,?,'active',?)",
      ulid(), ctx.tokenName, hash, now());
    ctx.db.exec("UPDATE tokens SET status='revoked', revoked_at=? WHERE id=?", now(), oldToken);
  });
  ctx.bus.publish({ name: "auth.token-rotated", payload: { old_token_id: oldToken, new_token_id: ... } });
  return { new_token: cleartext };
};
```

## 5. Client-side (`client-sdk` integration)

The `PairingClient` already has `discover`, `requestPair`, `parseQr`, `parseManual` (per `client-sdk` design.md §9). New methods for v1:

```typescript
client.pairing.requestPairWithCode(opts: { url: string; code: string }): Promise<PairResult>;
client.pairing.openWindowOnRemoteHost(): Promise<void>;   // sends a "request a window" signal via mDNS or anonymous endpoint
```

## 6. UX flows

### 6.1 First run (mDNS auto-window)

```
1. User installs server + tablet app.
2. User runs `npx @diffusecraft/server`.
3. Server detects no tokens → opens 120s window with mode="any".
4. Server prints QR + URL+token line to terminal as fallbacks.
5. mDNS advertises with pairing_open=true.
6. User opens tablet app on the same LAN.
7. Tablet's pairing screen shows "DiffuseCraft on iMac de Igna".
8. User taps. Tablet sends POST /pair { method: "mdns", candidate_name: "iPad de Igna" }.
9. Server: window open + mDNS mode allowed + LAN ip → no hook (npx) → auto-approve → issue token.
10. Tablet receives token, stores in secure-store, transitions to connected.
11. Server publishes lifecycle.pairing-window-closed { reason: "claimed" }.
```

### 6.2 MeshCraft "Add device"

```
1. User clicks "Add device" in MeshCraft.
2. MeshCraft host calls server.pairing.openWindow({ mode: "any", duration_seconds: 120 }).
3. MeshCraft also calls server.pairing.openWindow({ mode: "qr" }) to generate a QR for display.
4. MeshCraft UI shows a dialog with QR + "DiffuseCraft on Igna's MacBook" hint + remaining time.
5. Tablet on same LAN finds entry via mDNS (or scans the QR if mDNS blocked).
6. Tablet sends pair request.
7. Server's onPairingRequest hook (registered by MeshCraft) → MeshCraft displays "iPad de Igna wants to pair. Approve?".
8. User approves.
9. Server issues token.
10. MeshCraft dialog closes; tablet connected.
```

### 6.3 Numeric code (no camera)

```
1. User on tablet selects "Use code".
2. Tablet shows: "Enter the 6-digit code shown on your server."
3. (Server-side) Host has called openWindow({ mode: "code" }); code is "847-219" displayed on host UI.
4. User types 847219 on tablet.
5. Tablet sends POST /pair { method: "code", code: "847219", candidate_name: "..." }.
6. Server validates code matches active window, claims pre-issued token, returns it.
```

## 7. Sequence diagram (key happy path)

```
Tablet                      mDNS                    Server                  HookRegistry
  │                          │                        │                          │
  │ scan _diffusecraft._tcp  │                        │                          │
  │ ◄───────────────────────│ advertisement (pairing_open=true)                  │
  │                                                                              │
  │ POST /pair  { method: "mdns", candidate_name: "iPad" } (LAN ip)              │
  │ ───────────────────────────────────────────────►   │                          │
  │                                                    │ verify window open       │
  │                                                    │ verify LAN ip            │
  │                                                    │ ───────────────────────► │
  │                                                    │ ◄── decision { approved: true }
  │                                                    │ issue token              │
  │                                                    │ persist tokens row       │
  │ ◄── 200 { token, token_id, server_name, ... }     │                          │
  │ store token in secure-store                                                   │
  │ open MCP session with Authorization: Bearer ...                               │
```

## 8. Acceptance criteria

1. mDNS service record format matches `MdnsAdapter` SDK expectations.
2. All four pairing methods have a clean code path through `PairingManager`.
3. Token lifecycle (pending → active → revoked) is unambiguous.
4. LAN-only enforcement covers all common private ranges + IPv6.
5. UX timing targets achievable in test setup.
6. The pre-issued-vs-fresh token logic is consistent across QR / code / manual / mDNS modes.
