/// <reference types="vite/client" />

export type BlockedAppRule = {
  name: string;
  executable: string;
  fullPath?: string | null;
};

export type BlocklistSource = {
  id: string;
  name: string;
  url: string;
  format: string;
  enabled: boolean;
};

export type DesktopConfig = {
  schemaVersion: number;
  adultBlockingEnabled: boolean;
  sources: BlocklistSource[];
  includedDomains: string[];
  excludedDomains: string[];
  keywords: string[];
  blockedApps: BlockedAppRule[];
  controlMode: "flexible" | "locked" | "hardcore";
  friction: {
    countdownSeconds: number;
    clickCount: number;
  };
};

export type DesktopStatus = {
  serviceInstalled: boolean;
  serviceRunning: boolean;
  dnsProxyRunning: boolean;
  dnsControlled: boolean;
  firewallControlled: boolean;
  configPath: string;
  isAdmin: boolean;
};
