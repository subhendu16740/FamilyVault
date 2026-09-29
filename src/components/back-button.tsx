// ─── The way back, on every screen but Home ─────────────────────
//
// A plain arrow at the left of the top bar, as on every phone: the drawn
// icon is 24px, the touch area around it 44px, so it is easy to hit without
// looking heavy. Screen readers hear "Go back".
//
// It also works when there is nothing to go back to. After a refresh on the
// web, or on a screen opened from a link, `router.back()` does nothing at
// all — the button is there and dead — so this goes to `fallback` instead:
// Home, unless the screen names a better parent.
// ────────────────────────────────────────────────────────────────

import { TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { color, size } from '../constants/design';

export function BackButton({ fallback = '/home' }: { fallback?: string }) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as any);
  };

  return (
    <TouchableOpacity
      onPress={goBack}
      style={styles.button}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Feather name="arrow-left" size={size.icon} color={color.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: size.control,
    height: size.control,
    borderRadius: size.control / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
