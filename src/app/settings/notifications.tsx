// Settings › Notifications — whether you see notifications at all, and
// whether this device shows them as notifications on the phone or computer
// (Web Push, migration 034), even when AskLocker is closed. The reminders
// themselves are made on the server either way, for every member: 90, 30
// and 7 days before a document expires, and on the day.
//
// Off hides the bell's count and the list, and sends nothing to devices;
// nothing is deleted, so switching back on shows them again.
//
// Birthdays (035) is its own switch: on the morning of a birthday in the
// family tree, the server reminds everyone who has it on.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreferences } from '../../lib/preferences';
import { loadPushStatus, turnOnPush, turnOffPush, sendTestPush, type PushStatus } from '../../lib/push';
import { ScreenHeader } from '../../components/screen-header';
import {
  Card, CardTitle, Body, Muted, OnOff, PrimaryButton, SecondaryButton, Status, screenStyles,
} from '../../components/settings-ui';
import { color, space } from '../../constants/design';

const DEVICE_TEXT: Record<Exclude<PushStatus, 'on' | 'off'>, string> = {
  unsupported: "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.",
  'needs-home-screen':
    'On iPhone or iPad, tap Share, then Add to Home Screen. Open AskLocker from there and turn this on.',
  blocked: "This browser blocks AskLocker's notifications. Allow them in its site settings, then come back.",
  'not-ready': "Device notifications aren't ready yet. You'll still see alerts under the bell.",
};

export default function NotificationSettingsScreen() {
  const { notificationsEnabled, setNotificationsEnabled, birthdayReminders, setBirthdayReminders, birthdaysAvailable } = usePreferences();
  const onWeb = Platform.OS === 'web';
  const [device, setDevice] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const [news, setNews] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useFocusEffect(useCallback(() => {
    if (!onWeb) return undefined;
    let cancelled = false;
    loadPushStatus()
      .then((s) => { if (!cancelled) setDevice(s); })
      .catch(() => { if (!cancelled) setDevice('off'); });
    return () => { cancelled = true; };
  }, [onWeb]));

  const act = async (kind: 'on' | 'off' | 'test', work: () => Promise<void>) => {
    setBusy(kind);
    setNews(null);
    try {
      await work();
    } catch (err: any) {
      setNews({ kind: 'error', text: err?.message || 'Something went wrong. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const turnOn = () => act('on', async () => {
    const result = await turnOnPush();
    if (result.ok) {
      setDevice('on');
      setNews({ kind: 'ok', text: 'On for this device. Send a test to see one.' });
    } else {
      setNews({ kind: 'error', text: result.message });
      setDevice(await loadPushStatus().catch(() => 'off' as const));
    }
  });

  const turnOff = () => act('off', async () => {
    await turnOffPush();
    setDevice('off');
    setNews({ kind: 'ok', text: "Off for this device. You'll still see them under the bell." });
  });

  const test = () => act('test', async () => {
    const result = await sendTestPush();
    setNews(result.sent > 0
      ? { kind: 'ok', text: result.sent === 1 ? 'Sent. It should arrive in a few seconds.' : `Sent to your ${result.sent} devices. It should arrive in a few seconds.` }
      : { kind: 'error', text: "Couldn't reach this device. Turn it off and on, then send another test." });
  });

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Card>
          <CardTitle icon="bell">Show notifications</CardTitle>
          <OnOff value={notificationsEnabled} onChange={setNotificationsEnabled} label="Show notifications" />
          <Body>
            {notificationsEnabled
              ? 'New alerts show under the bell on Home.'
              : 'The bell stays quiet and nothing goes to your devices. Turn this back on to see your alerts again.'}
          </Body>
        </Card>

        {onWeb && (
          <Card>
            <CardTitle icon="smartphone">On this device</CardTitle>
            {device === null ? (
              <ActivityIndicator color={color.primary} />
            ) : device === 'on' ? (
              <>
                <Body>This device gets notifications, even when AskLocker is closed.</Body>
                {!notificationsEnabled && <Muted>Notifications are off above, so nothing is sent for now.</Muted>}
                <View style={styles.buttons}>
                  <SecondaryButton label="Send a test" icon="send" onPress={test} disabled={busy !== null} />
                  <SecondaryButton label="Turn off" icon="bell-off" onPress={turnOff} disabled={busy !== null} />
                </View>
              </>
            ) : device === 'off' ? (
              <>
                <Body>Get invitations, birthdays and, with ★ Family Plus, expiry reminders here, even when AskLocker is closed.</Body>
                <PrimaryButton label="Turn on" icon="bell" onPress={turnOn} busy={busy === 'on'} disabled={busy !== null} />
              </>
            ) : (
              <Body>{DEVICE_TEXT[device]}</Body>
            )}
            {!!news && <Status kind={news.kind}>{news.text}</Status>}
          </Card>
        )}

        <Card>
          <CardTitle icon="gift">Birthdays</CardTitle>
          {birthdaysAvailable ? (
            <>
              <OnOff value={birthdayReminders} onChange={setBirthdayReminders} label="Birthday reminders" />
              <Body>
                {birthdayReminders
                  ? 'You get a reminder on the morning of each birthday in your family tree.'
                  : "You won't get birthday reminders."}
              </Body>
              <Muted>
                Only for people with a birth date in the tree. If someone has passed away, an admin can remove their
                birth date.
              </Muted>
            </>
          ) : (
            <Muted>Birthday reminders aren't ready yet.</Muted>
          )}
        </Card>

        <Card>
          <CardTitle icon="info">What you are told about</CardTitle>
          <Body>• Expiring documents, 90, 30 and 7 days ahead and on the day. Needs ★ Family Plus.</Body>
          <Body>• Birthdays in your family tree, if Birthdays is on.</Body>
          <Body>• Invitations to join a family.</Body>
          <Muted>
            Phones and computers get these between 8 am and 10 pm, India time. Anything at night waits until
            morning.
          </Muted>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: space.sm },
});
