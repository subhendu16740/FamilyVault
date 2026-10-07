// What a locked AskLocker shows (app-lock.tsx): the logo, one big Unlock
// button that asks the device for a fingerprint or face, and Google as the
// way back in. It tries once by itself when it appears; some browsers (older
// iPhones) start the check only from a tap, so the button stays. Drawn over
// everything, in a Modal; on the web everything else on the page is made
// inert meanwhile, so no screen reader, keyboard or click reaches what is
// behind it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Image, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useAppLock } from '../lib/app-lock';
import { color, radius, size, space, type } from '../constants/design';

/** The lock screen's own element on the web, to tell it from everything it covers. */
const LOCK_ID = 'app-lock';

/**
 * On the web, while locked: every other part of the page — the app and any
 * other open Modal — inert and hidden from screen readers. The lock's Modal
 * is its own child of <body> (react-native-web's portal), so it stays usable.
 */
function useNothingElseReachable(active: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !active) return;
    const covered: Element[] = [];
    let frame = 0;
    let tries = 0;
    const coverTheRest = () => {
      const lock = document.getElementById(LOCK_ID);
      if (!lock) {
        if (tries++ < 60) frame = requestAnimationFrame(coverTheRest);
        return;
      }
      for (const el of Array.from(document.body.children)) {
        if (el.contains(lock) || el.hasAttribute('inert') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        covered.push(el);
      }
    };
    coverTheRest();
    return () => {
      cancelAnimationFrame(frame);
      for (const el of covered) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    };
  }, [active]);
}

export function AppLockScreen() {
  const { locked, deciding, unlock } = useAppLock();
  const { signOut } = useAuth();
  const segments = useSegments();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const triedByItself = useRef(false);
  // A shared document (036) is for anyone with the link: never behind the lock.
  const shared = (segments[0] as string | undefined) === 's';

  const attempt = useCallback(async (byTap: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await unlock();
    } catch (err: any) {
      // The try made by itself may simply need a tap first: no message for that.
      if (byTap) setProblem(err?.message || 'Not unlocked. Try again.');
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  useNothingElseReachable(locked && !shared);

  useEffect(() => {
    if (!locked || shared) {
      triedByItself.current = false;
      setProblem(null);
      return;
    }
    if (triedByItself.current) return;
    triedByItself.current = true;
    attempt(false);
  }, [locked, shared, attempt]);

  if (shared) return null;
  // A moment at start-up while it reads whether the lock is on: nothing behind shows meanwhile.
  if (deciding) return <View style={[StyleSheet.absoluteFill, styles.cover]} />;
  if (!locked) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <SafeAreaView style={styles.safe}>
        <View style={styles.body} nativeID={LOCK_ID}>
          <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoBox}>
            <Image source={require('@/assets/images/logo-mark.png')} style={styles.logoMark} accessibilityIgnoresInvertColors />
          </LinearGradient>
          <Text style={styles.title} accessibilityRole="header">AskLocker is locked</Text>
          <Text style={styles.text}>Use your fingerprint or face to open it.</Text>

          <TouchableOpacity
            style={[styles.unlock, busy && styles.unlockBusy]}
            onPress={() => attempt(true)}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Unlock with fingerprint or face"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Feather name="aperture" size={size.icon} color="#FFFFFF" />
                <Text style={styles.unlockText}>Unlock</Text>
              </>
            )}
          </TouchableOpacity>
          {!!problem && <Text style={styles.problem} accessibilityRole="alert">{problem}</Text>}

          <TouchableOpacity
            style={styles.google}
            onPress={() => { signOut().catch(() => {}); }}
            accessibilityRole="button"
            accessibilityHint="Signs you out, so you can sign in again with Google"
          >
            <Text style={styles.googleText}>Use Google instead</Text>
          </TouchableOpacity>
          <Text style={styles.small}>This signs you out. Sign in again with Google and AskLocker opens; the lock stays on for next time.</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: color.background, zIndex: 1000 },
  safe: { flex: 1, backgroundColor: color.background },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    gap: space.md,
    maxWidth: 390,
    width: '100%',
    alignSelf: 'center',
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
    boxShadow: '0px 2px 8px rgba(42, 61, 102, 0.25)',
    elevation: 4,
  },
  logoMark: { width: 44, height: 44 },
  title: { ...type.heading, color: color.primary, fontSize: 20, lineHeight: 26 },
  text: { ...type.body, textAlign: 'center', marginBottom: space.md },
  unlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
    minHeight: 56,
    borderRadius: radius.control,
    backgroundColor: color.primary,
  },
  unlockBusy: { opacity: 0.7 },
  unlockText: { ...type.button, fontSize: 17, color: '#FFFFFF' },
  problem: { ...type.caption, color: color.danger, textAlign: 'center' },
  google: { minHeight: size.control, alignItems: 'center', justifyContent: 'center', marginTop: space.lg },
  googleText: { ...type.button, color: color.primary },
  small: { ...type.caption, textAlign: 'center' },
});
