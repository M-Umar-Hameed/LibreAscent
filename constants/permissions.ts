import type { Ionicons } from "@expo/vector-icons";

export type PermissionId =
  | "notifications"
  | "vpn"
  | "accessibility"
  | "overlay"
  | "deviceAdmin";

export interface PermissionConfig {
  id: PermissionId;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  required: boolean;
  grantType: "system-dialog" | "settings-page";
  settingsHint?: string;
}

export const PERMISSIONS: PermissionConfig[] = [
  {
    id: "notifications",
    title: "Notifications",
    description:
      "Required to show a persistent notification while protection is active",
    icon: "notifications",
    required: true,
    grantType: "system-dialog",
  },
  {
    id: "vpn",
    title: "VPN Service",
    description:
      "Creates a local VPN to filter network traffic and block adult domains",
    icon: "shield",
    required: true,
    grantType: "system-dialog",
  },
  {
    id: "accessibility",
    title: "Accessibility Service",
    description:
      "Monitors browser URLs and detects reels sections in social media apps",
    icon: "eye",
    required: true,
    grantType: "settings-page",
    settingsHint: "Find 'Freedom' in Settings > Accessibility and turn it on",
  },
  {
    id: "overlay",
    title: "Display Over Other Apps",
    description:
      'Shows the "Stay Away" screen when harmful content is detected',
    icon: "layers",
    required: true,
    grantType: "settings-page",
    settingsHint: "Find 'Freedom' and toggle 'Allow display over other apps'",
  },
  {
    id: "deviceAdmin",
    title: "Device Administrator",
    description: "Prevents the app from being uninstalled without permission",
    icon: "lock-closed",
    required: false,
    grantType: "system-dialog",
  },
];
