/**
 * Registry of bundled SQLite migrations applied in lexicographic order at
 * `start()`. New migrations register here.
 */

import type { Migration } from '../migrator.js';
import initialSchema from './001-initial-schema.js';
import pairingProtocol from './002-pairing-protocol.js';
import historyExtensions from './003-history-extensions.js';
import transformTools from './004-transform-tools.js';
import maskSystem from './005-mask-system.js';

export const MIGRATIONS: readonly Migration[] = [
  initialSchema,
  pairingProtocol,
  historyExtensions,
  transformTools,
  maskSystem,
];
