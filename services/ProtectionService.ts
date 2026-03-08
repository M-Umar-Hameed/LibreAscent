import { BROWSERS } from "@/constants/browsers";
import { incrementDailyBlockedCount, logBlockedUrl } from "@/db/database";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { useAppStore } from "@/stores/useAppStore";
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

  /**
   * Re-sync ALL configurations.
   */
  syncAllConfigs: async (): Promise<void> => {
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

    await BlocklistService.syncBlocklistToNative();

    const controlMode = useAppStore.getState().controlMode;
    await FreedomAccessibility.updateHardcoreMode(controlMode === "hardcore");
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
