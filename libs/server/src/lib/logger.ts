/**
 * Structured logging via `pino`.
 *
 * Configured from `ServerConfig.logging`. Redacts known-sensitive fields per
 * FR-41: bearer tokens, base64 image payloads, blob bytes.
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import type { LoggingConfig } from '../types/config.js';

/** Token names + base64 blobs we never log. */
const REDACT_PATHS: string[] = [
  'token',
  'tokens',
  'authorization',
  '*.token',
  '*.authorization',
  'req.headers.authorization',
  'image_b64',
  '*.image_b64',
  'mask_b64',
  '*.mask_b64',
  'blob_bytes',
  '*.blob_bytes',
];

export function createLogger(cfg: LoggingConfig): Logger {
  const opts: LoggerOptions = {
    level: cfg.level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'diffusecraft-server' },
  };
  if (cfg.pretty) {
    opts.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  if (typeof cfg.destination === 'object' && 'file' in cfg.destination) {
    // pino accepts a destination as 2nd arg; keep simple by using stdout
    // unless a file path is given. Real file rotation lives in L.x tasks.
    return pino(opts, undefined);
  }
  return pino(opts);
}
