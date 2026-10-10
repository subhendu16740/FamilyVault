// ─── What a family may keep, and the words for a full vault (038–041) ─
//
// Shared by the app (src/lib/plans.ts) and Gmail import, so both say the same
// thing when a family's storage is full. Pure TypeScript: no Deno, no React.
//
// Two plans, each with a limit (039, 048):
//
//   Free          a family 200 MB, a personal vault 100 MB, in total
//   Family Plus   10 GB, either kind of vault — in India ₹100 a month or
//                 ₹1,100 a year, elsewhere $10 a month or $110 a year
//
// A family has at most 4 members on Free and 8 on Family Plus (041, 049) —
// the people who sign in; anyone can be in the family tree. Each person on
// Free has 10 voice chats (041–043) and 20 questions a month (049); on Family
// Plus, voice without a limit and questions without a monthly limit (fair
// use: 500 a month each). A share link lasts 1 or 7 days on Free, and up to
// 30 days on Family Plus (049).
//
// A year costs eleven months: one month free. The yearly price is shown
// against twelve months at the monthly price, crossed out (₹1,200 → ₹1,100,
// $120 → $110), and so are the months it saves — both worked out here, never
// typed in: a crossed-out price must be one a family could really pay. How a
// family pays never changes what it may keep.
//
// When Family Plus ends (040), a vault above its free limit has 30 days to
// renew or delete documents; then the newest documents above it are removed.
//
// The limits live in the database (public.plan_limits), and the server keeps
// them: the documents bucket refuses a new file once a family's files reach
// its plan's limit. The numbers here are only the words used when the
// database cannot be asked. The price is shown, not charged: what is charged
// is the payment company's plan.
// ────────────────────────────────────────────────────────────────

export type PlanName = 'free' | 'plus';

/** A vault's plan and its room, as family_storage_status() reports them. */
export interface StorageRoom {
  plan: PlanName;
  limitBytes: number;
  usedBytes: number;
  /** A personal vault (046), which the words call "your personal vault"; a family otherwise. */
  personal?: boolean;
}

export interface PlanLimits {
  /** What a family may keep on Free. */
  free: number;
  /** What a personal vault may keep on Free (048). */
  freePersonal: number;
  /** What a vault may keep on Family Plus, either kind. */
  plus: number;
  /** Days a family keeps what is above the free limit after Plus ends (040). */
  graceDays: number;
  /** Members — people who sign in — a family may have, per plan (041). The family tree has no limit. */
  members: { free: number; plus: number };
  /** Voice chats each person gets, per plan; null: no limit (041; per person since 043). */
  voiceAnswers: { free: number | null; plus: number | null };
  /** Questions each person may ask a month, per plan; null: no monthly limit (049). */
  questions: { free: number | null; plus: number | null };
  /** The most one person may ask in a month where there is no monthly limit (049). */
  questionsFairUse: number;
  /** Questions each person may try in a day, answered or not, per plan; null: no limit (050). */
  questionTriesPerDay: { free: number | null; plus: number | null };
  /** Documents each person may add in a day, per plan; null: no limit (050). */
  uploadsPerDay: { free: number | null; plus: number | null };
  /** Families one person may create on Free, besides their personal vault (050); null: no limit. */
  familiesPerPerson: number | null;
}

const GB = 1024 ** 3;

const MB = 1024 ** 2;

/** What 039–050 set; plan_limits is the truth. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  free: 200 * MB,
  freePersonal: 100 * MB,
  plus: 10 * GB,
  graceDays: 30,
  members: { free: 4, plus: 8 },
  voiceAnswers: { free: 10, plus: null },
  questions: { free: 20, plus: null },
  questionsFairUse: 500,
  questionTriesPerDay: { free: 10, plus: 100 },
  uploadsPerDay: { free: 50, plus: 500 },
  familiesPerPerson: 1,
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
 * Whether Family Plus can be bought, until asked. Payments are switched on
 * per project, by setting its Razorpay keys (044): the app asks the payments
 * function, and the server reads its own secrets, and both pass the answer
 * as `forSale`. Where neither can tell, the words say "coming soon".
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
  /** Whether Family Plus can be bought here (044); PLUS_FOR_SALE when not said. */
  forSale?: boolean;
}

/** Why a file does not fit, and what the vault's people can do about it. */
export function storageFullMessage(room: StorageRoom, fileBytes = 0, options: StorageMessageOptions = {}): string {
  const { limits = DEFAULT_PLAN_LIMITS, price, removalOn, forSale = PLUS_FOR_SALE } = options;
  const left = Math.max(0, room.limitBytes - room.usedBytes);
  const head = left === 0 || fileBytes === 0
    ? `${room.personal ? 'Your personal vault' : "Your family's storage"} is full, with ${formatBytes(room.usedBytes)} of ${formatBytes(room.limitBytes)} used.`
    : `This file is ${formatBytes(fileBytes)}, but ${room.personal ? 'your personal vault' : 'your family'} has only ${formatBytes(left)} left.`;

  const free = "Delete documents you don't need";
  const plus = `${formatBytes(limits.plus)}${price ? ` for ${price}` : ''}`;
  let more: string;
  if (room.plan === 'free' && removalOn) {
    more = `Family Plus has ended. On ${removalOn}, the newest documents over ${formatBytes(room.limitBytes)} will be removed. Renew, or delete documents to get under ${formatBytes(room.limitBytes)}.`;
  } else if (room.plan === 'free') {
    more = forSale
      ? `${free}, or move to Family Plus and get ${plus}.`
      : `${free}. Family Plus is coming soon, with ${plus}.`;
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
  const { limits = DEFAULT_PLAN_LIMITS, price, forSale = PLUS_FOR_SALE } = options;
  const head = `There's no room to save this chat. ${room.personal ? 'Your personal vault' : 'Your family'} has used ${formatBytes(room.usedBytes)} of ${formatBytes(room.limitBytes)}.`;
  if (room.plan !== 'free') return `${head} Delete documents or saved chats you don't need to make room.`;
  const plus = `${formatBytes(limits.plus)}${price ? ` for ${price}` : ''}`;
  return forSale
    ? `${head} To save more, move to Family Plus and get ${plus}. Or delete documents you don't need.`
    : `${head} Family Plus is coming soon, with ${plus}. Until then, delete documents you don't need.`;
}
