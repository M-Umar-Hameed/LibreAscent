import {
  getTodayBlockedCount,
  getTotalBlockedCount,
  sqliteStorage,
} from "@/db/database";
import type {
  BlockingStats,
  ControlMode,
  ProtectionStatus,
  ScheduleEntry,
  SurveillanceConfig,
} from "@/types/blocking";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AppState {
  // Protection status
  protection: ProtectionStatus;

  // Stats
  stats: BlockingStats;

  // Settings
  autoStartOnBoot: boolean;
  passwordHash: string | null;
  theme: "light" | "dark" | "system";
  controlMode: ControlMode;
  schedule: ScheduleEntry[];
  surveillance: SurveillanceConfig;

  // Onboarding
  isOnboarded: boolean;

  // Actions
  setProtection: (status: Partial<ProtectionStatus>) => void;
  incrementBlocked: () => void;
  resetCleanStreak: () => void;
  setAutoStart: (value: boolean) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setPasswordHash: (hash: string | null) => void;
  setControlMode: (mode: ControlMode) => void;
  setSchedule: (schedule: ScheduleEntry[]) => void;
  setSurveillance: (config: SurveillanceConfig) => void;
  completeOnboarding: () => void;
  hydrateStats: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      protection: {
        vpn: false,
        accessibility: false,
        overlay: false,
        deviceAdmin: false,
        foregroundService: false,
      },

      stats: {
        blockedToday: 0,
        totalBlocked: 0,
        lastBlockedAt: null,
        cleanSince: new Date().toISOString(),
        daysClean: 0,
      },

      autoStartOnBoot: true,
      passwordHash: null,
      theme: "system",
      controlMode: "flexible",
      schedule: [],
      surveillance: { type: "none", value: 0, startHour: 0, endHour: 0 },
      isOnboarded: false,

      setProtection: (status) =>
        set((state) => ({
          protection: { ...state.protection, ...status },
        })),

      incrementBlocked: () =>
        set((state) => ({
          stats: {
            ...state.stats,
            blockedToday: state.stats.blockedToday + 1,
            totalBlocked: state.stats.totalBlocked + 1,
            lastBlockedAt: new Date().toISOString(),
          },
        })),

      resetCleanStreak: () =>
        set((state) => ({
          stats: {
            ...state.stats,
            cleanSince: new Date().toISOString(),
            daysClean: 0,
          },
        })),

      setAutoStart: (value) => set({ autoStartOnBoot: value }),
      setTheme: (theme) => set({ theme }),
      setPasswordHash: (hash) => set({ passwordHash: hash }),
      setControlMode: (mode) => set({ controlMode: mode }),
      setSchedule: (schedule) => set({ schedule }),
      setSurveillance: (config) => set({ surveillance: config }),
      completeOnboarding: () => set({ isOnboarded: true }),
      hydrateStats: () => {
        try {
          const blockedToday = getTodayBlockedCount();
          const totalBlocked = getTotalBlockedCount();
          set((state) => ({
            stats: {
              ...state.stats,
              blockedToday,
              totalBlocked,
            },
          }));
        } catch (error) {
          console.error("[useAppStore] Failed to hydrate stats from DB", error);
        }
      },
    }),
    {
      name: "freedom-app-store",
      storage: createJSONStorage(() => sqliteStorage),
    },
  ),
);
