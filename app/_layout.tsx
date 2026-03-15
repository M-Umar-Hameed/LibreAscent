import { AppLockScreen } from "@/components/AppLockScreen";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import * as Font from "expo-font";
import {
  Stack,
  router,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, useColorScheme } from "react-native";
import "react-native-reanimated";
import "../global.css";

// Prevent splash screen from hiding automatically
// Prevent splash screen from hiding automatically
void SplashScreen.preventAutoHideAsync().catch((_e: unknown) => {
  /* ignore */
});

export default function RootLayout(): ReactNode {
  const isOnboarded = useAppStore((s) => s.isOnboarded);
  const theme = useAppStore((s) => s.theme);
  const hydrateStats = useAppStore((s) => s.hydrateStats);
  const appLockEnabled = useAppStore((s) => s.appLockEnabled);
  const systemColorScheme = useColorScheme();
  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const nativeWind = useNativeWindColorScheme();
  const [isMounted, setIsMounted] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(true);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  // Re-lock when app comes back from background
  useEffect(() => {
    if (!appLockEnabled) {
      setIsLocked(false);
      return;
    }
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        setIsLocked(true);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [appLockEnabled]);

  useEffect(() => {
    async function prepare(): Promise<void> {
      try {
        // Pre-load fonts so icons don't flicker later
        await Font.loadAsync(Ionicons.font);
        hydrateStats();
      } catch (e) {
        console.warn(e);
      } finally {
        setFontsLoaded(true);
        setIsMounted(true);
      }
    }
    void prepare();
  }, [hydrateStats]);

  useEffect(() => {
    if (fontsLoaded && isMounted) {
      void SplashScreen.hideAsync().catch((_e: unknown) => {
        /* ignore */
      });
    }
  }, [fontsLoaded, isMounted]);

  const isDark = useMemo(() => {
    if (theme === "system") return systemColorScheme === "dark";
    return theme === "dark";
  }, [theme, systemColorScheme]);

  // Update nativewind color scheme whenever theme changes
  useEffect(() => {
    if (theme === "system") {
      nativeWind.setColorScheme("system");
    } else {
      nativeWind.setColorScheme(theme);
    }
  }, [theme, nativeWind]);

  const keywords = useBlockingStore((s) => s.keywords);
  const includedUrls = useBlockingStore((s) => s.includedUrls);
  const excludedUrls = useBlockingStore((s) => s.excludedUrls);
  const adultBlockingEnabled = useBlockingStore((s) => s.adultBlockingEnabled);
  const blockedApps = useBlockingStore((s) => s.blockedApps);

  // Centralized debounced sync for all protection settings
  // Note: categories are NOT included — they contain 100k+ domains and are
  // synced separately via BlocklistService.updateBlocklists() which calls
  // its own syncBlocklistToNative() after fetching.
  useEffect(() => {
    if (isMounted) {
      void ProtectionService.syncAllConfigs().catch(console.error);
    }
  }, [
    keywords,
    includedUrls,
    excludedUrls,
    adultBlockingEnabled,
    blockedApps,
    isMounted,
  ]);

  // Route to appropriate screen on initial load
  useEffect(() => {
    if (!isMounted || !navigationState?.key || !fontsLoaded) return;

    const inTabs = segments[0] === "(tabs)";
    const inSettings = segments[0] === "settings";
    const inOnboarding = segments[0] === "(onboarding)";

    if (isOnboarded && !inTabs && !inSettings) {
      router.replace("/(tabs)");
    } else if (!isOnboarded && !inOnboarding) {
      router.replace("/(onboarding)");
    }
  }, [isOnboarded, navigationState?.key, isMounted, fontsLoaded, segments]);

  // Global event listeners for Native Services
  useEffect(() => {
    if (!isMounted || !navigationState?.key) return;

    const listeners = [
      ProtectionService.onDomainBlocked(() => {
        // Handled natively by OverlayService
      }),
      ProtectionService.onUrlBlocked(() => {
        // Handled natively by OverlayService
      }),
    ];

    return () => {
      listeners.forEach((sub) => {
        sub.remove();
      });
    };
  }, [isMounted, navigationState?.key]);

  // Wait for both mounting and fonts to be ready for a smooth experience
  if (!isMounted || !fontsLoaded) return null;

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="block-overlay"
          options={{
            presentation: "fullScreenModal",
            gestureEnabled: false,
            animation: "fade",
          }}
        />
      </Stack>
      <StatusBar style={isDark ? "light" : "dark"} />
      <AppLockScreen
        visible={appLockEnabled && isLocked}
        onUnlock={handleUnlock}
      />
    </ThemeProvider>
  );
}
