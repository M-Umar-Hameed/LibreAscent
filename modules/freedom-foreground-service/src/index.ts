import { requireNativeModule } from "expo-modules-core";

interface FreedomForegroundModuleInterface {
  startService(): Promise<void>;
  stopService(): Promise<void>;
  isServiceRunning(): Promise<boolean>;
  updateNotification(title?: string, text?: string): Promise<void>;
  setAutoStart(enabled: boolean): Promise<void>;
  isAutoStartEnabled(): Promise<boolean>;
}

let FreedomForegroundNative: FreedomForegroundModuleInterface | null = null;

try {
  FreedomForegroundNative = requireNativeModule("FreedomForegroundModule");
} catch {
  // Native module not available
}

export async function startService(): Promise<void> {
  if (!FreedomForegroundNative) {
    console.warn("[FreedomForeground] Native module not available");
    return;
  }
  return FreedomForegroundNative.startService();
}

export async function stopService(): Promise<void> {
  if (!FreedomForegroundNative) return;
  return FreedomForegroundNative.stopService();
}

export async function isServiceRunning(): Promise<boolean> {
  if (!FreedomForegroundNative) return false;
  return FreedomForegroundNative.isServiceRunning();
}

export async function updateNotification(
  title?: string,
  text?: string,
): Promise<void> {
  if (!FreedomForegroundNative) return;
  return FreedomForegroundNative.updateNotification(title, text);
}

export async function setAutoStart(enabled: boolean): Promise<void> {
  if (!FreedomForegroundNative) return;
  return FreedomForegroundNative.setAutoStart(enabled);
}

export async function isAutoStartEnabled(): Promise<boolean> {
  if (!FreedomForegroundNative) return true;
  return FreedomForegroundNative.isAutoStartEnabled();
}
