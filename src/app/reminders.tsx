// Reminders — every document in the family with an expiry date, soonest
// first. Reminders sent 90, 30 and 7 days ahead are part of Family Plus, the
// paid plan (★ in the menu), which does not exist yet; the list works for
// everyone, and the bell on Home already carries expiry alerts.

import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../lib/family-context';
import { fetchExpiringDocuments, type ExpiringDocument } from '../lib/api';
import { expiryPhrase, longDate } from '../lib/dates';
import { ScreenHeader, PlusTag } from '../components/screen-header';
import { color, radius, shadow, size, space, type } from '../constants/design';

export default function RemindersScreen() {
  const { currentFamily } = useFamily();
  const [items, setItems] = useState<ExpiringDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!currentFamily) { setItems([]); return; }
    setError(null);
    fetchExpiringDocuments(currentFamily.id)
      .then((found) => { if (!cancelled) setItems(found); })
      .catch((err) => { if (!cancelled) { setItems([]); setError(err?.message ?? 'Could not load your documents.'); } });
    return () => { cancelled = true; };
  }, [currentFamily?.id]));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reminders" right={<PlusTag />} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.plusCard}>
          <Text style={styles.plusCardTag}>★ Family Plus</Text>
          <Text style={styles.plusCardText}>
            With Family Plus, FamilyVault reminds you 90, 30 and 7 days before a passport, licence or policy runs out.
          </Text>
          <Text style={styles.plusCardNote}>
            Family Plus is coming soon. Until then, expiry alerts appear under the bell on Home.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>
          {currentFamily ? `Expiry dates in ${currentFamily.name}` : 'Expiry dates'}
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
