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
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BlockAdultScreen(): ReactNode {
  const [isUpdating, setIsUpdating] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: "toggle" | "update" | "master";
    id?: string;
  } | null>(null);
  const {
    categories,
    toggleCategory: toggleStoreCategory,
    adultBlockingEnabled,
    setAdultBlockingEnabled,
  } = useBlockingStore();
  const { controlMode } = useAppStore();

  const handleTogglePress = (id: string, isEnabling: boolean): void => {
    if (controlMode === "flexible" || isEnabling) {
      void toggleCategory(id);
    } else {
      setPendingAction({ type: "toggle", id });
    }
  };

  const handleMasterTogglePress = (isEnabling: boolean): void => {
    if (controlMode === "flexible" || isEnabling) {
      void toggleMaster();
    } else {
      setPendingAction({ type: "master" });
    }
  };

  const handleUpdatePress = (): void => {
    if (controlMode === "flexible") {
      void performUpdate();
    } else {
      setPendingAction({ type: "update" });
    }
  };

  const toggleCategory = async (id: string): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleStoreCategory(id);
    setPendingAction(null);

    // Sync VPN category toggle in the background (uses addCategory/removeCategory)
    const updatedState = useBlockingStore.getState();
    const cat = updatedState.categories.find((c) => c.id === id);
    void BlocklistService.syncVpnCategoryToggle(id, !!cat?.enabled);

    await ProtectionService.syncAllConfigs();

    // Auto-fetch if the enabled category has no domains
    if (cat?.enabled && (!cat.domains || cat.domains.length === 0)) {
      // eslint-disable-next-line no-console
      console.log(
        `[BlockAdult] Category ${id} has 0 domains, triggering update...`,
      );
      void performUpdate();
    }
  };

  const toggleMaster = async (): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newEnabled = !adultBlockingEnabled;
    setAdultBlockingEnabled(newEnabled);
    setPendingAction(null);

    // Sync VPN categories based on new master state
    const state = useBlockingStore.getState();
    for (const cat of state.categories) {
      void BlocklistService.syncVpnCategoryToggle(
        cat.id,
        newEnabled && cat.enabled,
      );
    }

    await ProtectionService.syncAllConfigs({ skipResync: true });
  };

  const performUpdate = async (): Promise<void> => {
    setPendingAction(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsUpdating(true);
    const success = await BlocklistService.updateBlocklists();
    setIsUpdating(false);

    if (success) {
      Alert.alert(
        "Success",
        "Adult blocklists have been successfully updated!",
      );
    } else {
      Alert.alert(
        "Error",
        "Failed to update blocklists. Please check your internet connection.",
      );
    }
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
        <Text className="text-2xl font-bold text-black dark:text-white mb-2">
          Block Adult Content
        </Text>
        <Text className="text-freedom-text-muted mb-6">
          Manage adult content blocking categories
        </Text>

        {/* Master Toggle */}
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-4 flex-row items-center justify-between mb-6">
          <View className="flex-1">
            <Text className="text-black dark:text-white text-lg font-semibold">
              Adult Content Blocking
            </Text>
            <Text className="text-freedom-text-muted text-sm">
              Master switch for all categories
            </Text>
          </View>
          <Switch
            value={adultBlockingEnabled}
            onValueChange={(val) => {
              handleMasterTogglePress(val);
            }}
            trackColor={{ false: "#333", true: "#2DD4BF" }}
            thumbColor={adultBlockingEnabled ? "#fff" : "#999"}
          />
        </View>

        {/* Categories */}
        <Text className="text-lg font-semibold text-black dark:text-white mb-3">
          Categories
        </Text>
        <View className="gap-3 mb-6">
          {categories.map((category) => (
            <View
              key={category.id}
              className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-4"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-black dark:text-white font-semibold">
                    {category.name}
                  </Text>
                  <Text className="text-freedom-text-muted text-sm">
                    {category.description}
                  </Text>
                  {category.id === "hentai" && (
                    <Text className="text-freedom-accent text-xs mt-1 italic font-medium">
                      Note: Whitelist your favorite anime/manga/manhua/manhwa
                      sites to avoid blocks.
                    </Text>
                  )}
                  <Text className="text-freedom-text-muted text-xs mt-1">
                    {category.domains?.length || 0} domains
                  </Text>
                </View>
                <Switch
                  value={category.enabled && adultBlockingEnabled}
                  onValueChange={(val) => {
                    handleTogglePress(category.id, val);
                  }}
                  disabled={!adultBlockingEnabled}
                  trackColor={{ false: "#333", true: "#2DD4BF" }}
                  thumbColor={
                    category.enabled && adultBlockingEnabled ? "#fff" : "#999"
                  }
                />
              </View>
            </View>
          ))}
        </View>

        {/* Update Button */}
        <Pressable
          disabled={isUpdating}
          onPress={handleUpdatePress}
          className={`rounded-xl p-4 flex-row items-center justify-center mb-6 active:opacity-70 active:scale-95 transition-all ${
            isUpdating
              ? "bg-gray-200 dark:bg-freedom-surface"
              : "bg-freedom-accent"
          }`}
        >
          {isUpdating ? (
            <ActivityIndicator color="white" />
          ) : (
            <Ionicons name="add-circle-outline" size={20} color="white" />
          )}
          <Text className="text-white font-semibold ml-2">
            {isUpdating ? "Updating Blocklists..." : "Update Blocklists"}
          </Text>
        </Pressable>

        {/* Add Custom Category */}
        <Pressable className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-4 flex-row items-center justify-center mb-6">
          <Ionicons name="add-circle-outline" size={20} color="#2DD4BF" />
          <Text className="text-freedom-text-muted font-semibold ml-2">
            Add Custom Category
          </Text>
        </Pressable>
      </ScrollView>

      <InteractionGuard
        visible={!!pendingAction}
        actionName={
          pendingAction?.type === "update"
            ? "Update Blocklists"
            : pendingAction?.type === "master"
              ? "Change Master Filter"
              : "Change Category Settings"
        }
        onSuccess={() => {
          if (pendingAction?.type === "update") void performUpdate();
          else if (pendingAction?.type === "master") void toggleMaster();
          else if (pendingAction?.type === "toggle" && pendingAction.id)
            void toggleCategory(pendingAction.id);
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
