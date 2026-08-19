import { BROWSERS } from "@/constants/browsers";
import { NSFW_APPS } from "@/constants/nsfw-apps";
import { REELS_APPS } from "@/constants/reels";
import { getResolvedTheme } from "@/constants/overlay-themes";
import { accumulateBlockedCount } from "@/db/database";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomForeground from "@/modules/freedom-foreground-service/src";
import * as FreedomOverlay from "@/modules/freedom-overlay/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { BlockingCategory } from "@/types/blocking";
import { useAppStore } from "@/stores/useAppStore";
import {
  getActiveExcludedUrls,
  getActiveIncludedUrls,
  useBlockingStore,
} from "@/stores/useBlockingStore";
import { BlocklistService } from "./BlocklistService";

/**
 * ProtectionService — High-level bridge to native protection modules.
 */
export const ProtectionService = {
  /**
   * Start full protection.
   */
  startProtection: async (): Promise<boolean> => {
    try {
      await FreedomForeground.startService();
      await ProtectionService.syncAllConfigs();
      await FreedomVpn.startVpn();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await ProtectionService.refreshProtectionStatus();
      return status.vpn;
    } catch (error) {
      console.error("[ProtectionService] Failed to start protection:", error);
      return false;
    }
  },

  /**
   * Stop protection.
   */
  stopProtection: async (): Promise<void> => {
    try {
      await FreedomVpn.stopVpn();
      useAppStore.getState().setProtection({ vpn: false });
    } catch (error) {
      console.error("[ProtectionService] Failed to stop protection:", error);
    }
  },

  /**
   * Check if VPN is active.
   */
  isProtectionActive: async (): Promise<boolean> => {
    return FreedomVpn.isVpnActive();
  },

  refreshProtectionStatus: async (): Promise<{
    vpn: boolean;
    accessibility: boolean;
    foregroundService: boolean;
    overlay: boolean;
  }> => {
    const [
      vpn,
      accessibilityEnabled,
      accessibilityRunning,
      foregroundService,
      overlay,
    ] = await Promise.all([
      FreedomVpn.isVpnActive(),
      FreedomAccessibility.isAccessibilityEnabled(),
      FreedomAccessibility.isServiceRunning(),
      FreedomForeground.isServiceRunning(),
      FreedomOverlay.hasOverlayPermission(),
    ]);
    const status = {
      vpn,
      accessibility: accessibilityEnabled && accessibilityRunning,
      foregroundService,
      overlay,
    };
    useAppStore.getState().setProtection(status);
    return status;
  },

  _syncTimeout: null as ReturnType<typeof setTimeout> | null,
  _pendingResolve: null as (() => void) | null,
  _syncChain: Promise.resolve(),
  _lastUrlContent: "" as string, // Hash of last synced URLs
  _lastCategoryContent: "" as string, // Hash of last synced category config

  /**
   * Snapshot the current category content so syncAllConfigs doesn't
   * re-trigger a domain sync after updateBlocklists already sent them.
   */
  snapshotCategoryContent: (): void => {
    const state = useBlockingStore.getState();
    ProtectionService._lastCategoryContent = JSON.stringify(
      state.categories.map((c: BlockingCategory) => ({
        id: c.id,
        domainCount: state.categoryDomainCounts[c.id] ?? c.domains.length,
      })),
    );
  },

  syncAllConfigs: async (options?: { skipResync?: boolean }): Promise<void> => {
    if (ProtectionService._syncTimeout) {
      clearTimeout(ProtectionService._syncTimeout);
    }
    // Resolve any previous pending promise so its await doesn't hang forever
    if (ProtectionService._pendingResolve) {
      ProtectionService._pendingResolve();
      ProtectionService._pendingResolve = null;
    }

    return new Promise((resolve) => {
      ProtectionService._pendingResolve = resolve;
      ProtectionService._syncTimeout = setTimeout(() => {
        ProtectionService._syncChain = ProtectionService._syncChain.then(
          async () => {
            try {
              const state = useBlockingStore.getState();

              // 1. INSTANT: Sync master flag + per-category enabled flags (no domain transfer)
              await BlocklistService.syncCategoryFlagsToNative();

              // 2. Check what changed — avoid resending 100k+ category domains on every URL add
              const activeIncluded = getActiveIncludedUrls();
              const activeExcluded = getActiveExcludedUrls();

              const currentUrlContent = JSON.stringify({
                included: activeIncluded,
                excluded: activeExcluded,
              });
              const currentCategoryContent = JSON.stringify(
                state.categories.map((c: BlockingCategory) => ({
                  id: c.id,
                  domainCount:
                    state.categoryDomainCounts[c.id] ?? c.domains.length,
                })),
              );

              const urlsChanged =
                currentUrlContent !== ProtectionService._lastUrlContent;
              const categoriesChanged =
                currentCategoryContent !==
                ProtectionService._lastCategoryContent;

              if (categoriesChanged && !options?.skipResync) {
                // Full domain sync — categories changed (after updateBlocklists)
                await BlocklistService.syncDomainsToNative({
                  skipResync: false,
                });
                ProtectionService._lastCategoryContent = currentCategoryContent;
                ProtectionService._lastUrlContent = currentUrlContent;
              } else if (urlsChanged || options?.skipResync) {
                // Lightweight URL-only sync — only enabled URLs
                await FreedomAccessibility.setIncludedDomains(activeIncluded);
                await FreedomAccessibility.updateWhitelist(activeExcluded);
                await FreedomVpn.setWhitelist(activeExcluded);
                await FreedomVpn.updateBlocklist(activeIncluded);
                ProtectionService._lastUrlContent = currentUrlContent;
              }

              // 3. Sync other parts in parallel
              const appState = useAppStore.getState();
              const activeTheme =
                appState.appThemeId === "custom" && appState.customTheme
                  ? {
                      ...appState.customTheme,
                      customImagePath: appState.overlayCustomImage ?? null,
                    }
                  : getResolvedTheme(
                      appState.appThemeId,
                      appState.overlayCustomImage,
                    );
              const themeJson = JSON.stringify({
                ...activeTheme,
                ...appState.overlayTexts,
              });

              await Promise.all([
                ProtectionService.syncBrowserConfigs(),
                ProtectionService.syncReelsConfigs(),
                ProtectionService.syncNsfwApps(),
                BlocklistService.syncKeywordsToNative(),
                BlocklistService.syncAppsToNative(),
                FreedomAccessibility.updateOverlayTheme(themeJson),
                FreedomOverlay.updateOverlayTheme(themeJson),
              ]);

              const controlMode = appState.controlMode;
              await FreedomAccessibility.updateHardcoreMode(
                controlMode === "hardcore",
              );
              // eslint-disable-next-line no-console
              console.log("[ProtectionService] Synced configs", {
                includedUrls: activeIncluded.length,
                excludedUrls: activeExcluded.length,
                blockedApps: state.blockedApps.filter((app) => app.enabled)
                  .length,
                keywords: state.keywords.length,
                reelsApps: state.enabledReelsApps.length,
                nsfwApps: state.enabledNsfwApps.length,
                skippedCategoryDomainResync: Boolean(options?.skipResync),
              });
            } catch (e) {
              console.error("[ProtectionService] Sync failed:", e);
            } finally {
              ProtectionService._pendingResolve = null;
              resolve();
            }
          },
        );
      }, 300); // 300ms debounce
    });
  },

  syncBrowserConfigs: async (): Promise<void> => {
    try {
      await FreedomAccessibility.updateBrowserConfigs(
        BROWSERS.map((b) => ({
          name: b.name,
          packageName: b.package,
          urlBarId: b.urlBarId,
        })),
      );
    } catch (e) {
      console.warn(
        "[ProtectionService] Failed to sync Accessibility configs:",
        e,
      );
    }
  },

  syncReelsConfigs: async (): Promise<void> => {
    try {
      const { enabledReelsApps } = useBlockingStore.getState();
      const enabled = REELS_APPS.filter((a) =>
        enabledReelsApps.includes(a.packageName),
      );
      await FreedomAccessibility.updateReelsConfigs(
        enabled.map((a) => ({
          name: a.name,
          packageName: a.packageName,
          detectionNodes: a.detectionNodes,
        })),
      );
    } catch (e) {
      console.warn("[ProtectionService] Failed to sync Reels configs:", e);
    }
  },

  syncNsfwApps: async (): Promise<void> => {
    try {
      const { enabledNsfwApps } = useBlockingStore.getState();
      const enabled = NSFW_APPS.filter((a) =>
        enabledNsfwApps.includes(a.packageName),
      );
      await FreedomAccessibility.updateNsfwMonitoredApps(
        enabled.map((a) => a.packageName),
      );
    } catch (e) {
      console.warn("[ProtectionService] Failed to sync NSFW apps:", e);
    }
  },

  /**
   * Subscribe to domain blocked events.
   */
  onDomainBlocked: (
    listener: (event: { domain: string; timestamp: number }) => void,
  ): { remove: () => void } => {
    return FreedomVpn.onDomainBlocked((event) => {
      accumulateBlockedCount();
      useAppStore.getState().incrementBlocked();
      listener(event);
    });
  },

  /**
   * Subscribe to URL blocked events.
   */
  onUrlBlocked: (
    listener: (event: {
      url: string;
      domain: string;
      matchType: string;
      matchedValue: string;
      timestamp: number;
    }) => void,
  ): { remove: () => void } => {
    return FreedomAccessibility.onUrlBlocked((event) => {
      accumulateBlockedCount();
      useAppStore.getState().incrementBlocked();
      listener(event);
    });
  },

  /**
   * Check if protection should be active based on current schedule.
   */
  isProtectionEnabledBySchedule: (): boolean => {
    const schedules = useAppStore.getState().schedule;
    if (schedules.length === 0) return true;

    const activeSchedules = schedules.filter((s) => s.enabled);
    if (activeSchedules.length === 0) return true;

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    return activeSchedules.some((s) => {
      if (s.day !== currentDay) return false;

      const [startH, startM] = s.startTime.split(":").map(Number);
      const [endH, endM] = s.endTime.split(":").map(Number);

      const startTimeMinutes = startH * 60 + startM;
      const endTimeMinutes = endH * 60 + endM;

      if (startTimeMinutes > endTimeMinutes) {
        return (
          currentTimeMinutes >= startTimeMinutes ||
          currentTimeMinutes <= endTimeMinutes
        );
      }

      return (
        currentTimeMinutes >= startTimeMinutes &&
        currentTimeMinutes <= endTimeMinutes
      );
    });
  },

  /**
   * Subscribe to VPN status changes.
   */
  onVpnStatusChanged: (
    listener: (event: { active: boolean }) => void,
  ): { remove: () => void } => {
    return FreedomVpn.onVpnStatusChanged((event) => {
      useAppStore.getState().setProtection({ vpn: event.active });
      listener(event);
    });
  },
};
