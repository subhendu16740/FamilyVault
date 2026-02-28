import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, useColorScheme, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { useDrawer } from '../../lib/drawer-context';
import { fetchRecentDocuments, fetchFamilyStats } from '../../lib/api';
import type { FamilyDocumentRow } from '../../lib/database.types';


function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const categoryColors: Record<string, string> = {
  Passport: '#3B82F6', 'Driving License': '#3B82F6', 'Aadhaar Card': '#3B82F6',
  'Health Insurance': '#22C55E', 'Life Insurance': '#22C55E', Prescriptions: '#22C55E',
  'Income Tax Returns': '#A855F7', 'Property Tax': '#A855F7', 'Bank Statements': '#A855F7',
  'Property Deed': '#F59E0B', 'Rental Agreement': '#F59E0B',
};

function getCategoryColor(name: string | null): string {
  if (!name) return '#6B7280';
  return categoryColors[name] || '#6B7280';
}

function getDocIcon(fileType: string): string {
  if (fileType === 'pdf') return 'file-text';
  if (['jpg', 'jpeg', 'png', 'heic'].includes(fileType)) return 'image';
  return 'file';
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const { currentFamily } = useFamily();
  const { openDrawer } = useDrawer();

  const [recentDocs, setRecentDocs] = useState<FamilyDocumentRow[]>([]);
  const [stats, setStats] = useState({ doc_count: 0, member_count: 0, category_count: 0 });
  const [loading, setLoading] = useState(false);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    if (!currentFamily) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchRecentDocuments(currentFamily.id, 5),
      fetchFamilyStats(currentFamily.id),
    ])
      .then(([docs, s]) => {
        setRecentDocs(docs);
        setStats(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentFamily?.id]);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        {/* Gradient Header */}
        <LinearGradient
          colors={['#2A3D66', '#4A6491']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']}>
            <View style={styles.headerTop}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={openDrawer} style={styles.profileBtn}>
                  <Text style={styles.profileInitial}>{initial}</Text>
                </TouchableOpacity>
                <View>
                  <Text style={styles.greeting}>{getTimeGreeting()}</Text>
                  <Text style={styles.headerTitle}>{displayName}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.bellBtn}>
                <Feather name="bell" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <TouchableOpacity
              onPress={() => router.push('/search' as any)}
              style={styles.searchBar}
              activeOpacity={0.8}
            >
              <Feather name="search" size={20} color="rgba(255,255,255,0.8)" />
              <Text style={styles.searchPlaceholder}>Search documents...</Text>
              <Feather name="mic" size={20} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </SafeAreaView>
        </LinearGradient>

        {/* Stats Bar */}
        <View style={styles.section}>
          <View style={[styles.statsBar, isDark && styles.statsBarDark]}>
            <Text style={[styles.statText, isDark && styles.statTextDark]}>{stats.doc_count} Documents</Text>
            <Text style={styles.statDivider}>|</Text>
            <Text style={[styles.statText, isDark && styles.statTextDark]}>{stats.member_count} Members</Text>
            <Text style={styles.statDivider}>|</Text>
            <Text style={[styles.statText, isDark && styles.statTextDark]}>{stats.category_count} Categories</Text>
          </View>
        </View>

        {/* Recent Documents */}
        <View style={[styles.section, styles.sectionBottom]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Recent Documents</Text>

          {loading ? (
            <ActivityIndicator size="small" color="#2A3D66" style={{ marginTop: 20 }} />
          ) : recentDocs.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="file-plus" size={40} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No documents yet</Text>
              <Text style={styles.emptySubtitle}>Upload your first document to get started</Text>
            </View>
          ) : (
            <View style={styles.docList}>
              {recentDocs.map((doc) => (
                <TouchableOpacity
                  key={doc.id}
                  style={[styles.docCard, isDark && styles.docCardDark]}
                  onPress={() => router.push(`/document/${doc.id}` as any)}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={['#2A3D66', '#4A6491']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.docIcon}
                  >
                    <Feather name={getDocIcon(doc.file_type) as any} size={22} color="#FFFFFF" />
                  </LinearGradient>
                  <View style={styles.docInfo}>
                    <Text style={[styles.docTitle, isDark && styles.textLight]} numberOfLines={1}>
                      {doc.file_name}
                    </Text>
                    <View style={styles.docMeta}>
                      {doc.category_name && (
                        <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(doc.category_name) }]}>
                          <Text style={styles.categoryBadgeText}>{doc.category_name}</Text>
                        </View>
                      )}
                      {doc.member_name && (
                        <Text style={styles.docOwner}>
                          {doc.member_relationship ? `${doc.member_relationship} · ` : ''}{doc.member_name}
                        </Text>
                      )}
                      <Text style={styles.docDot}>·</Text>
                      <Text style={styles.docDate}>{getRelativeTime(doc.created_at)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FC' },
  containerDark: { backgroundColor: '#0D1117' },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 2 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    minHeight: 56,
  },
  searchPlaceholder: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 15 },
  section: { paddingHorizontal: 24, marginTop: 24 },
  sectionBottom: { marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#1F2937', marginBottom: 16 },
  statsBar: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statsBarDark: { backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D' },
  statText: { fontSize: 13, color: '#2A3D66', fontWeight: '500' },
  statTextDark: { color: '#4A6491' },
  statDivider: { color: '#9CA3AF' },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  emptySubtitle: { fontSize: 13, color: '#9CA3AF' },
  docList: { gap: 12 },
  docCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  docCardDark: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  docIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 6 },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  categoryBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  categoryBadgeText: { fontSize: 10, color: '#FFFFFF', fontWeight: '600' },
  docOwner: { fontSize: 11, color: '#9CA3AF' },
  docDot: { fontSize: 11, color: '#9CA3AF' },
  docDate: { fontSize: 11, color: '#9CA3AF' },
  textLight: { color: '#E6EDF3' },
});
