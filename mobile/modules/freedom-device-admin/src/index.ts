import { requireNativeModule } from "expo-modules-core";

interface FreedomDeviceAdminModuleInterface {
  isAdminActive(): Promise<boolean>;
  requestAdminActivation(): Promise<boolean>;
  isDeviceOwner(): Promise<boolean>;
  setPackagesSuspended(
    packages: string[],
    suspended: boolean,
  ): Promise<string[]>;
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

export async function isDeviceOwner(): Promise<boolean> {
  if (!FreedomDeviceAdminNative) return false;
  return FreedomDeviceAdminNative.isDeviceOwner();
}

export async function setPackagesSuspended(
  packages: string[],
  suspended: boolean,
): Promise<string[]> {
  if (!FreedomDeviceAdminNative) return packages;
  return FreedomDeviceAdminNative.setPackagesSuspended(packages, suspended);
}
