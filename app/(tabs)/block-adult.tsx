import { InteractionGuard } from "@/components/InteractionGuard";
import { BlocklistService } from "@/services/BlocklistService";
import { ProtectionService } from "@/services/ProtectionService";
import { useBlockingStore } from "@/stores/useBlockingStore";
import type { ControlMode, SurveillanceConfig } from "@/types/blocking";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CONTROL_MODES: {
  id: ControlMode;
  title: string;
  description: string;
  icon: string;
  color: string;
}[] = [
  {
    id: "flexible",
    title: "Flexible",
    description: "No friction to toggle adult blocking off.",
    icon: "happy-outline",
    color: "#10B981",
  },
  {
    id: "locked",
    title: "Locked",
    description:
      "Requires a friction intervention (timer or clicks) to disable.",
    icon: "shield-outline",
    color: "#F59E0B",
  },
  {
    id: "hardcore",
    title: "Hardcore",
    description: "Maximum protection. Extremely difficult to disable.",
    icon: "flame-outline",
    color: "#EF4444",
  },
];

export default function BlockAdultScreen(): ReactNode {
  const {
    adultBlockingEnabled,
    setAdultBlockingEnabled,
    adultControlMode,
    setAdultControlMode,
    adultSurveillance,
    setAdultSurveillance,
    categoryDomainCounts,
  } = useBlockingStore();

  const formatHour = (h: number): string =>
    `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;

  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({
    current: 0,
    total: 0,
    name: "",
  });
  const [guardVisible, setGuardVisible] = useState(false);

  // Themed alert modal state
  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: "success" | "error";
  }>({ visible: false, title: "", message: "", type: "success" });

  // Local pending state for control mode changes
  const [pendingMode, setPendingMode] = useState<ControlMode>(adultControlMode);
  const [pendingSurveillance, setPendingSurveillance] =
    useState<SurveillanceConfig>(adultSurveillance);

  const showAlert = (
    title: string,
    message: string,
    type: "success" | "error",
  ): void => {
    setAlertModal({ visible: true, title, message, type });
  };

  const handleMasterToggle = (isEnabling: boolean): void => {
    if (adultControlMode === "flexible" || isEnabling) {
      void performToggle();
    } else {
      setGuardVisible(true);
    }
  };

  const performToggle = async (): Promise<void> => {
    setIsSyncing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newEnabled = !adultBlockingEnabled;
    setAdultBlockingEnabled(newEnabled);

    const state = useBlockingStore.getState();
    for (const cat of state.categories) {
      void BlocklistService.syncVpnCategoryToggle(
        cat.id,
        newEnabled && cat.enabled,
      );
    }

    await ProtectionService.syncAllConfigs({ skipResync: true });
    setIsSyncing(false);
    setGuardVisible(false);
  };

  const handleUpdatePress = async (): Promise<void> => {
    setIsUpdating(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const success = await BlocklistService.updateBlocklists(
      (current, total, name) => {
        setUpdateProgress({ current, total, name });
      },
    );
    setIsUpdating(false);

    if (success) {
      showAlert(
        "Blocklists Updated",
        "Adult blocklists have been successfully updated and synced.",
        "success",
      );
    } else {
      showAlert(
        "Update Failed",
        "Failed to update blocklists. Please check your internet connection.",
        "error",
      );
    }
  };

  const handleSelectMode = (mode: ControlMode): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingMode(mode);
    if (
      (mode === "locked" || mode === "hardcore") &&
      pendingSurveillance.type === "none"
    ) {
      setPendingSurveillance({ type: "timer", value: 30 });
    }
  };

  const [modeGuardVisible, setModeGuardVisible] = useState(false);

  const handleSaveMode = (): void => {
    if (adultControlMode === "flexible") {
      applyMode();
    } else {
      setModeGuardVisible(true);
    }
  };

  const applyMode = (): void => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdultControlMode(pendingMode);
    setAdultSurveillance(pendingSurveillance);
    setModeGuardVisible(false);
  };

  const isModeChanged =
    pendingMode !== adultControlMode ||
    pendingSurveillance.type !== adultSurveillance.type ||
    pendingSurveillance.value !== adultSurveillance.value;

  const totalDomains = Object.values(categoryDomainCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-freedom-primary"
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text className="text-2xl font-bold text-black dark:text-white mb-2">
          Block Adult Content
        </Text>
        <Text className="text-freedom-text-muted mb-6">
          Protect yourself from adult content across all sources
        </Text>

        {/* Master Toggle */}
        <Pressable
          onPress={() => {
            if (!isSyncing) handleMasterToggle(!adultBlockingEnabled);
          }}
          className={`rounded-2xl p-5 mb-4 border-2 ${
            adultBlockingEnabled
              ? "bg-freedom-highlight/10 border-freedom-highlight"
              : "bg-gray-100 dark:bg-freedom-surface border-transparent"
          }`}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View
                className={`w-14 h-14 rounded-2xl items-center justify-center ${
                  adultBlockingEnabled
                    ? "bg-freedom-highlight"
                    : "bg-gray-300 dark:bg-freedom-accent"
                }`}
              >
                {isSyncing ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Ionicons
                    name={
                      adultBlockingEnabled
                        ? "shield-checkmark"
                        : "shield-outline"
                    }
                    size={28}
                    color="white"
                  />
                )}
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-lg font-bold text-black dark:text-white">
                  {isSyncing
                    ? "Syncing..."
                    : adultBlockingEnabled
                      ? "Protection Active"
                      : "Protection Off"}
                </Text>
                <Text className="text-freedom-text-muted text-sm">
                  {adultBlockingEnabled
                    ? `Blocking ${totalDomains.toLocaleString()} domains`
                    : "Tap to enable adult content blocking"}
                </Text>
              </View>
            </View>
            <View
              className={`w-14 h-8 rounded-full px-1 justify-center ${
                adultBlockingEnabled ? "bg-freedom-highlight" : "bg-gray-400"
              }`}
            >
              <View
                className={`w-6 h-6 rounded-full bg-white ${
                  adultBlockingEnabled ? "self-end" : "self-start"
                }`}
              />
            </View>
          </View>
        </Pressable>

        {/* Update Blocklists */}
        <Pressable
          disabled={isUpdating}
          onPress={handleUpdatePress}
          className={`rounded-xl p-4 flex-row items-center justify-center mb-8 ${
            isUpdating
              ? "bg-gray-200 dark:bg-freedom-surface"
              : "bg-freedom-accent"
          }`}
        >
          {isUpdating ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Ionicons name="cloud-download-outline" size={20} color="white" />
          )}
          <Text className="text-white font-semibold ml-2">
            {isUpdating ? "Updating Blocklists..." : "Update Blocklists"}
          </Text>
        </Pressable>

        {/* Control Mode Section */}
        <Text className="text-sm font-semibold text-freedom-text-muted uppercase mb-3">
          Control Mode
        </Text>
        <Text className="text-freedom-text-muted text-xs mb-4">
          Choose how strictly this toggle is protected from being disabled.
        </Text>

        {CONTROL_MODES.map((mode) => (
          <Pressable
            key={mode.id}
            onPress={() => {
              handleSelectMode(mode.id);
            }}
            className={`p-4 rounded-2xl mb-3 border-2 ${
              pendingMode === mode.id
                ? "bg-freedom-highlight/5 border-freedom-highlight"
                : "bg-gray-100 dark:bg-freedom-surface border-transparent"
            }`}
          >
            <View className="flex-row items-start">
              <View
                className="w-10 h-10 rounded-xl items-center justify-center"
                style={{ backgroundColor: mode.color + "20" }}
              >
                <Ionicons
                  name={mode.icon as ComponentProps<typeof Ionicons>["name"]}
                  size={22}
                  color={mode.color}
                />
              </View>
              <View className="flex-1 ml-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-bold text-black dark:text-white">
                    {mode.title}
                  </Text>
                  {pendingMode === mode.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color="#2DD4BF"
                    />
                  )}
                </View>
                <Text className="text-freedom-text-muted text-sm mt-0.5">
                  {mode.description}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}

        {/* Surveillance Config */}
        {(pendingMode === "locked" || pendingMode === "hardcore") && (
          <View className="mt-2 mb-4">
            <View className="flex-row items-center mb-3 px-1">
              <Ionicons name="settings-outline" size={18} color="#2DD4BF" />
              <Text className="text-sm font-bold text-freedom-highlight uppercase ml-2">
                Friction Setup
              </Text>
            </View>
            <View className="bg-gray-100 dark:bg-freedom-surface rounded-2xl p-5">
              <Text className="text-black dark:text-white font-bold mb-4">
                How do you want to lock it?
              </Text>

              <View className="flex-row gap-3 mb-6">
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPendingSurveillance({
                      ...pendingSurveillance,
                      type: "timer",
                    });
                  }}
                  className={`flex-1 p-4 rounded-xl items-center border-2 ${
                    pendingSurveillance.type === "timer"
                      ? "bg-freedom-highlight/10 border-freedom-highlight"
                      : "bg-white dark:bg-freedom-primary border-transparent"
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${
                      pendingSurveillance.type === "timer"
                        ? "bg-freedom-highlight"
                        : "bg-gray-200 dark:bg-freedom-accent"
                    }`}
                  >
                    <Ionicons
                      name="hourglass-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className={`font-bold ${
                      pendingSurveillance.type === "timer"
                        ? "text-freedom-highlight"
                        : "text-freedom-text-muted"
                    }`}
                  >
                    Timer
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPendingSurveillance({
                      ...pendingSurveillance,
                      type: "click",
                    });
                  }}
                  className={`flex-1 p-4 rounded-xl items-center border-2 ${
                    pendingSurveillance.type === "click"
                      ? "bg-freedom-highlight/10 border-freedom-highlight"
                      : "bg-white dark:bg-freedom-primary border-transparent"
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${
                      pendingSurveillance.type === "click"
                        ? "bg-freedom-highlight"
                        : "bg-gray-200 dark:bg-freedom-accent"
                    }`}
                  >
                    <Ionicons
                      name="finger-print-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className={`font-bold ${
                      pendingSurveillance.type === "click"
                        ? "text-freedom-highlight"
                        : "text-freedom-text-muted"
                    }`}
                  >
                    Clicks
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPendingSurveillance({
                      ...pendingSurveillance,
                      type: "time",
                      startHour: pendingSurveillance.startHour ?? 9,
                      endHour: pendingSurveillance.endHour ?? 21,
                    });
                  }}
                  className={`flex-1 p-4 rounded-xl items-center border-2 ${
                    pendingSurveillance.type === "time"
                      ? "bg-freedom-highlight/10 border-freedom-highlight"
                      : "bg-white dark:bg-freedom-primary border-transparent"
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${
                      pendingSurveillance.type === "time"
                        ? "bg-freedom-highlight"
                        : "bg-gray-200 dark:bg-freedom-accent"
                    }`}
                  >
                    <Ionicons name="alarm-outline" size={24} color="white" />
                  </View>
                  <Text
                    className={`font-bold ${
                      pendingSurveillance.type === "time"
                        ? "text-freedom-highlight"
                        : "text-freedom-text-muted"
                    }`}
                  >
                    Time
                  </Text>
                </Pressable>
              </View>

              {/* Value Config */}
              {pendingSurveillance.type === "time" ? (
                <>
                  <Text className="text-black dark:text-white font-bold mb-4">
                    Restriction Times (Lockout Window)
                  </Text>
                  <View className="bg-white dark:bg-freedom-primary p-4 rounded-xl border border-gray-200 dark:border-freedom-secondary">
                    <View className="flex-row items-center justify-between mb-4">
                      <Text className="text-freedom-text-muted font-bold">
                        Start Time
                      </Text>
                      <View className="flex-row items-center gap-4">
                        <Pressable
                          onPress={() => {
                            const c = pendingSurveillance.startHour ?? 9;
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              startHour: (c - 1 + 24) % 24,
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                        >
                          <Ionicons name="remove" size={20} color="#EF4444" />
                        </Pressable>
                        <Text className="text-xl font-bold text-black dark:text-white w-20 text-center">
                          {formatHour(pendingSurveillance.startHour ?? 9)}
                        </Text>
                        <Pressable
                          onPress={() => {
                            const c = pendingSurveillance.startHour ?? 9;
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              startHour: (c + 1) % 24,
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                        >
                          <Ionicons name="add" size={20} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                    <View className="h-0.5 bg-gray-100 dark:bg-freedom-surface mb-4" />
                    <View className="flex-row items-center justify-between">
                      <Text className="text-freedom-text-muted font-bold">
                        End Time
                      </Text>
                      <View className="flex-row items-center gap-4">
                        <Pressable
                          onPress={() => {
                            const c = pendingSurveillance.endHour ?? 21;
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              endHour: (c - 1 + 24) % 24,
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                        >
                          <Ionicons name="remove" size={20} color="#EF4444" />
                        </Pressable>
                        <Text className="text-xl font-bold text-black dark:text-white w-20 text-center">
                          {formatHour(pendingSurveillance.endHour ?? 21)}
                        </Text>
                        <Pressable
                          onPress={() => {
                            const c = pendingSurveillance.endHour ?? 21;
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              endHour: (c + 1) % 24,
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                        >
                          <Ionicons name="add" size={20} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Text className="text-black dark:text-white font-bold mb-4">
                    {pendingSurveillance.type === "timer"
                      ? "Wait Duration (seconds)"
                      : "Required Tap Count"}
                  </Text>
                  <View className="flex-row items-center justify-between bg-white dark:bg-freedom-primary p-4 rounded-xl border border-gray-200 dark:border-freedom-secondary">
                    <Pressable
                      onPress={() => {
                        void Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        );
                        const min =
                          pendingSurveillance.type === "timer" ? 5 : 10;
                        const step =
                          pendingSurveillance.type === "timer" ? 5 : 10;
                        setPendingSurveillance({
                          ...pendingSurveillance,
                          value: Math.max(
                            min,
                            pendingSurveillance.value - step,
                          ),
                        });
                      }}
                      className="w-12 h-12 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                    >
                      <Ionicons name="remove" size={28} color="#2DD4BF" />
                    </Pressable>
                    <View className="items-center">
                      <Text className="text-3xl font-bold text-black dark:text-white">
                        {pendingSurveillance.value}
                      </Text>
                      <Text className="text-freedom-text-muted text-xs font-semibold uppercase">
                        {pendingSurveillance.type === "timer"
                          ? "Seconds"
                          : "Taps"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        void Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        );
                        const step =
                          pendingSurveillance.type === "timer" ? 5 : 10;
                        setPendingSurveillance({
                          ...pendingSurveillance,
                          value: Math.min(
                            999,
                            pendingSurveillance.value + step,
                          ),
                        });
                      }}
                      className="w-12 h-12 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center"
                    >
                      <Ionicons name="add" size={28} color="#2DD4BF" />
                    </Pressable>
                  </View>
                </>
              )}

              <View className="flex-row items-center mt-4 bg-freedom-highlight/5 p-3 rounded-lg">
                <Ionicons name="flash-outline" size={16} color="#2DD4BF" />
                <Text className="text-freedom-text-muted text-[11px] ml-2 flex-1 font-medium italic">
                  {pendingSurveillance.type === "timer"
                    ? `You'll need to wait ${pendingSurveillance.value} seconds before you can disable adult blocking.`
                    : pendingSurveillance.type === "click"
                      ? `You'll need to tap the screen ${pendingSurveillance.value} times to disable adult blocking.`
                      : pendingSurveillance.startHour ===
                          pendingSurveillance.endHour
                        ? "Adult blocking settings are PERMANENTLY locked at all times."
                        : `Adult blocking settings are locked between ${formatHour(pendingSurveillance.startHour ?? 9)} and ${formatHour(pendingSurveillance.endHour ?? 21)}.`}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Save Mode Button */}
        {isModeChanged && (
          <Pressable
            onPress={handleSaveMode}
            className="bg-freedom-highlight p-5 rounded-2xl items-center mt-2 mb-6 border-b-4 border-freedom-accent"
          >
            <View className="flex-row items-center">
              <Ionicons
                name={
                  pendingMode === "flexible"
                    ? "lock-open-outline"
                    : "lock-closed-outline"
                }
                size={22}
                color="white"
              />
              <Text className="text-white font-bold text-lg ml-3">
                {pendingMode === adultControlMode
                  ? "Update Friction Settings"
                  : `Activate ${pendingMode.charAt(0).toUpperCase() + pendingMode.slice(1)} Mode`}
              </Text>
            </View>
          </Pressable>
        )}

        <View className="h-20" />
      </ScrollView>

      {/* Themed Alert Modal */}
      <Modal visible={alertModal.visible} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white dark:bg-freedom-surface w-full rounded-3xl p-6 items-center border border-freedom-highlight/20">
            <View
              className={`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                alertModal.type === "success"
                  ? "bg-freedom-success/20"
                  : "bg-freedom-danger/20"
              }`}
            >
              <Ionicons
                name={
                  alertModal.type === "success"
                    ? "checkmark-circle"
                    : "alert-circle"
                }
                size={36}
                color={alertModal.type === "success" ? "#10B981" : "#EF4444"}
              />
            </View>
            <Text className="text-xl font-bold text-black dark:text-white text-center mb-2">
              {alertModal.title}
            </Text>
            <Text className="text-freedom-text-muted text-center mb-6">
              {alertModal.message}
            </Text>
            <Pressable
              onPress={() => {
                setAlertModal((prev) => ({ ...prev, visible: false }));
              }}
              className={`w-full py-4 rounded-xl items-center ${
                alertModal.type === "success"
                  ? "bg-freedom-highlight"
                  : "bg-freedom-danger"
              }`}
            >
              <Text className="text-white font-bold text-lg">OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Progress Modal */}
      {isUpdating && (
        <View className="absolute inset-0 bg-black/30 justify-center items-center pointer-events-none">
          <View className="bg-white dark:bg-freedom-surface p-6 rounded-2xl w-2/3 items-center shadow-xl">
            <ActivityIndicator color="#2DD4BF" size="large" />
            <Text className="text-black dark:text-white font-bold mt-4 text-center">
              Fetching Sources
            </Text>
            <Text className="text-freedom-text-muted text-xs mt-1 text-center">
              {updateProgress.name}
            </Text>
            <View className="w-full bg-gray-200 dark:bg-freedom-secondary h-2 rounded-full mt-4 overflow-hidden">
              <View
                className="bg-freedom-accent h-full"
                style={{
                  width: `${(updateProgress.current / (updateProgress.total || 1)) * 100}%`,
                }}
              />
            </View>
            <Text className="text-freedom-text-muted text-[10px] mt-2">
              {updateProgress.current} / {updateProgress.total}
            </Text>
          </View>
        </View>
      )}

      {/* Guard for disabling adult blocking */}
      <InteractionGuard
        visible={guardVisible}
        actionName="Disable Adult Content Blocking"
        surveillanceOverride={adultSurveillance}
        onSuccess={() => {
          void performToggle();
        }}
        onCancel={() => {
          setGuardVisible(false);
        }}
      />

      {/* Guard for changing control mode */}
      <InteractionGuard
        visible={modeGuardVisible}
        actionName="Change Adult Blocking Control Mode"
        surveillanceOverride={adultSurveillance}
        onSuccess={() => {
          applyMode();
        }}
        onCancel={() => {
          setModeGuardVisible(false);
        }}
      />
    </SafeAreaView>
  );
}
