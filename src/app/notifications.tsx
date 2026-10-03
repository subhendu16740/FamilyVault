import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import { fetchNotifications, markNotificationRead, type NotificationRow } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { color, radius, shadow, size, space, type } from '../constants/design';
import { usePreferences } from '../lib/preferences';

const typeConfig: Record<string, { icon: string; bg: string; color: string }> = {
  expiry: { icon: 'clock', bg: '#FEF2F2', color: '#DC2626' },
  upload: { icon: 'upload', bg: '#EFF6FF', color: '#2563EB' },
  // "Rohan invited you to join Verma Family" — migration 037; answered in Manage Family.
  invite: { icon: 'mail', bg: '#EFF6FF', color: '#2563EB' },
  // "Priya joined Verma Family" / "… said no" (037), or "You were added to <family>" (025).
  member: { icon: 'user-plus', bg: '#F0FDF4', color: '#16A34A' },
  // "Today is Kamala Verma's 78th birthday" — migration 035.
  birthday: { icon: 'gift', bg: '#FDF2F8', color: '#DB2777' },
  // "Rohan shared your PAN by link" — migration 036; opens the document.
  share: { icon: 'link', bg: '#EFF6FF', color: '#2563EB' },
  system: { icon: 'info', bg: '#F3F4F6', color: '#6B7280' },
};

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { currentFamily, switchFamily } = useFamily();
  const { notificationsEnabled, setNotificationsEnabled } = usePreferences();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Switched off in Settings: the list is hidden, so there is nothing to load.
    if (!user || !notificationsEnabled) return;
    setLoading(true);
    fetchNotifications(user.id)
      .then(setNotifications)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id, notificationsEnabled]);

  const handlePress = useCallback(async (notif: NotificationRow) => {
    if (!user) return;
    // Mark as read
    if (!notif.is_read) {
      try {
        await markNotificationRead(notif.id, user.id);
        setNotifications((prev) =>
          prev.map((n) => n.id === notif.id ? { ...n, is_read: true } : n)
        );
      } catch { /* ignore */ }
    }
    // Each notification belongs to one family, and it may not be the one on
    // screen: the document viewer looks documents up in the current family,
    // so a tap that opens something opens it in the notification's own. (A
    // family the person has since left falls back to their default, as any
    // stale choice does.)
    const opens = !!notif.document_ref || notif.type === 'member' || notif.type === 'birthday';
    if (opens && notif.family_id && notif.family_id !== currentFamily?.id) {
      switchFamily(notif.family_id);
    }
    // Navigate to document if linked
    if (notif.document_ref) {
      router.push(`/document/${notif.document_ref}` as any);
    } else if (notif.type === 'member') {
      // Where the new family can be switched to, or left.
      router.push('/family' as any);
    } else if (notif.type === 'birthday') {
      router.push('/family-tree' as any);
    } else if (notif.type === 'invite') {
      // Not their family yet, so no switching: the invitation is answered there.
      router.push('/family' as any);
    }
  }, [user, currentFamily?.id, switchFamily]);

  const renderItem = ({ item }: { item: NotificationRow }) => {
    const cfg = typeConfig[item.type] || typeConfig.system;
    return (
      <TouchableOpacity
        style={[styles.card, !item.is_read && styles.cardUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconWrap, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon as any} size={16} color={cfg.color} />
        </View>
        <View style={styles.content}>
          <Text style={[styles.title, !item.is_read && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.message} numberOfLines={2}>{item.message}</Text>
          <Text style={styles.time}>{getRelativeTime(item.created_at)}</Text>
        </View>
        {!item.is_read && <View style={styles.dot} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />

      {!notificationsEnabled ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={32} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Notifications are off</Text>
          <Text style={styles.emptySubtitle}>Nothing has been deleted. Turn them on to see your alerts.</Text>
          <TouchableOpacity
            style={styles.turnOnBtn}
            onPress={() => setNotificationsEnabled(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.turnOnText}>Turn on notifications</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={32} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptySubtitle}>You're all caught up!</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
  emptyTitle: { ...type.heading, color: color.textMuted },
  emptySubtitle: { ...type.caption, textAlign: 'center' },
  turnOnBtn: {
    marginTop: space.sm,
    minHeight: size.control,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnOnText: { ...type.button, color: '#FFFFFF' },
  list: { padding: space.lg, gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: space.md,
    ...shadow.card,
  },
  cardUnread: {
    backgroundColor: '#F0F5FF',
    borderLeftWidth: 3,
    borderLeftColor: color.primary,
  },
  iconWrap: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: size.iconBox / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, minWidth: 0 },
  title: { ...type.label, color: color.textBody, marginBottom: 2 },
  titleUnread: { fontWeight: '600', color: color.text },
  message: { ...type.caption, marginBottom: 2 },
  time: { fontSize: 12, lineHeight: 16, color: '#9CA3AF' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.primary,
  },
});
