import { getCachedDomainCount } from "@/db/database";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomForeground from "@/modules/freedom-foreground-service/src";
import * as FreedomOverlay from "@/modules/freedom-overlay/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { BlocklistService } from "./BlocklistService";
import { ProtectionService } from "./ProtectionService";

const TAG = "[LaunchRecovery]";

export interface LaunchRecoveryReport {
  accessibilityEnabled: boolean;
  accessibilityRunning: boolean;
  accessibilityRunningAfter: boolean;
  foregroundRunningBefore: boolean;
  foregroundRunningAfter: boolean;
  overlayPermission: boolean;
  vpnPrepared: boolean;
  vpnActiveBefore: boolean;
  vpnActiveAfter: boolean;
  cachedDomainCounts: Record<string, number>;
  nativeDomainCounts: Record<string, number>;
  accessibilitySnapshotBefore: Awaited<
    ReturnType<typeof FreedomAccessibility.getProtectionSnapshot>
  >;
  accessibilitySnapshotAfter: Awaited<
    ReturnType<typeof FreedomAccessibility.getProtectionSnapshot>
  >;
}

function logPhase(
  phase: string,
  startedAt: number,
  details?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.log(TAG, phase, {
    elapsed: `${Date.now() - startedAt}ms`,
    ...details,
  });
}

async function safePhase<T>(
  phase: string,
  startedAt: number,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    logPhase(`${phase}:ok`, startedAt);
    return result;
  } catch (error) {
    console.warn(`${TAG} ${phase}:failed`, error);
    return fallback;
  }
}

async function safeVoidPhase(
  phase: string,
  startedAt: number,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    logPhase(`${phase}:ok`, startedAt);
  } catch (error) {
    console.warn(`${TAG} ${phase}:failed`, error);
  }
}

export const LaunchRecoveryService = {
  _recoveryPromise: null as Promise<LaunchRecoveryReport> | null,

  recoverAfterLaunch: async (): Promise<LaunchRecoveryReport> => {
    if (LaunchRecoveryService._recoveryPromise) {
      return LaunchRecoveryService._recoveryPromise;
    }

    LaunchRecoveryService._recoveryPromise =
      LaunchRecoveryService._recoverAfterLaunch();

    try {
      return await LaunchRecoveryService._recoveryPromise;
    } finally {
      LaunchRecoveryService._recoveryPromise = null;
    }
  },

  _recoverAfterLaunch: async (): Promise<LaunchRecoveryReport> => {
    const startedAt = Date.now();
    logPhase("start", startedAt);

    const cachedDomainCounts: Record<string, number> = {};
    const nativeDomainCounts: Record<string, number> = {};

    for (const category of useBlockingStore.getState().categories) {
      cachedDomainCounts[category.id] = getCachedDomainCount(category.id);
      nativeDomainCounts[category.id] = await safePhase(
        `native-count:${category.id}`,
        startedAt,
        0,
        () => FreedomAccessibility.getCategoryDomainCount(category.id),
      );
    }
    logPhase("counts", startedAt, { cachedDomainCounts, nativeDomainCounts });

    const accessibilityEnabled = await safePhase(
      "accessibility-check",
      startedAt,
      false,
      FreedomAccessibility.isAccessibilityEnabled,
    );
    const accessibilityRunning = await safePhase(
      "accessibility-running-check",
      startedAt,
      false,
      FreedomAccessibility.isServiceRunning,
    );
    const accessibilitySnapshotBefore = await safePhase(
      "accessibility-snapshot-before",
      startedAt,
      {
        serviceRunning: false,
        blockedApps: 0,
        keywords: 0,
        includedDomains: 0,
        whitelist: 0,
        adultBlockingEnabled: false,
        perCategoryMode: false,
        enabledCategories: 0,
        categoryDomains: 0,
        adultCategoryDomains: 0,
        hentaiCategoryDomains: 0,
      },
      FreedomAccessibility.getProtectionSnapshot,
    );
    const overlayPermission = await safePhase(
      "overlay-check",
      startedAt,
      false,
      FreedomOverlay.hasOverlayPermission,
    );
    const foregroundRunningBefore = await safePhase(
      "foreground-check-before",
      startedAt,
      false,
      FreedomForeground.isServiceRunning,
    );

    if (!foregroundRunningBefore) {
      await safeVoidPhase("foreground-start", startedAt, () =>
        FreedomForeground.startService(),
      );
    }

    const foregroundRunningAfter = await safePhase(
      "foreground-check-after",
      startedAt,
      false,
      FreedomForeground.isServiceRunning,
    );

    await safeVoidPhase("sync-lightweight-before-cache", startedAt, () =>
      ProtectionService.syncAllConfigs({ skipResync: true }),
    );
    await safeVoidPhase("sync-cache", startedAt, () =>
      BlocklistService.syncAllCategoriesFromCache({
        skipMatchingNative: true,
        nativeCounts: nativeDomainCounts,
      }),
    );
    ProtectionService.snapshotCategoryContent();
    // The config went out before the cache restore; the layout's sync effect
    // fires as recovery completes and only needs to send what changed since.
    ProtectionService.skipNextSyncIfUnchanged();
    const accessibilitySnapshotAfter = await safePhase(
      "accessibility-snapshot-after",
      startedAt,
      accessibilitySnapshotBefore,
      FreedomAccessibility.getProtectionSnapshot,
    );
    const accessibilityRunningAfter = await safePhase(
      "accessibility-running-check-after",
      startedAt,
      accessibilityRunning,
      FreedomAccessibility.isServiceRunning,
    );

    const vpnPrepared = await safePhase(
      "vpn-prepared-check",
      startedAt,
      false,
      FreedomVpn.isVpnPrepared,
    );
    const vpnActiveBefore = await safePhase(
      "vpn-active-check-before",
      startedAt,
      false,
      FreedomVpn.isVpnActive,
    );

    if (
      vpnPrepared &&
      !vpnActiveBefore &&
      ProtectionService.isProtectionEnabledBySchedule()
    ) {
      await safeVoidPhase("vpn-start", startedAt, FreedomVpn.startVpn);
    }

    const vpnActiveAfter = await safePhase(
      "vpn-active-check-after",
      startedAt,
      false,
      FreedomVpn.isVpnActive,
    );
    useAppStore.getState().setProtection({
      accessibility: accessibilityEnabled && accessibilityRunningAfter,
      foregroundService: foregroundRunningAfter,
      overlay: overlayPermission,
      vpn: vpnActiveAfter,
    });

    const report = {
      accessibilityEnabled,
      accessibilityRunning,
      accessibilityRunningAfter,
      foregroundRunningBefore,
      foregroundRunningAfter,
      overlayPermission,
      vpnPrepared,
      vpnActiveBefore,
      vpnActiveAfter,
      cachedDomainCounts,
      nativeDomainCounts,
      accessibilitySnapshotBefore,
      accessibilitySnapshotAfter,
    };
    logPhase("complete", startedAt, report);
    return report;
  },
};
