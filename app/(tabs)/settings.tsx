import { InteractionGuard } from "@/components/InteractionGuard";
import { BlocklistService } from "@/services/BlocklistService";
import { useAppStore } from "@/stores/useAppStore";
import {
  useBlockingStore,
  type BlockingState,
} from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import type { ReactNode } from "react";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen(): ReactNode {
  const {
    autoStartOnBoot,
    setAutoStart,
    theme,
    setTheme,
    passwordHash,
    controlMode,
  } = useAppStore();
  const {
    keywords,
    includedUrls,
    excludedUrls,
    adultBlockingEnabled,
    sources,
    importSettings,
  } = useBlockingStore();
  const router = useRouter();

  const [pendingAction, setPendingAction] = useState<
    "boot" | "password" | null
  >(null);

  const handleBootToggle = (isEnabling: boolean): void => {
    if (controlMode === "flexible" || isEnabling) {
      toggleBoot();
    } else {
      setPendingAction("boot");
    }
  };

  const toggleBoot = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAutoStart(!autoStartOnBoot);
    setPendingAction(null);
  };

  const handlePasswordToggle = (isEnabling: boolean): void => {
    if (controlMode === "flexible" || isEnabling) {
      togglePassword();
    } else {
      setPendingAction("password");
    }
  };

  const togglePassword = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: Open password modal
    setPendingAction(null);
  };

  const handleExport = async (): Promise<void> => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const settings = {
        keywords,
        includedUrls,
        excludedUrls,
        adultBlockingEnabled,
        sources,
        exportedAt: new Date().toISOString(),
        version: "1.1.1",
      };

      const docDir = FileSystem.documentDirectory;
      const fileUri = `${docDir}freedom_settings.json`;
      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(settings, null, 2),
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("Error", "Sharing is not available on this device.");
      }
    } catch (e) {
      console.error("[Settings] Export failed:", e);
      Alert.alert("Error", "Failed to export settings.");
    }
  };

  const handleImport = async (): Promise<void> => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const fileContent = await FileSystem.readAsStringAsync(
        result.assets[0].uri,
      );
      const data = JSON.parse(fileContent) as Partial<BlockingState>;

      // Basic validation
      if (!data.keywords && !data.sources) {
        Alert.alert("Error", "Invalid settings file.");
        return;
      }

      importSettings(data);
      Alert.alert(
        "Success",
        "Settings imported successfully. Syncing with native services...",
      );
      await BlocklistService.syncBlocklistToNative();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error("[Settings] Import failed:", e);
      Alert.alert(
        "Error",
        "Failed to import settings. Ensure the file is a valid Freedom settings JSON.",
      );
    }
  };

  const openRepo = (): void => {
    void Haptics.selectionAsync();
    void Linking.openURL("https://github.com/M-Umar-Hameed/Freedom");
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-freedom-primary"
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text className="text-2xl font-bold text-black dark:text-white mb-6 tracking-tight leading-tight">
          Settings
        </Text>

        {/* Protection Settings */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Protection
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <View className="flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-freedom-secondary">
            <View className="flex-1">
              <Text className="text-black dark:text-white">
                Auto-start on Boot
              </Text>
              <Text className="text-freedom-text-muted text-sm">
                Start protection when device restarts
              </Text>
            </View>
            <Switch
              value={autoStartOnBoot}
              onValueChange={handleBootToggle}
              trackColor={{ false: "#ccc", true: "#2DD4BF" }}
              thumbColor={autoStartOnBoot ? "#fff" : "#999"}
              aria-label="Toggle auto-start on boot"
            />
          </View>
          <View className="flex-row items-center justify-between p-4">
            <View className="flex-1">
              <Text className="text-black dark:text-white">
                Password Protection
              </Text>
              <Text className="text-freedom-text-muted text-sm">
                Require password to disable protection
              </Text>
            </View>
            <Switch
              value={!!passwordHash}
              onValueChange={handlePasswordToggle}
              trackColor={{ false: "#ccc", true: "#2DD4BF" }}
              thumbColor={passwordHash ? "#fff" : "#999"}
              aria-label="Toggle password protection"
            />
          </View>
        </View>

        {/* Control & Schedule */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Control & Schedule
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/control-modes");
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-freedom-secondary"
          >
            <View className="flex-row items-center">
              <Ionicons name="shield-outline" size={20} color="#2DD4BF" />
              <View className="ml-3">
                <Text className="text-black dark:text-white">
                  Control Modes
                </Text>
                <Text className="text-freedom-text-muted text-xs">
                  Flexible, Locked, or Hardcore
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/schedule");
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons name="alarm-outline" size={20} color="#2DD4BF" />
              <View className="ml-3">
                <Text className="text-black dark:text-white">Schedule</Text>
                <Text className="text-freedom-text-muted text-xs">
                  Plan your protection times
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
        </View>

        {/* Display Settings */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Display
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <View className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center">
              <Ionicons
                name={
                  theme === "dark"
                    ? "moon-outline"
                    : theme === "light"
                      ? "sunny-outline"
                      : "color-palette-outline"
                }
                size={20}
                color="#2DD4BF"
              />
              <Text className="text-black dark:text-white ml-3">Theme</Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  setTheme("light");
                }}
                className={`px-3 py-1.5 rounded-lg active:opacity-70 ${theme === "light" ? "bg-freedom-accent" : "bg-gray-300 dark:bg-freedom-accent"}`}
              >
                <Text
                  className={`${theme === "light" ? "text-freedom-primary" : "text-black dark:text-white"} text-xs font-semibold`}
                >
                  Light
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  setTheme("dark");
                }}
                className={`px-3 py-1.5 rounded-lg active:opacity-70 ${theme === "dark" ? "bg-freedom-accent" : "bg-gray-300 dark:bg-freedom-accent"}`}
              >
                <Text
                  className={`${theme === "dark" ? "text-freedom-primary" : "text-black dark:text-white"} text-xs font-semibold`}
                >
                  Dark
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  setTheme("system");
                }}
                className={`px-3 py-1.5 rounded-lg active:opacity-70 ${theme === "system" ? "bg-freedom-accent" : "bg-gray-300 dark:bg-freedom-accent"}`}
              >
                <Text
                  className={`${theme === "system" ? "text-freedom-primary" : "text-black dark:text-white"} text-xs font-semibold`}
                >
                  System
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Permissions */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Permissions
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/permissions");
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-freedom-secondary"
          >
            <View className="flex-row items-center">
              <Ionicons name="finger-print-outline" size={20} color="#2DD4BF" />
              <Text className="text-black dark:text-white ml-3">
                Manage Permissions
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/update-sources");
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons
                name="cloud-download-outline"
                size={20}
                color="#2DD4BF"
              />
              <Text className="text-black dark:text-white ml-3">
                Update Sources
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
        </View>

        {/* Data */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Data
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <Pressable
            onPress={handleExport}
            aria-label="Export Settings"
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-5 border-b border-gray-200 dark:border-freedom-secondary"
          >
            <View className="flex-row items-center">
              <Ionicons name="share-outline" size={20} color="#2DD4BF" />
              <Text className="text-black dark:text-white ml-3">
                Export Settings
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={handleImport}
            aria-label="Import Settings"
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-5"
          >
            <View className="flex-row items-center">
              <Ionicons name="download-outline" size={20} color="#F59E0B" />
              <Text className="text-black dark:text-white ml-3">
                Import Settings
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
        </View>

        {/* About */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          About
        </Text>
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl mb-6">
          <View className="p-4 border-b border-gray-200 dark:border-freedom-secondary">
            <Text className="text-black dark:text-white">Version</Text>
            <Text className="text-freedom-text-muted text-sm">
              1.1.1 (Touka_Debo)
            </Text>
          </View>
          <Pressable
            onPress={openRepo}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-freedom-secondary"
          >
            <Text className="text-black dark:text-white">
              GitHub Repository
            </Text>
            <Ionicons name="open" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://github.com/M-Umar-Hameed/Freedom/issues",
              );
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-freedom-secondary"
          >
            <Text className="text-black dark:text-white">
              Support Resources
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://github.com/M-Umar-Hameed/Freedom/blob/main/LICENSE",
              );
            }}
            className="active:bg-gray-200 dark:active:bg-freedom-secondary flex-row items-center justify-between p-4"
          >
            <Text className="text-black dark:text-white">
              Open Source Licenses
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
        </View>
      </ScrollView>

      <InteractionGuard
        visible={pendingAction !== null}
        actionName={
          pendingAction === "boot"
            ? "Disable Auto-start"
            : "Disable Password Protection"
        }
        onSuccess={() => {
          if (pendingAction === "boot") toggleBoot();
          else if (pendingAction === "password") togglePassword();
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
