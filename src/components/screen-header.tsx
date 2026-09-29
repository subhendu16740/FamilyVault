// The top of every screen reached from Settings or the drawer: Back on its
// own row, then the title. One component so the screens cannot drift apart.

import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BackButton } from './back-button';

export function ScreenHeader({ title, fallback, right }: { title: string; fallback?: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <BackButton fallback={fallback} />
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {right}
      </View>
    </View>
  );
}

/** "★ Family Plus" — marks what the paid plan will include. */
export function PlusTag() {
  return (
    <View style={styles.plusTag} accessibilityLabel="Part of Family Plus, the paid plan">
      <Text style={styles.plusStar}>★</Text>
      <Text style={styles.plusText}>Family Plus</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: '700', color: '#2A3D66' },
  plusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FBEDEB',
  },
  plusStar: { fontSize: 14, color: '#D4807B' },
  plusText: { fontSize: 13, fontWeight: '700', color: '#2A3D66' },
});
