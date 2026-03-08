import { InteractionGuard } from "@/components/InteractionGuard";
import { useAppStore } from "@/stores/useAppStore";
import type { ControlMode } from "@/types/blocking";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ControlModesScreen(): ReactNode {
  const router = useRouter();
  const { controlMode, setControlMode, surveillance, setSurveillance } =
    useAppStore();
  const [pendingMode, setPendingMode] = useState<ControlMode>(controlMode);
  const [pendingSurveillance, setPendingSurveillance] = useState(surveillance);

  const modes: {
    id: ControlMode;
    title: string;
    description: string;
    icon: string;
    color: string;
  }[] = [
    {
      id: "flexible",
      title: "Flexible",
      description: "No restrictions on changing settings. Good for beginners.",
      icon: "happy-outline",
      color: "#10B981",
    },
    {
      id: "locked",
      title: "Locked",
      description:
        "Requires a 'Friction' intervention (timer or clicks) to change any blocking settings.",
      icon: "shield-outline",
      color: "#F59E0B",
    },
    {
      id: "hardcore",
      title: "Hardcore (Lockdown)",
      description:
        "Maximum protection. Prevents app uninstallation and deactivating admin access. Use with caution.",
      icon: "flame-outline",
      color: "#EF4444",
    },
  ];

  const handleSelectMode = (mode: ControlMode): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingMode(mode);

    // Default local surveillance if not set
    if (
      (mode === "locked" || mode === "hardcore") &&
      pendingSurveillance.type === "none"
    ) {
      setPendingSurveillance({ type: "timer", value: 30 });
    }
  };

  const [isGuardVisible, setIsGuardVisible] = useState(false);

  const onConfirmPress = (): void => {
    if (controlMode === "flexible") {
      applyMode();
    } else {
      setIsGuardVisible(true);
    }
  };

  const applyMode = (): void => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSurveillance(pendingSurveillance);
    setControlMode(pendingMode);
    router.back();
  };

  const isDirty =
    pendingMode !== controlMode ||
    pendingSurveillance.type !== surveillance.type ||
    pendingSurveillance.value !== surveillance.value;

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
          Control Modes
        </Text>
      </View>

      <ScrollView className="flex-1 px-4 pt-4">
        <Text className="text-freedom-text-muted mb-6">
          Choose how strictly you want the app to enforce your blocking rules.
          High levels of control help prevent impulsive overrides.
        </Text>

        {modes.map((mode) => (
          <Pressable
            key={mode.id}
            onPress={() => {
              handleSelectMode(mode.id);
            }}
            className={`p-4 rounded-2xl mb-4 border-2 transition-all ${
              pendingMode === mode.id
                ? "bg-freedom-surface border-freedom-highlight"
                : "bg-gray-100 dark:bg-freedom-surface border-transparent"
            }`}
          >
            <View className="flex-row items-start">
              <View
                className="w-12 h-12 rounded-xl items-center justify-center"
                style={{ backgroundColor: mode.color + "20" }}
              >
                <Ionicons
                  name={mode.icon as ComponentProps<typeof Ionicons>["name"]}
                  size={28}
                  color={mode.color}
                />
              </View>
              <View className="flex-1 ml-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-bold text-black dark:text-white">
                    {mode.title}
                  </Text>
                  {pendingMode === mode.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={24}
                      color="#2DD4BF"
                    />
                  )}
                </View>
                <Text className="text-freedom-text-muted mt-1 leading-5">
                  {mode.description}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}

        {(pendingMode === "locked" || pendingMode === "hardcore") && (
          <View className="mt-2 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <View className="flex-row items-center mb-3 px-1">
              <Ionicons name="settings-outline" size={18} color="#2DD4BF" />
              <Text className="text-sm font-bold text-freedom-highlight uppercase ml-2">
                Lockdown Setup
              </Text>
            </View>
            <View className="bg-gray-100 dark:bg-freedom-surface rounded-2xl p-5 shadow-sm">
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
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${pendingSurveillance.type === "timer" ? "bg-freedom-highlight" : "bg-gray-200 dark:bg-freedom-accent"}`}
                  >
                    <Ionicons
                      name="hourglass-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className={`font-bold ${pendingSurveillance.type === "timer" ? "text-freedom-highlight" : "text-freedom-text-muted"}`}
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
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${pendingSurveillance.type === "click" ? "bg-freedom-highlight" : "bg-gray-200 dark:bg-freedom-accent"}`}
                  >
                    <Ionicons
                      name="finger-print-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className={`font-bold ${pendingSurveillance.type === "click" ? "text-freedom-highlight" : "text-freedom-text-muted"}`}
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
                      startHour: 9,
                      endHour: 21,
                    }); // Default: 9 AM to 9 PM
                  }}
                  className={`flex-1 p-4 rounded-xl items-center border-2 ${
                    pendingSurveillance.type === "time"
                      ? "bg-freedom-highlight/10 border-freedom-highlight"
                      : "bg-white dark:bg-freedom-primary border-transparent"
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mb-2 ${pendingSurveillance.type === "time" ? "bg-freedom-highlight" : "bg-gray-200 dark:bg-freedom-accent"}`}
                  >
                    <Ionicons name="alarm-outline" size={24} color="white" />
                  </View>
                  <Text
                    className={`font-bold ${pendingSurveillance.type === "time" ? "text-freedom-highlight" : "text-freedom-text-muted"}`}
                  >
                    Time
                  </Text>
                </Pressable>
              </View>

              <Text className="text-black dark:text-white font-bold mb-4">
                {pendingSurveillance.type === "timer"
                  ? "Wait Duration (seconds)"
                  : pendingSurveillance.type === "click"
                    ? "Required Tap Count"
                    : "Restriction Times (Lockout Window)"}
              </Text>

              {pendingSurveillance.type === "time" ? (
                <View className="bg-white dark:bg-freedom-primary p-4 rounded-xl border border-gray-200 dark:border-freedom-secondary">
                  {/* Start Hour */}
                  <View className="flex-row items-center justify-between mb-4">
                    <Text className="text-freedom-text-muted font-bold">
                      Start Time
                    </Text>
                    <View className="flex-row items-center gap-4">
                      <Pressable
                        onPress={() => {
                          const current = pendingSurveillance.startHour ?? 9;
                          setPendingSurveillance({
                            ...pendingSurveillance,
                            startHour: (current - 1 + 24) % 24,
                          });
                        }}
                        className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
                      >
                        <Ionicons name="remove" size={20} color="#EF4444" />
                      </Pressable>
                      <Text className="text-xl font-bold text-black dark:text-white w-20 text-center">
                        {(pendingSurveillance.startHour ?? 9) % 12 || 12}:00{" "}
                        {(pendingSurveillance.startHour ?? 9) >= 12
                          ? "PM"
                          : "AM"}
                      </Text>
                      <Pressable
                        onPress={() => {
                          const current = pendingSurveillance.startHour ?? 9;
                          setPendingSurveillance({
                            ...pendingSurveillance,
                            startHour: (current + 1) % 24,
                          });
                        }}
                        className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
                      >
                        <Ionicons name="add" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>

                  {/* Divider */}
                  <View className="h-0.5 bg-gray-100 dark:bg-freedom-surface mb-4" />

                  {/* End Hour */}
                  <View className="flex-row items-center justify-between">
                    <Text className="text-freedom-text-muted font-bold">
                      End Time
                    </Text>
                    <View className="flex-row items-center gap-4">
                      <Pressable
                        onPress={() => {
                          const current = pendingSurveillance.endHour ?? 21;
                          setPendingSurveillance({
                            ...pendingSurveillance,
                            endHour: (current - 1 + 24) % 24,
                          });
                        }}
                        className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
                      >
                        <Ionicons name="remove" size={20} color="#EF4444" />
                      </Pressable>
                      <Text className="text-xl font-bold text-black dark:text-white w-20 text-center">
                        {(pendingSurveillance.endHour ?? 21) % 12 || 12}:00{" "}
                        {(pendingSurveillance.endHour ?? 21) >= 12
                          ? "PM"
                          : "AM"}
                      </Text>
                      <Pressable
                        onPress={() => {
                          const current = pendingSurveillance.endHour ?? 21;
                          setPendingSurveillance({
                            ...pendingSurveillance,
                            endHour: (current + 1) % 24,
                          });
                        }}
                        className="w-10 h-10 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
                      >
                        <Ionicons name="add" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : (
                <View className="flex-row items-center justify-between bg-white dark:bg-freedom-primary p-4 rounded-xl border border-gray-200 dark:border-freedom-secondary">
                  <Pressable
                    onPress={() => {
                      void Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Light,
                      );
                      const min = pendingSurveillance.type === "timer" ? 5 : 10;
                      const stepVal =
                        pendingSurveillance.type === "timer" ? 5 : 10;
                      const newVal = Math.max(
                        min,
                        pendingSurveillance.value - stepVal,
                      );
                      setPendingSurveillance({
                        ...pendingSurveillance,
                        value: newVal,
                      });
                    }}
                    className="w-12 h-12 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
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
                      const stepVal =
                        pendingSurveillance.type === "timer" ? 5 : 10;
                      const max = 999;
                      const newVal = Math.min(
                        max,
                        pendingSurveillance.value + stepVal,
                      );
                      setPendingSurveillance({
                        ...pendingSurveillance,
                        value: newVal,
                      });
                    }}
                    className="w-12 h-12 rounded-full bg-gray-100 dark:bg-freedom-surface items-center justify-center active:bg-gray-200"
                  >
                    <Ionicons name="add" size={28} color="#2DD4BF" />
                  </Pressable>
                </View>
              )}

              <View className="flex-row items-center mt-4 bg-freedom-highlight/5 p-3 rounded-lg">
                <Ionicons name="flash-outline" size={16} color="#2DD4BF" />
                <Text className="text-freedom-text-muted text-[11px] ml-2 flex-1 font-medium italic">
                  {pendingSurveillance.type === "timer"
                    ? `Every time you try to disable a setting, you'll need to wait ${pendingSurveillance.value} seconds.`
                    : pendingSurveillance.type === "click"
                      ? `Every time you try to disable a setting, you'll need to tap the screen ${pendingSurveillance.value} times.`
                      : pendingSurveillance.startHour ===
                          pendingSurveillance.endHour
                        ? "Settings are PERMANENTLY locked at all times (24 hours a day)."
                        : `Settings are strictly locked between ${(pendingSurveillance.startHour ?? 9) % 12 || 12}:00 ${(pendingSurveillance.startHour ?? 9) >= 12 ? "PM" : "AM"} and ${(pendingSurveillance.endHour ?? 21) % 12 || 12}:00 ${(pendingSurveillance.endHour ?? 21) >= 12 ? "PM" : "AM"}.`}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View className="bg-blue-50 dark:bg-freedom-accent/20 p-4 rounded-xl mt-4">
          <View className="flex-row items-center mb-2">
            <Ionicons name="information-circle" size={20} color="#2DD4BF" />
            <Text className="ml-2 font-bold text-blue-900 dark:text-blue-200">
              What is Lockdown?
            </Text>
          </View>
          <Text className="text-blue-800 dark:text-blue-300 text-sm leading-5">
            Hardcore mode uses the Accessibility Service to monitor specific
            System Settings. If you try to uninstall Freedom or deactivate its
            Admin access, the app will automatically bounce you back to protect
            your focus.
          </Text>
        </View>

        {isDirty && (
          <Pressable
            onPress={onConfirmPress}
            className="bg-freedom-highlight p-5 rounded-2xl items-center mt-6 mb-10 shadow-xl active:scale-[0.98] transition-all border-b-4 border-freedom-accent"
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
                {pendingMode === controlMode
                  ? "Update Lockdown Settings"
                  : `${pendingMode === "flexible" ? "Deactivate" : "Activate"} ${pendingMode.charAt(0).toUpperCase() + pendingMode.slice(1)} Mode`}
              </Text>
            </View>
          </Pressable>
        )}

        <View className="h-20" />
      </ScrollView>

      <InteractionGuard
        visible={isGuardVisible}
        actionName={`Switch to ${pendingMode} Mode`}
        onSuccess={() => {
          setIsGuardVisible(false);
          applyMode();
        }}
        onCancel={() => {
          setIsGuardVisible(false);
        }}
      />
    </SafeAreaView>
  );
}
