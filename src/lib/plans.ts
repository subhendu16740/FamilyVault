// ─── What the free plan includes ────────────────────────────────
//
// Every family gets FREE_STORAGE_GB for its documents, free. Family Plus,
// the paid plan (★ in the app), will add more space; it does not exist yet,
// so the limit is shown, never enforced: a family past it can still upload.
// Enforcing it needs a check on the server, because a file lands in Storage
// before any app code could refuse it, and a way to pay.
//
// Counted the way Settings › Storage adds it up: the `file_size_bytes` of the
// family's documents, the files as they were added. The text, chunks and
// vectors kept in the database are not counted.
//
// The Supabase project behind the app is on Supabase's Free plan, which holds
// 1 GB of files in total, for every family together. Before this promise is
// made to more than one family, PROD needs Supabase Pro (100 GB included).
// ────────────────────────────────────────────────────────────────

/** Free space per family, in gigabytes. Change it here and nowhere else. */
export const FREE_STORAGE_GB = 1;

export const FREE_STORAGE_BYTES = FREE_STORAGE_GB * 1024 ** 3;

/** "1 GB", for sentences. */
export const FREE_STORAGE_LABEL = `${FREE_STORAGE_GB} GB`;

/** From this share of the free space on, a family is told it is nearly full. */
export const NEARLY_FULL = 0.8;

export type StorageLevel = 'ok' | 'nearly' | 'over';

export function storageLevel(bytes: number): StorageLevel {
  if (bytes > FREE_STORAGE_BYTES) return 'over';
  if (bytes >= FREE_STORAGE_BYTES * NEARLY_FULL) return 'nearly';
  return 'ok';
}
