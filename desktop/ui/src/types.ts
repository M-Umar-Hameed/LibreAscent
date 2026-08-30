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
  frictionMode: FrictionMode;
};

export type FrictionMode = "timer" | "clicks" | "timeBased";

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

export function activeFriction(
  config: DesktopConfig,
  hour: number,
): { countdownSeconds: number; clickCount: number; source: "base" | "window" | "none" } {
  switch (config.frictionMode) {
    case "timer":
      return {
        countdownSeconds: config.friction.countdownSeconds,
        clickCount: 0,
        source: "base",
      };
    case "clicks":
      return {
        countdownSeconds: 0,
        clickCount: config.friction.clickCount,
        source: "base",
      };
    case "timeBased": {
      const w = config.frictionWindow;
      const inWindow =
        w.startHour !== w.endHour &&
        (w.startHour < w.endHour
          ? hour >= w.startHour && hour < w.endHour
          : hour >= w.startHour || hour < w.endHour);
      return inWindow
        ? {
            countdownSeconds: w.countdownSeconds,
            clickCount: w.clickCount,
            source: "window",
          }
        : { countdownSeconds: 0, clickCount: 0, source: "none" };
    }
  }
}
