// ─── What a family may keep, and the words for a full vault (038) ─
//
// Shared by the app (src/lib/plans.ts) and Gmail import, so both say the same
// thing when a family's storage is full. Pure TypeScript: no Deno, no React.
//
// The limits themselves live in the database (public.plan_limits), and the
// server keeps them: the documents bucket refuses a new file once a family's
// files reach its plan's limit. The numbers here are only the words used when
// the database cannot be asked.
// ────────────────────────────────────────────────────────────────

export type PlanName = 'free' | 'plus';
export type PlanPeriod = 'none' | 'monthly' | 'yearly';

/** A family's plan and its room, as family_storage_status() reports them. */
export interface StorageRoom {
  plan: PlanName;
  period: PlanPeriod;
  limitBytes: number;
  usedBytes: number;
}

export interface PlanLimits {
  free: number;
  monthly: number;
  yearly: number;
}

const GB = 1024 ** 3;

/** What 038 sets; plan_limits is the truth. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = { free: 1 * GB, monthly: 5 * GB, yearly: 10 * GB };

/**
 * Whether Family Plus can be bought yet. Until payments are switched on it is
 * given by hand (set_family_plan()), and the words say "coming soon".
 */
export const PLUS_FOR_SALE = false;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) {
    const mb = bytes / 1024 ** 2;
    return `${mb < 100 ? +mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${+(bytes / GB).toFixed(2)} GB`;
}

export function planLabel(plan: PlanName, period: PlanPeriod): string {
  if (plan === 'free') return 'the free plan';
  return period === 'monthly' ? 'Family Plus, monthly' : 'Family Plus, yearly';
}

/** Whether a file of this size fits in what the family has left. */
export function fits(room: StorageRoom, fileBytes: number): boolean {
  return room.usedBytes + fileBytes <= room.limitBytes;
}

/** Why a file does not fit, and what the family can do about it. */
export function storageFullMessage(room: StorageRoom, fileBytes = 0, limits: PlanLimits = DEFAULT_PLAN_LIMITS): string {
  const left = Math.max(0, room.limitBytes - room.usedBytes);
  const on = `${formatBytes(room.limitBytes)} on ${planLabel(room.plan, room.period)}`;
  const head = left === 0 || fileBytes === 0
    ? `Your family's storage is full: ${formatBytes(room.usedBytes)} used of ${on}.`
    : `This file is ${formatBytes(fileBytes)}, and your family has ${formatBytes(left)} left of ${on}.`;

  const free = 'Delete documents you no longer need';
  let more: string;
  if (room.plan === 'free') {
    more = PLUS_FOR_SALE
      ? `${free}, or move to Family Plus: ${formatBytes(limits.monthly)} monthly or ${formatBytes(limits.yearly)} yearly.`
      : `${free} to make room. Family Plus, coming soon, gives ${formatBytes(limits.monthly)} monthly or ${formatBytes(limits.yearly)} yearly.`;
  } else if (room.period === 'monthly') {
    more = PLUS_FOR_SALE
      ? `${free}, or move to the yearly plan: ${formatBytes(limits.yearly)}.`
      : `${free} to make room.`;
  } else {
    more = `${free} to make room.`;
  }
  return `${head} ${more}`;
}
