// The way in: Google. Signing in with Google the first time makes the
// account, so there is no sign-up form, no password to forget and no email to
// confirm. On the web, where it is set up, the button is Google's own;
// elsewhere it is the redirect sign-in (google-sign-in.tsx). On a device where
// someone turned fingerprint sign-in on, "Sign in with fingerprint" comes
// first (fingerprint-sign-in.tsx). Test builds — DEV and previews — also take
// an email and password, for test accounts (password-sign-in.tsx); production
// never shows that.

import { View, Text, StyleSheet, ScrollView, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignIn } from '../components/google-sign-in';
import { FingerprintSignIn } from '../components/fingerprint-sign-in';
import { PasswordSignIn } from '../components/password-sign-in';
import { isProduction } from '../lib/environment';
import { color, radius, space, type } from '../constants/design';

export default function LoginScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoSection}>
          <LinearGradient
            colors={['#2A3D66', '#4A6491']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoBox}
          >
            <Image source={require('@/assets/images/logo-mark.png')} style={styles.logoMark} accessibilityIgnoresInvertColors />
          </LinearGradient>
          <Text style={styles.logoTitle} accessibilityRole="header">AskLocker</Text>
          <Text style={styles.tagline}>Your family's documents, safe in one place.</Text>
        </View>

        <FingerprintSignIn onSignedIn={() => router.replace('/home' as any)} />
        <Text style={styles.lead}>Sign in with your Google account.</Text>
        <GoogleSignIn onSignedIn={() => router.replace('/home' as any)} />
        <Text style={styles.note}>
          New to AskLocker? The same button makes your account. There is no password to remember.
        </Text>

        {!isProduction && <PasswordSignIn onSignedIn={() => router.replace('/home' as any)} />}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
    boxShadow: '0px 2px 8px rgba(42, 61, 102, 0.25)',
    elevation: 4,
  },
  logoMark: { width: 44, height: 44 },
  logoTitle: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: color.primary },
  tagline: { ...type.caption, marginTop: space.xs, textAlign: 'center' },
  lead: { ...type.body, textAlign: 'center', marginBottom: space.lg },
  note: { ...type.caption, textAlign: 'center' },
});
