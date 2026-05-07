// Barrel for screen-local mock fixtures.
// Each consumer imports by named export from this barrel:
//   import { MOCK_DOCUMENTS } from '../_mock';
//
// Mocks are deterministic (NFR-4): no Date.now(), no Math.random(),
// no environment reads. Snapshots are byte-stable across machines.

export { MOCK_PAIRED_SERVERS, MOCK_MDNS_DISCOVERED, MOCK_ACTIVE_SERVER } from './servers';
export { MOCK_DOCUMENTS } from './documents';
export { MOCK_LAYERS } from './layers';
export { MOCK_HISTORY } from './historyItems';
export { MOCK_PRESETS } from './presets';
