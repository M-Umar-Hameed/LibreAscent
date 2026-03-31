import { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "LibreAscent",
  slug: "libreascent",
  version: "1.6.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "libreascent",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "com.libreascent.app",
    adaptiveIcon: {
      backgroundColor: "#0B1215",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    edgeToEdgeEnabled: true,
    permissions: [
      "INTERNET",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_SPECIAL_USE",
      "SYSTEM_ALERT_WINDOW",
      "RECEIVE_BOOT_COMPLETED",
      "POST_NOTIFICATIONS",
      "BIND_ACCESSIBILITY_SERVICE",
      "BIND_DEVICE_ADMIN",
      "BIND_VPN_SERVICE",
    ],
  },
  web: {
    output: "static" as const,
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      "expo-build-properties",
      {
        android: {
          largeHeap: true,
        },
      },
    ],
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 300,
        resizeMode: "contain",
        backgroundColor: "#0B1215",
        dark: {
          backgroundColor: "#0B1215",
        },
      },
    ],
    "expo-font",
    "expo-sqlite",
    "./plugins/withAndroidPackageFix",
    "./plugins/withJvmTarget17",
    "./plugins/withArm64Only",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
