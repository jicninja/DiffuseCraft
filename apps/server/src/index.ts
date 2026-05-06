#!/usr/bin/env node
/**
 * apps/server — thin Node entrypoint for `npx @diffusecraft/server`.
 *
 * Parses CLI flags into a `ServerConfig`, calls `createDiffuseCraftServer`,
 * starts the server, and registers SIGTERM/SIGINT handlers for graceful
 * shutdown. Per design.md §6.1, this file is intentionally compact.
 *
 * Subcommands:
 *   - (default)     Start the server. On first run prints bootstrap admin
 *                   token + pairing window status. With `--no-qr` skips
 *                   any terminal QR rendering (placeholder; renderer is
 *                   a peer dep, currently absent).
 *   - `pair`        Start the server (or attach to a running one in the
 *                   future) and immediately open a fresh QR + numeric-code
 *                   pairing window, printing the payloads.
 */

import { parseArgs } from 'node:util';
import {
  createDiffuseCraftServer,
  type ServerConfig,
  ConfigValidationError,
} from '@diffusecraft/server';

interface CliOptions {
  values: Record<string, unknown>;
  positionals: string[];
}

function parseCli(): CliOptions {
  const out = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      comfyui: { type: 'string' },
      stdio: { type: 'boolean' },
      'pairing-window': { type: 'string' },
      'log-level': { type: 'string' },
      'log-pretty': { type: 'boolean' },
      'no-qr': { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  return out as unknown as CliOptions;
}

function buildConfig(values: Record<string, unknown>): Partial<ServerConfig> {
  const portRaw = values['port'];
  const hostRaw = values['host'];
  const comfyuiRaw = values['comfyui'];
  const stdioRaw = values['stdio'];
  const windowRaw = values['pairing-window'];
  const logLevelRaw = values['log-level'];
  const prettyRaw = values['log-pretty'];

  return {
    transports: {
      stdio: stdioRaw === true,
      http: {
        host: typeof hostRaw === 'string' ? hostRaw : '0.0.0.0',
        port: typeof portRaw === 'string' ? Number(portRaw) : 7860,
      },
      inMemory: true,
    },
    comfyui: {
      mode: 'external-local',
      url: typeof comfyuiRaw === 'string' ? comfyuiRaw : 'http://127.0.0.1:8188',
    },
    ...(typeof windowRaw === 'string'
      ? {
          pairing: {
            window_seconds: Number(windowRaw),
            mdns_service_name: 'diffusecraft._tcp',
            mdns_advertise: true,
            qr_fallback_enabled: true,
          },
        }
      : {}),
    ...(typeof logLevelRaw === 'string' || prettyRaw === true
      ? {
          logging: {
            level: (typeof logLevelRaw === 'string'
              ? logLevelRaw
              : 'info') as ServerConfig['logging']['level'],
            pretty: prettyRaw === true,
            destination: 'stdout' as const,
          },
        }
      : {}),
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseCli();
  const subcommand = positionals[0];
  const noQr = values['no-qr'] === true;

  const config = buildConfig(values);

  let server: ReturnType<typeof createDiffuseCraftServer>;
  try {
    server = createDiffuseCraftServer(config);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // eslint-disable-next-line no-console
      console.error(`config error at ${err.field_path}: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  server.on('lifecycle.first-run-pairing-window-open', ({ expires_at }) => {
    // eslint-disable-next-line no-console
    console.log(`[diffusecraft] first-run pairing window open until ${expires_at}`);
  });
  server.on('lifecycle.first-run-pairing-window-expired', () => {
    // eslint-disable-next-line no-console
    console.log('[diffusecraft] first-run pairing window expired');
  });

  const shutdown = async (): Promise<void> => {
    try {
      await server.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  try {
    await server.start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('failed to start server:', (err as Error).message);
    process.exit(1);
  }

  if (subcommand === 'pair') {
    // Open a fresh QR + code window for power-user pairing (H.3).
    const qr = server.pairing.openWindow({ mode: 'qr' });
    const code = server.pairing.openWindow({ mode: 'code' });
    if (!noQr && qr.qr_payload) {
      // eslint-disable-next-line no-console
      console.log(`[diffusecraft] QR payload (base64url JSON): ${qr.qr_payload}`);
    }
    if (qr.manual_url) {
      // eslint-disable-next-line no-console
      console.log(`[diffusecraft] Manual URL: ${qr.manual_url}`);
    }
    if (code.numeric_code_display) {
      // eslint-disable-next-line no-console
      console.log(`[diffusecraft] Pairing code: ${code.numeric_code_display}`);
    }
  }
}

void main();
