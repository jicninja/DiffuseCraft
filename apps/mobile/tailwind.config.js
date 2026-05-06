// Re-export the workspace-root config so NativeWind can resolve it from
// `apps/mobile/`. Per FR-2 the workspace-root file is the single source of truth;
// this file MUST NOT diverge.
module.exports = require('../../tailwind.config.js');
