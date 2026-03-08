import { Stack } from "expo-router";
import type { ReactNode } from "react";

export default function OnboardingLayout(): ReactNode {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="permissions" />
    </Stack>
  );
}
