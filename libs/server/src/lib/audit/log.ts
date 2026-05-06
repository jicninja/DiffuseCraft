/**
 * Audit log (FR-36, D.10).
 *
 * Every tool invocation produces a row keyed by token id+name. Hosts may tap
 * via the `onAuditEntry` hook; agents query via the `get_audit_log` tool +
 * `diffusecraft://audit-log` resource.
 */

import type { Database as DB } from 'better-sqlite3';
import { newId } from '../id.js';

export interface AuditEntry {
  readonly id: string;
  readonly token_id: string | null;
  readonly token_name: string;
  readonly operation: string;
  readonly args_summary: string;
  readonly ts: string;
  readonly outcome: 'ok' | 'error';
  readonly latency_ms: number;
}

export class AuditLog {
  constructor(
    private readonly db: DB,
    private readonly onEntry: (entry: AuditEntry) => void,
  ) {}

  append(args: {
    token_id: string | null;
    token_name: string;
    operation: string;
    args_summary: string;
    outcome: 'ok' | 'error';
    latency_ms: number;
  }): AuditEntry {
    const entry: AuditEntry = {
      id: newId(),
      token_id: args.token_id,
      token_name: args.token_name,
      operation: args.operation,
      args_summary: args.args_summary,
      ts: new Date().toISOString(),
      outcome: args.outcome,
      latency_ms: args.latency_ms,
    };
    this.db
      .prepare<[string, string | null, string, string, string, string, string, number]>(
        'INSERT INTO audit (id, token_id, token_name, operation, args_summary, ts, outcome, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        entry.id,
        entry.token_id,
        entry.token_name,
        entry.operation,
        entry.args_summary,
        entry.ts,
        entry.outcome,
        entry.latency_ms,
      );
    this.onEntry(entry);
    return entry;
  }

  /** Periodic prune: delete rows older than `retention_days` (FR-37). */
  prune(retention_days: number): number {
    const cutoff = new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000).toISOString();
    const res = this.db.prepare<string>('DELETE FROM audit WHERE ts < ?').run(cutoff);
    return Number(res.changes);
  }
}
