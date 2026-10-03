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
      document_shares: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          expires_at: string
          family_id: string
          id: string
          last_opened_at: string | null
          note: string | null
          open_count: number
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document_id: string
          expires_at: string
          family_id: string
          id?: string
          last_opened_at?: string | null
          note?: string | null
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          expires_at?: string
          family_id?: string
          id?: string
          last_opened_at?: string | null
          note?: string | null
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_revoked_by_fkey"
            columns: ["revoked_by"]
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
      family_emergency_cards: {
        Row: {
          allergies: string | null
          blood_group: string | null
          conditions: string | null
          contacts: Json
          doctor_name: string | null
          doctor_phone: string | null
          family_id: string
          insurer: string | null
          medicines: string | null
          notes: string | null
          person_id: string
          policy_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergies?: string | null
          blood_group?: string | null
          conditions?: string | null
          contacts?: Json
          doctor_name?: string | null
          doctor_phone?: string | null
          family_id: string
          insurer?: string | null
          medicines?: string | null
          notes?: string | null
          person_id: string
          policy_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergies?: string | null
          blood_group?: string | null
          conditions?: string | null
          contacts?: Json
          doctor_name?: string | null
          doctor_phone?: string | null
          family_id?: string
          insurer?: string | null
          medicines?: string | null
          notes?: string | null
          person_id?: string
          policy_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_emergency_cards_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_emergency_cards_person_fkey"
            columns: ["family_id", "person_id"]
            isOneToOne: true
            referencedRelation: "family_people"
            referencedColumns: ["family_id", "id"]
          },
        ]
      }
      family_links: {
        Row: {
          created_at: string
          family_id: string
          from_person: string
          id: string
          kind: string
          to_person: string
        }
        Insert: {
          created_at?: string
          family_id: string
          from_person: string
          id?: string
          kind: string
          to_person: string
        }
        Update: {
          created_at?: string
          family_id?: string
          from_person?: string
          id?: string
          kind?: string
          to_person?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_links_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_links_from_fkey"
            columns: ["family_id", "from_person"]
            isOneToOne: false
            referencedRelation: "family_people"
            referencedColumns: ["family_id", "id"]
          },
          {
            foreignKeyName: "family_links_to_fkey"
            columns: ["family_id", "to_person"]
            isOneToOne: false
            referencedRelation: "family_people"
            referencedColumns: ["family_id", "id"]
          },
        ]
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
      family_people: {
        Row: {
          birth_date: string | null
          created_at: string
          created_by: string | null
          display_name: string
          family_id: string
          gender: string | null
          id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          display_name: string
          family_id: string
          gender?: string | null
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          family_id?: string
          gender?: string | null
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_people_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          message: string
          platform: string | null
          topic: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          message: string
          platform?: string | null
          topic?: string | null
          user_id?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          message?: string
          platform?: string | null
          topic?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gmail_connections: {
        Row: {
          connected_at: string
          expired_at: string | null
          google_email: string
          messages_scanned: number
          refresh_token_enc: string
          scan_finished_at: string | null
          scan_lease_until: string | null
          scan_page_token: string | null
          scan_started_at: string | null
          scopes: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          expired_at?: string | null
          google_email: string
          messages_scanned?: number
          refresh_token_enc: string
          scan_finished_at?: string | null
          scan_lease_until?: string | null
          scan_page_token?: string | null
          scan_started_at?: string | null
          scopes: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          expired_at?: string | null
          google_email?: string
          messages_scanned?: number
          refresh_token_enc?: string
          scan_finished_at?: string | null
          scan_lease_until?: string | null
          scan_page_token?: string | null
          scan_started_at?: string | null
          scopes?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gmail_import_items: {
        Row: {
          category_guess: string | null
          claimed_at: string | null
          content_sha256: string | null
          created_at: string
          document_id: string | null
          error: string | null
          family_id: string | null
          file_name: string
          id: string
          imported_at: string | null
          message_id: string
          mime_type: string
          part_id: string
          reason: string | null
          sender: string | null
          sent_at: string | null
          size_bytes: number
          status: string
          subject: string | null
          suggestion: string
          user_id: string
        }
        Insert: {
          category_guess?: string | null
          claimed_at?: string | null
          content_sha256?: string | null
          created_at?: string
          document_id?: string | null
          error?: string | null
          family_id?: string | null
          file_name: string
          id?: string
          imported_at?: string | null
          message_id: string
          mime_type: string
          part_id: string
          reason?: string | null
          sender?: string | null
          sent_at?: string | null
          size_bytes?: number
          status?: string
          subject?: string | null
          suggestion: string
          user_id: string
        }
        Update: {
          category_guess?: string | null
          claimed_at?: string | null
          content_sha256?: string | null
          created_at?: string
          document_id?: string | null
          error?: string | null
          family_id?: string | null
          file_name?: string
          id?: string
          imported_at?: string | null
          message_id?: string
          mime_type?: string
          part_id?: string
          reason?: string | null
          sender?: string | null
          sent_at?: string | null
          size_bytes?: number
          status?: string
          subject?: string | null
          suggestion?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_import_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_oauth_states: {
        Row: {
          code_verifier: string
          created_at: string
          expires_at: string
          return_to: string
          state: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          expires_at?: string
          return_to: string
          state: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          expires_at?: string
          return_to?: string
          state?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
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
          pushed_at: string | null
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
          pushed_at?: string | null
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
          pushed_at?: string | null
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
      push_config: {
        Row: {
          anon_key: string | null
          created_at: string
          functions_url: string | null
          id: boolean
          send_lease: string | null
          subject: string
          updated_at: string
          vapid_private: string
          vapid_public: string
        }
        Insert: {
          anon_key?: string | null
          created_at?: string
          functions_url?: string | null
          id?: boolean
          send_lease?: string | null
          subject: string
          updated_at?: string
          vapid_private: string
          vapid_public: string
        }
        Update: {
          anon_key?: string | null
          created_at?: string
          functions_url?: string | null
          id?: boolean
          send_lease?: string | null
          subject?: string
          updated_at?: string
          vapid_private?: string
          vapid_public?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          label: string | null
          last_used_at: string | null
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders_sent: {
        Row: {
          due_on: string
          family_id: string
          kind: string
          ref_id: string
          sent_at: string
          stage: number
        }
        Insert: {
          due_on: string
          family_id: string
          kind: string
          ref_id: string
          sent_at?: string
          stage: number
        }
        Update: {
          due_on?: string
          family_id?: string
          kind?: string
          ref_id?: string
          sent_at?: string
          stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "reminders_sent_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_chats: {
        Row: {
          created_at: string
          family_id: string
          id: string
          messages: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          messages: Json
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          messages?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_chats_membership_fkey"
            columns: ["family_id", "user_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["family_id", "user_id"]
          },
        ]
      }
      users: {
        Row: {
          auth_provider: string
          avatar_url: string | null
          biometric_enabled: boolean | null
          birthday_reminders: boolean
          created_at: string | null
          display_name: string
          document_languages: string[]
          email: string
          emergency_info: Json
          id: string
          is_superuser: boolean | null
          last_login: string | null
          notifications_enabled: boolean
          phone: string | null
          voice_language: string
          voice_mode_enabled: boolean
        }
        Insert: {
          auth_provider?: string
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          birthday_reminders?: boolean
          created_at?: string | null
          display_name: string
          document_languages?: string[]
          email: string
          emergency_info?: Json
          id?: string
          is_superuser?: boolean | null
          last_login?: string | null
          notifications_enabled?: boolean
          phone?: string | null
          voice_language?: string
          voice_mode_enabled?: boolean
        }
        Update: {
          auth_provider?: string
          avatar_url?: string | null
          biometric_enabled?: boolean | null
          birthday_reminders?: boolean
          created_at?: string | null
          display_name?: string
          document_languages?: string[]
          email?: string
          emergency_info?: Json
          id?: string
          is_superuser?: boolean | null
          last_login?: string | null
          notifications_enabled?: boolean
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
      account_deletion_plan: {
        Args: { p_user_id: string }
        Returns: {
          delete_family: boolean
          document_count: number
          family_id: string
          family_name: string
          other_admins: number
          other_members: number
          role: string
          storage_namespace: string
          your_documents: number
        }[]
      }
      add_family_member: {
        Args: {
          p_added_by: string
          p_alias?: string
          p_email: string
          p_family_id: string
          p_relationship?: string
          p_role?: string
        }
        Returns: Json
      }
      add_family_person: {
        Args: {
          p_birth_date?: string
          p_display_name: string
          p_family_id: string
          p_gender?: string
          p_other_parent?: string
          p_relation?: string
          p_relative?: string
        }
        Returns: string
      }
      assert_caller_in_family: {
        Args: { p_family_id: string }
        Returns: undefined
      }
      assert_caller_is: { Args: { p_user_id: string }; Returns: undefined }
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
      create_document_share: {
        Args: {
          p_days: number
          p_document_id: string
          p_family_id: string
          p_note?: string
        }
        Returns: Json
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
      delete_account_data: { Args: { p_user_id: string }; Returns: Json }
      delete_family_document: {
        Args: { p_document_id: string; p_family_id: string; p_user_id: string }
        Returns: undefined
      }
      family_storage_objects: {
        Args: { p_storage_namespace: string }
        Returns: string[]
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
      link_family_people: {
        Args: {
          p_family_id: string
          p_other_parent?: string
          p_person: string
          p_relation: string
          p_relative: string
        }
        Returns: undefined
      }
      link_family_person_account: {
        Args: {
          p_email: string
          p_family_id: string
          p_linked_by: string
          p_person_id: string
        }
        Returns: Json
      }
      mark_notification_read: {
        Args: { p_notification_id: string; p_user_id: string }
        Returns: undefined
      }
      purge_family: { Args: { p_family_id: string }; Returns: string }
      rag_chunk_total: { Args: { p_schema: string }; Returns: number }
      open_document_share: {
        Args: { p_token_hash: string }
        Returns: {
          expires_at: string
          file_name: string
          file_type: string
          shared_by: string
          storage_path: string
        }[]
      }
      push_claim_send: { Args: never; Returns: boolean }
      push_done: {
        Args: {
          p_delivered?: string[]
          p_gone?: string[]
          p_notifications: string[]
        }
        Returns: undefined
      }
      push_keys: {
        Args: never
        Returns: {
          contact: string
          has_address: boolean
          private_key: string
          public_key: string
        }[]
      }
      push_pending: {
        Args: { p_limit?: number }
        Returns: {
          auth: string
          document_ref: string
          endpoint: string
          family_id: string
          kind: string
          message: string
          notification_id: string
          p256dh: string
          subscription_id: string
          title: string
        }[]
      }
      push_setup: {
        Args: {
          p_anon_key: string
          p_functions_url: string
          p_subject: string
          p_vapid_private: string
          p_vapid_public: string
        }
        Returns: {
          contact: string
          private_key: string
          public_key: string
        }[]
      }
      queue_birthday_reminders: { Args: { p_today?: string }; Returns: number }
      queue_expiry_reminders: { Args: { p_today?: string }; Returns: number }
      queue_family_expiry_reminders: {
        Args: { p_family_id: string; p_today?: string }
        Returns: number
      }
      rag_chunks_to_embed: {
        Args: { p_after?: string; p_limit?: number; p_schema: string }
        Returns: {
          content: string
          id: string
        }[]
      }
      rag_documents_for_people: {
        Args: { p_limit?: number; p_people: string[]; p_schema: string }
        Returns: {
          belongs_to_member: string
          category_name: string
          created_at: string
          file_name: string
          file_type: string
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
        Args: { p_chunk_id: string; p_embedding?: string; p_schema: string }
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
      remove_family_person: {
        Args: { p_person_id: string }
        Returns: undefined
      }
      revoke_document_share: { Args: { p_share_id: string }; Returns: undefined }
      run_reminders: { Args: never; Returns: undefined }
      save_emergency_card: {
        Args: { p_card: Json; p_person_id: string }
        Returns: undefined
      }
      save_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_label?: string
          p_p256dh: string
        }
        Returns: undefined
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
      tree_add_pair: {
        Args: { p_a: string; p_b: string; p_family_id: string; p_kind: string }
        Returns: undefined
      }
      tree_add_parent: {
        Args: { p_child: string; p_family_id: string; p_parent: string }
        Returns: undefined
      }
      tree_check_details: {
        Args: { p_birth_date: string; p_display_name: string; p_gender: string }
        Returns: undefined
      }
      tree_connect: {
        Args: {
          p_family_id: string
          p_other_parent: string
          p_person: string
          p_relation: string
          p_relative: string
        }
        Returns: undefined
      }
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
      update_family_person: {
        Args: {
          p_birth_date?: string
          p_display_name: string
          p_gender?: string
          p_person_id: string
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
