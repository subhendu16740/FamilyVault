// Settings › Security › Delete account. Both stores require that a person can
// delete their account from inside the app (migration 029).
//
// It is immediate and permanent: nothing is kept, and there is no waiting
// period. So the screen first shows, family by family, what will be deleted
// and what will be left, and asks for DELETE to be typed. A family nobody
// else manages is deleted with the account, and the screen says who else
// loses it. Confirmation is on screen, never Alert.alert, which does nothing
// on the web.

import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { forgetAccount } from '../../lib/storage';
import { forgetPushOnThisDevice } from '../../lib/push';
import {
  previewAccountDeletion, deleteAccount, signOutThisDevice,
  AccountDeletionError, type AccountDeletionFamily,
} from '../../lib/api';
import { ScreenHeader } from '../../components/screen-header';
import {
  Card, CardTitle, Body, Muted, Field, PrimaryButton, SecondaryButton, DangerButton, Status, screenStyles,
} from '../../components/settings-ui';
import { color, space, type } from '../../constants/design';

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;
const people = (n: number) => (n === 1 ? '1 other member loses it' : `${n} other members lose it`);

export default function DeleteAccountScreen() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<AccountDeletionFamily[] | null>(null);
  const [problem, setProblem] = useState<{ unavailable: boolean; text: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setProblem(null);
    setPlan(null);
    previewAccountDeletion()
      .then((families) => { if (!cancelled) setPlan(families); })
      .catch((err) => {
        if (cancelled) return;
        setPlan([]);
        setProblem({
          unavailable: err instanceof AccountDeletionError && err.status === 'unavailable',
          text: err?.message || 'Could not check what would be deleted.',
        });
      });
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(useCallback(() => {
    if (done) return;
    return load();
  }, [load, done]));

  const confirmed = typed.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setFailed(null);
    try {
      await deleteAccount();
      // Now, not at Done: closing the tab instead must not leave them behind.
      if (user) forgetAccount(user.id).catch(() => undefined);
      forgetPushOnThisDevice().catch(() => undefined);   // the server's rows went with the account
      setDone(true);
    } catch (err: any) {
      setFailed(err?.message || 'Your account could not be deleted. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <SafeAreaView style={screenStyles.safe} edges={['top']}>
        <ScreenHeader title="Delete account" fallback="/settings/security" />
        <ScrollView contentContainerStyle={screenStyles.body}>
          <Card>
            <CardTitle icon="check-circle">Your account has been deleted</CardTitle>
            <Body>Your account and everything listed on the last screen are gone. Thank you for using AskLocker.</Body>
            {/* Signing out here takes the app back to the sign-in screen. */}
            <PrimaryButton label="Done" onPress={() => { signOutThisDevice().catch(() => undefined); }} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const going = (plan ?? []).filter((f) => f.deleted);
  const leaving = (plan ?? []).filter((f) => !f.deleted);
  const othersLoseAFamily = going.some((f) => f.otherMembers > 0);

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Delete account" fallback="/settings/security" />
      <ScrollView contentContainerStyle={screenStyles.body} keyboardShouldPersistTaps="handled">
        {plan === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.primary} />
            <Muted>Checking what would be deleted…</Muted>
          </View>
        ) : problem ? (
          <>
            <Status kind="error">{problem.text}</Status>
            {!problem.unavailable && <SecondaryButton label="Try again" icon="refresh-cw" onPress={load} />}
          </>
        ) : (
          <>
            <Card>
              <CardTitle icon="alert-triangle">This cannot be undone</CardTitle>
              <Body>
                Your account is deleted straight away; there is no waiting period.
                Short-term copies in our providers' backups and logs expire on their own.
              </Body>
              <Muted>
                Also deleted: your profile, saved chats and notifications, and your Gmail connection if you made one.
              </Muted>
            </Card>

            {going.length > 0 && (
              <Card>
                <CardTitle icon="trash-2">Deleted with your account</CardTitle>
                <Muted>
                  {going.length === 1
                    ? 'Nobody else looks after this family, so it is deleted too, with every document and file in it.'
                    : 'Nobody else looks after these families, so they are deleted too, with every document and file in them.'}
                </Muted>
                {going.map((f) => (
                  <View key={f.familyId} style={styles.family}>
                    <Text style={styles.familyName}>{f.name}</Text>
                    <Text style={[styles.familyLine, f.otherMembers > 0 && styles.warn]}>
                      {documents(f.documentCount)}
                      {f.otherMembers > 0 ? ` · ${people(f.otherMembers)}` : ''}
                    </Text>
                  </View>
                ))}
                {othersLoseAFamily && (
                  <Body>
                    To keep a family for its other members, make one of them an admin in Manage Family first.
                  </Body>
                )}
                {othersLoseAFamily && (
                  <SecondaryButton label="Manage Family" icon="users" onPress={() => router.push('/family' as any)} />
                )}
              </Card>
            )}

            {leaving.length > 0 && (
              <Card>
                <CardTitle icon="log-out">Families you leave</CardTitle>
                <Muted>These keep their documents, as when anyone leaves a family. You stay in their family tree by name, without your account, and your emergency card there is deleted.</Muted>
                {leaving.map((f) => (
                  <View key={f.familyId} style={styles.family}>
                    <Text style={styles.familyName}>{f.name}</Text>
                    <Text style={styles.familyLine}>
                      {f.yourDocuments > 0
                        ? `Keeps ${documents(f.yourDocuments)} you added`
                        : 'You added no documents here'}
                    </Text>
                  </View>
                ))}
                {leaving.some((f) => f.yourDocuments > 0) && (
                  <Body>If you don't want to leave a document behind, delete it from the family first: once you have gone, nobody there can delete it.</Body>
                )}
              </Card>
            )}

            <Card>
              <CardTitle icon="user-x">Delete your account</CardTitle>
              <Field
                label="Type DELETE to confirm"
                value={typed}
                onChangeText={(t) => { setTyped(t); setFailed(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
              />
              {failed && <Status kind="error">{failed}</Status>}
              <DangerButton
                label="Delete my account"
                icon="trash-2"
                onPress={remove}
                disabled={!confirmed}
                busy={deleting}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: 40 },
  family: { gap: 2 },
  familyName: type.label,
  familyLine: type.caption,
  warn: { color: '#B45309' },
});
