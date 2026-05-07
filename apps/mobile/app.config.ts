import type { ExpoConfig } from 'expo/config';

// Expo configuration for the DiffuseCraft tablet client.
// Tablet-first: iOS supportsTablet, Android tablets, no web platform per tech.md.
const config: ExpoConfig = {
  name: 'DiffuseCraft',
  slug: 'diffusecraft',
  scheme: 'diffusecraft',
  version: '0.0.0',
  orientation: 'default', // portrait + landscape (tablet rotates freely)
  // Asset references (icon, splash, adaptiveIcon.foregroundImage) are
  // commented out until the icon-and-splash spec lands. Expo defaults to
  // its built-in placeholder when these are absent — sufficient for dev
  // client builds. See app.config.ts NOTE at the bottom of the file.
  // icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  // newArchEnabled lives outside ExpoConfig's typed surface in SDK 51; set
  // it via the experimental flag bag without breaking tsc.
  ...({ newArchEnabled: true } as Record<string, unknown>),
  platforms: ['ios', 'android', 'web'], // web added as experimental RN-Web probe (canvas-skia will fail)
  // splash: {
  //   image: './assets/splash.png',
  //   resizeMode: 'contain',
  //   backgroundColor: '#08090B',
  // },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'art.suquia.diffusecraft',
  },
  android: {
    package: 'art.suquia.diffusecraft',
    // adaptiveIcon: {
    //   foregroundImage: './assets/adaptive-icon.png',
    //   backgroundColor: '#08090B',
    // },
    // CHANGE_WIFI_MULTICAST_STATE is required for mDNS discovery to work
    // on Android Wi-Fi networks (acquireMulticastLock).
    permissions: [
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    ],
  },
  // expo-router: file-based routing rooted at apps/mobile/app/. The plugin
  // handles deep-link registration via the `scheme` above; routes under app/
  // map automatically (e.g. app/pair/qr.tsx → diffusecraft://pair/qr).
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission:
          'DiffuseCraft uses the camera to scan the pairing QR code shown on your server screen.',
      },
    ],
  ],
  experiments: {
    // Honour the workspace path aliases declared in tsconfig.base.json so
    // imports like '@diffusecraft/ui' resolve at runtime via Metro.
    tsconfigPaths: true,
  },
  // NOTE: assets/* referenced above are placeholders; real assets land with
  // the icon-and-splash spec (not in design-system-foundation scope).
};

export default config;
