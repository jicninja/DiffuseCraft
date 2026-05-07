// Web entry — Metro selects this file (over `index.ts`) when bundling for
// the `web` platform. We must initialise CanvasKit BEFORE expo-router mounts
// React, otherwise `<Canvas>` (react-native-skia's web shim) blows up on
// first paint with `CanvasKit is not defined`. On native, JSI injects the
// Skia bindings at startup — no gating required.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({
  locateFile: (file: string) =>
    `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.41.0/bin/full/${file}`,
})
  .then(() => {
    require('expo-router/entry');
  })
  .catch((err: unknown) => {
    // Surface a visible failure in the browser console — easier to debug
    // than a silent React mount that never happens.
    // eslint-disable-next-line no-console
    console.error('[diffusecraft-web] CanvasKit failed to load', err);
  });
