// ─── Is the family on Family Plus? ──────────────────────────────
//
// Starred features (★, <PlusTag />) are for Family Plus families: today
// expiry reminders and the Reminders page (048), Import from Gmail, voice
// chats after each person's first 10 (041–043), questions after each
// person's 20 a month, members five to eight, and share links that last 30
// days (049). For a free family, tapping
// one opens /plus, which shows Free and Plus side by side, and the screens
// themselves send a free family there too (after a refresh, or from a link).
// Storage beyond the free 200 MB (100 MB for a personal vault) is kept by the
// server (038, 048), the server makes expiry reminders only for a vault on
// Plus, and Gmail import refuses a free family on the server as well.
// Birthday reminders reach every family.
//
// The plan comes from family_storage_status() (038, 039), kept for a minute
// per family. When it cannot be read (before 038, or offline) nothing is
// gated here: the app never locks a family out because it could not ask.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { useFamily } from './family-context';
import { fetchPaymentsStatus, fetchQuestionStatus, fetchStorageStatus, type PaymentsStatus } from './api';
import type { PlanName } from './plans';

/** What a starred feature is called in /plus?feature=… */
export type PlusFeature = 'reminders' | 'gmail' | 'storage' | 'voice' | 'questions' | 'members' | 'links';

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

/**
 * Whether Family Plus can be bought here (044): the payments function's
 * answer, asked once per session. Null until it answers.
 */
export function usePaymentsStatus(): PaymentsStatus | null {
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPaymentsStatus().then((s) => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, []);
  return status;
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

// ─── Am I on Family Plus? ───────────────────────────────────────
//
// A person is on Plus when any vault they are in is (049's person_on_plus()),
// and a ★ goes before their own name wherever the app shows it. Read from
// question_status(), which counts nothing, kept a minute and shared by every
// screen. Unknown (before 049, offline) shows no star. Only your own: whether
// another member is on Plus through some other family is not theirs to see.

let mine: { userId: string; plus: boolean; at: number } | null = null;
const listeners = new Set<() => void>();

let asking: Promise<boolean> | null = null;

async function readOnPlus(userId: string, force: boolean): Promise<boolean> {
  if (mine && mine.userId === userId && !force && Date.now() - mine.at < FRESH_MS) return mine.plus;
  // Every screen showing a name asks at once; one question answers them all.
  asking ??= (async () => {
    const status = await fetchQuestionStatus().catch(() => null);
    if (!status) return mine?.userId === userId ? mine.plus : false;
    mine = { userId, plus: status.plus, at: Date.now() };
    return status.plus;
  })().finally(() => { asking = null; });
  return asking;
}

/** Ask again everywhere: after a payment, or when the plan may have changed. */
export function forgetOnPlus() {
  mine = null;
  listeners.forEach((l) => l());
}

/** Is the signed-in person on Family Plus, in any vault? False until known. */
export function useOnPlus(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [plus, setPlus] = useState(() => !!userId && mine?.userId === userId && mine.plus);

  useEffect(() => {
    if (!userId) {
      setPlus(false);
      return;
    }
    let cancelled = false;
    const read = (force: boolean) => {
      readOnPlus(userId, force).then((p) => { if (!cancelled) setPlus(p); });
    };
    read(false);
    const onForget = () => read(true);
    listeners.add(onForget);
    return () => { cancelled = true; listeners.delete(onForget); };
  }, [userId]);

  return plus;
}
