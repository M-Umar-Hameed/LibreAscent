export interface BlockingCategory {
  id: string;
  name: string;
  description: string;
  domains: string[];
  enabled: boolean;
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

export type ControlMode = "flexible" | "locked" | "hardcore";

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
