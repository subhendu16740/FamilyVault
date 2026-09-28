import { supabase } from './supabase';
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

  // 1. Upload to Supabase Storage
  const storagePath = `${storageNamespace}/${Date.now()}_${fileName}`;
  const mimeType = fileType === 'pdf' ? 'application/pdf' : `image/${fileType}`;

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

  if (insertErr) throw new Error(`Document insert failed: ${insertErr.message}`);

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
