// One person in the family tree: who they are to you, their emergency card,
// their close family, the documents marked as theirs and when those run out.
//
// Anyone in the family can look. An admin can edit, add a relative, link
// someone added by name to their AskLocker account (033) — which invites
// them, Pending approval until they accept (037) — or take them out of the
// tree; people can edit their own details. Confirmation is on screen, never
// Alert.alert, which does nothing on the web.

import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useFamily } from '../../lib/family-context';
import {
  fetchFamilyTree, fetchPersonDocuments, fetchExpiringDocuments, fetchEmergencyCard, removeFamilyPerson, linkPersonToAccount,
  fetchFamilyInvites, cancelInvitation, isMissingMigration, type FamilyTree, type ExpiringDocument, type PendingInvite,
} from '../../lib/api';
import type { EmergencyCard } from '../../lib/emergency';
import type { FamilyDocumentRow } from '../../lib/database.types';
import { longDate, expiryPhrase, ageInYears } from '../../lib/dates';
import {
  buildGraph, relationTo, relationLabel, parentsOf, childrenOf, spousesOf, siblingsOf, shortName,
} from '../../../supabase/functions/_shared/kinship';
import { ScreenHeader, HeaderIconButton } from '../../components/screen-header';
import { Avatar } from '../../components/family-tree-view';
import { PersonSheet, type PersonSheetState } from '../../components/person-sheet';
import { BloodPill } from '../../components/emergency-card-view';
import { Card, CardTitle, Field, Muted, PrimaryButton, SecondaryButton, DangerButton, Status, screenStyles } from '../../components/settings-ui';
import { color, radius, size, space, type } from '../../constants/design';

// "K C Das Mohapatra" is not "K": an initial alone says nothing.
const first = shortName;

export default function PersonScreen() {
  // `joined` is set when this page was opened after two entries became one.
  const { id, joined } = useLocalSearchParams<{ id: string; joined?: string }>();
  const { user } = useAuth();
  const { currentFamily, membership } = useFamily();
  const isAdmin = membership?.role === 'admin';
  const [tree, setTree] = useState<FamilyTree | null>(null);
  const [docs, setDocs] = useState<FamilyDocumentRow[] | null>(null);
  const [expiring, setExpiring] = useState<ExpiringDocument[]>([]);
  // undefined while loading, null when they have none; 'off' before migration 032.
  const [card, setCard] = useState<EmergencyCard | null | undefined | 'off'>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PersonSheetState | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(joined ? 'Their two entries are one now: everything that was marked as either is theirs.' : null);
  // Asked to be this person, not answered yet (037).
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const scroll = useRef<ScrollView>(null);

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
    fetchPersonDocuments(currentFamily.id, id)
      .then((d) => { if (!cancelled) setDocs(d); })
      .catch(() => { if (!cancelled) setDocs([]); });
    fetchExpiringDocuments(currentFamily.id)
      .then((e) => { if (!cancelled) setExpiring(e.filter((x) => x.memberId === id)); })
      .catch(() => undefined);
    fetchEmergencyCard(currentFamily.id, id)
      .then((c) => { if (!cancelled) setCard(c); })
      .catch((err) => { if (!cancelled) setCard(isMissingMigration(err) ? 'off' : null); });
    fetchFamilyInvites(currentFamily.id)
      .then((list) => { if (!cancelled) setInvite(list.find((i) => i.personId === id) ?? null); })
      .catch(() => { if (!cancelled) setInvite(null); });
    return () => { cancelled = true; };
  }, [currentFamily?.id, id]);

  useFocusEffect(load);

  const graph = useMemo(() => (tree ? buildGraph(tree.people, tree.links) : null), [tree]);
  const person = tree?.people.find((p) => p.id === id) ?? null;
  const me = tree?.people.find((p) => p.userId === user?.id) ?? null;
  const isMe = !!person && person.id === me?.id;
  const canEdit = isAdmin || isMe;
  const relation = graph && me && person && !isMe ? relationLabel(relationTo(graph, me.id, person.id)) : null;

  const close = useMemo(() => {
    if (!graph || !person) return [];
    const named = (ids: string[]) => ids.map((x) => tree!.people.find((p) => p.id === x)).filter(Boolean) as FamilyTree['people'];
    return [
      { title: 'Parents', people: named(parentsOf(graph, person.id)) },
      { title: person.gender === 'female' ? 'Husband' : person.gender === 'male' ? 'Wife' : 'Husband or wife', people: named(spousesOf(graph, person.id)) },
      { title: 'Children', people: named(childrenOf(graph, person.id)) },
      { title: 'Brothers and sisters', people: named(siblingsOf(graph, person.id)) },
    ].filter((g) => g.people.length > 0);
  }, [graph, person, tree]);

  const remove = async () => {
    if (!person) return;
    setRemoving(true);
    try {
      await removeFamilyPerson(person.id);
      setConfirmRemove(false);
      router.replace('/family-tree' as any);
    } catch (err: any) {
      setProblem(err?.message || 'Could not take them out of the tree.');
      setConfirmRemove(false);
      setRemoving(false);
    }
  };

  const openLink = () => {
    setLinkEmail('');
    setLinkError(null);
    setNotice(null);
    setLinkOpen(true);
  };

  // Someone added by name has signed up: link this entry to their account.
  // Not yet a member, they are invited, and join as a viewer AS this person
  // when they accept; already added in Manage Family, their two entries
  // become one and this page is gone, so the joined person's opens instead.
  const link = async () => {
    if (!currentFamily || !person) return;
    const address = linkEmail.trim().toLowerCase();
    if (!address) {
      setLinkError('Enter the email they sign in with.');
      return;
    }
    setLinking(true);
    setLinkError(null);
    try {
      const outcome = await linkPersonToAccount(currentFamily.id, person.id, address);
      switch (outcome.status) {
        case 'invited':
        case 'linked':
          setLinkOpen(false);
          setNotice(outcome.status === 'invited'
            ? `Invitation sent to ${outcome.email}. ${first(person.name)} joins this family as this person once they accept — until then: Pending approval.`
            : `${first(person.name)} is on AskLocker now, in this family as a viewer, and got a notification.`);
          scroll.current?.scrollTo({ y: 0, animated: true });   // the news is at the top; the button was at the bottom
          load();
          break;
        case 'merged':
          setLinkOpen(false);
          router.replace({ pathname: '/person/[id]', params: { id: outcome.memberId, joined: '1' } } as any);
          break;
        case 'no_account':
          setLinkError(`No AskLocker account uses ${address} yet. Ask ${first(person.name)} to sign up with this email, then link again.`);
          break;
        case 'invalid_email':
          setLinkError("That doesn't look like an email address.");
          break;
        case 'refused':
        case 'unavailable':
          setLinkError(outcome.message);
          break;
      }
    } catch (err: any) {
      setLinkError(err?.message || 'Could not link them. Please try again.');
    } finally {
      setLinking(false);
    }
  };

  const withdraw = async () => {
    if (!invite) return;
    setWithdrawing(true);
    try {
      await cancelInvitation(invite.id);
      setInvite(null);
      setNotice('Invitation withdrawn.');
    } catch (err: any) {
      setProblem(err?.message || 'Could not withdraw the invitation.');
    } finally {
      setWithdrawing(false);
    }
  };

  const title = person?.name ?? 'Family';

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader
        title={title}
        fallback="/family-tree"
        right={person && canEdit ? <HeaderIconButton icon="edit-2" label={`Edit ${person.name}`} onPress={() => setSheet({ mode: 'edit', personId: person.id })} /> : undefined}
      />
      <ScrollView ref={scroll} contentContainerStyle={screenStyles.body} showsVerticalScrollIndicator={false}>
        {tree === null ? (
          <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
        ) : problem ? (
          <Status kind="error">{problem}</Status>
        ) : !person ? (
          <Status kind="error">This person is no longer in the family tree.</Status>
        ) : (
          <>
            {!!notice && <Status kind="ok">{notice}</Status>}
            <Card style={styles.hero}>
              <Avatar name={person.name} me={isMe} size={56} onApp={!!person.userId} />
              <Text style={styles.name}>{person.name}</Text>
              {!!person.nickname && <Text style={styles.nickname}>"{person.nickname}"</Text>}
              {isMe && <Text style={styles.relation}>You</Text>}
              {!!relation && <Text style={styles.relation}>Your {relation.charAt(0).toLowerCase() + relation.slice(1)}</Text>}
              {!!person.birthDate && (
                <Muted>Born {longDate(new Date(`${person.birthDate}T00:00:00`))} · {ageInYears(person.birthDate)} years</Muted>
              )}
              {!!person.userId && (
                <View style={styles.accountPill}>
                  <Feather name="smartphone" size={12} color={color.primary} />
                  <Text style={styles.accountText}>{isMe ? 'You are on AskLocker' : 'On AskLocker (has an account)'}</Text>
                </View>
              )}
              {!person.userId && !!invite && (
                <>
                  <View style={styles.pendingPill}>
                    <Feather name="clock" size={12} color="#B45309" />
                    <Text style={styles.pendingText}>Pending approval</Text>
                  </View>
                  <Muted>Invited as {invite.email}. Waiting for {first(person.name)} to accept.</Muted>
                </>
              )}
            </Card>

            <Card>
              <CardTitle icon="plus-square">Emergency card</CardTitle>
              {card === undefined ? (
                <ActivityIndicator color={color.primary} />
              ) : card === 'off' ? (
                <Muted>Emergency cards are not switched on yet.</Muted>
              ) : card ? (
                <>
                  <View style={styles.emergencyRow}>
                    <BloodPill group={card.bloodGroup} />
                    {card.contacts.length > 0 && (
                      <Text style={styles.docSub}>{card.contacts.length === 1 ? '1 person to call' : `${card.contacts.length} people to call`}</Text>
                    )}
                  </View>
                  {!!card.allergies && <Text style={styles.allergies} numberOfLines={2}>Allergies: {card.allergies}</Text>}
                  <PrimaryButton
                    label="Open emergency card"
                    icon="maximize-2"
                    onPress={() => router.push({ pathname: '/emergency/[id]', params: { id: person.id } } as any)}
                  />
                </>
              ) : (
                <>
                  <Muted>
                    {isMe ? 'You have' : `${first(person.name)} has`} no emergency card yet: blood group, allergies, medicines,
                    their doctor and who to call, ready to show a doctor.
                  </Muted>
                  {canEdit && (
                    <SecondaryButton
                      label="Add an emergency card"
                      icon="plus"
                      onPress={() => router.push({ pathname: '/emergency/edit/[id]', params: { id: person.id } } as any)}
                    />
                  )}
                </>
              )}
            </Card>

            {close.length > 0 && (
              <Card>
                <CardTitle icon="users">Close family</CardTitle>
                {close.map((g) => (
                  <View key={g.title} style={styles.group}>
                    <Text style={styles.groupTitle}>{g.title}</Text>
                    <View style={styles.chips}>
                      {g.people.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.personChip}
                          onPress={() => router.push({ pathname: '/person/[id]', params: { id: p.id } } as any)}
                          accessibilityRole="button"
                        >
                          <Avatar name={p.name} me={p.id === me?.id} size={24} />
                          <Text style={styles.personChipText} numberOfLines={1}>{p.id === me?.id ? 'You' : p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {expiring.length > 0 && (
              <Card>
                <CardTitle icon="calendar">Expiry dates</CardTitle>
                {expiring.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={styles.docRow}
                    onPress={() => router.push(`/document/${d.id}` as any)}
                    accessibilityRole="button"
                  >
                    <View style={styles.docText}>
                      <Text style={styles.docName} numberOfLines={1}>{d.fileName}</Text>
                      <Text style={[styles.docSub, d.daysLeft < 0 ? styles.over : d.daysLeft <= 90 ? styles.soon : null]}>
                        {longDate(d.expiry)} · {expiryPhrase(d.daysLeft)}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                ))}
              </Card>
            )}

            <Card>
              <CardTitle icon="file-text">Documents</CardTitle>
              {docs === null ? (
                <ActivityIndicator color={color.primary} />
              ) : docs.length === 0 ? (
                <Muted>No documents are marked as {isMe ? 'yours' : `${first(person.name)}'s`} yet.</Muted>
              ) : (
                docs.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={styles.docRow}
                    onPress={() => router.push(`/document/${d.id}` as any)}
                    accessibilityRole="button"
                  >
                    <Feather name={d.file_type === 'pdf' ? 'file-text' : 'image'} size={16} color={color.primary} />
                    <View style={styles.docText}>
                      <Text style={styles.docName} numberOfLines={1}>{d.file_name}</Text>
                      {!!d.category_name && <Text style={styles.docSub}>{d.category_name}</Text>}
                    </View>
                    <Feather name="chevron-right" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                ))
              )}
              <SecondaryButton
                label={`Add a document for ${isMe ? 'yourself' : first(person.name)}`}
                icon="upload"
                onPress={() => router.push({ pathname: '/upload', params: { person: person.id } } as any)}
              />
            </Card>

            {isAdmin && (
              <Card>
                <CardTitle icon="git-branch">Family tree</CardTitle>
                <SecondaryButton
                  label={`Add a relative of ${isMe ? 'yours' : first(person.name)}`}
                  icon="user-plus"
                  onPress={() => setSheet({ mode: 'add', relativeId: person.id })}
                />
                <SecondaryButton
                  label={`Connect ${isMe ? 'yourself' : first(person.name)} to someone`}
                  icon="link"
                  onPress={() => setSheet({ mode: 'connect', personId: person.id })}
                />
                {!person.userId && !invite && (
                  <SecondaryButton label="Link to their AskLocker account" icon="smartphone" onPress={openLink} />
                )}
                {!person.userId && !!invite && (
                  <SecondaryButton label="Withdraw the invitation" icon="x-circle" onPress={withdraw} disabled={withdrawing} />
                )}
                {!person.userId && (
                  <DangerButton label="Take out of the tree" icon="user-minus" onPress={() => setConfirmRemove(true)} />
                )}
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {currentFamily && tree && graph && (
        <PersonSheet
          state={sheet}
          familyId={currentFamily.id}
          tree={tree}
          graph={graph}
          meId={me?.id ?? null}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); load(); }}
        />
      )}

      <Modal visible={linkOpen} transparent animationType="fade" onRequestClose={() => !linking && setLinkOpen(false)}>
        {/* The email field sits mid-screen: keep the dialog above the phone's keyboard. */}
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.overlay} onPress={() => !linking && setLinkOpen(false)}>
            <Pressable style={styles.dialog} onPress={() => {}}>
              <Text style={styles.dialogTitle}>Link {person ? first(person.name) : 'them'} to their account</Text>
              <Text style={styles.dialogText}>
                If {person ? first(person.name) : 'they'} has signed up for AskLocker, enter the email they sign in with. They
                get an invitation, and once they accept they join this family as a viewer and keep everything here: their
                place in the tree, their documents and their emergency card.
              </Text>
              <Muted>Already added in Manage Family? Linking makes the two entries one.</Muted>
              <Field
                label="Their email"
                placeholder="The email they sign in with"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                value={linkEmail}
                onChangeText={(v) => { setLinkEmail(v); setLinkError(null); }}
                onSubmitEditing={link}
                editable={!linking}
              />
              {!!linkError && <Text style={styles.linkError} accessibilityLiveRegion="polite">{linkError}</Text>}
              <View style={styles.dialogButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setLinkOpen(false)} disabled={linking} accessibilityRole="button">
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkBtn} onPress={link} disabled={linking} accessibilityRole="button" accessibilityLabel="Send invitation">
                  {linking ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.confirmText}>Send invitation</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={confirmRemove} transparent animationType="fade" onRequestClose={() => setConfirmRemove(false)}>
        <Pressable style={styles.overlay} onPress={() => !removing && setConfirmRemove(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>Take {person ? first(person.name) : 'them'} out of the tree?</Text>
            <Text style={styles.dialogText}>
              Their links to the family go too. Their documents stay in the family, no longer marked as theirs.
            </Text>
            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmRemove(false)} disabled={removing} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={remove} disabled={removing} accessibilityRole="button">
                {removing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.confirmText}>Take out</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 40 },
  flex: { flex: 1 },
  hero: { alignItems: 'center', gap: space.sm },
  name: { ...type.heading, fontSize: 17, textAlign: 'center' },
  relation: { ...type.body, color: color.primary, fontWeight: '500', textAlign: 'center' },
  nickname: { ...type.body, color: color.textBody, textAlign: 'center' },
  accountPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: color.tint, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs,
  },
  accountText: { ...type.meta, color: color.primary },
  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs,
  },
  pendingText: { ...type.meta, color: '#B45309', fontWeight: '600' },
  group: { gap: space.sm },
  groupTitle: type.overline,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  personChip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40, maxWidth: '100%',
    paddingLeft: space.xs, paddingRight: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
  },
  personChipText: { ...type.caption, color: color.text, fontWeight: '500' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  docText: { flex: 1, minWidth: 0, gap: 2 },
  docName: type.label,
  docSub: type.caption,
  emergencyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  allergies: { ...type.body, color: '#991B1B' },
  soon: { color: '#B45309' },
  over: { color: '#B91C1C' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: space.xl },
  dialog: { backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg + 4, width: '100%', maxWidth: 360, gap: space.sm },
  dialogTitle: { ...type.title, color: color.text },
  dialogText: { ...type.body, color: color.textMuted },
  dialogButtons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  cancelBtn: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.divider, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...type.button, color: '#4B5563' },
  confirmBtn: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' },
  confirmText: { ...type.button, color: '#FFFFFF' },
  linkBtn: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  linkError: { ...type.caption, color: '#B91C1C' },
});
