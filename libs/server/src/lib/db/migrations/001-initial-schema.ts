/**
 * Initial schema (B.2).
 *
 * Persists every entity declared in `requirements.md` §3.9 / `design.md`
 * §4.6: documents, layers, regions, control_layers, presets, models,
 * history_items, jobs, tokens, audit, pairing_requests, and a `blobs` lookup
 * for filesystem-backed image data.
 *
 * Indexes are placed on hot-path columns (history-by-document, jobs-by-status,
 * audit-by-timestamp, tokens-by-hash).
 */

import type { Database as DB } from 'better-sqlite3';
import type { Migration } from '../migrator.js';

const SQL = `
  -- Documents -----------------------------------------------------------
  CREATE TABLE documents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    w           INTEGER NOT NULL,
    h           INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    modified_at TEXT NOT NULL
  );

  -- Layers --------------------------------------------------------------
  CREATE TABLE layers (
    id              TEXT PRIMARY KEY,
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    position        INTEGER NOT NULL,
    opacity         REAL NOT NULL DEFAULT 1.0,
    blend           TEXT NOT NULL DEFAULT 'normal',
    visible         INTEGER NOT NULL DEFAULT 1,
    content_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_layers_doc ON layers(document_id, position);

  -- Selections (per-document active selection mask) --------------------
  CREATE TABLE selections (
    document_id  TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    mask_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
    bounds_json  TEXT,
    updated_at   TEXT NOT NULL
  );

  -- Regions (per-area prompts tied to paint layer opacity) -------------
  CREATE TABLE regions (
    id             TEXT PRIMARY KEY,
    document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    paint_layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    prompt         TEXT NOT NULL
  );
  CREATE INDEX idx_regions_doc ON regions(document_id);

  -- Control layers ------------------------------------------------------
  CREATE TABLE control_layers (
    id            TEXT PRIMARY KEY,
    document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    image_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
    weight        REAL NOT NULL DEFAULT 1.0,
    scope         TEXT NOT NULL DEFAULT 'document'
  );
  CREATE INDEX idx_control_doc ON control_layers(document_id);

  -- Presets -------------------------------------------------------------
  CREATE TABLE presets (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    model          TEXT NOT NULL,
    sampler        TEXT NOT NULL,
    loras_json     TEXT NOT NULL DEFAULT '[]',
    defaults_json  TEXT NOT NULL DEFAULT '{}'
  );

  -- Models registry cache ----------------------------------------------
  CREATE TABLE models (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    size           INTEGER NOT NULL,
    integrity_hash TEXT
  );

  -- Blobs lookup (filesystem-backed; rows track metadata) --------------
  CREATE TABLE blobs (
    id          TEXT PRIMARY KEY,
    sha256      TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    mime        TEXT NOT NULL,
    rel_path    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT
  );
  CREATE INDEX idx_blobs_sha ON blobs(sha256);
  CREATE INDEX idx_blobs_expires ON blobs(expires_at);

  -- History items (preview-then-apply log per P8) ----------------------
  CREATE TABLE history_items (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    job_id              TEXT,
    prompt              TEXT NOT NULL,
    parameters_json     TEXT NOT NULL,
    image_blob_id       TEXT REFERENCES blobs(id) ON DELETE SET NULL,
    thumbnail_blob_id   TEXT REFERENCES blobs(id) ON DELETE SET NULL,
    applied_to_layer_id TEXT REFERENCES layers(id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX idx_history_doc ON history_items(document_id, created_at);

  -- Jobs (mirrors ComfyUI's queue with our metadata) -------------------
  CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,
    prompt_id       TEXT,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL,
    progress        INTEGER NOT NULL DEFAULT 0,
    parameters_json TEXT NOT NULL DEFAULT '{}',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    error_json      TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status, created_at);
  CREATE INDEX idx_jobs_prompt ON jobs(prompt_id);

  -- Tokens (paired devices / agents) -----------------------------------
  CREATE TABLE tokens (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    hash         TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT
  );
  CREATE INDEX idx_tokens_hash ON tokens(hash) WHERE revoked_at IS NULL;

  -- Audit log -----------------------------------------------------------
  CREATE TABLE audit (
    id           TEXT PRIMARY KEY,
    token_id     TEXT,
    token_name   TEXT NOT NULL,
    operation    TEXT NOT NULL,
    args_summary TEXT NOT NULL,
    ts           TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    latency_ms   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_audit_ts ON audit(ts);
  CREATE INDEX idx_audit_token ON audit(token_id, ts);

  -- Pairing requests (transient log of pair attempts) ------------------
  CREATE TABLE pairing_requests (
    id             TEXT PRIMARY KEY,
    candidate_name TEXT NOT NULL,
    requested_at   TEXT NOT NULL,
    approved_at    TEXT,
    rejected_at    TEXT,
    issued_token_id TEXT REFERENCES tokens(id) ON DELETE SET NULL
  );
`;

const migration: Migration = {
  name: '001-initial-schema',
  up(db: DB): void {
    db.exec(SQL);
  },
};

export default migration;
