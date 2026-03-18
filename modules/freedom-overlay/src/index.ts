import { requireNativeModule } from "expo-modules-core";

interface FreedomOverlayModuleInterface {
  showOverlay(message?: string): Promise<void>;
  hideOverlay(): Promise<void>;
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  isOverlayShowing(): Promise<boolean>;
}

let FreedomOverlayNative: FreedomOverlayModuleInterface | null = null;

try {
  FreedomOverlayNative = requireNativeModule("FreedomOverlayModule");
} catch {
  // Native module not available
}

export async function showOverlay(message?: string): Promise<void> {
  if (!FreedomOverlayNative) {
    console.warn("[FreedomOverlay] Native module not available");
    return;
  }
  return FreedomOverlayNative.showOverlay(message);
}

export async function hideOverlay(): Promise<void> {
  if (!FreedomOverlayNative) return;
  return FreedomOverlayNative.hideOverlay();
}

export async function hasOverlayPermission(): Promise<boolean> {
  if (!FreedomOverlayNative) return false;
  return FreedomOverlayNative.hasOverlayPermission();
}

export async function requestOverlayPermission(): Promise<void> {
  if (!FreedomOverlayNative) {
    console.warn("[FreedomOverlay] Native module not available");
    return;
  }
  return FreedomOverlayNative.requestOverlayPermission();
}

export async function isOverlayShowing(): Promise<boolean> {
  if (!FreedomOverlayNative) return false;
  return FreedomOverlayNative.isOverlayShowing();
}
