import { supabase } from './supabase';
import { parseDocumentDate } from './dates';
import { isSaveable, mimeTypeFor, unsupportedFileMessage } from './file-types';
import type {
  FamilyWithMembership,
  FamilyMemberWithUser,
  FamilyDocumentRow,
  FamilyDocumentDetailRow,
  FamilySearchResultRow,
  Database,
} from './database.types';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];

// ─── Family Discovery ────────────────────────────────────────────

export async function fetchUserFamilies(userId: string): Promise<FamilyWithMembership[]> {
  // Step 1: get memberships
  // Oldest membership first, so the default family never changes by itself:
  // being added to another family must not swap the vault someone sees (and
  // uploads into) for one chosen by whoever added them.
  const { data: memberships, error: memErr } = await supabase
    .from('family_members')
    .select('id, family_id, user_id, role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true });

  if (memErr) throw memErr;
  if (!memberships || memberships.length === 0) return [];

  // Step 2: get family details for those memberships
  const familyIds = memberships.map((m) => m.family_id);
  const { data: familyRows, error: famErr } = await supabase
    .from('families')
    .select('*')
    .in('id', familyIds);

  if (famErr) throw famErr;

  const familyMap = new Map((familyRows ?? []).map((f) => [f.id, f]));

  return memberships
    .filter((m) => familyMap.has(m.family_id))
    .map((m) => ({
      ...m,
      families: familyMap.get(m.family_id)!,
    })) as unknown as FamilyWithMembership[];
}

export async function createNewFamily(
  userId: string,
  name: string,
  description?: string,
  icon?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_family', {
    p_user_id: userId,
    p_family_name: name,
    p_description: description ?? undefined,
    p_family_icon: icon ?? undefined,
  });

  if (error) throw error;
  return data as string;
}

// ─── Family Members ──────────────────────────────────────────────

export async function fetchFamilyMembers(familyId: string): Promise<FamilyMemberWithUser[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('id, family_id, user_id, role, alias, relationship, can_upload, can_delete, joined_at, users(display_name, email, avatar_url)')
    .eq('family_id', familyId);

  if (error) throw error;
  return (data ?? []) as unknown as FamilyMemberWithUser[];
}

// ─── Documents (via RPCs) ────────────────────────────────────────

export async function fetchRecentDocuments(
  familyId: string,
  limit = 10,
  offset = 0,
): Promise<FamilyDocumentRow[]> {
  const { data, error } = await supabase.rpc('get_family_documents', {
    p_family_id: familyId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return (data ?? []) as FamilyDocumentRow[];
}

export async function fetchDocumentById(
  familyId: string,
  documentId: string,
): Promise<FamilyDocumentDetailRow | null> {
  const { data, error } = await supabase.rpc('get_document_detail', {
    p_family_id: familyId,
    p_document_id: documentId,
  });

  if (error) throw error;
  const rows = data as FamilyDocumentDetailRow[] | null;
  return rows?.[0] ?? null;
}

// ─── Stats ───────────────────────────────────────────────────────

export async function fetchFamilyStats(
  familyId: string,
): Promise<{ doc_count: number; member_count: number; category_count: number }> {
  const { data, error } = await supabase.rpc('get_family_stats', {
    p_family_id: familyId,
  });

  if (error) throw error;
  const rows = data as { doc_count: number; member_count: number; category_count: number }[] | null;
  return rows?.[0] ?? { doc_count: 0, member_count: 0, category_count: 0 };
}

// ─── Search ──────────────────────────────────────────────────────

/**
 * Resolve family member aliases in a query.
 * E.g. "Dad's passport" → if "Dad" is an alias for "Ramesh Kumar",
 * returns the expanded query with the member's real name for better search.
 */
function resolveAliases(
  query: string,
  members: { alias: string | null; relationship: string | null; users: { display_name: string } }[],
): string {
  if (!members.length) return query;

  const lowerQuery = query.toLowerCase();
  let expanded = query;

  for (const m of members) {
    const aliases = [
      m.alias,
      m.relationship,
      m.users.display_name,
    ].filter(Boolean) as string[];

    for (const alias of aliases) {
      // Check if query contains this alias (case-insensitive, word boundary)
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s?)?\\b`, 'i');
      if (re.test(lowerQuery)) {
        // Append the real name to boost relevance
        const realName = m.users.display_name;
        if (!lowerQuery.includes(realName.toLowerCase())) {
          expanded = `${expanded} ${realName}`;
        }
        break; // Only match one alias per member
      }
    }
  }

  return expanded;
}

// ─── RAG Search (AI-powered answers) ─────────────────────────────

export interface RagSearchResult {
  answer: string;
  sources: { id: string; file_name: string; file_type: string; category_name: string | null }[];
  /** BCP-47 tag the answer was written in — the client picks the matching voice. */
  answer_language?: string;
  /** true when `answer` did not come from the model (rate limit, outage). */
  degraded?: boolean;
  retry_after_seconds?: number;
  /** What the server actually did — shown under follow-up answers. */
  debug?: {
    searched_for: string;
    history_turns: number;
    client_sent_sources: boolean;
    pinned_docs: string[];
    retrieved_docs: string[];
    candidate_count: number;
    /** Passages that survived reranking — same unit as candidate_count. */
    kept_count?: number;
    kept_docs: string[];
    /** Groq models that actually ran each step. Missing = the step didn't run. */
    models?: { answer?: string; condense?: string; rerank?: string };
    /** false means the retriever was given the raw follow-up, not a rewrite. */
    condensed: boolean;
    condense_error?: string;
    pin_error?: string;
    rerank_error?: string;
    /** English form of a non-English question, used for retrieval. */
    translated?: string;
    translate_error?: string;
    /** The family's chunk vectors are still being rebuilt: keyword-only for now. */
    index_rebuilding?: boolean;
    /** False means the question was searched by keywords alone. */
    embedded?: boolean;
    /** Why embedding failed, when it did. */
    embed_error?: string;
  };
}

/** One prior turn of the conversation, as the server expects it. */
export interface RagHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Documents cited in an assistant turn — the server pins them into context for follow-ups. */
  sources?: RagSearchResult['sources'];
  /** Kept for older servers; superseded by `sources`. */
  source_ids?: string[];
}

/** Progress of the one-time rebuild of a family's search index. */
export interface IndexStatus {
  /** No work left: every chunk is embedded with the current model. */
  up_to_date: boolean;
  /** This call finished the rebuild (or there was nothing to do). */
  done: boolean;
  /** Chunks embedded by this call. */
  processed: number;
  done_count: number;
  total_count: number;
  model: string;
  /** Whether the signed-in member is allowed to start a rebuild. */
  can_rebuild?: boolean;
  /** True while documents are still being re-split, before embedding starts. */
  rechunking?: boolean;
  /** True while PDFs are being read again with a new extractor. */
  reextracting?: boolean;
  /** Documents with no searchable text at all — an ingestion that never finished. */
  unindexed?: string[];
  error?: string;
}

/**
 * Read, or advance, the family's search index rebuild.
 *
 * Needed once after the move to a multilingual embedding model, so that
 * Indian-language documents can be found by meaning and not only by exact
 * words. Each call with `statusOnly: false` embeds as many chunks as it can
 * within its time budget and returns progress; call it again while `done` is
 * false. It is safe to stop and resume — the cursor lives in the database.
 */
export async function indexStatus(
  familyId: string,
  statusOnly = true,
): Promise<IndexStatus> {
  const { data, error } = await supabase.functions.invoke('reembed-index', {
    body: { family_id: familyId, status_only: statusOnly },
  });
  if (error) {
    // supabase-js reports any non-2xx as the same opaque sentence and puts the
    // response in `context`. The function answers with a real reason and
    // progress so far, so read it — "Edge Function returned a non-2xx status
    // code" tells a person nothing and sends us to the server logs.
    const body = await readFunctionError(error);
    if (body && typeof body === 'object' && 'error' in body) return body as IndexStatus;
    throw new Error((body as { error?: string })?.error ?? error.message);
  }
  return data as IndexStatus;
}

/** The JSON body behind a Supabase Functions error, when there is one. */
async function readFunctionError(error: unknown): Promise<unknown> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.text !== 'function') return null;
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

export interface RagSearchOptions {
  /** BCP-47 tag of the question and the wanted answer, e.g. 'hi-IN'. Omit for English. */
  language?: string;
  /** The answer will be read aloud: ask for short plain sentences, no markdown. */
  voice?: boolean;
}

export async function ragSearch(
  familyId: string,
  query: string,
  history: RagHistoryTurn[] = [],
  options: RagSearchOptions = {},
): Promise<RagSearchResult> {
  const { data, error } = await supabase.functions.invoke('rag-search', {
    body: {
      family_id: familyId,
      query,
      history,
      ...(options.language ? { language: options.language } : {}),
      ...(options.voice ? { voice: true } : {}),
    },
  });

  if (error) throw error;
  return data as RagSearchResult;
}

export async function searchDocuments(
  familyId: string,
  query: string,
  limit = 20,
  members: { alias: string | null; relationship: string | null; users: { display_name: string } }[] = [],
): Promise<FamilySearchResultRow[]> {
  // Resolve aliases: "Dad's passport" → "Dad's passport Ramesh Kumar"
  const expandedQuery = resolveAliases(query, members);

  // Try hybrid search first (vector + full-text)
  try {
    const { data, error } = await supabase.rpc('hybrid_search_documents', {
      p_family_id: familyId,
      p_query: expandedQuery,
      p_query_embedding: undefined,  // Text-only until client-side embedding is added
      p_limit: limit,
    });

    if (!error && data) {
      // hybrid_search_documents returns rank/similarity/storage_path but NOT
      // category_id or belongs_to_member, so the two shapes genuinely differ.
      // The cast was invisible while every .rpc() typed as `never`; the
      // regenerated types make it visible. Nothing calls searchDocuments(),
      // so this is dead code kept for now rather than silently corrected.
      return (data ?? []) as unknown as FamilySearchResultRow[];
    }
  } catch {
    // Hybrid search RPC not yet deployed — fall through
  }

  // Fallback to original search RPC
  const { data, error } = await supabase.rpc('search_family_documents', {
    p_family_id: familyId,
    p_query: expandedQuery,
    p_limit: limit,
  });

  if (error) throw error;
  return (data ?? []) as FamilySearchResultRow[];
}

// ─── Categories ──────────────────────────────────────────────────

export async function fetchCategories(): Promise<DocumentCategory[]> {
  const { data, error } = await supabase
    .from('document_categories')
    .select('*')
    .order('is_system', { ascending: false })
    .order('name');

  if (error) throw error;
  return data ?? [];
}

// ─── Adding members (admin only) ─────────────────────────────────
//
// There are no invitations and no requests to join (migration 025): a family
// admin adds a person who already has an account, by the email they sign in
// with, and they are a member at once — and are told so by a notification.
// It goes through the add-member Edge Function because only the server may
// look an account up by email.

export type AddMemberOutcome =
  | { status: 'added'; displayName: string }
  | { status: 'already_member'; displayName: string }
  | { status: 'no_account' }
  | { status: 'invalid_email' }
  /** The server is not ready for this yet (function or migration missing). */
  | { status: 'unavailable'; message: string };

export async function addFamilyMember(
  familyId: string,
  email: string,
  details: { alias?: string; relationship?: string } = {},
): Promise<AddMemberOutcome> {
  const { data, error } = await supabase.functions.invoke('add-member', {
    body: {
      family_id: familyId,
      email: email.trim(),
      ...(details.alias?.trim() ? { alias: details.alias.trim() } : {}),
      ...(details.relationship ? { relationship: details.relationship } : {}),
    },
  });
  if (!error) return { status: 'added', displayName: data?.display_name || email };

  const httpStatus = (error as { context?: Response })?.context?.status;
  const body = (await readFunctionError(error)) as { status?: string; error?: string; display_name?: string } | null;
  switch (body?.status) {
    case 'already_member':
      return { status: 'already_member', displayName: body.display_name || email };
    case 'no_account':
      return { status: 'no_account' };
    case 'invalid_email':
      return { status: 'invalid_email' };
    case 'needs_migration':
      return { status: 'unavailable', message: body.error ?? 'Adding members is not available yet.' };
  }
  // The gateway's own 404: this project does not have the function yet.
  if (httpStatus === 404) {
    return { status: 'unavailable', message: 'Adding members is not available on this server yet.' };
  }
  throw new Error(body?.error ?? error.message);
}

// ─── Gmail import ────────────────────────────────────────────────
//
// A person connects their OWN Gmail account; the server lists attachments
// that look like documents and imports the ones they tick, through the
// normal ingestion. Everything goes through Edge Functions — gmail-connect,
// gmail-scan, gmail-import — because the tables behind it are service-role
// only (migration 026): nobody's mailbox findings are reachable from a
// client, not even their own, except through a function that checks.

export interface GmailStatus {
  /** False until the server has its Google client and key secrets. */
  configured: boolean;
  missing?: string[];
  connected: boolean;
  email: string | null;
  /** Google stopped honouring the token (revoked, or 7 days in testing). */
  expired: boolean;
  scan: { started_at: string | null; finished_at: string | null; messages_scanned: number } | null;
  found: number;
  imported: number;
}

export interface GmailItem {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sender: string | null;
  subject: string | null;
  sent_at: string | null;
  suggestion: 'suggested' | 'maybe' | 'unlikely';
  reason: string | null;
  category_guess: string | null;
  status: 'found' | 'importing' | 'imported' | 'duplicate' | 'failed';
  error: string | null;
  document_id: string | null;
  family_id: string | null;
}

export interface GmailScanProgress {
  done: boolean;
  messages_scanned: number;
  found: number;
  added: number;
}

export type GmailImportResult =
  | { status: 'imported'; documentId: string; unreadable?: string }
  | { status: 'duplicate'; documentId: string }
  | { status: 'failed'; error: string };

/**
 * A Gmail function said no, with a reason the screen can act on:
 * `unavailable` / `needs_migration` / `not_configured` (the server is not
 * set up), `origin_not_allowed` (this web address is not on the allowlist),
 * `expired` (connect again), `rate_limited` (wait `retryAfter` seconds),
 * `busy` (another tab is scanning).
 */
export class GmailApiError extends Error {
  status: string;
  retryAfter?: number;
  origin?: string | null;
  constructor(status: string, message: string, extra: { retryAfter?: number; origin?: string | null } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = extra.retryAfter;
    this.origin = extra.origin;
  }
}

async function gmailInvoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (!error) return data as T;
  const httpStatus = (error as { context?: Response })?.context?.status;
  const payload = (await readFunctionError(error)) as
    | { status?: string; error?: string; retry_after?: number; origin?: string | null }
    | null;
  // The gateway's own 404: the function is not deployed to this project.
  if (httpStatus === 404 && !payload?.status) {
    throw new GmailApiError('unavailable', 'Gmail import is not available on this server yet.');
  }
  throw new GmailApiError(payload?.status ?? 'error', payload?.error ?? error.message, {
    retryAfter: payload?.retry_after,
    origin: payload?.origin,
  });
}

export const gmailStatus = () => gmailInvoke<GmailStatus>('gmail-connect', { action: 'status' });

/** Google's consent page, for this browser to open. `returnOrigin` is where it comes back. */
export async function gmailStartConnect(returnOrigin: string): Promise<string> {
  const { url } = await gmailInvoke<{ url: string }>('gmail-connect', { action: 'start', return_origin: returnOrigin });
  return url;
}

/** Back from Google: trade the code for a lasting (encrypted) permission. */
export const gmailFinishConnect = (state: string, code: string) =>
  gmailInvoke<{ connected: boolean; email: string }>('gmail-connect', { action: 'finish', state, code });

export const gmailDisconnect = () => gmailInvoke<{ connected: boolean }>('gmail-connect', { action: 'disconnect' });

/** One batch of the mailbox scan; call again until `done`. */
export const gmailScanBatch = (restart = false) =>
  gmailInvoke<GmailScanProgress>('gmail-scan', { action: 'scan', restart });

export async function gmailListItems(): Promise<GmailItem[]> {
  const { items } = await gmailInvoke<{ items: GmailItem[] }>('gmail-scan', { action: 'list' });
  return items ?? [];
}

/** Import one found attachment into the family's vault. */
export async function gmailImportItem(
  itemId: string,
  familyId: string,
  options: { categoryId?: string; memberId?: string } = {},
): Promise<GmailImportResult> {
  try {
    const result = await gmailInvoke<{ status: string; document_id: string; unreadable?: string }>('gmail-import', {
      item_id: itemId,
      family_id: familyId,
      ...(options.categoryId ? { category_id: options.categoryId } : {}),
      ...(options.memberId ? { belongs_to_member: options.memberId } : {}),
    });
    return result.status === 'duplicate'
      ? { status: 'duplicate', documentId: result.document_id }
      : { status: 'imported', documentId: result.document_id, unreadable: result.unreadable };
  } catch (err) {
    // This file could not be imported; the next one still can.
    if (err instanceof GmailApiError && (err.status === 'failed' || err.status === 'not_available')) {
      return { status: 'failed', error: err.message };
    }
    throw err;
  }
}

// ─── Member Management (admin only) ─────────────────────────────

export async function removeFamilyMember(memberId: string): Promise<void> {
  const { error } = await supabase
    .from('family_members')
    .delete()
    .eq('id', memberId);

  if (error) throw error;
}

export async function updateMemberRole(memberId: string, role: string): Promise<void> {
  const { error } = await supabase
    .from('family_members')
    .update({ role })
    .eq('id', memberId);

  if (error) throw error;
}

/**
 * Leave a family. Anyone may leave any family they are in — being added needs
 * no consent, so leaving must need no permission (family_members_delete_self).
 */
export async function leaveFamily(familyId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('family_members')
    .delete()
    .eq('family_id', familyId)
    .eq('user_id', userId)
    .select('id');

  if (error) throw error;
  if (!data?.length) throw new Error('You are not a member of this family.');
}

// ─── Document Upload ────────────────────────────────────────────

export interface UploadDocumentParams {
  familyId: string;
  storageNamespace: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  fileSizeBytes: number;
  categoryId?: string;
  belongsToMemberId?: string;
  ocrText?: string; // Pre-extracted OCR text from client-side processing
}

export async function uploadDocument(params: UploadDocumentParams): Promise<string> {
  const {
    familyId, storageNamespace, userId, fileName,
    fileType, fileBlob, fileSizeBytes, categoryId, belongsToMemberId, ocrText,
  } = params;

  // Refused before anything is stored. The bucket takes only these types, and
  // a type the database cannot hold used to fail AFTER the file was uploaded.
  if (!isSaveable(fileType)) throw new Error(unsupportedFileMessage(fileType));

  // 1. Upload to Supabase Storage
  const storagePath = `${storageNamespace}/${Date.now()}_${fileName}`;
  const mimeType = mimeTypeFor(fileType);

  const { error: storageErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBlob, { contentType: mimeType, upsert: false });

  if (storageErr) throw new Error(`Storage upload failed: ${storageErr.message}`);

  // 2. Insert document record via RPC (into family schema)
  const { data, error: insertErr } = await supabase.rpc('insert_family_document', {
    p_family_id: familyId,
    p_uploaded_by: userId,
    p_file_name: fileName,
    p_file_type: fileType,
    p_file_size_bytes: fileSizeBytes,
    p_storage_path: storagePath,
    p_category_id: categoryId ?? undefined,
    p_belongs_to_member: belongsToMemberId ?? undefined,
  });

  if (insertErr) {
    // The file is in Storage already. With no document pointing at it, nobody
    // would ever see it, count it or delete it, so take it back out.
    await supabase.storage.from('documents').remove([storagePath]).catch(() => undefined);
    throw new Error(`Document insert failed: ${insertErr.message}`);
  }

  const docId = data as string;

  // 3. Trigger ingestion (async — Edge Function)
  try {
    await supabase.functions.invoke('ingest-document', {
      body: {
        family_id: familyId,
        document_id: docId,
        storage_path: storagePath,
        ...(ocrText ? { ocr_text: ocrText } : {}),
      },
    });
  } catch {
    // Ingestion runs async — failure here is non-blocking
    console.warn('Ingestion trigger failed — document saved, will process later.');
  }

  return docId;
}

// ─── Document Actions ──────────────────────────────────────────

export async function deleteDocument(
  familyId: string,
  documentId: string,
  userId: string,
  storagePath: string,
): Promise<void> {
  // 1. Delete DB record via RPC (validates permissions)
  const { error } = await supabase.rpc('delete_family_document', {
    p_family_id: familyId,
    p_document_id: documentId,
    p_user_id: userId,
  });
  if (error) throw new Error(`Delete failed: ${error.message}`);

  // 2. Remove file from storage (best-effort)
  await supabase.storage.from('documents').remove([storagePath]);
}

export async function updateDocument(
  familyId: string,
  documentId: string,
  userId: string,
  updates: { fileName?: string; categoryId?: string; belongsToMember?: string },
): Promise<void> {
  const { error } = await supabase.rpc('update_family_document', {
    p_family_id: familyId,
    p_document_id: documentId,
    p_user_id: userId,
    p_file_name: updates.fileName ?? undefined,
    p_category_id: updates.categoryId ?? undefined,
    p_belongs_to_member: updates.belongsToMember ?? undefined,
  });
  if (error) throw new Error(`Update failed: ${error.message}`);
}

// ─── Document Signed URLs ──────────────────────────────────────

export async function getDocumentSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

// ─── Notifications ───────────────────────────────────────────────

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
  return count ?? 0;
}

export interface NotificationRow {
  id: string;
  family_id: string;
  type: string;
  title: string;
  message: string;
  document_ref: string | null;
  is_read: boolean;
  created_at: string;
}

export async function fetchNotifications(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase.rpc('get_user_notifications', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', {
    p_notification_id: notificationId,
    p_user_id: userId,
  });

  if (error) throw error;
}

export async function checkExpiryNotifications(familyId: string): Promise<number> {
  const { data, error } = await supabase.rpc('check_expiry_notifications', {
    p_family_id: familyId,
  });

  if (error) throw error;
  return (data ?? 0) as number;
}

// ─── Settings: profile, security, storage, reminders, feedback ───

export interface Profile {
  displayName: string;
  phone: string;
}

/**
 * Your name and phone. public.users is what the family sees (member lists,
 * "uploaded by"), and clients may write those two columns since 027; the
 * sign-in account's metadata keeps a copy, which is what this app reads for
 * your own name — so the change shows everywhere for you even where 027 is
 * not applied yet.
 */
export async function fetchProfile(userId: string, fallback: Partial<Profile> = {}): Promise<Profile> {
  const { data } = await supabase
    .from('users')
    .select('display_name, phone')
    .eq('id', userId)
    .maybeSingle();
  return {
    displayName: data?.display_name || fallback.displayName || '',
    phone: data?.phone || fallback.phone || '',
  };
}

export async function updateProfile(userId: string, profile: Profile): Promise<{ familySees: boolean }> {
  const displayName = profile.displayName.trim();
  const phone = profile.phone.trim();
  const { error: authError } = await supabase.auth.updateUser({ data: { display_name: displayName, phone } });
  if (authError) throw authError;

  // Not in the generated types' writable set until they are regenerated after 027.
  const { error } = await (supabase.from('users') as any)
    .update({ display_name: displayName, phone: phone || null })
    .eq('id', userId);
  if (error) {
    console.warn('[profile] not saved where the family sees it (is 027 applied?):', error.message);
    return { familySees: false };
  }
  return { familySees: true };
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Ends every session this account has, on every device, this one included. */
export async function signOutEverywhere(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) throw error;
}

/** Every document in a family, a page at a time. */
async function fetchAllDocuments(familyId: string): Promise<FamilyDocumentRow[]> {
  const PAGE = 200;
  const all: FamilyDocumentRow[] = [];
  for (let offset = 0; offset < PAGE * 50; offset += PAGE) {
    const page = await fetchRecentDocuments(familyId, PAGE, offset);
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}

/** Run `fn` over `items`, at most `limit` at once, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface FamilyStorage {
  familyId: string;
  name: string;
  bytes: number;
  documents: number;
  /** The part of it this person added. */
  yourBytes: number;
  yourDocuments: number;
}

/**
 * How much each of your families stores, and how much of that you added:
 * the sizes of the files as uploaded. There is no storage limit yet, so this
 * reports use and nothing else.
 */
export async function fetchStorageUsage(
  families: { id: string; name: string }[],
  userId: string,
): Promise<FamilyStorage[]> {
  return Promise.all(families.map(async (family) => {
    const docs = await fetchAllDocuments(family.id);
    const size = (d: FamilyDocumentRow) => d.file_size_bytes ?? 0;
    const yours = docs.filter((d) => d.uploaded_by === userId);
    return {
      familyId: family.id,
      name: family.name,
      bytes: docs.reduce((sum, d) => sum + size(d), 0),
      documents: docs.length,
      yourBytes: yours.reduce((sum, d) => sum + size(d), 0),
      yourDocuments: yours.length,
    };
  }));
}

export interface ExpiringDocument {
  id: string;
  fileName: string;
  memberName: string | null;
  expiry: Date;
  /** Whole days from today; negative once it has run out. */
  daysLeft: number;
}

/**
 * Every document in the family with an expiry date on it, soonest first.
 * The date lives in each document's extracted details, which the list does
 * not carry, so this reads each document's details — fine for a family's
 * papers; a vault of thousands would want one query for it.
 */
export async function fetchExpiringDocuments(familyId: string): Promise<ExpiringDocument[]> {
  const docs = await fetchAllDocuments(familyId);
  const details = await mapLimit(docs, 6, (d) => fetchDocumentById(familyId, d.id).catch(() => null));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const found: ExpiringDocument[] = [];
  for (const doc of details) {
    if (!doc) continue;
    const expiry = (doc.metadata ?? [])
      .filter((m) => m.key === 'expiry_date')
      .map((m) => parseDocumentDate(m.value))
      .find((d): d is Date => d !== null);
    if (!expiry) continue;
    found.push({
      id: doc.id,
      fileName: doc.file_name,
      memberName: doc.member_name,
      expiry,
      daysLeft: Math.round((expiry.getTime() - today.getTime()) / 86_400_000),
    });
  }
  return found.sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
}

export type FeedbackTopic = 'problem' | 'idea' | 'question' | 'other';

/**
 * A message from Help & FAQ. public.feedback (027) takes the sender from the
 * session and lets nobody read it back, so this never asks for the row.
 */
export async function sendFeedback(message: string, topic: FeedbackTopic | null, appVersion: string, platform: string): Promise<void> {
  // Not in the generated types until they are regenerated after 027.
  const { error } = await (supabase as any).from('feedback').insert({
    topic,
    message: message.trim(),
    app_version: appVersion.slice(0, 40),
    platform: platform.slice(0, 20),
  });
  if (error) throw error;
}

/** A missing table or column: the migration a feature needs is not applied here. */
export function isMissingMigration(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST204'
    || /does not exist|could not find the table|schema cache/i.test(e.message ?? ''));
}
