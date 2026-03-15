import { useAppStore } from "@/stores/useAppStore";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

export function AppLockScreen({
  visible,
  onUnlock,
}: {
  visible: boolean;
  onUnlock: () => void;
}): ReactNode {
  const { appLockType, appLockHash } = useAppStore();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const attemptBiometric = useCallback(async (): Promise<void> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Freedom",
      fallbackLabel: "Use password",
      disableDeviceFallback: true,
    });
    if (result.success) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onUnlock();
    }
  }, [onUnlock]);

  useEffect(() => {
    if (visible && appLockType === "passkey") {
      void attemptBiometric();
    }
  }, [visible, appLockType, attemptBiometric]);

  const handlePasswordSubmit = async (): Promise<void> => {
    if (!password.trim()) return;
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      password,
    );
    if (hash === appLockHash) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPassword("");
      setError("");
      onUnlock();
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("Incorrect password");
      setPassword("");
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent>
      <View className="flex-1 bg-freedom-primary items-center justify-center px-8">
        <View className="w-20 h-20 rounded-full bg-freedom-highlight/20 items-center justify-center mb-6">
          <Ionicons name="lock-closed" size={40} color="#2DD4BF" />
        </View>
        <Text className="text-white text-2xl font-bold mb-2">
          Freedom is Locked
        </Text>
        <Text className="text-freedom-text-muted text-center mb-8">
          {appLockType === "passkey"
            ? "Authenticate with your fingerprint to continue"
            : "Enter your password to continue"}
        </Text>

        {appLockType === "passkey" ? (
          <Pressable
            onPress={() => {
              void attemptBiometric();
            }}
            className="bg-freedom-highlight/10 border-2 border-freedom-highlight p-5 rounded-2xl items-center w-full"
          >
            <Ionicons name="finger-print" size={48} color="#2DD4BF" />
            <Text className="text-freedom-highlight font-bold mt-3">
              Tap to Authenticate
            </Text>
          </Pressable>
        ) : (
          <View className="w-full">
            <TextInput
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError("");
              }}
              placeholder="Enter password"
              placeholderTextColor="#64748B"
              secureTextEntry
              autoFocus
              onSubmitEditing={() => {
                void handlePasswordSubmit();
              }}
              className="bg-freedom-surface border-2 border-freedom-secondary p-4 rounded-xl text-white text-center text-lg mb-4"
            />
            {error ? (
              <Text className="text-red-500 text-center mb-4">{error}</Text>
            ) : null}
            <Pressable
              onPress={() => {
                void handlePasswordSubmit();
              }}
              className="bg-freedom-highlight p-4 rounded-xl items-center"
            >
              <Text className="text-white font-bold text-lg">Unlock</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
