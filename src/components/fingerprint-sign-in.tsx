// The login screen's "Sign in with fingerprint" (app-lock.tsx): shown on a
// device where someone turned fingerprint sign-in on, above Google, which
// stays below it. The device asks for the finger, the face or its PIN, and
// Supabase checks the passkey and signs the person in — no Google, no
// password. What goes wrong is said on the screen — and stays there when the
// button goes, as it does after a sign-in with a passkey that was turned off.

import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppLock } from '../lib/app-lock';
import { color, radius, size, space, type } from '../constants/design';

export function FingerprintSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const lock = useAppLock();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!lock.availableHere && !problem) return null;

  const signIn = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await lock.signIn();
      onSignedIn();
    } catch (err: any) {
      setProblem(err?.message || 'Not signed in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!lock.availableHere) {
    return <Text style={[styles.problem, styles.alone]} accessibilityRole="alert">{problem}</Text>;
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.button, busy && styles.busy]}
        onPress={signIn}
        disabled={busy}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Sign in with fingerprint or face"
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : (
          <>
            <Feather name="aperture" size={size.icon} color="#FFFFFF" />
            <Text style={styles.buttonText}>Sign in with fingerprint</Text>
          </>
        )}
      </TouchableOpacity>
      {!!problem && <Text style={styles.problem} accessibilityRole="alert">{problem}</Text>}
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, marginBottom: space.lg },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 56,
    borderRadius: radius.control,
    backgroundColor: color.primary,
  },
  busy: { opacity: 0.7 },
  buttonText: { ...type.button, fontSize: 17, color: '#FFFFFF' },
  problem: { ...type.caption, color: color.danger, textAlign: 'center' },
  alone: { marginBottom: space.lg },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  line: { flex: 1, height: 1, backgroundColor: color.border },
  or: type.caption,
});
