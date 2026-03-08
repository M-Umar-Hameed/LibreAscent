/**
 * Type declarations for Freedom native modules.
 * These modules are loaded via Expo Modules API and may not be available
 * in all environments (web, dev without native build).
 */

declare module "freedom-vpn-service" {
  export function startVpn(): Promise<void>;
  export function stopVpn(): Promise<void>;
  export function isVpnActive(): Promise<boolean>;
  export function prepareVpn(): Promise<boolean>;
  export function updateBlocklist(domains: string[]): Promise<void>;
  export function addCategory(name: string, domains: string[]): Promise<void>;
  export function removeCategory(name: string): Promise<void>;
  export function setWhitelist(domains: string[]): Promise<void>;
  export function getBlockedCount(): Promise<number>;
  export function getBlocklistSize(): Promise<number>;
  export function onDomainBlocked(
    listener: (event: { domain: string; timestamp: number }) => void,
  ): { remove: () => void };
  export function onVpnStatusChanged(
    listener: (event: { active: boolean }) => void,
  ): { remove: () => void };
}

declare module "freedom-accessibility-service" {
  export function isAccessibilityEnabled(): Promise<boolean>;
  export function openAccessibilitySettings(): Promise<void>;
  export function updateBrowserConfigs(
    configs: {
      name: string;
      packageName: string;
      urlBarId: string;
    }[],
  ): Promise<void>;
  export function updateReelsConfigs(
    configs: {
      name: string;
      packageName: string;
      detectionNodes: string[];
    }[],
  ): Promise<void>;
  export function updateBlockedDomains(domains: string[]): Promise<void>;
  export function updateBlockedKeywords(keywords: string[]): Promise<void>;
  export function updateWhitelist(domains: string[]): Promise<void>;
  export function onUrlBlocked(
    listener: (event: {
      url: string;
      domain: string;
      matchType: string;
      matchedValue: string;
      timestamp: number;
    }) => void,
  ): { remove: () => void };
  export function onReelsDetected(
    listener: (event: {
      appName: string;
      packageName: string;
      isInReels: boolean;
      timestamp: number;
    }) => void,
  ): { remove: () => void };
}

declare module "freedom-overlay" {
  export function showOverlay(message?: string): Promise<void>;
  export function hideOverlay(): Promise<void>;
  export function hasOverlayPermission(): Promise<boolean>;
  export function requestOverlayPermission(): Promise<void>;
  export function isOverlayShowing(): Promise<boolean>;
}

declare module "freedom-foreground-service" {
  export function startService(): Promise<void>;
  export function stopService(): Promise<void>;
  export function isServiceRunning(): Promise<boolean>;
  export function updateNotification(
    title?: string,
    text?: string,
  ): Promise<void>;
  export function setAutoStart(enabled: boolean): Promise<void>;
  export function isAutoStartEnabled(): Promise<boolean>;
}

declare module "freedom-device-admin" {
  export function isAdminActive(): Promise<boolean>;
  export function requestAdminActivation(): Promise<boolean>;
}
