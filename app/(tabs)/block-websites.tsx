import { InteractionGuard } from "@/components/InteractionGuard";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Tab = "keywords" | "blocked" | "whitelisted";

export default function BlockWebsitesScreen(): ReactNode {
  const [activeTab, setActiveTab] = useState<Tab>("keywords");
  const [newValue, setNewValue] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "remove" | "remove_multiple" | "remove_all";
    value?: string;
    tab: Tab;
  } | null>(null);

  // Keyword selection mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);

  // Global control mode
  const { controlMode, surveillance } = useAppStore();

  const {
    keywords,
    addKeyword: addStoreKeyword,
    removeKeyword,
    removeKeywords,
    includedUrls,
    excludedUrls,
    addIncludedUrl,
    removeIncludedUrl,
    addExcludedUrl,
    removeExcludedUrl,
  } = useBlockingStore();

  const currentList =
    activeTab === "keywords"
      ? keywords
      : activeTab === "blocked"
        ? includedUrls
        : excludedUrls;

  const filteredKeywords = useMemo(() => {
    if (!searchQuery) return keywords;
    const lowerQuery = searchQuery.trim().toLowerCase();
    return keywords.filter((k) => k.includes(lowerQuery));
  }, [keywords, searchQuery]);

  const visibleKeywords = filteredKeywords.slice(0, displayLimit);

  // --- Actions ---

  const handleAddPress = (): void => {
    const trimmed = newValue.trim().toLowerCase();
    if (!trimmed) return;
    performAdd(trimmed);
  };

  const performAdd = (val: string): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeTab === "keywords") addStoreKeyword(val);
    else if (activeTab === "blocked") addIncludedUrl(val);
    else addExcludedUrl(val);
    setNewValue("");
    setPendingAction(null);
  };

  const handleRemovePress = (value: string): void => {
    if (controlMode === "flexible") {
      performRemove(value);
    } else {
      setPendingAction({ type: "remove", value, tab: activeTab });
    }
  };

  const performRemove = (val?: string): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!val) return;
    if (activeTab === "keywords") removeKeyword(val);
    else if (activeTab === "blocked") removeIncludedUrl(val);
    else removeExcludedUrl(val);
    setPendingAction(null);
  };

  const performRemoveMultiple = (all = false): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (all) removeKeywords(keywords);
    else removeKeywords(Array.from(selectedKeywords));
    setPendingAction(null);
    setSelectedKeywords(new Set());
    setIsSelectionMode(false);
  };

  const toggleSelection = (keyword: string): void => {
    const newSet = new Set(selectedKeywords);
    if (newSet.has(keyword)) newSet.delete(keyword);
    else newSet.add(keyword);
    setSelectedKeywords(newSet);
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
        {/* Header */}
        <View className="mb-2">
          <Text className="text-2xl font-bold text-black dark:text-white">
            Content Blocking
          </Text>
        </View>
        <Text className="text-freedom-text-muted mb-6">
          Manage keywords, blocked and whitelisted websites
        </Text>

        {/* 3-Tab Switcher */}
        <View className="flex-row bg-gray-100 dark:bg-freedom-surface rounded-xl p-1 mb-6">
          {(
            [
              { id: "keywords", label: "Keywords", count: keywords.length },
              { id: "blocked", label: "Blocked", count: includedUrls.length },
              {
                id: "whitelisted",
                label: "Whitelist",
                count: excludedUrls.length,
              },
            ] as const
          ).map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => {
                void Haptics.selectionAsync();
                setActiveTab(tab.id);
                setNewValue("");
                if (tab.id !== "keywords") {
                  setIsSelectionMode(false);
                  setSelectedKeywords(new Set());
                }
              }}
              className={`flex-1 py-3 rounded-lg items-center ${
                activeTab === tab.id ? "bg-freedom-highlight" : "bg-transparent"
              }`}
            >
              <Text
                className={`font-semibold text-xs ${
                  activeTab === tab.id
                    ? "text-white"
                    : "text-freedom-text-muted"
                }`}
              >
                {tab.label} ({tab.count})
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Add Input */}
        <View className="flex-row gap-2 mb-6">
          <TextInput
            className="flex-1 bg-gray-100 dark:bg-freedom-surface text-black dark:text-white px-4 py-3 rounded-xl"
            placeholder={
              activeTab === "keywords"
                ? "Enter keyword..."
                : "Enter domain (e.g. example.com)..."
            }
            placeholderTextColor="#94A3B8"
            value={newValue}
            onChangeText={setNewValue}
            onSubmitEditing={handleAddPress}
            autoCapitalize="none"
            keyboardType={activeTab === "keywords" ? "default" : "url"}
          />
          <Pressable
            onPress={handleAddPress}
            className="bg-freedom-highlight px-4 rounded-xl items-center justify-center"
          >
            <Ionicons name="add-circle-outline" size={24} color="white" />
          </Pressable>
        </View>

        {/* Keywords Tab Content */}
        {activeTab === "keywords" && (
          <>
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
                              performRemoveMultiple(true);
                            else
                              setPendingAction({
                                type: "remove_all",
                                tab: "keywords",
                              });
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
                            if (
                              selectedKeywords.size === filteredKeywords.length
                            )
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
                              performRemoveMultiple(false);
                            else
                              setPendingAction({
                                type: "remove_multiple",
                                tab: "keywords",
                              });
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
                    setDisplayLimit(50);
                  }}
                />
              </View>
            )}

            {keywords.length === 0 ? (
              <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-8 items-center">
                <Ionicons name="text-outline" size={48} color="#94A3B8" />
                <Text className="text-freedom-text-muted mt-4 text-center">
                  No keywords added yet. Add keywords that should trigger
                  content blocking.
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
                            selectedKeywords.has(keyword)
                              ? "#3B82F6"
                              : "#94A3B8"
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
                    <Text className="text-freedom-highlight font-bold">
                      Load More ({filteredKeywords.length - displayLimit}{" "}
                      remain)
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}

        {/* Blocked / Whitelisted Tab Content */}
        {(activeTab === "blocked" || activeTab === "whitelisted") && (
          <>
            {currentList.length === 0 ? (
              <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-8 items-center">
                <Ionicons name="globe-outline" size={48} color="#94A3B8" />
                <Text className="text-freedom-text-muted mt-4 text-center">
                  {activeTab === "blocked"
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
                          activeTab === "blocked"
                            ? "ban-outline"
                            : "checkmark-done-outline"
                        }
                        size={20}
                        color={activeTab === "blocked" ? "#EF4444" : "#2DD4BF"}
                      />
                      <Text className="text-black dark:text-white ml-3">
                        {url}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        handleRemovePress(url);
                      }}
                      className="active:opacity-50 p-2"
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color="#94A3B8"
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Guard for removing content */}
      <InteractionGuard
        visible={!!pendingAction}
        actionName={
          pendingAction?.type === "remove_all"
            ? "Delete All Keywords"
            : pendingAction?.type === "remove_multiple"
              ? `Delete ${selectedKeywords.size} Keywords`
              : pendingAction?.tab === "blocked"
                ? "Unblock Website"
                : pendingAction?.tab === "whitelisted"
                  ? "Un-whitelist Website"
                  : "Remove Keyword"
        }
        surveillanceOverride={surveillance}
        onSuccess={() => {
          if (pendingAction?.type === "remove" && pendingAction.value)
            performRemove(pendingAction.value);
          else if (pendingAction?.type === "remove_multiple")
            performRemoveMultiple(false);
          else if (pendingAction?.type === "remove_all")
            performRemoveMultiple(true);
        }}
        onCancel={() => {
          setPendingAction(null);
        }}
      />
    </SafeAreaView>
  );
}
