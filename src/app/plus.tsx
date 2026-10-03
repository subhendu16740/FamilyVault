// Family Plus — what the paid plan gives, side by side with Free. Every
// starred feature (★) opens this page for a free family (/plus?feature=…,
// which says which feature brought them here), and so do Settings, Storage
// and a full vault. Family Plus can't be bought yet (PLUS_FOR_SALE); until it
// can, the page says so instead of offering a button that does nothing.

import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../lib/family-context';
import { useFamilyPlan, type PlusFeature } from '../lib/family-plan';
import { fetchPlanLimits } from '../lib/api';
import {
  DEFAULT_PLAN_LIMITS, PLUS_FOR_SALE, formatBytes, localPlusPrice, plusPrice, type PlanLimits,
} from '../lib/plans';
import { longDate } from '../lib/dates';
import { ScreenHeader } from '../components/screen-header';
import { Card, Muted, screenStyles } from '../components/settings-ui';
import { color, radius, space, type } from '../constants/design';

type Cell = boolean | string;

interface Row {
  label: string;
  free: Cell;
  plus: Cell;
  /** The starred feature this row is, so the page can point at it. */
  feature?: PlusFeature;
}

function rows(limits: PlanLimits): Row[] {
  return [
    { label: 'Space for documents', free: formatBytes(limits.free), plus: formatBytes(limits.plus), feature: 'storage' },
    { label: 'Add and scan documents, read in Indian languages too', free: true, plus: true },
    { label: 'Ask about your documents, by voice too', free: true, plus: true },
    { label: 'Family tree and emergency cards', free: true, plus: true },
    { label: 'Expiry and birthday reminders', free: true, plus: true },
    { label: 'Share a document by link', free: true, plus: true },
    { label: '★ Reminders page: every expiry date in one list', free: false, plus: true, feature: 'reminders' },
    { label: '★ Import documents from Gmail', free: false, plus: true, feature: 'gmail' },
  ];
}

const BROUGHT_BY: Record<PlusFeature, { icon: string; text: string }> = {
  reminders: { icon: 'clock', text: 'The Reminders page is part of Family Plus.' },
  gmail: { icon: 'mail', text: 'Import from Gmail is part of Family Plus.' },
  storage: { icon: 'hard-drive', text: 'More space for documents is part of Family Plus.' },
};

const said = (cell: Cell) => (cell === true ? 'yes' : cell === false ? 'no' : cell);

function CellView({ value, plus }: { value: Cell; plus?: boolean }) {
  if (value === true) return <Feather name="check" size={18} color="#16A34A" />;
  if (value === false) return <Feather name="minus" size={18} color="#9CA3AF" />;
  return <Text style={[styles.cellText, plus && styles.cellTextPlus]}>{value}</Text>;
}

export default function PlusScreen() {
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const { currentFamily } = useFamily();
  const { plan, paidUntil, refresh } = useFamilyPlan();
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const price = localPlusPrice();
  const broughtBy = feature && feature in BROUGHT_BY ? BROUGHT_BY[feature as PlusFeature] : null;

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    refresh(true);
    fetchPlanLimits().then((l) => { if (!cancelled) setLimits(l); });
    return () => { cancelled = true; };
  }, [refresh]));

  const familyName = currentFamily?.name;

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Family Plus" fallback="/home" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        {broughtBy && plan !== 'plus' && (
          <View style={styles.brought} accessibilityLiveRegion="polite">
            <Feather name={broughtBy.icon as any} size={16} color={color.primary} />
            <Text style={styles.broughtText}>{broughtBy.text}</Text>
          </View>
        )}

        <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroTag}>★ Family Plus</Text>
          <Text style={styles.heroTitle}>More space and more help, for the whole family</Text>
          <Text style={styles.heroPrice} accessibilityLabel={price}>
            {price.replace(' a month', '')}
            <Text style={styles.heroPer}> a month</Text>
          </Text>
          <Text style={styles.heroNote}>
            {familyName ? `One plan for everyone in ${familyName}.` : 'One plan for everyone in the family.'}
          </Text>
        </LinearGradient>

        {plan === 'plus' ? (
          <View style={[styles.state, styles.statePlus]}>
            <Feather name="check-circle" size={18} color="#15803D" />
            <Text style={[styles.stateText, { color: '#15803D' }]}>
              {familyName ?? 'Your family'} has Family Plus{paidUntil ? `, until ${longDate(new Date(paidUntil))}` : ''}.
            </Text>
          </View>
        ) : plan === 'free' ? (
          <View style={styles.state}>
            <Feather name="info" size={18} color={color.primary} />
            <Text style={styles.stateText}>{familyName ?? 'Your family'} is on Free.</Text>
          </View>
        ) : null}

        <Card style={styles.tableCard}>
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.label, styles.headText]}>What you get</Text>
            <Text style={[styles.value, styles.headText]}>Free</Text>
            <Text style={[styles.value, styles.headText, styles.headPlus]}>★ Plus</Text>
          </View>
          {rows(limits).map((r) => {
            const pointed = !!broughtBy && r.feature === feature && plan !== 'plus';
            return (
              <View
                key={r.label}
                style={[styles.row, pointed && styles.rowPointed]}
                accessible
                accessibilityLabel={`${r.label.replace('★ ', '')}: Free ${said(r.free)}, Family Plus ${said(r.plus)}`}
              >
                <Text style={styles.label}>{r.label}</Text>
                <View style={styles.value}><CellView value={r.free} /></View>
                <View style={styles.value}><CellView value={r.plus} plus /></View>
              </View>
            );
          })}
          <View
            style={[styles.row, styles.priceRow]}
            accessible
            accessibilityLabel={`Price: Free costs nothing, Family Plus ${price}`}
          >
            <Text style={[styles.label, styles.priceLabel]}>Price</Text>
            <Text style={[styles.value, styles.cellText]}>Free</Text>
            <Text style={[styles.value, styles.cellText, styles.cellTextPlus]}>{price.replace(' a month', '/mo')}</Text>
          </View>
        </Card>

        {plan !== 'plus' && (
          PLUS_FOR_SALE ? null : (
            <View style={styles.soon}>
              <Text style={styles.soonTag}>Coming soon</Text>
              <Text style={styles.soonText}>
                Family Plus can't be bought in the app yet. When it can, it is {price} for the whole family.
              </Text>
            </View>
          )
        )}

        <Card>
          <View style={styles.point}>
            <Feather name="users" size={16} color={color.primary} />
            <Text style={styles.pointText}>One plan covers everyone in the family.</Text>
          </View>
          <View style={styles.point}>
            <Feather name="shield" size={16} color={color.primary} />
            <Text style={styles.pointText}>
              If Family Plus ends, nothing is deleted. Your family keeps every document and can still read and
              search them; new ones wait until there is room.
            </Text>
          </View>
          <View style={styles.point}>
            <Feather name="globe" size={16} color={color.primary} />
            <Text style={styles.pointText}>{plusPrice('inr')} in India, {plusPrice('usd')} everywhere else.</Text>
          </View>
        </Card>

        <Muted>Reminders under the bell and on your devices reach every family, Free or Plus.</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brought: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: color.tint, borderRadius: radius.control, paddingVertical: 10, paddingHorizontal: space.md,
  },
  broughtText: { ...type.label, flex: 1, color: color.primary },
  hero: { borderRadius: radius.card, padding: space.lg, gap: space.xs },
  heroTag: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#FBD5D1', letterSpacing: 0.4 },
  heroTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', color: '#FFFFFF' },
  heroPrice: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: '#FFFFFF', marginTop: space.sm },
  heroPer: { fontSize: 15, fontWeight: '500', color: '#DCE3F0' },
  heroNote: { fontSize: 13, lineHeight: 18, color: '#DCE3F0' },
  state: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderRadius: radius.control, paddingVertical: 10, paddingHorizontal: space.md,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
  },
  statePlus: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  stateText: { ...type.label, flex: 1, color: color.primary },
  tableCard: { paddingVertical: space.sm, gap: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider,
  },
  rowPointed: { backgroundColor: '#FFF7ED', marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  headRow: { paddingTop: space.xs },
  headText: { ...type.overline },
  headPlus: { color: color.accent },
  label: { ...type.body, flex: 1, fontSize: 14, lineHeight: 20 },
  value: { width: 64, alignItems: 'center', textAlign: 'center' },
  cellText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: color.textBody, textAlign: 'center' },
  cellTextPlus: { color: color.primary },
  priceRow: { borderBottomWidth: 0 },
  priceLabel: { fontWeight: '600', color: color.text },
  soon: {
    borderRadius: radius.control, padding: space.md, gap: space.xs,
    backgroundColor: '#FBEDEB',
  },
  soonTag: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: color.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  soonText: { ...type.body, fontSize: 14, lineHeight: 20, color: color.primary },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pointText: { ...type.body, flex: 1, fontSize: 14, lineHeight: 20 },
});
