import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BlockOverlayScreen(): ReactNode {
  return (
    <SafeAreaView className="flex-1 bg-freedom-primary">
      <View className="flex-1 justify-center items-center px-8">
        {/* Shield Icon */}
        <View className="w-32 h-32 rounded-full bg-freedom-accent/15 items-center justify-center mb-10 border border-freedom-accent/30 shadow-2xl shadow-freedom-accent/40">
          <Ionicons name="shield-checkmark-outline" size={70} color="#2DD4BF" />
        </View>

        {/* Stay Away Message */}
        <Text className="text-4xl font-bold text-white text-center mb-4">
          Stay Away
        </Text>
        <Text className="text-lg text-freedom-text-muted text-center mb-8">
          This content has been blocked by Freedom
        </Text>

        {/* Motivational Message */}
        <View className="bg-freedom-surface rounded-2xl p-6 w-full">
          <Text className="text-white text-center text-lg">
            &quot;Every moment of resistance is a victory. You are stronger than
            your urges.&quot;
          </Text>
        </View>

        {/* Info */}
        <Text className="text-freedom-text-muted text-center mt-8 text-sm">
          Navigate away from this content to dismiss this screen
        </Text>
      </View>
    </SafeAreaView>
  );
}
