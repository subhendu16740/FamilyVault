import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './auth';
import { fetchUserFamilies, fetchFamilyMembers } from './api';
import { storageGet, storageSet, accountKey } from './storage';
import type { Database, FamilyMemberWithUser, FamilyWithMembership } from './database.types';

type Family = Database['public']['Tables']['families']['Row'];

interface FamilyContextType {
  currentFamily: Family | null;
  families: FamilyWithMembership[];
  membership: FamilyWithMembership | null;
  members: FamilyMemberWithUser[];
  loading: boolean;
  needsFamily: boolean;
  refreshFamilies: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  /** Show another of the user's families. Remembered on this device. */
  switchFamily: (familyId: string) => void;
}

const FamilyContext = createContext<FamilyContextType>({
  currentFamily: null,
  families: [],
  membership: null,
  members: [],
  loading: true,
  needsFamily: false,
  refreshFamilies: async () => {},
  refreshMembers: async () => {},
  switchFamily: () => {},
});

const selectionKey = accountKey.family;

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [families, setFamilies] = useState<FamilyWithMembership[]>([]);
  const [members, setMembers] = useState<FamilyMemberWithUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The family this person chose, while they still belong to it; otherwise
  // the one they have been in longest (fetchUserFamilies is oldest first).
  // Never "the newest": an admin can add anyone who has an account, and that
  // must not change which vault they see and upload into.
  const membership = families.find((f) => f.family_id === selectedId) ?? families[0] ?? null;
  const currentFamily = membership?.families ?? null;
  const needsFamily = fetched && !!user && families.length === 0;

  const switchFamily = useCallback((familyId: string) => {
    setSelectedId(familyId);
    if (user) storageSet(selectionKey(user.id), familyId);
  }, [user?.id]);

  // Lazy fetch — only loads when explicitly called
  const refreshFamilies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await fetchUserFamilies(user.id);
      setFamilies(data);
    } catch (_) {
      // silently handle — family is optional
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [user]);

  const refreshMembers = useCallback(async () => {
    if (!currentFamily) return;
    try {
      const data = await fetchFamilyMembers(currentFamily.id);
      setMembers(data);
    } catch (_) {
      // silently handle
    }
  }, [currentFamily?.id]);

  // Auto-fetch families when user is available (silently, non-blocking)
  useEffect(() => {
    if (!user) {
      setFamilies([]);
      setMembers([]);
      setFetched(false);
      setSelectedId(null);
      return;
    }
    // Fetch silently on login — the remembered choice first, so screens never
    // load the default family only to switch a moment later.
    storageGet(selectionKey(user.id))
      .then((id) => setSelectedId(id))
      .then(() => fetchUserFamilies(user.id))
      .then((data) => setFamilies(data))
      .catch(() => {})
      .finally(() => setFetched(true));
  }, [user?.id]);

  // Load members when current family changes
  useEffect(() => {
    if (!currentFamily) {
      setMembers([]);
      return;
    }

    fetchFamilyMembers(currentFamily.id)
      .then(setMembers)
      .catch(() => {});
  }, [currentFamily?.id]);

  return (
    <FamilyContext.Provider
      value={{
        currentFamily,
        families,
        membership,
        members,
        loading,
        needsFamily,
        refreshFamilies,
        refreshMembers,
        switchFamily,
      }}
    >
      {children}
    </FamilyContext.Provider>
  );
}

export const useFamily = () => useContext(FamilyContext);
