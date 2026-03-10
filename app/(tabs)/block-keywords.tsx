import { InteractionGuard } from "@/components/InteractionGuard";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BlockKeywordsScreen(): ReactNode {
  const [newKeyword, setNewKeyword] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "remove" | "remove_multiple" | "remove_all";
    value?: string;
  } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );

  const {
    keywords,
    addKeyword: addStoreKeyword,
    removeKeyword,
    removeKeywords,
  } = useBlockingStore();
  const { controlMode } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);

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

  const performRemove = async (val?: string): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (val) {
      removeKeyword(val);
    }
    setPendingAction(null);
    await ProtectionService.syncAllConfigs();
  };

  const performRemoveMultiple = async (all = false): Promise<void> => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (all) {
      removeKeywords(keywords);
    } else {
      removeKeywords(Array.from(selectedKeywords));
    }
    setPendingAction(null);
    setSelectedKeywords(new Set());
    setIsSelectionMode(false);
    await ProtectionService.syncAllConfigs();
  };

  const filteredKeywords = useMemo(() => {
    if (!searchQuery) return keywords;
    const lowerQuery = searchQuery.trim().toLowerCase();
    return keywords.filter((k) => k.includes(lowerQuery));
  }, [keywords, searchQuery]);

  const toggleSelection = (keyword: string): void => {
    const newSet = new Set(selectedKeywords);
    if (newSet.has(keyword)) newSet.delete(keyword);
    else newSet.add(keyword);
    setSelectedKeywords(newSet);
  };

  const visibleKeywords = filteredKeywords.slice(0, displayLimit);

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

        {/* Search Keyword Input & Bulk Actions */}
        {keywords.length > 0 && (
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-4">
              {!isSelectionMode ? (
                <>
                  <Text className="text-xl font-bold text-black dark:text-white">
                    Directory
                  </Text>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => {
                        setIsSelectionMode(true);
                      }}
                      className="bg-freedom-highlight px-4 py-2 rounded-lg active:opacity-70"
                    >
                      <Text className="text-white font-bold tracking-wide">
                        Select
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (controlMode === "flexible")
                          void performRemoveMultiple(true);
                        else setPendingAction({ type: "remove_all" });
                      }}
                      className="bg-red-100 dark:bg-red-900/30 px-4 py-2 rounded-lg"
                    >
                      <Text className="text-red-600 dark:text-red-400 font-medium">
                        Delete All
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text className="text-lg font-bold text-black dark:text-white">
                    {selectedKeywords.size} Selected
                  </Text>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => {
                        if (selectedKeywords.size === filteredKeywords.length)
                          setSelectedKeywords(new Set());
                        else setSelectedKeywords(new Set(filteredKeywords));
                      }}
                      className="bg-freedom-highlight/20 dark:bg-freedom-highlight/30 px-3 py-2 rounded-lg border border-freedom-highlight/40 active:opacity-70"
                    >
                      <Text className="text-freedom-highlight font-bold">
                        {selectedKeywords.size === filteredKeywords.length
                          ? "Deselect"
                          : "Select All"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (controlMode === "flexible")
                          void performRemoveMultiple(false);
                        else setPendingAction({ type: "remove_multiple" });
                      }}
                      className={`px-3 py-2 rounded-lg ${selectedKeywords.size > 0 ? "bg-red-500" : "bg-gray-300 dark:bg-gray-700"}`}
                      disabled={selectedKeywords.size === 0}
                    >
                      <Text className="text-white font-medium">Delete</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setIsSelectionMode(false);
                        setSelectedKeywords(new Set());
                      }}
                      className="bg-gray-200 dark:bg-gray-800 px-3 py-2 rounded-lg active:opacity-70"
                    >
                      <Text className="text-gray-700 dark:text-gray-300 font-bold">
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>

            <TextInput
              className="bg-gray-100 dark:bg-freedom-surface text-black dark:text-white px-4 py-3 rounded-xl border border-gray-200 dark:border-freedom-surface"
              placeholder="Search existing keywords..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
                setDisplayLimit(50); // Reset limit on new search
              }}
            />
          </View>
        )}

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
          <View className="flex-col pb-10">
            <Text className="text-freedom-text-muted mb-3 text-xs">
              {filteredKeywords.length} keywords total{" "}
              {searchQuery ? "found" : ""}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {visibleKeywords.map((keyword) => (
                <Pressable
                  key={keyword}
                  onPress={() => {
                    if (isSelectionMode) toggleSelection(keyword);
                    else handleRemovePress(keyword);
                  }}
                  className={`flex-row items-center px-3 py-2 rounded-lg active:opacity-50 ${isSelectionMode && selectedKeywords.has(keyword) ? "bg-freedom-highlight/20 border border-freedom-highlight" : "bg-gray-100 dark:bg-freedom-surface border border-transparent"}`}
                >
                  {isSelectionMode && (
                    <Ionicons
                      name={
                        selectedKeywords.has(keyword)
                          ? "checkmark-circle"
                          : "ellipse-outline"
                      }
                      size={18}
                      color={
                        selectedKeywords.has(keyword) ? "#3B82F6" : "#94A3B8"
                      }
                      style={{ marginRight: 6 }}
                    />
                  )}
                  <Text className="text-black dark:text-white mr-2">
                    {keyword}
                  </Text>
                  {!isSelectionMode && (
                    <Ionicons
                      name="close-circle-outline"
                      size={16}
                      color="#EF4444"
                    />
                  )}
                </Pressable>
              ))}
            </View>

            {filteredKeywords.length > displayLimit && (
              <Pressable
                onPress={() => {
                  setDisplayLimit((prev) => prev + 100);
                }}
                className="mt-6 py-3 px-6 bg-gray-100 dark:bg-freedom-surface rounded-xl items-center self-center"
              >
                <Text className="text-freedom-primary font-bold">
                  Load More ({filteredKeywords.length - displayLimit} remain)
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <InteractionGuard
        visible={!!pendingAction}
        actionName={
          pendingAction?.type === "add"
            ? "Add Keyword"
            : pendingAction?.type === "remove_all"
              ? "Delete All Keywords"
              : pendingAction?.type === "remove_multiple"
                ? `Delete ${selectedKeywords.size} Keywords`
                : "Remove Keyword"
        }
        onSuccess={() => {
          if (pendingAction?.type === "add" && pendingAction.value)
            void addKeyword(pendingAction.value);
          else if (pendingAction?.type === "remove" && pendingAction.value)
            void performRemove(pendingAction.value);
          else if (pendingAction?.type === "remove_multiple")
            void performRemoveMultiple(false);
          else if (pendingAction?.type === "remove_all")
            void performRemoveMultiple(true);
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
