// Expo Router entry. Replaces registerRootComponent — expo-router mounts the
// root layout at apps/mobile/app/_layout.tsx and drives every route from the
// app/ directory tree. See spec app-shell-navigation/design.md (v0.2 addendum).
//
// Web target lives in `index.web.ts` — Metro picks the platform-specific
// file automatically when bundling for web. Keeping the web-only Skia/WASM
// loader out of this file is critical: Metro analyses imports statically
// (even inside `if (Platform.OS === 'web')`), so any reference to
// `canvaskit-wasm` here would crash the iOS bundle on its `import "fs"`.
import 'expo-router/entry';
