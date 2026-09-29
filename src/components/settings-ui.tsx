// The pieces the Settings screens are built from: cards, big buttons, text
// fields, an On/Off control and a status line. Sized for older eyes and
// hands — 17px text, 52px buttons — in the app's palette.

import type { ReactNode } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
  type TextInputProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardTitle({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <View style={styles.cardTitleRow}>
      {!!icon && (
        <View style={styles.iconWrap}>
          <Feather name={icon as any} size={18} color="#2A3D66" />
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
      {busy ? <ActivityIndicator color="#FFFFFF" /> : (
        <>
          {!!icon && <Feather name={icon as any} size={18} color="#FFFFFF" />}
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
      {!!icon && <Feather name={icon as any} size={18} color="#2A3D66" />}
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
      {busy ? <ActivityIndicator color="#DC2626" /> : (
        <>
          {!!icon && <Feather name={icon as any} size={18} color="#DC2626" />}
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

/** Two big buttons that say what they do. Clearer than a small switch. */
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
            accessibilityState={{ selected }}
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
      <Feather name={ok ? 'check-circle' : 'alert-circle'} size={18} color={ok ? '#166534' : '#B91C1C'} />
      <Text style={[styles.statusText, { color: ok ? '#166534' : '#B91C1C' }]}>{children}</Text>
    </View>
  );
}

export const screenStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  body: { padding: 20, gap: 14, paddingBottom: 48 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1F2937' },
  body: { fontSize: 16, lineHeight: 24, color: '#374151' },
  muted: { fontSize: 14, lineHeight: 20, color: '#6B7280' },
  button: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: { backgroundColor: '#2A3D66' },
  primaryText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#2A3D66' },
  secondaryText: { fontSize: 17, fontWeight: '700', color: '#2A3D66' },
  danger: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  dangerText: { fontSize: 17, fontWeight: '700', color: '#DC2626' },
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  input: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 17,
    color: '#1F2937',
    backgroundColor: '#FFFFFF',
  },
  inputMultiline: { minHeight: 150, paddingTop: 12, textAlignVertical: 'top' },
  inputReadOnly: { backgroundColor: '#F3F4F6', color: '#4B5563' },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#EEF2F8',
  },
  segmentOption: { flex: 1, minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: '#2A3D66' },
  segmentText: { fontSize: 17, fontWeight: '700', color: '#4A6491' },
  segmentTextSelected: { color: '#FFFFFF' },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  statusOk: { backgroundColor: '#F0FDF4' },
  statusError: { backgroundColor: '#FEF2F2' },
  statusText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600' },
});
