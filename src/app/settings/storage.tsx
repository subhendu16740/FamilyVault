// Settings › Storage — each family's plan, what it may keep and what it
// holds, and what you have added yourself. Every plan has a limit (038): the
// server refuses new documents once a family is at its limit, and this screen
// says so before anyone meets the refusal. Before 038 it shows the free limit,
// unenforced, from the documents' own sizes (see src/lib/plans.ts).

import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import {
  fetchPlanLimits, fetchStorageStatus, fetchStorageUsage, type FamilyPlanStatus, type FamilyStorage,
} from '../../lib/api';
import {
  DEFAULT_PLAN_LIMITS, FREE_STORAGE_BYTES, PLUS_FOR_SALE, formatBytes, storageFullMessage, storageLevel,
  type PlanLimits, type StorageLevel,
} from '../../lib/plans';
import { longDate } from '../../lib/dates';
import { ScreenHeader, PlusTag } from '../../components/screen-header';
import { Card, CardTitle, Body, Muted, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, space, type } from '../../constants/design';

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

const BAR: Record<StorageLevel, string> = { ok: color.secondary, nearly: '#D97706', full: color.danger };

function planName(status: FamilyPlanStatus | null): string {
  if (!status || status.plan === 'free') return 'Free';
  return status.period === 'monthly' ? 'Family Plus · monthly' : 'Family Plus · yearly';
}

export default function StorageScreen() {
  const { user } = useAuth();
  const { families } = useFamily();
  const [usage, setUsage] = useState<FamilyStorage[] | null>(null);
  // Each family's plan and room as the server counts them; null before 038.
  const [plans, setPlans] = useState<Record<string, FamilyPlanStatus | null>>({});
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_PLAN_LIMITS);
  const [error, setError] = useState<string | null>(null);
  const familyKey = families.map((f) => f.family_id).join(',');

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    const list = families.map((f) => ({ id: f.families.id, name: f.families.name }));
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
      .catch((err) => { if (!cancelled) { setUsage([]); setError(err?.message ?? 'Could not add up your documents.'); } });
    return () => { cancelled = true; };
  }, [user?.id, familyKey]));

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
              <Body>Each family's documents share its plan's space. Every plan has a limit.</Body>
              <View style={styles.planRows}>
                <View style={styles.planRow}>
                  <Text style={styles.planRowName}>Free</Text>
                  <Text style={styles.planRowSize}>{formatBytes(limits.free)}</Text>
                </View>
                <View style={styles.planRow}>
                  <Text style={styles.planRowName}>Family Plus · monthly</Text>
                  <Text style={styles.planRowSize}>{formatBytes(limits.monthly)}</Text>
                </View>
                <View style={styles.planRow}>
                  <Text style={styles.planRowName}>Family Plus · yearly</Text>
                  <Text style={styles.planRowSize}>{formatBytes(limits.yearly)}</Text>
                </View>
              </View>
              {!PLUS_FOR_SALE && (
                <View style={styles.plusRow}>
                  <PlusTag />
                  <Text style={styles.plusText}>Family Plus can't be bought in the app yet. Coming soon.</Text>
                </View>
              )}
            </Card>

            <Text style={styles.sectionTitle}>Your families</Text>
            {usage.length === 0 && <Muted>You are not in a family yet.</Muted>}
            {usage.map((f) => {
              const status = plans[f.familyId] ?? null;
              // As the server counts it once 038 is applied; the documents' sizes before.
              const used = status ? status.usedBytes : f.bytes;
              const limit = status ? status.limitBytes : FREE_STORAGE_BYTES;
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
                  <Muted>You added {formatBytes(f.yourBytes)} of it ({documents(f.yourDocuments)}).</Muted>
                  {level !== 'ok' && (
                    <View style={[styles.note, level === 'full' ? styles.noteFull : styles.noteNearly]}>
                      <Text style={[styles.noteText, level === 'full' ? styles.noteTextFull : styles.noteTextNearly]}>
                        {!status
                          // Before 038: said, not kept.
                          ? `This family has used ${level === 'full' ? 'all of' : 'most of'} its free ${formatBytes(limit)}.`
                          : level === 'full'
                            ? storageFullMessage(status, 0, limits)
                            : `Nearly full: ${formatBytes(limit - used)} left. When it is full, new documents can't be added.`}
                      </Text>
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

            <Muted>Sizes are of the files as they were added. Deleting a document frees its space.</Muted>
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
  planRowName: type.label,
  planRowSize: { ...type.label, color: color.primary, fontWeight: '600' },
  plusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  plusText: { ...type.caption, flex: 1, color: color.textBody, marginTop: 2 },
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
