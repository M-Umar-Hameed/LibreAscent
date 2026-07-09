export interface BlockingCategory {
  id: string;
  name: string;
  description: string;
  domains: string[];
  enabled: boolean;
}

export interface BlocklistSource {
  id: string;
  url: string;
  name: string;
  enabled: boolean;
  format: "domains" | "hosts" | "keywords";
  category?: "adult" | "hentai" | "ads";
  lastFetchedAt?: string;
}

export interface BlockingStats {
  blockedToday: number;
  totalBlocked: number;
  lastBlockedAt: string | null;
  cleanSince: string;
  daysClean: number;
}

export interface ProtectionStatus {
  vpn: boolean;
  accessibility: boolean;
  overlay: boolean;
  deviceAdmin: boolean;
  foregroundService: boolean;
}

export interface BlockedUrl {
  url: string;
  enabled: boolean;
}

export type ControlMode = "flexible" | "locked" | "hardcore";

/**
 * Get the stricter of two control modes.
 * Main gates the app globally, sub adds per-screen friction.
 */
export function getEffectiveMode(
  main: ControlMode,
  sub: ControlMode,
): ControlMode {
  const order: Record<ControlMode, number> = {
    flexible: 0,
    locked: 1,
    hardcore: 2,
  };
  return order[sub] >= order[main] ? sub : main;
}

export function getEffectiveSurveillance(
  mainMode: ControlMode,
  mainSurv: SurveillanceConfig,
  subMode: ControlMode,
  subSurv: SurveillanceConfig,
): SurveillanceConfig {
  const effective = getEffectiveMode(mainMode, subMode);
  return effective === subMode && subMode !== "flexible" ? subSurv : mainSurv;
}

export interface ScheduleEntry {
  id: string;
  day: number; // 0-6
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  enabled: boolean;
}

export interface SurveillanceConfig {
  type: "timer" | "click" | "time" | "none";
  value: number; // seconds for timer, count for clicks
  startHour?: number; // 0-23 for 'time'
  endHour?: number; // 0-23 for 'time'
}

export interface BlockedApp {
  packageName: string;
  appName: string;
  enabled: boolean;
  controlMode: ControlMode | "individual"; // Can use main mode or individual override
  surveillance: SurveillanceConfig;
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
}
