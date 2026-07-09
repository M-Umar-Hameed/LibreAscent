import { InteractionGuard } from "@/components/InteractionGuard";
import {
  BlocklistService,
  VPN_ONLY_CATEGORIES,
} from "@/services/BlocklistService";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import type { ControlMode, SurveillanceConfig } from "@/types/blocking";
import { getEffectiveMode, getEffectiveSurveillance } from "@/types/blocking";
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
    description: "Requires friction to disable adult blocking.",
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
  const t = useAppTheme();
  const {
    adultBlockingEnabled,
    setAdultBlockingEnabled,
    adultControlMode,
    setAdultControlMode,
    adultSurveillance,
    setAdultSurveillance,
    categoryDomainCounts,
  } = useBlockingStore();
  const { controlMode, surveillance } = useAppStore();

  const effectiveMode = getEffectiveMode(controlMode, adultControlMode);
  const effectiveSurveillance = getEffectiveSurveillance(
    controlMode,
    surveillance,
    adultControlMode,
    adultSurveillance,
  );

  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({
    current: 0,
    total: 0,
    name: "",
  });
  const [guardVisible, setGuardVisible] = useState(false);
  const [showModeModal, setShowModeModal] = useState(false);

  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: "success" | "error";
  }>({ visible: false, title: "", message: "", type: "success" });

  const [pendingMode, setPendingMode] = useState<ControlMode>(adultControlMode);
  const [pendingSurveillance, setPendingSurveillance] =
    useState<SurveillanceConfig>(adultSurveillance);
  const [modeGuardVisible, setModeGuardVisible] = useState(false);

  const showAlert = (
    title: string,
    message: string,
    type: "success" | "error",
  ): void => {
    setAlertModal({ visible: true, title, message, type });
  };

  const handleMasterToggle = (isEnabling: boolean): void => {
    if (effectiveMode === "flexible" || isEnabling) {
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
      // The adult master must not touch VPN-only categories (e.g. ads),
      // which are governed by their own independent toggle.
      if (VPN_ONLY_CATEGORIES.has(cat.id)) continue;
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

  const handleSaveMode = (): void => {
    if (effectiveMode === "flexible") {
      applyMode();
    } else {
      setShowModeModal(false);
      setModeGuardVisible(true);
    }
  };

  const applyMode = (): void => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdultControlMode(pendingMode);
    setAdultSurveillance(pendingSurveillance);
    setModeGuardVisible(false);
    setShowModeModal(false);
  };

  const isModeChanged =
    pendingMode !== adultControlMode ||
    pendingSurveillance.type !== adultSurveillance.type ||
    pendingSurveillance.value !== adultSurveillance.value;

  const modeLabel = CONTROL_MODES.find((m) => m.id === adultControlMode);

  const totalDomains = Object.values(categoryDomainCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  const formatHour = (h: number): string =>
    `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;

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
        {/* Header */}
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-2xl font-bold" style={{ color: t.textColor }}>
            Block Adult Content
          </Text>
          <Pressable
            onPress={() => {
              setPendingMode(adultControlMode);
              setPendingSurveillance(adultSurveillance);
              setShowModeModal(true);
            }}
            className="flex-row items-center px-3 py-2 rounded-xl"
            style={{ backgroundColor: t.cardBgColor }}
          >
            <Ionicons
              name={
                (modeLabel?.icon ?? "happy-outline") as ComponentProps<
                  typeof Ionicons
                >["name"]
              }
              size={16}
              color={modeLabel?.color ?? "#10B981"}
            />
            <Text
              className="text-xs font-bold ml-1.5"
              style={{ color: modeLabel?.color ?? "#10B981" }}
            >
              {modeLabel?.title ?? "Flexible"}
            </Text>
          </Pressable>
        </View>
        <Text className="mb-6" style={{ color: t.mutedTextColor }}>
          Protect yourself from adult content across all sources
        </Text>

        {/* Master Toggle */}
        <Pressable
          onPress={() => {
            if (!isSyncing) handleMasterToggle(!adultBlockingEnabled);
          }}
          className="rounded-2xl p-5 mb-4"
          style={{
            borderWidth: 2,
            backgroundColor: adultBlockingEnabled
              ? t.accentColor + "1A"
              : t.cardBgColor,
            borderColor: adultBlockingEnabled ? t.accentColor : "transparent",
          }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View
                className="w-14 h-14 rounded-2xl items-center justify-center"
                style={{
                  backgroundColor: adultBlockingEnabled
                    ? t.accentColor
                    : t.cardBgColor,
                }}
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
                <Text
                  className="text-lg font-bold"
                  style={{ color: t.textColor }}
                >
                  {isSyncing
                    ? "Syncing..."
                    : adultBlockingEnabled
                      ? "Adult Blocking On"
                      : "Protection Off"}
                </Text>
                <Text className="text-sm" style={{ color: t.mutedTextColor }}>
                  {adultBlockingEnabled
                    ? `Blocking ${totalDomains.toLocaleString()} domains`
                    : "Tap to enable adult content blocking"}
                </Text>
              </View>
            </View>
            <View
              className="w-14 h-8 rounded-full px-1 justify-center"
              style={{
                backgroundColor: adultBlockingEnabled
                  ? t.accentColor
                  : "#9CA3AF",
              }}
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
          className="rounded-xl p-4 flex-row items-center justify-center mb-8"
          style={{
            backgroundColor: isUpdating ? t.cardBgColor : t.accentColor,
          }}
        >
          {isUpdating ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Ionicons name="cloud-download-outline" size={20} color="white" />
          )}
          <Text className="font-semibold ml-2" style={{ color: t.textColor }}>
            {isUpdating ? "Updating Blocklists..." : "Update Blocklists"}
          </Text>
        </Pressable>

        <View className="h-20" />
      </ScrollView>

      {/* Control Mode Modal */}
      <Modal visible={showModeModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 pt-20">
          <View
            className="flex-1 rounded-t-[40px] p-6"
            style={{ backgroundColor: t.bgColor }}
          >
            <View className="flex-row items-center justify-between mb-2">
              <Text
                className="text-xl font-bold"
                style={{ color: t.textColor }}
              >
                Adult Blocking Control
              </Text>
              <Pressable
                onPress={() => {
                  setShowModeModal(false);
                }}
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: t.cardBgColor }}
              >
                <Ionicons name="close" size={24} color={t.mutedTextColor} />
              </Pressable>
            </View>
            <Text className="text-sm mb-6" style={{ color: t.mutedTextColor }}>
              Controls friction for disabling adult content blocking. Works
              under the main control mode.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {CONTROL_MODES.map((mode) => (
                <Pressable
                  key={mode.id}
                  onPress={() => {
                    handleSelectMode(mode.id);
                  }}
                  className="p-4 rounded-2xl mb-3"
                  style={{
                    borderWidth: 2,
                    backgroundColor:
                      pendingMode === mode.id
                        ? t.accentColor + "0D"
                        : t.cardBgColor,
                    borderColor:
                      pendingMode === mode.id ? t.accentColor : "transparent",
                  }}
                >
                  <View className="flex-row items-start">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center"
                      style={{ backgroundColor: mode.color + "20" }}
                    >
                      <Ionicons
                        name={
                          mode.icon as ComponentProps<typeof Ionicons>["name"]
                        }
                        size={22}
                        color={mode.color}
                      />
                    </View>
                    <View className="flex-1 ml-3">
                      <View className="flex-row items-center justify-between">
                        <Text
                          className="text-base font-bold"
                          style={{ color: t.textColor }}
                        >
                          {mode.title}
                        </Text>
                        {pendingMode === mode.id && (
                          <Ionicons
                            name="checkmark-circle"
                            size={22}
                            color={t.accentColor}
                          />
                        )}
                      </View>
                      <Text
                        className="text-sm mt-0.5"
                        style={{ color: t.mutedTextColor }}
                      >
                        {mode.description}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}

              {/* Friction Setup */}
              {(pendingMode === "locked" || pendingMode === "hardcore") && (
                <View className="mt-2 mb-4">
                  <View
                    className="rounded-2xl p-5"
                    style={{ backgroundColor: t.cardBgColor }}
                  >
                    <View className="flex-row gap-3 mb-6">
                      {(["timer", "click", "time"] as const).map((type) => (
                        <Pressable
                          key={type}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              type,
                              ...(type === "time"
                                ? {
                                    startHour:
                                      pendingSurveillance.startHour ?? 9,
                                    endHour: pendingSurveillance.endHour ?? 21,
                                  }
                                : {}),
                            });
                          }}
                          className="flex-1 p-4 rounded-xl items-center"
                          style={{
                            borderWidth: 2,
                            backgroundColor:
                              pendingSurveillance.type === type
                                ? t.accentColor + "1A"
                                : t.bgColor,
                            borderColor:
                              pendingSurveillance.type === type
                                ? t.accentColor
                                : "transparent",
                          }}
                        >
                          <Ionicons
                            name={
                              (type === "timer"
                                ? "hourglass-outline"
                                : type === "click"
                                  ? "finger-print-outline"
                                  : "alarm-outline") as ComponentProps<
                                typeof Ionicons
                              >["name"]
                            }
                            size={24}
                            color={
                              pendingSurveillance.type === type
                                ? t.accentColor
                                : t.mutedTextColor
                            }
                          />
                          <Text
                            className="font-bold mt-1"
                            style={{
                              color:
                                pendingSurveillance.type === type
                                  ? t.accentColor
                                  : t.mutedTextColor,
                            }}
                          >
                            {type === "timer"
                              ? "Timer"
                              : type === "click"
                                ? "Clicks"
                                : "Time"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {pendingSurveillance.type === "time" ? (
                      <View
                        className="p-4 rounded-xl"
                        style={{
                          backgroundColor: t.bgColor,
                          borderWidth: 1,
                          borderColor: t.mutedTextColor + "33",
                        }}
                      >
                        {[
                          {
                            label: "Start",
                            key: "startHour" as const,
                            def: 9,
                          },
                          { label: "End", key: "endHour" as const, def: 21 },
                        ].map(({ label, key, def }) => (
                          <View
                            key={key}
                            className="flex-row items-center justify-between mb-2"
                          >
                            <Text
                              className="font-bold"
                              style={{ color: t.mutedTextColor }}
                            >
                              {label}
                            </Text>
                            <View className="flex-row items-center gap-4">
                              <Pressable
                                onPress={() => {
                                  setPendingSurveillance({
                                    ...pendingSurveillance,
                                    [key]:
                                      ((pendingSurveillance[key] ?? def) -
                                        1 +
                                        24) %
                                      24,
                                  });
                                }}
                                className="w-10 h-10 rounded-full items-center justify-center"
                                style={{ backgroundColor: t.cardBgColor }}
                              >
                                <Ionicons
                                  name="remove"
                                  size={20}
                                  color="#EF4444"
                                />
                              </Pressable>
                              <Text
                                className="text-xl font-bold w-20 text-center"
                                style={{ color: t.textColor }}
                              >
                                {formatHour(pendingSurveillance[key] ?? def)}
                              </Text>
                              <Pressable
                                onPress={() => {
                                  setPendingSurveillance({
                                    ...pendingSurveillance,
                                    [key]:
                                      ((pendingSurveillance[key] ?? def) + 1) %
                                      24,
                                  });
                                }}
                                className="w-10 h-10 rounded-full items-center justify-center"
                                style={{ backgroundColor: t.cardBgColor }}
                              >
                                <Ionicons
                                  name="add"
                                  size={20}
                                  color="#EF4444"
                                />
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View
                        className="flex-row items-center justify-between p-4 rounded-xl"
                        style={{
                          backgroundColor: t.bgColor,
                          borderWidth: 1,
                          borderColor: t.mutedTextColor + "33",
                        }}
                      >
                        <Pressable
                          onPress={() => {
                            const step =
                              pendingSurveillance.type === "timer" ? 5 : 10;
                            const min =
                              pendingSurveillance.type === "timer" ? 5 : 10;
                            setPendingSurveillance({
                              ...pendingSurveillance,
                              value: Math.max(
                                min,
                                pendingSurveillance.value - step,
                              ),
                            });
                          }}
                          className="w-12 h-12 rounded-full items-center justify-center"
                          style={{ backgroundColor: t.cardBgColor }}
                        >
                          <Ionicons
                            name="remove"
                            size={28}
                            color={t.accentColor}
                          />
                        </Pressable>
                        <View className="items-center">
                          <Text
                            className="text-3xl font-bold"
                            style={{ color: t.textColor }}
                          >
                            {pendingSurveillance.value}
                          </Text>
                          <Text
                            className="text-xs font-semibold uppercase"
                            style={{ color: t.mutedTextColor }}
                          >
                            {pendingSurveillance.type === "timer"
                              ? "Seconds"
                              : "Taps"}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
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
                          className="w-12 h-12 rounded-full items-center justify-center"
                          style={{ backgroundColor: t.cardBgColor }}
                        >
                          <Ionicons
                            name="add"
                            size={28}
                            color={t.accentColor}
                          />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {isModeChanged && (
                <Pressable
                  onPress={handleSaveMode}
                  className="p-5 rounded-2xl items-center mt-2 mb-6"
                  style={{
                    backgroundColor: t.accentColor,
                    borderBottomWidth: 4,
                    borderBottomColor: t.accentColor,
                  }}
                >
                  <Text
                    className="font-bold text-lg"
                    style={{ color: t.textColor }}
                  >
                    {pendingMode === adultControlMode
                      ? "Update Friction Settings"
                      : `Activate ${pendingMode.charAt(0).toUpperCase() + pendingMode.slice(1)} Mode`}
                  </Text>
                </Pressable>
              )}

              <View className="h-10" />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Alert Modal */}
      <Modal visible={alertModal.visible} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View
            className="w-full rounded-3xl p-6 items-center"
            style={{
              backgroundColor: t.cardBgColor,
              borderWidth: 1,
              borderColor: t.accentColor + "33",
            }}
          >
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{
                backgroundColor:
                  alertModal.type === "success"
                    ? t.successColor + "33"
                    : t.dangerColor + "33",
              }}
            >
              <Ionicons
                name={
                  alertModal.type === "success"
                    ? "checkmark-circle"
                    : "alert-circle"
                }
                size={36}
                color={
                  alertModal.type === "success" ? t.successColor : t.dangerColor
                }
              />
            </View>
            <Text
              className="text-xl font-bold text-center mb-2"
              style={{ color: t.textColor }}
            >
              {alertModal.title}
            </Text>
            <Text
              className="text-center mb-6"
              style={{ color: t.mutedTextColor }}
            >
              {alertModal.message}
            </Text>
            <Pressable
              onPress={() => {
                setAlertModal((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full py-4 rounded-xl items-center"
              style={{
                backgroundColor:
                  alertModal.type === "success" ? t.accentColor : t.dangerColor,
              }}
            >
              <Text
                className="font-bold text-lg"
                style={{ color: t.textColor }}
              >
                OK
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Progress Modal */}
      {isUpdating && (
        <View className="absolute inset-0 bg-black/30 justify-center items-center pointer-events-none">
          <View
            className="p-6 rounded-2xl w-2/3 items-center shadow-xl"
            style={{ backgroundColor: t.cardBgColor }}
          >
            <ActivityIndicator color={t.accentColor} size="large" />
            <Text
              className="font-bold mt-4 text-center"
              style={{ color: t.textColor }}
            >
              Updating Sources
            </Text>
            <Text
              className="text-xs mt-1 text-center"
              style={{ color: t.mutedTextColor }}
            >
              {updateProgress.name}
            </Text>
            <View
              className="w-full h-2 rounded-full mt-4 overflow-hidden"
              style={{ backgroundColor: t.mutedTextColor + "33" }}
            >
              <View
                style={{
                  backgroundColor: t.accentColor,
                  height: "100%",
                  width: `${(updateProgress.current / (updateProgress.total || 1)) * 100}%`,
                }}
              />
            </View>
            <Text
              className="text-[10px] mt-2"
              style={{ color: t.mutedTextColor }}
            >
              {updateProgress.current} / {updateProgress.total}
            </Text>
          </View>
        </View>
      )}

      {/* Guard for disabling adult blocking */}
      <InteractionGuard
        visible={guardVisible}
        actionName="Disable Adult Content Blocking"
        surveillanceOverride={effectiveSurveillance}
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
        surveillanceOverride={effectiveSurveillance}
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
