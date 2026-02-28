import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './auth';
import { fetchUserFamilies, fetchFamilyMembers } from './api';
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
});

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [families, setFamilies] = useState<FamilyWithMembership[]>([]);
  const [members, setMembers] = useState<FamilyMemberWithUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const currentFamily = families[0]?.families ?? null;
  const membership = families[0] ?? null;
  const needsFamily = fetched && !!user && families.length === 0;

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
      return;
    }
    // Fetch silently on login
    fetchUserFamilies(user.id)
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
      }}
    >
      {children}
    </FamilyContext.Provider>
  );
}

export const useFamily = () => useContext(FamilyContext);
