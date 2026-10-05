import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, useColorScheme, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { useDrawer } from '../../lib/drawer-context';
import { fetchRecentDocuments, fetchFamilyStats, fetchUnreadNotificationCount, checkExpiryNotifications } from '../../lib/api';
import { usePreferences } from '../../lib/preferences';
import { InvitationCards } from '../../components/invitation-cards';
import type { FamilyDocumentRow } from '../../lib/database.types';
import { color, radius, shadow, size, space, type } from '../../constants/design';


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
  const { currentFamily, refreshFamilies } = useFamily();
  const { openDrawer } = useDrawer();
  // Settings › Notifications off: the bell stays, its count does not.
  const { notificationsEnabled } = usePreferences();

  const [recentDocs, setRecentDocs] = useState<FamilyDocumentRow[]>([]);
  const [stats, setStats] = useState({ doc_count: 0, member_count: 0, category_count: 0 });
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  const loadData = useCallback(() => {
    if (!currentFamily || !user) {
      // No family yet: they may have joined one since sign-in — and the bell
      // still counts, since an invitation to join one is a notification.
      if (user) {
        refreshFamilies().catch(() => {});
        fetchUnreadNotificationCount(user.id).then(setUnreadCount).catch(() => {});
      }
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchRecentDocuments(currentFamily.id, 5),
      fetchFamilyStats(currentFamily.id),
      fetchUnreadNotificationCount(user.id),
      checkExpiryNotifications(currentFamily.id).catch(() => 0),
    ])
      .then(([docs, s, unread]) => {
        setRecentDocs(docs);
        setStats(s);
        setUnreadCount(unread);
      })
      .catch((err) => console.error('[Home] fetch error:', err))
      .finally(() => setLoading(false));
  }, [currentFamily?.id, user?.id, refreshFamilies]);

  // Re-fetch when screen gains focus (e.g. after deleting a document)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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
              <TouchableOpacity
                style={styles.bellBtn}
                onPress={() => router.push('/notifications' as any)}
              >
                <Feather name="bell" size={20} color="#FFFFFF" />
                {notificationsEnabled && unreadCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <TouchableOpacity
              onPress={() => router.push('/search' as any)}
              style={styles.searchBar}
              activeOpacity={0.8}
            >
              <Feather name="search" size={18} color="rgba(255,255,255,0.8)" />
              <Text style={styles.searchPlaceholder}>Search documents...</Text>
              <Feather name="mic" size={18} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </SafeAreaView>
        </LinearGradient>

        {/* Invitations to join a family (037): answered here, the first place anyone looks */}
        <InvitationCards style={styles.invites} />

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
              <Feather name="file-plus" size={32} color="#D1D5DB" />
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
                    <Feather name={getDocIcon(doc.file_type) as any} size={18} color="#FFFFFF" />
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
  container: { flex: 1, backgroundColor: color.background },
  containerDark: { backgroundColor: '#0D1117' },
  header: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg + 4,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.lg,
    paddingTop: space.sm,
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
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  greeting: { ...type.caption, color: 'rgba(255,255,255,0.8)' },
  headerTitle: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: '#FFFFFF' },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#2A3D66',
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    minHeight: 48,
  },
  searchPlaceholder: { ...type.body, flex: 1, color: 'rgba(255,255,255,0.75)' },
  section: { paddingHorizontal: space.lg, marginTop: space.lg },
  invites: { paddingHorizontal: space.lg, marginTop: space.lg },
  sectionBottom: { marginBottom: space.xl },
  sectionTitle: { ...type.overline, marginBottom: space.sm, marginLeft: space.xs },
  statsBar: {
    backgroundColor: color.tint,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statsBarDark: { backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D' },
  statText: { ...type.caption, color: color.primary, fontWeight: '500' },
  statTextDark: { color: '#4A6491' },
  statDivider: { color: '#9CA3AF' },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: space.sm,
  },
  emptyTitle: { ...type.heading, color: color.textMuted },
  emptySubtitle: { ...type.caption, textAlign: 'center' },
  docList: { gap: space.sm },
  docCard: {
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.row,
    ...shadow.card,
  },
  docCardDark: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: { flex: 1, minWidth: 0 },
  docTitle: { ...type.label, marginBottom: space.xs },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  categoryBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  categoryBadgeText: { ...type.meta, color: '#FFFFFF', fontWeight: '600' },
  docOwner: type.meta,
  docDot: type.meta,
  docDate: type.meta,
  textLight: { color: '#E6EDF3' },
});
