// ─── Is the family on Family Plus? ──────────────────────────────
//
// Starred features (★, <PlusTag />) are for Family Plus families: today the
// Reminders page, Import from Gmail, and voice chats after each person's
// first 10 (041–043). For a free family, tapping one opens
// /plus, which shows Free and Plus side by side, and the screens themselves
// send a free family there too (after a refresh, or from a link). Storage
// beyond the free 1 GB is kept by the server (038), and Gmail import refuses
// a free family on the server as well. The reminders themselves — under the
// bell and on devices — reach every family.
//
// The plan comes from family_storage_status() (038, 039), kept for a minute
// per family. When it cannot be read (before 038, or offline) nothing is
// gated here: the app never locks a family out because it could not ask.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useFamily } from './family-context';
import { fetchStorageStatus } from './api';
import type { PlanName } from './plans';

/** What a starred feature is called in /plus?feature=… */
export type PlusFeature = 'reminders' | 'gmail' | 'storage' | 'voice';

interface KnownPlan {
  plan: PlanName | null;
  paidUntil: string | null;
  /** Plus has ended and the family is above the free limit: when the newest documents above it go (040). */
  removalAt: string | null;
  at: number;
}

const FRESH_MS = 60_000;
const known = new Map<string, KnownPlan>();

async function readPlan(familyId: string, force: boolean): Promise<KnownPlan> {
  const hit = known.get(familyId);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return hit;
  try {
    const status = await fetchStorageStatus(familyId);
    const fresh = {
      plan: status?.plan ?? null,
      paidUntil: status?.paidUntil ?? null,
      removalAt: status?.removalAt ?? null,
      at: Date.now(),
    };
    known.set(familyId, fresh);
    return fresh;
  } catch {
    return hit ?? { plan: null, paidUntil: null, removalAt: null, at: 0 };
  }
}

/** The page a free family sees instead of a starred feature. */
export function plusPage(feature?: PlusFeature): string {
  return feature ? `/plus?feature=${feature}` : '/plus';
}

/** The current family's plan; `isFree` only once it is known to be Free. */
export function useFamilyPlan() {
  const { currentFamily } = useFamily();
  const familyId = currentFamily?.id ?? null;
  const [plan, setPlan] = useState<KnownPlan | null>(() => (familyId ? known.get(familyId) ?? null : null));
  const [loading, setLoading] = useState(!plan && !!familyId);

  useEffect(() => {
    let cancelled = false;
    if (!familyId) {
      setPlan(null);
      setLoading(false);
      return;
    }
    const hit = known.get(familyId) ?? null;
    setPlan(hit);
    setLoading(!hit);
    readPlan(familyId, false).then((fresh) => {
      if (!cancelled) { setPlan(fresh); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [familyId]);

  /** Asks again (force) or uses what is fresh, and returns the answer. */
  const refresh = useCallback(async (force = true): Promise<KnownPlan | null> => {
    if (!familyId) return null;
    const fresh = await readPlan(familyId, force);
    setPlan(fresh);
    setLoading(false);
    return fresh;
  }, [familyId]);

  /**
   * Where a tap on a starred feature should go: the feature, or /plus for a
   * free family. Waits for the plan if it is not known yet.
   */
  const routeFor = useCallback(async (feature: PlusFeature, route: string): Promise<string> => {
    const now = await refresh(false);
    return now?.plan === 'free' ? plusPage(feature) : route;
  }, [refresh]);

  return {
    plan: plan?.plan ?? null,
    paidUntil: plan?.paidUntil ?? null,
    removalAt: plan?.removalAt ?? null,
    isFree: plan?.plan === 'free',
    loading,
    refresh,
    routeFor,
  };
}
