// Paired-server fixtures consumed by ServerPicker, Settings/Connection,
// the Editor TopBar connection chip, and any other surface that needs to
// render a "your studios" view. Hardcoded — no API, no randomness.
//
// Per NFR-4 (determinism): timestamps are static ISO strings; the chrome
// formats them on render. No Date.now(), no Math.random() anywhere.

export const MOCK_PAIRED_SERVERS = [
  {
    id: 'srv-studio-imac',
    name: 'studio-iMac',
    ip: '192.168.1.50',
    port: 9876,
    online: true,
    lastSeen: '2026-05-03T18:21:00Z',
    capabilities: { comfyui: true, models: 12 },
  },
  {
    id: 'srv-laptop-meshcraft',
    name: 'laptop (MeshCraft)',
    ip: '192.168.1.74',
    port: 9876,
    online: true,
    lastSeen: '2026-05-03T17:55:00Z',
    capabilities: { comfyui: true, models: 8 },
  },
  {
    id: 'srv-pc-bedroom',
    name: 'PC bedroom',
    ip: '192.168.1.92',
    port: 9876,
    online: false,
    lastSeen: '2026-05-02T22:14:00Z',
    capabilities: { comfyui: true, models: 5 },
  },
] as const;

// 4 servers seen by Pairing/MDNS: the 3 paired ones plus 1 still-unpaired
// candidate. The screen filters/visualises pairing state itself.
export const MOCK_MDNS_DISCOVERED = [
  {
    id: 'srv-studio-imac',
    name: 'studio-iMac',
    ip: '192.168.1.50',
    port: 9876,
    paired: true,
  },
  {
    id: 'srv-laptop-meshcraft',
    name: 'laptop (MeshCraft)',
    ip: '192.168.1.74',
    port: 9876,
    paired: true,
  },
  {
    id: 'srv-pc-bedroom',
    name: 'PC bedroom',
    ip: '192.168.1.92',
    port: 9876,
    paired: true,
  },
  {
    id: 'srv-mac-mini-render',
    name: 'mac-mini-render',
    ip: '192.168.1.31',
    port: 9876,
    paired: false,
  },
] as const;

// The currently-active server for the Editor TopBar chip, etc.
// Matches the first paired server.
export const MOCK_ACTIVE_SERVER = {
  id: 'srv-studio-imac',
  name: 'studio-iMac',
  ip: '192.168.1.50',
  port: 9876,
  online: true,
  lastSeen: '2026-05-03T18:21:00Z',
  capabilities: { comfyui: true, models: 12 },
} as const;
