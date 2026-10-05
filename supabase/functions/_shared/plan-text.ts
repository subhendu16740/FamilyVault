// ─── What a family may keep, and the words for a full vault (038–041) ─
//
// Shared by the app (src/lib/plans.ts) and Gmail import, so both say the same
// thing when a family's storage is full. Pure TypeScript: no Deno, no React.
//
// Two plans, each with a limit (039):
//
//   Free           1 GB, in total
//   Family Plus   10 GB — in India ₹100 a month or ₹1,100 a year,
//                 elsewhere $10 a month or $110 a year
//
// On both, a family has at most 4 members — the people who sign in; anyone
// can be in the family tree — and a free family hears its first 10 answers
// read aloud, Family Plus every answer (041).
//
// A year costs eleven months: one month free. The yearly price is shown
// against twelve months at the monthly price, crossed out (₹1,200 → ₹1,100,
// $120 → $110), and so are the months it saves — both worked out here, never
// typed in: a crossed-out price must be one a family could really pay. How a
// family pays never changes what it may keep.
//
// When Family Plus ends (040), a family above the free limit has 30 days to
// renew or delete documents; then the newest documents above it are removed.
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
  /** Days a family keeps what is above the free limit after Plus ends (040). */
  graceDays: number;
  /** Members — people who sign in — a family may have, per plan (041). The family tree has no limit. */
  members: { free: number; plus: number };
  /** Answers read aloud a family gets, per plan; null: every answer (041). */
  voiceAnswers: { free: number | null; plus: number | null };
}

const GB = 1024 ** 3;

/** What 039–041 set; plan_limits is the truth. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  free: 1 * GB,
  plus: 10 * GB,
  graceDays: 30,
  members: { free: 4, plus: 4 },
  voiceAnswers: { free: 10, plus: null },
};

/** What Family Plus costs, by the month or by the year (one month free). */
export const PLUS_PRICE = {
  monthly: { inr: 100, usd: 10 },
  yearly: { inr: 1100, usd: 110 },
} as const;

export type PricePeriod = keyof typeof PLUS_PRICE;
export type PriceCurrency = keyof (typeof PLUS_PRICE)['monthly'];

/** 1000 → "1,000"; in rupees, lakhs group in twos: 100000 → "1,00,000". */
function grouped(amount: number, indian: boolean): string {
  const digits = String(Math.round(amount));
  if (digits.length <= 3) return digits;
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  const size = indian ? 2 : 3;
  while (rest.length > size) {
    groups.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  groups.unshift(rest);
  return `${groups.join(',')},${digits.slice(-3)}`;
}

function formatMoney(currency: PriceCurrency, amount: number): string {
  return currency === 'inr' ? `₹${grouped(amount, true)}` : `$${grouped(amount, false)}`;
}

function money(currency: PriceCurrency, period: PricePeriod): string {
  return formatMoney(currency, PLUS_PRICE[period][currency]);
}

/**
 * Whether Family Plus can be bought yet. Until payments are switched on it is
 * given by hand (set_family_plan()), and the words say "coming soon".
 */
export const PLUS_FOR_SALE = false;

/** "₹100 a month", "₹1,100 a year", "$10 a month", "$110 a year". */
export function plusPrice(currency: PriceCurrency, period: PricePeriod = 'monthly'): string {
  return `${money(currency, period)} a ${period === 'monthly' ? 'month' : 'year'}`;
}

/** "₹100 a month or ₹1,100 a year". */
export function plusPrices(currency: PriceCurrency): string {
  return `${plusPrice(currency, 'monthly')} or ${plusPrice(currency, 'yearly')}`;
}

/** The amount alone, "₹100" or "₹1,100", for a narrow column. */
export function plusAmount(currency: PriceCurrency, period: PricePeriod): string {
  return money(currency, period);
}

/**
 * Twelve months at the monthly price: "₹1,200", "$120". The yearly price is
 * shown against it, crossed out.
 */
export function plusTwelveMonths(currency: PriceCurrency): string {
  return formatMoney(currency, 12 * PLUS_PRICE.monthly[currency]);
}

/** "₹1,100 a year instead of ₹1,200", where a crossed-out price cannot be drawn or seen. */
export function plusYearlyOffer(currency: PriceCurrency): string {
  return `${plusPrice(currency, 'yearly')} instead of ${plusTwelveMonths(currency)}`;
}

/** What paying by the year saves, in months: "1 month free". */
export function plusYearlySaving(currency: PriceCurrency): string {
  const months = 12 - PLUS_PRICE.yearly[currency] / PLUS_PRICE.monthly[currency];
  return `${months} ${months === 1 ? 'month' : 'months'} free`;
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

export interface StorageMessageOptions {
  limits?: PlanLimits;
  /** Family Plus's price where the person is ("₹100 a month or ₹1,100 a year"); the server, which cannot tell, leaves it out. */
  price?: string;
  /** For a family whose Plus has ended: the day its documents above the free limit go ("4 Nov 2026"). */
  removalOn?: string;
}

/** Why a file does not fit, and what the family can do about it. */
export function storageFullMessage(room: StorageRoom, fileBytes = 0, options: StorageMessageOptions = {}): string {
  const { limits = DEFAULT_PLAN_LIMITS, price, removalOn } = options;
  const left = Math.max(0, room.limitBytes - room.usedBytes);
  const on = `${formatBytes(room.limitBytes)} on ${planLabel(room.plan)}`;
  const head = left === 0 || fileBytes === 0
    ? `Your family's storage is full: ${formatBytes(room.usedBytes)} used of ${on}.`
    : `This file is ${formatBytes(fileBytes)}, and your family has ${formatBytes(left)} left of ${on}.`;

  const free = 'Delete documents you no longer need';
  const plus = `${formatBytes(limits.plus)}${price ? ` for ${price}` : ''}`;
  let more: string;
  if (room.plan === 'free' && removalOn) {
    more = `Family Plus has ended: on ${removalOn}, the newest documents above ${formatBytes(room.limitBytes)} will be removed, unless it is renewed or you delete documents to get under ${formatBytes(room.limitBytes)}.`;
  } else if (room.plan === 'free') {
    more = PLUS_FOR_SALE
      ? `${free}, or move to Family Plus: ${plus}.`
      : `${free} to make room. Family Plus, coming soon, gives ${plus}.`;
  } else {
    more = `${free} to make room.`;
  }
  return `${head} ${more}`;
}

/**
 * Why a chat cannot be saved (042: saved chats take the family's storage
 * too), and what to do: Family Plus on the free plan, making room on Plus.
 */
export function chatStorageFullMessage(room: StorageRoom, options: Omit<StorageMessageOptions, 'removalOn'> = {}): string {
  const { limits = DEFAULT_PLAN_LIMITS, price } = options;
  const head = `There is no room to save this chat: your family has used ${formatBytes(room.usedBytes)} of its ${formatBytes(room.limitBytes)}.`;
  if (room.plan !== 'free') return `${head} Delete documents or saved chats you no longer need to make room.`;
  const plus = `${formatBytes(limits.plus)}${price ? ` for ${price}` : ''}`;
  return PLUS_FOR_SALE
    ? `${head} Saving more needs Family Plus: ${plus}. Or delete documents you no longer need.`
    : `${head} Saving more needs Family Plus, coming soon: ${plus}. Until then, delete documents you no longer need.`;
}
