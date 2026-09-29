// Settings › Storage — how much space your documents take: what you have
// added, and each of your families in full.

import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { fetchStorageUsage, type FamilyStorage } from '../../lib/api';
import { ScreenHeader } from '../../components/screen-header';
import { Card, CardTitle, Muted, Status, screenStyles } from '../../components/settings-ui';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

export default function StorageScreen() {
  const { user } = useAuth();
  const { families } = useFamily();
  const [usage, setUsage] = useState<FamilyStorage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const familyKey = families.map((f) => f.family_id).join(',');

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    fetchStorageUsage(families.map((f) => ({ id: f.families.id, name: f.families.name })), user.id)
      .then((u) => { if (!cancelled) setUsage(u); })
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
            <ActivityIndicator size="large" color="#2A3D66" />
            <Muted>Adding up your documents…</Muted>
          </View>
        ) : (
          <>
            {error && <Status kind="error">{error}</Status>}

            <Card>
              <CardTitle icon="user">What you have added</CardTitle>
              <Text style={styles.big}>{formatBytes(yourBytes)}</Text>
              <Muted>
                {documents(yourDocs)}, in {usage.length} {usage.length === 1 ? 'family' : 'families'}
              </Muted>
            </Card>

            <Text style={styles.sectionTitle}>Your families</Text>
            {usage.length === 0 && <Muted>You are not in a family yet.</Muted>}
            {usage.map((f) => {
              const share = f.bytes > 0 ? f.yourBytes / f.bytes : 0;
              return (
                <Card key={f.familyId}>
                  <View style={styles.familyRow}>
                    <Text style={styles.familyName} numberOfLines={2}>{f.name}</Text>
                    <Text style={styles.familyBytes}>{formatBytes(f.bytes)}</Text>
                  </View>
                  <Muted>{documents(f.documents)} in this family</Muted>
                  <View
                    style={styles.bar}
                    accessibilityLabel={`You added ${Math.round(share * 100)} percent of it`}
                  >
                    <View style={[styles.barFill, { width: `${Math.max(share > 0 ? 3 : 0, Math.round(share * 100))}%` }]} />
                  </View>
                  <Muted>You added {formatBytes(f.yourBytes)} of it ({documents(f.yourDocuments)}).</Muted>
                </Card>
              );
            })}

            <Muted>Sizes are of the files as they were added.</Muted>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  big: { fontSize: 30, fontWeight: '700', color: '#2A3D66' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginTop: 6 },
  familyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  familyName: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1F2937' },
  familyBytes: { fontSize: 18, fontWeight: '700', color: '#2A3D66' },
  bar: { height: 12, borderRadius: 6, backgroundColor: '#EEF2F8', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 6, backgroundColor: '#4A6491' },
});
