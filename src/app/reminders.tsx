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
            <ActivityIndicator size="large" color="#2A3D66" />
            <Text style={styles.muted}>Looking through your documents…</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Could not load your documents</Text>
            <Text style={styles.muted}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="calendar" size={32} color="#9CA3AF" />
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
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.fileName}</Text>
                  {!!item.memberName && <Text style={styles.muted}>{item.memberName}</Text>}
                  <Text style={[styles.rowWhen, urgent && styles.rowWhenUrgent]}>
                    {expiryPhrase(item.daysLeft)} · {longDate(item.expiry)}
                  </Text>
                </View>
                <Text style={styles.open}>Open</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FC' },
  body: { padding: 20, gap: 12, paddingBottom: 40 },
  plusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 8,
    borderWidth: 2,
    borderColor: '#F3D3CF',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  plusCardTag: { fontSize: 15, fontWeight: '700', color: '#D4807B' },
  plusCardText: { fontSize: 17, lineHeight: 25, color: '#1F2937' },
  plusCardNote: { fontSize: 15, lineHeight: 22, color: '#4B5563' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginTop: 8 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  muted: { fontSize: 15, color: '#6B7280', lineHeight: 21 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    gap: 8,
    alignItems: 'center',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1F2937', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)',
    elevation: 3,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: '#1F2937' },
  rowWhen: { fontSize: 15, fontWeight: '600', color: '#4B5563' },
  rowWhenUrgent: { color: '#DC2626' },
  open: { fontSize: 16, fontWeight: '700', color: '#2A3D66' },
});
