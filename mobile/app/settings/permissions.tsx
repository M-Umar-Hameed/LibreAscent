import { InteractionGuard } from "@/components/InteractionGuard";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service";
import * as FreedomDeviceAdmin from "@/modules/freedom-device-admin";
import * as FreedomOverlay from "@/modules/freedom-overlay";
import * as FreedomVpn from "@/modules/freedom-vpn-service";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useAppStore } from "@/stores/useAppStore";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PermissionsScreen(): ReactNode {
  const router = useRouter();
  const t = useAppTheme();
  const { protection, controlMode, setProtection } = useAppStore();
  const [pendingPermission, setPendingPermission] = useState<string | null>(
    null,
  );
  const [vpnPrepared, setVpnPrepared] = useState(false);
  const [alwaysOnVpn, setAlwaysOnVpn] = useState(false);
  const [accessibilityPermission, setAccessibilityPermission] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const checkPermissions = async (): Promise<void> => {
        const [
          vpnPermissionReady,
          vpnActive,
          accessibilityEnabled,
          accessibilityRunning,
          overlay,
          deviceAdmin,
          alwaysOn,
        ] = await Promise.all([
          FreedomVpn.isVpnPrepared(),
          FreedomVpn.isVpnActive(),
          FreedomAccessibility.isAccessibilityEnabled(),
          FreedomAccessibility.isServiceRunning(),
          FreedomOverlay.hasOverlayPermission(),
          FreedomDeviceAdmin.isAdminActive(),
          FreedomVpn.isAlwaysOnVpnEnabled(),
        ]);

        setProtection({
          vpn: vpnActive,
          accessibility: accessibilityEnabled && accessibilityRunning,
          overlay,
          deviceAdmin,
        });
        setVpnPrepared(vpnPermissionReady);
        setAlwaysOnVpn(alwaysOn);
        setAccessibilityPermission(accessibilityEnabled);
      };

      void checkPermissions();
      const interval = setInterval(() => {
        void checkPermissions();
      }, 2000);
      return () => {
        clearInterval(interval);
      };
    }, [setProtection]),
  );

  const permissionItems = [
    {
      id: "vpn",
      title: "VPN Service",
      description: "Required for system-wide content blocking",
      status: vpnPrepared,
      icon: "shield-checkmark-outline",
    },
    {
      id: "alwaysOnVpn",
      title: "Always-on VPN",
      description:
        "Blocking stops the moment the VPN is switched off. Turn this on in Android's VPN settings.",
      status: alwaysOnVpn,
      icon: "lock-closed-outline",
    },
    {
      id: "accessibility",
      title: "Accessibility Service",
      description: "Monitors browsers and detects social media reels",
      status: accessibilityPermission,
      icon: "accessibility-outline",
    },
    {
      id: "overlay",
      title: "Display Over Other Apps",
      description: "Allows the app to show the 'Stay Away' screen",
      status: protection.overlay,
      icon: "copy-outline",
    },
    {
      id: "deviceAdmin",
      title: "Device Administrator",
      description: "Prevents accidental uninstallation",
      status: protection.deviceAdmin,
      icon: "hardware-chip-outline",
    },
  ];

  const handlePermissionPress = (id: string, currentStatus: boolean): void => {
    if (!currentStatus) {
      void requestPermission(id);
      return;
    }

    if (controlMode !== "flexible") {
      setPendingPermission(id);
    } else {
      void requestPermission(id);
    }
  };

  const requestPermission = async (id: string): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingPermission(null);

    try {
      switch (id) {
        case "vpn":
          await FreedomVpn.prepareVpn();
          break;
        case "alwaysOnVpn":
          // Only the Settings app can set this; the app can just point at it.
          await FreedomVpn.openVpnSettings();
          break;
        case "accessibility":
          await FreedomAccessibility.openAccessibilitySettings();
          break;
        case "overlay":
          await FreedomOverlay.requestOverlayPermission();
          break;
        case "deviceAdmin":
          await FreedomDeviceAdmin.requestAdminActivation();
          break;
      }
    } catch (error) {
      console.error(`[PermissionsScreen] Failed to request ${id}:`, error);
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: t.bgColor }}
      edges={["top"]}
    >
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          onPress={() => {
            router.back();
          }}
          className="p-2 -ml-2"
        >
          <Ionicons name="arrow-back" size={24} color={t.accentColor} />
        </Pressable>
        <Text
          className="text-xl font-bold ml-2 tracking-tight leading-none"
          style={{ color: t.textColor }}
        >
          Permissions
        </Text>
      </View>

      <ScrollView className="flex-1 px-4 pt-4">
        <Text className="mb-6" style={{ color: t.mutedTextColor }}>
          Manage the core permissions required for LibreAscent to provide full
          protection.
        </Text>

        <View
          className="rounded-2xl overflow-hidden mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          {permissionItems.map((item, index) => (
            <Pressable
              key={item.id}
              onPress={() => {
                handlePermissionPress(item.id, item.status);
              }}
              aria-label={`Grant ${item.title} permission`}
              className="p-5 flex-row items-center justify-between"
              style={
                index !== permissionItems.length - 1
                  ? {
                      borderBottomWidth: 1,
                      borderBottomColor: t.mutedTextColor + "33",
                    }
                  : undefined
              }
            >
              <View className="flex-row items-center flex-1">
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                  style={{ backgroundColor: t.accentColor + "20" }}
                >
                  <Ionicons
                    name={item.icon as ComponentProps<typeof Ionicons>["name"]}
                    size={22}
                    color={t.accentColor}
                  />
                </View>
                <View className="flex-1 pr-4">
                  <Text className="font-bold" style={{ color: t.textColor }}>
                    {item.title}
                  </Text>
                  <Text
                    className="text-xs mt-0.5"
                    style={{ color: t.mutedTextColor }}
                  >
                    {item.description}
                  </Text>
                </View>
              </View>

              <View
                className="px-3 py-1 rounded-full"
                style={{
                  backgroundColor: item.status
                    ? t.successColor + "33"
                    : t.accentColor + "4D",
                }}
              >
                <Text
                  className="text-[10px] uppercase font-bold"
                  style={{
                    color: item.status ? t.successColor : t.mutedTextColor,
                  }}
                >
                  {item.status ? "Active" : "Grant"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View
          className="p-4 rounded-xl"
          style={{ backgroundColor: t.accentColor + "1A" }}
        >
          <View className="flex-row items-center mb-2">
            <Ionicons
              name="information-circle"
              size={20}
              color={t.accentColor}
            />
            <Text className="ml-2 font-bold" style={{ color: t.accentColor }}>
              Hardcore Note
            </Text>
          </View>
          <Text className="text-sm leading-5" style={{ color: t.textColor }}>
            In Hardcore mode, some permissions cannot be disabled through system
            settings. This screen allows you to see their status.
          </Text>
        </View>
      </ScrollView>

      <InteractionGuard
        visible={pendingPermission !== null}
        actionName="Change Permission Status"
        onSuccess={() => {
          if (pendingPermission) void requestPermission(pendingPermission);
        }}
        onCancel={() => {
          setPendingPermission(null);
        }}
      />
    </SafeAreaView>
  );
}
