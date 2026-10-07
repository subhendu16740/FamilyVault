// Everyone a document can belong to, for "Whose document is this?" on
// Upload and in the document viewer: the family tree's people once migration
// 031 is applied — a grandparent without an account included — and, until
// then, the family's members, as before. Member ids are person ids for
// members (031 creates each member's person with their member id), so a
// document marked either way points at the same person.

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from './auth';
import { useFamily } from './family-context';
import { fetchFamilyTree, type ExpiringDocument } from './api';
import { buildGraph, relationTo } from '../../supabase/functions/_shared/kinship';

export interface Owner {
  id: string;
  name: string;
  /** "Me", "Mother", "Grandmother (Nani)"… or the old free-text relationship. */
  label: string | null;
  isMe: boolean;
}

/**
 * The people of one vault's tree: the vault a document is going to on Upload
 * (046: the person chooses), or the one a document is in. The open vault
 * when none is given.
 */
export function useDocumentOwners(familyId?: string | null): Owner[] {
  const { user } = useAuth();
  const { currentFamily, members } = useFamily();
  const target = familyId ?? currentFamily?.id ?? null;
  // Kept with the vault it is for, so a change of vault never shows the last one's people.
  const [owners, setOwners] = useState<{ familyId: string; list: Owner[] } | null>(null);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!target) return;
    fetchFamilyTree(target)
      .then(({ people, links }) => {
        if (cancelled || !people.length) return;
        const graph = buildGraph(people, links);
        const me = people.find((p) => p.userId === user?.id) ?? null;
        const list = people.map((p) => {
          const rel = me && p.id !== me.id ? relationTo(graph, me.id, p.id) : null;
          // The relation and the family's own nickname (045), never a Hindi word on its own.
          const label = [p.id === me?.id ? 'Me' : rel?.en, p.nickname ? `"${p.nickname}"` : null].filter(Boolean).join(' · ');
          return { id: p.id, name: p.name, label: label || null, isMe: p.id === me?.id };
        });
        setOwners({ familyId: target, list: [...list.filter((o) => o.isMe), ...list.filter((o) => !o.isMe)] });
      })
      .catch(() => undefined);           // before 031: the members below
    return () => { cancelled = true; };
  }, [target, user?.id]));

  if (owners && owners.familyId === target) return owners.list;
  // Members are known only for the open vault.
  if (target !== currentFamily?.id) return [];
  const fromMembers = members.map((m) => ({
    id: m.id,
    name: m.alias || m.users.display_name,
    label: m.user_id === user?.id ? 'Me' : m.relationship || null,
    isMe: m.user_id === user?.id,
  }));
  return [...fromMembers.filter((o) => o.isMe), ...fromMembers.filter((o) => !o.isMe)];
}

export interface PersonBadge {
  text: string;
  level: 'soon' | 'over';
}

const SOON_DAYS = 90;

/** A person's most urgent document date, for their card in the tree. */
export function badgeFromExpiries(expiring: ExpiringDocument[], personId: string): PersonBadge | null {
  const mine = expiring.filter((d) => d.memberId === personId && d.daysLeft <= SOON_DAYS);
  if (!mine.length) return null;
  const nearest = mine[0];                         // already soonest first
  // Short enough for a tree card: "Ran out", "40 days left", "2 due soon".
  if (nearest.daysLeft < 0) return { text: mine.length > 1 ? `${mine.length} ran out` : 'Ran out', level: 'over' };
  const when = nearest.daysLeft <= 60 ? `${nearest.daysLeft} days` : `${Math.round(nearest.daysLeft / 30)} months`;
  return { text: mine.length > 1 ? `${mine.length} due soon` : `${when} left`, level: 'soon' };
}
