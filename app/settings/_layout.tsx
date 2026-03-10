import { Stack } from "expo-router";
import type { ReactNode } from "react";

export default function SettingsLayout(): ReactNode {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="permissions" />
      <Stack.Screen name="control-modes" />
      <Stack.Screen name="schedule" />
      <Stack.Screen name="update-sources" />
    </Stack>
  );
}
