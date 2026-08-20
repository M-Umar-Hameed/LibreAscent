# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# @generated begin expo-build-properties - expo prebuild (DO NOT MODIFY)
# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Keep obfuscated release stack traces deobfuscatable via mapping.txt.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Strip debug/verbose logging in release builds.
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}

# Deliberate redundancy over AAPT's auto-generated keeps: cheap
# insurance on the app's core services and receivers.
-keep class expo.modules.freedomaccessibility.FreedomAccessibilityService { *; }
-keep class expo.modules.freedomaccessibility.BankingRestoreReceiver { *; }
-keep class expo.modules.freedomvpn.FreedomVpnService { *; }
-keep class expo.modules.freedomforeground.FreedomForegroundService { *; }
-keep class expo.modules.freedomforeground.BootReceiver { *; }
-keep class expo.modules.freedomoverlay.OverlayService { *; }
-keep class expo.modules.freedomdeviceadmin.FreedomDeviceAdminReceiver { *; }
# @generated end expo-build-properties