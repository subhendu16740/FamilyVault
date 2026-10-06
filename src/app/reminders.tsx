// Reminders — every document in the family with an expiry date, soonest
// first. AskLocker reminds every member 90, 30 and 7 days before and on the
// day (migration 034): under the bell, and as a notification on any device
// where they turned reminders on — every family, Free or Plus. This page, the
// list, is part of Family Plus (★ in the menu): a free family is sent to the
// Family Plus page instead, here too in case it arrives by a link or a refresh.

import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../lib/family-context';
import { vaultName } from '../lib/vaults';
import { fetchExpiringDocuments, type ExpiringDocument } from '../lib/api';
import { plusPage, useFamilyPlan } from '../lib/family-plan';
import { expiryPhrase, longDate } from '../lib/dates';
import { ScreenHeader, PlusTag } from '../components/screen-header';
import { color, radius, shadow, size, space, type } from '../constants/design';

export default function RemindersScreen() {
  const { currentFamily } = useFamily();
  const { isFree } = useFamilyPlan();
  const [items, setItems] = useState<ExpiringDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (isFree) return;
    if (!currentFamily) { setItems([]); return; }
    setError(null);
    fetchExpiringDocuments(currentFamily.id)
      .then((found) => { if (!cancelled) setItems(found); })
      .catch((err) => { if (!cancelled) { setItems([]); setError(err?.message ?? 'Could not load your documents.'); } });
    return () => { cancelled = true; };
  }, [currentFamily?.id, isFree]));

  if (isFree) return <Redirect href={plusPage('reminders') as any} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reminders" right={<PlusTag link />} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.plusCard}>
          <Text style={styles.plusCardTag}>★ Family Plus</Text>
          <Text style={styles.plusCardText}>
            AskLocker reminds the whole family 90, 30 and 7 days before a passport, licence or policy expires, and on the day.
          </Text>
          <Text style={styles.plusCardNote}>
            Reminders appear under the bell on Home{Platform.OS === 'web' ? ', and as notifications on any phone or computer where you turn them on' : ''}, for every family.
            This page, with every expiry date in one list, is part of Family Plus.
          </Text>
          {Platform.OS === 'web' && (
            <TouchableOpacity
              style={styles.plusCardLink}
              onPress={() => router.push('/settings/notifications' as any)}
              accessibilityRole="button"
            >
              <Feather name="bell" size={16} color={color.primary} />
              <Text style={styles.plusCardLinkText}>Get them on this device</Text>
              <Feather name="chevron-right" size={16} color={color.primary} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionTitle}>
          {currentFamily ? `Expiry dates in ${vaultName(currentFamily)}` : 'Expiry dates'}
        </Text>

        {items === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.primary} />
            <Text style={styles.muted}>Looking through your documents…</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Could not load your documents</Text>
            <Text style={styles.muted}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="calendar" size={24} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>No expiry dates found yet</Text>
            <Text style={styles.muted}>
              When a passport, licence or policy with an expiry date is added, it shows here.
            </Text>
          </View>
        ) : (
          items.map((item) => {
            const urgent = item.daysLeft <= 30;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push(`/document/${item.id}` as any)}
                accessibilityRole="button"
                accessibilityHint="Opens the document"
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.fileName}</Text>
                  {!!item.memberName && <Text style={styles.muted}>{item.memberName}</Text>}
                  <Text style={[styles.rowWhen, urgent && styles.rowWhenUrgent]}>
                    {expiryPhrase(item.daysLeft)} · {longDate(item.expiry)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color="#9CA3AF" />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  plusCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.xs,
    borderWidth: 1,
    borderColor: '#F3D3CF',
    ...shadow.card,
  },
  plusCardTag: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: color.accent },
  plusCardText: type.body,
  plusCardNote: type.caption,
  plusCardLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: size.control, marginTop: space.xs },
  plusCardLinkText: { ...type.label, color: color.primary, fontWeight: '600', flex: 1 },
  sectionTitle: { ...type.overline, marginTop: space.sm, marginLeft: space.xs },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: 32 },
  muted: type.caption,
  emptyCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.xs,
    alignItems: 'center',
    ...shadow.card,
  },
  emptyTitle: { ...type.heading, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.row,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    backgroundColor: color.surface,
    borderRadius: radius.control,
    ...shadow.card,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: type.label,
  rowWhen: { ...type.caption, fontWeight: '500', color: color.textBody },
  rowWhenUrgent: { color: color.danger },
});
