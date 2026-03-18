import { requireNativeModule } from "expo-modules-core";

interface FreedomDeviceAdminModuleInterface {
  isAdminActive(): Promise<boolean>;
  requestAdminActivation(): Promise<boolean>;
}

let FreedomDeviceAdminNative: FreedomDeviceAdminModuleInterface | null = null;

try {
  FreedomDeviceAdminNative = requireNativeModule("FreedomDeviceAdminModule");
} catch {
  // Native module not available
}

export async function isAdminActive(): Promise<boolean> {
  if (!FreedomDeviceAdminNative) return false;
  return FreedomDeviceAdminNative.isAdminActive();
}

export async function requestAdminActivation(): Promise<boolean> {
  if (!FreedomDeviceAdminNative) return false;
  return FreedomDeviceAdminNative.requestAdminActivation();
}
