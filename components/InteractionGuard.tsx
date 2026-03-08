import { useAppStore } from "@/stores/useAppStore";
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
}

export const InteractionGuard: React.FC<InteractionGuardProps> = ({
  visible,
  onSuccess,
  onCancel,
  actionName,
}) => {
  const { surveillance } = useAppStore();
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

    // If start == end, it means Always Locked (24 hours)
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
        <View className="bg-white dark:bg-freedom-surface w-full rounded-3xl p-6 items-center shadow-xl">
          <View className="w-16 h-16 rounded-full bg-freedom-accent/20 items-center justify-center mb-4">
            <Ionicons name="hand-right" size={32} color="#e94560" />
          </View>

          <Text className="text-xl font-bold text-black dark:text-white text-center mb-2">
            Patience Required
          </Text>

          <Text className="text-freedom-text-muted text-center mb-8">
            You are about to {actionName.toLowerCase()}. Take a moment to
            breathe and reflect on your goals.
          </Text>

          {surveillance.type === "timer" ? (
            <View className="items-center w-full">
              <View className="w-24 h-24 rounded-full border-4 border-freedom-highlight items-center justify-center mb-6">
                <Text className="text-3xl font-bold text-black dark:text-white">
                  {timeLeft}s
                </Text>
              </View>

              <Pressable
                onPress={handleTimerComplete}
                disabled={timeLeft > 0}
                className={`w-full py-4 rounded-xl items-center mb-3 shadow-sm ${
                  timeLeft > 0
                    ? "bg-gray-200 dark:bg-freedom-accent opacity-60"
                    : "bg-freedom-highlight"
                }`}
              >
                <Text className="text-white font-bold text-lg">
                  {timeLeft > 0 ? "Please Wait..." : "Confirm Action"}
                </Text>
              </Pressable>
            </View>
          ) : surveillance.type === "click" ? (
            <View className="items-center w-full">
              <Pressable
                onPress={handleClick}
                className="w-32 h-32 rounded-full bg-freedom-highlight items-center justify-center mb-6 active:scale-90 shadow-lg border-b-4 border-freedom-accent"
              >
                <Text className="text-white text-4xl font-bold">
                  {surveillance.value - clickCount}
                </Text>
                <Text className="text-white/80 text-xs font-bold uppercase">
                  Taps Left
                </Text>
              </Pressable>

              <Text className="text-freedom-text-muted text-sm mb-6 flex-row items-center">
                Tap to bypass the lock
              </Text>
            </View>
          ) : surveillance.type === "time" ? (
            <View className="items-center w-full">
              <View className="w-full bg-gray-100 dark:bg-black/20 p-6 rounded-2xl items-center mb-6 border border-freedom-highlight/20">
                <Ionicons
                  name="lock-closed-outline"
                  size={48}
                  color="#e94560"
                />
                <Text className="text-2xl font-bold text-black dark:text-white mt-4">
                  Lockout Active
                </Text>
                <Text className="text-xl font-semibold text-freedom-highlight mt-1">
                  {lockIntervalStr}
                </Text>
                <Text className="text-freedom-text-muted text-center mt-4">
                  Settings are strictly locked during this window to preserve
                  your focus. Try again outside this interval.
                </Text>
              </View>

              <Pressable
                onPress={onSuccess}
                disabled={activeTimeLock}
                className={`w-full py-4 rounded-xl items-center mb-3 shadow-sm ${
                  activeTimeLock
                    ? "bg-gray-300 dark:bg-freedom-accent opacity-50"
                    : "bg-freedom-highlight"
                }`}
              >
                <Text className="text-white font-bold text-lg">
                  {activeTimeLock ? "Currently Restricted" : "Confirm Action"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable onPress={onCancel} className="mt-2 p-2">
            <Text className="text-freedom-highlight font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
