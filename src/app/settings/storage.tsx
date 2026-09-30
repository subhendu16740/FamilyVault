// Settings › Storage — each family's use of its free space, and what you
// have added yourself. Family Plus, the paid plan, will add more space; until
// it exists the limit is shown, never enforced (see src/lib/plans.ts).

import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { fetchStorageUsage, type FamilyStorage } from '../../lib/api';
import { FREE_STORAGE_BYTES, FREE_STORAGE_LABEL, storageLevel, type StorageLevel } from '../../lib/plans';
import { ScreenHeader, PlusTag } from '../../components/screen-header';
import { Card, CardTitle, Body, Muted, Status, screenStyles } from '../../components/settings-ui';
import { color, space, type } from '../../constants/design';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) {
    const mb = bytes / 1024 ** 2;
    return `${mb < 100 ? +mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${+(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

const BAR: Record<StorageLevel, string> = { ok: color.secondary, nearly: '#D97706', over: color.danger };

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
            <ActivityIndicator color={color.primary} />
            <Muted>Adding up your documents…</Muted>
          </View>
        ) : (
          <>
            {error && <Status kind="error">{error}</Status>}

            <Card>
              <CardTitle icon="hard-drive">Free plan</CardTitle>
              <Body>Every family gets {FREE_STORAGE_LABEL} free for its documents.</Body>
              <View style={styles.plusRow}>
                <PlusTag />
                <Text style={styles.plusText}>More space for your family, as a paid upgrade. Coming soon.</Text>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>Your families</Text>
            {usage.length === 0 && <Muted>You are not in a family yet.</Muted>}
            {usage.map((f) => {
              const level = storageLevel(f.bytes);
              const percent = Math.min(100, Math.round((f.bytes / FREE_STORAGE_BYTES) * 100));
              return (
                <Card key={f.familyId}>
                  <View style={styles.familyRow}>
                    <Text style={styles.familyName} numberOfLines={2}>{f.name}</Text>
                    <Text style={styles.familyBytes}>
                      {formatBytes(f.bytes)}
                      <Text style={styles.ofFree}> of {FREE_STORAGE_LABEL}</Text>
                    </Text>
                  </View>
                  <View
                    style={styles.bar}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${f.name}: ${formatBytes(f.bytes)} of the free ${FREE_STORAGE_LABEL} used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <View
                      style={[
                        styles.barFill,
                        { width: `${f.bytes > 0 ? Math.max(2, percent) : 0}%`, backgroundColor: BAR[level] },
                      ]}
                    />
                  </View>
                  <Muted>
                    {level === 'over'
                      ? `${formatBytes(f.bytes - FREE_STORAGE_BYTES)} over the free ${FREE_STORAGE_LABEL}`
                      : `${formatBytes(FREE_STORAGE_BYTES - f.bytes)} left`}
                    {' · '}{documents(f.documents)}
                  </Muted>
                  <Muted>You added {formatBytes(f.yourBytes)} of it ({documents(f.yourDocuments)}).</Muted>
                  {level !== 'ok' && (
                    // Said, not enforced: there is no way to pay yet, so a
                    // family past its free space can still add documents.
                    <View style={[styles.note, level === 'over' ? styles.noteOver : styles.noteNearly]}>
                      <Text style={[styles.noteText, level === 'over' ? styles.noteTextOver : styles.noteTextNearly]}>
                        {level === 'over'
                          ? `This family has used more than its free ${FREE_STORAGE_LABEL}. You can still add documents for now; Family Plus, coming soon, will add more space.`
                          : `Nearly full. Family Plus, coming soon, will add more space.`}
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

            <Muted>Sizes are of the files as they were added.</Muted>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: 40 },
  plusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  plusText: { ...type.caption, flex: 1, color: color.textBody, marginTop: 2 },
  big: { fontSize: 22, lineHeight: 28, fontWeight: '600', color: color.primary },
  sectionTitle: { ...type.overline, marginTop: space.sm, marginLeft: space.xs },
  familyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  familyName: { ...type.heading, flex: 1 },
  familyBytes: { ...type.heading, color: color.primary },
  ofFree: { ...type.caption, color: color.textMuted },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#EEF2F8', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  note: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: space.md, borderWidth: 1 },
  noteNearly: { backgroundColor: '#FFF7E6', borderColor: '#F5D9A0' },
  noteOver: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  noteText: { fontSize: 14, lineHeight: 20 },
  noteTextNearly: { color: '#7A5200' },
  noteTextOver: { color: '#B91C1C' },
});
