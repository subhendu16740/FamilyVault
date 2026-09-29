// ─── The way back, on every screen but Home ─────────────────────
//
// A word, not a bare arrow, and big enough to hit: many of the people using
// FamilyVault are elderly, and a small grey arrow in a corner is easy to miss
// or to take for decoration. Outlined, as in the v4 design, in the app's own
// navy.
//
// It also works when there is nothing to go back to. After a refresh on the
// web, or on a screen opened from a link, `router.back()` does nothing at
// all — the button is there and dead — so this goes to `fallback` instead:
// Home, unless the screen names a better parent.
//
// Sits on its own row above the screen's title, so a long title never
// squeezes it.
// ────────────────────────────────────────────────────────────────

import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

export function BackButton({ fallback = '/home' }: { fallback?: string }) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as any);
  };

  return (
    <TouchableOpacity
      onPress={goBack}
      style={styles.button}
      activeOpacity={0.7}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Feather name="arrow-left" size={22} color="#2A3D66" />
      <Text style={styles.label}>Back</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 48,
    paddingLeft: 10,
    paddingRight: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2A3D66',
    backgroundColor: '#FFFFFF',
  },
  label: { fontSize: 17, fontWeight: '700', color: '#2A3D66' },
});
