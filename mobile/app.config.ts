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
  ios: {
    supportsTablet: true,
  },
  android: {
    package: "com.libreascent.app",
    adaptiveIcon: {
      backgroundColor: "#0B1215",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    permissions: [
      "INTERNET",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_SPECIAL_USE",
      "SYSTEM_ALERT_WINDOW",
      // Lets the foreground service read the foreground app while banking mode
      // has the accessibility service switched off. Granted by the user in
      // Settings; it is not a runtime permission.
      "PACKAGE_USAGE_STATS",
      "RECEIVE_BOOT_COMPLETED",
      "POST_NOTIFICATIONS",
      "BIND_ACCESSIBILITY_SERVICE",
      "BIND_DEVICE_ADMIN",
      "BIND_VPN_SERVICE",
      "WRITE_SECURE_SETTINGS",
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
          compileSdkVersion: 36,
          largeHeap: true,
          minSdkVersion: 35,
          targetSdkVersion: 36,
          // android/ is prebuild-generated, so the minify flag and the keep
          // rules live here: a regenerated gradle.properties/proguard-rules.pro
          // would otherwise drop them, restoring release log output with no
          // build failure to notice.
          enableMinifyInReleaseBuilds: true,
          extraProguardRules: [
            "# react-native-reanimated",
            "-keep class com.swmansion.reanimated.** { *; }",
            "-keep class com.facebook.react.turbomodule.** { *; }",
            "",
            "# Keep obfuscated release stack traces deobfuscatable via mapping.txt.",
            "-keepattributes SourceFile,LineNumberTable",
            "-renamesourcefileattribute SourceFile",
            "",
            "# Strip debug/verbose logging in release builds.",
            "-assumenosideeffects class android.util.Log {",
            "    public static *** d(...);",
            "    public static *** v(...);",
            "}",
            "",
            "# Deliberate redundancy over AAPT's auto-generated keeps: cheap",
            "# insurance on the app's core services and receivers.",
            "-keep class expo.modules.freedomaccessibility.FreedomAccessibilityService { *; }",
            "-keep class expo.modules.freedomaccessibility.BankingRestoreReceiver { *; }",
            "-keep class expo.modules.freedomvpn.FreedomVpnService { *; }",
            "-keep class expo.modules.freedomforeground.FreedomForegroundService { *; }",
            "-keep class expo.modules.freedomforeground.BootReceiver { *; }",
            "-keep class expo.modules.freedomoverlay.OverlayService { *; }",
            "-keep class expo.modules.freedomdeviceadmin.FreedomDeviceAdminReceiver { *; }",
          ].join("\n"),
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
    "expo-asset",
    "expo-image",
    "expo-sharing",
    "expo-web-browser",
    "./plugins/withReleaseSigning",
    "./plugins/withAndroidPackageFix",
    "./plugins/withJvmTarget17",
    "./plugins/withArm64Only",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
