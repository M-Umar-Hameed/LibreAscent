import { BlocklistService } from "@/services/BlocklistService";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function UpdateSourcesScreen(): React.ReactNode {
  const router = useRouter();
  const { sources, addSource, removeSource, toggleSource } = useBlockingStore();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newFormat, setNewFormat] = useState<"domains" | "hosts" | "keywords">(
    "domains",
  );

  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({
    current: 0,
    total: 0,
    name: "",
  });

  const handleAddSource = (): void => {
    if (!newName || !newUrl) {
      Alert.alert("Error", "Please fill in both name and URL.");
      return;
    }
    if (!newUrl.startsWith("http")) {
      Alert.alert("Error", "URL must start with http:// or https://");
      return;
    }

    addSource({
      name: newName,
      url: newUrl,
      format: newFormat,
      enabled: true,
    });
    setNewName("");
    setNewUrl("");
    setIsAdding(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleUpdateAll = async (): Promise<void> => {
    const enabledCount = sources.filter((s) => s.enabled).length;
    if (enabledCount === 0) {
      Alert.alert("Error", "No enabled sources to update.");
      return;
    }

    setIsUpdating(true);
    const success = await BlocklistService.updateBlocklists(
      (current, total, name) => {
        setUpdateProgress({ current, total, name });
      },
    );
    setIsUpdating(false);

    if (success) {
      Alert.alert("Success", "All sources updated and synced.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert(
        "Error",
        "Failed to update some sources. Check your connection.",
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-freedom-primary">
      {/* Header */}
      <View className="flex-row items-center px-4 py-2 border-b border-gray-100 dark:border-freedom-secondary">
        <Pressable
          onPress={() => {
            router.back();
          }}
          className="p-2 -ml-2"
        >
          <Ionicons name="chevron-back" size={24} color="#2DD4BF" />
        </Pressable>
        <Text className="text-xl font-bold text-black dark:text-white ml-2">
          Update Sources
        </Text>
        <View className="flex-1" />
        <Pressable
          onPress={() => {
            setIsAdding(true);
          }}
          className="bg-freedom-accent/10 p-2 rounded-full"
        >
          <Ionicons name="add" size={24} color="#2DD4BF" />
        </Pressable>
      </View>

      <View className="flex-1 p-4">
        <Text className="text-freedom-text-muted mb-4">
          Manage blocklist URLs. Enabled sources will be fetched and synced when
          you tap &quot;Update &amp; Sync&quot;.
        </Text>

        <FlatList
          data={sources}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View className="bg-gray-100 dark:bg-freedom-surface p-4 rounded-xl mb-3 flex-row items-center">
              <View className="flex-1">
                <Text className="text-black dark:text-white font-semibold">
                  {item.name}
                </Text>
                <Text
                  className="text-freedom-text-muted text-xs mt-1"
                  numberOfLines={1}
                >
                  {item.url}
                </Text>
                <View className="flex-row mt-2">
                  <View className="bg-freedom-accent/20 px-2 py-0.5 rounded">
                    <Text className="text-freedom-accent text-[10px] uppercase font-bold">
                      {item.format}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="flex-row items-center ml-2">
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    toggleSource(item.id);
                  }}
                  className="p-2"
                >
                  <Ionicons
                    name={item.enabled ? "eye" : "eye-off"}
                    size={20}
                    color={item.enabled ? "#2DD4BF" : "#94A3B8"}
                  />
                </Pressable>
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Medium,
                    );
                    removeSource(item.id);
                  }}
                  className="p-2"
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </Pressable>
              </View>
            </View>
          )}
        />
      </View>

      <View className="p-4 border-t border-gray-100 dark:border-freedom-secondary">
        <Pressable
          onPress={() => {
            void handleUpdateAll();
          }}
          disabled={isUpdating}
          className="bg-freedom-accent p-4 rounded-xl flex-row justify-center items-center"
        >
          {isUpdating ? (
            <ActivityIndicator color="#0B1215" size="small" className="mr-2" />
          ) : (
            <Ionicons
              name="refresh"
              size={20}
              color="#0B1215"
              className="mr-2"
            />
          )}
          <Text className="text-freedom-primary font-bold text-center">
            {isUpdating ? "Updating..." : "Update & Sync All"}
          </Text>
        </Pressable>
      </View>

      {/* Add Source Modal */}
      <Modal visible={isAdding} animationType="fade" transparent>
        <View className="flex-1 bg-black/50 justify-center p-6">
          <View className="bg-white dark:bg-freedom-surface p-6 rounded-2xl">
            <Text className="text-xl font-bold text-black dark:text-white mb-4">
              Add New Source
            </Text>

            <Text className="text-freedom-text-muted mb-1 text-sm">
              Source Name
            </Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. My Blocklist"
              placeholderTextColor="#94A3B8"
              className="bg-gray-100 dark:bg-freedom-secondary p-3 rounded-lg text-black dark:text-white mb-4"
            />

            <Text className="text-freedom-text-muted mb-1 text-sm">
              URL (Text file)
            </Text>
            <TextInput
              value={newUrl}
              onChangeText={setNewUrl}
              placeholder="https://example.com/blocklist.txt"
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              keyboardType="url"
              className="bg-gray-100 dark:bg-freedom-secondary p-3 rounded-lg text-black dark:text-white mb-4"
            />

            <Text className="text-freedom-text-muted mb-2 text-sm">Format</Text>
            <View className="flex-row mb-6">
              <Pressable
                onPress={() => {
                  setNewFormat("domains");
                }}
                className={`flex-1 p-3 rounded-lg mr-1 border ${newFormat === "domains" ? "bg-freedom-accent border-freedom-accent" : "border-gray-200 dark:border-freedom-secondary"}`}
              >
                <Text
                  className={`text-center font-semibold text-xs ${newFormat === "domains" ? "text-freedom-primary" : "text-freedom-text-muted"}`}
                >
                  Domains
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setNewFormat("hosts");
                }}
                className={`flex-1 p-3 rounded-lg mx-1 border ${newFormat === "hosts" ? "bg-freedom-accent border-freedom-accent" : "border-gray-200 dark:border-freedom-secondary"}`}
              >
                <Text
                  className={`text-center font-semibold text-xs ${newFormat === "hosts" ? "text-freedom-primary" : "text-freedom-text-muted"}`}
                >
                  Hosts
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setNewFormat("keywords");
                }}
                className={`flex-1 p-3 rounded-lg ml-1 border ${newFormat === "keywords" ? "bg-freedom-accent border-freedom-accent" : "border-gray-200 dark:border-freedom-secondary"}`}
              >
                <Text
                  className={`text-center font-semibold text-xs ${newFormat === "keywords" ? "text-freedom-primary" : "text-freedom-text-muted"}`}
                >
                  Keywords
                </Text>
              </Pressable>
            </View>

            <View className="flex-row">
              <Pressable
                onPress={() => {
                  setIsAdding(false);
                }}
                className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-freedom-secondary mr-2"
              >
                <Text className="text-center text-black dark:text-white">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  handleAddSource();
                }}
                className="flex-1 p-3 rounded-xl bg-freedom-accent"
              >
                <Text className="text-center text-freedom-primary font-bold">
                  Add Source
                </Text>
              </Pressable>
            </View>
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
    </SafeAreaView>
  );
}
