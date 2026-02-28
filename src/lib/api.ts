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

export async function searchDocuments(
  familyId: string,
  query: string,
  limit = 20,
): Promise<FamilySearchResultRow[]> {
  const { data, error } = await supabase.rpc('search_family_documents', {
    p_family_id: familyId,
    p_query: query,
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
