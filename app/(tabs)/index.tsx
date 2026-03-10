import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DashboardScreen(): ReactNode {
  const stats = useAppStore((state) => state.stats);
  const { controlMode, schedule } = useAppStore();
  const keywordsCount = useBlockingStore((state) => state.keywords.length);
  const domainsBlockedCount = useBlockingStore(
    (state) => state.includedUrls.length,
  );

  const isScheduled = ProtectionService.isProtectionEnabledBySchedule();
  const hasSchedule = schedule.length > 0;

  const modeInfo = {
    flexible: { label: "Flexible", color: "#2DD4BF", icon: "leaf" as const },
    locked: { label: "Locked", color: "#F59E0B", icon: "lock-closed" as const },
    hardcore: {
      label: "Hardcore",
      color: "#EF4444",
      icon: "shield-sharp" as const,
    },
  }[controlMode];

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-freedom-primary"
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text className="text-3xl font-bold text-black dark:text-white text-center mb-2 tracking-tighter leading-tight">
          Freedom
        </Text>
        <Text className="text-freedom-text-muted-bright text-center mb-10 tracking-tight max-w-[280px] self-center">
          Your shield against addiction
        </Text>

        {/* Protection Status */}
        <View className="bg-freedom-secondary/30 dark:bg-freedom-surface border border-freedom-accent/10 rounded-3xl p-6 items-center mb-6 shadow-lg shadow-freedom-accent/20">
          <View
            className="w-24 h-24 rounded-full items-center justify-center mb-4 border border-freedom-accent/20 shadow-md shadow-freedom-accent/30"
            style={{ backgroundColor: modeInfo.color + "15" }}
          >
            <Ionicons
              name={modeInfo.icon as ComponentProps<typeof Ionicons>["name"]}
              size={40}
              color={modeInfo.color}
            />
          </View>
          <Text
            className="text-2xl font-black text-center tracking-tighter leading-tight"
            style={{ color: isScheduled ? "#2DD4BF" : "#94A3B8" }}
          >
            {isScheduled ? "Protection Active" : "Protection Paused"}
          </Text>
          <View className="flex-row items-center mt-3 bg-white/50 dark:bg-black/20 px-3 py-1 rounded-full">
            <View
              className="w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: modeInfo.color }}
            />
            <Text className="text-freedom-text-muted text-[10px] font-bold uppercase tracking-widest">
              {modeInfo.label} Mode
            </Text>
          </View>
          {hasSchedule && (
            <Text className="text-freedom-text-muted mt-2 text-xs">
              {isScheduled ? "Within scheduled time" : "Outside scheduled time"}
            </Text>
          )}
        </View>

        {/* Stats Row */}
        <View className="flex-row gap-3 mb-6">
          <View
            aria-label="Days clean"
            className="flex-1 bg-gray-100 dark:bg-freedom-surface rounded-2xl p-4 shadow-sm"
          >
            <Text className="text-freedom-text-muted text-xs font-semibold uppercase tracking-wider mb-1">
              Days Clean
            </Text>
            <Text className="text-3xl font-bold text-black dark:text-white">
              {stats.daysClean}
            </Text>
          </View>
          <View
            aria-label="Blocked today"
            className="flex-1 bg-gray-100 dark:bg-freedom-surface rounded-2xl p-4 shadow-sm"
          >
            <Text className="text-freedom-text-muted text-xs font-semibold uppercase tracking-wider mb-1">
              Today
            </Text>
            <Text className="text-3xl font-bold text-black dark:text-white">
              {stats.blockedToday}
            </Text>
          </View>
          <View
            aria-label="Total blocked"
            className="flex-1 bg-gray-100 dark:bg-freedom-surface rounded-2xl p-4 shadow-sm"
          >
            <Text className="text-freedom-text-muted text-xs font-semibold uppercase tracking-wider mb-1">
              Total
            </Text>
            <Text className="text-3xl font-bold text-black dark:text-white">
              {stats.totalBlocked}
            </Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View className="bg-gray-100 dark:bg-freedom-surface rounded-xl p-4 mb-6">
          <Text className="text-lg font-semibold text-black dark:text-white mb-3">
            Protection Summary
          </Text>
          <View className="flex-row justify-between mb-2">
            <Text className="text-freedom-text-muted">Keywords Active</Text>
            <Text className="text-black dark:text-white">{keywordsCount}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-freedom-text-muted">Domains Blocked</Text>
            <Text className="text-black dark:text-white">
              {domainsBlockedCount}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
