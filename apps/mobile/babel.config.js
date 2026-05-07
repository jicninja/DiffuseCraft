module.exports = function (api) {
  // Cache key includes the caller platform so the web vs native plugin set
  // doesn't bleed across targets. `api.cache(true)` is incompatible with
  // `api.caller(...)`.
  const platform = api.caller((c) => (c && c.platform) || 'unknown');
  api.cache.using(() => platform);
  const isWeb = platform === 'web';

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Web-only: rewrite `import.meta` → `({})` so libraries that probe
      // `import.meta.env.MODE` (zustand devtools, vite-style code paths)
      // don't blow up the parser. Browsers reject `import.meta` outside an
      // ES module script, and Expo's web HTML serves the bundle as a
      // classic <script>. Native targets keep the syntax — RN registers a
      // polyfill (see InitializeCore).
      ...(isWeb ? [stripImportMeta] : []),
      // Reanimated 4 ships worklets as a separate package; the babel plugin
      // moved from `react-native-reanimated/plugin` to
      // `react-native-worklets/plugin`. MUST stay last in the plugin list.
      'react-native-worklets/plugin',
    ],
  };
};

function stripImportMeta({ types: t }) {
  return {
    name: 'strip-import-meta-web',
    visitor: {
      MetaProperty(path) {
        if (
          path.node.meta?.name === 'import' &&
          path.node.property?.name === 'meta'
        ) {
          path.replaceWith(t.objectExpression([]));
        }
      },
    },
  };
}
