import { useAppTheme } from "@/providers/ThemeProvider";
import { useAppStore } from "@/stores/useAppStore";
import type { SurveillanceConfig } from "@/types/blocking";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type React from "react";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

interface InteractionGuardProps {
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  actionName: string;
  surveillanceOverride?: SurveillanceConfig;
}

export const InteractionGuard: React.FC<InteractionGuardProps> = ({
  visible,
  onSuccess,
  onCancel,
  actionName,
  surveillanceOverride,
}) => {
  const t = useAppTheme();
  const globalSurveillance = useAppStore((s) => s.surveillance);
  const surveillance = surveillanceOverride ?? globalSurveillance;
  const [timeLeft, setTimeLeft] = useState(surveillance.value);
  const [clickCount, setClickCount] = useState(0);

  useEffect(() => {
    if (!visible) {
      setTimeLeft(surveillance.value);
      setClickCount(0);
      return;
    }

    if (surveillance.type === "timer") {
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        clearInterval(timer);
      };
    }
  }, [visible, surveillance]);

  const handleTimerComplete = (): void => {
    if (timeLeft === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleClick = (): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextCount = clickCount + 1;
    setClickCount(nextCount);
    if (nextCount >= surveillance.value) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    }
  };

  const isTimeLocked = (): boolean => {
    if (surveillance.type !== "time") return false;
    const currentHour = new Date().getHours();
    const start = surveillance.startHour ?? 0;
    const end = surveillance.endHour ?? 0;

    if (start === end) return true;

    if (start < end) {
      return currentHour >= start && currentHour < end;
    } else {
      return currentHour >= start || currentHour < end;
    }
  };

  const formatHour = (h: number): string => {
    return `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
  };

  const lockIntervalStr =
    surveillance.type === "time"
      ? surveillance.startHour === surveillance.endHour
        ? "Permanent (24 Hours)"
        : `${formatHour(surveillance.startHour ?? 0)} - ${formatHour(surveillance.endHour ?? 0)}`
      : "";

  const activeTimeLock = isTimeLocked();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View
          className="w-full rounded-3xl p-6 items-center shadow-xl"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <View
            className="w-16 h-16 rounded-full items-center justify-center mb-4"
            style={{ backgroundColor: t.accentColor + "33" }}
          >
            <Ionicons name="hand-right" size={32} color="#e94560" />
          </View>

          <Text
            className="text-xl font-bold text-center mb-2"
            style={{ color: t.textColor }}
          >
            Patience Required
          </Text>

          <Text
            className="text-center mb-8"
            style={{ color: t.mutedTextColor }}
          >
            You are about to {actionName.toLowerCase()}. Take a moment to
            breathe and reflect on your goals.
          </Text>

          {surveillance.type === "timer" ? (
            <View className="items-center w-full">
              <View
                className="w-24 h-24 rounded-full border-4 items-center justify-center mb-6"
                style={{ borderColor: t.accentColor }}
              >
                <Text
                  className="text-3xl font-bold"
                  style={{ color: t.textColor }}
                >
                  {timeLeft}s
                </Text>
              </View>

              <Pressable
                onPress={handleTimerComplete}
                disabled={timeLeft > 0}
                className="w-full py-4 rounded-xl items-center mb-3 shadow-sm"
                style={{
                  backgroundColor: timeLeft > 0 ? t.accentColor : t.accentColor,
                  opacity: timeLeft > 0 ? 0.6 : 1,
                }}
              >
                <Text
                  className="font-bold text-lg"
                  style={{ color: t.textColor }}
                >
                  {timeLeft > 0 ? "Please Wait..." : "Confirm Action"}
                </Text>
              </Pressable>
            </View>
          ) : surveillance.type === "click" ? (
            <View className="items-center w-full">
              <Pressable
                onPress={handleClick}
                className="w-32 h-32 rounded-full items-center justify-center mb-6 active:scale-90 shadow-lg border-b-4"
                style={{
                  backgroundColor: t.accentColor,
                  borderColor: t.accentColor,
                }}
              >
                <Text
                  className="text-4xl font-bold"
                  style={{ color: t.textColor }}
                >
                  {surveillance.value - clickCount}
                </Text>
                <Text
                  className="text-xs font-bold uppercase"
                  style={{ color: t.textColor + "CC" }}
                >
                  Taps Left
                </Text>
              </Pressable>

              <Text
                className="text-sm mb-6 flex-row items-center"
                style={{ color: t.mutedTextColor }}
              >
                Tap to bypass the lock
              </Text>
            </View>
          ) : surveillance.type === "time" ? (
            <View className="items-center w-full">
              <View
                className="w-full p-6 rounded-2xl items-center mb-6 border"
                style={{
                  backgroundColor: t.bgColor + "33",
                  borderColor: t.accentColor + "33",
                }}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={48}
                  color="#e94560"
                />
                <Text
                  className="text-2xl font-bold mt-4"
                  style={{ color: t.textColor }}
                >
                  Lockout Active
                </Text>
                <Text
                  className="text-xl font-semibold mt-1"
                  style={{ color: t.accentColor }}
                >
                  {lockIntervalStr}
                </Text>
                <Text
                  className="text-center mt-4"
                  style={{ color: t.mutedTextColor }}
                >
                  Settings are strictly locked during this window to preserve
                  your focus. Try again outside this interval.
                </Text>
              </View>

              <Pressable
                onPress={onSuccess}
                disabled={activeTimeLock}
                className="w-full py-4 rounded-xl items-center mb-3 shadow-sm"
                style={{
                  backgroundColor: activeTimeLock
                    ? t.accentColor
                    : t.accentColor,
                  opacity: activeTimeLock ? 0.5 : 1,
                }}
              >
                <Text
                  className="font-bold text-lg"
                  style={{ color: t.textColor }}
                >
                  {activeTimeLock ? "Currently Restricted" : "Confirm Action"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable onPress={onCancel} className="mt-2 p-2">
            <Text className="font-semibold" style={{ color: t.accentColor }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
