import { InteractionGuard } from "@/components/InteractionGuard";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomDeviceAdmin from "@/modules/freedom-device-admin/src";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useAppStore } from "@/stores/useAppStore";
import type { ControlMode } from "@/types/blocking";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ControlModesScreen(): ReactNode {
  const router = useRouter();
  const t = useAppTheme();
  const { controlMode, setControlMode, surveillance, setSurveillance } =
    useAppStore();
  const [pendingMode, setPendingMode] = useState<ControlMode>(controlMode);
  const [pendingSurveillance, setPendingSurveillance] = useState(surveillance);
  const [isDeviceOwner, setIsDeviceOwner] = useState(false);

  useEffect(() => {
    void FreedomDeviceAdmin.isDeviceOwner().then(setIsDeviceOwner);
  }, []);

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
    void FreedomAccessibility.updateHardcoreMode(pendingMode === "hardcore");
    void FreedomDeviceAdmin.setSelfUninstallBlocked(pendingMode === "hardcore");
    router.back();
  };

  const isDirty =
    pendingMode !== controlMode ||
    pendingSurveillance.type !== surveillance.type ||
    pendingSurveillance.value !== surveillance.value;

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
        <Text className="text-xl font-bold ml-2" style={{ color: t.textColor }}>
          Control Modes
        </Text>
      </View>

      <ScrollView className="flex-1 px-4 pt-4">
        <Text className="mb-6" style={{ color: t.mutedTextColor }}>
          Choose how strictly you want the app to enforce your blocking rules.
          High levels of control help prevent impulsive overrides.
        </Text>

        {modes.map((mode) => (
          <Pressable
            key={mode.id}
            onPress={() => {
              handleSelectMode(mode.id);
            }}
            className="p-4 rounded-2xl mb-4 border-2"
            style={{
              backgroundColor: t.cardBgColor,
              borderColor:
                pendingMode === mode.id ? t.accentColor : "transparent",
            }}
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
                  <Text
                    className="text-lg font-bold"
                    style={{ color: t.textColor }}
                  >
                    {mode.title}
                  </Text>
                  {pendingMode === mode.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={24}
                      color={t.accentColor}
                    />
                  )}
                </View>
                <Text
                  className="mt-1 leading-5"
                  style={{ color: t.mutedTextColor }}
                >
                  {mode.description}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}

        {(pendingMode === "locked" || pendingMode === "hardcore") && (
          <View className="mt-2 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <View className="flex-row items-center mb-3 px-1">
              <Ionicons
                name="settings-outline"
                size={18}
                color={t.accentColor}
              />
              <Text
                className="text-sm font-bold uppercase ml-2"
                style={{ color: t.accentColor }}
              >
                Lockdown Setup
              </Text>
            </View>
            <View
              className="rounded-2xl p-5 shadow-sm"
              style={{ backgroundColor: t.cardBgColor }}
            >
              <Text className="font-bold mb-4" style={{ color: t.textColor }}>
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
                  className="flex-1 p-4 rounded-xl items-center border-2"
                  style={{
                    backgroundColor:
                      pendingSurveillance.type === "timer"
                        ? t.accentColor + "1A"
                        : t.bgColor,
                    borderColor:
                      pendingSurveillance.type === "timer"
                        ? t.accentColor
                        : "transparent",
                  }}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mb-2"
                    style={{
                      backgroundColor:
                        pendingSurveillance.type === "timer"
                          ? t.accentColor
                          : t.accentColor,
                    }}
                  >
                    <Ionicons
                      name="hourglass-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className="font-bold"
                    style={{
                      color:
                        pendingSurveillance.type === "timer"
                          ? t.accentColor
                          : t.mutedTextColor,
                    }}
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
                  className="flex-1 p-4 rounded-xl items-center border-2"
                  style={{
                    backgroundColor:
                      pendingSurveillance.type === "click"
                        ? t.accentColor + "1A"
                        : t.bgColor,
                    borderColor:
                      pendingSurveillance.type === "click"
                        ? t.accentColor
                        : "transparent",
                  }}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mb-2"
                    style={{
                      backgroundColor:
                        pendingSurveillance.type === "click"
                          ? t.accentColor
                          : t.accentColor,
                    }}
                  >
                    <Ionicons
                      name="finger-print-outline"
                      size={24}
                      color="white"
                    />
                  </View>
                  <Text
                    className="font-bold"
                    style={{
                      color:
                        pendingSurveillance.type === "click"
                          ? t.accentColor
                          : t.mutedTextColor,
                    }}
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
                    });
                  }}
                  className="flex-1 p-4 rounded-xl items-center border-2"
                  style={{
                    backgroundColor:
                      pendingSurveillance.type === "time"
                        ? t.accentColor + "1A"
                        : t.bgColor,
                    borderColor:
                      pendingSurveillance.type === "time"
                        ? t.accentColor
                        : "transparent",
                  }}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mb-2"
                    style={{
                      backgroundColor:
                        pendingSurveillance.type === "time"
                          ? t.accentColor
                          : t.accentColor,
                    }}
                  >
                    <Ionicons name="alarm-outline" size={24} color="white" />
                  </View>
                  <Text
                    className="font-bold"
                    style={{
                      color:
                        pendingSurveillance.type === "time"
                          ? t.accentColor
                          : t.mutedTextColor,
                    }}
                  >
                    Time
                  </Text>
                </Pressable>
              </View>

              <Text className="font-bold mb-4" style={{ color: t.textColor }}>
                {pendingSurveillance.type === "timer"
                  ? "Wait Duration (seconds)"
                  : pendingSurveillance.type === "click"
                    ? "Required Tap Count"
                    : "Restriction Times (Lockout Window)"}
              </Text>

              {pendingSurveillance.type === "time" ? (
                <View
                  className="p-4 rounded-xl border"
                  style={{
                    backgroundColor: t.bgColor,
                    borderColor: t.mutedTextColor + "33",
                  }}
                >
                  <View className="flex-row items-center justify-between mb-4">
                    <Text
                      className="font-bold"
                      style={{ color: t.mutedTextColor }}
                    >
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
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: t.cardBgColor }}
                      >
                        <Ionicons name="remove" size={20} color="#EF4444" />
                      </Pressable>
                      <Text
                        className="text-xl font-bold w-20 text-center"
                        style={{ color: t.textColor }}
                      >
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
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: t.cardBgColor }}
                      >
                        <Ionicons name="add" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>

                  <View
                    className="h-0.5 mb-4"
                    style={{ backgroundColor: t.cardBgColor }}
                  />

                  <View className="flex-row items-center justify-between">
                    <Text
                      className="font-bold"
                      style={{ color: t.mutedTextColor }}
                    >
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
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: t.cardBgColor }}
                      >
                        <Ionicons name="remove" size={20} color="#EF4444" />
                      </Pressable>
                      <Text
                        className="text-xl font-bold w-20 text-center"
                        style={{ color: t.textColor }}
                      >
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
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: t.cardBgColor }}
                      >
                        <Ionicons name="add" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : (
                <View
                  className="flex-row items-center justify-between p-4 rounded-xl border"
                  style={{
                    backgroundColor: t.bgColor,
                    borderColor: t.mutedTextColor + "33",
                  }}
                >
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
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={{ backgroundColor: t.cardBgColor }}
                  >
                    <Ionicons name="remove" size={28} color={t.accentColor} />
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
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={{ backgroundColor: t.cardBgColor }}
                  >
                    <Ionicons name="add" size={28} color={t.accentColor} />
                  </Pressable>
                </View>
              )}

              <View
                className="flex-row items-center mt-4 p-3 rounded-lg"
                style={{ backgroundColor: t.accentColor + "0D" }}
              >
                <Ionicons
                  name="flash-outline"
                  size={16}
                  color={t.accentColor}
                />
                <Text
                  className="text-[11px] ml-2 flex-1 font-medium italic"
                  style={{ color: t.mutedTextColor }}
                >
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

        <View
          className="p-4 rounded-xl mt-4"
          style={{ backgroundColor: t.accentColor + "33" }}
        >
          <View className="flex-row items-center mb-2">
            <Ionicons
              name="information-circle"
              size={20}
              color={t.accentColor}
            />
            <Text className="ml-2 font-bold" style={{ color: t.accentColor }}>
              What is Lockdown?
            </Text>
          </View>
          {isDeviceOwner ? (
            <Text className="text-sm leading-5" style={{ color: t.textColor }}>
              Hardcore mode uses OS-level Device Owner protection and the
              Accessibility Service to monitor System Settings. Uninstalling
              LibreAscent or deactivating Admin access is blocked by the system.
            </Text>
          ) : (
            <View>
              <Text
                className="text-sm leading-5 mb-2"
                style={{ color: t.textColor }}
              >
                Hardcore mode uses the Accessibility Service to bounce you away
                from uninstall and admin settings. Protection is best-effort and
                is paused during Banking Mode.
              </Text>
              <Text
                className="text-xs font-semibold mb-1"
                style={{ color: t.mutedTextColor }}
              >
                For OS-level uninstall protection, set up Device Owner via ADB:
              </Text>
              <View
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: t.bgColor }}
              >
                <Text
                  selectable
                  className="text-xs"
                  style={{ color: t.accentColor, fontFamily: "monospace" }}
                >
                  adb shell dpm set-device-owner com.libreascent.app/expo.modules.freedomdeviceadmin.FreedomDeviceAdminReceiver
                </Text>
              </View>
            </View>
          )}
        </View>

        {isDirty && (
          <Pressable
            onPress={onConfirmPress}
            className="p-5 rounded-2xl items-center mt-6 mb-10 shadow-xl active:scale-[0.98] border-b-4"
            style={{
              backgroundColor: t.accentColor,
              borderColor: t.accentColor,
            }}
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
              <Text
                className="font-bold text-lg ml-3"
                style={{ color: t.textColor }}
              >
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
