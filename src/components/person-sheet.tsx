// Adding someone to the family tree, connecting someone already in it, or
// editing their details — one sheet, three modes.
//
// A new person is always added already connected ("the father of Rohan"), so
// the tree never fills up with people floating nowhere. Gender is asked only
// to name relations (mother or father, Dadi or Nani) and can be left unsaid.
// Errors are shown in the sheet, never with Alert.alert, which does nothing
// on the web.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  addFamilyPerson, linkFamilyPeople, updateFamilyPerson,
  type FamilyTree, type RelativeKind,
} from '../lib/api';
import { parseDocumentDate } from '../lib/dates';
import { spousesOf, type Gender, type KinGraph } from '../../supabase/functions/_shared/kinship';
import { Field, PrimaryButton, Status } from './settings-ui';
import { color, radius, size, space, type } from '../constants/design';

export type PersonSheetState =
  | { mode: 'add'; relativeId?: string | null }
  | { mode: 'connect'; personId: string }
  | { mode: 'edit'; personId: string };

interface Props {
  state: PersonSheetState | null;
  familyId: string;
  tree: FamilyTree;
  graph: KinGraph;
  meId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const RELATIONS: Array<{ kind: RelativeKind; label: string }> = [
  { kind: 'parent', label: 'Parent' },
  { kind: 'child', label: 'Child' },
  { kind: 'spouse', label: 'Husband or wife' },
  { kind: 'sibling', label: 'Brother or sister' },
];

const GENDERS: Array<{ value: Gender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: null, label: 'Not saying' },
];

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "14/03/1977" → "1977-03-14". A four-digit year, and not in the future. */
function toIsoDate(text: string): string | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  if (!/\d{4}\s*$/.test(t)) return 'invalid';
  const d = parseDocumentDate(t);
  if (!d || d.getTime() > Date.now()) return 'invalid';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromIsoDate(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function PersonSheet({ state, familyId, tree, graph, meId, onClose, onSaved }: Props) {
  const subject = state && state.mode !== 'add' ? tree.people.find((p) => p.id === state.personId) ?? null : null;
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>(null);
  const [birth, setBirth] = useState('');
  const [relation, setRelation] = useState<RelativeKind | null>(null);
  const [relativeId, setRelativeId] = useState<string | null>(null);
  const [bothParents, setBothParents] = useState(true);
  // The whole family as chips is a wall: show the chosen person, and the rest on request.
  const [pickAny, setPickAny] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setProblem(null);
    setSaving(false);
    setBothParents(true);
    setRelation(null);
    setPickAny(false);
    if (state.mode === 'add') {
      setName('');
      setGender(null);
      setBirth('');
      setRelativeId(state.relativeId ?? meId);
    } else {
      setName(subject?.name ?? '');
      setGender(subject?.gender ?? null);
      setBirth(fromIsoDate(subject?.birthDate));
      setRelativeId(meId && meId !== state.personId ? meId : null);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who the new link can point at: everyone but the person being connected.
  const relatives = useMemo(() => {
    const others = tree.people.filter((p) => p.id !== subject?.id);
    return [...others.filter((p) => p.id === meId), ...others.filter((p) => p.id !== meId)];
  }, [tree, subject, meId]);

  // A child of Rohan is usually Asha's child too: offer the spouse as the other parent.
  const otherParent = useMemo(() => {
    if (relation !== 'child' || !relativeId) return null;
    const spouse = spousesOf(graph, relativeId).find((s) => s !== subject?.id);
    return spouse ? tree.people.find((p) => p.id === spouse) ?? null : null;
  }, [relation, relativeId, graph, tree, subject]);

  if (!state) return null;
  const mode = state.mode;
  const asksDetails = mode !== 'connect';
  const asksRelation = mode !== 'edit';
  const who = mode === 'add' ? (name.trim() ? first(name) : 'They') : first(subject?.name ?? 'They');

  const save = async () => {
    setProblem(null);
    const details = { name: name.trim(), gender, birthDate: null as string | null };
    if (asksDetails) {
      if (!details.name) { setProblem('Type their name.'); return; }
      if (details.name.length > 80) { setProblem('That name is too long.'); return; }
      const iso = toIsoDate(birth);
      if (iso === 'invalid') { setProblem('Write the date of birth as DD/MM/YYYY, with the full year.'); return; }
      details.birthDate = iso;
    }
    if (asksRelation && relatives.length > 0 && (!relation || !relativeId)) {
      setProblem(who === 'They' ? 'Choose how they are related, and to whom.' : `Choose how ${who} is related, and to whom.`);
      return;
    }
    setSaving(true);
    try {
      const other = relation === 'child' && bothParents ? otherParent?.id ?? null : null;
      if (mode === 'add') {
        await addFamilyPerson(familyId, details, relation && relativeId ? { kind: relation, relativeId, otherParentId: other } : undefined);
      } else if (mode === 'connect') {
        await linkFamilyPeople(familyId, state.personId, relation!, relativeId!, other);
      } else {
        await updateFamilyPerson(state.personId, details);
      }
      onSaved();
    } catch (err: any) {
      setProblem(err?.message || 'Could not save. Please try again.');
      setSaving(false);
    }
  };

  const title = mode === 'add' ? 'Add to the family tree' : mode === 'connect' ? `Where does ${who} fit?` : `Edit ${who}`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={() => !saving && onClose()} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={size.icon} color={color.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {mode === 'add' && (
            <Text style={styles.intro}>
              They don't need an account. You can mark documents as theirs, and ask about them by relation — "Nani's
              pension papers".
            </Text>
          )}

          {asksDetails && (
            <Field label="Name" value={name} onChangeText={setName} placeholder="Their full name" autoCapitalize="words" />
          )}

          {asksRelation && relatives.length > 0 && (
            <>
              <Text style={styles.label}>{who === 'They' ? 'They are the…' : `${who} is the…`}</Text>
              <View style={styles.chips}>
                {RELATIONS.map((r) => (
                  <Chip key={r.kind} label={r.label} on={relation === r.kind} onPress={() => setRelation(r.kind)} />
                ))}
              </View>
              <Text style={styles.label}>…of</Text>
              <View style={styles.chips}>
                {(pickAny || !relativeId ? relatives : relatives.filter((p) => p.id === relativeId)).map((p) => (
                  <Chip
                    key={p.id}
                    label={p.id === meId ? `Me (${first(p.name)})` : p.name}
                    on={relativeId === p.id}
                    onPress={() => { setRelativeId(p.id); setPickAny(false); }}
                  />
                ))}
                {!pickAny && !!relativeId && relatives.length > 1 && (
                  <TouchableOpacity style={styles.more} onPress={() => setPickAny(true)} accessibilityRole="button">
                    <Text style={styles.moreText}>Someone else</Text>
                    <Feather name="chevron-down" size={16} color={color.primary} />
                  </TouchableOpacity>
                )}
              </View>
              {otherParent && (
                <TouchableOpacity
                  style={styles.toggle}
                  onPress={() => setBothParents((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: bothParents }}
                >
                  <Feather name={bothParents ? 'check-square' : 'square'} size={20} color={color.primary} />
                  <Text style={styles.toggleText}>{first(otherParent.name)} is a parent too</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {asksDetails && (
            <>
              <Text style={styles.label}>Gender</Text>
              <View style={styles.chips}>
                {GENDERS.map((g) => (
                  <Chip key={g.label} label={g.label} on={gender === g.value} onPress={() => setGender(g.value)} />
                ))}
              </View>
              <Text style={styles.hint}>Used only to name relations: mother or father, Dadi or Nani.</Text>
              <Field
                label="Date of birth (optional)"
                value={birth}
                onChangeText={setBirth}
                placeholder="DD/MM/YYYY"
                keyboardType="numbers-and-punctuation"
                hint="Tells elder from younger: Tau or Chacha, Didi or Behen."
              />
            </>
          )}

          {problem && <Status kind="error">{problem}</Status>}
          <PrimaryButton
            label={mode === 'add' ? 'Add to the tree' : mode === 'connect' ? 'Connect' : 'Save'}
            onPress={save}
            busy={saving}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      {on && <Feather name="check" size={14} color="#FFFFFF" />}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingBottom: space.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.border, marginTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { ...type.title, flex: 1 },
  close: { width: size.control, height: size.control, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  body: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.lg },
  intro: type.caption,
  label: { ...type.label, marginTop: space.xs },
  hint: { ...type.caption, marginTop: -space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.inputBorder,
    backgroundColor: color.surface,
    maxWidth: '100%',
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { ...type.caption, color: color.text },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: space.sm },
  moreText: { ...type.caption, color: color.primary, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: size.control },
  toggleText: type.body,
});
