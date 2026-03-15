import { InteractionGuard } from "@/components/InteractionGuard";
import { BlocklistService } from "@/services/BlocklistService";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
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

export default function BlockAdultScreen(): ReactNode {
  const {
    adultBlockingEnabled,
    setAdultBlockingEnabled,
    categoryDomainCounts,
  } = useBlockingStore();
  const { controlMode, surveillance } = useAppStore();

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

  const showAlert = (
    title: string,
    message: string,
    type: "success" | "error",
  ): void => {
    setAlertModal({ visible: true, title, message, type });
  };

  const handleMasterToggle = (isEnabling: boolean): void => {
    if (controlMode === "flexible" || isEnabling) {
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
        surveillanceOverride={surveillance}
        onSuccess={() => {
          void performToggle();
        }}
        onCancel={() => {
          setGuardVisible(false);
        }}
      />
    </SafeAreaView>
  );
}
