import {
  EventEmitter as ExpoEventEmitter,
  requireNativeModule,
} from "expo-modules-core";

interface FreedomAccessibilityModuleInterface {
  isAccessibilityEnabled(): Promise<boolean>;
  isServiceRunning(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  updateBrowserConfigs(
    configs: {
      name: string;
      packageName: string;
      urlBarId: string;
    }[],
  ): Promise<void>;
  updateReelsConfigs(
    configs: {
      name: string;
      packageName: string;
      detectionNodes: string[];
    }[],
  ): Promise<void>;
  updateBlockedDomains(domains: string[]): Promise<void>;
  updateBlockedKeywords(keywords: string[]): Promise<void>;
  updateBlockedApps(
    configs: {
      packageName: string;
      appName: string;
      surveillanceType: string;
      surveillanceValue: number;
      startTime?: string;
      endTime?: string;
    }[],
  ): Promise<void>;
  updateWhitelist(domains: string[]): Promise<void>;
  updateNsfwMonitoredApps(packageNames: string[]): Promise<void>;
  updateAdultBlockingEnabled(enabled: boolean): Promise<void>;
  updateHardcoreMode(enabled: boolean): Promise<void>;
  updateCategoryDomains(categoryId: string, domains: string[]): Promise<void>;
  clearCategoryDomains(categoryId: string): Promise<void>;
  getCategoryDomainCount(categoryId: string): Promise<number>;
  appendCategoryDomains(categoryId: string, domains: string[]): Promise<void>;
  finalizeCategorySync(categoryId: string): Promise<void>;
  setCategoryEnabled(categoryId: string, enabled: boolean): Promise<void>;
  setIncludedDomains(domains: string[]): Promise<void>;
  getProtectionSnapshot(): Promise<{
    serviceRunning: boolean;
    blockedApps: number;
    keywords: number;
    includedDomains: number;
    whitelist: number;
    adultBlockingEnabled: boolean;
    perCategoryMode: boolean;
    enabledCategories: number;
    categoryDomains: number;
    adultCategoryDomains: number;
    hentaiCategoryDomains: number;
  }>;
  getInstalledApps(): Promise<
    { name: string; packageName: string; icon?: string }[]
  >;
  hasWriteSecureSettings(): Promise<boolean>;
  getBankingState(): Promise<{
    active: boolean;
    remainingMs: number;
    cooldownRemainingMs: number;
    attemptsRemaining: number;
  }>;
  startBankingMode(): Promise<void>;
  endBankingMode(): Promise<void>;
  enforceBankingExpiry(): Promise<void>;
  updateOverlayTheme(themeJson: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

let FreedomAccessibilityNative: FreedomAccessibilityModuleInterface | null =
  null;

try {
  FreedomAccessibilityNative = requireNativeModule(
    "FreedomAccessibilityModule",
  );
} catch {
  // Native module not available
}

export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!FreedomAccessibilityNative) return false;
  return FreedomAccessibilityNative.isAccessibilityEnabled();
}

export async function isServiceRunning(): Promise<boolean> {
  if (!FreedomAccessibilityNative) return false;
  return FreedomAccessibilityNative.isServiceRunning();
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!FreedomAccessibilityNative) {
    console.warn("[FreedomAccessibility] Native module not available");
    return;
  }
  return FreedomAccessibilityNative.openAccessibilitySettings();
}

export async function updateBrowserConfigs(
  configs: {
    name: string;
    packageName: string;
    urlBarId: string;
  }[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateBrowserConfigs(configs);
}

export async function updateReelsConfigs(
  configs: {
    name: string;
    packageName: string;
    detectionNodes: string[];
  }[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateReelsConfigs(configs);
}

export async function updateBlockedDomains(domains: string[]): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateBlockedDomains(domains);
}

export async function updateBlockedKeywords(keywords: string[]): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateBlockedKeywords(keywords);
}

export async function updateBlockedApps(
  configs: {
    packageName: string;
    appName: string;
    surveillanceType: string;
    surveillanceValue: number;
    startTime?: string;
    endTime?: string;
  }[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateBlockedApps(configs);
}

export async function updateWhitelist(domains: string[]): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateWhitelist(domains);
}

export async function updateNsfwMonitoredApps(
  packages: string[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateNsfwMonitoredApps(packages);
}

export async function updateAdultBlockingEnabled(
  enabled: boolean,
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateAdultBlockingEnabled(enabled);
}

export async function updateHardcoreMode(enabled: boolean): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateHardcoreMode(enabled);
}

export async function updateCategoryDomains(
  categoryId: string,
  domains: string[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateCategoryDomains(categoryId, domains);
}

export async function clearCategoryDomains(categoryId: string): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.clearCategoryDomains(categoryId);
}

export async function getCategoryDomainCount(
  categoryId: string,
): Promise<number> {
  if (!FreedomAccessibilityNative) return 0;
  return FreedomAccessibilityNative.getCategoryDomainCount(categoryId);
}

export async function appendCategoryDomains(
  categoryId: string,
  domains: string[],
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.appendCategoryDomains(categoryId, domains);
}

export async function finalizeCategorySync(categoryId: string): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.finalizeCategorySync(categoryId);
}

export async function setCategoryEnabled(
  categoryId: string,
  enabled: boolean,
): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.setCategoryEnabled(categoryId, enabled);
}

export async function setIncludedDomains(domains: string[]): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.setIncludedDomains(domains);
}

export async function getProtectionSnapshot(): Promise<{
  serviceRunning: boolean;
  blockedApps: number;
  keywords: number;
  includedDomains: number;
  whitelist: number;
  adultBlockingEnabled: boolean;
  perCategoryMode: boolean;
  enabledCategories: number;
  categoryDomains: number;
  adultCategoryDomains: number;
  hentaiCategoryDomains: number;
}> {
  if (!FreedomAccessibilityNative) {
    return {
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
    };
  }
  return FreedomAccessibilityNative.getProtectionSnapshot();
}

export async function getInstalledApps(): Promise<
  { name: string; packageName: string; icon?: string }[]
> {
  if (!FreedomAccessibilityNative) return [];
  return FreedomAccessibilityNative.getInstalledApps();
}

export async function hasWriteSecureSettings(): Promise<boolean> {
  if (!FreedomAccessibilityNative) return false;
  return FreedomAccessibilityNative.hasWriteSecureSettings();
}

export async function getBankingState(): Promise<{
  active: boolean;
  remainingMs: number;
  cooldownRemainingMs: number;
  attemptsRemaining: number;
}> {
  if (!FreedomAccessibilityNative)
    return {
      active: false,
      remainingMs: 0,
      cooldownRemainingMs: 0,
      attemptsRemaining: 3,
    };
  return FreedomAccessibilityNative.getBankingState();
}

export async function startBankingMode(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.startBankingMode();
}

export async function endBankingMode(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.endBankingMode();
}

export async function enforceBankingExpiry(): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.enforceBankingExpiry();
}

export async function updateOverlayTheme(themeJson: string): Promise<void> {
  if (!FreedomAccessibilityNative) return;
  return FreedomAccessibilityNative.updateOverlayTheme(themeJson);
}

// Event: URL blocked in a browser
export function onUrlBlocked(
  listener: (event: {
    url: string;
    domain: string;
    matchType: string;
    matchedValue: string;
    timestamp: number;
  }) => void,
): { remove: () => void } {
  if (!FreedomAccessibilityNative)
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const emitter: any = new ExpoEventEmitter(
      FreedomAccessibilityNative as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return emitter.addListener("onUrlBlocked", listener);
  } catch {
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  }
}

// Event: Reels/shorts section detected in a social media app
export function onReelsDetected(
  listener: (event: {
    appName: string;
    packageName: string;
    isInReels: boolean;
    timestamp: number;
  }) => void,
): { remove: () => void } {
  if (!FreedomAccessibilityNative)
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const emitter: any = new ExpoEventEmitter(
      FreedomAccessibilityNative as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return emitter.addListener("onReelsDetected", listener);
  } catch {
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  }
}
