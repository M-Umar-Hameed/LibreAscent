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

export default function BlockKeywordsScreen(): ReactNode {
  const [newKeyword, setNewKeyword] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "remove";
    value: string;
  } | null>(null);
  const {
    keywords,
    addKeyword: addStoreKeyword,
    removeKeyword,
  } = useBlockingStore();
  const { controlMode } = useAppStore();

  const handleAddPress = (): void => {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed) return;

    // Adding is strengthening — instant!
    void addKeyword(trimmed);
  };

  const handleRemovePress = (keyword: string): void => {
    if (controlMode === "flexible") {
      void performRemove(keyword);
    } else {
      setPendingAction({ type: "remove", value: keyword });
    }
  };

  const addKeyword = async (val: string): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addStoreKeyword(val);
    setNewKeyword("");
    setPendingAction(null);
    await ProtectionService.syncAllConfigs();
  };

  const performRemove = async (val: string): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    removeKeyword(val);
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
          Block Keywords
        </Text>
        <Text className="text-freedom-text-muted mb-6">
          Content containing these keywords will be blocked
        </Text>

        {/* Add Keyword Input */}
        <View className="flex-row gap-2 mb-6">
          <TextInput
            className="flex-1 bg-gray-100 dark:bg-freedom-surface text-black dark:text-white px-4 py-3 rounded-xl"
            placeholder="Enter keyword..."
            placeholderTextColor="#94A3B8"
            value={newKeyword}
            onChangeText={setNewKeyword}
            onSubmitEditing={handleAddPress}
          />
          <Pressable
            onPress={handleAddPress}
            className="bg-freedom-highlight px-4 rounded-xl items-center justify-center active:opacity-70 active:scale-95 transition-all"
          >
            <Ionicons name="add-circle-outline" size={24} color="white" />
          </Pressable>
        </View>

        {/* Keywords List */}
        {keywords.length === 0 ? (
          <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-8 items-center">
            <Ionicons name="text-outline" size={48} color="#94A3B8" />
            <Text className="text-freedom-text-muted mt-4 text-center">
              No keywords added yet. Add keywords that should trigger content
              blocking.
            </Text>
          </View>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {keywords.map((keyword) => (
              <Pressable
                key={keyword}
                onPress={() => {
                  handleRemovePress(keyword);
                }}
                className="bg-gray-100 dark:bg-freedom-surface flex-row items-center px-3 py-2 rounded-lg active:opacity-50"
              >
                <Text className="text-black dark:text-white mr-2">
                  {keyword}
                </Text>
                <Ionicons
                  name="close-circle-outline"
                  size={16}
                  color="#EF4444"
                />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <InteractionGuard
        visible={!!pendingAction}
        actionName={
          pendingAction?.type === "add" ? "Add Keyword" : "Remove Keyword"
        }
        onSuccess={() => {
          if (pendingAction?.type === "add")
            void addKeyword(pendingAction.value);
          else if (pendingAction?.type === "remove")
            void performRemove(pendingAction.value);
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
