import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable } from "react-native";

export default function TabLayout(): ReactNode {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2DD4BF",
        tabBarInactiveTintColor: "#94A3B8",
        freezeOnBlur: true,
        tabBarStyle: {
          backgroundColor: "#0B1215",
          borderTopColor: "#1A2421",
          height: Platform.OS === "ios" ? 88 : 65,
          paddingBottom: Platform.OS === "ios" ? 30 : 10,
          borderTopWidth: 0,
          elevation: 0,
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
        },
        tabBarButton: ({
          ref: _ref,
          ...props
        }: BottomTabBarButtonProps): ReactNode => (
          <Pressable
            {...props}
            onPress={(e) => {
              void Haptics.selectionAsync();
              props.onPress?.(e);
            }}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="block-keywords"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="block-websites"
        options={{
          title: "Content",
          tabBarIcon: ({ color }) => (
            <Ionicons name="globe-outline" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="block-adult"
        options={{
          title: "Safe",
          tabBarIcon: ({ color }) => (
            <Ionicons name="shield-checkmark-outline" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="block-apps"
        options={{
          title: "Apps",
          tabBarIcon: ({ color }) => (
            <Ionicons name="apps-outline" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Ionicons name="options-outline" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
