import type { PermissionStatus } from "@/hooks/usePermissions";
import { usePermissions } from "@/hooks/usePermissions";
import { useAppStore } from "@/stores/useAppStore";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function ProgressBar({
  granted,
  total,
}: {
  granted: number;
  total: number;
}): ReactNode {
  const progress = total > 0 ? granted / total : 0;
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(animatedWidth, {
      toValue: progress,
      useNativeDriver: false,
      tension: 50,
      friction: 9,
    }).start();
  }, [progress, animatedWidth]);

  return (
    <View className="mb-6">
      <View className="flex-row justify-between mb-2">
        <Text className="text-freedom-text-muted text-sm">
          Permissions granted
        </Text>
        <Text className="text-white text-sm font-semibold">
          {granted}/{total}
        </Text>
      </View>
      <View className="h-2 bg-freedom-secondary rounded-full overflow-hidden">
        <Animated.View
          className="h-full bg-freedom-success rounded-full"
          style={{
            width: animatedWidth.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          }}
        />
      </View>
    </View>
  );
}

function PermissionCard({
  permission,
  onPress,
  stepNumber,
}: {
  permission: PermissionStatus;
  onPress: () => void;
  stepNumber: number;
}): ReactNode {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback((): void => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback((): void => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={permission.granted ? undefined : onPress}
        onPressIn={!permission.granted ? handlePressIn : undefined}
        onPressOut={!permission.granted ? handlePressOut : undefined}
        disabled={permission.loading}
        className={`rounded-2xl p-4 mb-3 ${
          permission.granted
            ? "bg-freedom-success/10 border border-freedom-success/30"
            : "bg-freedom-surface border border-freedom-accent/20"
        }`}
        style={{ minHeight: 80 }}
      >
        <View className="flex-row items-center">
          {/* Step number / status icon */}
          <View className="w-10 h-10 items-center justify-center mr-4">
            {permission.loading ? (
              <ActivityIndicator
                color={permission.granted ? "#10B981" : "#2DD4BF"}
                size="small"
              />
            ) : permission.granted ? (
              <Ionicons name="checkmark-circle" size={32} color="#10B981" />
            ) : (
              <View className="w-8 h-8 rounded-full border-2 border-freedom-accent items-center justify-center">
                <Text className="text-freedom-accent font-bold text-sm">
                  {stepNumber}
                </Text>
              </View>
            )}
          </View>

          {/* Content */}
          <View className="flex-1">
            <View className="flex-row items-center mb-1">
              <Ionicons
                name={permission.icon as keyof typeof Ionicons.glyphMap}
                size={16}
                color={permission.granted ? "#10B981" : "#e0e0e0"}
                style={{ marginRight: 6 }}
              />
              <Text
                className={`font-semibold ${
                  permission.granted ? "text-freedom-success" : "text-white"
                }`}
              >
                {permission.title}
              </Text>
              {!permission.required && (
                <View className="ml-2 px-2 py-0.5 bg-freedom-accent/30 rounded-full">
                  <Text className="text-freedom-text-muted text-xs">
                    Optional
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-freedom-text-muted text-sm leading-5">
              {permission.description}
            </Text>
          </View>

          {/* Action indicator */}
          {!permission.granted && !permission.loading && (
            <View className="ml-2">
              <View className="bg-freedom-highlight rounded-lg px-3 py-2">
                <Text className="text-white text-xs font-semibold">Grant</Text>
              </View>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function PermissionsScreen(): ReactNode {
  const {
    permissions,
    allGranted,
    requiredGranted,
    grantedCount,
    totalCount,
    requestPermission,
  } = usePermissions();

  const completeOnboarding = useAppStore((s) => s.completeOnboarding);

  const handleContinue = useCallback((): void => {
    completeOnboarding();
    router.replace("/(tabs)");
  }, [completeOnboarding]);

  const handleRequestPermission = useCallback(
    async (permission: PermissionStatus): Promise<void> => {
      await requestPermission(permission.id);
    },
    [requestPermission],
  );

  return (
    <SafeAreaView className="flex-1 bg-freedom-primary">
      <ScrollView
        className="flex-1 px-5 pt-6"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-2">
          <Text className="text-3xl font-bold text-white mb-2">
            Setup Permissions
          </Text>
          <Text className="text-freedom-text-muted text-base leading-6">
            Freedom needs these permissions to protect you. Tap each one to
            grant access.
          </Text>
        </View>

        {/* Progress */}
        <View className="mt-4">
          <ProgressBar granted={grantedCount} total={totalCount} />
        </View>

        {/* Permission Cards */}
        <View className="mb-6">
          {permissions.map((permission, index) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              stepNumber={index + 1}
              onPress={() => handleRequestPermission(permission)}
            />
          ))}
        </View>

        {/* Privacy notice */}
        <View className="bg-freedom-secondary/60 rounded-2xl p-4 mb-6 flex-row border border-freedom-accent/10">
          <Ionicons
            name="shield-checkmark"
            size={20}
            color="#10B981"
            style={{ marginTop: 2 }}
          />
          <Text className="text-freedom-text-muted ml-3 flex-1 text-sm leading-5">
            All data stays on your device. Freedom does not collect, transmit,
            or store any browsing data. The app is fully open source.
          </Text>
        </View>

        {/* Action buttons */}
        <View className="gap-3 mb-8">
          {/* Primary: Start Protection */}
          <Pressable
            onPress={handleContinue}
            className={`w-full py-4 rounded-2xl items-center ${
              allGranted
                ? "bg-freedom-success"
                : requiredGranted
                  ? "bg-freedom-highlight"
                  : "bg-freedom-accent/60"
            }`}
          >
            <View className="flex-row items-center gap-2">
              <Ionicons
                name={allGranted ? "shield-checkmark" : "arrow-forward"}
                size={20}
                color="white"
              />
              <Text className="text-white text-lg font-semibold">
                {allGranted
                  ? "Start Full Protection"
                  : requiredGranted
                    ? "Continue with Partial Protection"
                    : "Skip for Now"}
              </Text>
            </View>
          </Pressable>

          {/* Warning if skipping */}
          {!allGranted && (
            <Text className="text-freedom-warning text-xs text-center">
              {!requiredGranted
                ? "⚠️ Core protection requires VPN, Accessibility, and Overlay permissions"
                : "⚠️ Device Admin is recommended to prevent accidental uninstallation"}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
