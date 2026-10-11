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

/** Same start and end hour locks all day; end before start wraps past midnight. */
export function windowCovers(w: Pick<FrictionWindow, "startHour" | "endHour">, hour: number) {
  if (w.startHour === w.endHour) return true;
  return w.startHour < w.endHour
    ? hour >= w.startHour && hour < w.endHour
    : hour >= w.startHour || hour < w.endHour;
}

/** True when `next` leaves any hour unlocked that `current` locked. */
export function windowShrinks(current: FrictionWindow, next: FrictionWindow) {
  for (let hour = 0; hour < 24; hour++) {
    if (windowCovers(current, hour) && !windowCovers(next, hour)) return true;
  }
  return false;
}

export function activeFriction(
  config: DesktopConfig,
  hour: number,
): { countdownSeconds: number; clickCount: number; locked: boolean; source: "base" | "window" | "none" } {
  switch (config.frictionMode) {
    case "timer":
      return {
        countdownSeconds: config.friction.countdownSeconds,
        clickCount: 0,
        locked: false,
        source: "base",
      };
    case "clicks":
      return {
        countdownSeconds: 0,
        clickCount: config.friction.clickCount,
        locked: false,
        source: "base",
      };
    case "timeBased": {
      const locked = windowCovers(config.frictionWindow, hour);
      return {
        countdownSeconds: 0,
        clickCount: 0,
        locked,
        source: locked ? "window" : "none",
      };
    }
  }
}
