export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          family_id: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          family_id?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          family_id?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_categories: {
        Row: {
          created_by: string | null
          has_expiry: boolean | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
        }
        Insert: {
          created_by?: string | null
          has_expiry?: boolean | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
        }
        Update: {
          created_by?: string | null
          has_expiry?: boolean | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          encryption_key_ref: string | null
          family_icon: string | null
          id: string
          is_personal: boolean
          name: string
          storage_namespace: string
          vector_namespace: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          encryption_key_ref?: string | null
          family_icon?: string | null
          id?: string
          is_personal?: boolean
          name: string
          storage_namespace: string
          vector_namespace: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          encryption_key_ref?: string | null
          family_icon?: string | null
          id?: string
          is_personal?: boolean
          name?: string
          storage_namespace?: string
          vector_namespace?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      family_embedding_state: {
        Row: {
          completed_at: string | null
          cursor_id: string | null
          done_count: number
          extractor_version: string | null
          model: string
          rechunk_cursor: string | null
          rechunked_at: string | null
          reextract_cursor: string | null
          storage_namespace: string
          total_count: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          cursor_id?: string | null
          done_count?: number
          extractor_version?: string | null
          model: string
          rechunk_cursor?: string | null
          rechunked_at?: string | null
          reextract_cursor?: string | null
          storage_namespace: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          cursor_id?: string | null
          done_count?: number
          extractor_version?: string | null
          model?: string
          rechunk_cursor?: string | null
          rechunked_at?: string | null
          reextract_cursor?: string | null
          storage_namespace?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          alias: string | null
          can_delete: boolean | null
          can_upload: boolean | null
          family_id: string
          id: string
          joined_at: string | null
          relationship: string | null
          role: string
          user_id: string
        }
        Insert: {
          alias?: string | null
          can_delete?: boolean | null
          can_upload?: boolean | null
          family_id: string
          id?: string
          joined_at?: string | null
          relationship?: string | null
          role?: string
          user_id: string
        }
        Update: {
          alias?: string | null
          can_delete?: boolean | null
          can_upload?: boolean | null
          family_id?: string
          id?: string
          joined_at?: string | null
          relationship?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string | null
          expires_at: string
          family_id: string
          id: string
          invited_by: string
          invitee_email: string
          role: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          family_id: string
          id?: string
          invited_by: string
          invitee_email: string
          role?: string
          status?: string
          token: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          family_id?: string
          id?: string
          invited_by?: string
          invitee_email?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          document_ref: string | null
          family_id: string
          id: string
          is_read: boolean | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          document_ref?: string | null
          family_id: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          document_ref?: string | null
          family_id?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_provider: string
          avatar_url: string | null
          biometric_enabled: boolean | null
          created_at: string | null
          display_name: string
          document_languages: string[]
          email: string
          emergency_info: Json
          id: string
          is_superuser: boolean | null
          last_login: string | null
          phone: string | null
          voice_language: string
          voice_mode_enabled: boolean
        }
        Insert: {
          auth_provider?: string
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          created_at?: string | null
          display_name: string
          document_languages?: string[]
          email: string
          emergency_info?: Json
          id?: string
          is_superuser?: boolean | null
          last_login?: string | null
          phone?: string | null
          voice_language?: string
          voice_mode_enabled?: boolean
        }
        Update: {
          auth_provider?: string
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          created_at?: string | null
          display_name?: string
          document_languages?: string[]
          email?: string
          emergency_info?: Json
          id?: string
          is_superuser?: boolean | null
          last_login?: string | null
          phone?: string | null
          voice_language?: string
          voice_mode_enabled?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pending_invitations: {
        Args: { p_user_id: string }
        Returns: number
      }
      check_expiry_notifications: {
        Args: { p_family_id: string }
        Returns: number
      }
      complete_document_ingestion: {
        Args: {
          p_chunks: Json
          p_document_id: string
          p_family_id: string
          p_metadata?: Json
          p_ocr_text: string
        }
        Returns: undefined
      }
      create_expiry_alert: {
        Args: {
          p_document_id: string
          p_expiry_date: string
          p_family_id: string
        }
        Returns: string
      }
      create_family: {
        Args: {
          p_description?: string
          p_family_icon?: string
          p_family_name: string
          p_is_personal?: boolean
          p_user_id: string
        }
        Returns: string
      }
      delete_family_document: {
        Args: { p_document_id: string; p_family_id: string; p_user_id: string }
        Returns: undefined
      }
      get_document_chunks: {
        Args: { p_document_id: string; p_limit?: number; p_schema: string }
        Returns: {
          chunk_index: number
          content: string
        }[]
      }
      get_document_detail: {
        Args: { p_document_id: string; p_family_id: string }
        Returns: {
          belongs_to_member: string
          category_id: string
          category_name: string
          created_at: string
          file_name: string
          file_size_bytes: number
          file_type: string
          id: string
          ingestion_status: string
          member_name: string
          member_relationship: string
          metadata: Json
          storage_path: string
          updated_at: string
          uploaded_by: string
          uploader_name: string
        }[]
      }
      get_family_documents: {
        Args: { p_family_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          belongs_to_member: string
          category_id: string
          category_name: string
          created_at: string
          file_name: string
          file_size_bytes: number
          file_type: string
          id: string
          ingestion_status: string
          member_name: string
          member_relationship: string
          storage_path: string
          updated_at: string
          uploaded_by: string
        }[]
      }
      get_family_stats: {
        Args: { p_family_id: string }
        Returns: {
          category_count: number
          doc_count: number
          member_count: number
        }[]
      }
      get_my_family_ids: { Args: never; Returns: string[] }
      get_user_notifications: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          created_at: string
          document_ref: string
          family_id: string
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
        }[]
      }
      hybrid_search_documents: {
        Args: {
          p_family_id: string
          p_limit?: number
          p_query: string
          p_query_embedding?: string
        }
        Returns: {
          category_name: string
          created_at: string
          file_name: string
          file_size_bytes: number
          file_type: string
          id: string
          member_name: string
          member_relationship: string
          rank: number
          relevance: string
          similarity: number
          storage_path: string
        }[]
      }
      insert_family_document: {
        Args: {
          p_belongs_to_member?: string
          p_category_id?: string
          p_family_id: string
          p_file_name: string
          p_file_size_bytes: number
          p_file_type: string
          p_storage_path: string
          p_uploaded_by: string
        }
        Returns: string
      }
      is_family_admin: { Args: { p_family_id: string }; Returns: boolean }
      is_superuser: { Args: never; Returns: boolean }
      mark_notification_read: {
        Args: { p_notification_id: string; p_user_id: string }
        Returns: undefined
      }
      rag_chunk_total: { Args: { p_schema: string }; Returns: number }
      rag_chunks_to_embed: {
        Args: { p_after?: string; p_limit?: number; p_schema: string }
        Returns: {
          content: string
          id: string
        }[]
      }
      rag_documents_to_ingest: {
        Args: { p_limit?: number; p_schema: string }
        Returns: {
          file_name: string
          id: string
          storage_path: string
        }[]
      }
      rag_documents_to_rechunk: {
        Args: { p_after?: string; p_limit?: number; p_schema: string }
        Returns: {
          id: string
          ocr_text: string
        }[]
      }
      rag_documents_to_reextract: {
        Args: { p_after?: string; p_limit?: number; p_schema: string }
        Returns: {
          file_name: string
          id: string
          storage_path: string
        }[]
      }
      rag_mark_ingestion_failed: {
        Args: { p_document_id: string; p_schema: string }
        Returns: undefined
      }
      rag_replace_document_chunks: {
        Args: { p_chunks: Json; p_document_id: string; p_schema: string }
        Returns: number
      }
      rag_retrieve_chunks: {
        Args: {
          p_limit?: number
          p_per_doc?: number
          p_query_embedding?: string
          p_query_pattern: string
          p_schema: string
          p_tsquery: string
        }
        Returns: {
          category_name: string
          chunk_index: number
          content: string
          document_id: string
          file_name: string
          file_type: string
        }[]
      }
      rag_set_chunk_embedding: {
        Args: { p_chunk_id: string; p_embedding: string; p_schema: string }
        Returns: undefined
      }
      rag_set_document_text: {
        Args: { p_document_id: string; p_ocr_text: string; p_schema: string }
        Returns: undefined
      }
      rag_unindexed_documents: {
        Args: { p_schema: string }
        Returns: {
          file_name: string
          ingestion_status: string
        }[]
      }
      search_family_documents: {
        Args: { p_family_id: string; p_limit?: number; p_query: string }
        Returns: {
          belongs_to_member: string
          category_id: string
          category_name: string
          created_at: string
          file_name: string
          file_type: string
          id: string
          member_name: string
          member_relationship: string
          relevance: string
        }[]
      }
      set_document_description: {
        Args: {
          p_description: string
          p_document_id: string
          p_family_id: string
        }
        Returns: undefined
      }
      shares_family: { Args: { p_user: string }; Returns: boolean }
      update_family_document: {
        Args: {
          p_belongs_to_member?: string
          p_category_id?: string
          p_document_id: string
          p_family_id: string
          p_file_name?: string
          p_user_id: string
        }
        Returns: undefined
      }
      upgrade_family_schema_for_search: {
        Args: { p_family_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ─── Hand-written shapes the generator cannot produce ───────────
//
// These describe the ROW SHAPES that SECURITY DEFINER functions return
// through `RETURNS TABLE(...)`, joined with the UI's own expectations. The
// generator emits the RPC signatures above, but the app also passes these
// rows around as named types, so they are kept by hand.
//
// Carried over verbatim from the previous database.types.ts, which was part
// generated and part hand-written. Regenerating the file overwrites the
// generated half, so everything below the line has to be re-appended — the
// reason this section is marked.
// ────────────────────────────────────────────────────────────────

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
