// ─── What each plan may keep (migrations 038, 039, 048) ─────────
//
// Every plan has a storage limit; none is unlimited:
//
//   Free          a family 200 MB, a personal vault 100 MB, in total —
//                 not a monthly allowance
//   Family Plus   10 GB, either kind of vault — in India ₹100 a month or
//                 ₹1,100 a year, elsewhere $10 a month or $110 a year
//
// The yearly price is shown as a discount on twelve months at the monthly
// price, crossed out (<YearlyPrice />, src/components/plus-price.tsx).
//
// The numbers live in the database (public.plan_limits) and the server keeps
// them: the documents bucket refuses a new file once a family's files reach
// its plan's limit, and Gmail import checks before it stores. The app asks
// first, with the file's size, so it can say why (uploadDocument in api.ts).
// The words are shared with Gmail import: supabase/functions/_shared/plan-text.ts.
//
// Used space is what the family's folder in the bucket holds, as the server
// counts it (family_storage_status()). Before 038 the app adds up the
// documents' file sizes instead and shows the free limit, unenforced.
//
// The Supabase organisation behind the app is on Supabase's Free plan, which
// holds 1 GB of files for the whole organisation — every vault, and DEV's test
// files too: about five full families, or ten full personal vaults, at the free
// limits. Past that, and before anyone is given Family Plus's 10 GB, PROD needs
// Supabase Pro (100 GB included). CLAUDE.md, "The Supabase plan", has the rest.
// ────────────────────────────────────────────────────────────────

import {
  DEFAULT_PLAN_LIMITS, formatBytes, plusAmount, plusPrice, plusPrices, plusYearlyOffer, plusYearlySaving,
  type PriceCurrency, type PricePeriod,
} from '../../supabase/functions/_shared/plan-text';

export {
  parseAllowance, questionLimitMessage, questionsLeftText, resetDay, type QuestionAllowance,
} from '../../supabase/functions/_shared/questions';

export {
  MAX_FILE_BYTES, QUESTION_INPUT_MAX, fileTooLargeMessage, limitHint, type LimitHint,
} from '../../supabase/functions/_shared/limits';

export {
  DEFAULT_PLAN_LIMITS, PLUS_FOR_SALE, PLUS_PRICE, chatStorageFullMessage, fits, formatBytes, planLabel, plusAmount, plusPrice, plusPrices,
  plusTwelveMonths, plusYearlyOffer, plusYearlySaving, storageFullMessage,
  type PlanLimits, type PlanName, type PriceCurrency, type PricePeriod, type StorageRoom,
} from '../../supabase/functions/_shared/plan-text';

/** Free space for a family, in bytes, when the database cannot be asked. */
export const FREE_STORAGE_BYTES = DEFAULT_PLAN_LIMITS.free;

/** "200 MB", for sentences. */
export const FREE_STORAGE_LABEL = formatBytes(FREE_STORAGE_BYTES);

/** Free space for a personal vault (048), in bytes, when the database cannot be asked. */
export const FREE_PERSONAL_STORAGE_BYTES = DEFAULT_PLAN_LIMITS.freePersonal;

/** "100 MB", for sentences. */
export const FREE_PERSONAL_STORAGE_LABEL = formatBytes(FREE_PERSONAL_STORAGE_BYTES);

/** The device's time zone ("Asia/Kolkata"), or '' when it cannot say. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';   // An engine without Intl time zones.
  }
}

// The payments function's choice, once it has answered (payerCurrency() in
// _shared/razorpay.ts: rupees only when the connection is from India and the
// time zone agrees). Until then, and where payments are off, the time zone.
let payerCurrencyKnown: PriceCurrency | null = null;

/** Called with the payments function's answer. */
export function setPayerCurrency(currency: 'INR' | 'USD' | null) {
  payerCurrencyKnown = currency === 'INR' ? 'inr' : currency === 'USD' ? 'usd' : null;
}

/**
 * The currency this person sees prices in and pays in: rupees in India,
 * dollars elsewhere. The server decides once asked; before that, the
 * device's time zone guesses, and a device that cannot say sees rupees.
 */
export function localCurrency(): PriceCurrency {
  if (payerCurrencyKnown) return payerCurrencyKnown;
  const zone = deviceTimeZone();
  return zone && !/^Asia\/(Kolkata|Calcutta)$/.test(zone) ? 'usd' : 'inr';
}

/** "₹100 a month" (or "₹1,100 a year") where this device is. */
export function localPlusPrice(period: PricePeriod = 'monthly'): string {
  return plusPrice(localCurrency(), period);
}

/** "₹100 a month or ₹1,100 a year" where this device is. */
export function localPlusPrices(): string {
  return plusPrices(localCurrency());
}

/** "₹100", "₹1,100" where this device is. */
export function localPlusAmount(period: PricePeriod): string {
  return plusAmount(localCurrency(), period);
}

/** "1 month free" where this device is. */
export function localPlusYearlySaving(): string {
  return plusYearlySaving(localCurrency());
}

/** "₹1,100 a year instead of ₹1,200" where this device is: what a screen reader hears for <YearlyPrice />. */
export function localPlusYearlyOffer(): string {
  return plusYearlyOffer(localCurrency());
}

/** From this share of a family's limit on, it is told it is nearly full. */
export const NEARLY_FULL = 0.8;

export type StorageLevel = 'ok' | 'nearly' | 'full';

export function storageLevel(usedBytes: number, limitBytes: number): StorageLevel {
  if (usedBytes >= limitBytes) return 'full';
  if (usedBytes >= limitBytes * NEARLY_FULL) return 'nearly';
  return 'ok';
}
