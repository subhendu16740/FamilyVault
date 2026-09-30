// The family tree: everyone in the family, with or without an account, and
// how they are related. Opened from the drawer and from Manage Family.
//
// Each person is labelled from where the viewer stands ("Your mother (Maa)",
// "Your aunt (Bua)"), computed by supabase/functions/_shared/kinship.ts —
// the same rules rag-search uses to answer "Nani's pension papers". A person
// with a document running out within three months carries a badge.
//
// Admins add and connect people; everyone sees the tree. Below the drawing
// the same people are listed plainly, for screen readers and large text.

import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import {
  fetchFamilyTree, fetchExpiringDocuments, isMissingMigration,
  type FamilyTree, type ExpiringDocument,
} from '../lib/api';
import {
  buildGraph, buildForest, relationTo, relationLabel, type KinPerson,
} from '../../supabase/functions/_shared/kinship';
import { ScreenHeader, HeaderButton } from '../components/screen-header';
import { FamilyTreeView, Avatar } from '../components/family-tree-view';
import { badgeFromExpiries } from '../lib/family-people';
import { PersonSheet, type PersonSheetState } from '../components/person-sheet';
import { Card, CardTitle, Body, PrimaryButton, Status, screenStyles } from '../components/settings-ui';
import { color, radius, shadow, size, space, type } from '../constants/design';

export default function FamilyTreeScreen() {
  const { user } = useAuth();
  const { currentFamily, membership } = useFamily();
  const isAdmin = membership?.role === 'admin';
  const [tree, setTree] = useState<FamilyTree | null>(null);
  const [expiring, setExpiring] = useState<ExpiringDocument[]>([]);
  const [problem, setProblem] = useState<{ unavailable: boolean; text: string } | null>(null);
  const [branchIndex, setBranchIndex] = useState<number | null>(null);
  const [sheet, setSheet] = useState<PersonSheetState | null>(null);
  // The drawing is usually wider than a phone: open each branch scrolled to
  // the viewer's own card, or to the middle when they are not in it.
  const canvasRef = useRef<ScrollView>(null);
  const drawingRef = useRef<View>(null);
  const viewport = useRef(0);
  const scrolledFor = useRef<string | null>(null);

  const load = useCallback(() => {
    if (!currentFamily) return () => {};
    let cancelled = false;
    setProblem(null);
    fetchFamilyTree(currentFamily.id)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((err) => {
        if (cancelled) return;
        setTree({ people: [], links: [] });
        setProblem(isMissingMigration(err)
          ? { unavailable: true, text: 'The family tree is not switched on yet.' }
          : { unavailable: false, text: err?.message ?? 'Could not load the family tree.' });
      });
    // Badges come a moment later: the dates live in each document's details.
    fetchExpiringDocuments(currentFamily.id)
      .then((e) => { if (!cancelled) setExpiring(e); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentFamily?.id]);

  useFocusEffect(load);

  const graph = useMemo(() => (tree ? buildGraph(tree.people, tree.links) : null), [tree]);
  const me = tree?.people.find((p) => p.userId === user?.id) ?? null;
  const forest = useMemo(() => (graph ? buildForest(graph, me?.id ?? null) : null), [graph, me?.id]);
  const shown = forest && forest.branches.length
    ? forest.branches[Math.min(branchIndex ?? forest.first, forest.branches.length - 1)]
    : null;

  const meInShown = !!(shown && me && shown.roots.some(function has(u): boolean {
    return u.person.id === me.id || u.spouses.some((s) => s.id === me.id) || u.children.some(has);
  }));
  const scrollOnce = (x: number) => {
    if (!shown || scrolledFor.current === shown.key) return;
    scrolledFor.current = shown.key;
    canvasRef.current?.scrollTo({ x: Math.max(0, x), animated: false });
  };

  const labelFor = (id: string) => (graph && me ? relationLabel(relationTo(graph, me.id, id)) : null);
  const badgeFor = (id: string) => badgeFromExpiries(expiring, id);
  const open = (p: KinPerson) => router.push({ pathname: '/person/[id]', params: { id: p.id } } as any);

  const everyone = useMemo(() => {
    if (!tree) return [];
    const others = tree.people.filter((p) => p.id !== me?.id);
    return me ? [me, ...others] : others;
  }, [tree, me]);

  return (
    <SafeAreaView style={screenStyles.safe} edges={['top']}>
      <ScreenHeader
        title="Family tree"
        subtitle={currentFamily?.name}
        fallback="/family"
        right={isAdmin && tree && !problem ? <HeaderButton icon="user-plus" label="Add" onPress={() => setSheet({ mode: 'add' })} /> : undefined}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {tree === null ? (
          <View style={styles.center}><ActivityIndicator color={color.primary} /></View>
        ) : problem ? (
          <Status kind="error">{problem.text}</Status>
        ) : (
          <>
            {!shown && (
              <Card>
                <CardTitle icon="git-branch">Start your family tree</CardTitle>
                <Body>
                  Add parents, children and grandparents — they don't need an account. Mark documents as theirs, and
                  ask about them by relation, like "Nani's pension papers".
                </Body>
                {isAdmin
                  ? <PrimaryButton label="Add someone" icon="user-plus" onPress={() => setSheet({ mode: 'add' })} />
                  : <Text style={styles.muted}>Ask a family admin to add people.</Text>}
              </Card>
            )}

            {forest && forest.branches.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChips}>
                {forest.branches.map((b, i) => {
                  const on = b === shown;
                  return (
                    <TouchableOpacity
                      key={b.key}
                      style={[styles.branchChip, on && styles.branchChipOn]}
                      onPress={() => setBranchIndex(i)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.branchText, on && styles.branchTextOn]}>{b.title}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {shown && (
              <View style={styles.canvas} onLayout={(e) => { viewport.current = e.nativeEvent.layout.width; }}>
                <ScrollView
                  ref={canvasRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.canvasInner}
                  onContentSizeChange={(w) => { if (!meInShown) scrollOnce((w - viewport.current) / 2); }}
                >
                  <View ref={drawingRef} collapsable={false}>
                    <FamilyTreeView
                      branch={shown}
                      meId={me?.id ?? null}
                      labelFor={labelFor}
                      badgeFor={badgeFor}
                      onPressPerson={open}
                      measureIn={drawingRef}
                      onMeLayout={(cx) => scrollOnce(space.md + cx - viewport.current / 2)}
                    />
                  </View>
                </ScrollView>
              </View>
            )}

            {forest && forest.loose.length > 0 && (
              <>
                <Text style={styles.section}>Not in the tree yet</Text>
                <View style={styles.list}>
                  {forest.loose.map((p, i) => (
                    <View key={p.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <TouchableOpacity style={styles.rowMain} onPress={() => open(p)} accessibilityRole="button">
                        <Avatar name={p.name} me={p.id === me?.id} size={size.iconBox} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowName} numberOfLines={1}>{p.id === me?.id ? `${p.name} (you)` : p.name}</Text>
                          <Text style={styles.rowSub}>Not connected to anyone yet</Text>
                        </View>
                      </TouchableOpacity>
                      {isAdmin && (
                        <TouchableOpacity
                          style={styles.connect}
                          onPress={() => setSheet({ mode: 'connect', personId: p.id })}
                          accessibilityRole="button"
                          accessibilityLabel={`Connect ${p.name}`}
                        >
                          <Text style={styles.connectText}>Connect</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}

            {everyone.length > 0 && (
              <>
                <Text style={styles.section}>Everyone</Text>
                <View style={styles.list}>
                  {everyone.map((p, i) => {
                    const label = p.id === me?.id ? 'You' : labelFor(p.id);
                    const badge = badgeFor(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.row, styles.rowMain, i > 0 && styles.rowBorder]}
                        onPress={() => open(p)}
                        accessibilityRole="button"
                      >
                        <Avatar name={p.name} me={p.id === me?.id} size={size.iconBox} />
                        <View style={styles.rowText}>
                          <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.rowSub} numberOfLines={1}>
                            {[label, p.userId && p.id !== me?.id ? 'has an account' : null].filter(Boolean).join(' · ') || 'Family'}
                          </Text>
                        </View>
                        {badge && (
                          <Feather name="alert-circle" size={16} color={badge.level === 'over' ? '#B91C1C' : '#B45309'} />
                        )}
                        <Feather name="chevron-right" size={16} color="#9CA3AF" />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  center: { alignItems: 'center', paddingVertical: 40 },
  muted: type.caption,
  branchChips: { gap: space.sm },
  branchChip: {
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.inputBorder,
    backgroundColor: color.surface,
    justifyContent: 'center',
  },
  branchChipOn: { backgroundColor: color.primary, borderColor: color.primary },
  branchText: { ...type.caption, color: color.text, fontWeight: '500' },
  branchTextOn: { color: '#FFFFFF', fontWeight: '600' },
  canvas: {
    backgroundColor: '#F1F4F9',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    marginHorizontal: -space.xs,
  },
  canvasInner: { padding: space.md, minWidth: '100%', justifyContent: 'center' },
  section: { ...type.overline, marginTop: space.sm, marginLeft: space.xs },
  list: { backgroundColor: color.surface, borderRadius: radius.card, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.divider },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: size.row, paddingHorizontal: space.lg, paddingVertical: space.sm },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: type.label,
  rowSub: type.caption,
  connect: { minHeight: size.control, justifyContent: 'center', paddingHorizontal: space.lg },
  connectText: { ...type.button, color: color.primary },
});
