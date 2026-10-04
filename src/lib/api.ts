import { supabase } from './supabase';
import { longDate, parseDocumentDate } from './dates';
import { isSaveable, mimeTypeFor, unsupportedFileMessage } from './file-types';
import type { Gender, KinLink, KinPerson } from '../../supabase/functions/_shared/kinship';
import { isBloodGroup, type EmergencyCard, type EmergencyCardInput, type EmergencyContact } from './emergency';
import {
  DEFAULT_PLAN_LIMITS, fits, localPlusPrice, storageFullMessage, type PlanLimits, type PlanName, type StorageRoom,
} from './plans';
import type {
  FamilyWithMembership,
  FamilyMemberWithUser,
  FamilyDocumentRow,
  FamilyDocumentDetailRow,
  FamilySearchResultRow,
  Database,
  Json,
  Tables,
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
// Nobody joins a family without saying yes (migration 037): a family admin
// invites a person who already has an account, by the email they sign in
// with. They are told by a notification and join only when they accept;
// until then the family sees them as Pending approval (fetchFamilyInvites).
// It goes through the add-member Edge Function because only the server may
// look an account up by email.

export type AddMemberOutcome =
  /** Invited: they join when they accept. */
  | { status: 'invited'; email: string }
  /** An add-member deployed before 037 adds at once. */
  | { status: 'added'; displayName: string }
  | { status: 'already_member'; displayName: string }
  | { status: 'already_invited' }
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
  if (!error) {
    return data?.status === 'invited'
      ? { status: 'invited', email: data.email || email.trim().toLowerCase() }
      : { status: 'added', displayName: data?.display_name || email };
  }

  const httpStatus = (error as { context?: Response })?.context?.status;
  const body = (await readFunctionError(error)) as { status?: string; error?: string; display_name?: string } | null;
  switch (body?.status) {
    case 'already_member':
      return { status: 'already_member', displayName: body.display_name || email };
    case 'already_invited':
      return { status: 'already_invited' };
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

// Someone added to the family tree by name who has since signed up: link the
// entry to their account rather than adding them again (migration 033). Not
// yet a member, they are invited (037), and join as a viewer AS that person
// when they accept, keeping their links, documents and emergency card;
// already a member, their two entries become one at once. Through
// link-account, which checks the caller is an admin.
export type LinkAccountOutcome =
  /** Invited to be this person: Pending approval until they accept. */
  | { status: 'invited'; displayName: string; email: string }
  /** `memberId` is who they are in the tree now: the same person when linked (before 037), their member person when merged. */
  | { status: 'linked' | 'merged'; displayName: string; memberId: string }
  | { status: 'no_account' }
  | { status: 'invalid_email' }
  /** Linking was refused, with the reason to show as it comes. */
  | { status: 'refused'; message: string }
  /** The server is not ready for this yet (migration 033 missing). */
  | { status: 'unavailable'; message: string };

export async function linkPersonToAccount(familyId: string, personId: string, email: string): Promise<LinkAccountOutcome> {
  const { data, error } = await supabase.functions.invoke('link-account', {
    body: { family_id: familyId, person_id: personId, email: email.trim() },
  });
  if (!error) {
    if (data?.status === 'invited') {
      return { status: 'invited', displayName: data.display_name || email, email: data.email || email.trim().toLowerCase() };
    }
    return {
      status: data?.status === 'merged' ? 'merged' : 'linked',
      displayName: data?.display_name || email,
      memberId: data?.member_id || personId,
    };
  }

  const httpStatus = (error as { context?: Response })?.context?.status;
  const body = (await readFunctionError(error)) as { status?: string; error?: string } | null;
  switch (body?.status) {
    case 'no_account':
      return { status: 'no_account' };
    case 'invalid_email':
      return { status: 'invalid_email' };
    case 'needs_migration':
      return { status: 'unavailable', message: 'Linking someone to their account is not switched on yet.' };
    case 'tree_rule': {
      // The tree's own rule, as the database words it: "Someone can have at most two parents in the tree."
      const rule = body.error ?? 'the family tree does not allow it.';
      return { status: 'refused', message: `These two can't be joined into one: ${rule.charAt(0).toLowerCase()}${rule.slice(1)}` };
    }
    case 'already_linked':
    case 'already_member':
    case 'already_invited':
    case 'no_person':
      return { status: 'refused', message: body.error ?? 'This person could not be linked.' };
  }
  // The gateway's own 404: this project does not have link-account yet.
  if (httpStatus === 404) {
    return { status: 'unavailable', message: 'Linking someone to their account is not switched on yet.' };
  }
  throw new Error(body?.error ?? error.message);
}

// ─── Invitations (037) ───────────────────────────────────────────
//
// What add-member and link-account make now: the person answers, and only a
// yes makes them a member. They see which family asked and who; the family
// sees the address it asked, as Pending approval, until they answer. Before
// 037 there are none, and every read here comes back empty.

export interface Invitation {
  id: string;
  familyId: string;
  familyName: string;
  invitedByName: string | null;
  /** The tree entry they would be, when the invitation came from a link. */
  personName: string | null;
  role: string;
  createdAt: string;
}

/** The invitations waiting for the signed-in person, oldest first. */
export async function fetchMyInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase.rpc('get_my_invitations');
  if (error) {
    if (isMissingMigration(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    familyId: row.family_id,
    familyName: row.family_name,
    invitedByName: row.invited_by_name ?? null,
    personName: row.person_name ?? null,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export type AcceptOutcome =
  | { status: 'joined'; familyId: string; familyName: string }
  /** Withdrawn, or someone else is that person now: nothing to accept. */
  | { status: 'gone' };

export async function acceptInvitation(inviteId: string): Promise<AcceptOutcome> {
  const { data, error } = await supabase.rpc('accept_family_invite', { p_invite_id: inviteId });
  if (error) {
    if (error.code === '42501') return { status: 'gone' };
    throw error;
  }
  const result = data as { status?: string; family_id?: string; family_name?: string } | null;
  return result?.status === 'joined' && result.family_id
    ? { status: 'joined', familyId: result.family_id, familyName: result.family_name ?? '' }
    : { status: 'gone' };
}

export async function declineInvitation(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_family_invite', { p_invite_id: inviteId });
  // 42501: withdrawn already — there is nothing left to say no to.
  if (error && error.code !== '42501') throw error;
}

export interface PendingInvite {
  id: string;
  /** The address the admin asked: the family does not see the account behind it until they accept. */
  email: string;
  /** The tree entry they were asked to be, when the invitation came from a link, and its name. */
  personId: string | null;
  personName: string | null;
  role: string;
  invitedBy: string | null;
  createdAt: string;
}

/** Who this family has asked and not heard from yet: Pending approval. */
export async function fetchFamilyInvites(familyId: string): Promise<PendingInvite[]> {
  const columns = 'id, email, person_id, role, invited_by, created_at';
  const query = (select: string) => supabase
    .from('family_invites')
    .select(select)
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  // With the tree entry's name; without it if the embed is refused, rather
  // than showing nobody as pending.
  let { data, error } = await query(`${columns}, family_people!family_invites_person(display_name)`);
  if (error && !isMissingMigration(error)) ({ data, error } = await query(columns));
  if (error) {
    if (isMissingMigration(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as Array<{
    id: string; email: string; person_id: string | null; role: string; invited_by: string | null; created_at: string;
    family_people?: { display_name: string } | null;
  }>).map((row) => ({
    id: row.id,
    email: row.email,
    personId: row.person_id,
    personName: row.family_people?.display_name ?? null,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }));
}

/** An admin withdraws an invitation; the notice of it goes too. */
export async function cancelInvitation(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_family_invite', { p_invite_id: inviteId });
  if (error) throw error;
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
 * Leave a family. Anyone may leave any family they are in, at any time, with
 * nobody's permission (family_members_delete_self).
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

  // Every plan has a storage limit (038). Asked first, with this file's size,
  // so the person hears why; the bucket refuses a full family either way.
  const room = await fetchStorageStatus(familyId).catch(() => null);
  if (room && !fits(room, fileSizeBytes)) throw new StorageFullError(room, fileSizeBytes);

  // 1. Upload to Supabase Storage
  const storagePath = `${storageNamespace}/${Date.now()}_${fileName}`;
  const mimeType = mimeTypeFor(fileType);

  const { error: storageErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBlob, { contentType: mimeType, upsert: false });

  if (storageErr) {
    // The bucket's policy refuses a family at its limit (038): say so in words.
    if (/row-level security|policy/i.test(storageErr.message)) {
      const now = await fetchStorageStatus(familyId).catch(() => null);
      if (now && now.usedBytes >= now.limitBytes) throw new StorageFullError(now, fileSizeBytes);
    }
    throw new Error(`Storage upload failed: ${storageErr.message}`);
  }

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

// ─── Share links (036) ───────────────────────────────────────────
//
// One document, by a link that lasts 1, 7 or 30 days, for someone outside
// the family. The link's secret is returned once, when it is made, and is
// never stored: only its hash. The family sees every live link on the
// document's page; whoever made it, or an admin, can turn it off.

export type ShareDays = 1 | 7 | 30;

export interface ShareLink {
  id: string;
  note: string | null;
  expiresAt: string;
  createdBy: string;
  openCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
}

export type MakeShareOutcome =
  | { status: 'made'; link: ShareLink; token: string }
  /** Not theirs to share, or the document is gone, in the database's own words. */
  | { status: 'refused'; message: string }
  /** Migration 036 is not applied here. */
  | { status: 'unavailable' };

/** The address a link opens: the web app's /s page, the secret after '#', which browsers never send to a server. */
export function shareLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/s#${token}`;
}

export async function createShareLink(
  familyId: string,
  documentId: string,
  days: ShareDays,
  note?: string,
): Promise<MakeShareOutcome> {
  const { data, error } = await supabase.rpc('create_document_share', {
    p_family_id: familyId,
    p_document_id: documentId,
    p_days: days,
    p_note: note?.trim() || undefined,
  });
  if (error) {
    if (isMissingMigration(error)) return { status: 'unavailable' };
    if (error.code === '42501' || error.code === '22023') return { status: 'refused', message: error.message };
    throw error;
  }
  const made = data as { id: string; token: string; expires_at: string };
  const { data: auth } = await supabase.auth.getSession();
  return {
    status: 'made',
    token: made.token,
    link: {
      id: made.id,
      note: note?.trim() || null,
      expiresAt: made.expires_at,
      createdBy: auth.session?.user.id ?? '',
      openCount: 0,
      lastOpenedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

/** The document's links still working, newest first; 'unavailable' before 036. */
export async function fetchShareLinks(familyId: string, documentId: string): Promise<ShareLink[] | 'unavailable'> {
  // Named columns: clients may not read the secret's hash, so '*' is refused.
  const { data, error } = await supabase
    .from('document_shares')
    .select('id, note, expires_at, created_by, open_count, last_opened_at, created_at')
    .eq('family_id', familyId)
    .eq('document_id', documentId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingMigration(error)) return 'unavailable';
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    note: row.note,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    openCount: row.open_count,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
  }));
}

export async function revokeShareLink(shareId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_document_share', { p_share_id: shareId });
  if (error) throw error;
}

export interface SharedDocument {
  fileName: string;
  fileType: string;
  expiresAt: string;
  /** First name of whoever shared it. */
  sharedBy: string | null;
  /** Both work for five minutes; opening the page again asks again. */
  url: string;
  downloadUrl: string;
}

/** The public page's call: no account, only the link's secret. */
export async function openSharedDocument(token: string): Promise<SharedDocument | 'gone' | 'unavailable'> {
  if (!/^[0-9a-f]{64}$/.test(token)) return 'gone';
  const { data, error } = await supabase.functions.invoke('share', { body: { token } });
  if (error) {
    const httpStatus = (error as { context?: Response })?.context?.status;
    const body = (await readFunctionError(error)) as { status?: string } | null;
    if (body?.status === 'gone') return 'gone';
    // 503: 036 not applied; a bare 404: the function is not deployed here yet.
    if (body?.status === 'needs_migration' || (httpStatus === 404 && !body?.status)) return 'unavailable';
    throw new Error('Could not open this link. Please try again.');
  }
  return {
    fileName: data.file_name,
    fileType: data.file_type,
    expiresAt: data.expires_at,
    sharedBy: data.shared_by ?? null,
    url: data.url,
    downloadUrl: data.download_url,
  };
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

  const { error } = await supabase.from('users')
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

/**
 * Ends every session this account has, on every device, this one included —
 * and their notifications with them (034): a lost phone must not go on
 * showing the family's reminders. Before 034 there are none to remove.
 */
export async function signOutEverywhere(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const { error: pushErr } = await supabase.from('push_subscriptions').delete().eq('user_id', data.user.id);
    if (pushErr && !isMissingMigration(pushErr)) throw pushErr;
  }
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
 * How many documents each of your families keeps, and how much of that you
 * added: the sizes of the files as uploaded. A family's limit, and its use as
 * the server counts it, come from fetchStorageStatus (038).
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

// ─── Plans and storage limits (038) ──────────────────────────────
//
// Every plan has a storage limit: Free 1 GB, Family Plus 10 GB (039;
// public.plan_limits). The server keeps it — the documents bucket refuses a
// new file once a family is at its limit — and these say where a family
// stands, so the app can tell people before it refuses them. They read 038's
// shape too (a period beside each plan), so the app works either side of 039.

export interface FamilyPlanStatus extends StorageRoom {
  /** When a Plus plan's paid time ends; null on Free. */
  paidUntil: string | null;
  /**
   * For a family whose Plus has ended and that holds more than the free limit:
   * when the newest documents above it are removed (040). Null otherwise.
   */
  removalAt: string | null;
}

/** A family's plan, its limit and what its files add up to; null before 038. */
export async function fetchStorageStatus(familyId: string): Promise<FamilyPlanStatus | null> {
  const { data, error } = await supabase.rpc('family_storage_status', { p_family_id: familyId });
  if (error) {
    if (isMissingMigration(error)) return null;
    throw error;
  }
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    plan: row.plan as PlanName,
    paidUntil: row.paid_until ?? null,
    limitBytes: Number(row.limit_bytes),
    usedBytes: Number(row.used_bytes),
    // Before 040 the row has no removal_at.
    removalAt: (row as { removal_at?: string | null }).removal_at ?? null,
  };
}

/** What each plan may keep, as the database says; 039's and 040's numbers before 038. */
export async function fetchPlanLimits(): Promise<PlanLimits> {
  type Row = { plan: string; storage_bytes: number; grace_days?: number | null };
  // grace_days arrives with 040; without it the whole select fails, so ask again without.
  const withGrace = await supabase.from('plan_limits').select('plan, storage_bytes, grace_days');
  const answer = withGrace.error && /grace_days/.test(withGrace.error.message ?? '')
    ? await supabase.from('plan_limits').select('plan, storage_bytes')
    : withGrace;
  const rows = (answer.data ?? []) as Row[];
  if (answer.error || !rows.length) return DEFAULT_PLAN_LIMITS;
  // Under 038 Plus has two rows, monthly and yearly; the larger is the offer.
  const of = (plan: string, fallback: number) => {
    const sizes = rows.filter((r) => r.plan === plan).map((r) => Number(r.storage_bytes));
    return sizes.length ? Math.max(...sizes) : fallback;
  };
  const grace = rows.find((r) => r.plan === 'plus')?.grace_days;
  return {
    free: of('free', DEFAULT_PLAN_LIMITS.free),
    plus: of('plus', DEFAULT_PLAN_LIMITS.plus),
    graceDays: grace ? Number(grace) : DEFAULT_PLAN_LIMITS.graceDays,
  };
}

/** The family's storage is full, in words the person can act on. */
export class StorageFullError extends Error {
  room: StorageRoom;

  constructor(room: StorageRoom & { removalAt?: string | null }, fileBytes: number) {
    super(storageFullMessage(room, fileBytes, {
      price: localPlusPrice(),
      removalOn: room.removalAt ? longDate(new Date(room.removalAt)) : undefined,
    }));
    this.name = 'StorageFullError';
    this.room = room;
  }
}

export interface ExpiringDocument {
  id: string;
  fileName: string;
  /** Whose document it is: a person in the family tree (a member id before 031). */
  memberId: string | null;
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
      memberId: doc.belongs_to_member,
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
  const { error } = await supabase.from('feedback').insert({
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

// ─── Saved chats (028) ───────────────────────────────────────────
//
// Ask › Save chat keeps a conversation in public.saved_chats. Only its owner
// can read it, and it is deleted with their membership of the family. Before
// 028 every call fails with a missing table: callers check
// isMissingMigration() and say saving is not switched on yet.

export interface SavedChatMessage {
  role: 'user' | 'ai';
  text: string;
  sources?: RagSearchResult['sources'];
}

export interface SavedChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface SavedChat extends SavedChatSummary {
  messages: SavedChatMessage[];
}

// Well inside the table's 256 KB check. A very long chat keeps its newest turns.
const SAVED_CHAT_MAX_MESSAGES = 100;
const SAVED_CHAT_MAX_TEXT = 6000;

/** The first question, on one line: what the chat was about. */
export function savedChatTitle(messages: SavedChatMessage[]): string {
  const first = (messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ').trim();
  return (first.length > 80 ? `${first.slice(0, 79)}…` : first) || 'Saved chat';
}

function chatForStorage(messages: SavedChatMessage[]): SavedChatMessage[] {
  return messages
    .filter((m) => m.text.trim())
    .slice(-SAVED_CHAT_MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      text: m.text.slice(0, SAVED_CHAT_MAX_TEXT),
      ...(m.sources?.length
        ? { sources: m.sources.slice(0, 10).map(({ id, file_name, file_type, category_name }) => ({ id, file_name, file_type, category_name })) }
        : {}),
    }));
}

const savedChats = () => supabase.from('saved_chats');

/** This person's saved chats about one family, most recently used first. */
export async function listSavedChats(familyId: string): Promise<SavedChatSummary[]> {
  const { data, error } = await savedChats()
    .select('id, title, updated_at')
    .eq('family_id', familyId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function getSavedChat(id: string): Promise<SavedChat | null> {
  const { data, error } = await savedChats().select('id, title, messages, updated_at').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    updatedAt: data.updated_at,
    // Written only by saveChat below, in this shape.
    messages: Array.isArray(data.messages) ? (data.messages as unknown as SavedChatMessage[]) : [],
  };
}

/**
 * Save a conversation: a new saved chat, or — given its id — the same one
 * brought up to date. Returns the id, which is new if the old chat had been
 * deleted meanwhile (from the list, or by leaving and rejoining the family).
 */
export async function saveChat(familyId: string, messages: SavedChatMessage[], id?: string | null): Promise<string> {
  const stored = chatForStorage(messages);
  const title = savedChatTitle(stored);
  const asJson = stored as unknown as Json;
  if (id) {
    const { data, error } = await savedChats()
      .update({ title, messages: asJson, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (data?.length) return id;
  }
  const { data, error } = await savedChats().insert({ family_id: familyId, title, messages: asJson }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteSavedChat(id: string): Promise<void> {
  const { error } = await savedChats().delete().eq('id', id);
  if (error) throw error;
}

// ─── Deleting your account (029) ─────────────────────────────────
//
// The delete-account Edge Function does the work as the service role, for the
// person in the session and nobody else. Families nobody would be left to
// manage are deleted with the account; the others are left, and keep their
// documents. Nothing is kept afterwards.

export interface AccountDeletionFamily {
  familyId: string;
  name: string;
  role: string;
  otherMembers: number;
  documentCount: number;
  /** How many of the family's documents this person added. */
  yourDocuments: number;
  /** Deleted with the account, rather than left. */
  deleted: boolean;
}

/**
 * `unavailable` (the function or migration 029 is not on this server yet) or
 * `error`, with a sentence for the person.
 */
export class AccountDeletionError extends Error {
  status: 'unavailable' | 'error';
  constructor(status: 'unavailable' | 'error', message: string) {
    super(message);
    this.status = status;
  }
}

async function deleteAccountInvoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body });
  if (!error) return data as T;
  const httpStatus = (error as { context?: Response })?.context?.status;
  const payload = (await readFunctionError(error)) as { status?: string; error?: string } | null;
  // The gateway's own 404 (not deployed here), or the database update missing.
  if ((httpStatus === 404 && !payload?.status) || payload?.status === 'needs_migration') {
    throw new AccountDeletionError('unavailable', 'Deleting your account from the app is not switched on yet.');
  }
  throw new AccountDeletionError('error', payload?.error ?? error.message);
}

/** What deleting the signed-in account would do, family by family. Changes nothing. */
export async function previewAccountDeletion(): Promise<AccountDeletionFamily[]> {
  const { families } = await deleteAccountInvoke<{
    families: Array<{
      family_id: string; name: string; role: string; other_members: number;
      document_count: number; your_documents: number; deleted: boolean;
    }>;
  }>({ action: 'preview' });
  return (families ?? []).map((f) => ({
    familyId: f.family_id,
    name: f.name,
    role: f.role,
    otherMembers: f.other_members,
    documentCount: f.document_count,
    yourDocuments: f.your_documents,
    deleted: f.deleted,
  }));
}

/** Delete the signed-in account, as the preview described. There is no undo. */
export async function deleteAccount(): Promise<{ familiesDeleted: number; filesDeleted: number }> {
  const result = await deleteAccountInvoke<{ families_deleted: number; files_deleted: number }>({
    action: 'delete',
    confirm: 'DELETE',
  });
  return { familiesDeleted: result.families_deleted ?? 0, filesDeleted: result.files_deleted ?? 0 };
}

/**
 * Forget the session on this device only. After a deletion there is no
 * account for a server-side sign-out to find.
 */
export async function signOutThisDevice(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' });
}

// ─── Family tree (031) ───────────────────────────────────────────
//
// Everyone in a family, with or without a FamilyVault account: a grandparent
// who will never sign in, a child too young to. public.family_people holds
// the people and public.family_links how they are related (parent, spouse,
// sibling) — never a label: "Mother" depends on who is looking, and is
// worked out by supabase/functions/_shared/kinship.ts. A member's own node
// is created with their membership and carries their member id, so
// documents already tagged to a member stay tagged to that person.
//
// Reads go through RLS (members of the family); writes go through RPCs that
// check the caller is an admin (or, for their own details, that person).
// Before 031 every call fails with a missing table or function: callers
// check isMissingMigration() and say the tree is not switched on yet.

export interface FamilyPerson extends KinPerson {
  /** The account this person signs in with, if any. */
  userId: string | null;
}

export interface FamilyTree {
  people: FamilyPerson[];
  links: KinLink[];
}

export type RelativeKind = 'parent' | 'child' | 'spouse' | 'sibling';

export interface PersonDetails {
  name: string;
  gender: Gender;
  /** YYYY-MM-DD, or null. */
  birthDate: string | null;
}

export async function fetchFamilyTree(familyId: string): Promise<FamilyTree> {
  const [people, links] = await Promise.all([
    supabase.from('family_people').select('id, display_name, gender, birth_date, user_id').eq('family_id', familyId).order('created_at'),
    supabase.from('family_links').select('from_person, to_person, kind').eq('family_id', familyId),
  ]);
  if (people.error) throw people.error;
  if (links.error) throw links.error;
  return {
    people: (people.data ?? []).map((p) => ({
      id: p.id,
      name: p.display_name,
      gender: p.gender === 'female' || p.gender === 'male' ? p.gender : null,
      birthDate: p.birth_date ?? null,
      userId: p.user_id ?? null,
    })),
    links: (links.data ?? []).map((l) => ({ from: l.from_person, to: l.to_person, kind: l.kind as KinLink['kind'] })),
  };
}

/**
 * Add someone to the tree, already connected: "the new person is the
 * <relation> of <relative>". A child can have both parents at once
 * (`otherParentId`). Admins only; the database checks.
 */
export async function addFamilyPerson(
  familyId: string,
  details: PersonDetails,
  relation?: { kind: RelativeKind; relativeId: string; otherParentId?: string | null },
): Promise<string> {
  // Left out rather than sent as null: each has a NULL default.
  const { data, error } = await supabase.rpc('add_family_person', {
    p_family_id: familyId,
    p_display_name: details.name.trim(),
    p_gender: details.gender ?? undefined,
    p_birth_date: details.birthDate ?? undefined,
    p_relation: relation?.kind,
    p_relative: relation?.relativeId,
    p_other_parent: relation?.otherParentId ?? undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * Connect someone already in the tree: `personId` is the <kind> of
 * `relativeId` (and, for a child, of `otherParentId` too). Admins only.
 */
export async function linkFamilyPeople(
  familyId: string,
  personId: string,
  kind: RelativeKind,
  relativeId: string,
  otherParentId?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('link_family_people', {
    p_family_id: familyId,
    p_person: personId,
    p_relation: kind,
    p_relative: relativeId,
    p_other_parent: otherParentId ?? undefined,
  });
  if (error) throw error;
}

/** Name, gender, birth date. An admin, or the person themselves. */
export async function updateFamilyPerson(personId: string, details: PersonDetails): Promise<void> {
  // A gender or birth date left out is cleared: the function's defaults are NULL.
  const { error } = await supabase.rpc('update_family_person', {
    p_person_id: personId,
    p_display_name: details.name.trim(),
    p_gender: details.gender ?? undefined,
    p_birth_date: details.birthDate ?? undefined,
  });
  if (error) throw error;
}

/**
 * Take someone out of the tree, with their links. Their documents stay in
 * the family, no longer marked as theirs. Someone with an account is taken
 * out by removing them from the family instead. Admins only.
 */
export async function removeFamilyPerson(personId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_family_person', { p_person_id: personId });
  if (error) throw error;
}

// ─── Emergency cards (032) ───────────────────────────────────────
//
// One card per person in the tree: blood group, allergies, conditions,
// medicines, the family doctor, health insurance, people to call. Every
// member reads every card (RLS); save_emergency_card() writes, for an admin
// or the person themselves, and an empty card is deleted. A person's card
// goes with their membership when they leave the family. Before 032 every
// call fails with a missing table or function: callers check
// isMissingMigration() and say cards are not switched on yet.

function toEmergencyCard(row: Tables<'family_emergency_cards'>): EmergencyCard {
  const contacts = Array.isArray(row.contacts) ? (row.contacts as unknown[]) : [];
  return {
    personId: row.person_id,
    bloodGroup: isBloodGroup(row.blood_group) ? row.blood_group : null,
    allergies: row.allergies,
    conditions: row.conditions,
    medicines: row.medicines,
    doctorName: row.doctor_name,
    doctorPhone: row.doctor_phone,
    insurer: row.insurer,
    policyNumber: row.policy_number,
    contacts: contacts
      .map((c) => (c ?? {}) as Partial<Record<keyof EmergencyContact, unknown>>)
      .filter((c) => typeof c.name === 'string' && typeof c.phone === 'string')
      .map((c) => ({ name: c.name as string, relation: typeof c.relation === 'string' ? c.relation : null, phone: c.phone as string })),
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Every card in the family. People without one are simply not in the list. */
export async function fetchEmergencyCards(familyId: string): Promise<EmergencyCard[]> {
  const { data, error } = await supabase.from('family_emergency_cards').select('*').eq('family_id', familyId);
  if (error) throw error;
  return (data ?? []).map(toEmergencyCard);
}

/** One person's card, or null when they have none yet. */
export async function fetchEmergencyCard(familyId: string, personId: string): Promise<EmergencyCard | null> {
  const { data, error } = await supabase
    .from('family_emergency_cards')
    .select('*')
    .eq('family_id', familyId)
    .eq('person_id', personId)
    .maybeSingle();
  if (error) throw error;
  return data ? toEmergencyCard(data) : null;
}

/**
 * Save the whole card: fields left blank are cleared, and a card with
 * nothing on it is deleted. An admin, or the person themselves; the
 * database checks, and its messages are written to be shown as they are.
 */
export async function saveEmergencyCard(personId: string, card: EmergencyCardInput): Promise<void> {
  const payload = {
    blood_group: card.bloodGroup,
    allergies: card.allergies,
    conditions: card.conditions,
    medicines: card.medicines,
    doctor_name: card.doctorName,
    doctor_phone: card.doctorPhone,
    insurer: card.insurer,
    policy_number: card.policyNumber,
    contacts: card.contacts.map((c) => ({ name: c.name, relation: c.relation, phone: c.phone })),
    notes: card.notes,
  };
  const { error } = await supabase.rpc('save_emergency_card', {
    p_person_id: personId,
    p_card: payload as unknown as Json,
  });
  if (error) throw error;
}

/** The documents marked as one person's, newest first. */
export async function fetchPersonDocuments(familyId: string, personId: string): Promise<FamilyDocumentRow[]> {
  const docs = await fetchAllDocuments(familyId);
  return docs.filter((d) => d.belongs_to_member === personId);
}
