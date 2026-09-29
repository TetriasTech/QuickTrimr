import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="ui-primitives"
        options={{ headerShown: true, title: 'UI primitives' }}
      />
    </Stack>
  );
}
