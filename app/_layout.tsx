import { AppLockScreen } from "@/components/AppLockScreen";
import { APP_THEMES } from "@/constants/overlay-themes";
import { getLastBlocklistUpdate } from "@/db/database";
import { AppThemeProvider } from "@/providers/ThemeProvider";
import { BlocklistService } from "@/services/BlocklistService";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import * as Font from "expo-font";
import {
  Stack,
  router,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import "react-native-reanimated";
import "../global.css";

// Prevent splash screen from hiding automatically
// Prevent splash screen from hiding automatically
void SplashScreen.preventAutoHideAsync().catch((_e: unknown) => {
  /* ignore */
});

export default function RootLayout(): ReactNode {
  const isOnboarded = useAppStore((s) => s.isOnboarded);
  const hydrateStats = useAppStore((s) => s.hydrateStats);
  const appLockEnabled = useAppStore((s) => s.appLockEnabled);
  const controlMode = useAppStore((s) => s.controlMode);
  const navigationState = useRootNavigationState();
  const segments = useSegments();
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
    controlMode,
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

  // On every launch: push cached domains to native (survives process death).
  // Then if stale (>24h), fetch fresh lists from network.
  // Skip during onboarding to avoid freezing the permissions screen.
  useEffect(() => {
    if (!isMounted || !isOnboarded) return;
    if (!useBlockingStore.getState().adultBlockingEnabled) return;

    void (async () => {
      try {
        await BlocklistService.syncAllCategoriesFromCache();
      } catch (e) {
        console.warn("[Layout] Cache sync failed:", e);
      }
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const lastUpdate = getLastBlocklistUpdate();
      if (Date.now() - lastUpdate > TWENTY_FOUR_HOURS) {
        void BlocklistService.updateBlocklists().catch(console.error);
      }
    })();
  }, [isMounted, isOnboarded]);

  const appThemeId = useAppStore((s) => s.appThemeId);
  const customTheme = useAppStore((s) => s.customTheme);
  const activeTheme =
    appThemeId === "custom" && customTheme
      ? customTheme
      : (APP_THEMES[appThemeId] ?? APP_THEMES.default);

  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: activeTheme.accentColor,
        background: activeTheme.bgColor,
        card: activeTheme.cardBgColor,
        text: activeTheme.textColor,
        border: activeTheme.cardBgColor,
      },
    }),
    [activeTheme],
  );

  // Wait for both mounting and fonts to be ready for a smooth experience
  if (!isMounted || !fontsLoaded) return null;

  return (
    <AppThemeProvider>
      <ThemeProvider value={navTheme}>
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
        <StatusBar style="light" />
        <AppLockScreen
          visible={appLockEnabled && isLocked}
          onUnlock={handleUnlock}
        />
      </ThemeProvider>
    </AppThemeProvider>
  );
}
