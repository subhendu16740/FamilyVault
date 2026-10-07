// Family Plus — what the paid plan gives, side by side with Free. Every
// starred feature (★) opens this page for a free family (/plus?feature=…,
// which says which feature brought them here), and so do Settings, Storage
// and a full vault. Where payments are switched on (044: this project's
// Razorpay keys are set), any member pays here for a month or a year, and
// each payment adds that time; until then the page says "Coming soon"
// instead of offering a button that does nothing.

import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../lib/family-context';
import { vaultName } from '../lib/vaults';
import { useFamilyPlan, usePaymentsStatus, type PlusFeature } from '../lib/family-plan';
import { PaymentError, createPlusOrder, fetchPlanLimits, verifyPlusPayment } from '../lib/api';
import { checkoutSupported, openCheckout } from '../lib/razorpay';
import {
  DEFAULT_PLAN_LIMITS, formatBytes, localCurrency, localPlusAmount, localPlusPrice, localPlusYearlyOffer,
  localPlusYearlySaving, plusPrice, plusYearlyOffer, type PlanLimits,
} from '../lib/plans';
import { longDate } from '../lib/dates';
import { ScreenHeader } from '../components/screen-header';
import { TwelveMonthsPrice, YearlyPrice } from '../components/plus-price';
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

// "10 each" (per person, 043), or ✓ for a plan with no limit on voice chats.
const voiceCell = (n: number | null): Cell => (n == null ? true : `${n} each`);

function rows(limits: PlanLimits): Row[] {
  return [
    { label: 'Space for documents', free: formatBytes(limits.free), plus: formatBytes(limits.plus), feature: 'storage' },
    { label: 'Members who sign in', free: String(limits.members.free), plus: String(limits.members.plus) },
    { label: 'Add and scan documents, read in Indian languages too', free: true, plus: true },
    { label: 'Ask about your documents', free: true, plus: true },
    { label: 'Family tree and emergency cards', free: true, plus: true },
    { label: 'Expiry and birthday reminders', free: true, plus: true },
    { label: 'Share a document by link', free: true, plus: true },
    {
      label: '★ Voice chats: ask by voice, hear the answer', free: voiceCell(limits.voiceAnswers.free), plus: voiceCell(limits.voiceAnswers.plus),
      feature: 'voice',
    },
    { label: '★ Reminders page: every expiry date in one list', free: false, plus: true, feature: 'reminders' },
    { label: '★ Import documents from Gmail', free: false, plus: true, feature: 'gmail' },
  ];
}

const BROUGHT_BY: Record<PlusFeature, { icon: string; text: string }> = {
  reminders: { icon: 'clock', text: 'The Reminders page is part of Family Plus.' },
  gmail: { icon: 'mail', text: 'Import from Gmail is part of Family Plus.' },
  storage: { icon: 'hard-drive', text: 'More space for documents and saved chats is part of Family Plus.' },
  voice: { icon: 'mic', text: 'Asking by voice and hearing every answer, with no limit, is part of Family Plus.' },
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
  const { plan, paidUntil, removalAt, refresh } = useFamilyPlan();
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const monthly = localPlusPrice('monthly');
  // "₹1,100 a year instead of ₹1,200": what a screen reader hears for <YearlyPrice />.
  const yearlyOffer = localPlusYearlyOffer();
  const broughtBy = feature && feature in BROUGHT_BY ? BROUGHT_BY[feature as PlusFeature] : null;

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    refresh(true);
    fetchPlanLimits().then((l) => { if (!cancelled) setLimits(l); });
    return () => { cancelled = true; };
  }, [refresh]));

  const familyName = currentFamily ? vaultName(currentFamily) : undefined;

  // ─── Paying (044) ───────────────────────────────────────
  const payments = usePaymentsStatus();
  const currency = localCurrency() === 'inr' ? 'INR' : 'USD';
  const canPayHere = !!payments?.currencies.includes(currency);
  const [paying, setPaying] = useState<'monthly' | 'yearly' | null>(null);
  const [payNote, setPayNote] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null);

  const pay = async (period: 'monthly' | 'yearly') => {
    if (!currentFamily || paying) return;
    setPaying(period);
    setPayNote(null);
    try {
      const order = await createPlusOrder(currentFamily.id, period, currency);
      const result = await openCheckout(order);
      if (result.status === 'closed' || result.status === 'unsupported') return;
      if (result.status === 'failed') {
        setPayNote({ tone: 'error', text: `${result.reason} Nothing was charged for Family Plus.` });
        return;
      }
      setPayNote({ tone: 'info', text: 'Payment received. Switching on Family Plus…' });
      try {
        const { paidUntil } = await verifyPlusPayment(result);
        await refresh(true);
        setPayNote({
          tone: 'ok',
          text: `Thank you! ${familyName ?? 'Your family'} has Family Plus until ${longDate(new Date(paidUntil))}.`,
        });
      } catch (err) {
        if (err instanceof PaymentError && err.status === 'not_paid') {
          setPayNote({ tone: 'error', text: err.message });
          return;
        }
        // Razorpay tells the server too (its webhook), so a payment that went
        // through switches Plus on even when this check could not finish.
        setPayNote({
          tone: 'info',
          text: "We're confirming your payment with Razorpay. If it went through, Family Plus switches on within a few minutes — there's no need to pay again.",
        });
        setTimeout(() => { refresh(true); }, 30_000);
      }
    } catch (err) {
      setPayNote({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setPaying(null);
    }
  };

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
          <Text style={styles.heroPrice} accessibilityLabel={monthly}>
            {localPlusAmount('monthly')}
            <Text style={styles.heroPer}> a month</Text>
          </Text>
          <View style={styles.heroYearRow}>
            <Text style={styles.heroYear} accessibilityLabel={`or ${yearlyOffer}`}>
              or <YearlyPrice onDark />
            </Text>
            <View style={styles.heroSave}>
              <Text style={styles.heroSaveText}>{localPlusYearlySaving()}</Text>
            </View>
          </View>
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
        ) : plan === 'free' && removalAt ? (
          <View style={[styles.state, styles.stateEnded]}>
            <Feather name="alert-triangle" size={18} color="#B91C1C" />
            <Text style={[styles.stateText, { color: '#B91C1C' }]}>
              Family Plus has ended for {familyName ?? 'your family'}. On {longDate(new Date(removalAt))}, the newest
              documents above {formatBytes(limits.free)} will be removed, unless Family Plus is renewed or documents are
              deleted to get under {formatBytes(limits.free)}.
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
            <View style={styles.value} accessible accessibilityLabel="Family Plus, monthly">
              <Text style={[styles.headText, styles.headPlus]}>★ Plus</Text>
              <Text style={[styles.headText, styles.headPlus]}>Monthly</Text>
            </View>
            <View style={styles.value} accessible accessibilityLabel="Family Plus, yearly">
              <Text style={[styles.headText, styles.headPlus]}>★ Plus</Text>
              <Text style={[styles.headText, styles.headPlus]}>Yearly</Text>
            </View>
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
                <View style={styles.value}><CellView value={r.plus} plus /></View>
              </View>
            );
          })}
          <View
            style={[styles.row, styles.priceRow]}
            accessible
            accessibilityLabel={`Price: Free costs nothing. Family Plus monthly, ${monthly}. Family Plus yearly, ${yearlyOffer}.`}
          >
            <Text style={[styles.label, styles.priceLabel]}>Price</Text>
            <Text style={[styles.value, styles.cellText]}>Free</Text>
            <View style={styles.value}>
              {/* As tall as the crossed-out price, so ₹100 sits level with ₹1,100. */}
              <View style={styles.cellWasSpace} />
              <Text style={[styles.cellText, styles.cellTextPlus]}>{localPlusAmount('monthly')}</Text>
              <Text style={styles.cellPer}>a month</Text>
            </View>
            <View style={styles.value}>
              <TwelveMonthsPrice style={styles.cellWas} />
              <Text style={[styles.cellText, styles.cellTextPlus]}>{localPlusAmount('yearly')}</Text>
              <Text style={styles.cellPer}>a year</Text>
            </View>
          </View>
        </Card>

        {payments?.available && (
          <Card style={styles.payCard}>
            <Text style={styles.payTitle}>{plan === 'plus' ? 'Add more time' : 'Get Family Plus'}</Text>
            {!checkoutSupported ? (
              <Text style={styles.payFine}>Paying for Family Plus is on the AskLocker web app for now.</Text>
            ) : !canPayHere ? (
              <Text style={styles.payFine}>Paying from outside India is coming soon.</Text>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.payBtn, styles.payBtnMain, !!paying && styles.payBtnBusy]}
                  onPress={() => pay('yearly')}
                  disabled={!!paying}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${localPlusAmount('yearly')} for a year of Family Plus, ${localPlusYearlySaving()}`}
                >
                  {paying === 'yearly' ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Text style={styles.payBtnText}>Pay {localPlusAmount('yearly')} for 1 year</Text>
                      <Text style={styles.payBtnSave}>{localPlusYearlySaving()}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.payBtn, styles.payBtnOther, !!paying && styles.payBtnBusy]}
                  onPress={() => pay('monthly')}
                  disabled={!!paying}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${localPlusAmount('monthly')} for a month of Family Plus`}
                >
                  {paying === 'monthly' ? <ActivityIndicator color={color.primary} /> : (
                    <Text style={styles.payBtnTextOther}>Pay {localPlusAmount('monthly')} for 1 month</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.payFine}>
                  By UPI, card or net banking, through Razorpay. Nothing renews by itself:{' '}
                  {plan === 'plus' ? 'the time is added to what is left.' : 'you pay again only when you want more time.'}
                </Text>
              </>
            )}
            {payNote && (
              <Text
                style={[styles.payMsg, payNote.tone === 'ok' ? styles.payMsgOk : payNote.tone === 'error' ? styles.payMsgError : null]}
                accessibilityLiveRegion="polite"
              >
                {payNote.text}
              </Text>
            )}
          </Card>
        )}

        {plan !== 'plus' && (
          !payments || payments.available ? null : (
            <View style={styles.soon}>
              <Text style={styles.soonTag}>Coming soon</Text>
              <Text
                style={styles.soonText}
                accessibilityLabel={`Family Plus can't be bought in the app yet. When it can, it is ${monthly} or ${yearlyOffer} for the whole family.`}
              >
                Family Plus can't be bought in the app yet. When it can, it is {monthly} or <YearlyPrice /> for the
                whole family.
              </Text>
            </View>
          )
        )}

        <Card>
          <View style={styles.point}>
            <Feather name="users" size={16} color={color.primary} />
            <Text style={styles.pointText}>
              One plan covers the whole family: up to {limits.members.plus} members sign in, and everyone can be in
              the family tree, with or without an account.
            </Text>
          </View>
          <View style={styles.point}>
            <Feather name="clock" size={16} color={color.primary} />
            <Text style={styles.pointText}>
              If Family Plus ends while your family holds more than the free {formatBytes(limits.free)}, it has{' '}
              {limits.graceDays} days to renew, or to delete documents to get under {formatBytes(limits.free)}. After
              that, the newest documents above {formatBytes(limits.free)} are removed. We remind you when it ends, a
              week before and the day before.
            </Text>
          </View>
          <View style={styles.point}>
            <Feather name="globe" size={16} color={color.primary} />
            <Text
              style={styles.pointText}
              accessibilityLabel={`In India: ${plusPrice('inr')} or ${plusYearlyOffer('inr')}. Elsewhere: ${plusPrice('usd')} or ${plusYearlyOffer('usd')}.`}
            >
              In India: {plusPrice('inr')} or <YearlyPrice currency="inr" />.{'\n'}
              Elsewhere: {plusPrice('usd')} or <YearlyPrice currency="usd" />.
            </Text>
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
  heroYearRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  heroYear: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: '#FFFFFF' },
  heroSave: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, backgroundColor: '#FBD5D1' },
  heroSaveText: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#8A3B35' },
  heroNote: { fontSize: 13, lineHeight: 18, color: '#DCE3F0' },
  state: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderRadius: radius.control, paddingVertical: 10, paddingHorizontal: space.md,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
  },
  statePlus: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  stateEnded: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', alignItems: 'flex-start' },
  stateText: { ...type.label, flex: 1, color: color.primary },
  tableCard: { paddingVertical: space.sm, gap: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider,
  },
  rowPointed: { backgroundColor: '#FFF7ED', marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  headRow: { paddingTop: space.xs },
  // Not uppercase like an overline: "MONTHLY" is wider than its column.
  headText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.textMuted },
  headPlus: { color: color.accent },
  label: { ...type.body, flex: 1, fontSize: 14, lineHeight: 20 },
  value: { width: 60, alignItems: 'center', textAlign: 'center' },
  cellText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: color.textBody, textAlign: 'center' },
  cellTextPlus: { color: color.primary },
  cellWas: { fontSize: 12, lineHeight: 16, color: color.textMuted, textAlign: 'center' },
  cellWasSpace: { height: 16 },
  cellPer: { fontSize: 12, lineHeight: 16, color: color.textMuted, textAlign: 'center' },
  priceRow: { borderBottomWidth: 0 },
  priceLabel: { fontWeight: '600', color: color.text },
  payCard: { gap: space.sm },
  payTitle: { ...type.heading },
  payBtn: {
    minHeight: 52, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
    paddingVertical: space.sm, paddingHorizontal: space.md,
  },
  payBtnMain: { backgroundColor: color.primary },
  payBtnOther: { borderWidth: 1, borderColor: color.primary, backgroundColor: color.surface },
  payBtnBusy: { opacity: 0.6 },
  payBtnText: { ...type.button, color: '#FFFFFF' },
  payBtnSave: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#FBD5D1' },
  payBtnTextOther: { ...type.button, color: color.primary },
  payFine: { fontSize: 13, lineHeight: 18, color: color.textMuted },
  payMsg: { ...type.label, color: color.primary },
  payMsgOk: { color: '#15803D' },
  payMsgError: { color: '#B91C1C' },
  soon: {
    borderRadius: radius.control, padding: space.md, gap: space.xs,
    backgroundColor: '#FBEDEB',
  },
  soonTag: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: color.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  soonText: { ...type.body, fontSize: 14, lineHeight: 20, color: color.primary },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pointText: { ...type.body, flex: 1, fontSize: 14, lineHeight: 20 },
});
