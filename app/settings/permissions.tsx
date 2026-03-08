import { InteractionGuard } from "@/components/InteractionGuard";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service";
import * as FreedomDeviceAdmin from "@/modules/freedom-device-admin";
import * as FreedomOverlay from "@/modules/freedom-overlay";
import * as FreedomVpn from "@/modules/freedom-vpn-service";
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
  const { protection, controlMode, setProtection } = useAppStore();
  const [pendingPermission, setPendingPermission] = useState<string | null>(
    null,
  );

  // Refresh permission status when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      const checkPermissions = async (): Promise<void> => {
        const [vpn, accessibility, overlay, deviceAdmin] = await Promise.all([
          FreedomVpn.isVpnPrepared(),
          FreedomAccessibility.isAccessibilityEnabled(),
          FreedomOverlay.hasOverlayPermission(),
          FreedomDeviceAdmin.isAdminActive(),
        ]);

        setProtection({
          vpn,
          accessibility,
          overlay,
          deviceAdmin,
        });
      };

      void checkPermissions();
      // Periodically check for a few seconds since intent returns might be slow
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
      status: protection.vpn,
      icon: "shield-checkmark-outline",
      color: "#2DD4BF",
    },
    {
      id: "accessibility",
      title: "Accessibility Service",
      description: "Monitors browsers and detects social media reels",
      status: protection.accessibility,
      icon: "accessibility-outline",
      color: "#2DD4BF",
    },
    {
      id: "overlay",
      title: "Display Over Other Apps",
      description: "Allows the app to show the 'Stay Away' screen",
      status: protection.overlay,
      icon: "copy-outline",
      color: "#2DD4BF",
    },
    {
      id: "deviceAdmin",
      title: "Device Administrator",
      description: "Prevents accidental uninstallation",
      status: protection.deviceAdmin,
      icon: "hardware-chip-outline",
      color: "#2DD4BF",
    },
  ];

  const handlePermissionPress = (id: string, currentStatus: boolean): void => {
    // If enabling, it's always allowed (strengthening protection)
    if (!currentStatus) {
      void requestPermission(id);
      return;
    }

    // If disabling and in locked/hardcore mode, must pass the guard
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
      className="flex-1 bg-white dark:bg-freedom-primary"
      edges={["top"]}
    >
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          onPress={() => {
            router.back();
          }}
          className="p-2 -ml-2"
        >
          <Ionicons name="arrow-back" size={24} color="#2DD4BF" />
        </Pressable>
        <Text className="text-xl font-bold text-black dark:text-white ml-2">
          Permissions
        </Text>
      </View>

      <ScrollView className="flex-1 px-4 pt-4">
        <Text className="text-freedom-text-muted mb-6">
          Manage the core permissions required for Freedom to provide full
          protection.
        </Text>

        <View className="bg-gray-100 dark:bg-freedom-surface rounded-2xl overflow-hidden mb-6">
          {permissionItems.map((item, index) => (
            <Pressable
              key={item.id}
              onPress={() => {
                handlePermissionPress(item.id, item.status);
              }}
              className={`p-4 flex-row items-center justify-between border-b border-gray-200 dark:border-freedom-secondary active:bg-gray-200 dark:active:bg-freedom-accent/10 ${index === permissionItems.length - 1 ? "border-b-0" : ""}`}
            >
              <View className="flex-row items-center flex-1">
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                  style={{ backgroundColor: item.color + "20" }}
                >
                  <Ionicons
                    name={item.icon as ComponentProps<typeof Ionicons>["name"]}
                    size={22}
                    color={item.color}
                  />
                </View>
                <View className="flex-1 pr-4">
                  <Text className="text-black dark:text-white font-bold">
                    {item.title}
                  </Text>
                  <Text className="text-freedom-text-muted text-xs mt-0.5">
                    {item.description}
                  </Text>
                </View>
              </View>

              <View
                className={`px-3 py-1 rounded-full ${item.status ? "bg-freedom-success/20" : "bg-gray-200 dark:bg-freedom-accent/30"}`}
              >
                <Text
                  className={`text-[10px] uppercase font-bold ${item.status ? "text-freedom-success" : "text-freedom-text-muted"}`}
                >
                  {item.status ? "Active" : "Grant"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View className="bg-freedom-highlight/10 p-4 rounded-xl">
          <View className="flex-row items-center mb-2">
            <Ionicons name="information-circle" size={20} color="#2DD4BF" />
            <Text className="ml-2 font-bold text-freedom-highlight">
              Hardcore Note
            </Text>
          </View>
          <Text className="text-black dark:text-white text-sm leading-5">
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
