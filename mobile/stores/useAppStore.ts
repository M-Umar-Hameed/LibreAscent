import {
  batchedAppStoreStorage,
  getTodayBlockedCount,
  getTotalBlockedCount,
} from "@/db/database";
import type { AppTheme } from "@/constants/overlay-themes";
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
  appLockEnabled: boolean;
  appLockType: "password" | "passkey" | null;
  appLockHash: string | null;
  appThemeId: string;
  customTheme: AppTheme | null;
  overlayCustomImage: string | null;
  overlayTexts: {
    title: string;
    subtitle: string;
    heading: string;
    body: string;
  };
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
  setAppThemeId: (id: string) => void;
  setCustomTheme: (theme: AppTheme | null) => void;
  setOverlayCustomImage: (path: string | null) => void;
  setOverlayTexts: (texts: Partial<AppState["overlayTexts"]>) => void;
  setAppLockEnabled: (enabled: boolean) => void;
  setAppLockType: (type: "password" | "passkey" | null) => void;
  setAppLockHash: (hash: string | null) => void;
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
      appLockEnabled: false,
      appLockType: null,
      appLockHash: null,
      appThemeId: "default",
      customTheme: null,
      overlayCustomImage: null,
      overlayTexts: {
        title: "Blocked!",
        subtitle: "Stay Sharp - Stay Disciplined",
        heading: "You are on a mission to build a better future!",
        body: "Giving in to cheap dopamine is not an option. Back away right now, get back to the grind, and crush your goals today!",
      },
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
      setAppThemeId: (id) => set({ appThemeId: id }),
      setCustomTheme: (theme) => set({ customTheme: theme }),
      setOverlayCustomImage: (path) => set({ overlayCustomImage: path }),
      setOverlayTexts: (texts) =>
        set((state) => ({
          overlayTexts: { ...state.overlayTexts, ...texts },
        })),
      setAppLockEnabled: (enabled) => set({ appLockEnabled: enabled }),
      setAppLockType: (type) => set({ appLockType: type }),
      setAppLockHash: (hash) => set({ appLockHash: hash }),
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
      storage: createJSONStorage(() => batchedAppStoreStorage),
      // protection is runtime status, always reset below on every rehydrate —
      // persisting it would be pure waste.
      partialize: (state) => {
        const { protection: _protection, ...persisted } = state;
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        state?.setProtection({
          vpn: false,
          accessibility: false,
          overlay: false,
          deviceAdmin: false,
          foregroundService: false,
        });
      },
    },
  ),
);
