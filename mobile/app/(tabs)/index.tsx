import { useAppTheme } from "@/providers/ThemeProvider";
import { ProtectionService } from "@/services/ProtectionService";
import { useAppStore } from "@/stores/useAppStore";
import { useBlockingStore } from "@/stores/useBlockingStore";
import * as FreedomAccessibility from "@/modules/freedom-accessibility-service/src";
import * as FreedomVpn from "@/modules/freedom-vpn-service/src";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function describeProblem(code: string): {
  message: string;
  open: () => Promise<void>;
} {
  if (code === "accessibility_off") {
    return {
      message: "Content protection is off: accessibility service is disabled",
      open: FreedomAccessibility.openAccessibilitySettings,
    };
  }
  if (code.startsWith("vpn_taken:")) {
    const pkg = code.slice("vpn_taken:".length);
    return {
      message: `DNS protection is off: ${pkg ? `${pkg} is set as the always-on VPN` : "another VPN app holds the VPN slot"}`,
      open: FreedomVpn.openVpnSettings,
    };
  }
  return {
    message: "DNS protection is off: the LibreAscent VPN is not running",
    open: FreedomVpn.openVpnSettings,
  };
}

export default function DashboardScreen(): ReactNode {
  const t = useAppTheme();
  const stats = useAppStore((state) => state.stats);
  const { controlMode, protection, protectionProblems, schedule } =
    useAppStore();
  const keywordsCount = useBlockingStore((state) => state.keywords.length);
  const domainsBlockedCount = useBlockingStore(
    (state) => state.includedUrls.length,
  );

  const isScheduled = ProtectionService.isProtectionEnabledBySchedule();
  const hasSchedule = schedule.length > 0;
  const coreProtectionActive =
    protection.vpn && protection.accessibility && protection.foregroundService;
  const isProtectionActive = isScheduled && coreProtectionActive;
  const statusLabel = !isScheduled
    ? "Protection Paused"
    : isProtectionActive
      ? "Protection Active"
      : "Protection Needs Setup";

  const modeInfo = {
    flexible: {
      label: "Flexible",
      color: t.accentColor,
      icon: "leaf" as const,
    },
    locked: {
      label: "Locked",
      color: t.warningColor,
      icon: "lock-closed" as const,
    },
    hardcore: {
      label: "Hardcore",
      color: t.dangerColor,
      icon: "shield-sharp" as const,
    },
  }[controlMode];

  const cardStyle = {
    backgroundColor: t.accentColor + "0D",
    borderWidth: 1,
    borderColor: t.accentColor + "20",
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: t.bgColor }}
      edges={["top"]}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text
          className="text-3xl font-bold text-center mb-2 tracking-tighter leading-tight"
          style={{ color: t.textColor }}
        >
          LibreAscent
        </Text>
        <Text
          className="text-center mb-10 tracking-tight max-w-[280px] self-center"
          style={{ color: t.mutedTextColor }}
        >
          Your shield against addiction
        </Text>

        {protectionProblems.length > 0 && (
          <View
            className="rounded-2xl p-4 mb-6"
            style={{
              backgroundColor: t.dangerColor + "1A",
              borderWidth: 1,
              borderColor: t.dangerColor + "40",
            }}
          >
            {protectionProblems.map((code) => {
              const { message, open } = describeProblem(code);
              return (
                <View key={code} className="mb-2">
                  <Text style={{ color: t.dangerColor }}>{message}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void open()}
                    className="self-start mt-1 px-3 py-1 rounded-full"
                    style={{ backgroundColor: t.dangerColor }}
                  >
                    <Text
                      className="text-xs font-bold"
                      style={{ color: "#fff" }}
                    >
                      Open settings
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* Protection Status */}
        <View className="rounded-3xl p-6 items-center mb-6" style={cardStyle}>
          <View
            className="w-24 h-24 rounded-full items-center justify-center mb-4"
            style={{
              backgroundColor: modeInfo.color + "15",
              borderWidth: 1,
              borderColor: t.accentColor + "20",
            }}
          >
            <Ionicons
              name={modeInfo.icon as ComponentProps<typeof Ionicons>["name"]}
              size={40}
              color={modeInfo.color}
            />
          </View>
          <Text
            className="text-2xl font-black text-center tracking-tighter leading-tight"
            style={{
              color: isProtectionActive
                ? t.accentColor
                : !isScheduled
                  ? t.mutedTextColor
                  : t.warningColor,
            }}
          >
            {statusLabel}
          </Text>
          <View
            className="flex-row items-center mt-3 px-3 py-1 rounded-full"
            style={{ backgroundColor: t.bgColor + "80" }}
          >
            <View
              className="w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: modeInfo.color }}
            />
            <Text
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: t.mutedTextColor }}
            >
              {modeInfo.label} Mode
            </Text>
          </View>
          {hasSchedule && (
            <Text className="mt-2 text-xs" style={{ color: t.mutedTextColor }}>
              {isScheduled ? "Within scheduled time" : "Outside scheduled time"}
            </Text>
          )}
          {isScheduled && !coreProtectionActive && (
            <Text className="mt-2 text-xs" style={{ color: t.warningColor }}>
              VPN, Accessibility, and foreground service must all be active.
            </Text>
          )}
        </View>

        {/* Stats Row */}
        <View className="flex-row gap-3 mb-6">
          <View
            aria-label="Days clean"
            className="flex-1 rounded-2xl p-4"
            style={{ backgroundColor: t.cardBgColor }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-1"
              style={{ color: t.mutedTextColor }}
            >
              Days Clean
            </Text>
            <Text className="text-3xl font-bold" style={{ color: t.textColor }}>
              {stats.daysClean}
            </Text>
          </View>
          <View
            aria-label="Blocked today"
            className="flex-1 rounded-2xl p-4"
            style={{ backgroundColor: t.cardBgColor }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-1"
              style={{ color: t.mutedTextColor }}
            >
              Today
            </Text>
            <Text className="text-3xl font-bold" style={{ color: t.textColor }}>
              {stats.blockedToday}
            </Text>
          </View>
          <View
            aria-label="Total blocked"
            className="flex-1 rounded-2xl p-4"
            style={{ backgroundColor: t.cardBgColor }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-1"
              style={{ color: t.mutedTextColor }}
            >
              Total
            </Text>
            <Text className="text-3xl font-bold" style={{ color: t.textColor }}>
              {stats.totalBlocked}
            </Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: t.cardBgColor }}
        >
          <Text
            className="text-lg font-semibold mb-3"
            style={{ color: t.textColor }}
          >
            Protection Summary
          </Text>
          <View className="flex-row justify-between mb-2">
            <Text style={{ color: t.mutedTextColor }}>Keywords Active</Text>
            <Text style={{ color: t.textColor }}>{keywordsCount}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text style={{ color: t.mutedTextColor }}>Domains Blocked</Text>
            <Text style={{ color: t.textColor }}>{domainsBlockedCount}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
