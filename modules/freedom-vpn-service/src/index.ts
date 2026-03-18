import {
  EventEmitter as ExpoEventEmitter,
  requireNativeModule,
} from "expo-modules-core";

interface FreedomVpnModuleInterface {
  startVpn(): Promise<void>;
  stopVpn(): Promise<void>;
  isVpnActive(): Promise<boolean>;
  isVpnPrepared(): Promise<boolean>;
  prepareVpn(): Promise<boolean>;
  updateBlocklist(domains: string[]): Promise<void>;
  addCategory(name: string, domains: string[]): Promise<void>;
  removeCategory(name: string): Promise<void>;
  setWhitelist(domains: string[]): Promise<void>;
  getBlockedCount(): Promise<number>;
  getBlocklistSize(): Promise<number>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

let FreedomVpnNative: FreedomVpnModuleInterface | null = null;

try {
  FreedomVpnNative = requireNativeModule("FreedomVpnModule");
} catch {
  // Native module not available (web/dev mode)
}

export async function startVpn(): Promise<void> {
  if (!FreedomVpnNative) {
    console.warn("[FreedomVPN] Native module not available");
    return;
  }
  return FreedomVpnNative.startVpn();
}

export async function stopVpn(): Promise<void> {
  if (!FreedomVpnNative) return;
  return FreedomVpnNative.stopVpn();
}

export async function isVpnActive(): Promise<boolean> {
  if (!FreedomVpnNative) return false;
  return FreedomVpnNative.isVpnActive();
}

export async function isVpnPrepared(): Promise<boolean> {
  if (!FreedomVpnNative) return false;
  return FreedomVpnNative.isVpnPrepared();
}

export async function prepareVpn(): Promise<boolean> {
  if (!FreedomVpnNative) return false;
  return FreedomVpnNative.prepareVpn();
}

export async function updateBlocklist(domains: string[]): Promise<void> {
  if (!FreedomVpnNative) return;
  return FreedomVpnNative.updateBlocklist(domains);
}

export async function addCategory(
  name: string,
  domains: string[],
): Promise<void> {
  if (!FreedomVpnNative) return;
  return FreedomVpnNative.addCategory(name, domains);
}

export async function removeCategory(name: string): Promise<void> {
  if (!FreedomVpnNative) return;
  return FreedomVpnNative.removeCategory(name);
}

export async function setWhitelist(domains: string[]): Promise<void> {
  if (!FreedomVpnNative) return;
  return FreedomVpnNative.setWhitelist(domains);
}

export async function getBlockedCount(): Promise<number> {
  if (!FreedomVpnNative) return 0;
  return FreedomVpnNative.getBlockedCount();
}

export async function getBlocklistSize(): Promise<number> {
  if (!FreedomVpnNative) return 0;
  return FreedomVpnNative.getBlocklistSize();
}

// Event listeners — wired to native module BroadcastReceiver events
export function onDomainBlocked(
  listener: (event: { domain: string; timestamp: number }) => void,
): { remove: () => void } {
  if (!FreedomVpnNative)
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter: any = new ExpoEventEmitter(FreedomVpnNative as any);
    return emitter.addListener("onDomainBlocked", listener);
  } catch {
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  }
}

export function onVpnStatusChanged(
  listener: (event: { active: boolean }) => void,
): { remove: () => void } {
  if (!FreedomVpnNative)
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter: any = new ExpoEventEmitter(FreedomVpnNative as any);
    return emitter.addListener("onVpnStatusChanged", listener);
  } catch {
    return {
      remove: (): void => {
        /* ignore */
      },
    };
  }
}
