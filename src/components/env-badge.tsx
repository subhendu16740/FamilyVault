// ─── "You are not looking at real data" ─────────────────────────
//
// Mounted once in the root layout, so it is on every screen without
// fourteen files having to remember it — and so a new screen cannot be
// added without it.
//
// Renders nothing in production. Everywhere else it is deliberately not
// styled like the app: the palette here is a warning colour that appears
// nowhere in FamilyVault's own design, so it reads as a marker stuck onto
// the build rather than part of the product.
// ────────────────────────────────────────────────────────────────

import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isProduction, environmentLabel, environmentKind } from '../lib/environment';

export function EnvBadge() {
  const insets = useSafeAreaInsets();

  // The only silent case, and it needs an exact project-ref match.
  if (isProduction) return null;

  // A build that cannot say which backend it has is worse than a DEV build,
  // not better — it gets the louder colour.
  const unknown = environmentKind === 'unknown';

  return (
    <View
      // Never intercept a touch. This sits above every screen, including the
      // tab bar and the voice button, and must not swallow a press.
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 6 }]}
    >
      <View style={[styles.pill, unknown && styles.pillUnknown]}>
        <Text style={[styles.text, unknown && styles.textUnknown]} numberOfLines={1}>
          {environmentLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Above every screen, the tab bar and the profile drawer.
    zIndex: 9999,
    ...(Platform.OS === 'web' ? ({ position: 'fixed' } as object) : null),
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#B45309',
    borderWidth: 1,
    borderColor: '#F59E0B',
    opacity: 0.94,
    boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.25)',
    elevation: 4,
  },
  pillUnknown: {
    backgroundColor: '#991B1B',
    borderColor: '#EF4444',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  textUnknown: {
    letterSpacing: 0.6,
  },
});
