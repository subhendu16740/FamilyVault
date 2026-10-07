// The pieces the Settings screens are built from: cards, buttons, text
// fields, an On/Off control and a status line. Every size comes from
// src/constants/design.ts, so a card here matches a card anywhere else:
// 15px text, 44px controls, 16px padding.

import type { ReactNode } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
  type TextInputProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { color, radius, shadow, size, space, type } from '../constants/design';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardTitle({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <View style={styles.cardTitleRow}>
      {!!icon && (
        <View style={styles.iconWrap}>
          <Feather name={icon as any} size={16} color={color.primary} />
        </View>
      )}
      <Text style={styles.cardTitle} accessibilityRole="header">{children}</Text>
    </View>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

type ButtonProps = { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: string };

export function PrimaryButton({ label, onPress, disabled, busy, icon }: ButtonProps) {
  const off = disabled || busy;
  return (
    <TouchableOpacity
      style={[styles.button, styles.primary, off && styles.disabled]}
      onPress={onPress}
      disabled={off}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
    >
      {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
        <>
          {!!icon && <Feather name={icon as any} size={16} color="#FFFFFF" />}
          <Text style={styles.primaryText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function SecondaryButton({ label, onPress, disabled, icon }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.button, styles.secondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      {!!icon && <Feather name={icon as any} size={16} color={color.primary} />}
      <Text style={styles.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function DangerButton({ label, onPress, disabled, busy, icon }: ButtonProps) {
  const off = disabled || busy;
  return (
    <TouchableOpacity
      style={[styles.button, styles.danger, off && styles.disabled]}
      onPress={onPress}
      disabled={off}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator size="small" color={color.danger} /> : (
        <>
          {!!icon && <Feather name={icon as any} size={16} color={color.danger} />}
          <Text style={styles.dangerText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#9CA3AF"
        {...input}
        style={[styles.input, input.multiline && styles.inputMultiline, input.editable === false && styles.inputReadOnly]}
        accessibilityLabel={label}
      />
      {!!hint && <Text style={styles.muted}>{hint}</Text>}
    </View>
  );
}

/** Two buttons that say what they do. Clearer than a small switch. */
export function OnOff({ value, onChange, label }: { value: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[true, false].map((on) => {
        const selected = value === on;
        return (
          <TouchableOpacity
            key={String(on)}
            style={[styles.segmentOption, selected && styles.segmentSelected]}
            onPress={() => onChange(on)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            aria-checked={selected}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{on ? 'On' : 'Off'}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** One line of news after an action: green when it worked, red when not. */
export function Status({ kind, children }: { kind: 'ok' | 'error'; children: ReactNode }) {
  const ok = kind === 'ok';
  return (
    <View style={[styles.status, ok ? styles.statusOk : styles.statusError]} accessibilityLiveRegion="polite">
      <Feather name={ok ? 'check-circle' : 'alert-circle'} size={16} color={ok ? '#166534' : '#B91C1C'} style={styles.statusIcon} />
      <Text style={[styles.statusText, { color: ok ? '#166534' : '#B91C1C' }]}>{children}</Text>
    </View>
  );
}

export const screenStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    ...shadow.card,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: 8,
    backgroundColor: color.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...type.heading, flex: 1 },
  body: type.body,
  muted: type.caption,
  button: {
    minHeight: size.control,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  primary: { backgroundColor: color.primary },
  primaryText: { ...type.button, color: '#FFFFFF' },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.primary },
  secondaryText: { ...type.button, color: color.primary },
  danger: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  dangerText: { ...type.button, color: color.danger },
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  fieldLabel: { ...type.caption, fontWeight: '500', color: color.textBody },
  input: {
    minHeight: size.control,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: 10,
    paddingHorizontal: space.md,
    fontSize: type.body.fontSize,
    color: color.text,
    backgroundColor: color.surface,
  },
  inputMultiline: { minHeight: 120, paddingTop: 10, textAlignVertical: 'top' },
  inputReadOnly: { backgroundColor: color.divider, color: '#4B5563' },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: radius.control,
    backgroundColor: '#EEF2F8',
  },
  segmentOption: { flex: 1, minHeight: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: color.primary },
  segmentText: { ...type.button, color: color.secondary },
  segmentTextSelected: { color: '#FFFFFF' },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: 10,
  },
  statusIcon: { marginTop: 1 },
  statusOk: { backgroundColor: '#F0FDF4' },
  statusError: { backgroundColor: '#FEF2F2' },
  statusText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
});
