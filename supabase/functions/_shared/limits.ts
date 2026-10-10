// ─── Limits that keep one account from using up what everyone shares (050) ─
//
// Every service behind AskLocker is a free allowance shared by every family:
// 1 GB of files and 5 GB of downloads a month for the whole Supabase
// organisation, a 500 MB database, about 25 questions a day of Groq, 500
// scanned pages a day of OCR.space. Migration 050 keeps the limits in the
// database; this file holds the few the functions and the app check
// themselves, and the words for them. Pure TypeScript: no Deno, no React,
// so the QA self-test pins it in Node.
// ────────────────────────────────────────────────────────────────

/** The largest file a vault takes: the documents bucket's limit (050; 50 MB before). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** "This file is 14.2 MB. AskLocker takes files up to 10 MB…" */
export function fileTooLargeMessage(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const size = `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  return `This file is ${size}. The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB. `
    + 'Try a lower-quality scan, or split it into parts.';
}

/**
 * Is this file address inside this vault's own folder? Every document's file
 * is "<namespace>/<file>"; the server reads files with the service role, which
 * no Storage policy stops, so it reads only addresses that pass this. Before
 * 050 any address was taken, and someone who had once seen another family's
 * — a member who left, anyone sent a share link — could have it read into
 * their own vault.
 */
export function inVaultFolder(storagePath: unknown, namespace: unknown): boolean {
  if (typeof storagePath !== 'string' || typeof namespace !== 'string') return false;
  if (!/^family_[0-9a-f]{8}$/.test(namespace)) return false;
  if (storagePath.length > 1024 || !storagePath.startsWith(`${namespace}/`)) return false;
  const rest = storagePath.slice(namespace.length + 1);
  if (!rest || rest.includes('\\')) return false;
  return rest.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** The most text the server keeps for one document, however it was read. */
export const MAX_DOCUMENT_TEXT = 500_000;

/**
 * The most text the app may hand the server for a file of this size. The app
 * reads photos itself and sends the text; a page of print is a few thousand
 * characters, never more than the file has bytes. Without a cap, a tiny file
 * could carry any amount of "text" into the shared database.
 */
export function providedTextLimit(fileBytes: number | null | undefined): number {
  const bytes = typeof fileBytes === 'number' && Number.isFinite(fileBytes) && fileBytes > 0 ? fileBytes : 0;
  return Math.min(MAX_DOCUMENT_TEXT, 20_000 + bytes);
}

/** The longest question the server reads; Ask's box takes QUESTION_INPUT_MAX. */
export const MAX_QUESTION_CHARS = 1000;
export const QUESTION_INPUT_MAX = 500;

/**
 * The HINTs 050's refusals carry. Their message is written for the person,
 * so the app shows it as it comes rather than wrapping it in "failed: …".
 */
export const LIMIT_HINTS = [
  'family_limit', 'upload_limit', 'no_file', 'bad_path', 'chat_limit',
  'feedback_limit', 'tree_full', 'share_limit', 'invite_limit',
] as const;
export type LimitHint = typeof LIMIT_HINTS[number];

export function limitHint(err: unknown): LimitHint | null {
  const hint = (err as { hint?: unknown } | null)?.hint;
  return typeof hint === 'string' && (LIMIT_HINTS as readonly string[]).includes(hint) ? hint as LimitHint : null;
}
