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

# Keep obfuscated release stack traces deobfuscatable via mapping.txt.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Strip debug/verbose logging in release builds. Requires minifyEnabled
# (see gradle.properties: android.enableMinifyInReleaseBuilds).
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}

# Deliberate redundancy over AAPT's auto-generated keeps (aapt_rules.txt
# already keeps <init>() for each of these manifest-declared components,
# and R8 doesn't strip/rename overrides of a live android.jar method like
# onAccessibilityEvent/onReceive/onStartCommand/onRevoke/onEnabled). Not
# load-bearing, but cheap insurance on the app's core services/receivers;
# the cost is R8 can't shrink these classes' private internals.
-keep class expo.modules.freedomaccessibility.FreedomAccessibilityService { *; }
-keep class expo.modules.freedomaccessibility.BankingRestoreReceiver { *; }
-keep class expo.modules.freedomvpn.FreedomVpnService { *; }
-keep class expo.modules.freedomforeground.FreedomForegroundService { *; }
-keep class expo.modules.freedomforeground.BootReceiver { *; }
-keep class expo.modules.freedomoverlay.OverlayService { *; }
-keep class expo.modules.freedomdeviceadmin.FreedomDeviceAdminReceiver { *; }
