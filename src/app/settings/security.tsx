// Settings › Security — how you sign in (Google, the only way in), the
// fingerprint or face lock on this device, signing out of every device at
// once, and deleting your account.

import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { signOutEverywhere } from '../../lib/api';
import { longDate } from '../../lib/dates';
import { isProduction } from '../../lib/environment';
import { lockAfterText, useAppLock } from '../../lib/app-lock';
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
        setLockStatus({ kind: 'ok', text: `The lock is on. AskLocker asks for your fingerprint or face when it opens, and after ${lockAfterText} away.` });
      } else {
        await lock.turnOff();
        setLockStatus({ kind: 'ok', text: 'The lock is off on this device.' });
      }
    } catch (err: any) {
      setLockStatus({ kind: 'error', text: err?.message || 'That did not work. Please try again.' });
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
              AskLocker now signs in with Google only. Next time, choose Continue with Google and pick the Google
              account for {user?.email}: it opens this same account, with everything in it.
            </Body>
          )}
        </Card>

        {lock.supported && (
          <Card>
            <CardTitle icon="aperture">Fingerprint or face lock</CardTitle>
            <Body>
              AskLocker asks for your fingerprint or face (or this device's PIN) when it opens, and after {lockAfterText}
              {' '}away. It is for this phone or computer only: turn it on on each one you use.
            </Body>
            <Muted>
              Your fingerprint and face stay on your device: AskLocker only hears yes or no. Your device may call the
              lock a passkey. If it ever does not work, the lock screen lets you sign in with Google instead.
            </Muted>
            <OnOff value={lock.enabled} onChange={setLock} label="Fingerprint or face lock" />
            {lockStatus && <Status kind={lockStatus.kind}>{lockStatus.text}</Status>}
          </Card>
        )}

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

        <Card>
          <CardTitle icon="user-x">Delete your account</CardTitle>
          <Body>
            Deletes your account straight away and for good, with your saved chats and any family nobody else looks
            after. The next screen shows exactly what goes before anything happens.
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
