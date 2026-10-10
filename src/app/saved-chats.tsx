// Saved chats — behind the clock at the top right of Ask. Every conversation
// the person chose to keep with Save chat, about the family they are in now,
// most recently used first. Tapping one opens it on Ask to carry on.
//
// Only its owner can see a saved chat, and it is deleted if they leave the
// family (migration 028). Deleting is confirmed on screen, never with
// Alert.alert, which does nothing on the web.

import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamily } from '../lib/family-context';
import { vaultName } from '../lib/vaults';
import { listSavedChats, deleteSavedChat, isMissingMigration, type SavedChatSummary } from '../lib/api';
import { longDate } from '../lib/dates';
import { ScreenHeader } from '../components/screen-header';
import { color, radius, shadow, size, space, type } from '../constants/design';

export default function SavedChatsScreen() {
  const { currentFamily } = useFamily();
  const [chats, setChats] = useState<SavedChatSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SavedChatSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!currentFamily) { setChats([]); return; }
    setProblem(null);
    listSavedChats(currentFamily.id)
      .then((list) => { if (!cancelled) setChats(list); })
      .catch((err) => {
        if (cancelled) return;
        setChats([]);
        setProblem(isMissingMigration(err)
          ? "Saving chats isn't available yet."
          : err?.message ?? "Couldn't load your saved chats.");
      });
    return () => { cancelled = true; };
  }, [currentFamily?.id]));

  const open = (chat: SavedChatSummary) => {
    router.navigate({ pathname: '/search', params: { chat: chat.id } } as any);
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await deleteSavedChat(confirming.id);
      setChats((list) => (list ?? []).filter((c) => c.id !== confirming.id));
      setConfirming(null);
    } catch (err: any) {
      setProblem(err?.message ?? "Couldn't delete this chat. Try again.");
      setConfirming(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Saved chats" fallback="/search" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {chats === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.primary} />
          </View>
        ) : (
          <>
            {!!problem && (
              <View style={styles.problem} accessibilityLiveRegion="polite">
                <Feather name="info" size={16} color="#B45309" style={styles.problemIcon} />
                <Text style={styles.problemText}>{problem}</Text>
              </View>
            )}

            {chats.length === 0 && !problem && (
              <View style={styles.emptyCard}>
                <Feather name="bookmark" size={24} color="#9CA3AF" />
                <Text style={styles.emptyTitle}>No saved chats yet</Text>
                <Text style={styles.emptyText}>
                  On Ask, tap Save chat to keep a conversation here.
                </Text>
              </View>
            )}

            {chats.length > 0 && (
              <View style={styles.list}>
                {chats.map((chat, i) => (
                  <View key={chat.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() => open(chat)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityHint="Opens this chat on Ask"
                    >
                      <View style={styles.rowIcon}>
                        <Feather name="message-circle" size={16} color={color.primary} />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={2}>{chat.title}</Text>
                        <Text style={styles.rowWhen}>{longDate(new Date(chat.updatedAt))}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => setConfirming(chat)}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete "${chat.title}"`}
                    >
                      <Feather name="trash-2" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {!problem && (
              <Text style={styles.footnote}>
                Nobody in your family sees your saved chats, not even admins. They're deleted if you leave
                {currentFamily ? ` ${vaultName(currentFamily)}` : ' this family'}.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={!!confirming} transparent animationType="fade" onRequestClose={() => setConfirming(null)}>
        <Pressable style={styles.overlay} onPress={() => !deleting && setConfirming(null)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>Delete this chat?</Text>
            <Text style={styles.dialogText} numberOfLines={3}>“{confirming?.title}”</Text>
            <Text style={styles.dialogText}>Your documents aren't affected.</Text>
            <View style={styles.dialogButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setConfirming(null)}
                disabled={deleting}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={confirmDelete}
                disabled={deleting}
                accessibilityRole="button"
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.confirmText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  center: { alignItems: 'center', paddingVertical: 40 },
  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5D9A0',
    backgroundColor: '#FFF7E6',
  },
  problemIcon: { marginTop: 2 },
  problemText: { flex: 1, fontSize: 14, lineHeight: 20, color: '#7A5200' },
  emptyCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
    ...shadow.card,
  },
  emptyTitle: { ...type.heading, textAlign: 'center' },
  emptyText: { ...type.caption, textAlign: 'center' },
  list: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.row,
    paddingVertical: 10,
    paddingLeft: space.lg,
  },
  rowIcon: {
    width: size.iconBox,
    height: size.iconBox,
    borderRadius: 8,
    backgroundColor: color.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: type.label,
  rowWhen: type.caption,
  deleteBtn: {
    width: size.control,
    height: size.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  footnote: { ...type.caption, marginHorizontal: space.xs },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  dialog: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg + 4,
    width: '100%',
    maxWidth: 360,
    gap: space.sm,
  },
  dialogTitle: { ...type.title, color: color.text },
  dialogText: { ...type.body, color: color.textMuted },
  dialogButtons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  cancelBtn: {
    flex: 1,
    minHeight: size.control,
    borderRadius: radius.control,
    backgroundColor: color.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { ...type.button, color: '#4B5563' },
  confirmBtn: {
    flex: 1,
    minHeight: size.control,
    borderRadius: radius.control,
    backgroundColor: color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { ...type.button, color: '#FFFFFF' },
});
