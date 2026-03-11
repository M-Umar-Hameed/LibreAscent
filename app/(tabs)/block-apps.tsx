import { InteractionGuard } from "@/components/InteractionGuard";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import type { BlockedApp } from "@/types/blocking";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface AppInfo {
  name: string;
  packageName: string;
}

export default function BlockAppsScreen(): React.JSX.Element {
  const {
    blockedApps,
    addBlockedApp,
    removeBlockedApp,
    toggleBlockedApp,
    updateAppControl,
  } = useBlockingStore();
  const { controlMode } = useAppStore();

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [guardVisible, setGuardVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: "remove" | "toggle" | "update";
    packageName: string;
    config?: Partial<BlockedApp>;
  } | null>(null);

  const [editingApp, setEditingApp] = useState<BlockedApp | null>(null);

  useEffect(() => {
    if (isAddModalVisible) {
      void loadInstalledApps();
    }
  }, [isAddModalVisible]);

  const loadInstalledApps = async (): Promise<void> => {
    setIsLoadingApps(true);
    try {
      const apps = await FreedomAccessibility.getInstalledApps();
      setInstalledApps(apps);
    } catch (error) {
      console.error("Failed to load apps", error);
    } finally {
      setIsLoadingApps(false);
    }
  };

  const handleAddApp = (app: AppInfo): void => {
    const newApp: BlockedApp = {
      packageName: app.packageName,
      appName: app.name,
      enabled: true,
      controlMode: "individual",
      surveillance: { type: "none", value: 0 },
    };
    addBlockedApp(newApp);
    setIsAddModalVisible(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const performActionWithGuard = (
    type: "remove" | "toggle" | "update",
    packageName: string,
    config?: Partial<BlockedApp>,
  ): void => {
    if (controlMode === "flexible") {
      executeAction(type, packageName, config);
    } else {
      setPendingAction({ type, packageName, config });
      setGuardVisible(true);
    }
  };

  const executeAction = (
    type: "remove" | "toggle" | "update",
    packageName: string,
    config?: Partial<BlockedApp>,
  ): void => {
    if (type === "remove") removeBlockedApp(packageName);
    if (type === "toggle") toggleBlockedApp(packageName);
    if (type === "update" && config) updateAppControl(packageName, config);

    setGuardVisible(false);
    setPendingAction(null);
    setEditingApp(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const filteredInstalledApps = installedApps.filter(
    (app) =>
      !blockedApps.some((ba) => ba.packageName === app.packageName) &&
      (app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.packageName.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const renderAppItem = ({ item }: { item: BlockedApp }): React.JSX.Element => (
    <View className="bg-freedom-surface rounded-2xl p-4 mb-3 border border-freedom-highlight/10">
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-white font-bold text-lg">{item.appName}</Text>
          <Text className="text-freedom-text-muted text-xs">
            {item.packageName}
          </Text>
        </View>
        <View className="flex-row items-center gap-x-2">
          <Pressable
            onPress={() => {
              setEditingApp(item);
            }}
            className="w-10 h-10 rounded-full bg-white/5 items-center justify-center"
          >
            <Ionicons name="settings-outline" size={20} color="#94A3B8" />
          </Pressable>
          <Pressable
            onPress={() => {
              performActionWithGuard("toggle", item.packageName);
            }}
            className={`w-12 h-6 rounded-full px-1 justify-center ${
              item.enabled ? "bg-freedom-highlight" : "bg-gray-700"
            }`}
          >
            <View
              className={`w-4 h-4 rounded-full bg-white ${
                item.enabled ? "self-end" : "self-start"
              }`}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              performActionWithGuard("remove", item.packageName);
            }}
            className="w-10 h-10 rounded-full bg-freedom-accent/10 items-center justify-center"
          >
            <Ionicons name="trash-outline" size={20} color="#e94560" />
          </Pressable>
        </View>
      </View>

      {item.enabled && (
        <View className="mt-3 pt-3 border-t border-white/5 flex-row items-center">
          <Ionicons
            name={
              item.surveillance.type === "none"
                ? "shield-outline"
                : "timer-outline"
            }
            size={14}
            color="#2DD4BF"
          />
          <Text className="text-freedom-highlight text-xs ml-1 font-medium">
            {item.surveillance.type === "none"
              ? "Always Blocked"
              : `${item.surveillance.type.toUpperCase()}: ${item.surveillance.value}${item.surveillance.type === "timer" ? "s" : ""}`}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-freedom-primary">
      <View className="flex-1 px-6 pt-4">
        <View className="flex-row items-center justify-between mb-6">
          <View>
            <Text className="text-3xl font-bold text-white">Blocked Apps</Text>
            <Text className="text-freedom-text-muted">
              Control your app usage
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setIsAddModalVisible(true);
            }}
            className="w-12 h-12 rounded-full bg-freedom-highlight items-center justify-center shadow-lg"
          >
            <Ionicons name="add" size={32} color="white" />
          </Pressable>
        </View>

        {blockedApps.length === 0 ? (
          <View className="flex-1 items-center justify-center opacity-40">
            <Ionicons name="apps-outline" size={80} color="#94A3B8" />
            <Text className="text-freedom-text-muted mt-4 text-center">
              No apps blocked yet.{"\n"}Tap the + button to add one.
            </Text>
          </View>
        ) : (
          <FlatList
            data={blockedApps}
            keyExtractor={(item) => item.packageName}
            renderItem={renderAppItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 100 }}
          />
        )}
      </View>

      {/* Add App Modal */}
      <Modal visible={isAddModalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 pt-20">
          <View className="flex-1 bg-freedom-primary rounded-t-[40px] p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-2xl font-bold text-white">Select App</Text>
              <Pressable
                onPress={() => {
                  setIsAddModalVisible(false);
                }}
                className="w-10 h-10 rounded-full bg-white/5 items-center justify-center"
              >
                <Ionicons name="close" size={24} color="white" />
              </Pressable>
            </View>

            <View className="bg-freedom-surface rounded-2xl flex-row items-center px-4 mb-6 border border-freedom-highlight/10">
              <Ionicons name="search" size={20} color="#94A3B8" />
              <TextInput
                placeholder="Search apps..."
                placeholderTextColor="#64748B"
                className="flex-1 h-12 ml-2 text-white"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {isLoadingApps ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#2DD4BF" />
              </View>
            ) : (
              <FlatList
                data={filteredInstalledApps}
                keyExtractor={(item) => item.packageName}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      handleAddApp(item);
                    }}
                    className="flex-row items-center p-4 mb-2 bg-freedom-surface rounded-xl border border-white/5"
                  >
                    <View className="w-10 h-10 rounded-lg bg-freedom-highlight/10 items-center justify-center mr-4">
                      <Ionicons name="cube-outline" size={24} color="#2DD4BF" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-bold">{item.name}</Text>
                      <Text className="text-freedom-text-muted text-xs">
                        {item.packageName}
                      </Text>
                    </View>
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Edit Control Modal */}
      <Modal visible={editingApp !== null} animationType="fade" transparent>
        <View className="flex-1 bg-black/80 items-center justify-center px-6">
          <View className="bg-freedom-surface w-full rounded-3xl p-6 border border-freedom-highlight/20">
            <Text className="text-xl font-bold text-white mb-2">
              Control: {editingApp?.appName}
            </Text>
            <Text className="text-freedom-text-muted mb-6">
              Set a bypass method for this app
            </Text>

            <ScrollView className="max-h-80">
              {(["none", "timer", "click"] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => {
                    setEditingApp((prev) =>
                      prev
                        ? {
                            ...prev,
                            surveillance: { ...prev.surveillance, type },
                          }
                        : null,
                    );
                  }}
                  className={`p-4 rounded-xl mb-3 border ${
                    editingApp?.surveillance.type === type
                      ? "bg-freedom-highlight/20 border-freedom-highlight"
                      : "bg-white/5 border-transparent"
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white font-bold capitalize">
                      {type === "none" ? "Hard Block (No Bypass)" : type}
                    </Text>
                    {editingApp?.surveillance.type === type && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color="#2DD4BF"
                      />
                    )}
                  </View>
                </Pressable>
              ))}

              {editingApp?.surveillance.type !== "none" && (
                <View className="mt-4">
                  <Text className="text-white mb-2 font-medium">
                    {editingApp?.surveillance.type === "timer"
                      ? "Seconds"
                      : "Click Count"}
                  </Text>
                  <View className="flex-row items-center gap-x-4">
                    <Pressable
                      onPress={() => {
                        setEditingApp((prev) =>
                          prev
                            ? {
                                ...prev,
                                surveillance: {
                                  ...prev.surveillance,
                                  value: Math.max(
                                    1,
                                    prev.surveillance.value - 5,
                                  ),
                                },
                              }
                            : null,
                        );
                      }}
                      className="w-12 h-12 rounded-xl bg-white/5 items-center justify-center"
                    >
                      <Ionicons name="remove" size={24} color="white" />
                    </Pressable>
                    <Text className="text-white text-2xl font-bold">
                      {editingApp?.surveillance.value}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setEditingApp((prev) =>
                          prev
                            ? {
                                ...prev,
                                surveillance: {
                                  ...prev.surveillance,
                                  value: prev.surveillance.value + 5,
                                },
                              }
                            : null,
                        );
                      }}
                      className="w-12 h-12 rounded-xl bg-white/5 items-center justify-center"
                    >
                      <Ionicons name="add" size={24} color="white" />
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>

            <View className="flex-row gap-x-3 mt-8">
              <Pressable
                onPress={() => {
                  setEditingApp(null);
                }}
                className="flex-1 py-4 rounded-xl items-center bg-white/5"
              >
                <Text className="text-white font-bold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (editingApp) {
                    performActionWithGuard(
                      "update",
                      editingApp.packageName,
                      editingApp,
                    );
                  }
                }}
                className="flex-1 py-4 rounded-xl items-center bg-freedom-highlight"
              >
                <Text className="text-white font-bold">Save Changes</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <InteractionGuard
        visible={guardVisible}
        onSuccess={() => {
          if (pendingAction) {
            executeAction(
              pendingAction.type,
              pendingAction.packageName,
              pendingAction.config,
            );
          }
        }}
        onCancel={() => {
          setGuardVisible(false);
          setPendingAction(null);
        }}
        actionName={
          pendingAction?.type === "remove"
            ? "Delete App Block"
            : "Modify App Settings"
        }
      />
    </SafeAreaView>
  );
}
