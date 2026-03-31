import { InteractionGuard } from "@/components/InteractionGuard";
import type { AppTheme } from "@/constants/overlay-themes";
import { useAppTheme } from "@/providers/ThemeProvider";
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
  const t = useAppTheme();
  const {
    autoStartOnBoot,
    setAutoStart,
    appLockEnabled,
    setAppLockEnabled,
    setAppLockType,
    setAppLockHash,
    controlMode,
    appThemeId,
    customTheme,
    overlayCustomImage,
    overlayTexts,
    setAppThemeId,
    setCustomTheme,
    setOverlayTexts,
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
        appThemeId,
        customTheme,
        overlayCustomImage,
        overlayTexts,
        exportedAt: new Date().toISOString(),
        version: "1.6.0",
      };

      const docDir = FileSystem.documentDirectory;
      const fileUri = `${docDir}libreascent_settings.json`;
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
      const data = JSON.parse(fileContent) as Record<string, unknown>;

      // Basic validation
      if (!data.keywords && !data.sources) {
        Alert.alert("Error", "Invalid settings file.");
        return;
      }

      importSettings(data as Partial<BlockingState>);
      if (data.appThemeId) setAppThemeId(data.appThemeId as string);
      if (data.customTheme) setCustomTheme(data.customTheme as AppTheme);
      if (data.overlayTexts)
        setOverlayTexts(
          data.overlayTexts as Partial<{
            title: string;
            subtitle: string;
            heading: string;
            body: string;
          }>,
        );
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
        "Failed to import settings. Ensure the file is a valid LibreAscent settings JSON.",
      );
    }
  };

  const openRepo = (): void => {
    void Haptics.selectionAsync();
    void Linking.openURL("https://github.com/M-Umar-Hameed/LibreAscent");
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: t.bgColor }}
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text
          className="text-2xl font-bold mb-6 tracking-tight leading-tight"
          style={{ color: t.textColor }}
        >
          Settings
        </Text>

        {/* Protection Settings */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Protection
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <View className="flex-row items-center justify-between p-4 border-b border-gray-800">
            <View className="flex-1">
              <Text style={{ color: t.textColor }}>Auto-start on Boot</Text>
              <Text className="text-sm" style={{ color: t.mutedTextColor }}>
                Start protection when device restarts
              </Text>
            </View>
            <Switch
              value={autoStartOnBoot}
              onValueChange={handleBootToggle}
              trackColor={{ false: "#ccc", true: t.accentColor }}
              thumbColor={autoStartOnBoot ? "#fff" : "#999"}
              aria-label="Toggle auto-start on boot"
            />
          </View>
          <View className="flex-row items-center justify-between p-4">
            <View className="flex-1">
              <Text style={{ color: t.textColor }}>App Lock</Text>
              <Text className="text-sm" style={{ color: t.mutedTextColor }}>
                Require password or passkey to open the app
              </Text>
            </View>
            <Switch
              value={appLockEnabled}
              onValueChange={handleAppLockToggle}
              trackColor={{ false: "#ccc", true: t.accentColor }}
              thumbColor={appLockEnabled ? "#fff" : "#999"}
              aria-label="Toggle app lock"
            />
          </View>
        </View>

        {/* Control & Schedule */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Control & Schedule
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/control-modes");
            }}
            className="flex-row items-center justify-between p-4 border-b border-gray-800"
          >
            <View className="flex-row items-center">
              <Ionicons name="shield-outline" size={20} color={t.accentColor} />
              <View className="ml-3">
                <Text style={{ color: t.textColor }}>Control Modes</Text>
                <Text className="text-xs" style={{ color: t.mutedTextColor }}>
                  Flexible, Locked, or Hardcore
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/schedule");
            }}
            className="flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons name="alarm-outline" size={20} color={t.accentColor} />
              <View className="ml-3">
                <Text style={{ color: t.textColor }}>Schedule</Text>
                <Text className="text-xs" style={{ color: t.mutedTextColor }}>
                  Plan your protection times
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
        </View>

        {/* Display Settings */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Display
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/overlay-theme");
            }}
            className="flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons
                name="color-palette-outline"
                size={20}
                color={t.accentColor}
              />
              <Text className="ml-3" style={{ color: t.textColor }}>
                App Theme
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
        </View>

        {/* Permissions */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Permissions
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/permissions");
            }}
            className="flex-row items-center justify-between p-4 border-b border-gray-800"
          >
            <View className="flex-row items-center">
              <Ionicons
                name="finger-print-outline"
                size={20}
                color={t.accentColor}
              />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Manage Permissions
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              router.push("/settings/update-sources");
            }}
            className="flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons
                name="cloud-download-outline"
                size={20}
                color={t.accentColor}
              />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Update Sources
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
        </View>

        {/* Data */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Data
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Pressable
            onPress={handleExport}
            aria-label="Export Settings"
            className="flex-row items-center justify-between p-5 border-b border-gray-800"
          >
            <View className="flex-row items-center">
              <Ionicons name="share-outline" size={20} color={t.accentColor} />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Export Settings
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
          <Pressable
            onPress={handleImport}
            aria-label="Import Settings"
            className="flex-row items-center justify-between p-5"
          >
            <View className="flex-row items-center">
              <Ionicons
                name="download-outline"
                size={20}
                color={t.warningColor}
              />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Import Settings
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
        </View>

        {/* Support */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          Support
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://patreon.com/LibreAscent?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_fan&utm_content=copyLink",
              );
            }}
            className="flex-row items-center justify-between p-4 border-b border-gray-800"
          >
            <View className="flex-row items-center">
              <Ionicons name="heart-outline" size={20} color={t.accentColor} />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Patreon
              </Text>
            </View>
            <Ionicons name="open" size={20} color={t.mutedTextColor} />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://ascentlibre.gumroad.com/l/LibreAscent",
              );
            }}
            className="flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <Ionicons name="cart-outline" size={20} color={t.accentColor} />
              <Text className="ml-3" style={{ color: t.textColor }}>
                Gumroad
              </Text>
            </View>
            <Ionicons name="open" size={20} color={t.mutedTextColor} />
          </Pressable>
        </View>

        {/* About */}
        <Text
          className="text-sm font-semibold uppercase mb-3"
          style={{ color: t.mutedTextColor }}
        >
          About
        </Text>
        <View
          className="rounded-xl mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <View className="p-4 border-b border-gray-800">
            <Text style={{ color: t.textColor }}>Version</Text>
            <Text className="text-sm" style={{ color: t.mutedTextColor }}>
              1.6.0 (Touka_Debo)
            </Text>
          </View>
          <Pressable
            onPress={openRepo}
            className="flex-row items-center justify-between p-4 border-b border-gray-800"
          >
            <Text style={{ color: t.textColor }}>GitHub Repository</Text>
            <Ionicons name="open" size={20} color={t.mutedTextColor} />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://github.com/M-Umar-Hameed/LibreAscent/issues",
              );
            }}
            className="flex-row items-center justify-between p-4 border-b border-gray-800"
          >
            <Text style={{ color: t.textColor }}>Support Resources</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              void Linking.openURL(
                "https://github.com/M-Umar-Hameed/LibreAscent/blob/main/LICENSE",
              );
            }}
            className="flex-row items-center justify-between p-4"
          >
            <Text style={{ color: t.textColor }}>Open Source Licenses</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
        </View>
      </ScrollView>

      {/* App Lock Setup Modal */}
      <Modal visible={lockSetupVisible} animationType="fade" transparent>
        <View className="flex-1 bg-black/60 justify-center px-6">
          <View
            className="rounded-3xl p-6"
            style={{
              backgroundColor: t.cardBgColor,
              borderWidth: 1,
              borderColor: t.accentColor + "33",
            }}
          >
            {lockSetupStep === "choose" ? (
              <>
                <View className="items-center mb-6">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center mb-4"
                    style={{ backgroundColor: t.accentColor + "33" }}
                  >
                    <Ionicons
                      name="lock-closed"
                      size={32}
                      color={t.accentColor}
                    />
                  </View>
                  <Text
                    className="text-xl font-bold text-center"
                    style={{ color: t.textColor }}
                  >
                    Set Up App Lock
                  </Text>
                  <Text
                    className="text-center mt-2"
                    style={{ color: t.mutedTextColor }}
                  >
                    Choose how you want to lock the app
                  </Text>
                </View>

                {lockSetupError ? (
                  <Text
                    className="text-center text-sm mb-4"
                    style={{ color: t.dangerColor }}
                  >
                    {lockSetupError}
                  </Text>
                ) : null}

                <Pressable
                  onPress={() => {
                    void handleChoosePasskey();
                  }}
                  className="p-4 rounded-2xl flex-row items-center mb-3"
                  style={{
                    backgroundColor: t.accentColor + "1A",
                    borderWidth: 2,
                    borderColor: t.accentColor,
                  }}
                >
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={{ backgroundColor: t.accentColor }}
                  >
                    <Ionicons name="finger-print" size={28} color="white" />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text
                      className="font-bold text-base"
                      style={{ color: t.textColor }}
                    >
                      Passkey (Fingerprint)
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: t.mutedTextColor }}
                    >
                      Quick unlock with your fingerprint
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={handleChoosePassword}
                  className="p-4 rounded-2xl flex-row items-center mb-6"
                  style={{
                    backgroundColor: t.bgColor,
                    borderWidth: 2,
                    borderColor: t.cardBgColor,
                  }}
                >
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={{ backgroundColor: t.accentColor }}
                  >
                    <Ionicons name="keypad" size={28} color="white" />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text
                      className="font-bold text-base"
                      style={{ color: t.textColor }}
                    >
                      Password
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: t.mutedTextColor }}
                    >
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
                  <Text
                    className="font-semibold"
                    style={{ color: t.mutedTextColor }}
                  >
                    Cancel
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <View className="items-center mb-6">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center mb-4"
                    style={{ backgroundColor: t.accentColor + "33" }}
                  >
                    <Ionicons name="keypad" size={32} color={t.accentColor} />
                  </View>
                  <Text
                    className="text-xl font-bold text-center"
                    style={{ color: t.textColor }}
                  >
                    Set Password
                  </Text>
                  <Text
                    className="text-center mt-2"
                    style={{ color: t.mutedTextColor }}
                  >
                    Minimum 4 characters
                  </Text>
                </View>

                {lockSetupError ? (
                  <Text
                    className="text-center text-sm mb-4"
                    style={{ color: t.dangerColor }}
                  >
                    {lockSetupError}
                  </Text>
                ) : null}

                <Text
                  className="text-sm mb-1"
                  style={{ color: t.mutedTextColor }}
                >
                  Password
                </Text>
                <TextInput
                  value={newPassword}
                  onChangeText={(text) => {
                    setNewPassword(text);
                    setLockSetupError("");
                  }}
                  placeholder="Enter password"
                  placeholderTextColor={t.mutedTextColor}
                  secureTextEntry
                  autoFocus
                  className="p-3 rounded-lg mb-4"
                  style={{ backgroundColor: t.bgColor, color: t.textColor }}
                />

                <Text
                  className="text-sm mb-1"
                  style={{ color: t.mutedTextColor }}
                >
                  Confirm Password
                </Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setLockSetupError("");
                  }}
                  placeholder="Confirm password"
                  placeholderTextColor={t.mutedTextColor}
                  secureTextEntry
                  className="p-3 rounded-lg mb-6"
                  style={{ backgroundColor: t.bgColor, color: t.textColor }}
                />

                <View className="flex-row">
                  <Pressable
                    onPress={() => {
                      setLockSetupStep("choose");
                      setNewPassword("");
                      setConfirmPassword("");
                      setLockSetupError("");
                    }}
                    className="flex-1 p-3 rounded-xl mr-2"
                    style={{
                      borderWidth: 1,
                      borderColor: t.mutedTextColor + "40",
                    }}
                  >
                    <Text
                      className="text-center"
                      style={{ color: t.textColor }}
                    >
                      Back
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void handlePasswordSetup();
                    }}
                    className="flex-1 p-3 rounded-xl"
                    style={{ backgroundColor: t.accentColor }}
                  >
                    <Text
                      className="text-center font-bold"
                      style={{ color: t.bgColor }}
                    >
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
