// One person's emergency card, full screen: big enough to hold up for a
// doctor, and to read with tired eyes. Opened from Emergency cards in the
// drawer and from the person's page.
//
// Everyone in the family can open it. An admin, or the person themselves,
// can add or edit it (migration 032).

import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import { fetchFamilyTree, fetchEmergencyCard, isMissingMigration, type FamilyTree } from '../../lib/api';
import type { EmergencyCard } from '../../lib/emergency';
import { longDate, ageInYears } from '../../lib/dates';
import { buildGraph, relationTo, relationLabel, shortName } from '../../../supabase/functions/_shared/kinship';
import { ScreenHeader, HeaderIconButton } from '../../components/screen-header';
import { EmergencyCardDetails } from '../../components/emergency-card-view';
import { Card, Muted, PrimaryButton, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, space, type } from '../../constants/design';

export default function EmergencyCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { currentFamily, membership } = useFamily();
  const isAdmin = membership?.role === 'admin';
  const [tree, setTree] = useState<FamilyTree | null>(null);
  // undefined while loading; null when they have no card.
  const [card, setCard] = useState<EmergencyCard | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentFamily || !id) return () => {};
    let cancelled = false;
    setProblem(null);
    fetchFamilyTree(currentFamily.id)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((err) => {
        if (cancelled) return;
        setTree({ people: [], links: [], nicknames: false });
        setProblem(isMissingMigration(err) ? 'The family tree is not switched on yet.' : err?.message ?? 'Could not load this person.');
      });
    fetchEmergencyCard(currentFamily.id, id)
      .then((c) => { if (!cancelled) setCard(c); })
      .catch((err) => {
        if (cancelled) return;
        setCard(null);
        setProblem(isMissingMigration(err) ? 'Emergency cards are not switched on yet.' : err?.message ?? 'Could not load the emergency card.');
      });
    return () => { cancelled = true; };
  }, [currentFamily?.id, id]);

  useFocusEffect(load);

  const graph = useMemo(() => (tree ? buildGraph(tree.people, tree.links) : null), [tree]);
  const person = tree?.people.find((p) => p.id === id) ?? null;
  const me = tree?.people.find((p) => p.userId === user?.id) ?? null;
  const isMe = !!person && person.id === me?.id;
  const canEdit = isAdmin || isMe;
  const relation = graph && me && person && !isMe ? relationLabel(relationTo(graph, me.id, person.id)) : null;
  const updatedBy = card?.updatedBy ? tree?.people.find((p) => p.userId === card.updatedBy) : null;
  const edit = () => router.push({ pathname: '/emergency/edit/[id]', params: { id } } as any);

  const about = person
    ? [isMe ? 'You' : relation ? `Your ${relation.charAt(0).toLowerCase()}${relation.slice(1)}` : null,
       person.nickname ? `"${person.nickname}"` : null,
       person.birthDate ? `${ageInYears(person.birthDate)} years` : null].filter(Boolean).join(' · ')
    : '';

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader
        title="Emergency card"
        fallback="/emergency"
        right={card && canEdit ? <HeaderIconButton icon="edit-2" label="Edit the emergency card" onPress={edit} /> : undefined}
      />
      <ScrollView contentContainerStyle={screenStyles.body} showsVerticalScrollIndicator={false}>
        {tree === null || card === undefined ? (
          <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
        ) : problem ? (
          <Status kind="error">{problem}</Status>
        ) : !person ? (
          <Status kind="error">This person is no longer in the family tree.</Status>
        ) : (
          <>
            <View style={styles.banner} accessibilityRole="header">
              <Text style={styles.bannerTag}>Emergency</Text>
              <Text style={styles.bannerName}>{person.name}</Text>
              {!!about && <Text style={styles.bannerAbout}>{about}</Text>}
            </View>

            {card ? (
              <Card>
                <EmergencyCardDetails card={card} large />
                <Text style={styles.updated}>
                  Updated {longDate(new Date(card.updatedAt))}
                  {updatedBy ? ` by ${updatedBy.userId === user?.id ? 'you' : shortName(updatedBy.name)}` : ''}
                </Text>
              </Card>
            ) : (
              <Card>
                <Text style={styles.emptyTitle}>
                  {isMe ? 'You have no emergency card yet.' : `${shortName(person.name)} has no emergency card yet.`}
                </Text>
                <Muted>
                  Blood group, allergies, medicines, their doctor and who to call — ready to show a doctor in one tap.
                </Muted>
                {canEdit
                  ? <PrimaryButton label="Add an emergency card" icon="plus" onPress={edit} />
                  : <Muted>A family admin can add one.</Muted>}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 40 },
  banner: { backgroundColor: '#B91C1C', borderRadius: radius.card, padding: space.lg, gap: 2 },
  bannerTag: { ...type.overline, color: '#FECACA' },
  bannerName: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: '#FFFFFF' },
  bannerAbout: { ...type.body, color: '#FEE2E2' },
  updated: { ...type.caption, marginTop: space.xs },
  emptyTitle: type.heading,
});
