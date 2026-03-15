import { BROWSERS } from "@/constants/browsers";
import { incrementDailyBlockedCount, logBlockedUrl } from "@/db/database";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { BlockingCategory } from "@/types/blocking";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
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
      await ProtectionService.syncAllConfigs();
      await FreedomVpn.startVpn();
      useAppStore.getState().setProtection({ vpn: true });
      return true;
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

  _syncTimeout: null as ReturnType<typeof setTimeout> | null,
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

    return new Promise((resolve) => {
      ProtectionService._syncTimeout = setTimeout(() => {
        void (async () => {
          try {
            const state = useBlockingStore.getState();

            // 1. INSTANT: Sync master flag + per-category enabled flags (no domain transfer)
            await BlocklistService.syncCategoryFlagsToNative();

            // 2. Check what changed — avoid resending 100k+ category domains on every URL add
            const currentUrlContent = JSON.stringify({
              included: state.includedUrls,
              excluded: state.excludedUrls,
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
              currentCategoryContent !== ProtectionService._lastCategoryContent;

            if (!options?.skipResync) {
              if (categoriesChanged) {
                // Full domain sync — categories changed (after updateBlocklists)
                await BlocklistService.syncDomainsToNative({
                  skipResync: false,
                });
                ProtectionService._lastCategoryContent = currentCategoryContent;
                ProtectionService._lastUrlContent = currentUrlContent;
              } else if (urlsChanged) {
                // Lightweight URL-only sync — update URL lists without resending all category domains
                await FreedomAccessibility.setIncludedDomains(
                  state.includedUrls,
                );
                await FreedomAccessibility.updateWhitelist(state.excludedUrls);
                await FreedomVpn.setWhitelist(state.excludedUrls);
                // VPN: send only user-included URLs (categories already loaded via addCategory)
                await FreedomVpn.updateBlocklist(state.includedUrls);
                ProtectionService._lastUrlContent = currentUrlContent;
              }
            }

            // 3. Sync other parts in parallel
            await Promise.all([
              ProtectionService.syncBrowserConfigs(),
              BlocklistService.syncKeywordsToNative(),
              BlocklistService.syncAppsToNative(),
            ]);

            const controlMode = useAppStore.getState().controlMode;
            await FreedomAccessibility.updateHardcoreMode(
              controlMode === "hardcore",
            );
          } catch (e) {
            console.error("[ProtectionService] Sync failed:", e);
          } finally {
            resolve();
          }
        })();
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

  /**
   * Subscribe to domain blocked events.
   */
  onDomainBlocked: (
    listener: (event: { domain: string; timestamp: number }) => void,
  ): { remove: () => void } => {
    return FreedomVpn.onDomainBlocked((event) => {
      logBlockedUrl(event.domain, event.timestamp);
      incrementDailyBlockedCount();
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
      logBlockedUrl(event.url, event.timestamp);
      incrementDailyBlockedCount();
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
