// ─── What a family may keep, and the words for a full vault (038, 039) ─
//
// Shared by the app (src/lib/plans.ts) and Gmail import, so both say the same
// thing when a family's storage is full. Pure TypeScript: no Deno, no React.
//
// Two plans, each with a limit (039):
//
//   Free           1 GB, in total
//   Family Plus   10 GB, ₹100 a month in India, $10 a month elsewhere
//
// The limits live in the database (public.plan_limits), and the server keeps
// them: the documents bucket refuses a new file once a family's files reach
// its plan's limit. The numbers here are only the words used when the
// database cannot be asked. The price is shown, not charged: what is charged
// is the payment company's plan.
// ────────────────────────────────────────────────────────────────

export type PlanName = 'free' | 'plus';

/** A family's plan and its room, as family_storage_status() reports them. */
export interface StorageRoom {
  plan: PlanName;
  limitBytes: number;
  usedBytes: number;
}

export interface PlanLimits {
  free: number;
  plus: number;
}

const GB = 1024 ** 3;

/** What 039 sets; plan_limits is the truth. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = { free: 1 * GB, plus: 10 * GB };

/** What Family Plus costs a month. */
export const PLUS_PRICE = { inr: 100, usd: 10 } as const;

export type PriceCurrency = keyof typeof PLUS_PRICE;

/**
 * Whether Family Plus can be bought yet. Until payments are switched on it is
 * given by hand (set_family_plan()), and the words say "coming soon".
 */
export const PLUS_FOR_SALE = false;

/** "₹100 a month", "$10 a month". */
export function plusPrice(currency: PriceCurrency): string {
  return currency === 'inr' ? `₹${PLUS_PRICE.inr} a month` : `$${PLUS_PRICE.usd} a month`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) {
    const mb = bytes / 1024 ** 2;
    return `${mb < 100 ? +mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${+(bytes / GB).toFixed(2)} GB`;
}

export function planLabel(plan: PlanName): string {
  return plan === 'free' ? 'the free plan' : 'Family Plus';
}

/** Whether a file of this size fits in what the family has left. */
export function fits(room: StorageRoom, fileBytes: number): boolean {
  return room.usedBytes + fileBytes <= room.limitBytes;
}

/**
 * Why a file does not fit, and what the family can do about it. `price` is
 * Family Plus's price where the person is ("₹100 a month"); the server, which
 * cannot tell, leaves it out.
 */
export function storageFullMessage(
  room: StorageRoom,
  fileBytes = 0,
  limits: PlanLimits = DEFAULT_PLAN_LIMITS,
  price?: string,
): string {
  const left = Math.max(0, room.limitBytes - room.usedBytes);
  const on = `${formatBytes(room.limitBytes)} on ${planLabel(room.plan)}`;
  const head = left === 0 || fileBytes === 0
    ? `Your family's storage is full: ${formatBytes(room.usedBytes)} used of ${on}.`
    : `This file is ${formatBytes(fileBytes)}, and your family has ${formatBytes(left)} left of ${on}.`;

  const free = 'Delete documents you no longer need';
  const plus = `${formatBytes(limits.plus)}${price ? ` for ${price}` : ''}`;
  let more: string;
  if (room.plan === 'free') {
    more = PLUS_FOR_SALE
      ? `${free}, or move to Family Plus: ${plus}.`
      : `${free} to make room. Family Plus, coming soon, gives ${plus}.`;
  } else {
    more = `${free} to make room.`;
  }
  return `${head} ${more}`;
}
