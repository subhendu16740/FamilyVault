import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../lib/auth';
import { FamilyProvider, useFamily } from '../lib/family-context';

function AuthGate() {
  const { session, loading: authLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    const seg = segments[0] as string | undefined;
    const inProtectedRoute = seg === '(tabs)' || seg === 'document' || seg === 'family' || seg === 'settings' || seg === 'setup-family';
    const inAuthRoute = seg === 'login' || seg === 'onboarding';

    if (!session && inProtectedRoute) {
      router.replace('/login' as any);
    } else if (session && !inProtectedRoute && seg !== undefined) {
      router.replace('/home' as any);
    }
  }, [session, authLoading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <FamilyProvider>
        <AuthGate />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
          <Stack.Screen name="setup-family" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="family" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="document/[id]" />
        </Stack>
      </FamilyProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FC',
  },
});
