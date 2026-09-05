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
  const { data: memberships, error: memErr } = await supabase
    .from('family_members')
    .select('id, family_id, user_id, role')
    .eq('user_id', userId);

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
    p_description: description ?? null,
    p_family_icon: icon ?? null,
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
  /** true when `answer` did not come from the model (rate limit, outage). */
  degraded?: boolean;
  retry_after_seconds?: number;
}

/** One prior turn of the conversation, as the server expects it. */
export interface RagHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Document IDs cited in an assistant turn — lets follow-ups stay on-topic. */
  source_ids?: string[];
}

export async function ragSearch(
  familyId: string,
  query: string,
  history: RagHistoryTurn[] = [],
): Promise<RagSearchResult> {
  const { data, error } = await supabase.functions.invoke('rag-search', {
    body: { family_id: familyId, query, history },
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
      p_query_embedding: null,  // Text-only until client-side embedding is added
      p_limit: limit,
    });

    if (!error && data) {
      return (data ?? []) as FamilySearchResultRow[];
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

// ─── Invitations ─────────────────────────────────────────────────

export interface InvitationRow {
  id: string;
  family_id: string;
  invited_by: string;
  invitee_email: string;
  role: string;
  status: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export async function fetchFamilyInvitations(familyId: string): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InvitationRow[];
}

export async function inviteMember(
  familyId: string,
  invitedBy: string,
  email: string,
  role: string = 'viewer',
): Promise<void> {
  // Try Edge Function first (sends email)
  try {
    const { data, error: fnErr } = await supabase.functions.invoke('invite-member', {
      body: { family_id: familyId, invited_by: invitedBy, invitee_email: email, role },
    });
    if (!fnErr && data?.success) return;
  } catch {
    // Edge Function not available — fall through to direct insert
  }

  // Fallback: direct DB insert (no email sent)
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('invitations').insert({
    family_id: familyId,
    invited_by: invitedBy,
    invitee_email: email,
    role,
    token,
    expires_at: expiresAt,
  });

  if (error) throw error;
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

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase
    .from('invitations')
    .delete()
    .eq('id', invitationId);

  if (error) throw error;
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
    p_category_id: categoryId ?? null,
    p_belongs_to_member: belongsToMemberId ?? null,
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
    p_file_name: updates.fileName ?? null,
    p_category_id: updates.categoryId ?? null,
    p_belongs_to_member: updates.belongsToMember ?? null,
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
