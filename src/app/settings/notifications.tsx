// Settings › Notifications — whether you see notifications at all, and
// whether this device shows them as notifications on the phone or computer
// (Web Push, migration 034), even when FamilyVault is closed. The reminders
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
  unsupported: 'This browser cannot show notifications. Chrome, Edge, Firefox and Safari can.',
  'needs-home-screen':
    'On iPhone or iPad, add FamilyVault to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn reminders on.',
  blocked: "Notifications are blocked for FamilyVault in this browser. Allow them in the browser's settings for this site, then come back here.",
  'not-ready': 'Notifications on devices are not switched on yet. Reminders still appear under the bell.',
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
      setNews({ kind: 'ok', text: 'Reminders are on for this device. Send a test to see what one looks like.' });
    } else {
      setNews({ kind: 'error', text: result.message });
      setDevice(await loadPushStatus().catch(() => 'off' as const));
    }
  });

  const turnOff = () => act('off', async () => {
    await turnOffPush();
    setDevice('off');
    setNews({ kind: 'ok', text: 'This device will not get notifications any more. They still appear under the bell.' });
  });

  const test = () => act('test', async () => {
    const result = await sendTestPush();
    setNews(result.sent > 0
      ? { kind: 'ok', text: result.sent === 1 ? 'Sent. It should arrive in a few seconds.' : `Sent to your ${result.sent} devices. It should arrive in a few seconds.` }
      : { kind: 'error', text: 'Could not reach this device. Turn reminders off and on again, then send another test.' });
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
              ? 'New alerts appear under the bell on Home, with a count.'
              : 'The bell on Home stays quiet, the list is hidden, and nothing is sent to your devices. Nothing is deleted — switch back on to see them.'}
          </Body>
        </Card>

        {onWeb && (
          <Card>
            <CardTitle icon="smartphone">On this device</CardTitle>
            {device === null ? (
              <ActivityIndicator color={color.primary} />
            ) : device === 'on' ? (
              <>
                <Body>On. This device shows FamilyVault's notifications, even when the app is closed.</Body>
                {!notificationsEnabled && <Muted>Notifications are switched off above, so nothing is sent until you switch them back on.</Muted>}
                <View style={styles.buttons}>
                  <SecondaryButton label="Send a test" icon="send" onPress={test} disabled={busy !== null} />
                  <SecondaryButton label="Turn off" icon="bell-off" onPress={turnOff} disabled={busy !== null} />
                </View>
              </>
            ) : device === 'off' ? (
              <>
                <Body>Get a notification on this phone or computer when a document is about to expire — even when FamilyVault is closed.</Body>
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
                  ? 'On the morning of a birthday in your family tree, you get a reminder.'
                  : 'You are not reminded of birthdays.'}
              </Body>
              <Muted>
                Only for people with a date of birth in the family tree. If someone there has passed away, an admin can
                remove their date of birth from their page.
              </Muted>
            </>
          ) : (
            <Muted>Birthday reminders are not switched on yet.</Muted>
          )}
        </Card>

        <Card>
          <CardTitle icon="info">What you are told about</CardTitle>
          <Body>• A document of your family's is about to expire: 90, 30 and 7 days before, and on the day.</Body>
          <Body>• Someone's birthday in your family tree, if Birthdays is on.</Body>
          <Body>• Someone adds you to a family.</Body>
          <Muted>
            Everyone in the family is told. Phones and computers are told between 8 in the morning and 10 at night,
            India time; anything that comes up at night waits for the morning. It is free.
          </Muted>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: space.sm },
});
