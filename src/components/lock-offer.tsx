// Home's offer of fingerprint sign-in (app-lock.tsx), so nobody has to find
// it in Settings: shown on a device that can check a fingerprint or face,
// while it is off, until it is turned on or "Not now" is chosen (remembered
// per account on this device, accountKey.lockOffer). Settings › Security
// turns it on or off at any time.

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { lockAfterText, useAppLock } from '../lib/app-lock';
import { accountKey, storageGet, storageSet } from '../lib/storage';
import { color, radius, shadow, size, space, type } from '../constants/design';

export function LockOffer({ style }: { style?: StyleProp<ViewStyle> }) {
  const { user } = useAuth();
  const lock = useAppLock();
  // Unknown until the device says whether "Not now" was chosen: shown only once it has not.
  const [declined, setDeclined] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [turnedOn, setTurnedOn] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    storageGet(accountKey.lockOffer(user.id)).then((v) => { if (!cancelled) setDeclined(v === 'no'); });
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || !lock.supported || declined !== false || closed) return null;
  if (lock.enabled && !turnedOn) return null;

  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await lock.turnOn();
      setTurnedOn(true);
    } catch (err: any) {
      setProblem(err?.message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    storageSet(accountKey.lockOffer(user.id), 'no');
    setDeclined(true);
  };

  if (turnedOn) {
    return (
      <View style={style}>
      <View style={styles.card}>
        <View style={styles.news}>
          <Feather name="check-circle" size={16} color="#15803D" />
          <Text style={styles.newsText}>
            Fingerprint sign-in is on. Next time, sign in with your fingerprint or face.
          </Text>
        </View>
        <TouchableOpacity style={styles.secondary} onPress={() => setClosed(true)} accessibilityRole="button">
          <Text style={styles.secondaryText}>OK</Text>
        </TouchableOpacity>
      </View>
      </View>
    );
  }

  return (
    <View style={style}>
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.icon}>
          <Feather name="aperture" size={16} color={color.primary} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Sign in with your fingerprint</Text>
          <Text style={styles.sub}>
            Turn it on, and next time your fingerprint or face signs you in. AskLocker also locks after{' '}
            {lockAfterText} away. Your fingerprint never leaves this device.
          </Text>
        </View>
      </View>
      {!!problem && <Text style={styles.problem} accessibilityRole="alert">{problem}</Text>}
      <View style={styles.buttons}>
        <TouchableOpacity style={styles.primary} onPress={turnOn} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Turn on</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={notNow} disabled={busy} accessibilityRole="button">
          <Text style={styles.secondaryText}>Not now</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.later}>You can change this in Settings › Security.</Text>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, gap: space.md,
    borderWidth: 1, borderColor: '#BFDBFE', ...shadow.card,
  },
  top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  icon: { width: size.iconBox, height: size.iconBox, borderRadius: 8, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: type.heading,
  sub: type.caption,
  problem: { ...type.caption, color: color.danger },
  buttons: { flexDirection: 'row', gap: space.sm },
  primary: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...type.button, color: '#FFFFFF' },
  secondary: {
    flex: 1, minHeight: size.control, borderRadius: radius.control, borderWidth: 1, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface,
  },
  secondaryText: { ...type.button, color: color.textBody },
  later: type.caption,
  news: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md,
    borderRadius: radius.control, backgroundColor: '#F0FDF4',
  },
  newsText: { flex: 1, ...type.body, color: '#15803D' },
});
