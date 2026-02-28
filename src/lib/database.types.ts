export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string;
          phone: string | null;
          avatar_url: string | null;
          auth_provider: string;
          biometric_enabled: boolean;
          is_superuser: boolean;
          created_at: string;
          last_login: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          display_name: string;
          phone?: string | null;
          avatar_url?: string | null;
          auth_provider?: string;
          biometric_enabled?: boolean;
          is_superuser?: boolean;
          created_at?: string;
          last_login?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string;
          phone?: string | null;
          avatar_url?: string | null;
          auth_provider?: string;
          biometric_enabled?: boolean;
          is_superuser?: boolean;
          last_login?: string | null;
        };
      };
      families: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_by: string;
          family_icon: string | null;
          encryption_key_ref: string | null;
          storage_namespace: string;
          vector_namespace: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_by: string;
          family_icon?: string | null;
          encryption_key_ref?: string | null;
          storage_namespace: string;
          vector_namespace: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          family_icon?: string | null;
          encryption_key_ref?: string | null;
        };
      };
      family_members: {
        Row: {
          id: string;
          family_id: string;
          user_id: string;
          role: 'admin' | 'editor' | 'viewer';
          alias: string | null;
          relationship: string | null;
          can_upload: boolean;
          can_delete: boolean;
          joined_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          user_id: string;
          role?: 'admin' | 'editor' | 'viewer';
          alias?: string | null;
          relationship?: string | null;
          can_upload?: boolean;
          can_delete?: boolean;
          joined_at?: string;
        };
        Update: {
          role?: 'admin' | 'editor' | 'viewer';
          alias?: string | null;
          relationship?: string | null;
          can_upload?: boolean;
          can_delete?: boolean;
        };
      };
      invitations: {
        Row: {
          id: string;
          family_id: string;
          invited_by: string;
          invitee_email: string;
          role: string;
          status: 'pending' | 'accepted' | 'expired' | 'revoked';
          token: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          invited_by: string;
          invitee_email: string;
          role?: string;
          token: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          status?: 'pending' | 'accepted' | 'expired' | 'revoked';
        };
      };
      document_categories: {
        Row: {
          id: string;
          name: string;
          icon: string | null;
          has_expiry: boolean;
          is_system: boolean;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          icon?: string | null;
          has_expiry?: boolean;
          is_system?: boolean;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          icon?: string | null;
          has_expiry?: boolean;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          family_id: string;
          type: 'expiry' | 'upload' | 'invite' | 'system';
          title: string;
          message: string | null;
          document_ref: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          family_id: string;
          type: 'expiry' | 'upload' | 'invite' | 'system';
          title: string;
          message?: string | null;
          document_ref?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          is_read?: boolean;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          family_id: string | null;
          action: string;
          resource_type: string | null;
          resource_id: string | null;
          ip_address: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          family_id?: string | null;
          action: string;
          resource_type?: string | null;
          resource_id?: string | null;
          ip_address?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: never;
      };
    };
    Functions: {
      create_family: {
        Args: {
          p_user_id: string;
          p_family_name: string;
          p_description?: string;
          p_family_icon?: string;
        };
        Returns: string;
      };
      get_family_documents: {
        Args: {
          p_family_id: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: FamilyDocumentRow[];
      };
      get_document_detail: {
        Args: {
          p_family_id: string;
          p_document_id: string;
        };
        Returns: FamilyDocumentDetailRow[];
      };
      get_family_stats: {
        Args: {
          p_family_id: string;
        };
        Returns: { doc_count: number; member_count: number; category_count: number }[];
      };
      search_family_documents: {
        Args: {
          p_family_id: string;
          p_query: string;
          p_limit?: number;
        };
        Returns: FamilySearchResultRow[];
      };
    };
  };
}

// Per-family schema types (used when querying private schemas)
export interface FamilyDocument {
  id: string;
  uploaded_by: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  storage_path: string;
  category_id: string | null;
  belongs_to_member: string | null;
  ocr_text: string | null;
  ingestion_status: 'pending' | 'processing' | 'done' | 'failed';
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentMetadata {
  id: string;
  document_id: string;
  key: string;
  value: string;
  auto_extracted: boolean;
  confidence: number | null;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  embedding_id: string | null;
  created_at: string;
}

export interface ExpiryAlert {
  id: string;
  document_id: string;
  expiry_date: string;
  alert_days_before: number[];
  last_notified_at: string | null;
  is_expired: boolean;
  auto_detected: boolean;
}

export interface FamilyRelationship {
  id: string;
  member_id: string;
  related_to: string;
  relationship_type: string;
  aliases: string[];
}

// RPC return types
export interface FamilyDocumentRow {
  id: string;
  uploaded_by: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  storage_path: string;
  category_id: string | null;
  category_name: string | null;
  belongs_to_member: string | null;
  member_name: string | null;
  member_relationship: string | null;
  ingestion_status: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyDocumentDetailRow extends FamilyDocumentRow {
  uploader_name: string | null;
  metadata: Array<{
    key: string;
    value: string;
    auto_extracted: boolean;
    confidence: number | null;
  }>;
}

export interface FamilySearchResultRow {
  id: string;
  file_name: string;
  file_type: string;
  category_id: string | null;
  category_name: string | null;
  belongs_to_member: string | null;
  member_name: string | null;
  member_relationship: string | null;
  created_at: string;
  relevance: string;
}

// Joined types for UI
export interface FamilyMemberWithUser {
  id: string;
  family_id: string;
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  alias: string | null;
  relationship: string | null;
  can_upload: boolean;
  can_delete: boolean;
  joined_at: string;
  users: {
    display_name: string;
    email: string;
    avatar_url: string | null;
  };
}

export interface FamilyWithMembership {
  id: string;
  family_id: string;
  user_id: string;
  role: 'admin' | 'editor' | 'viewer';
  families: Database['public']['Tables']['families']['Row'];
}
