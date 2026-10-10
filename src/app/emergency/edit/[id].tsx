// Adding or editing one person's emergency card. An admin, or the person
// themselves; the database checks again (032), and its messages are shown as
// they come. Blank fields are cleared, and a card with nothing on it is
// deleted. Confirmation is on screen, never Alert.alert, which does nothing
// on the web.

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../lib/auth';
import { useFamily } from '../../../lib/family-context';
import {
  fetchFamilyTree, fetchEmergencyCard, saveEmergencyCard, isMissingMigration, type FamilyPerson,
} from '../../../lib/api';
import {
  BLOOD_GROUPS, LIMITS, MAX_CONTACTS, bloodGroupLabel, bloodGroupSpoken, cardProblem, emptyCard,
  type BloodGroup, type EmergencyCardInput,
} from '../../../lib/emergency';
import { shortName } from '../../../../supabase/functions/_shared/kinship';
import { ScreenHeader } from '../../../components/screen-header';
import {
  Card, CardTitle, Field, Muted, PrimaryButton, SecondaryButton, DangerButton, Status, screenStyles,
} from '../../../components/settings-ui';
import { color, radius, size, space, type } from '../../../constants/design';
import { track } from '../../../lib/analytics';

type ContactDraft = { name: string; relation: string; phone: string };
const blankContact = (): ContactDraft => ({ name: '', relation: '', phone: '' });

export default function EditEmergencyCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { currentFamily, membership } = useFamily();
  const isAdmin = membership?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [person, setPerson] = useState<FamilyPerson | null>(null);
  const [isMe, setIsMe] = useState(false);
  const [exists, setExists] = useState(false);

  const [blood, setBlood] = useState<BloodGroup | null>(null);
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [medicines, setMedicines] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorPhone, setDoctorPhone] = useState('');
  const [insurer, setInsurer] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [contacts, setContacts] = useState<ContactDraft[]>([blankContact()]);
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Loaded once: coming back to the screen must not throw away what was typed.
  useEffect(() => {
    if (!currentFamily || !id) return;
    let cancelled = false;
    Promise.all([fetchFamilyTree(currentFamily.id), fetchEmergencyCard(currentFamily.id, id)])
      .then(([tree, card]) => {
        if (cancelled) return;
        setPerson(tree.people.find((p) => p.id === id) ?? null);
        setIsMe(tree.people.some((p) => p.id === id && !!p.userId && p.userId === user?.id));
        if (card) {
          setExists(true);
          setBlood(card.bloodGroup);
          setAllergies(card.allergies ?? '');
          setConditions(card.conditions ?? '');
          setMedicines(card.medicines ?? '');
          setDoctorName(card.doctorName ?? '');
          setDoctorPhone(card.doctorPhone ?? '');
          setInsurer(card.insurer ?? '');
          setPolicyNumber(card.policyNumber ?? '');
          setContacts(card.contacts.length > 0
            ? card.contacts.map((c) => ({ name: c.name, relation: c.relation ?? '', phone: c.phone }))
            : [blankContact()]);
          setNotes(card.notes ?? '');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setProblem(isMissingMigration(err) ? "Emergency cards aren't switched on yet." : err?.message ?? "Couldn't load the emergency card.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentFamily?.id, id, user?.id]);

  const canEdit = isAdmin || isMe;
  const whose = isMe ? 'your' : person ? `${shortName(person.name)}'s` : 'their';
  const changed = () => setStatus(null);

  const input = (): EmergencyCardInput => ({
    bloodGroup: blood,
    allergies, conditions, medicines, doctorName, doctorPhone, insurer, policyNumber, notes,
    contacts: contacts.map((c) => ({ name: c.name, relation: c.relation || null, phone: c.phone })),
  });

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/emergency/[id]', params: { id } } as any);
  };

  const send = async (card: EmergencyCardInput) => {
    setSaving(true);
    setStatus(null);
    try {
      await saveEmergencyCard(id, card);
      track('emergency_card_saved', {});
      done();
    } catch (err: any) {
      setStatus(isMissingMigration(err) ? "Emergency cards aren't switched on yet." : err?.message || "Couldn't save. Try again.");
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  const save = () => {
    const card = input();
    const wrong = cardProblem(card);
    if (wrong) { setStatus(wrong); return; }
    send(card);
  };

  const setContact = (i: number, key: keyof ContactDraft, value: string) => {
    setContacts((list) => list.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
    changed();
  };

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader
        title={exists ? 'Edit emergency card' : 'Add an emergency card'}
        subtitle={person?.name}
        fallback={`/emergency/${id}`}
      />
      <ScrollView contentContainerStyle={screenStyles.body} keyboardShouldPersistTaps="handled">
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
        ) : problem ? (
          <Status kind="error">{problem}</Status>
        ) : !person ? (
          <Status kind="error">This person is no longer in the family tree.</Status>
        ) : !canEdit ? (
          <Status kind="error">Only an admin or the person themselves can change this card.</Status>
        ) : (
          <>
            <Muted>Everyone in your family can see this card. Fill in what you know.</Muted>

            <Card>
              <CardTitle icon="droplet">Blood group</CardTitle>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Blood group">
                {BLOOD_GROUPS.map((g) => (
                  <Chip key={g} label={bloodGroupLabel(g)} spoken={bloodGroupSpoken(g)} on={blood === g}
                        onPress={() => { setBlood(g); changed(); }} />
                ))}
                <Chip label="Not known" spoken="Blood group not known" on={blood === null}
                      onPress={() => { setBlood(null); changed(); }} />
              </View>
              <Muted>Bombay (hh) is rare. Choose it only if a blood test said so.</Muted>
            </Card>

            <Card>
              <CardTitle icon="activity">Health</CardTitle>
              <Field label="Allergies" value={allergies} onChangeText={(t) => { setAllergies(t); changed(); }}
                     placeholder="Penicillin, peanuts…" multiline maxLength={LIMITS.allergies}
                     hint="Medicines and foods that cause a reaction. Shown in red on the card." />
              <Field label="Health conditions" value={conditions} onChangeText={(t) => { setConditions(t); changed(); }}
                     placeholder="Diabetes, high blood pressure…" multiline maxLength={LIMITS.conditions} />
              <Field label="Medicines" value={medicines} onChangeText={(t) => { setMedicines(t); changed(); }}
                     placeholder="Metformin 500 mg, morning and night…" multiline maxLength={LIMITS.medicines} />
            </Card>

            <Card>
              <CardTitle icon="user-check">Doctor</CardTitle>
              <Field label="Doctor's name" value={doctorName} onChangeText={(t) => { setDoctorName(t); changed(); }}
                     placeholder="Dr Sharma" maxLength={LIMITS.doctorName} />
              <Field label="Doctor's phone" value={doctorPhone} onChangeText={(t) => { setDoctorPhone(t); changed(); }}
                     placeholder="+91 98765 43210" keyboardType="phone-pad" autoComplete="off" maxLength={20} />
            </Card>

            <Card>
              <CardTitle icon="shield">Health insurance</CardTitle>
              <Field label="Insurance company" value={insurer} onChangeText={(t) => { setInsurer(t); changed(); }}
                     maxLength={LIMITS.insurer} />
              <Field label="Policy number" value={policyNumber} onChangeText={(t) => { setPolicyNumber(t); changed(); }}
                     autoCapitalize="characters" maxLength={LIMITS.policyNumber}
                     hint="Hospitals ask for it before cashless treatment." />
            </Card>

            <Card>
              <CardTitle icon="phone">People to call</CardTitle>
              {contacts.map((c, i) => (
                <View key={i} style={[styles.contact, i > 0 && styles.contactBorder]}>
                  <View style={styles.contactHead}>
                    <Text style={styles.contactTitle}>Person {i + 1}</Text>
                    {(contacts.length > 1 || c.name || c.phone || c.relation) && (
                      <TouchableOpacity
                        style={styles.remove}
                        onPress={() => { setContacts((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [blankContact()])); changed(); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove person ${i + 1}`}
                      >
                        <Feather name="x" size={16} color={color.textMuted} />
                        <Text style={styles.removeText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Field label="Name" value={c.name} onChangeText={(t) => setContact(i, 'name', t)} maxLength={LIMITS.contactName} />
                  <Field label="Relation (optional)" value={c.relation} onChangeText={(t) => setContact(i, 'relation', t)}
                         placeholder="Son, neighbour…" maxLength={LIMITS.contactRelation} />
                  <Field label="Phone" value={c.phone} onChangeText={(t) => setContact(i, 'phone', t)}
                         placeholder="+91 98765 43210" keyboardType="phone-pad" autoComplete="off" maxLength={20} />
                </View>
              ))}
              {contacts.length < MAX_CONTACTS && (
                <SecondaryButton label="Add someone to call" icon="user-plus"
                                 onPress={() => { setContacts((list) => [...list, blankContact()]); changed(); }} />
              )}
            </Card>

            <Card>
              <CardTitle icon="file-text">Other notes</CardTitle>
              <Field label="Anything else a doctor should know" value={notes} onChangeText={(t) => { setNotes(t); changed(); }}
                     placeholder="Hearing aid, pacemaker, organ donor…" multiline maxLength={LIMITS.notes} />
            </Card>

            {!!status && <Status kind="error">{status}</Status>}
            <PrimaryButton label="Save" icon="check" onPress={save} busy={saving && !confirmDelete} />
            {exists && <DangerButton label="Delete this card" icon="trash-2" onPress={() => setConfirmDelete(true)} disabled={saving} />}
          </>
        )}
      </ScrollView>

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setConfirmDelete(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>Delete {whose} emergency card?</Text>
            <Text style={styles.dialogText}>Everything on it will be deleted.</Text>
            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmDelete(false)} disabled={saving} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => send(emptyCard())} disabled={saving} accessibilityRole="button">
                {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.confirmText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ label, spoken, on, onPress }: { label: string; spoken: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      aria-checked={on}
      accessibilityLabel={spoken}
    >
      {on && <Feather name="check" size={14} color="#FFFFFF" />}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 40 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, minWidth: 56, justifyContent: 'center',
    paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: color.inputBorder,
    backgroundColor: color.surface, maxWidth: '100%',
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { ...type.label, color: color.text },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
  contact: { gap: space.sm },
  contactBorder: { borderTopWidth: 1, borderTopColor: color.divider, paddingTop: space.md },
  contactHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contactTitle: type.overline,
  remove: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: size.control, paddingHorizontal: space.sm },
  removeText: { ...type.caption, color: color.textMuted },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: space.xl },
  dialog: { backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg + 4, width: '100%', maxWidth: 360, gap: space.sm },
  dialogTitle: { ...type.title, color: color.text },
  dialogText: { ...type.body, color: color.textMuted },
  dialogButtons: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  cancelBtn: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.divider, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...type.button, color: '#4B5563' },
  confirmBtn: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' },
  confirmText: { ...type.button, color: '#FFFFFF' },
});
