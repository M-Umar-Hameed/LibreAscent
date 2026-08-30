/// <reference types="vite/client" />

export type BlockedAppRule = {
  name: string;
  executable: string;
  fullPath?: string | null;
};

export type BlocklistSource = {
  id: string;
  name: string;
  url: string;
  format: string;
  enabled: boolean;
};

export type DesktopConfig = {
  schemaVersion: number;
  adultBlockingEnabled: boolean;
  sources: BlocklistSource[];
  includedDomains: string[];
  excludedDomains: string[];
  keywords: string[];
  blockedApps: BlockedAppRule[];
  controlMode: "flexible" | "locked" | "hardcore";
  friction: {
    countdownSeconds: number;
    clickCount: number;
  };
  frictionWindow: FrictionWindow;
};

export type FrictionWindow = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  countdownSeconds: number;
  clickCount: number;
};

export type DesktopStatus = {
  serviceInstalled: boolean;
  serviceRunning: boolean;
  dnsProxyRunning: boolean;
  dnsControlled: boolean;
  firewallControlled: boolean;
  configPath: string;
  isAdmin: boolean;
};

export function frictionWindowContains(w: FrictionWindow, hour: number): boolean {
  if (!w.enabled || w.startHour === w.endHour) return false;
  return w.startHour < w.endHour
    ? hour >= w.startHour && hour < w.endHour
    : hour >= w.startHour || hour < w.endHour;
}

export function activeFriction(
  config: DesktopConfig,
  hour: number,
): { countdownSeconds: number; clickCount: number; source: "window" | "base" } {
  if (frictionWindowContains(config.frictionWindow, hour)) {
    return {
      countdownSeconds: config.frictionWindow.countdownSeconds,
      clickCount: config.frictionWindow.clickCount,
      source: "window",
    };
  }
  return { ...config.friction, source: "base" };
}
