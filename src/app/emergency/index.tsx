// Emergency cards: everyone in the family tree, you first, with their blood
// group at a glance. Opened from the drawer; a tap opens the full card.
//
// Everyone in the family can see every card (migration 032). Who has none
// yet says so, and an admin, or the person themselves, can add one from the
// card's screen.

import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { fetchFamilyTree, fetchEmergencyCards, isMissingMigration, type FamilyTree } from '../../lib/api';
import type { EmergencyCard } from '../../lib/emergency';
import { buildGraph, relationTo, relationLabel } from '../../../supabase/functions/_shared/kinship';
import { ScreenHeader } from '../../components/screen-header';
import { Avatar } from '../../components/family-tree-view';
import { BloodPill } from '../../components/emergency-card-view';
import { Muted, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, shadow, size, space, type } from '../../constants/design';

export default function EmergencyCardsScreen() {
  const { user } = useAuth();
  const { currentFamily } = useFamily();
  const [tree, setTree] = useState<FamilyTree | null>(null);
  const [cards, setCards] = useState<EmergencyCard[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentFamily) return () => {};
    let cancelled = false;
    setProblem(null);
    fetchFamilyTree(currentFamily.id)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((err) => {
        if (cancelled) return;
        setTree({ people: [], links: [], nicknames: false });
        setProblem(isMissingMigration(err) ? 'The family tree is not switched on yet.' : err?.message ?? 'Could not load the family.');
      });
    fetchEmergencyCards(currentFamily.id)
      .then((c) => { if (!cancelled) setCards(c); })
      .catch((err) => {
        if (cancelled) return;
        setCards([]);
        setProblem(isMissingMigration(err) ? 'Emergency cards are not switched on yet.' : err?.message ?? 'Could not load the emergency cards.');
      });
    return () => { cancelled = true; };
  }, [currentFamily?.id]);

  useFocusEffect(load);

  const graph = useMemo(() => (tree ? buildGraph(tree.people, tree.links) : null), [tree]);
  const me = tree?.people.find((p) => p.userId === user?.id) ?? null;
  const everyone = useMemo(() => {
    if (!tree) return [];
    const others = tree.people.filter((p) => p.id !== me?.id);
    return me ? [me, ...others] : others;
  }, [tree, me]);
  const cardOf = (id: string) => cards?.find((c) => c.personId === id) ?? null;

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader title="Emergency cards" subtitle={currentFamily?.name} fallback="/home" />
      <ScrollView contentContainerStyle={screenStyles.body} showsVerticalScrollIndicator={false}>
        {tree === null || cards === null ? (
          <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
        ) : problem ? (
          <Status kind="error">{problem}</Status>
        ) : (
          <>
            <Muted>
              Blood group, allergies, medicines, the doctor and who to call, for each person in the family. Open one
              to show a doctor; every number is one tap from your phone.
            </Muted>
            <View style={styles.list}>
              {everyone.map((p, i) => {
                const card = cardOf(p.id);
                const isMe = p.id === me?.id;
                const relation = isMe ? 'You' : graph && me ? relationLabel(relationTo(graph, me.id, p.id)) : null;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.row, i > 0 && styles.rowBorder]}
                    onPress={() => router.push({ pathname: '/emergency/[id]', params: { id: p.id } } as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}${card ? '' : ', no card yet'}`}
                  >
                    <Avatar name={p.name} me={isMe} size={size.iconBox} onApp={!!p.userId} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {[relation, p.nickname ? `"${p.nickname}"` : null, card ? (card.allergies ? 'Has allergies' : null) : 'No card yet']
                          .filter(Boolean).join(' · ') || 'Family'}
                      </Text>
                    </View>
                    {card && <BloodPill group={card.bloodGroup} />}
                    <Feather name="chevron-right" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 40 },
  list: { backgroundColor: color.surface, borderRadius: radius.card, ...shadow.card },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    minHeight: size.row, paddingHorizontal: space.lg, paddingVertical: space.sm,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: type.label,
  rowSub: type.caption,
});
