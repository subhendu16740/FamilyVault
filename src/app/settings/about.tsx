// Settings › About — which version this is and when it was released. The
// badge on screen says WHICH build at a glance; this says what that means.

import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appVersion, releaseDate, buildCommit } from '../../lib/app-info';
import { isProduction, environmentDescription } from '../../lib/environment';
import { longDate } from '../../lib/dates';
import { ScreenHeader } from '../../components/screen-header';
import { Card, screenStyles } from '../../components/settings-ui';

export default function AboutScreen() {
  const rows: { label: string; value: string }[] = [
    { label: 'Version', value: appVersion },
    { label: 'Released', value: releaseDate ? longDate(releaseDate) : 'Not recorded' },
    ...(buildCommit ? [{ label: 'Build', value: buildCommit }] : []),
    ...(!isProduction ? [{ label: 'This copy', value: environmentDescription }] : []),
  ];

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="About" fallback="/settings" />
      <ScrollView contentContainerStyle={screenStyles.body}>
        <Card style={styles.hero}>
          <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
            <Feather name="shield" size={34} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.name}>FamilyVault</Text>
          <Text style={styles.tagline}>Your family's important papers, safe and easy to find.</Text>
        </Card>

        <Card style={styles.table}>
          {rows.map((row, i) => (
            <View key={row.label} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 24 },
  logo: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '700', color: '#2A3D66' },
  tagline: { fontSize: 16, lineHeight: 23, color: '#4B5563', textAlign: 'center' },
  table: { paddingVertical: 4, gap: 0 },
  row: { paddingVertical: 14, gap: 2 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  label: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  value: { fontSize: 17, fontWeight: '600', color: '#1F2937' },
});
