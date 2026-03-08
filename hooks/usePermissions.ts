import { useAppStore } from "@/stores/useAppStore";
import type { PermissionId } from "@/stores/useOnboardingStore";
import {
  PERMISSION_ORDER,
  useOnboardingStore,
} from "@/stores/useOnboardingStore";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

// Native module imports — gracefully handle missing modules in dev/web
let FreedomVpn: typeof import("@/modules/freedom-vpn-service/src") | null =
  null;
let FreedomAccessibility:
  | typeof import("@/modules/freedom-accessibility-service/src")
  | null = null;
let FreedomOverlay: typeof import("@/modules/freedom-overlay/src") | null =
  null;
let FreedomDeviceAdmin:
  | typeof import("@/modules/freedom-device-admin/src")
  | null = null;

try {
  FreedomVpn = require("@/modules/freedom-vpn-service/src");
} catch {
  /* ignore */
}
try {
  FreedomAccessibility = require("@/modules/freedom-accessibility-service/src");
} catch {
  /* ignore */
}
try {
  FreedomOverlay = require("@/modules/freedom-overlay/src");
} catch {
  /* ignore */
}
try {
  FreedomDeviceAdmin = require("@/modules/freedom-device-admin/src");
} catch {
  /* ignore */
}

export interface PermissionStatus {
  id: PermissionId;
  title: string;
  description: string;
  icon: string;
  granted: boolean;
  loading: boolean;
  required: boolean;
}

const PERMISSION_META: Record<
  PermissionId,
  { title: string; description: string; icon: string; required: boolean }
> = {
  notifications: {
    title: "Notifications",
    description:
      "Required to show a persistent notification while protection is active",
    icon: "notifications",
    required: true,
  },
  vpn: {
    title: "VPN Service",
    description:
      "Creates a local VPN to filter network traffic and block adult domains",
    icon: "shield",
    required: true,
  },
  accessibility: {
    title: "Accessibility Service",
    description:
      "Monitors browser URLs and detects reels sections in social media apps",
    icon: "eye",
    required: true,
  },
  overlay: {
    title: "Display Over Other Apps",
    description:
      'Shows the "Stay Away" screen when harmful content is detected',
    icon: "layers",
    required: true,
  },
  deviceAdmin: {
    title: "Device Administrator",
    description: "Prevents the app from being uninstalled without permission",
    icon: "lock-closed",
    required: false,
  },
};

export function usePermissions(): {
  permissions: PermissionStatus[];
  allGranted: boolean;
  requiredGranted: boolean;
  grantedCount: number;
  totalCount: number;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  requestPermission: (id: PermissionId) => Promise<boolean>;
  checkAllPermissions: () => Promise<void>;
} {
  const {
    grantedPermissions,
    setPermissionGranted,
    currentStep,
    setCurrentStep,
  } = useOnboardingStore();

  const setProtection = useAppStore((s) => s.setProtection);
  const [loadingStates, setLoadingStates] = useState<
    Record<PermissionId, boolean>
  >({
    notifications: false,
    vpn: false,
    accessibility: false,
    overlay: false,
    deviceAdmin: false,
  });

  const appStateRef = useRef(AppState.currentState);

  const setLoading = useCallback((id: PermissionId, loading: boolean): void => {
    setLoadingStates((prev) => ({ ...prev, [id]: loading }));
  }, []);

  // Check all permissions
  const checkAllPermissions = useCallback(async (): Promise<void> => {
    if (Platform.OS !== "android") return;

    // Notifications
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const granted = (status as string) === "granted";
      setPermissionGranted("notifications", granted);
    } catch {
      /* ignore */
    }

    // VPN
    try {
      if (FreedomVpn) {
        const active = await FreedomVpn.isVpnActive();
        const prepared = await FreedomVpn.isVpnPrepared();
        setPermissionGranted("vpn", prepared);
        setProtection({ vpn: active });
      }
    } catch {
      /* ignore */
    }

    // Accessibility
    try {
      if (FreedomAccessibility) {
        const enabled = await FreedomAccessibility.isAccessibilityEnabled();
        setPermissionGranted("accessibility", enabled);
        setProtection({ accessibility: enabled });
      }
    } catch {
      /* ignore */
    }

    // Overlay
    try {
      if (FreedomOverlay) {
        const hasPermission = await FreedomOverlay.hasOverlayPermission();
        setPermissionGranted("overlay", hasPermission);
        setProtection({ overlay: hasPermission });
      }
    } catch {
      /* ignore */
    }

    // Device Admin
    try {
      if (FreedomDeviceAdmin) {
        const active = await FreedomDeviceAdmin.isAdminActive();
        setPermissionGranted("deviceAdmin", active);
        setProtection({ deviceAdmin: active });
      }
    } catch {
      /* ignore */
    }
  }, [setPermissionGranted, setProtection]);

  // Re-check permissions when app returns to foreground
  // (user may have toggled accessibility or overlay in Settings)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (
        /inactive|background/.exec(appStateRef.current) &&
        nextState === "active"
      ) {
        void checkAllPermissions();
      }
      appStateRef.current = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, [checkAllPermissions]);

  // Initial check
  useEffect(() => {
    void checkAllPermissions();
  }, [checkAllPermissions]);

  // Request a specific permission
  const requestPermission = useCallback(
    async (id: PermissionId): Promise<boolean> => {
      if (Platform.OS !== "android") return false;

      setLoading(id, true);
      let granted = false;

      try {
        switch (id) {
          case "notifications": {
            const { status } = await Notifications.requestPermissionsAsync();
            granted = (status as string) === "granted";
            break;
          }
          case "vpn": {
            if (FreedomVpn) {
              granted = await FreedomVpn.prepareVpn();
              // VPN prepare shows system dialog — user may need to come back
            }
            break;
          }
          case "accessibility": {
            if (FreedomAccessibility) {
              await FreedomAccessibility.openAccessibilitySettings();
              // User manually toggles in Settings — we check on return
            }
            return false; // Will be checked when app resumes
          }
          case "overlay": {
            if (FreedomOverlay) {
              await FreedomOverlay.requestOverlayPermission();
              // User manually toggles in Settings — we check on return
            }
            return false; // Will be checked when app resumes
          }
          case "deviceAdmin": {
            if (FreedomDeviceAdmin) {
              await FreedomDeviceAdmin.requestAdminActivation();
              // System dialog — check on return
            }
            return false; // Will be checked when app resumes
          }
        }
      } catch (error) {
        console.warn(`[usePermissions] Error requesting ${id}:`, error);
      } finally {
        setLoading(id, false);
      }

      if (granted) {
        setPermissionGranted(id, true);
      }

      return granted;
    },
    [setLoading, setPermissionGranted],
  );

  // Build permission statuses
  const permissions: PermissionStatus[] = PERMISSION_ORDER.map((id) => ({
    id,
    ...PERMISSION_META[id],
    granted: grantedPermissions[id],
    loading: loadingStates[id],
  }));

  const allGranted = PERMISSION_ORDER.every((id) => grantedPermissions[id]);
  const requiredGranted = PERMISSION_ORDER.filter(
    (id) => PERMISSION_META[id].required,
  ).every((id) => grantedPermissions[id]);
  const grantedCount = PERMISSION_ORDER.filter(
    (id) => grantedPermissions[id],
  ).length;

  return {
    permissions,
    allGranted,
    requiredGranted,
    grantedCount,
    totalCount: PERMISSION_ORDER.length,
    currentStep,
    setCurrentStep,
    requestPermission,
    checkAllPermissions,
  };
}
