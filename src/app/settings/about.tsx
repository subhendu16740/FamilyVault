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
import { color, space, type } from '../../constants/design';

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
            <Feather name="shield" size={26} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.name}>AskLocker</Text>
          <Text style={styles.tagline}>Your family's important papers, easy to find.</Text>
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
  hero: { alignItems: 'center', paddingVertical: space.xl, gap: space.sm },
  logo: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  name: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: color.primary },
  tagline: { ...type.body, color: color.textMuted, textAlign: 'center' },
  table: { paddingVertical: space.xs, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 48, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  label: { ...type.body, color: color.textMuted },
  value: { ...type.label, flexShrink: 1, textAlign: 'right' },
});
