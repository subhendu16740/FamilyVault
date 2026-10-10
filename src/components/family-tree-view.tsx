// The family tree, drawn like an org chart: a couple side by side, a line
// down to a bar over their children, and each child's own family below.
//
// Lines are plain Views, no SVG. Every child column draws the two halves of
// the bar above it — the left half unless it is the first child, the right
// half unless it is the last — so the bar always runs from the first child to
// the last however wide each child's own family grows. For that to join up,
// columns carry no padding; the spacing lives on the cards.

import { useRef, type RefObject } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { KinPerson, TreeUnit, FamilyBranch } from '../../supabase/functions/_shared/kinship';
import type { PersonBadge } from '../lib/family-people';
import { color, radius, space, type } from '../constants/design';

export interface TreeViewProps {
  branch: FamilyBranch;
  meId: string | null;
  labelFor: (id: string) => string | null;
  badgeFor?: (id: string) => PersonBadge | null;
  /** Whether this person has a AskLocker account: their card carries the phone badge. */
  onAppFor?: (id: string) => boolean;
  onPressPerson: (person: KinPerson) => void;
  /** Where the viewer's own card sits, measured within `measureIn`, so the screen can scroll to it. */
  measureIn?: RefObject<View | null>;
  onMeLayout?: (centerX: number) => void;
}

const LINE = '#C7D0DE';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** The green phone on an avatar: this person has a AskLocker account. */
export const ON_APP_COLOR = '#16A34A';

/**
 * A person's initials in a circle; coral for the viewer. `onApp` adds the
 * green phone badge for someone with a AskLocker account — the tree also
 * holds people without one. Too small to read on the tiny avatars in chips,
 * so it is drawn from 28px up.
 */
export function Avatar({ name, me, size = 36, onApp = false }: { name: string; me?: boolean; size?: number; onApp?: boolean }) {
  const badge = Math.min(22, Math.max(16, Math.round(size * 0.5)));
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={me ? ['#D4807B', '#2A3D66'] : ['#2A3D66', '#4A6491']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[styles.initials, { fontSize: size >= 48 ? 18 : 13 }]}>{initials(name)}</Text>
      </LinearGradient>
      {onApp && size >= 28 && (
        <View
          style={[styles.onApp, { width: badge, height: badge, borderRadius: badge / 2, right: -badge * 0.2, bottom: -badge * 0.15 }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Feather name="smartphone" size={Math.round(badge * 0.58)} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

/** One line that explains the badge, shown above the tree. */
export function OnAppKey() {
  return (
    <View style={styles.key} accessible accessibilityLabel="A green phone means they have an AskLocker account.">
      <View style={[styles.onApp, styles.keyBadge]}>
        <Feather name="smartphone" size={9} color="#FFFFFF" />
      </View>
      <Text style={styles.keyText}>On AskLocker</Text>
    </View>
  );
}

function PersonCard({ person, props }: { person: KinPerson; props: TreeViewProps }) {
  const me = person.id === props.meId;
  // The relation from where the viewer stands, and the family's own nickname (045).
  const label = [me ? 'You' : props.labelFor(person.id), person.nickname ? `"${person.nickname}"` : null]
    .filter(Boolean).join(' · ') || null;
  const badge = props.badgeFor?.(person.id) ?? null;
  const onApp = props.onAppFor?.(person.id) ?? false;
  const ref = useRef<View>(null);
  const measure = () => {
    const box = props.measureIn?.current;
    if (!me || !box || !ref.current || !props.onMeLayout) return;
    ref.current.measureLayout(box as any, (x, _y, w) => props.onMeLayout?.(x + w / 2), () => undefined);
  };
  return (
    <TouchableOpacity
      ref={ref as any}
      onLayout={me ? measure : undefined}
      style={[styles.card, me && styles.cardMe]}
      onPress={() => props.onPressPerson(person)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={[person.name, label, onApp ? 'on AskLocker' : null, badge?.text].filter(Boolean).join(', ')}
    >
      <Avatar name={person.name} me={me} onApp={onApp} />
      <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
      {!!label && <Text style={styles.relation} numberOfLines={2}>{label}</Text>}
      {!!badge && (
        <View style={[styles.badge, badge.level === 'over' ? styles.badgeOver : styles.badgeSoon]}>
          <Text style={[styles.badgeText, badge.level === 'over' ? styles.badgeTextOver : styles.badgeTextSoon]} numberOfLines={1}>
            {badge.text}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function Unit({ unit, props }: { unit: TreeUnit; props: TreeViewProps }) {
  return (
    <View style={styles.unit}>
      <PersonCard person={unit.person} props={props} />
      {unit.spouses.map((s) => (
        <View key={s.id} style={styles.couple}>
          <View style={styles.marriage} />
          <PersonCard person={s} props={props} />
        </View>
      ))}
    </View>
  );
}

function Children({ units, props, fromParent }: { units: TreeUnit[]; props: TreeViewProps; fromParent: boolean }) {
  return (
    <>
      {fromParent && <View style={styles.down} />}
      <View style={styles.row}>
        {units.map((child, i) => (
          <View key={child.person.id} style={styles.column}>
            <View style={styles.bar}>
              <View style={[styles.half, i > 0 && styles.lineOn]} />
              <View style={[styles.half, i < units.length - 1 && styles.lineOn]} />
            </View>
            <View style={styles.down} />
            <Branch unit={child} props={props} />
          </View>
        ))}
      </View>
    </>
  );
}

function Branch({ unit, props }: { unit: TreeUnit; props: TreeViewProps }) {
  return (
    <View style={styles.branch}>
      <Unit unit={unit} props={props} />
      {unit.children.length > 0 && <Children units={unit.children} props={props} fromParent />}
    </View>
  );
}

export function FamilyTreeView(props: TreeViewProps) {
  const { roots } = props.branch;
  // Brothers and sisters whose parents are not in the tree: joined by the bar alone.
  if (roots.length > 1) {
    return (
      <View style={styles.branch}>
        <Children units={roots} props={props} fromParent={false} />
      </View>
    );
  }
  return <Branch unit={roots[0]} props={props} />;
}

const CARD = 112;

const styles = StyleSheet.create({
  branch: { alignItems: 'center' },
  unit: { flexDirection: 'row', alignItems: 'center', marginHorizontal: space.xs },
  couple: { flexDirection: 'row', alignItems: 'center' },
  marriage: { width: 12, height: 2, backgroundColor: LINE },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { alignItems: 'center' },
  bar: { flexDirection: 'row', alignSelf: 'stretch', height: 2 },
  half: { flex: 1 },
  lineOn: { backgroundColor: LINE },
  down: { width: 2, height: 14, backgroundColor: LINE },
  card: {
    width: CARD,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.sm,
    paddingHorizontal: 6,
    marginVertical: 0,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  cardMe: { borderColor: color.accent, borderWidth: 2 },
  initials: { color: '#FFFFFF', fontWeight: '700' },
  onApp: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_APP_COLOR, borderWidth: 2, borderColor: '#FFFFFF',
  },
  key: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' },
  keyBadge: { position: 'relative', width: 18, height: 18, borderRadius: 9 },
  keyText: { ...type.caption, color: color.textMuted },
  name: { ...type.caption, color: color.text, fontWeight: '600', textAlign: 'center' },
  relation: { ...type.meta, color: color.textMuted, textAlign: 'center' },
  badge: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, maxWidth: CARD - 12 },
  badgeSoon: { backgroundColor: '#FFF7E6' },
  badgeOver: { backgroundColor: '#FEF2F2' },
  badgeText: { fontSize: 12, lineHeight: 16 },
  badgeTextSoon: { color: '#B45309' },
  badgeTextOver: { color: '#B91C1C' },
});
