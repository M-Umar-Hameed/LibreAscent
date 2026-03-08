import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen(): ReactNode {
  // Entrance animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, scaleAnim]);

  const features = [
    {
      icon: "globe-outline",
      text: "Blocks adult websites across all browsers",
    },
    {
      icon: "videocam-outline",
      text: "Blocks reels and short-form content",
    },
    {
      icon: "lock-closed-outline",
      text: "Persistent protection that cannot be easily bypassed",
    },
    {
      icon: "shield-checkmark-outline",
      text: "Works fully offline — no data leaves your device",
    },
  ] as const;

  return (
    <SafeAreaView className="flex-1 bg-freedom-primary">
      <Animated.View
        className="flex-1 justify-center items-center px-8"
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }}
      >
        {/* Logo (Glowing Bird Placeholder / Shield) */}
        <Animated.View
          className="w-32 h-32 rounded-full bg-freedom-accent/15 items-center justify-center mb-8 border border-freedom-accent/30 shadow-2xl shadow-freedom-accent/40"
          style={{ transform: [{ scale: scaleAnim }] }}
        >
          <View className="absolute inset-0 rounded-full bg-freedom-accent/5" />
          <Ionicons name="shield-checkmark" size={60} color="#2DD4BF" />
        </Animated.View>

        {/* Title */}
        <Text className="text-4xl font-bold text-white text-center mb-3">
          Freedom
        </Text>
        <Text className="text-lg text-freedom-highlight text-center mb-2 font-medium">
          Break free from addiction
        </Text>
        <Text className="text-freedom-text-muted text-center mb-10 leading-6">
          Freedom protects you by blocking harmful content across all browsers
          and apps on your device.
        </Text>

        {/* Features */}
        <View className="w-full gap-5 mb-12">
          {features.map((feature, index) => (
            <Animated.View
              key={index}
              className="flex-row items-center"
              style={{
                opacity: fadeAnim,
                transform: [
                  {
                    translateX: slideAnim.interpolate({
                      inputRange: [0, 30],
                      outputRange: [0, 20 * (index + 1)],
                    }),
                  },
                ],
              }}
            >
              <View className="w-10 h-10 rounded-xl bg-freedom-surface/50 border border-freedom-accent/10 items-center justify-center mr-4">
                <Ionicons
                  name={feature.icon as ComponentProps<typeof Ionicons>["name"]}
                  size={20}
                  color="#2DD4BF"
                />
              </View>
              <Text className="text-white flex-1 text-base leading-6">
                {feature.text}
              </Text>
            </Animated.View>
          ))}
        </View>

        {/* Get Started Button */}
        <Pressable
          onPress={() => {
            router.push("/(onboarding)/permissions");
          }}
          className="bg-freedom-accent w-full py-4 rounded-2xl items-center active:opacity-90 shadow-lg shadow-freedom-accent/20"
          style={{ minHeight: 58 }}
        >
          <Text className="text-freedom-primary text-xl font-black tracking-tight">
            GET STARTED
          </Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}
