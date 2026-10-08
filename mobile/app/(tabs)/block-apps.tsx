import { InteractionGuard } from "@/components/InteractionGuard";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import { useAppTheme } from "@/providers/ThemeProvider";
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
import { BlocklistService } from "@/services/BlocklistService";
import { SafeAreaView } from "react-native-safe-area-context";

interface AppInfo {
  name: string;
  packageName: string;
}

function TimePickerBar({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  t: ReturnType<typeof useAppTheme>;
}): React.JSX.Element {
  const [h = "00", m = "00"] = (value || "00:00").split(":");
  const hours = Array.from({ length: 24 }, (_, i) =>
    i.toString().padStart(2, "0"),
  );
  const minutes = [
    "00",
    "05",
    "10",
    "15",
    "20",
    "25",
    "30",
    "35",
    "40",
    "45",
    "50",
    "55",
  ];

  return (
    <View
      className="mb-4 rounded-xl p-3"
      style={{
        backgroundColor: t.cardBgColor,
        borderWidth: 1,
        borderColor: t.mutedTextColor + "33",
      }}
    >
      <View className="flex-row justify-between items-center mb-3 px-1">
        <Text
          className="text-xs uppercase font-bold"
          style={{ color: t.mutedTextColor }}
        >
          {label}
        </Text>
        <Text className="font-black text-xl" style={{ color: t.textColor }}>
          {h}:{m}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-3"
      >
        {hours.map((hour) => (
          <Pressable
            key={`h-${hour}`}
            onPress={() => {
              onChange(`${hour}:${m}`);
            }}
            className="w-10 h-10 rounded-full items-center justify-center mr-2 border"
            style={{
              backgroundColor: h === hour ? t.accentColor : "transparent",
              borderColor: h === hour ? t.accentColor : t.mutedTextColor + "33",
            }}
          >
            <Text
              className="font-bold"
              style={{ color: h === hour ? t.bgColor : t.textColor }}
            >
              {hour}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {minutes.map((min) => (
          <Pressable
            key={`m-${min}`}
            onPress={() => {
              onChange(`${h}:${min}`);
            }}
            className="w-12 h-8 rounded-lg items-center justify-center mr-2 border"
            style={{
              backgroundColor: m === min ? t.accentColor : "transparent",
              borderColor: m === min ? t.accentColor : t.mutedTextColor + "33",
            }}
          >
            <Text
              className="font-bold"
              style={{ color: m === min ? t.bgColor : t.textColor }}
            >
              {min}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function BlockAppsScreen(): React.JSX.Element {
  const t = useAppTheme();
  const {
    blockedApps,
    addBlockedApp,
    removeBlockedApp,
    toggleBlockedApp,
    updateAppControl,
  } = useBlockingStore();
  const { controlMode, surveillance } = useAppStore();

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
    void BlocklistService.syncAppsToNative();
  };

  const performActionWithGuard = (
    type: "remove" | "toggle" | "update",
    packageName: string,
    config?: Partial<BlockedApp>,
  ): void => {
    // EXPO_PUBLIC_TEST_SKIP_FRICTION=1 at build time lets a test build change
    // app blocks under a permanent lockout; release builds never set it.
    if (
      controlMode === "flexible" ||
      process.env.EXPO_PUBLIC_TEST_SKIP_FRICTION === "1"
    ) {
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

    void BlocklistService.syncAppsToNative();

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
    <View
      className="rounded-2xl p-4 mb-3"
      style={{
        backgroundColor: t.cardBgColor,
        borderWidth: 1,
        borderColor: t.accentColor + "1A",
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="font-bold text-lg" style={{ color: t.textColor }}>
            {item.appName}
          </Text>
          <Text className="text-xs" style={{ color: t.mutedTextColor }}>
            {item.packageName}
          </Text>
        </View>
        <View className="flex-row items-center gap-x-2">
          <Pressable
            onPress={() => {
              setEditingApp(item);
            }}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: t.mutedTextColor + "1A" }}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={t.mutedTextColor}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              performActionWithGuard("toggle", item.packageName);
            }}
            className="w-12 h-6 rounded-full px-1 justify-center"
            style={{
              backgroundColor: item.enabled ? t.accentColor : t.cardBgColor,
            }}
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
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: t.dangerColor + "1A" }}
          >
            <Ionicons name="trash-outline" size={20} color="#e94560" />
          </Pressable>
        </View>
      </View>

      {item.enabled && (
        <View
          className="mt-3 pt-3 flex-row items-center"
          style={{ borderTopWidth: 1, borderTopColor: t.mutedTextColor + "33" }}
        >
          <Ionicons
            name={
              item.surveillance.type === "none"
                ? "shield-outline"
                : item.surveillance.type === "time"
                  ? "time-outline"
                  : "timer-outline"
            }
            size={14}
            color={t.accentColor}
          />
          <Text
            className="text-xs ml-1 font-medium"
            style={{ color: t.accentColor }}
          >
            {item.surveillance.type === "none"
              ? "Always Blocked"
              : item.surveillance.type === "time"
                ? `Scheduled: ${item.startTime || "?"} - ${item.endTime || "?"}`
                : `${item.surveillance.type.toUpperCase()}: ${item.surveillance.value}${item.surveillance.type === "timer" ? "s" : ""}`}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: t.bgColor }}>
      <View className="flex-1 px-6 pt-4">
        <View className="flex-row items-center justify-between mb-6">
          <View>
            <Text className="text-3xl font-bold" style={{ color: t.textColor }}>
              Blocked Apps
            </Text>
            <Text style={{ color: t.mutedTextColor }}>
              Control your app usage
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setIsAddModalVisible(true);
            }}
            className="w-12 h-12 rounded-full items-center justify-center shadow-lg"
            style={{ backgroundColor: t.accentColor }}
          >
            <Ionicons name="add" size={32} color="white" />
          </Pressable>
        </View>

        {blockedApps.length === 0 ? (
          <View className="flex-1 items-center justify-center opacity-40">
            <Ionicons name="apps-outline" size={80} color={t.mutedTextColor} />
            <Text
              className="mt-4 text-center"
              style={{ color: t.mutedTextColor }}
            >
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
          <View
            className="flex-1 rounded-t-[40px] p-6"
            style={{ backgroundColor: t.bgColor }}
          >
            <View className="flex-row items-center justify-between mb-6">
              <Text
                className="text-2xl font-bold"
                style={{ color: t.textColor }}
              >
                Select App
              </Text>
              <Pressable
                onPress={() => {
                  setIsAddModalVisible(false);
                }}
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: t.mutedTextColor + "1A" }}
              >
                <Ionicons name="close" size={24} color={t.textColor} />
              </Pressable>
            </View>

            <View
              className="rounded-2xl flex-row items-center px-4 mb-6"
              style={{
                backgroundColor: t.cardBgColor,
                borderWidth: 1,
                borderColor: t.accentColor + "1A",
              }}
            >
              <Ionicons name="search" size={20} color={t.mutedTextColor} />
              <TextInput
                placeholder="Search apps..."
                placeholderTextColor={t.mutedTextColor}
                className="flex-1 h-12 ml-2"
                style={{ color: t.textColor }}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {isLoadingApps ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color={t.accentColor} />
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
                    className="flex-row items-center p-4 mb-2 rounded-xl"
                    style={{
                      backgroundColor: t.cardBgColor,
                      borderWidth: 1,
                      borderColor: t.mutedTextColor + "33",
                    }}
                  >
                    <View
                      className="w-10 h-10 rounded-lg items-center justify-center mr-4"
                      style={{ backgroundColor: t.accentColor + "1A" }}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={24}
                        color={t.accentColor}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="font-bold"
                        style={{ color: t.textColor }}
                      >
                        {item.name}
                      </Text>
                      <Text
                        className="text-xs"
                        style={{ color: t.mutedTextColor }}
                      >
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
          <View
            className="w-full rounded-3xl p-6"
            style={{
              backgroundColor: t.cardBgColor,
              borderWidth: 1,
              borderColor: t.accentColor + "33",
            }}
          >
            <Text
              className="text-xl font-bold mb-2"
              style={{ color: t.textColor }}
            >
              Control: {editingApp?.appName}
            </Text>
            <Text className="mb-6" style={{ color: t.mutedTextColor }}>
              Set a bypass method for this app
            </Text>

            <ScrollView className="max-h-80">
              {(["none", "timer", "click", "time"] as const).map((type) => (
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
                  className="p-4 rounded-xl mb-3"
                  style={{
                    borderWidth: 1,
                    backgroundColor:
                      editingApp?.surveillance.type === type
                        ? t.accentColor + "33"
                        : t.mutedTextColor + "1A",
                    borderColor:
                      editingApp?.surveillance.type === type
                        ? t.accentColor
                        : "transparent",
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className="font-bold capitalize"
                      style={{ color: t.textColor }}
                    >
                      {type === "none"
                        ? "Hard Block (No Bypass)"
                        : type === "time"
                          ? "Scheduled"
                          : type}
                    </Text>
                    {editingApp?.surveillance.type === type && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={t.accentColor}
                      />
                    )}
                  </View>
                </Pressable>
              ))}

              {(editingApp?.surveillance.type === "timer" ||
                editingApp?.surveillance.type === "click") && (
                <View className="mt-4">
                  <Text
                    className="mb-2 font-medium"
                    style={{ color: t.textColor }}
                  >
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
                      className="w-12 h-12 rounded-xl items-center justify-center"
                      style={{ backgroundColor: t.mutedTextColor + "1A" }}
                    >
                      <Ionicons name="remove" size={24} color={t.textColor} />
                    </Pressable>
                    <Text
                      className="text-2xl font-bold"
                      style={{ color: t.textColor }}
                    >
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
                      className="w-12 h-12 rounded-xl items-center justify-center"
                      style={{ backgroundColor: t.mutedTextColor + "1A" }}
                    >
                      <Ionicons name="add" size={24} color={t.textColor} />
                    </Pressable>
                  </View>
                </View>
              )}

              {editingApp?.surveillance.type === "time" && (
                <View className="mt-4">
                  <Text
                    className="mb-4 text-xs"
                    style={{ color: t.mutedTextColor }}
                  >
                    Set specific hours when this app should be blocked.
                  </Text>
                  <View className="flex-col">
                    <TimePickerBar
                      label="Start Time"
                      value={editingApp?.startTime || "00:00"}
                      onChange={(text) => {
                        setEditingApp((prev) =>
                          prev ? { ...prev, startTime: text } : null,
                        );
                      }}
                      t={t}
                    />

                    <TimePickerBar
                      label="End Time"
                      value={editingApp?.endTime || "00:00"}
                      onChange={(text) => {
                        setEditingApp((prev) =>
                          prev ? { ...prev, endTime: text } : null,
                        );
                      }}
                      t={t}
                    />
                  </View>
                </View>
              )}
            </ScrollView>

            <View className="flex-row gap-x-3 mt-8">
              <Pressable
                onPress={() => {
                  setEditingApp(null);
                }}
                className="flex-1 py-4 rounded-xl items-center"
                style={{ backgroundColor: t.mutedTextColor + "1A" }}
              >
                <Text className="font-bold" style={{ color: t.textColor }}>
                  Cancel
                </Text>
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
                className="flex-1 py-4 rounded-xl items-center"
                style={{ backgroundColor: t.accentColor }}
              >
                <Text className="font-bold" style={{ color: t.textColor }}>
                  Save Changes
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <InteractionGuard
        visible={guardVisible}
        surveillanceOverride={surveillance}
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
