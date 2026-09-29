// The top bar of every screen but Home: the back arrow at the left, the
// title beside it, and room on the right for one action. One component, so
// every screen's top looks the same.

import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BackButton } from './back-button';
import { color, size, space, type } from '../constants/design';

export function ScreenHeader({
  title, subtitle, fallback, right, titleLines = 1,
}: {
  title: string;
  subtitle?: string;
  fallback?: string;
  right?: ReactNode;
  /** 2 where the title is a name the person must be able to read in full. */
  titleLines?: number;
}) {
  return (
    <View style={styles.bar}>
      <BackButton fallback={fallback} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={titleLines} accessibilityRole="header">{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

/** An icon-only action at the right of the bar, drawn like the back arrow. */
export function HeaderIconButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.iconButton}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon as any} size={size.icon} color={color.primary} />
    </TouchableOpacity>
  );
}

/** A small labelled action at the right of the bar: "Add", "Save". */
export function HeaderButton({ icon, label, onPress }: { icon?: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.textButton}
      activeOpacity={0.8}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole="button"
    >
      {!!icon && <Feather name={icon as any} size={16} color="#FFFFFF" />}
      <Text style={styles.textButtonLabel}>{label}</Text>
    </TouchableOpacity>
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
  bar: {
    minHeight: size.bar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.xs,
    paddingRight: space.lg,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  titles: { flex: 1, minWidth: 0, paddingVertical: space.sm },
  title: type.title,
  subtitle: { ...type.caption, lineHeight: 16 },
  iconButton: {
    width: size.control,
    height: size.control,
    borderRadius: size.control / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: 10,
    backgroundColor: color.primary,
  },
  textButtonLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#FFFFFF' },
  plusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FBEDEB',
  },
  plusStar: { fontSize: 12, color: color.accent },
  plusText: { fontSize: 12, fontWeight: '600', color: color.primary },
});
