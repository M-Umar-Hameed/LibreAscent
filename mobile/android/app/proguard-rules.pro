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

# Strip debug/verbose logging in release builds. Requires minifyEnabled
# (see gradle.properties: android.enableMinifyInReleaseBuilds).
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}

# The Android framework instantiates these classes by the fully-qualified
# name declared in each module's AndroidManifest.xml (accessibility
# service, VPN service, foreground service, overlay service, device admin
# receiver, boot/banking-restore receivers). R8 can't see that manifest
# reference, so without an explicit keep it can rename or strip them,
# breaking service binding at runtime.
-keep class expo.modules.freedomaccessibility.FreedomAccessibilityService { *; }
-keep class expo.modules.freedomaccessibility.BankingRestoreReceiver { *; }
-keep class expo.modules.freedomvpn.FreedomVpnService { *; }
-keep class expo.modules.freedomforeground.FreedomForegroundService { *; }
-keep class expo.modules.freedomforeground.BootReceiver { *; }
-keep class expo.modules.freedomoverlay.OverlayService { *; }
-keep class expo.modules.freedomdeviceadmin.FreedomDeviceAdminReceiver { *; }
