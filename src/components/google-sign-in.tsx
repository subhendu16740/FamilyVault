// Sign in with Google, on the login screen. On the web, where it is set up,
// Google's own button (google-button.web.ts): the sign-in never passes
// through Supabase's address, so Google's screen names this app instead of
// <project>.supabase.co. Everywhere else — the phone app, a preview whose
// address Google was not told about, or before the setting is made — the
// redirect sign-in it has always been.
//
// What goes wrong is said on the screen, never with Alert.alert, which does
// nothing on the web.

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '../lib/auth';
import { googleButtonAvailable, googleButtonReason, renderGoogleButton } from '../lib/google-button';
import { color, radius, size, space, type } from '../constants/design';

let reasonTold = false;

export function GoogleSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { signInWithGoogle, signInWithGoogleToken } = useAuth();
  const ownButton = googleButtonAvailable();
  const box = useRef<View>(null);
  const [width, setWidth] = useState(0);
  // A new round draws the button again, with a fresh one-time value.
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Says in the browser's console which sign-in this page uses, and why — once a page load.
  useEffect(() => {
    if (reasonTold) return;
    reasonTold = true;
    console.info('[Google sign-in]', googleButtonReason());
  }, []);

  useEffect(() => {
    if (!ownButton || !width || !box.current) return;
    let cancelled = false;
    // On the web a View's ref is its element, which Google draws into.
    renderGoogleButton(box.current as unknown as HTMLElement, {
      width,
      onToken: async (token, nonce) => {
        setBusy(true);
        setProblem(null);
        const { error } = await signInWithGoogleToken(token, nonce);
        if (cancelled) return;
        setBusy(false);
        if (error) {
          setProblem(`Google sign-in did not work: ${error}`);
          setRound((r) => r + 1);
        } else {
          onSignedIn();
        }
      },
      onError: (message) => { if (!cancelled) setProblem(message); },
    }).catch((err: Error) => { if (!cancelled) setProblem(err.message); });
    return () => { cancelled = true; };
  }, [ownButton, width, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const redirect = async () => {
    setBusy(true);
    setProblem(null);
    const { error } = await signInWithGoogle();
    setBusy(false);
    if (error) setProblem(`Google sign-in did not work: ${error}`);
    else onSignedIn();
  };

  return (
    <View style={styles.wrap}>
      {ownButton ? (
        // Google's button fills this box. It is Google's to draw, in Google's design.
        <View
          ref={box}
          style={styles.googleBox}
          onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        />
      ) : (
        <TouchableOpacity
          style={styles.socialBtn}
          onPress={redirect}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
        >
          {busy ? <ActivityIndicator color={color.primary} /> : <Text style={styles.socialBtnText}>Google</Text>}
        </TouchableOpacity>
      )}
      {ownButton && busy && (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={color.primary} />
          <Text style={styles.busyText}>Signing you in…</Text>
        </View>
      )}
      {!!problem && <Text style={styles.problem} accessibilityRole="alert">{problem}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg, gap: space.sm },
  googleBox: { minHeight: size.control, alignItems: 'center', justifyContent: 'center' },
  socialBtn: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  socialBtnText: { ...type.button, fontWeight: '500', color: color.textBody },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  busyText: type.caption,
  problem: { ...type.caption, color: color.danger, textAlign: 'center' },
});
