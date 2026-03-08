import { InteractionGuard } from "@/components/InteractionGuard";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Tab = "included" | "excluded";

export default function BlockWebsitesScreen(): ReactNode {
  const [activeTab, setActiveTab] = useState<Tab>("included");
  const [newUrl, setNewUrl] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "remove";
    value: string;
    tab: Tab;
  } | null>(null);
  const { controlMode } = useAppStore();

  const {
    includedUrls,
    excludedUrls,
    addIncludedUrl,
    removeIncludedUrl,
    addExcludedUrl,
    removeExcludedUrl,
  } = useBlockingStore();

  const currentList = activeTab === "included" ? includedUrls : excludedUrls;

  const handleAddPress = (): void => {
    const trimmed = newUrl.trim().toLowerCase();
    if (!trimmed) return;

    // Adding is strengthening — instant!
    void performAdd(trimmed, activeTab);
  };

  const handleRemovePress = (url: string): void => {
    if (controlMode === "flexible") {
      void performRemove(url, activeTab);
    } else {
      setPendingAction({ type: "remove", value: url, tab: activeTab });
    }
  };

  const performAdd = async (url: string, tab: Tab): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (tab === "included") {
      addIncludedUrl(url);
    } else {
      addExcludedUrl(url);
    }
    setNewUrl("");
    setPendingAction(null);
    await ProtectionService.syncAllConfigs();
  };

  const performRemove = async (url: string, tab: Tab): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (tab === "included") {
      removeIncludedUrl(url);
    } else {
      removeExcludedUrl(url);
    }
    setPendingAction(null);
    await ProtectionService.syncAllConfigs();
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-freedom-primary"
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text className="text-2xl font-bold text-black dark:text-white mb-2">
          Block Websites
        </Text>
        <Text className="text-freedom-text-muted mb-6">
          Manage blocked and whitelisted websites
        </Text>

        {/* Tab Switcher */}
        <View className="flex-row bg-gray-100 dark:bg-freedom-surface rounded-xl p-1 mb-6">
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setActiveTab("included");
            }}
            className={`flex-1 py-3 rounded-lg items-center active:opacity-80 transition-opacity ${
              activeTab === "included" ? "bg-freedom-highlight" : ""
            }`}
          >
            <Text
              className={`font-semibold ${
                activeTab === "included"
                  ? "text-white"
                  : "text-freedom-text-muted"
              }`}
            >
              Blocked ({includedUrls.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setActiveTab("excluded");
            }}
            className={`flex-1 py-3 rounded-lg items-center active:opacity-80 transition-opacity ${
              activeTab === "excluded" ? "bg-freedom-success" : ""
            }`}
          >
            <Text
              className={`font-semibold ${
                activeTab === "excluded"
                  ? "text-white"
                  : "text-freedom-text-muted"
              }`}
            >
              Whitelisted ({excludedUrls.length})
            </Text>
          </Pressable>
        </View>

        {/* Add URL Input */}
        <View className="flex-row gap-2 mb-6">
          <TextInput
            className="flex-1 bg-gray-100 dark:bg-freedom-surface text-black dark:text-white px-4 py-3 rounded-xl"
            placeholder="Enter domain (e.g. example.com)..."
            placeholderTextColor="#94A3B8"
            value={newUrl}
            onChangeText={setNewUrl}
            onSubmitEditing={handleAddPress}
            autoCapitalize="none"
            keyboardType="url"
          />
          <Pressable
            onPress={handleAddPress}
            className={`px-4 rounded-xl items-center justify-center active:opacity-70 active:scale-95 transition-all ${
              activeTab === "included"
                ? "bg-freedom-highlight"
                : "bg-freedom-success"
            }`}
          >
            <Ionicons name="add-circle-outline" size={24} color="white" />
          </Pressable>
        </View>

        {/* URL List */}
        {currentList.length === 0 ? (
          <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-8 items-center">
            <Ionicons name="globe-outline" size={48} color="#94A3B8" />
            <Text className="text-freedom-text-muted mt-4 text-center">
              {activeTab === "included"
                ? "No blocked websites. Add domains to block."
                : "No whitelisted websites. Add domains to exclude from blocking."}
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {currentList.map((url) => (
              <View
                key={url}
                className="bg-gray-100 dark:bg-freedom-surface flex-row items-center justify-between px-4 py-3 rounded-xl"
              >
                <View className="flex-row items-center flex-1">
                  <Ionicons
                    name={
                      activeTab === "included"
                        ? "ban-outline"
                        : "checkmark-done-outline"
                    }
                    size={20}
                    color={activeTab === "included" ? "#EF4444" : "#2DD4BF"}
                  />
                  <Text className="text-black dark:text-white ml-3">{url}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    handleRemovePress(url);
                  }}
                  className="active:opacity-50 p-2"
                >
                  <Ionicons name="trash-outline" size={20} color="#94A3B8" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <InteractionGuard
        visible={!!pendingAction}
        actionName={
          pendingAction?.type === "add"
            ? pendingAction.tab === "included"
              ? "Block Website"
              : "Whitelist Website"
            : pendingAction?.tab === "included"
              ? "Unblock Website"
              : "Un-whitelist Website"
        }
        onSuccess={() => {
          if (pendingAction?.type === "add")
            void performAdd(pendingAction.value, pendingAction.tab);
          else if (pendingAction?.type === "remove")
            void performRemove(pendingAction.value, pendingAction.tab);
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
