import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import * as Font from 'expo-font';
import { Feather } from '@expo/vector-icons';
import { AuthProvider, useAuth } from '../lib/auth';
import { FamilyProvider } from '../lib/family-context';
import { PreferencesProvider } from '../lib/preferences';
import { EnvBadge } from '../components/env-badge';
import { AppLockProvider } from '../lib/app-lock';
import { AppLockScreen } from '../components/app-lock-screen';

function AuthGate() {
  const { session, loading: authLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    const seg = segments[0] as string | undefined;
    // A shared document (036) is for anyone with the link, signed in or not:
    // neither sent to sign in nor sent Home.
    if (seg === 's') return;
    // A route missing here sends a signed-in person to /home — which, for
    // gmail-import, would throw away the code Google just sent back.
    const inProtectedRoute = seg === '(tabs)' || seg === 'document' || seg === 'family' || seg === 'settings' || seg === 'setup-family' || seg === 'notifications' || seg === 'gmail-import' || seg === 'reminders' || seg === 'saved-chats' || seg === 'family-tree' || seg === 'person' || seg === 'emergency' || seg === 'plus';

    if (!session && inProtectedRoute) {
      router.replace('/login' as any);
    } else if (session && !inProtectedRoute && seg !== undefined) {
      router.replace('/home' as any);
    }
  }, [session, authLoading, segments]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    Feather.loadFont()
      .then(() => setFontsLoaded(true))
      .catch(() => setFontsLoaded(true));
  }, []);

  // Web: what makes AskLocker installable (public/manifest.json) — an
  // iPhone shows notifications only to a web app added to its Home Screen
  // (034). Added here because the single-page export never uses +html.tsx.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const add = (tag: 'link' | 'meta', attrs: Record<string, string>) => {
      const selector = tag === 'link' ? `link[rel="${attrs.rel}"]` : `meta[name="${attrs.name}"]`;
      if (document.head.querySelector(selector)) return;
      const el = document.createElement(tag);
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
      document.head.appendChild(el);
    };
    add('link', { rel: 'manifest', href: '/manifest.json' });
    add('link', { rel: 'apple-touch-icon', href: '/icon-192.png' });
    add('meta', { name: 'theme-color', content: '#2A3D66' });
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#2A3D66" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <AppLockProvider>
      <PreferencesProvider>
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
          <Stack.Screen name="notifications" />
          <Stack.Screen name="gmail-import" />
          <Stack.Screen name="reminders" />
          <Stack.Screen name="saved-chats" />
          <Stack.Screen name="family-tree" />
          <Stack.Screen name="person/[id]" />
        </Stack>
        {/* After the Stack, so it draws over every screen. Renders nothing
            in production. */}
        <EnvBadge />
        {/* The fingerprint or face lock, over everything when it is up. */}
        <AppLockScreen />
      </FamilyProvider>
      </PreferencesProvider>
      </AppLockProvider>
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
