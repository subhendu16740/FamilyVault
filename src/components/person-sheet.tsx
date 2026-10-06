// Adding someone to the family tree, connecting someone already in it, or
// editing their details — one sheet, three modes.
//
// A new person is always added already connected ("the father of Rohan"), so
// the tree never fills up with people floating nowhere. Gender is asked only
// to name relations (mother or father, aunt or uncle) and can be left unsaid.
// A nickname (045) is the family's own name for them, typed in, never made up
// for them: everyone in the family sees it, and Ask understands it.
// Errors are shown in the sheet, never with Alert.alert, which does nothing
// on the web.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  addFamilyPerson, linkFamilyPeople, setFamilyPersonNickname, updateFamilyPerson,
  type FamilyTree, type RelativeKind,
} from '../lib/api';
import { formatDateInput, parseDocumentDate } from '../lib/dates';
import { parentsOf, shortName, siblingsSharingParents, spousesOf, type Gender, type KinGraph } from '../../supabase/functions/_shared/kinship';
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

// "K C Das Mohapatra" is not "K": an initial alone says nothing.
const first = shortName;

/** "14/03/1977" → "1977-03-14". A four-digit year, and not in the future. */
function toIsoDate(text: string): string | null | 'invalid' | 'future' {
  // Shaped again here, so digits alone ("26081962") are accepted however
  // they arrived — pasted, autofilled or typed.
  const t = formatDateInput(text.trim());
  if (!t) return null;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return 'invalid';
  const d = parseDocumentDate(t);
  if (!d) return 'invalid';
  if (d.getTime() > Date.now()) return 'future';
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
  const [nickname, setNickname] = useState('');
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
      setNickname('');
      setGender(null);
      setBirth('');
      setRelativeId(state.relativeId ?? meId);
    } else {
      setName(subject?.name ?? '');
      setNickname(subject?.nickname ?? '');
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

  // What is actually recorded. A brother or sister of someone whose parents
  // are in the tree is those parents' child: record that, and the tree, every
  // relation and "Papa's daughter" follow. A sibling link is only for when
  // nobody's parents are known. And a parent added to someone is their
  // sibling-linked brothers' and sisters' parent too.
  const plan = useMemo(() => {
    if (!state || state.mode === 'edit' || !relation || !relativeId) return null;
    const subjectId = state.mode === 'connect' ? state.personId : null;
    const theirs = parentsOf(graph, relativeId);
    const mine = subjectId ? parentsOf(graph, subjectId) : [];
    if (relation === 'sibling' && theirs.length > 0 && mine.length === 0) {
      return { kind: 'child' as RelativeKind, of: theirs[0], also: theirs[1] ?? null, adopt: null as string | null, alsoChildOf: theirs, alsoParentOf: [] as Array<{ id: string; missing: string[] }> };
    }
    if (relation === 'sibling' && subjectId && mine.length > 0 && theirs.length === 0) {
      // The other way round: the relative joins the subject's parents.
      return { kind: 'sibling' as RelativeKind, of: relativeId, also: null, adopt: relativeId, alsoChildOf: mine, alsoParentOf: [] as Array<{ id: string; missing: string[] }> };
    }
    const alsoParentOf = relation === 'parent' ? siblingsSharingParents(graph, relativeId).filter((c) => c.id !== subjectId) : [];
    return { kind: relation, of: relativeId, also: null as string | null, adopt: null as string | null, alsoChildOf: [] as string[], alsoParentOf };
  }, [state, relation, relativeId, graph]);
  const nameOf = (id: string) => first(tree.people.find((p) => p.id === id)?.name ?? '');

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
      if (nickname.trim().length > 40) { setProblem('A nickname can be at most 40 characters.'); return; }
      const iso = toIsoDate(birth);
      if (iso === 'invalid') { setProblem('That date of birth doesn\'t look right. Type the day, month and full year, like 26081962.'); return; }
      if (iso === 'future') { setProblem('That date of birth is in the future.'); return; }
      details.birthDate = iso;
    }
    if (asksRelation && relatives.length > 0 && (!relation || !relativeId)) {
      setProblem(who === 'They' ? 'Choose how they are related, and to whom.' : `Choose how ${who} is related, and to whom.`);
      return;
    }
    setSaving(true);
    try {
      const other = relation === 'child' && bothParents ? otherParent?.id ?? null : plan?.also ?? null;
      let personId = state.mode === 'connect' ? state.personId : null;
      if (mode === 'add') {
        personId = await addFamilyPerson(familyId, details, plan ? { kind: plan.kind, relativeId: plan.of, otherParentId: other } : undefined);
      } else if (mode === 'connect') {
        await linkFamilyPeople(familyId, state.personId, plan!.kind, plan!.of, other);
      }
      if (plan && personId && mode !== 'edit') {
        // Best effort: the link asked for is saved; these only complete the picture.
        if (plan.adopt) {
          await linkFamilyPeople(familyId, plan.adopt, 'child', plan.alsoChildOf[0], plan.alsoChildOf[1] ?? null).catch(() => undefined);
        }
        for (const sibling of plan.alsoParentOf) {
          await linkFamilyPeople(familyId, sibling.id, 'child', personId, sibling.missing[0] ?? null).catch(() => undefined);
        }
      }
      if (mode === 'edit') {
        await updateFamilyPerson(state.personId, details);
      }
      // The nickname has a function of its own (045), so a project without it
      // still saves everything else. Only sent when it changed.
      const named = state.mode === 'edit' ? state.personId : mode === 'add' ? personId : null;
      if (named && tree.nicknames && nickname.trim() !== (subject?.nickname ?? '').trim()) {
        await setFamilyPersonNickname(named, nickname);
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
              They don't need an account. You can mark documents as theirs, and ask about them by relation or nickname — "Nani's
              pension papers".
            </Text>
          )}

          {asksDetails && (
            <Field label="Name" value={name} onChangeText={setName} placeholder="Their full name" autoCapitalize="words" />
          )}
          {asksDetails && tree.nicknames && (
            <Field
              label="Nickname (optional)"
              value={nickname}
              onChangeText={setNickname}
              placeholder="What the family calls them, like Pinky or Maa"
              maxLength={40}
              hint={'Everyone in the family sees it, and Ask understands it: "Pinky\'s passport".'}
            />
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
              {!!plan && plan.alsoChildOf.length > 0 && !plan.adopt && (
                <Text style={styles.hint}>
                  {`${who === 'They' ? 'They' : who} will be ${plan.alsoChildOf.map(nameOf).join(' and ')}'s child too.`}
                </Text>
              )}
              {!!plan && !!plan.adopt && (
                <Text style={styles.hint}>{`${nameOf(plan.adopt)} will be ${plan.alsoChildOf.map(nameOf).join(' and ')}'s child too.`}</Text>
              )}
              {!!plan && plan.alsoParentOf.length > 0 && (
                <Text style={styles.hint}>
                  {`${who === 'They' ? 'They' : who} will be ${plan.alsoParentOf.map((c) => nameOf(c.id)).join(' and ')}'s parent too.`}
                </Text>
              )}
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
              <Text style={styles.hint}>Used only to name relations: mother or father, aunt or uncle.</Text>
              <Field
                label="Date of birth (optional)"
                value={birth}
                onChangeText={(text) => setBirth(formatDateInput(text))}
                placeholder="DD/MM/YYYY"
                keyboardType="number-pad"
                maxLength={10}
                hint="Shows their age, and tells elder from younger."
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
