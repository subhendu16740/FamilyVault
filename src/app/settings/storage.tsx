// Settings › Storage — each family's plan, what it may keep and what it
// holds, and what you have added yourself. Every plan has a limit (038): the
// server refuses new documents once a family is at its limit, and this screen
// says so before anyone meets the refusal. Before 038 it shows the free limit,
// unenforced, from the documents' own sizes (see src/lib/plans.ts). Whether
// Family Plus can be bought is the payments function's answer (044).

import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { isPersonalVault, vaultName } from '../../lib/vaults';
import {
  fetchPlanLimits, fetchStorageStatus, fetchStorageUsage, type FamilyPlanStatus, type FamilyStorage,
} from '../../lib/api';
import {
  DEFAULT_PLAN_LIMITS, PLUS_FOR_SALE, formatBytes, localPlusPrice, localPlusPrices,
  localPlusYearlyOffer, storageFullMessage, storageLevel, type PlanLimits, type StorageLevel,
} from '../../lib/plans';
import { longDate } from '../../lib/dates';
import { plusPage, usePaymentsStatus } from '../../lib/family-plan';
import { ScreenHeader, PlusTag } from '../../components/screen-header';
import { YearlyPrice } from '../../components/plus-price';
import { Card, CardTitle, Body, Muted, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, size, space, type } from '../../constants/design';

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

const BAR: Record<StorageLevel, string> = { ok: color.secondary, nearly: '#D97706', full: color.danger };

function planName(status: FamilyPlanStatus | null): string {
  return status?.plan === 'plus' ? 'Family Plus' : 'Free';
}

export default function StorageScreen() {
  const { user } = useAuth();
  const { families } = useFamily();
  const [usage, setUsage] = useState<FamilyStorage[] | null>(null);
  // Each family's plan and room as the server counts them; null before 038.
  const [plans, setPlans] = useState<Record<string, FamilyPlanStatus | null>>({});
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const [error, setError] = useState<string | null>(null);
  const payments = usePaymentsStatus();
  const familyKey = families.map((f) => f.family_id).join(',');

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    const list = families.map((f) => ({ id: f.families.id, name: vaultName(f.families) }));
    Promise.all([
      fetchStorageUsage(list, user.id),
      Promise.all(list.map((f) => fetchStorageStatus(f.id).catch(() => null))),
      fetchPlanLimits(),
    ])
      .then(([u, statuses, l]) => {
        if (cancelled) return;
        setUsage(u);
        setPlans(Object.fromEntries(list.map((f, i) => [f.id, statuses[i]])));
        setLimits(l);
      })
      .catch((err) => { if (!cancelled) { setUsage([]); setError(err?.message ?? "Couldn't add up your storage."); } });
    return () => { cancelled = true; };
  }, [user?.id, familyKey]));

  const price = localPlusPrices();
  // Which vaults are personal (046), for the free limit before the server says (048).
  const personalIds = new Set(families.filter((f) => isPersonalVault(f.families)).map((f) => f.families.id));
  const yourBytes = usage?.reduce((sum, f) => sum + f.yourBytes, 0) ?? 0;
  const yourDocs = usage?.reduce((sum, f) => sum + f.yourDocuments, 0) ?? 0;

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Storage" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        {usage === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.primary} />
            <Muted>Adding up your documents…</Muted>
          </View>
        ) : (
          <>
            {error && <Status kind="error">{error}</Status>}

            <Card>
              <CardTitle icon="hard-drive">Plans</CardTitle>
              <Body>
                Documents and saved chats share each vault's space. Every plan has a limit.
              </Body>
              <View style={styles.planRows}>
                <View style={styles.planRow}>
                  <View style={styles.planRowText}>
                    <Text style={styles.planRowName}>Free</Text>
                    <Text style={styles.planRowPrice}>{formatBytes(limits.freePersonal)} for your personal vault</Text>
                  </View>
                  <Text style={styles.planRowSize}>{formatBytes(limits.free)}</Text>
                </View>
                <View style={styles.planRow}>
                  <View style={styles.planRowText}>
                    <Text style={styles.planRowName}>★ Family Plus</Text>
                    <Text
                      style={styles.planRowPrice}
                      accessibilityLabel={`${localPlusPrice('monthly')} or ${localPlusYearlyOffer()}`}
                    >
                      {localPlusPrice('monthly')} or <YearlyPrice />
                    </Text>
                  </View>
                  <Text style={styles.planRowSize}>{formatBytes(limits.plus)}</Text>
                </View>
              </View>
              {payments && !payments.available && (
                <View style={styles.plusRow}>
                  <PlusTag link />
                  <Text style={styles.plusText}>Family Plus is coming soon.</Text>
                </View>
              )}
              <TouchableOpacity style={styles.compare} onPress={() => router.push('/plus' as any)} accessibilityRole="link">
                <Text style={styles.compareText}>Compare Free and Family Plus</Text>
                <Feather name="chevron-right" size={16} color={color.primary} />
              </TouchableOpacity>
            </Card>

            <Text style={styles.sectionTitle}>Your vaults</Text>
            {usage.length === 0 && <Muted>You're not in a family yet.</Muted>}
            {usage.map((f) => {
              const status = plans[f.familyId] ?? null;
              // As the server counts it once 038 is applied; the documents' sizes before.
              const used = status ? status.usedBytes : f.bytes;
              const limit = status ? status.limitBytes : personalIds.has(f.familyId) ? limits.freePersonal : limits.free;
              const level = storageLevel(used, limit);
              const percent = Math.min(100, Math.round((used / limit) * 100));
              const isPlus = status?.plan === 'plus';
              return (
                <Card key={f.familyId}>
                  <View style={styles.familyRow}>
                    <Text style={styles.familyName} numberOfLines={2}>{f.name}</Text>
                    <Text style={styles.familyBytes}>
                      {formatBytes(used)}
                      <Text style={styles.ofFree}> of {formatBytes(limit)}</Text>
                    </Text>
                  </View>
                  <View style={styles.planBadgeRow}>
                    <View style={[styles.planBadge, isPlus && styles.planBadgePlus]}>
                      <Text style={[styles.planBadgeText, isPlus && styles.planBadgeTextPlus]}>
                        {isPlus ? '★ ' : ''}{planName(status)}
                      </Text>
                    </View>
                    {isPlus && status?.paidUntil && (
                      <Text style={styles.until}>until {longDate(new Date(status.paidUntil))}</Text>
                    )}
                  </View>
                  <View
                    style={styles.bar}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${f.name}: ${formatBytes(used)} of ${formatBytes(limit)} used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <View
                      style={[
                        styles.barFill,
                        { width: `${used > 0 ? Math.max(2, percent) : 0}%`, backgroundColor: BAR[level] },
                      ]}
                    />
                  </View>
                  <Muted>
                    {used >= limit ? 'No space left' : `${formatBytes(limit - used)} left`}
                    {' · '}{documents(f.documents)}
                  </Muted>
                  <Muted>You added {formatBytes(f.yourBytes)} ({documents(f.yourDocuments)}).</Muted>
                  {!!status?.chatsBytes && <Muted>Saved chats use {formatBytes(status.chatsBytes)}.</Muted>}
                  {level !== 'ok' && (
                    <View style={[styles.note, level === 'full' ? styles.noteFull : styles.noteNearly]}>
                      <Text style={[styles.noteText, level === 'full' ? styles.noteTextFull : styles.noteTextNearly]}>
                        {!status
                          // Before 038: said, not kept.
                          ? `This ${personalIds.has(f.familyId) ? 'vault' : 'family'} has used ${level === 'full' ? 'all of' : 'most of'} its free ${formatBytes(limit)}.`
                          : level === 'full'
                            ? storageFullMessage(status, 0, {
                                limits,
                                price,
                                // Plus has ended and the family is above the free limit (040).
                                removalOn: status.removalAt ? longDate(new Date(status.removalAt)) : undefined,
                                forSale: payments?.available ?? PLUS_FOR_SALE,
                              })
                            : "Nearly full. When it's full, you can't add documents or save chats."}
                      </Text>
                      {!isPlus && (
                        <TouchableOpacity onPress={() => router.push(plusPage('storage') as any)} accessibilityRole="link">
                          <Text style={[styles.noteLink, level === 'full' ? styles.noteTextFull : styles.noteTextNearly]}>See Family Plus ›</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </Card>
              );
            })}

            <Text style={styles.sectionTitle}>What you have added</Text>
            <Card>
              <Text style={styles.big}>{formatBytes(yourBytes)}</Text>
              <Muted>
                {documents(yourDocs)}, in {usage.length} {usage.length === 1 ? 'family' : 'families'}
              </Muted>
            </Card>

            <Muted>Saved chats count too. Delete a document or chat to free space.</Muted>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: 40 },
  planRows: { gap: space.xs },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 },
  planRowText: { flex: 1 },
  planRowName: type.label,
  planRowPrice: type.caption,
  planRowSize: { ...type.label, color: color.primary, fontWeight: '600' },
  plusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  plusText: { ...type.caption, flex: 1, color: color.textBody, marginTop: 2 },
  compare: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: size.control, borderTopWidth: 1, borderTopColor: color.divider, marginTop: -space.xs,
  },
  compareText: { ...type.label, color: color.primary },
  noteLink: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: space.xs },
  big: { fontSize: 22, lineHeight: 28, fontWeight: '600', color: color.primary },
  sectionTitle: { ...type.overline, marginTop: space.sm, marginLeft: space.xs },
  familyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  familyName: { ...type.heading, flex: 1 },
  familyBytes: { ...type.heading, color: color.primary },
  ofFree: { ...type.caption, color: color.textMuted },
  planBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  planBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: color.divider },
  planBadgePlus: { backgroundColor: '#FEF3C7' },
  planBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.textBody },
  planBadgeTextPlus: { color: '#B45309' },
  until: type.caption,
  bar: { height: 8, borderRadius: 4, backgroundColor: '#EEF2F8', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  note: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: space.md, borderWidth: 1 },
  noteNearly: { backgroundColor: '#FFF7E6', borderColor: '#F5D9A0' },
  noteFull: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  noteText: { fontSize: 14, lineHeight: 20 },
  noteTextNearly: { color: '#7A5200' },
  noteTextFull: { color: '#B91C1C' },
});
