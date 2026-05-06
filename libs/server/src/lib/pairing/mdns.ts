/**
 * mDNS advertiser (Phase E, design.md §2.1, FR-1, FR-2, FR-3, NFR-3).
 *
 * Publishes `_diffusecraft._tcp.local` with a TXT record advertising the
 * protocol version, catalog version, server_name, and pairing_open flag.
 * The flag toggles in-place via `BonjourService.updateTxt` so the
 * advertisement does not flap (NFR-3).
 *
 * Wraps `bonjour-service`. Hosts may construct without a logger sink; we
 * default to a structured no-op via the `Logger` argument supplied at
 * construction.
 */

import type { BonjourService } from 'bonjour-service';
import type { Logger } from 'pino';

// `bonjour-service` is a peer dependency that is not always installed in
// the workspace (e.g., during unit testing per CLAUDE.md). The import is
// lazy + dynamic inside `start()` so simply constructing an
// `MdnsAdvertiser` does not require the package.

export interface MdnsAdvertiseOptions {
  /** mDNS service type, default `_diffusecraft._tcp` (no leading underscore in bonjour API). */
  service_name: string;
  /** Friendly host_name visible to discovering clients (FR-1). */
  host_name: string;
  /** TCP port advertised to clients (HTTP transport's bound port). */
  port: number;
  /** Protocol version (`v=` TXT record). */
  protocol_version: string;
  /** Catalog version (`cv=` TXT record). */
  catalog_version: string;
  /** Friendly server name (`sn=` TXT record). */
  server_name: string;
  /** Pairing window currently open? (`po=` TXT record). */
  pairing_open: boolean;
  /** Comma-separated supported pairing methods (`pm=` TXT record). */
  pairing_methods?: ReadonlyArray<'mdns' | 'qr' | 'code' | 'manual'>;
}

const DEFAULT_PAIRING_METHODS: ReadonlyArray<'mdns' | 'qr' | 'code' | 'manual'> = [
  'mdns',
  'qr',
  'code',
  'manual',
];

interface BonjourLike {
  publish(opts: { name: string; type: string; port: number; txt?: Record<string, string> }): BonjourService;
  destroy(): void;
}

export class MdnsAdvertiser {
  private bonjour?: BonjourLike;
  private published?: BonjourService;
  private currentTxt: Record<string, string> = {};

  constructor(private readonly logger: Logger) {}

  async start(opts: MdnsAdvertiseOptions): Promise<void> {
    const mod = (await import('bonjour-service')) as unknown as {
      default: new () => BonjourLike;
    };
    this.bonjour = new mod.default();
    const type = opts.service_name.replace(/^_+/, '').replace(/\._tcp$/, '');
    const txt = this.buildTxt(opts);
    this.currentTxt = { ...txt };
    this.published = this.bonjour.publish({
      name: opts.host_name,
      type,
      port: opts.port,
      txt,
    });
    this.logger.info(
      { name: opts.host_name, port: opts.port, txt },
      'mDNS advertising _diffusecraft._tcp',
    );
  }

  /**
   * Update a subset of TXT fields. Only re-broadcasts when at least one
   * field actually changed (NFR-3). Falls back to per-key mutation on
   * `BonjourService.txt` when the underlying lib lacks `updateTxt`.
   */
  updateTxt(partial: Record<string, string>): void {
    if (!this.published) return;
    let changed = false;
    for (const [k, v] of Object.entries(partial)) {
      if (this.currentTxt[k] !== v) {
        this.currentTxt[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    if (typeof this.published.updateTxt === 'function') {
      this.published.updateTxt({ ...this.currentTxt });
    } else {
      this.published.txt = { ...this.currentTxt };
    }
    this.logger.info({ txt: this.currentTxt }, 'mDNS TXT updated');
  }

  stop(): void {
    if (this.published) {
      this.published.stop();
      this.published = undefined;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = undefined;
    }
  }

  private buildTxt(opts: MdnsAdvertiseOptions): Record<string, string> {
    const methods = (opts.pairing_methods ?? DEFAULT_PAIRING_METHODS).join(',');
    return {
      v: opts.protocol_version,
      cv: opts.catalog_version,
      sn: opts.server_name,
      po: opts.pairing_open ? 'true' : 'false',
      pm: methods,
    };
  }
}
