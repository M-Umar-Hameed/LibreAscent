import { InteractionGuard } from "@/components/InteractionGuard";
import { BlocklistService } from "@/services/BlocklistService";
import { useAppStore } from "@/stores/useAppStore";
import {
  useBlockingStore,
  type BlockingState,
} from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen(): ReactNode {
  const {
    autoStartOnBoot,
    setAutoStart,
    theme,
    setTheme,
    appLockEnabled,
    setAppLockEnabled,
    setAppLockType,
    setAppLockHash,
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

  const [pendingAction, setPendingAction] = useState<"boot" | "applock" | null>(
    null,
  );

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

  // App lock setup modal state
  const [lockSetupVisible, setLockSetupVisible] = useState(false);
  const [lockSetupStep, setLockSetupStep] = useState<
    "choose" | "password" | "confirm"
  >("choose");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [lockSetupError, setLockSetupError] = useState("");

  const handleAppLockToggle = (isEnabling: boolean): void => {
    if (isEnabling) {
      setLockSetupStep("choose");
      setNewPassword("");
      setConfirmPassword("");
      setLockSetupError("");
      setLockSetupVisible(true);
    } else if (controlMode === "flexible") {
      disableAppLock();
    } else {
      setPendingAction("applock");
    }
  };

  const disableAppLock = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAppLockEnabled(false);
    setAppLockType(null);
    setAppLockHash(null);
    setPendingAction(null);
  };

  const handleChoosePasskey = async (): Promise<void> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolled) {
      setLockSetupError(
        "Biometric authentication is not available on this device. Please use a password instead.",
      );
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirm your fingerprint for app lock",
      disableDeviceFallback: true,
    });
    if (result.success) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAppLockEnabled(true);
      setAppLockType("passkey");
      setAppLockHash(null);
      setLockSetupVisible(false);
    } else {
      setLockSetupError("Biometric authentication failed. Try again.");
    }
  };

  const handleChoosePassword = (): void => {
    setLockSetupError("");
    setLockSetupStep("password");
  };

  const handlePasswordSetup = async (): Promise<void> => {
    if (newPassword.length < 4) {
      setLockSetupError("Password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setLockSetupError("Passwords do not match.");
      return;
    }
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      newPassword,
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAppLockEnabled(true);
    setAppLockType("password");
    setAppLockHash(hash);
    setNewPassword("");
    setConfirmPassword("");
    setLockSetupVisible(false);
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
        version: "1.3.0",
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
              <Text className="text-black dark:text-white">App Lock</Text>
              <Text className="text-freedom-text-muted text-sm">
                Require password or passkey to open the app
              </Text>
            </View>
            <Switch
              value={appLockEnabled}
              onValueChange={handleAppLockToggle}
              trackColor={{ false: "#ccc", true: "#2DD4BF" }}
              thumbColor={appLockEnabled ? "#fff" : "#999"}
              aria-label="Toggle app lock"
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
              1.3.0 (Touka_Debo)
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

      {/* App Lock Setup Modal */}
      <Modal visible={lockSetupVisible} animationType="fade" transparent>
        <View className="flex-1 bg-black/60 justify-center px-6">
          <View className="bg-white dark:bg-freedom-surface rounded-3xl p-6 border border-freedom-highlight/20">
            {lockSetupStep === "choose" ? (
              <>
                <View className="items-center mb-6">
                  <View className="w-16 h-16 rounded-full bg-freedom-highlight/20 items-center justify-center mb-4">
                    <Ionicons name="lock-closed" size={32} color="#2DD4BF" />
                  </View>
                  <Text className="text-xl font-bold text-black dark:text-white text-center">
                    Set Up App Lock
                  </Text>
                  <Text className="text-freedom-text-muted text-center mt-2">
                    Choose how you want to lock the app
                  </Text>
                </View>

                {lockSetupError ? (
                  <Text className="text-red-500 text-center text-sm mb-4">
                    {lockSetupError}
                  </Text>
                ) : null}

                <Pressable
                  onPress={() => {
                    void handleChoosePasskey();
                  }}
                  className="bg-freedom-highlight/10 border-2 border-freedom-highlight p-4 rounded-2xl flex-row items-center mb-3"
                >
                  <View className="w-12 h-12 rounded-full bg-freedom-highlight items-center justify-center">
                    <Ionicons name="finger-print" size={28} color="white" />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-black dark:text-white font-bold text-base">
                      Passkey (Fingerprint)
                    </Text>
                    <Text className="text-freedom-text-muted text-xs mt-0.5">
                      Quick unlock with your fingerprint
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={handleChoosePassword}
                  className="bg-gray-100 dark:bg-freedom-primary border-2 border-gray-200 dark:border-freedom-secondary p-4 rounded-2xl flex-row items-center mb-6"
                >
                  <View className="w-12 h-12 rounded-full bg-gray-300 dark:bg-freedom-accent items-center justify-center">
                    <Ionicons name="keypad" size={28} color="white" />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-black dark:text-white font-bold text-base">
                      Password
                    </Text>
                    <Text className="text-freedom-text-muted text-xs mt-0.5">
                      Set a custom password
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setLockSetupVisible(false);
                  }}
                  className="py-3 items-center"
                >
                  <Text className="text-freedom-text-muted font-semibold">
                    Cancel
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <View className="items-center mb-6">
                  <View className="w-16 h-16 rounded-full bg-freedom-highlight/20 items-center justify-center mb-4">
                    <Ionicons name="keypad" size={32} color="#2DD4BF" />
                  </View>
                  <Text className="text-xl font-bold text-black dark:text-white text-center">
                    Set Password
                  </Text>
                  <Text className="text-freedom-text-muted text-center mt-2">
                    Minimum 4 characters
                  </Text>
                </View>

                {lockSetupError ? (
                  <Text className="text-red-500 text-center text-sm mb-4">
                    {lockSetupError}
                  </Text>
                ) : null}

                <Text className="text-freedom-text-muted text-sm mb-1">
                  Password
                </Text>
                <TextInput
                  value={newPassword}
                  onChangeText={(text) => {
                    setNewPassword(text);
                    setLockSetupError("");
                  }}
                  placeholder="Enter password"
                  placeholderTextColor="#64748B"
                  secureTextEntry
                  autoFocus
                  className="bg-gray-100 dark:bg-freedom-secondary p-3 rounded-lg text-black dark:text-white mb-4"
                />

                <Text className="text-freedom-text-muted text-sm mb-1">
                  Confirm Password
                </Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setLockSetupError("");
                  }}
                  placeholder="Confirm password"
                  placeholderTextColor="#64748B"
                  secureTextEntry
                  className="bg-gray-100 dark:bg-freedom-secondary p-3 rounded-lg text-black dark:text-white mb-6"
                />

                <View className="flex-row">
                  <Pressable
                    onPress={() => {
                      setLockSetupStep("choose");
                      setNewPassword("");
                      setConfirmPassword("");
                      setLockSetupError("");
                    }}
                    className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-freedom-secondary mr-2"
                  >
                    <Text className="text-center text-black dark:text-white">
                      Back
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void handlePasswordSetup();
                    }}
                    className="flex-1 p-3 rounded-xl bg-freedom-accent"
                  >
                    <Text className="text-center text-freedom-primary font-bold">
                      Set Password
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <InteractionGuard
        visible={pendingAction !== null}
        actionName={
          pendingAction === "boot" ? "Disable Auto-start" : "Disable App Lock"
        }
        onSuccess={() => {
          if (pendingAction === "boot") toggleBoot();
          else if (pendingAction === "applock") disableAppLock();
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
