// Settings › Security — how you sign in, your password, and signing out of
// every device at once.

import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { changePassword, signOutEverywhere } from '../../lib/api';
import { longDate } from '../../lib/dates';
import { ScreenHeader } from '../../components/screen-header';
import {
  Card, CardTitle, Body, Muted, Field, PrimaryButton, SecondaryButton, DangerButton, Status, screenStyles,
} from '../../components/settings-ui';

const PROVIDER_NAMES: Record<string, string> = { email: 'Email and password', google: 'Google' };

export default function SecurityScreen() {
  const { user } = useAuth();
  const providers: string[] = Array.isArray(user?.app_metadata?.providers)
    ? user!.app_metadata.providers
    : user?.app_metadata?.provider ? [user.app_metadata.provider] : [];
  const hasPassword = providers.includes('email');
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at) : null;

  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const change = async () => {
    if (password.length < 8) { setStatus({ kind: 'error', text: 'Use at least 8 characters.' }); return; }
    if (password !== again) { setStatus({ kind: 'error', text: 'The two passwords are not the same.' }); return; }
    setSaving(true);
    setStatus(null);
    try {
      await changePassword(password);
      setPassword('');
      setAgain('');
      setStatus({ kind: 'ok', text: hasPassword ? 'Your password has been changed.' : 'Your password is set. You can now also sign in with your email.' });
    } catch (err: any) {
      setStatus({ kind: 'error', text: err?.message || 'Could not change the password. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const signOutAll = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOutEverywhere();
      router.replace('/login' as any);
    } catch (err: any) {
      setSignOutError(err?.message || 'Could not sign out everywhere. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Security" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body} keyboardShouldPersistTaps="handled">
        <Card>
          <CardTitle icon="log-in">How you sign in</CardTitle>
          {providers.length === 0 && <Body>{user?.email}</Body>}
          {providers.map((p) => (
            <View key={p} style={styles.line}>
              <Feather name="check-circle" size={18} color="#166534" />
              <Text style={styles.lineText}>{PROVIDER_NAMES[p] ?? p}</Text>
            </View>
          ))}
          {!!user?.email && <Muted>Account: {user.email}</Muted>}
          {lastSignIn && (
            <Muted>
              Last signed in {longDate(lastSignIn)} at {lastSignIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Muted>
          )}
        </Card>

        <Card>
          <CardTitle icon="key">{hasPassword ? 'Change your password' : 'Set a password'}</CardTitle>
          {!hasPassword && <Body>You sign in with Google. A password lets you also sign in with your email address.</Body>}
          <Field
            label="New password"
            value={password}
            onChangeText={(t) => { setPassword(t); setStatus(null); }}
            secureTextEntry
            autoComplete="new-password"
            hint="At least 8 characters."
          />
          <Field
            label="Type it again"
            value={again}
            onChangeText={(t) => { setAgain(t); setStatus(null); }}
            secureTextEntry
            autoComplete="new-password"
          />
          {status && <Status kind={status.kind}>{status.text}</Status>}
          <PrimaryButton label={hasPassword ? 'Change password' : 'Set password'} onPress={change} busy={saving} />
        </Card>

        <Card>
          <CardTitle icon="smartphone">Sign out on every device</CardTitle>
          <Body>
            Use this if you lost a phone, or signed in on someone else's computer. You will need to sign in again here too.
          </Body>
          {signOutError && <Status kind="error">{signOutError}</Status>}
          {confirmAll ? (
            <>
              <Body>Are you sure? Every phone and computer will be signed out.</Body>
              <DangerButton label="Yes, sign out everywhere" onPress={signOutAll} busy={signingOut} icon="log-out" />
              <SecondaryButton label="Cancel" onPress={() => setConfirmAll(false)} />
            </>
          ) : (
            <DangerButton label="Sign out everywhere" onPress={() => setConfirmAll(true)} icon="log-out" />
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineText: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
});
