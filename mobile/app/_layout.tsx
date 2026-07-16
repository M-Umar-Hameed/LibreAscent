import { AppLockScreen } from "@/components/AppLockScreen";
import { APP_THEMES } from "@/constants/overlay-themes";
import { AppThemeProvider } from "@/providers/ThemeProvider";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import { LaunchRecoveryService } from "@/services/LaunchRecoveryService";
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
  const [launchRecoveryComplete, setLaunchRecoveryComplete] = useState(false);
  const [storesHydrated, setStoresHydrated] = useState(
    () =>
      useAppStore.persist.hasHydrated() &&
      useBlockingStore.persist.hasHydrated(),
  );

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  useEffect(() => {
    const updateHydration = (): void => {
      setStoresHydrated(
        useAppStore.persist.hasHydrated() &&
          useBlockingStore.persist.hasHydrated(),
      );
    };

    const unsubApp = useAppStore.persist.onFinishHydration(updateHydration);
    const unsubBlocking =
      useBlockingStore.persist.onFinishHydration(updateHydration);
    updateHydration();

    return () => {
      unsubApp();
      unsubBlocking();
    };
  }, []);

  useEffect(() => {
    if (!storesHydrated) return;
    useAppStore.getState().setProtection({
      vpn: false,
      accessibility: false,
      overlay: false,
      foregroundService: false,
    });
  }, [storesHydrated]);

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
  const enabledReelsApps = useBlockingStore((s) => s.enabledReelsApps);
  const enabledNsfwApps = useBlockingStore((s) => s.enabledNsfwApps);

  // Centralized debounced sync for all protection settings
  // Note: categories are NOT included — they contain 100k+ domains and are
  // synced separately via BlocklistService.updateBlocklists() which calls
  // its own syncBlocklistToNative() after fetching.
  useEffect(() => {
    if (isMounted && storesHydrated && launchRecoveryComplete) {
      void ProtectionService.syncAllConfigs().catch(console.error);
    }
  }, [
    keywords,
    includedUrls,
    excludedUrls,
    adultBlockingEnabled,
    blockedApps,
    enabledReelsApps,
    enabledNsfwApps,
    controlMode,
    isMounted,
    storesHydrated,
    launchRecoveryComplete,
  ]);

  // Route to appropriate screen on initial load
  useEffect(() => {
    if (!isMounted || !navigationState?.key || !fontsLoaded || !storesHydrated)
      return;

    const inTabs = segments[0] === "(tabs)";
    const inSettings = segments[0] === "settings";
    const inOnboarding = segments[0] === "(onboarding)";

    if (isOnboarded && !inTabs && !inSettings) {
      router.replace("/(tabs)");
    } else if (!isOnboarded && !inOnboarding) {
      router.replace("/(onboarding)");
    }
  }, [
    isOnboarded,
    navigationState?.key,
    isMounted,
    fontsLoaded,
    storesHydrated,
    segments,
  ]);

  // Global event listeners for Native Services
  useEffect(() => {
    if (!isMounted || !navigationState?.key) return;

    const listeners = [
      ProtectionService.onVpnStatusChanged(() => {
        // State is updated inside ProtectionService.
      }),
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

  useEffect(() => {
    if (!isMounted || !storesHydrated || !isOnboarded) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void ProtectionService.refreshProtectionStatus().catch(console.warn);
      }
    });
    void ProtectionService.refreshProtectionStatus().catch(console.warn);

    return () => {
      subscription.remove();
    };
  }, [isMounted, storesHydrated, isOnboarded]);

  // On every launch: recover protection after normal process death or manual
  // relaunch following force-stop. Android blocks all app work while the
  // package is force-stopped; recovery can only run once the user opens app.
  useEffect(() => {
    if (!isMounted || !storesHydrated || !isOnboarded || launchRecoveryComplete)
      return;

    void LaunchRecoveryService.recoverAfterLaunch()
      .catch((e: unknown) => {
        console.warn("[Layout] Launch recovery failed:", e);
      })
      .finally(() => {
        setLaunchRecoveryComplete(true);
      });
  }, [isMounted, storesHydrated, isOnboarded, launchRecoveryComplete]);

  useEffect(() => {
    void FreedomAccessibility.enforceBankingExpiry().catch(() => {
      /* ignore */
    });
  }, []);

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
  if (!isMounted || !fontsLoaded || !storesHydrated) return null;

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
