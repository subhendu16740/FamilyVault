// Settings › Security — how you sign in (Google), fingerprint sign-in on
// this device, signing out of every device at once, and deleting your account.

import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { signOutEverywhere } from '../../lib/api';
import { longDate } from '../../lib/dates';
import { isProduction } from '../../lib/environment';
import { lockAfterText, lockUnavailableText, useAppLock } from '../../lib/app-lock';
import { ScreenHeader } from '../../components/screen-header';
import {
  Card, CardTitle, Body, Muted, OnOff, SecondaryButton, DangerButton, Status, screenStyles,
} from '../../components/settings-ui';
import { space, type } from '../../constants/design';

const PROVIDER_NAMES: Record<string, string> = { email: 'Email and password', google: 'Google' };

export default function SecurityScreen() {
  const { user } = useAuth();
  const providers: string[] = Array.isArray(user?.app_metadata?.providers)
    ? user!.app_metadata.providers
    : user?.app_metadata?.provider ? [user.app_metadata.provider] : [];
  // An account made with email and password before sign-in became Google
  // only. Test builds still take passwords (password-sign-in.tsx).
  const noGoogle = isProduction && providers.length > 0 && !providers.includes('google');
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at) : null;

  const lock = useAppLock();
  const [lockBusy, setLockBusy] = useState(false);
  const [lockStatus, setLockStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const setLock = async (on: boolean) => {
    if (on === lock.enabled || lockBusy) return;
    setLockBusy(true);
    setLockStatus(null);
    try {
      if (on) {
        await lock.turnOn();
        setLockStatus({ kind: 'ok', text: 'Fingerprint sign-in is on. Next time, use your fingerprint or face to sign in.' });
      } else {
        await lock.turnOff();
        setLockStatus({ kind: 'ok', text: 'Fingerprint sign-in is off on this device.' });
      }
    } catch (err: any) {
      setLockStatus({ kind: 'error', text: err?.message || "That didn't work. Please try again." });
    } finally {
      setLockBusy(false);
    }
  };

  const signOutAll = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOutEverywhere();
      router.replace('/login' as any);
    } catch (err: any) {
      setSignOutError(err?.message || "Couldn't sign out everywhere. Please try again.");
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
              <Feather name="check-circle" size={16} color="#166534" />
              <Text style={styles.lineText}>{PROVIDER_NAMES[p] ?? p}</Text>
            </View>
          ))}
          {!!user?.email && <Muted>Account: {user.email}</Muted>}
          {lastSignIn && (
            <Muted>
              Last signed in {longDate(lastSignIn)} at {lastSignIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Muted>
          )}
          {noGoogle && (
            <Body>
              AskLocker now uses Google to sign in. Next time, tap Continue with Google and choose {user?.email}.
              You'll get this same account, with everything in it.
            </Body>
          )}
        </Card>

        {/* On the web always, so the lock is never simply missing: where this
            device cannot use it, the card says why and what to do. */}
        {Platform.OS === 'web' && lock.support !== null && (
          <Card>
            <CardTitle icon="aperture">Fingerprint sign-in</CardTitle>
            {lock.supported ? (
              <>
                <Body>
                  Sign in with your fingerprint, face or device PIN. AskLocker also locks when it opens and after
                  {lockAfterText} away. Turn it on for each device you use.
                </Body>
                <Muted>
                  Your fingerprint and face stay on your device, which may call this a passkey. Google sign-in still
                  works.
                </Muted>
                <OnOff value={lock.enabled} onChange={setLock} label="Fingerprint sign-in" />
                {lockStatus && <Status kind={lockStatus.kind}>{lockStatus.text}</Status>}
              </>
            ) : (
              <Body>{lockUnavailableText(lock.support)}</Body>
            )}
          </Card>
        )}

        <Card>
          <CardTitle icon="smartphone">Sign out on every device</CardTitle>
          <Body>
            Use this if you lose a phone or sign in on someone else's computer. You'll be signed out here too.
          </Body>
          {signOutError && <Status kind="error">{signOutError}</Status>}
          {confirmAll ? (
            <>
              <Body>Sign out of every phone and computer?</Body>
              <DangerButton label="Yes, sign out everywhere" onPress={signOutAll} busy={signingOut} icon="log-out" />
              <SecondaryButton label="Cancel" onPress={() => setConfirmAll(false)} />
            </>
          ) : (
            <DangerButton label="Sign out everywhere" onPress={() => setConfirmAll(true)} icon="log-out" />
          )}
        </Card>

        <Card>
          <CardTitle icon="user-x">Delete your account</CardTitle>
          <Body>
            Deletes your account, saved chats, personal vault and any family only you manage. You'll see exactly what
            goes before anything happens.
          </Body>
          <DangerButton
            label="Delete account"
            icon="trash-2"
            onPress={() => router.push('/settings/delete-account' as any)}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineText: type.label,
});
