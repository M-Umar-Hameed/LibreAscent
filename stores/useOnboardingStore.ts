import { sqliteStorage } from "@/db/database";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PermissionId =
  | "notifications"
  | "vpn"
  | "accessibility"
  | "overlay"
  | "deviceAdmin";

export const PERMISSION_ORDER: PermissionId[] = [
  "notifications",
  "vpn",
  "accessibility",
  "overlay",
  "deviceAdmin",
];

interface OnboardingState {
  currentStep: number;
  grantedPermissions: Record<PermissionId, boolean>;

  setCurrentStep: (step: number) => void;
  setPermissionGranted: (id: PermissionId, granted: boolean) => void;
  resetOnboarding: () => void;
  getNextUngrantedStep: () => number;
}

const initialGrantedState: Record<PermissionId, boolean> = {
  notifications: false,
  vpn: false,
  accessibility: false,
  overlay: false,
  deviceAdmin: false,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      currentStep: 0,
      grantedPermissions: { ...initialGrantedState },

      setCurrentStep: (step) => set({ currentStep: step }),

      setPermissionGranted: (id, granted) =>
        set((state) => ({
          grantedPermissions: {
            ...state.grantedPermissions,
            [id]: granted,
          },
        })),

      resetOnboarding: () =>
        set({
          currentStep: 0,
          grantedPermissions: { ...initialGrantedState },
        }),

      getNextUngrantedStep: () => {
        const { grantedPermissions } = get();
        const idx = PERMISSION_ORDER.findIndex((id) => !grantedPermissions[id]);
        return idx === -1 ? PERMISSION_ORDER.length : idx;
      },
    }),
    {
      name: "freedom-onboarding-store",
      storage: createJSONStorage(() => sqliteStorage),
    },
  ),
);
