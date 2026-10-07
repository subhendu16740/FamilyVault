// Choosing a vault (046): the personal vault and the families someone is in —
// in a dropdown where a choice must be made (Upload asks where a document
// goes), or in a sheet behind a pill where there is already an answer (Ask
// searches all of them unless told otherwise).

import { useRef, useState } from 'react';
import {
  Modal, Pressable, ScrollView, Text, TouchableOpacity, View, StyleSheet, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { color, radius, size, space, type } from '../constants/design';

export interface VaultChoice {
  key: string;
  name: string;
  subtitle?: string;
  /** lock: the personal vault; users: a family; layers: every vault at once. */
  icon: 'lock' | 'users' | 'layers';
}

/** The choices as a list of rows, one ticked. */
export function VaultChoices({ choices, selected, onSelect }: {
  choices: VaultChoice[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {choices.map((c, i) => {
        const on = c.key === selected;
        return (
          <TouchableOpacity
            key={c.key}
            style={[styles.row, i > 0 && styles.rowBorder, on && styles.rowOn]}
            onPress={() => onSelect(c.key)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={[c.name, c.subtitle].filter(Boolean).join(', ')}
          >
            <View style={[styles.icon, on && styles.iconOn]}>
              <Feather name={c.icon} size={16} color={on ? '#FFFFFF' : color.primary} />
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              {!!c.subtitle && <Text style={styles.subtitle} numberOfLines={1}>{c.subtitle}</Text>}
            </View>
            <Feather name={on ? 'check-circle' : 'circle'} size={20} color={on ? color.primary : color.inputBorder} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** At most this many rows show at once; more scroll inside the list. */
const DROPDOWN_ROWS = 5;

/**
 * A field showing the chosen vault, or what to do when none is chosen yet;
 * tapping it drops the vaults down under it (above it, near the bottom of
 * the screen). The list floats over the screen in a Modal, placed by
 * measuring the field, so nothing inside a ScrollView clips it or moves.
 */
export function VaultDropdown({ choices, selected, onSelect, label, placeholder = 'Choose a vault' }: {
  choices: VaultChoice[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** What it asks, for screen readers: "Where should this go?". */
  label: string;
  placeholder?: string;
}) {
  const field = useRef<View>(null);
  const viewport = useWindowDimensions();
  const [menu, setMenu] = useState<{ top: number; left: number; width: number } | null>(null);
  const chosen = choices.find((c) => c.key === selected) ?? null;
  const menuHeight = Math.min(choices.length, DROPDOWN_ROWS) * size.row + 2;

  const open = () => {
    const node = field.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (![x, y, width, height].every(Number.isFinite) || width === 0) {
        // Could not be measured: the list across the screen, a third of the way down.
        setMenu({ top: viewport.height / 3, left: space.lg, width: viewport.width - space.lg * 2 });
        return;
      }
      const below = y + height + space.xs;
      const top = below + menuHeight <= viewport.height - space.lg
        ? below
        : Math.max(space.lg, y - space.xs - menuHeight);
      setMenu({ top, left: x, width });
    });
  };
  const close = () => setMenu(null);

  return (
    <>
      <View ref={field} collapsable={false}>
        <TouchableOpacity
          style={[styles.field, !!menu && styles.fieldOpen]}
          onPress={open}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${chosen ? chosen.name : placeholder}`}
          accessibilityHint="Opens the list of vaults"
          accessibilityState={{ expanded: !!menu }}
        >
          <View style={[styles.icon, !!chosen && styles.iconOn]}>
            <Feather name={chosen?.icon ?? 'archive'} size={16} color={chosen ? '#FFFFFF' : color.primary} />
          </View>
          <Text style={[styles.fieldText, !chosen && styles.fieldPlaceholder]} numberOfLines={1}>
            {chosen ? chosen.name : placeholder}
          </Text>
          <Feather name={menu ? 'chevron-up' : 'chevron-down'} size={20} color={color.secondary} />
        </TouchableOpacity>
      </View>
      {!!menu && (
        <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the list" />
          <View style={[styles.menu, { top: menu.top, left: menu.left, width: menu.width, maxHeight: menuHeight }]}>
            <ScrollView bounces={false} showsVerticalScrollIndicator={choices.length > DROPDOWN_ROWS}>
              {choices.map((c, i) => {
                const on = c.key === selected;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.row, i > 0 && styles.rowBorder, on && styles.rowOn]}
                    onPress={() => { onSelect(c.key); close(); }}
                    activeOpacity={0.7}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={[c.name, c.subtitle].filter(Boolean).join(', ')}
                  >
                    <View style={[styles.icon, on && styles.iconOn]}>
                      <Feather name={c.icon} size={16} color={on ? '#FFFFFF' : color.primary} />
                    </View>
                    <View style={styles.text}>
                      <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                      {!!c.subtitle && <Text style={styles.subtitle} numberOfLines={1}>{c.subtitle}</Text>}
                    </View>
                    {on && <Feather name="check" size={18} color={color.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      )}
    </>
  );
}

/** A small button showing the current choice; tapping it opens the sheet. */
export function VaultPill({ label, value, icon, onPress, light = false }: {
  /** "Search in", or nothing. */
  label?: string;
  value: string;
  icon: VaultChoice['icon'];
  onPress: () => void;
  /** On the dark header of Home. */
  light?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, light && styles.pillLight]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label ? `${label} ` : ''}${value}. Change`}
    >
      <Feather name={icon} size={14} color={light ? '#FFFFFF' : color.primary} />
      <Text style={[styles.pillText, light && styles.pillTextLight]} numberOfLines={1}>
        {label ? <Text style={[styles.pillLabel, light && styles.pillTextLight]}>{label} </Text> : null}
        {value}
      </Text>
      <Feather name="chevron-down" size={14} color={light ? '#FFFFFF' : color.primary} />
    </TouchableOpacity>
  );
}

/** The choices in a sheet from the bottom of the screen. */
export function VaultSheet({ visible, title, intro, choices, selected, onSelect, onClose }: {
  visible: boolean;
  title: string;
  intro?: string;
  choices: VaultChoice[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={size.icon} color={color.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!!intro && <Text style={styles.intro}>{intro}</Text>}
          <VaultChoices choices={choices} selected={selected} onSelect={(key) => { onSelect(key); onClose(); }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: size.row, paddingHorizontal: space.md, paddingVertical: space.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  rowOn: { backgroundColor: color.tint },
  icon: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: size.iconBox / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.tint,
  },
  iconOn: { backgroundColor: color.primary },
  text: { flex: 1, minWidth: 0 },
  name: type.label,
  subtitle: type.caption,
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.row,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: radius.control,
    backgroundColor: color.surface,
  },
  fieldOpen: { borderColor: color.primary },
  fieldText: { ...type.label, flex: 1 },
  fieldPlaceholder: { color: color.textMuted, fontWeight: '400' },
  menu: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    overflow: 'hidden',
    boxShadow: '0px 8px 24px rgba(16, 24, 40, 0.18)',
    elevation: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.inputBorder,
    backgroundColor: color.surface,
  },
  pillLight: { borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.12)' },
  pillText: { ...type.caption, color: color.primary, fontWeight: '600', flexShrink: 1 },
  pillLabel: { ...type.caption, color: color.textMuted, fontWeight: '400' },
  pillTextLight: { color: '#FFFFFF' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: space.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.border, marginTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { ...type.title, flex: 1 },
  close: { width: size.control, height: size.control, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  body: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.lg },
  intro: type.caption,
});
