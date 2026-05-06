/**
 * Hook registry (K.1, design.md §4.9).
 *
 * Typed callback registration points for hosts. Required hooks for v1:
 *   - `onPairingRequest`
 *   - `onAuditEntry`
 *   - `onJobLifecycle`
 *   - `addCustomTool`
 *
 * Per-hook timeout (K.2, default 60s) prevents a slow host from deadlocking
 * the server. Beyond timeout, the call is treated as rejected (Q2).
 */

import type { z } from 'zod';
import type { Unsubscribe } from '../../types/lifecycle.js';
import type { ToolDefinition } from '../catalog/types.js';
import type { ToolHandler } from '../../types/handler-context.js';
import type { AuditEntry } from '../audit/log.js';

export interface PairingRequest {
  candidate_name: string;
  request_id: string;
  /** Optional fingerprint sent by the candidate (mDNS/QR claim id). */
  claim_id?: string;
}

export interface PairingDecision {
  approved: boolean;
  reason?: string;
}

export type PairingRequestHandler = (req: PairingRequest) => Promise<PairingDecision> | PairingDecision;

export interface JobLifecycleEvent {
  job_id: string;
  kind: 'submitted' | 'started' | 'completed' | 'cancelled' | 'failed';
  ts: string;
  metadata?: Record<string, unknown>;
}

export interface CustomToolRegistration<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  tool: ToolDefinition<I, O>;
  handler: ToolHandler<I, O>;
}

export class HookRegistry {
  private readonly pairing: Array<{ fn: PairingRequestHandler; timeout_ms: number }> = [];
  private readonly auditSubs = new Set<(entry: AuditEntry) => void>();
  private readonly jobLifecycleSubs = new Set<(e: JobLifecycleEvent) => void>();
  private readonly customTools: CustomToolRegistration[] = [];

  onPairingRequest(handler: PairingRequestHandler, opts?: { timeout_ms?: number }): Unsubscribe {
    const entry = { fn: handler, timeout_ms: opts?.timeout_ms ?? 60_000 };
    this.pairing.push(entry);
    return () => {
      const idx = this.pairing.indexOf(entry);
      if (idx >= 0) this.pairing.splice(idx, 1);
    };
  }

  onAuditEntry(handler: (entry: AuditEntry) => void): Unsubscribe {
    this.auditSubs.add(handler);
    return () => this.auditSubs.delete(handler);
  }

  onJobLifecycle(handler: (e: JobLifecycleEvent) => void): Unsubscribe {
    this.jobLifecycleSubs.add(handler);
    return () => this.jobLifecycleSubs.delete(handler);
  }

  addCustomTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
    tool: ToolDefinition<I, O>,
    handler: ToolHandler<I, O>,
  ): Unsubscribe {
    const reg = { tool, handler } as CustomToolRegistration<I, O>;
    this.customTools.push(reg as unknown as CustomToolRegistration);
    return () => {
      const idx = this.customTools.indexOf(reg as unknown as CustomToolRegistration);
      if (idx >= 0) this.customTools.splice(idx, 1);
    };
  }

  // ---- Internal dispatchers ------------------------------------------------

  /** Run all pairing handlers in parallel; first rejection wins. Default-approve when no handlers (FR-Q2). */
  async dispatchPairingRequest(req: PairingRequest): Promise<PairingDecision> {
    if (this.pairing.length === 0) {
      return { approved: true, reason: 'no-handler-default-approve-during-window' };
    }
    const promises = this.pairing.map(({ fn, timeout_ms }) =>
      Promise.race<PairingDecision>([
        Promise.resolve(fn(req)),
        new Promise<PairingDecision>((resolve) =>
          setTimeout(() => resolve({ approved: false, reason: 'timeout' }), timeout_ms),
        ),
      ]),
    );
    const decisions = await Promise.all(promises);
    const reject = decisions.find((d) => !d.approved);
    return reject ?? { approved: true };
  }

  notifyAudit(entry: AuditEntry): void {
    for (const sub of this.auditSubs) {
      try {
        sub(entry);
      } catch {
        /* swallow per K.4: hook errors don't bubble */
      }
    }
  }

  notifyJobLifecycle(event: JobLifecycleEvent): void {
    for (const sub of this.jobLifecycleSubs) {
      try {
        sub(event);
      } catch {
        /* swallow */
      }
    }
  }

  listCustomTools(): readonly CustomToolRegistration[] {
    return this.customTools;
  }
}
