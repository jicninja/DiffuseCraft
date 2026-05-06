module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Reanimated 4 ships worklets as a separate package; the babel plugin
      // moved from `react-native-reanimated/plugin` to
      // `react-native-worklets/plugin`. MUST stay last in the plugin list.
      'react-native-worklets/plugin',
    ],
  };
};
