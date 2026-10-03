// ─── What each plan may keep (migrations 038, 039) ──────────────
//
// Every plan has a storage limit; none is unlimited:
//
//   Free           1 GB, in total — not a monthly allowance
//   Family Plus   10 GB, ₹100 a month in India, $10 a month elsewhere
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
// The Supabase project behind the app is on Supabase's Free plan, which holds
// 1 GB of files in total, for every family together. Before these limits are
// promised to more than one family, PROD needs Supabase Pro (100 GB included).
// ────────────────────────────────────────────────────────────────

import { DEFAULT_PLAN_LIMITS, formatBytes, plusPrice } from '../../supabase/functions/_shared/plan-text';

export {
  DEFAULT_PLAN_LIMITS, PLUS_FOR_SALE, PLUS_PRICE, fits, formatBytes, planLabel, plusPrice, storageFullMessage,
  type PlanLimits, type PlanName, type StorageRoom,
} from '../../supabase/functions/_shared/plan-text';

/** Free space per family, in bytes, when the database cannot be asked. */
export const FREE_STORAGE_BYTES = DEFAULT_PLAN_LIMITS.free;

/** "1 GB", for sentences. */
export const FREE_STORAGE_LABEL = formatBytes(FREE_STORAGE_BYTES);

/**
 * Family Plus's price as this device should show it: rupees in India,
 * dollars elsewhere, judged by the device's time zone. Shown only — until
 * payments exist nothing is charged, and then the payment company decides.
 * A device that cannot say where it is sees rupees, as most families do.
 */
export function localPlusPrice(): string {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    // An engine without Intl time zones.
  }
  return plusPrice(zone && !/^Asia\/(Kolkata|Calcutta)$/.test(zone) ? 'usd' : 'inr');
}

/** From this share of a family's limit on, it is told it is nearly full. */
export const NEARLY_FULL = 0.8;

export type StorageLevel = 'ok' | 'nearly' | 'full';

export function storageLevel(usedBytes: number, limitBytes: number): StorageLevel {
  if (usedBytes >= limitBytes) return 'full';
  if (usedBytes >= limitBytes * NEARLY_FULL) return 'nearly';
  return 'ok';
}
