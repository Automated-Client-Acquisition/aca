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
      ab_test_assignments: {
        Row: {
          assigned_at: string | null
          id: string
          test_id: string
          variant_key: string
          visitor_id: string
        }
        Insert: {
          assigned_at?: string | null
          id?: string
          test_id: string
          variant_key: string
          visitor_id: string
        }
        Update: {
          assigned_at?: string | null
          id?: string
          test_id?: string
          variant_key?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ab_test_assignments_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_test_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "ab_test_assignments_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_test_variants: {
        Row: {
          content_overrides: Json
          conversions: number | null
          created_at: string | null
          id: string
          revenue_cents: number | null
          test_id: string
          variant_key: string
          views: number | null
        }
        Insert: {
          content_overrides: Json
          conversions?: number | null
          created_at?: string | null
          id?: string
          revenue_cents?: number | null
          test_id: string
          variant_key: string
          views?: number | null
        }
        Update: {
          content_overrides?: Json
          conversions?: number | null
          created_at?: string | null
          id?: string
          revenue_cents?: number | null
          test_id?: string
          variant_key?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ab_test_variants_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_test_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "ab_test_variants_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_tests: {
        Row: {
          created_at: string | null
          ended_at: string | null
          funnel_id: string
          id: string
          name: string
          page_id: string
          started_at: string | null
          status: string | null
          traffic_split: Json
          winning_variant: string | null
        }
        Insert: {
          created_at?: string | null
          ended_at?: string | null
          funnel_id: string
          id?: string
          name: string
          page_id: string
          started_at?: string | null
          status?: string | null
          traffic_split: Json
          winning_variant?: string | null
        }
        Update: {
          created_at?: string | null
          ended_at?: string | null
          funnel_id?: string
          id?: string
          name?: string
          page_id?: string
          started_at?: string | null
          status?: string | null
          traffic_split?: Json
          winning_variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ab_tests_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "ab_tests_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_tests_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "funnel_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      account_action_cooldowns: {
        Row: {
          account_id: string
          channel: Database["public"]["Enums"]["crm_channel_type"]
          cooldown_until: string
          id: string
          last_action_at: string
          organization_id: string
        }
        Insert: {
          account_id: string
          channel: Database["public"]["Enums"]["crm_channel_type"]
          cooldown_until: string
          id?: string
          last_action_at?: string
          organization_id: string
        }
        Update: {
          account_id?: string
          channel?: Database["public"]["Enums"]["crm_channel_type"]
          cooldown_until?: string
          id?: string
          last_action_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_action_cooldowns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_clicks: {
        Row: {
          click_id: string
          created_at: string | null
          fbc: string | null
          fbp: string | null
          funnel_id: string | null
          id: string
          landing_url: string | null
          platform: string
          ttp: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          click_id: string
          created_at?: string | null
          fbc?: string | null
          fbp?: string | null
          funnel_id?: string | null
          id?: string
          landing_url?: string | null
          platform: string
          ttp?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          click_id?: string
          created_at?: string | null
          fbc?: string | null
          fbp?: string | null
          funnel_id?: string | null
          id?: string
          landing_url?: string | null
          platform?: string
          ttp?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_clicks_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "ad_clicks_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_action_logs: {
        Row: {
          action_type: string
          admin_user_id: string
          created_at: string | null
          id: string
          ip_address: string | null
          new_value: Json | null
          notes: string | null
          previous_value: Json | null
          target_organization_id: string | null
          target_organization_name: string
        }
        Insert: {
          action_type: string
          admin_user_id: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          notes?: string | null
          previous_value?: Json | null
          target_organization_id?: string | null
          target_organization_name: string
        }
        Update: {
          action_type?: string
          admin_user_id?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          notes?: string | null
          previous_value?: Json | null
          target_organization_id?: string | null
          target_organization_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_logs_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_profiles: {
        Row: {
          config: Json
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chatbot_conversations: {
        Row: {
          campaign_id: string
          conversation_history: Json | null
          created_at: string | null
          crm_conversation_id: string | null
          handoff_at: string | null
          handoff_notified: boolean | null
          handoff_reason: string | null
          id: string
          last_ai_response_at: string | null
          lead_context: Json | null
          lead_id: string
          max_turns: number | null
          organization_id: string
          status: string | null
          system_prompt: string
          total_cost: number | null
          total_input_tokens: number | null
          total_output_tokens: number | null
          turn_count: number | null
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          conversation_history?: Json | null
          created_at?: string | null
          crm_conversation_id?: string | null
          handoff_at?: string | null
          handoff_notified?: boolean | null
          handoff_reason?: string | null
          id?: string
          last_ai_response_at?: string | null
          lead_context?: Json | null
          lead_id: string
          max_turns?: number | null
          organization_id: string
          status?: string | null
          system_prompt: string
          total_cost?: number | null
          total_input_tokens?: number | null
          total_output_tokens?: number | null
          turn_count?: number | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          conversation_history?: Json | null
          created_at?: string | null
          crm_conversation_id?: string | null
          handoff_at?: string | null
          handoff_notified?: boolean | null
          handoff_reason?: string | null
          id?: string
          last_ai_response_at?: string | null
          lead_context?: Json | null
          lead_id?: string
          max_turns?: number | null
          organization_id?: string
          status?: string | null
          system_prompt?: string
          total_cost?: number | null
          total_input_tokens?: number | null
          total_output_tokens?: number | null
          turn_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chatbot_conversations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "ai_chatbot_conversations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chatbot_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unipile_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chatbot_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_sync_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          models_added: number | null
          models_deactivated: number | null
          models_fetched: number | null
          models_updated: number | null
          provider: string
          status: string | null
          sync_completed_at: string | null
          sync_started_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          models_added?: number | null
          models_deactivated?: number | null
          models_fetched?: number | null
          models_updated?: number | null
          provider: string
          status?: string | null
          sync_completed_at?: string | null
          sync_started_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          models_added?: number | null
          models_deactivated?: number | null
          models_fetched?: number | null
          models_updated?: number | null
          provider?: string
          status?: string | null
          sync_completed_at?: string | null
          sync_started_at?: string | null
        }
        Relationships: []
      }
      ai_models: {
        Row: {
          capabilities: Json | null
          categories: string[] | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          display_name: string
          first_seen_at: string | null
          id: string
          input_types: string[] | null
          is_active: boolean | null
          is_curated: boolean | null
          is_featured: boolean | null
          last_seen_at: string | null
          last_verified_at: string | null
          model_id: string
          name: string
          normalized_capabilities: Json | null
          output_type: string | null
          owner: string | null
          popularity_score: number | null
          provider: string
          run_count: number | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          capabilities?: Json | null
          categories?: string[] | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name: string
          first_seen_at?: string | null
          id?: string
          input_types?: string[] | null
          is_active?: boolean | null
          is_curated?: boolean | null
          is_featured?: boolean | null
          last_seen_at?: string | null
          last_verified_at?: string | null
          model_id: string
          name: string
          normalized_capabilities?: Json | null
          output_type?: string | null
          owner?: string | null
          popularity_score?: number | null
          provider: string
          run_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          capabilities?: Json | null
          categories?: string[] | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string
          first_seen_at?: string | null
          id?: string
          input_types?: string[] | null
          is_active?: boolean | null
          is_curated?: boolean | null
          is_featured?: boolean | null
          last_seen_at?: string | null
          last_verified_at?: string | null
          model_id?: string
          name?: string
          normalized_capabilities?: Json | null
          output_type?: string | null
          owner?: string | null
          popularity_score?: number | null
          provider?: string
          run_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_sdr_queue: {
        Row: {
          action_type: string
          agent_decision: Json | null
          campaign_id: string | null
          completed_at: string | null
          contact_id: string
          created_at: string | null
          error_message: string | null
          id: string
          organization_id: string
          priority: number | null
          retry_count: number | null
          scheduled_for: string
          started_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          action_type: string
          agent_decision?: Json | null
          campaign_id?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          priority?: number | null
          retry_count?: number | null
          scheduled_for?: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          action_type?: string
          agent_decision?: Json | null
          campaign_id?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          priority?: number | null
          retry_count?: number | null
          scheduled_for?: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_sdr_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sdr_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sdr_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sdr_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_sdr_sessions: {
        Row: {
          actions_taken: number | null
          completed_at: string | null
          config: Json | null
          created_at: string | null
          errors: number | null
          id: string
          leads_processed: number | null
          meetings_booked: number | null
          organization_id: string
          replies_handled: number | null
          run_type: string
          started_at: string | null
          status: string | null
          summary: string | null
        }
        Insert: {
          actions_taken?: number | null
          completed_at?: string | null
          config?: Json | null
          created_at?: string | null
          errors?: number | null
          id?: string
          leads_processed?: number | null
          meetings_booked?: number | null
          organization_id: string
          replies_handled?: number | null
          run_type: string
          started_at?: string | null
          status?: string | null
          summary?: string | null
        }
        Update: {
          actions_taken?: number | null
          completed_at?: string | null
          config?: Json | null
          created_at?: string | null
          errors?: number | null
          id?: string
          leads_processed?: number | null
          meetings_booked?: number | null
          organization_id?: string
          replies_handled?: number | null
          run_type?: string
          started_at?: string | null
          status?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_sdr_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_concurrency_slots: {
        Row: {
          acquired_at: string
          expires_at: string
          id: string
          organization_id: string
          slot_key: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          id?: string
          organization_id: string
          slot_key: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          slot_key?: string
        }
        Relationships: []
      }
      api_access_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          permissions: string[] | null
          target_organization_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          permissions?: string[] | null
          target_organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          permissions?: string[] | null
          target_organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_access_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "api_access_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_access_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_access_keys_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          capability: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          inherited_from_organization_id: string | null
          is_valid: boolean | null
          key_encrypted: string
          key_hint: string | null
          last_validated: string | null
          metadata: Json | null
          model: string | null
          organization_id: string
          provider: string
          updated_at: string | null
          usage_limit: number | null
          usage_this_month: number | null
        }
        Insert: {
          capability?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inherited_from_organization_id?: string | null
          is_valid?: boolean | null
          key_encrypted: string
          key_hint?: string | null
          last_validated?: string | null
          metadata?: Json | null
          model?: string | null
          organization_id: string
          provider: string
          updated_at?: string | null
          usage_limit?: number | null
          usage_this_month?: number | null
        }
        Update: {
          capability?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inherited_from_organization_id?: string | null
          is_valid?: boolean | null
          key_encrypted?: string
          key_hint?: string | null
          last_validated?: string | null
          metadata?: Json | null
          model?: string | null
          organization_id?: string
          provider?: string
          updated_at?: string | null
          usage_limit?: number | null
          usage_this_month?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_inherited_from_organization_id_fkey"
            columns: ["inherited_from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          bucket_key: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          last_used_ip: unknown
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_logs: {
        Row: {
          cost_estimate: number | null
          created_at: string | null
          endpoint: string | null
          error_message: string | null
          id: string
          organization_id: string
          provider: string
          response_time_ms: number | null
          status: string | null
          tokens_used: number | null
          video_id: string | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          provider: string
          response_time_ms?: number | null
          status?: string | null
          tokens_used?: number | null
          video_id?: string | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          provider?: string
          response_time_ms?: number | null
          status?: string | null
          tokens_used?: number | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      apify_leads_import_jobs: {
        Row: {
          batch_size: number
          batches: Json | null
          completed_at: string | null
          created_at: string | null
          current_batch: number | null
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          is_scheduled_run: boolean | null
          metadata: Json | null
          organization_id: string
          progress: number | null
          schedule_id: string | null
          search_config: Json
          started_at: string | null
          status: string
          target_list_id: string
          total_batches: number | null
          total_found: number | null
          total_imported: number | null
          total_requested: number
          total_skipped: number | null
        }
        Insert: {
          batch_size?: number
          batches?: Json | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          is_scheduled_run?: boolean | null
          metadata?: Json | null
          organization_id: string
          progress?: number | null
          schedule_id?: string | null
          search_config: Json
          started_at?: string | null
          status?: string
          target_list_id: string
          total_batches?: number | null
          total_found?: number | null
          total_imported?: number | null
          total_requested: number
          total_skipped?: number | null
        }
        Update: {
          batch_size?: number
          batches?: Json | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          is_scheduled_run?: boolean | null
          metadata?: Json | null
          organization_id?: string
          progress?: number | null
          schedule_id?: string | null
          search_config?: Json
          started_at?: string | null
          status?: string
          target_list_id?: string
          total_batches?: number | null
          total_found?: number | null
          total_imported?: number | null
          total_requested?: number
          total_skipped?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "apify_leads_import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_leads_import_jobs_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      apify_leads_import_schedules: {
        Row: {
          batch_size: number | null
          created_at: string | null
          frequency: string
          id: string
          is_active: boolean | null
          last_job_id: string | null
          last_run_at: string | null
          name: string
          next_run_at: string | null
          organization_id: string
          search_config: Json
          target_list_id: string | null
          total_requested: number | null
          updated_at: string | null
        }
        Insert: {
          batch_size?: number | null
          created_at?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_job_id?: string | null
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          organization_id: string
          search_config: Json
          target_list_id?: string | null
          total_requested?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_size?: number | null
          created_at?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_job_id?: string | null
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          organization_id?: string
          search_config?: Json
          target_list_id?: string | null
          total_requested?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apify_leads_import_schedules_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "apify_leads_import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_leads_import_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_leads_import_schedules_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      ats_boards: {
        Row: {
          active: boolean
          board_url: string | null
          company_identity_id: string | null
          consecutive_failures: number
          created_at: string
          discovered_via: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_job_count: number | null
          provider: string
          token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          board_url?: string | null
          company_identity_id?: string | null
          consecutive_failures?: number
          created_at?: string
          discovered_via?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_job_count?: number | null
          provider: string
          token: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          board_url?: string | null
          company_identity_id?: string | null
          consecutive_failures?: number
          created_at?: string
          discovered_via?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_job_count?: number | null
          provider?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ats_boards_company_identity_id_fkey"
            columns: ["company_identity_id"]
            isOneToOne: false
            referencedRelation: "company_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      ats_job_snapshots: {
        Row: {
          board_id: string
          captured_at: string
          id: string
          job_count: number
          job_ids: string[]
          meta: Json
          new_job_ids: string[]
        }
        Insert: {
          board_id: string
          captured_at?: string
          id?: string
          job_count: number
          job_ids?: string[]
          meta?: Json
          new_job_ids?: string[]
        }
        Update: {
          board_id?: string
          captured_at?: string
          id?: string
          job_count?: number
          job_ids?: string[]
          meta?: Json
          new_job_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "ats_job_snapshots_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "ats_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          autopilot_id: string | null
          created_at: string | null
          details: Json | null
          event_type: string
          id: string
          job_id: string | null
          output_id: string | null
          stage_id: string | null
        }
        Insert: {
          autopilot_id?: string | null
          created_at?: string | null
          details?: Json | null
          event_type: string
          id?: string
          job_id?: string | null
          output_id?: string | null
          stage_id?: string | null
        }
        Update: {
          autopilot_id?: string | null
          created_at?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          job_id?: string | null
          output_id?: string | null
          stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "automation_logs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "content_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_folders: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_idea_pools: {
        Row: {
          added_by: string | null
          attempt_count: number
          autopilot_id: string
          blueprint_id: string | null
          can_recycle: boolean
          created_at: string
          error_message: string | null
          id: string
          idea_id: string
          job_id: string | null
          last_attempt_at: string | null
          last_recycled_at: string | null
          metadata: Json | null
          organization_id: string
          output_id: string | null
          priority: number | null
          produced_at: string | null
          recycle_count: number
          status: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          attempt_count?: number
          autopilot_id: string
          blueprint_id?: string | null
          can_recycle?: boolean
          created_at?: string
          error_message?: string | null
          id?: string
          idea_id: string
          job_id?: string | null
          last_attempt_at?: string | null
          last_recycled_at?: string | null
          metadata?: Json | null
          organization_id: string
          output_id?: string | null
          priority?: number | null
          produced_at?: string | null
          recycle_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          attempt_count?: number
          autopilot_id?: string
          blueprint_id?: string | null
          can_recycle?: boolean
          created_at?: string
          error_message?: string | null
          id?: string
          idea_id?: string
          job_id?: string | null
          last_attempt_at?: string | null
          last_recycled_at?: string | null
          metadata?: Json | null
          organization_id?: string
          output_id?: string | null
          priority?: number | null
          produced_at?: string | null
          recycle_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_idea_pools_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "content_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_idea_pools_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilots: {
        Row: {
          auto_reload_pool: boolean | null
          content_mix: Json
          created_at: string | null
          created_by: string | null
          destinations: Json
          evergreen: Json | null
          folder_id: string | null
          frequency: Json
          id: string
          ideas_source: string | null
          last_run_at: string | null
          name: string
          next_run_at: string | null
          only_approved_ideas: boolean
          organization_id: string
          pool_mode: string | null
          pool_reload_threshold: number | null
          paused_at: string | null
          paused_reason: string | null
          scheduled_times: string[] | null
          scheduled_days: number[] | null
          schedule_slots: Json | null
          scheduling_mode: string | null
          shared_idea_tags: string[] | null
          status: string | null
          timezone: string | null
          total_generated: number | null
          total_published: number | null
          updated_at: string | null
        }
        Insert: {
          auto_reload_pool?: boolean | null
          content_mix?: Json
          created_at?: string | null
          created_by?: string | null
          destinations?: Json
          evergreen?: Json | null
          folder_id?: string | null
          frequency?: Json
          id?: string
          ideas_source?: string | null
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          only_approved_ideas?: boolean
          organization_id: string
          pool_mode?: string | null
          pool_reload_threshold?: number | null
          paused_at?: string | null
          paused_reason?: string | null
          scheduled_times?: string[] | null
          scheduled_days?: number[] | null
          schedule_slots?: Json | null
          scheduling_mode?: string | null
          shared_idea_tags?: string[] | null
          status?: string | null
          timezone?: string | null
          total_generated?: number | null
          total_published?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_reload_pool?: boolean | null
          content_mix?: Json
          created_at?: string | null
          created_by?: string | null
          destinations?: Json
          evergreen?: Json | null
          folder_id?: string | null
          frequency?: Json
          id?: string
          ideas_source?: string | null
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          only_approved_ideas?: boolean
          organization_id?: string
          pool_mode?: string | null
          pool_reload_threshold?: number | null
          paused_at?: string | null
          paused_reason?: string | null
          scheduled_times?: string[] | null
          scheduled_days?: number[] | null
          schedule_slots?: Json | null
          scheduling_mode?: string | null
          shared_idea_tags?: string[] | null
          status?: string | null
          timezone?: string | null
          total_generated?: number | null
          total_published?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilots_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "autopilot_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      azure_subscriptions: {
        Row: {
          active_mailboxes: number | null
          azure_tenant_id: string | null
          burned_domains: number | null
          client_id: string
          client_secret_encrypted: string
          created_at: string | null
          display_name: string | null
          health_score: number | null
          healthy_domains: number | null
          id: string
          last_error: string | null
          last_validated_at: string | null
          metadata: Json | null
          organization_id: string
          region: string | null
          resource_group: string | null
          status: string | null
          subscription_id: string
          tenant_id: string
          total_domains: number | null
          total_mailboxes: number | null
          updated_at: string | null
        }
        Insert: {
          active_mailboxes?: number | null
          azure_tenant_id?: string | null
          burned_domains?: number | null
          client_id: string
          client_secret_encrypted: string
          created_at?: string | null
          display_name?: string | null
          health_score?: number | null
          healthy_domains?: number | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          organization_id: string
          region?: string | null
          resource_group?: string | null
          status?: string | null
          subscription_id: string
          tenant_id: string
          total_domains?: number | null
          total_mailboxes?: number | null
          updated_at?: string | null
        }
        Update: {
          active_mailboxes?: number | null
          azure_tenant_id?: string | null
          burned_domains?: number | null
          client_id?: string
          client_secret_encrypted?: string
          created_at?: string | null
          display_name?: string | null
          health_score?: number | null
          healthy_domains?: number | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          organization_id?: string
          region?: string | null
          resource_group?: string | null
          status?: string | null
          subscription_id?: string
          tenant_id?: string
          total_domains?: number | null
          total_mailboxes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "azure_subscriptions_azure_tenant_id_fkey"
            columns: ["azure_tenant_id"]
            isOneToOne: false
            referencedRelation: "azure_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "azure_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      azure_tenants: {
        Row: {
          client_id: string
          client_secret_encrypted: string
          created_at: string | null
          display_name: string | null
          id: string
          last_error: string | null
          last_validated_at: string | null
          metadata: Json | null
          organization_id: string
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          client_secret_encrypted: string
          created_at?: string | null
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          organization_id: string
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          client_secret_encrypted?: string
          created_at?: string | null
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          organization_id?: string
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "azure_tenants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          cluster: string | null
          content: Json
          created_at: string | null
          description: string | null
          hero_image_url: string | null
          id: string
          notion_page_id: string | null
          page_type: string | null
          primary_keyword: string | null
          published_at: string | null
          slug: string
          title: string
        }
        Insert: {
          cluster?: string | null
          content: Json
          created_at?: string | null
          description?: string | null
          hero_image_url?: string | null
          id?: string
          notion_page_id?: string | null
          page_type?: string | null
          primary_keyword?: string | null
          published_at?: string | null
          slug: string
          title: string
        }
        Update: {
          cluster?: string | null
          content?: Json
          created_at?: string | null
          description?: string | null
          hero_image_url?: string | null
          id?: string
          notion_page_id?: string | null
          page_type?: string | null
          primary_keyword?: string | null
          published_at?: string | null
          slug?: string
          title?: string
        }
        Relationships: []
      }
      blueprint_folders: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprint_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprints: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          director_prompt: string | null
          folder_id: string | null
          id: string
          image_prompt: string | null
          image_prompt_template_id: string | null
          is_active: boolean | null
          is_demo: boolean | null
          is_master: boolean | null
          is_public: boolean | null
          master_prompt: string | null
          master_prompt_template_id: string | null
          model_config: Json | null
          name: string
          organization_id: string
          pipeline: string | null
          reference_image_libraries: string[] | null
          brief: Json | null
          context: Json | null
          skip_image_generation: boolean
          structure: Json | null
          tags: string[] | null
          updated_at: string
          usage_count: number | null
          version: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          director_prompt?: string | null
          folder_id?: string | null
          id?: string
          image_prompt?: string | null
          image_prompt_template_id?: string | null
          is_active?: boolean | null
          is_demo?: boolean | null
          is_master?: boolean | null
          is_public?: boolean | null
          master_prompt?: string | null
          master_prompt_template_id?: string | null
          model_config?: Json | null
          name: string
          organization_id: string
          pipeline?: string | null
          reference_image_libraries?: string[] | null
          brief?: Json | null
          context?: Json | null
          skip_image_generation?: boolean
          structure?: Json | null
          tags?: string[] | null
          updated_at?: string
          usage_count?: number | null
          version?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          director_prompt?: string | null
          folder_id?: string | null
          id?: string
          image_prompt?: string | null
          image_prompt_template_id?: string | null
          is_active?: boolean | null
          is_demo?: boolean | null
          is_master?: boolean | null
          is_public?: boolean | null
          master_prompt?: string | null
          master_prompt_template_id?: string | null
          model_config?: Json | null
          name?: string
          organization_id?: string
          pipeline?: string | null
          reference_image_libraries?: string[] | null
          brief?: Json | null
          context?: Json | null
          skip_image_generation?: boolean
          structure?: Json | null
          tags?: string[] | null
          updated_at?: string
          usage_count?: number | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blueprints_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "blueprint_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprints_image_prompt_template_id_fkey"
            columns: ["image_prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprints_master_prompt_template_id_fkey"
            columns: ["master_prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_generation_jobs: {
        Row: {
          actual_cost: number | null
          blueprint_mode: string
          completed_at: string | null
          completed_count: number | null
          created_at: string | null
          created_by: string | null
          error_count: number | null
          error_message: string | null
          estimated_completion_at: string | null
          estimated_cost: number | null
          failed_count: number | null
          id: string
          name: string | null
          optional_features: Json | null
          organization_id: string
          platform: string | null
          shared_blueprint_config: Json | null
          started_at: string | null
          status: string | null
          target_duration: number | null
          total_count: number
          updated_at: string | null
        }
        Insert: {
          actual_cost?: number | null
          blueprint_mode: string
          completed_at?: string | null
          completed_count?: number | null
          created_at?: string | null
          created_by?: string | null
          error_count?: number | null
          error_message?: string | null
          estimated_completion_at?: string | null
          estimated_cost?: number | null
          failed_count?: number | null
          id?: string
          name?: string | null
          optional_features?: Json | null
          organization_id: string
          platform?: string | null
          shared_blueprint_config?: Json | null
          started_at?: string | null
          status?: string | null
          target_duration?: number | null
          total_count: number
          updated_at?: string | null
        }
        Update: {
          actual_cost?: number | null
          blueprint_mode?: string
          completed_at?: string | null
          completed_count?: number | null
          created_at?: string | null
          created_by?: string | null
          error_count?: number | null
          error_message?: string | null
          estimated_completion_at?: string | null
          estimated_cost?: number | null
          failed_count?: number | null
          id?: string
          name?: string | null
          optional_features?: Json | null
          organization_id?: string
          platform?: string | null
          shared_blueprint_config?: Json | null
          started_at?: string | null
          status?: string | null
          target_duration?: number | null
          total_count?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_generation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_script_batches: {
        Row: {
          blueprint_id: string | null
          completed_at: string | null
          completed_count: number | null
          created_at: string | null
          error_message: string | null
          failed_count: number | null
          id: string
          model: string | null
          organization_id: string
          script_type: string
          started_at: string | null
          status: string
          target_duration: number | null
          total_scripts: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          blueprint_id?: string | null
          completed_at?: string | null
          completed_count?: number | null
          created_at?: string | null
          error_message?: string | null
          failed_count?: number | null
          id: string
          model?: string | null
          organization_id: string
          script_type: string
          started_at?: string | null
          status?: string
          target_duration?: number | null
          total_scripts: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          blueprint_id?: string | null
          completed_at?: string | null
          completed_count?: number | null
          created_at?: string | null
          error_message?: string | null
          failed_count?: number | null
          id?: string
          model?: string | null
          organization_id?: string
          script_type?: string
          started_at?: string | null
          status?: string
          target_duration?: number | null
          total_scripts?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_script_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_script_jobs: {
        Row: {
          batch_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          idea_id: string
          idea_title: string
          progress: number | null
          script_id: string | null
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          batch_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          idea_id: string
          idea_title: string
          progress?: number | null
          script_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          batch_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          idea_id?: string
          idea_title?: string
          progress?: number | null
          script_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_script_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bulk_script_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_script_jobs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      byo_server_ips: {
        Row: {
          blacklisted_on: Json
          created_at: string
          daily_send_limit: number
          daily_sent: number
          daily_sent_reset_at: string
          domain_id: string | null
          health_score: number
          id: string
          ip_address: unknown
          last_blacklist_check_at: string | null
          metadata: Json
          organization_id: string
          ptr_record: string | null
          ptr_verified: boolean
          server_id: string
          snds_last_status: string | null
          snds_registered_at: string | null
          status: string
          updated_at: string
          warmup_day: number
        }
        Insert: {
          blacklisted_on?: Json
          created_at?: string
          daily_send_limit?: number
          daily_sent?: number
          daily_sent_reset_at?: string
          domain_id?: string | null
          health_score?: number
          id?: string
          ip_address: unknown
          last_blacklist_check_at?: string | null
          metadata?: Json
          organization_id: string
          ptr_record?: string | null
          ptr_verified?: boolean
          server_id: string
          snds_last_status?: string | null
          snds_registered_at?: string | null
          status?: string
          updated_at?: string
          warmup_day?: number
        }
        Update: {
          blacklisted_on?: Json
          created_at?: string
          daily_send_limit?: number
          daily_sent?: number
          daily_sent_reset_at?: string
          domain_id?: string | null
          health_score?: number
          id?: string
          ip_address?: unknown
          last_blacklist_check_at?: string | null
          metadata?: Json
          organization_id?: string
          ptr_record?: string | null
          ptr_verified?: boolean
          server_id?: string
          snds_last_status?: string | null
          snds_registered_at?: string | null
          status?: string
          updated_at?: string
          warmup_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "byo_server_ips_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "byo_server_ips_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "byo_server_ips_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "byo_server_ips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "byo_server_ips_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "byo_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      byo_servers: {
        Row: {
          agent_secret_encrypted: string | null
          created_at: string
          deploy_state: Json
          dovecot_version: string | null
          hostname: string
          id: string
          jmrp_complaint_email: string | null
          last_error: string | null
          metadata: Json
          name: string
          opendkim_version: string | null
          organization_id: string
          port25_last_check_at: string | null
          port25_verified: boolean
          postfix_version: string | null
          provider_hint: string | null
          snds_data_url: string | null
          ssh_fingerprint: string | null
          ssh_host: string
          ssh_port: number
          ssh_private_key_encrypted: string | null
          ssh_public_key: string | null
          ssh_username: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_secret_encrypted?: string | null
          created_at?: string
          deploy_state?: Json
          dovecot_version?: string | null
          hostname: string
          id?: string
          jmrp_complaint_email?: string | null
          last_error?: string | null
          metadata?: Json
          name: string
          opendkim_version?: string | null
          organization_id: string
          port25_last_check_at?: string | null
          port25_verified?: boolean
          postfix_version?: string | null
          provider_hint?: string | null
          snds_data_url?: string | null
          ssh_fingerprint?: string | null
          ssh_host: string
          ssh_port?: number
          ssh_private_key_encrypted?: string | null
          ssh_public_key?: string | null
          ssh_username?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_secret_encrypted?: string | null
          created_at?: string
          deploy_state?: Json
          dovecot_version?: string | null
          hostname?: string
          id?: string
          jmrp_complaint_email?: string | null
          last_error?: string | null
          metadata?: Json
          name?: string
          opendkim_version?: string | null
          organization_id?: string
          port25_last_check_at?: string | null
          port25_verified?: boolean
          postfix_version?: string | null
          provider_hint?: string | null
          snds_data_url?: string | null
          ssh_fingerprint?: string | null
          ssh_host?: string
          ssh_port?: number
          ssh_private_key_encrypted?: string | null
          ssh_public_key?: string | null
          ssh_username?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "byo_servers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_accounts: {
        Row: {
          created_at: string | null
          email: string
          error_message: string | null
          id: string
          last_sync_at: string | null
          name: string | null
          organization_id: string
          provider: string
          status: string
          unipile_account_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          name?: string | null
          organization_id: string
          provider: string
          status?: string
          unipile_account_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          name?: string | null
          organization_id?: string
          provider?: string
          status?: string
          unipile_account_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_event_attendees: {
        Row: {
          contact_id: string | null
          created_at: string | null
          email: string
          event_id: string
          id: string
          is_optional: boolean
          is_organizer: boolean
          name: string | null
          response_status: string
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          email: string
          event_id: string
          id?: string
          is_optional?: boolean
          is_organizer?: boolean
          name?: string | null
          response_status?: string
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          email?: string
          event_id?: string
          id?: string
          is_optional?: boolean
          is_organizer?: boolean
          name?: string | null
          response_status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_event_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_attendees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          body: string | null
          calendar_account_id: string
          campaign_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          conference_provider: string | null
          conference_url: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string
          created_by_user_id: string | null
          end_time: string
          id: string
          is_all_day: boolean
          last_sync_at: string | null
          lead_progress_id: string | null
          location: string | null
          organization_id: string
          start_time: string
          status: string
          sync_error: string | null
          sync_status: string
          template_id: string | null
          timezone: string
          title: string
          unipile_calendar_id: string
          unipile_event_id: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          calendar_account_id: string
          campaign_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          conference_provider?: string | null
          conference_url?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string
          created_by_user_id?: string | null
          end_time: string
          id?: string
          is_all_day?: boolean
          last_sync_at?: string | null
          lead_progress_id?: string | null
          location?: string | null
          organization_id: string
          start_time: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          template_id?: string | null
          timezone?: string
          title: string
          unipile_calendar_id: string
          unipile_event_id?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          calendar_account_id?: string
          campaign_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          conference_provider?: string | null
          conference_url?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string
          created_by_user_id?: string | null
          end_time?: string
          id?: string
          is_all_day?: boolean
          last_sync_at?: string | null
          lead_progress_id?: string | null
          location?: string | null
          organization_id?: string
          start_time?: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          template_id?: string | null
          timezone?: string
          title?: string
          unipile_calendar_id?: string
          unipile_event_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_calendar_account_id_fkey"
            columns: ["calendar_account_id"]
            isOneToOne: false
            referencedRelation: "calendar_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_lead_progress_id_fkey"
            columns: ["lead_progress_id"]
            isOneToOne: false
            referencedRelation: "campaign_lead_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "meeting_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_preferences: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          created_at: string | null
          default_conference_provider: string | null
          default_duration_minutes: number
          default_timezone: string
          id: string
          organization_id: string
          updated_at: string | null
          working_hours: Json | null
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string | null
          default_conference_provider?: string | null
          default_duration_minutes?: number
          default_timezone?: string
          id?: string
          organization_id: string
          updated_at?: string | null
          working_hours?: Json | null
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string | null
          default_conference_provider?: string | null
          default_duration_minutes?: number
          default_timezone?: string
          id?: string
          organization_id?: string
          updated_at?: string | null
          working_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_action_log: {
        Row: {
          action_type: string
          ai_generated: boolean | null
          campaign_id: string
          channel: string | null
          contact_id: string
          created_at: string | null
          error_message: string | null
          executed_at: string | null
          external_id: string | null
          id: string
          message_content: string | null
          node_id: string
          node_type: string
          progress_id: string
          prompt_template: string | null
          sender_account_id: string | null
          status: string | null
          variation_index: number | null
        }
        Insert: {
          action_type: string
          ai_generated?: boolean | null
          campaign_id: string
          channel?: string | null
          contact_id: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          external_id?: string | null
          id?: string
          message_content?: string | null
          node_id: string
          node_type: string
          progress_id: string
          prompt_template?: string | null
          sender_account_id?: string | null
          status?: string | null
          variation_index?: number | null
        }
        Update: {
          action_type?: string
          ai_generated?: boolean | null
          campaign_id?: string
          channel?: string | null
          contact_id?: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          external_id?: string | null
          id?: string
          message_content?: string | null
          node_id?: string
          node_type?: string
          progress_id?: string
          prompt_template?: string | null
          sender_account_id?: string | null
          status?: string | null
          variation_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_action_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_action_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_action_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_action_log_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "campaign_lead_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_action_log_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_analytics: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          connections_accepted: number | null
          connections_sent: number | null
          created_at: string | null
          date: string
          follows: number | null
          id: string
          inmails_replied: number | null
          inmails_sent: number | null
          messages_replied: number | null
          messages_sent: number | null
          organization_id: string
          post_likes: number | null
          profile_views: number | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          campaign_id?: string | null
          connections_accepted?: number | null
          connections_sent?: number | null
          created_at?: string | null
          date?: string
          follows?: number | null
          id?: string
          inmails_replied?: number | null
          inmails_sent?: number | null
          messages_replied?: number | null
          messages_sent?: number | null
          organization_id: string
          post_likes?: number | null
          profile_views?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          campaign_id?: string | null
          connections_accepted?: number | null
          connections_sent?: number | null
          created_at?: string | null
          date?: string
          follows?: number | null
          id?: string
          inmails_replied?: number | null
          inmails_sent?: number | null
          messages_replied?: number | null
          messages_sent?: number | null
          organization_id?: string
          post_likes?: number | null
          profile_views?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_analytics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_analytics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_knowledge_documents: {
        Row: {
          campaign_id: string
          created_at: string | null
          document_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          document_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_knowledge_documents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_knowledge_documents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_knowledge_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_lead_progress: {
        Row: {
          campaign_id: string
          channel_attempts: Json | null
          channel_used: string | null
          condition_entered_at: string | null
          connection_accepted_at: string | null
          connection_sent_at: string | null
          contact_id: string
          contact_identity_id: string | null
          created_at: string | null
          crm_conversation_id: string | null
          current_node_id: string | null
          error_message: string | null
          generated_data: Json | null
          id: string
          intent_classified_at: string | null
          intent_confidence: number | null
          is_test_contact: boolean | null
          last_message_at: string | null
          lead_intent: string | null
          next_action_at: string | null
          replied_at: string | null
          retry_count: number | null
          sender_account_id: string | null
          status: string | null
          updated_at: string | null
          variation_index: number | null
        }
        Insert: {
          campaign_id: string
          channel_attempts?: Json | null
          channel_used?: string | null
          condition_entered_at?: string | null
          connection_accepted_at?: string | null
          connection_sent_at?: string | null
          contact_id: string
          contact_identity_id?: string | null
          created_at?: string | null
          crm_conversation_id?: string | null
          current_node_id?: string | null
          error_message?: string | null
          generated_data?: Json | null
          id?: string
          intent_classified_at?: string | null
          intent_confidence?: number | null
          is_test_contact?: boolean | null
          last_message_at?: string | null
          lead_intent?: string | null
          next_action_at?: string | null
          replied_at?: string | null
          retry_count?: number | null
          sender_account_id?: string | null
          status?: string | null
          updated_at?: string | null
          variation_index?: number | null
        }
        Update: {
          campaign_id?: string
          channel_attempts?: Json | null
          channel_used?: string | null
          condition_entered_at?: string | null
          connection_accepted_at?: string | null
          connection_sent_at?: string | null
          contact_id?: string
          contact_identity_id?: string | null
          created_at?: string | null
          crm_conversation_id?: string | null
          current_node_id?: string | null
          error_message?: string | null
          generated_data?: Json | null
          id?: string
          intent_classified_at?: string | null
          intent_confidence?: number | null
          is_test_contact?: boolean | null
          last_message_at?: string | null
          lead_intent?: string | null
          next_action_at?: string | null
          replied_at?: string | null
          retry_count?: number | null
          sender_account_id?: string | null
          status?: string | null
          updated_at?: string | null
          variation_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_lead_progress_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_lead_progress_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_lead_progress_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_lead_progress_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          actual_cost: number | null
          approval_workflow: Json | null
          auto_publish: boolean | null
          campaign_type: string
          channel_fallback_enabled: boolean | null
          channel_metrics: Json | null
          completed_at: string | null
          completed_videos: number | null
          content_sources: Json | null
          content_strategy: Json | null
          content_types: string[] | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimated_cost: number | null
          failed_videos: number | null
          fallback_order: string[] | null
          id: string
          is_active: boolean | null
          is_farm_campaign: boolean | null
          last_content_check: string | null
          library_config: Json | null
          multiplication_rules: Json | null
          name: string
          next_scheduled_run: string | null
          organization_id: string
          performance_target: Json | null
          primary_channel: string | null
          production_method: string | null
          publishing_platforms: string[] | null
          publishing_schedule: Json | null
          schedule_config: Json | null
          sender_accounts: Json | null
          started_at: string | null
          status: string | null
          template_id: string | null
          topics: string[] | null
          total_videos: number | null
          type: string
          updated_at: string | null
          videos_per_topic: number | null
          volume_targets: Json | null
        }
        Insert: {
          actual_cost?: number | null
          approval_workflow?: Json | null
          auto_publish?: boolean | null
          campaign_type?: string
          channel_fallback_enabled?: boolean | null
          channel_metrics?: Json | null
          completed_at?: string | null
          completed_videos?: number | null
          content_sources?: Json | null
          content_strategy?: Json | null
          content_types?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          failed_videos?: number | null
          fallback_order?: string[] | null
          id?: string
          is_active?: boolean | null
          is_farm_campaign?: boolean | null
          last_content_check?: string | null
          library_config?: Json | null
          multiplication_rules?: Json | null
          name: string
          next_scheduled_run?: string | null
          organization_id: string
          performance_target?: Json | null
          primary_channel?: string | null
          production_method?: string | null
          publishing_platforms?: string[] | null
          publishing_schedule?: Json | null
          schedule_config?: Json | null
          sender_accounts?: Json | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          topics?: string[] | null
          total_videos?: number | null
          type: string
          updated_at?: string | null
          videos_per_topic?: number | null
          volume_targets?: Json | null
        }
        Update: {
          actual_cost?: number | null
          approval_workflow?: Json | null
          auto_publish?: boolean | null
          campaign_type?: string
          channel_fallback_enabled?: boolean | null
          channel_metrics?: Json | null
          completed_at?: string | null
          completed_videos?: number | null
          content_sources?: Json | null
          content_strategy?: Json | null
          content_types?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          failed_videos?: number | null
          fallback_order?: string[] | null
          id?: string
          is_active?: boolean | null
          is_farm_campaign?: boolean | null
          last_content_check?: string | null
          library_config?: Json | null
          multiplication_rules?: Json | null
          name?: string
          next_scheduled_run?: string | null
          organization_id?: string
          performance_target?: Json | null
          primary_channel?: string | null
          production_method?: string | null
          publishing_platforms?: string[] | null
          publishing_schedule?: Json | null
          schedule_config?: Json | null
          sender_accounts?: Json | null
          started_at?: string | null
          status?: string | null
          template_id?: string | null
          topics?: string[] | null
          total_videos?: number | null
          type?: string
          updated_at?: string | null
          videos_per_topic?: number | null
          volume_targets?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_limit_definitions: {
        Row: {
          absolute_max_daily: number
          absolute_max_hourly: number
          brand_color: string | null
          business_hours_recommended: boolean | null
          channel: Database["public"]["Enums"]["crm_channel_type"]
          created_at: string | null
          description: string | null
          display_name: string
          faster_daily_limit: number
          icon: string | null
          id: string
          logo_url: string | null
          min_interval_seconds: number | null
          moderate_daily_limit: number
          risk_weight: number | null
          risky_daily_limit: number
          safe_daily_limit: number
          updated_at: string | null
          warmup_duration_days: number
          warmup_enabled: boolean | null
          warmup_increment_per_day: number
          warmup_start_limit: number
        }
        Insert: {
          absolute_max_daily?: number
          absolute_max_hourly?: number
          brand_color?: string | null
          business_hours_recommended?: boolean | null
          channel: Database["public"]["Enums"]["crm_channel_type"]
          created_at?: string | null
          description?: string | null
          display_name: string
          faster_daily_limit?: number
          icon?: string | null
          id?: string
          logo_url?: string | null
          min_interval_seconds?: number | null
          moderate_daily_limit?: number
          risk_weight?: number | null
          risky_daily_limit?: number
          safe_daily_limit?: number
          updated_at?: string | null
          warmup_duration_days?: number
          warmup_enabled?: boolean | null
          warmup_increment_per_day?: number
          warmup_start_limit?: number
        }
        Update: {
          absolute_max_daily?: number
          absolute_max_hourly?: number
          brand_color?: string | null
          business_hours_recommended?: boolean | null
          channel?: Database["public"]["Enums"]["crm_channel_type"]
          created_at?: string | null
          description?: string | null
          display_name?: string
          faster_daily_limit?: number
          icon?: string | null
          id?: string
          logo_url?: string | null
          min_interval_seconds?: number | null
          moderate_daily_limit?: number
          risk_weight?: number | null
          risky_daily_limit?: number
          safe_daily_limit?: number
          updated_at?: string | null
          warmup_duration_days?: number
          warmup_enabled?: boolean | null
          warmup_increment_per_day?: number
          warmup_start_limit?: number
        }
        Relationships: []
      }
      channel_limit_reports: {
        Row: {
          channels: Database["public"]["Enums"]["crm_channel_type"][] | null
          created_at: string | null
          date_range_days: number | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          show_risk_zones: boolean | null
          show_warmup: boolean | null
          updated_at: string | null
        }
        Insert: {
          channels?: Database["public"]["Enums"]["crm_channel_type"][] | null
          created_at?: string | null
          date_range_days?: number | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          show_risk_zones?: boolean | null
          show_warmup?: boolean | null
          updated_at?: string | null
        }
        Update: {
          channels?: Database["public"]["Enums"]["crm_channel_type"][] | null
          created_at?: string | null
          date_range_days?: number | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          show_risk_zones?: boolean | null
          show_warmup?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_limit_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_usage_tracking: {
        Row: {
          channel: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id: string | null
          clicks_tracked: number | null
          created_at: string | null
          effective_limit: number | null
          id: string
          messages_bounced: number | null
          messages_delivered: number | null
          messages_failed: number | null
          messages_sent: number | null
          opens_tracked: number | null
          organization_id: string
          period_date: string
          period_hour: number | null
          rate_limit_hits: number | null
          replies_received: number | null
          updated_at: string | null
          usage_percent: number | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id?: string | null
          clicks_tracked?: number | null
          created_at?: string | null
          effective_limit?: number | null
          id?: string
          messages_bounced?: number | null
          messages_delivered?: number | null
          messages_failed?: number | null
          messages_sent?: number | null
          opens_tracked?: number | null
          organization_id: string
          period_date?: string
          period_hour?: number | null
          rate_limit_hits?: number | null
          replies_received?: number | null
          updated_at?: string | null
          usage_percent?: number | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id?: string | null
          clicks_tracked?: number | null
          created_at?: string | null
          effective_limit?: number | null
          id?: string
          messages_bounced?: number | null
          messages_delivered?: number | null
          messages_failed?: number | null
          messages_sent?: number | null
          opens_tracked?: number | null
          organization_id?: string
          period_date?: string
          period_hour?: number | null
          rate_limit_hits?: number | null
          replies_received?: number | null
          updated_at?: string | null
          usage_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_usage_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_onboarding_templates: {
        Row: {
          agency_organization_id: string | null
          blueprints_to_copy: string[] | null
          brand_voices_to_copy: string[] | null
          characters_to_copy: string[] | null
          created_at: string | null
          description: string | null
          id: string
          identities_to_copy: string[] | null
          is_default: boolean | null
          name: string
          prompts_to_copy: string[] | null
          updated_at: string | null
        }
        Insert: {
          agency_organization_id?: string | null
          blueprints_to_copy?: string[] | null
          brand_voices_to_copy?: string[] | null
          characters_to_copy?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          identities_to_copy?: string[] | null
          is_default?: boolean | null
          name: string
          prompts_to_copy?: string[] | null
          updated_at?: string | null
        }
        Update: {
          agency_organization_id?: string | null
          blueprints_to_copy?: string[] | null
          brand_voices_to_copy?: string[] | null
          characters_to_copy?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          identities_to_copy?: string[] | null
          is_default?: boolean | null
          name?: string
          prompts_to_copy?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_onboarding_templates_agency_organization_id_fkey"
            columns: ["agency_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_settings: {
        Row: {
          auto_fill_calendar: boolean | null
          auto_multiply_enabled: boolean | null
          auto_publish_enabled: boolean | null
          brand_voice: string | null
          client_name: string | null
          client_type: string | null
          created_at: string | null
          cta_templates: Json | null
          daily_limit: number | null
          id: string
          keywords: string[] | null
          monthly_limit: number | null
          organization_id: string
          settings: Json | null
          target_platforms: string[] | null
          updated_at: string | null
        }
        Insert: {
          auto_fill_calendar?: boolean | null
          auto_multiply_enabled?: boolean | null
          auto_publish_enabled?: boolean | null
          brand_voice?: string | null
          client_name?: string | null
          client_type?: string | null
          created_at?: string | null
          cta_templates?: Json | null
          daily_limit?: number | null
          id?: string
          keywords?: string[] | null
          monthly_limit?: number | null
          organization_id: string
          settings?: Json | null
          target_platforms?: string[] | null
          updated_at?: string | null
        }
        Update: {
          auto_fill_calendar?: boolean | null
          auto_multiply_enabled?: boolean | null
          auto_publish_enabled?: boolean | null
          brand_voice?: string | null
          client_name?: string | null
          client_type?: string | null
          created_at?: string | null
          cta_templates?: Json | null
          daily_limit?: number | null
          id?: string
          keywords?: string[] | null
          monthly_limit?: number | null
          organization_id?: string
          settings?: Json | null
          target_platforms?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      company_analysis_jobs: {
        Row: {
          analyzed_count: number | null
          completed_at: string | null
          contact_ids: string[]
          created_at: string | null
          current_contact_name: string | null
          error_message: string | null
          failed_count: number | null
          icp_ids: string[] | null
          id: string
          include_already_analyzed: boolean | null
          model: string
          organization_id: string
          product_context: Json | null
          product_id: string | null
          progress: number | null
          results: Json | null
          skipped_count: number | null
          started_at: string | null
          status: string
          total_contacts: number | null
          unipile_account_id: string | null
        }
        Insert: {
          analyzed_count?: number | null
          completed_at?: string | null
          contact_ids: string[]
          created_at?: string | null
          current_contact_name?: string | null
          error_message?: string | null
          failed_count?: number | null
          icp_ids?: string[] | null
          id?: string
          include_already_analyzed?: boolean | null
          model?: string
          organization_id: string
          product_context?: Json | null
          product_id?: string | null
          progress?: number | null
          results?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          total_contacts?: number | null
          unipile_account_id?: string | null
        }
        Update: {
          analyzed_count?: number | null
          completed_at?: string | null
          contact_ids?: string[]
          created_at?: string | null
          current_contact_name?: string | null
          error_message?: string | null
          failed_count?: number | null
          icp_ids?: string[] | null
          id?: string
          include_already_analyzed?: boolean | null
          model?: string
          organization_id?: string
          product_context?: Json | null
          product_id?: string | null
          progress?: number | null
          results?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          total_contacts?: number | null
          unipile_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_analysis_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_analysis_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      company_identities: {
        Row: {
          aliases: string[]
          cik: string | null
          country: string | null
          created_at: string
          domain: string | null
          employee_count: number | null
          founded_year: number | null
          id: string
          industry: string | null
          last_resolution_error: string | null
          linkedin_url: string | null
          name: string
          name_normalized: string
          resolution_attempts: number
          resolution_claimed_by: string | null
          resolution_lease_until: string | null
          resolved_at: string | null
          resolved_via: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          aliases?: string[]
          cik?: string | null
          country?: string | null
          created_at?: string
          domain?: string | null
          employee_count?: number | null
          founded_year?: number | null
          id?: string
          industry?: string | null
          last_resolution_error?: string | null
          linkedin_url?: string | null
          name: string
          name_normalized: string
          resolution_attempts?: number
          resolution_claimed_by?: string | null
          resolution_lease_until?: string | null
          resolved_at?: string | null
          resolved_via?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          aliases?: string[]
          cik?: string | null
          country?: string | null
          created_at?: string
          domain?: string | null
          employee_count?: number | null
          founded_year?: number | null
          id?: string
          industry?: string | null
          last_resolution_error?: string | null
          linkedin_url?: string | null
          name?: string
          name_normalized?: string
          resolution_attempts?: number
          resolution_claimed_by?: string | null
          resolution_lease_until?: string | null
          resolved_at?: string | null
          resolved_via?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      contact_email_sequences: {
        Row: {
          campaign_id: string | null
          connection_id: string | null
          contact_id: string
          created_at: string | null
          email_count: number
          emails: Json
          error_message: string | null
          external_campaign_id: string | null
          generated_at: string | null
          generation_config: Json
          id: string
          knowledge_document_ids: string[] | null
          name: string | null
          node_config: Json | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          progress_id: string | null
          pushed_at: string | null
          pushed_to_tool: string | null
          status: string | null
          tool_type: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          connection_id?: string | null
          contact_id: string
          created_at?: string | null
          email_count?: number
          emails?: Json
          error_message?: string | null
          external_campaign_id?: string | null
          generated_at?: string | null
          generation_config?: Json
          id?: string
          knowledge_document_ids?: string[] | null
          name?: string | null
          node_config?: Json | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id: string
          progress_id?: string | null
          pushed_at?: string | null
          pushed_to_tool?: string | null
          status?: string | null
          tool_type?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          connection_id?: string | null
          contact_id?: string
          created_at?: string | null
          email_count?: number
          emails?: Json
          error_message?: string | null
          external_campaign_id?: string | null
          generated_at?: string | null
          generation_config?: Json
          id?: string
          knowledge_document_ids?: string[] | null
          name?: string | null
          node_config?: Json | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id?: string
          progress_id?: string | null
          pushed_at?: string | null
          pushed_to_tool?: string | null
          status?: string | null
          tool_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_email_sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_email_sequences_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_email_sequences_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_email_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_email_sequences_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "campaign_lead_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_product_scores: {
        Row: {
          analyzed_at: string | null
          contact_id: string
          created_at: string | null
          decision_maker_reasoning: string | null
          decision_maker_score: number | null
          decision_maker_source: string | null
          icp_score: number | null
          icp_score_reasoning: string | null
          id: string
          model: string | null
          organization_id: string
          primary_need: string | null
          primary_need_reasoning: string | null
          product_id: string
          selected_outcome: string | null
          updated_at: string | null
        }
        Insert: {
          analyzed_at?: string | null
          contact_id: string
          created_at?: string | null
          decision_maker_reasoning?: string | null
          decision_maker_score?: number | null
          decision_maker_source?: string | null
          icp_score?: number | null
          icp_score_reasoning?: string | null
          id?: string
          model?: string | null
          organization_id: string
          primary_need?: string | null
          primary_need_reasoning?: string | null
          product_id: string
          selected_outcome?: string | null
          updated_at?: string | null
        }
        Update: {
          analyzed_at?: string | null
          contact_id?: string
          created_at?: string | null
          decision_maker_reasoning?: string | null
          decision_maker_score?: number | null
          decision_maker_source?: string | null
          icp_score?: number | null
          icp_score_reasoning?: string | null
          id?: string
          model?: string | null
          organization_id?: string
          primary_need?: string | null
          primary_need_reasoning?: string | null
          product_id?: string
          selected_outcome?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_product_scores_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_product_scores_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_product_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_product_scores_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      content_batches: {
        Row: {
          batch_size: number
          campaign_id: string
          completed_at: string | null
          completed_count: number | null
          config: Json | null
          created_at: string | null
          error_log: Json | null
          failed_count: number | null
          generation_type: string
          id: string
          organization_id: string
          source_idea_ids: string[] | null
          source_keywords: string[] | null
          source_urls: string[] | null
          started_at: string | null
          status: string
          total_derivatives: number | null
        }
        Insert: {
          batch_size: number
          campaign_id: string
          completed_at?: string | null
          completed_count?: number | null
          config?: Json | null
          created_at?: string | null
          error_log?: Json | null
          failed_count?: number | null
          generation_type: string
          id?: string
          organization_id: string
          source_idea_ids?: string[] | null
          source_keywords?: string[] | null
          source_urls?: string[] | null
          started_at?: string | null
          status?: string
          total_derivatives?: number | null
        }
        Update: {
          batch_size?: number
          campaign_id?: string
          completed_at?: string | null
          completed_count?: number | null
          config?: Json | null
          created_at?: string | null
          error_log?: Json | null
          failed_count?: number | null
          generation_type?: string
          id?: string
          organization_id?: string
          source_idea_ids?: string[] | null
          source_keywords?: string[] | null
          source_urls?: string[] | null
          started_at?: string | null
          status?: string
          total_derivatives?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_batch_campaign"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      content_calendars: {
        Row: {
          auto_generated: boolean | null
          calendar_data: Json
          campaign_id: string
          created_at: string | null
          id: string
          last_updated_at: string | null
          month: number
          organization_id: string
          total_published: number | null
          total_scheduled: number | null
          year: number
        }
        Insert: {
          auto_generated?: boolean | null
          calendar_data?: Json
          campaign_id: string
          created_at?: string | null
          id?: string
          last_updated_at?: string | null
          month: number
          organization_id: string
          total_published?: number | null
          total_scheduled?: number | null
          year: number
        }
        Update: {
          auto_generated?: boolean | null
          calendar_data?: Json
          campaign_id?: string
          created_at?: string | null
          id?: string
          last_updated_at?: string | null
          month?: number
          organization_id?: string
          total_published?: number | null
          total_scheduled?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_calendars_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_calendar_campaign"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      content_creation_sessions: {
        Row: {
          abandoned_at: string | null
          ai_acceptance_rate: number | null
          ai_recommended_template_ids: string[] | null
          back_button_clicks: number | null
          completed_at: string | null
          created_at: string | null
          duration_seconds: number | null
          errors_encountered: Json | null
          generated_post_ids: string[] | null
          goal: string | null
          id: string
          identity_id: string | null
          organization_id: string
          selected_template_ids: string[] | null
          source_id: string | null
          source_type: string | null
          status: string | null
          steps_completed: number | null
          templates_completed: number | null
          templates_failed: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          abandoned_at?: string | null
          ai_acceptance_rate?: number | null
          ai_recommended_template_ids?: string[] | null
          back_button_clicks?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          errors_encountered?: Json | null
          generated_post_ids?: string[] | null
          goal?: string | null
          id?: string
          identity_id?: string | null
          organization_id: string
          selected_template_ids?: string[] | null
          source_id?: string | null
          source_type?: string | null
          status?: string | null
          steps_completed?: number | null
          templates_completed?: number | null
          templates_failed?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          abandoned_at?: string | null
          ai_acceptance_rate?: number | null
          ai_recommended_template_ids?: string[] | null
          back_button_clicks?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          errors_encountered?: Json | null
          generated_post_ids?: string[] | null
          goal?: string | null
          id?: string
          identity_id?: string | null
          organization_id?: string
          selected_template_ids?: string[] | null
          source_id?: string | null
          source_type?: string | null
          status?: string | null
          steps_completed?: number | null
          templates_completed?: number | null
          templates_failed?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_creation_sessions_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "library_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_creation_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_derivatives: {
        Row: {
          auto_generated: boolean | null
          batch_id: string | null
          campaign_id: string | null
          content_markdown: string | null
          content_text: string | null
          created_at: string | null
          derivative_type: string
          id: string
          media_urls: string[] | null
          metadata: Json | null
          organization_id: string
          parent_content_id: string
          platform: string
          publish_status: string | null
          published_at: string | null
          scheduled_time: string | null
          updated_at: string | null
        }
        Insert: {
          auto_generated?: boolean | null
          batch_id?: string | null
          campaign_id?: string | null
          content_markdown?: string | null
          content_text?: string | null
          created_at?: string | null
          derivative_type: string
          id?: string
          media_urls?: string[] | null
          metadata?: Json | null
          organization_id: string
          parent_content_id: string
          platform: string
          publish_status?: string | null
          published_at?: string | null
          scheduled_time?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_generated?: boolean | null
          batch_id?: string | null
          campaign_id?: string | null
          content_markdown?: string | null
          content_text?: string | null
          created_at?: string | null
          derivative_type?: string
          id?: string
          media_urls?: string[] | null
          metadata?: Json | null
          organization_id?: string
          parent_content_id?: string
          platform?: string
          publish_status?: string | null
          published_at?: string | null
          scheduled_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_derivatives_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "content_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_derivatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_derivative_batch"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "content_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_derivative_campaign"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      content_generation_jobs: {
        Row: {
          autopilot_id: string | null
          blueprint_id: string | null
          completed_at: string | null
          configuration: Json | null
          cost: Json
          created_at: string
          error: string | null
          id: string
          is_demo: boolean | null
          items: Json
          name: string | null
          organization_id: string
          pipeline: string
          progress: Json
          started_at: string | null
          status: string
          time_remaining: number | null
          user_id: string
          video_project_id: string | null
        }
        Insert: {
          autopilot_id?: string | null
          blueprint_id?: string | null
          completed_at?: string | null
          configuration?: Json | null
          cost?: Json
          created_at?: string
          error?: string | null
          id?: string
          is_demo?: boolean | null
          items?: Json
          name?: string | null
          organization_id: string
          pipeline: string
          progress?: Json
          started_at?: string | null
          status?: string
          time_remaining?: number | null
          user_id: string
          video_project_id?: string | null
        }
        Update: {
          autopilot_id?: string | null
          blueprint_id?: string | null
          completed_at?: string | null
          configuration?: Json | null
          cost?: Json
          created_at?: string
          error?: string | null
          id?: string
          is_demo?: boolean | null
          items?: Json
          name?: string | null
          organization_id?: string
          pipeline?: string
          progress?: Json
          started_at?: string | null
          status?: string
          time_remaining?: number | null
          user_id?: string
          video_project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_generation_jobs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "content_generation_jobs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_generation_jobs_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_generation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "content_generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_generation_jobs_video_project_id_fkey"
            columns: ["video_project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_ideas: {
        Row: {
          ai_analysis: Json | null
          brand_voice_id: string | null
          content_angle_id: string | null
          content_framework: string | null
          created_at: string | null
          emotional_triggers: string[] | null
          folder_id: string | null
          free_text: string | null
          generation_in_progress: boolean | null
          guidelines_approved_at: string | null
          guidelines_approved_by: string | null
          id: string
          is_demo: boolean | null
          keywords: string[] | null
          library_elements: Json | null
          metadata: Json | null
          organization_id: string
          product_id: string | null
          scripts_count: number | null
          source_urls: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          ai_analysis?: Json | null
          brand_voice_id?: string | null
          content_angle_id?: string | null
          content_framework?: string | null
          created_at?: string | null
          emotional_triggers?: string[] | null
          folder_id?: string | null
          free_text?: string | null
          generation_in_progress?: boolean | null
          guidelines_approved_at?: string | null
          guidelines_approved_by?: string | null
          id?: string
          is_demo?: boolean | null
          keywords?: string[] | null
          library_elements?: Json | null
          metadata?: Json | null
          organization_id: string
          product_id?: string | null
          scripts_count?: number | null
          source_urls?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          ai_analysis?: Json | null
          brand_voice_id?: string | null
          content_angle_id?: string | null
          content_framework?: string | null
          created_at?: string | null
          emotional_triggers?: string[] | null
          folder_id?: string | null
          free_text?: string | null
          generation_in_progress?: boolean | null
          guidelines_approved_at?: string | null
          guidelines_approved_by?: string | null
          id?: string
          is_demo?: boolean | null
          keywords?: string[] | null
          library_elements?: Json | null
          metadata?: Json | null
          organization_id?: string
          product_id?: string | null
          scripts_count?: number | null
          source_urls?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_ideas_brand_voice_id_fkey"
            columns: ["brand_voice_id"]
            isOneToOne: false
            referencedRelation: "library_brand_voices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_ideas_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "idea_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_ideas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_ideas_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      content_monitors: {
        Row: {
          action_config: Json
          campaign_id: string | null
          config: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          monitor_type: string
          organization_id: string
          trigger_count: number | null
        }
        Insert: {
          action_config: Json
          campaign_id?: string | null
          config: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          monitor_type: string
          organization_id: string
          trigger_count?: number | null
        }
        Update: {
          action_config?: Json
          campaign_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          monitor_type?: string
          organization_id?: string
          trigger_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_monitors_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_monitors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_outputs: {
        Row: {
          autopilot_id: string | null
          blueprint_id: string | null
          created_at: string | null
          current_stage: string | null
          data: Json | null
          error_message: string | null
          generation_cost: number | null
          generation_duration_ms: number | null
          generation_params: Json | null
          id: string
          idea_id: string | null
          job_id: string | null
          organization_id: string
          pipeline: string
          source: string | null
          stage_data: Json | null
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          autopilot_id?: string | null
          blueprint_id?: string | null
          created_at?: string | null
          current_stage?: string | null
          data?: Json | null
          error_message?: string | null
          generation_cost?: number | null
          generation_duration_ms?: number | null
          generation_params?: Json | null
          id?: string
          idea_id?: string | null
          job_id?: string | null
          organization_id: string
          pipeline: string
          source?: string | null
          stage_data?: Json | null
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          autopilot_id?: string | null
          blueprint_id?: string | null
          created_at?: string | null
          current_stage?: string | null
          data?: Json | null
          error_message?: string | null
          generation_cost?: number | null
          generation_duration_ms?: number | null
          generation_params?: Json | null
          id?: string
          idea_id?: string | null
          job_id?: string | null
          organization_id?: string
          pipeline?: string
          source?: string | null
          stage_data?: Json | null
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_outputs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "content_outputs_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_outputs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_outputs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "content_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_outputs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_publications: {
        Row: {
          account_id: string
          autopilot_id: string | null
          created_at: string | null
          evergreen_eligible: boolean | null
          external_post_id: string | null
          id: string
          last_reposted_at: string | null
          output_id: string | null
          platform: string | null
          published_at: string
          repost_count: number | null
        }
        Insert: {
          account_id: string
          autopilot_id?: string | null
          created_at?: string | null
          evergreen_eligible?: boolean | null
          external_post_id?: string | null
          id?: string
          last_reposted_at?: string | null
          output_id?: string | null
          platform?: string | null
          published_at: string
          repost_count?: number | null
        }
        Update: {
          account_id?: string
          autopilot_id?: string | null
          created_at?: string | null
          evergreen_eligible?: boolean | null
          external_post_id?: string | null
          id?: string
          last_reposted_at?: string | null
          output_id?: string | null
          platform?: string | null
          published_at?: string
          repost_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_publications_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "content_publications_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_publications_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      content_schedule: {
        Row: {
          campaign_id: string | null
          content_quota: Json | null
          created_at: string | null
          frequency_config: Json
          id: string
          is_active: boolean | null
          last_run_at: string | null
          next_run_at: string
          organization_id: string
          schedule_type: string
          time_slots: Json | null
        }
        Insert: {
          campaign_id?: string | null
          content_quota?: Json | null
          created_at?: string | null
          frequency_config: Json
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at: string
          organization_id: string
          schedule_type: string
          time_slots?: Json | null
        }
        Update: {
          campaign_id?: string | null
          content_quota?: Json | null
          created_at?: string | null
          frequency_config?: Json
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string
          organization_id?: string
          schedule_type?: string
          time_slots?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "content_schedule_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_schedule_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_sources: {
        Row: {
          author: string | null
          campaign_id: string | null
          check_frequency_hours: number | null
          content: string | null
          content_filters: Json | null
          creator_id: string | null
          id: string
          is_monitored: boolean | null
          is_processed: boolean | null
          last_checked_at: string | null
          metadata: Json | null
          next_check_at: string | null
          processing_rules: Json | null
          published_at: string | null
          score: number | null
          scraped_at: string | null
          source_type: string | null
          source_url: string | null
          title: string
        }
        Insert: {
          author?: string | null
          campaign_id?: string | null
          check_frequency_hours?: number | null
          content?: string | null
          content_filters?: Json | null
          creator_id?: string | null
          id?: string
          is_monitored?: boolean | null
          is_processed?: boolean | null
          last_checked_at?: string | null
          metadata?: Json | null
          next_check_at?: string | null
          processing_rules?: Json | null
          published_at?: string | null
          score?: number | null
          scraped_at?: string | null
          source_type?: string | null
          source_url?: string | null
          title: string
        }
        Update: {
          author?: string | null
          campaign_id?: string | null
          check_frequency_hours?: number | null
          content?: string | null
          content_filters?: Json | null
          creator_id?: string | null
          id?: string
          is_monitored?: boolean | null
          is_processed?: boolean | null
          last_checked_at?: string | null
          metadata?: Json | null
          next_check_at?: string | null
          processing_rules?: Json | null
          published_at?: string | null
          score?: number | null
          scraped_at?: string | null
          source_type?: string | null
          source_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_sources_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_preferences: {
        Row: {
          conversation_id: string
          created_at: string | null
          custom_notifications: Json | null
          id: string
          is_favorite: boolean | null
          is_muted: boolean | null
          labels: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          custom_notifications?: Json | null
          id?: string
          is_favorite?: boolean | null
          is_muted?: boolean | null
          labels?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          custom_notifications?: Json | null
          id?: string
          is_favorite?: boolean | null
          is_muted?: boolean | null
          labels?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_preferences_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversions: {
        Row: {
          ad_click_id: string | null
          ad_platform: string | null
          conversion_type: string
          created_at: string | null
          customer_id: string | null
          funnel_id: string
          id: string
          order_id: string | null
          org_id: string
          postback_response: Json | null
          postback_sent: boolean | null
          postback_sent_at: string | null
          revenue_cents: number | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          visitor_id: string
        }
        Insert: {
          ad_click_id?: string | null
          ad_platform?: string | null
          conversion_type: string
          created_at?: string | null
          customer_id?: string | null
          funnel_id: string
          id?: string
          order_id?: string | null
          org_id: string
          postback_response?: Json | null
          postback_sent?: boolean | null
          postback_sent_at?: string | null
          revenue_cents?: number | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id: string
        }
        Update: {
          ad_click_id?: string | null
          ad_platform?: string | null
          conversion_type?: string
          created_at?: string | null
          customer_id?: string | null
          funnel_id?: string
          id?: string
          order_id?: string | null
          org_id?: string
          postback_response?: Json | null
          postback_sent?: boolean | null
          postback_sent_at?: string | null
          revenue_cents?: number | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "conversions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: string
          contact_id: string
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          organization_id: string
          performed_by_type: string | null
          performed_by_user_id: string | null
          related_message_id: string | null
          related_sequence_id: string | null
          title: string
        }
        Insert: {
          activity_type: string
          contact_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          performed_by_type?: string | null
          performed_by_user_id?: string | null
          related_message_id?: string | null
          related_sequence_id?: string | null
          title: string
        }
        Update: {
          activity_type?: string
          contact_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          performed_by_type?: string | null
          performed_by_user_id?: string | null
          related_message_id?: string | null
          related_sequence_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_rules: {
        Row: {
          actions: Json | null
          conditions: Json | null
          cooldown_hours: number | null
          cooldown_seconds: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_archived: boolean | null
          last_triggered_at: string | null
          max_triggers_per_contact: number | null
          name: string
          organization_id: string
          priority: number | null
          total_failed: number | null
          total_succeeded: number | null
          total_triggered: number | null
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          actions?: Json | null
          conditions?: Json | null
          cooldown_hours?: number | null
          cooldown_seconds?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          last_triggered_at?: string | null
          max_triggers_per_contact?: number | null
          name: string
          organization_id: string
          priority?: number | null
          total_failed?: number | null
          total_succeeded?: number | null
          total_triggered?: number | null
          trigger_config?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          actions?: Json | null
          conditions?: Json | null
          cooldown_hours?: number | null
          cooldown_seconds?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          last_triggered_at?: string | null
          max_triggers_per_contact?: number | null
          name?: string
          organization_id?: string
          priority?: number | null
          total_failed?: number | null
          total_succeeded?: number | null
          total_triggered?: number | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_companies: {
        Row: {
          account_stage: Database["public"]["Enums"]["crm_account_stage"]
          account_stage_locked_at: string | null
          city: string | null
          country: string | null
          created_at: string
          description: string | null
          domain: string | null
          employee_count: number | null
          employee_range: string | null
          enrichment_data: Json | null
          enrichment_source: string | null
          enrichment_updated_at: string | null
          first_seen_at: string
          id: string
          industry: string | null
          last_contact_at: string | null
          last_signal_at: string | null
          linkedin_url: string | null
          logo_url: string | null
          name: string
          normalized_domain: string | null
          notes: string | null
          organization_id: string
          owner_user_id: string | null
          tags: string[] | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          account_stage?: Database["public"]["Enums"]["crm_account_stage"]
          account_stage_locked_at?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_range?: string | null
          enrichment_data?: Json | null
          enrichment_source?: string | null
          enrichment_updated_at?: string | null
          first_seen_at?: string
          id?: string
          industry?: string | null
          last_contact_at?: string | null
          last_signal_at?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          name: string
          normalized_domain?: string | null
          notes?: string | null
          organization_id: string
          owner_user_id?: string | null
          tags?: string[] | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          account_stage?: Database["public"]["Enums"]["crm_account_stage"]
          account_stage_locked_at?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_range?: string | null
          enrichment_data?: Json | null
          enrichment_source?: string | null
          enrichment_updated_at?: string | null
          first_seen_at?: string
          id?: string
          industry?: string | null
          last_contact_at?: string | null
          last_signal_at?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          name?: string
          normalized_domain?: string | null
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          tags?: string[] | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_companies_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_identities: {
        Row: {
          channel: string
          contact_id: string
          created_at: string | null
          id: string
          identifier: string | null
          is_primary: boolean | null
          is_verified: boolean | null
          linked_account_ids: string[] | null
          organization_id: string
          platform_avatar_url: string | null
          platform_metadata: Json | null
          platform_profile_url: string | null
          platform_user_id: string
          platform_username: string | null
          raw_connection_data: Json | null
          updated_at: string | null
        }
        Insert: {
          channel: string
          contact_id: string
          created_at?: string | null
          id?: string
          identifier?: string | null
          is_primary?: boolean | null
          is_verified?: boolean | null
          linked_account_ids?: string[] | null
          organization_id: string
          platform_avatar_url?: string | null
          platform_metadata?: Json | null
          platform_profile_url?: string | null
          platform_user_id: string
          platform_username?: string | null
          raw_connection_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          channel?: string
          contact_id?: string
          created_at?: string | null
          id?: string
          identifier?: string | null
          is_primary?: boolean | null
          is_verified?: boolean | null
          linked_account_ids?: string[] | null
          organization_id?: string
          platform_avatar_url?: string | null
          platform_metadata?: Json | null
          platform_profile_url?: string | null
          platform_user_id?: string
          platform_username?: string | null
          raw_connection_data?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_tags: {
        Row: {
          added_at: string | null
          added_by_user_id: string | null
          contact_id: string
          id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          added_at?: string | null
          added_by_user_id?: string | null
          contact_id: string
          id?: string
          organization_id: string
          tag_id: string
        }
        Update: {
          added_at?: string | null
          added_by_user_id?: string | null
          contact_id?: string
          id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          avatar_url: string | null
          city: string | null
          company: string | null
          company_employee_count: number | null
          company_employee_range: string | null
          company_id: string | null
          company_industry: string | null
          company_name: string | null
          company_revenue_range: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_last_validated_at: string | null
          email_type: string | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          firmographics_checked_at: string | null
          firmographics_source: string | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          home_page_text: string | null
          home_page_text_fetched_at: string | null
          instagram_url: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_bio: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          moltsets_attempted_at: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          quickenrich_attempted_at: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          signal_confidence: number | null
          signal_date: string | null
          signal_detail: string | null
          signal_event_id: string | null
          signal_source_url: string | null
          signal_subscription_id: string | null
          signal_type: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          ai_analysis_status?: string | null
          ai_analyzed_at?: string | null
          avatar_url?: string | null
          city?: string | null
          company?: string | null
          company_employee_count?: number | null
          company_employee_range?: string | null
          company_id?: string | null
          company_industry?: string | null
          company_name?: string | null
          company_revenue_range?: string | null
          company_website?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          discovery_metadata?: Json | null
          discovery_score?: number | null
          discovery_signal_strength?: string | null
          display_name: string
          email?: string | null
          email_is_catch_all?: boolean | null
          email_is_deliverable?: boolean | null
          email_is_disposable?: boolean | null
          email_is_free?: boolean | null
          email_is_role?: boolean | null
          email_is_spamtrap?: boolean | null
          email_last_validated_at?: string | null
          email_type?: string | null
          email_verification_score?: number | null
          email_verification_source?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          firmographics_checked_at?: string | null
          firmographics_source?: string | null
          first_name?: string | null
          first_seen_at?: string | null
          full_name?: string | null
          home_page_text?: string | null
          home_page_text_fetched_at?: string | null
          instagram_url?: string | null
          id?: string
          is_linkedin_connection?: boolean | null
          job_title?: string | null
          last_activity_at?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_score_breakdown?: Json | null
          lead_score_updated_at?: string | null
          linkedin_bio?: string | null
          linkedin_connected_at?: string | null
          linkedin_url?: string | null
          moltsets_attempted_at?: string | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id: string
          outreach_status?: string | null
          owner_user_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          preview_document_id?: string | null
          primary_email?: string | null
          primary_linkedin_url?: string | null
          primary_phone?: string | null
          quickenrich_attempted_at?: string | null
          seg_checked_at?: string | null
          seg_provider?: string | null
          signal_confidence?: number | null
          signal_date?: string | null
          signal_detail?: string | null
          signal_event_id?: string | null
          signal_source_url?: string | null
          signal_subscription_id?: string | null
          signal_type?: string | null
          source?: string | null
          source_campaign_id?: string | null
          source_details?: Json | null
          source_lead_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          state?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_analysis_status?: string | null
          ai_analyzed_at?: string | null
          avatar_url?: string | null
          city?: string | null
          company?: string | null
          company_employee_count?: number | null
          company_employee_range?: string | null
          company_id?: string | null
          company_industry?: string | null
          company_name?: string | null
          company_revenue_range?: string | null
          company_website?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          discovery_metadata?: Json | null
          discovery_score?: number | null
          discovery_signal_strength?: string | null
          display_name?: string
          email?: string | null
          email_is_catch_all?: boolean | null
          email_is_deliverable?: boolean | null
          email_is_disposable?: boolean | null
          email_is_free?: boolean | null
          email_is_role?: boolean | null
          email_is_spamtrap?: boolean | null
          email_last_validated_at?: string | null
          email_type?: string | null
          email_verification_score?: number | null
          email_verification_source?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          firmographics_checked_at?: string | null
          firmographics_source?: string | null
          first_name?: string | null
          first_seen_at?: string | null
          full_name?: string | null
          home_page_text?: string | null
          home_page_text_fetched_at?: string | null
          instagram_url?: string | null
          id?: string
          is_linkedin_connection?: boolean | null
          job_title?: string | null
          last_activity_at?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_score_breakdown?: Json | null
          lead_score_updated_at?: string | null
          linkedin_bio?: string | null
          linkedin_connected_at?: string | null
          linkedin_url?: string | null
          moltsets_attempted_at?: string | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id?: string
          outreach_status?: string | null
          owner_user_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          preview_document_id?: string | null
          primary_email?: string | null
          primary_linkedin_url?: string | null
          primary_phone?: string | null
          quickenrich_attempted_at?: string | null
          seg_checked_at?: string | null
          seg_provider?: string | null
          signal_confidence?: number | null
          signal_date?: string | null
          signal_detail?: string | null
          signal_event_id?: string | null
          signal_source_url?: string | null
          signal_subscription_id?: string | null
          signal_type?: string | null
          source?: string | null
          source_campaign_id?: string | null
          source_details?: Json | null
          source_lead_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          state?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_pipeline_fk"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_preview_document_id_fkey"
            columns: ["preview_document_id"]
            isOneToOne: false
            referencedRelation: "preview_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "unipile_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_stage_fk"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts_dedup_archive: {
        Row: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          archived_at: string
          avatar_url: string | null
          city: string | null
          company: string | null
          company_id: string | null
          company_name: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          merged_into: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          ai_analysis_status?: string | null
          ai_analyzed_at?: string | null
          archived_at?: string
          avatar_url?: string | null
          city?: string | null
          company?: string | null
          company_id?: string | null
          company_name?: string | null
          company_website?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          discovery_metadata?: Json | null
          discovery_score?: number | null
          discovery_signal_strength?: string | null
          display_name: string
          email?: string | null
          email_is_catch_all?: boolean | null
          email_is_deliverable?: boolean | null
          email_is_disposable?: boolean | null
          email_is_free?: boolean | null
          email_is_role?: boolean | null
          email_is_spamtrap?: boolean | null
          email_verification_score?: number | null
          email_verification_source?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          first_name?: string | null
          first_seen_at?: string | null
          full_name?: string | null
          id?: string
          is_linkedin_connection?: boolean | null
          job_title?: string | null
          last_activity_at?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_score_breakdown?: Json | null
          lead_score_updated_at?: string | null
          linkedin_connected_at?: string | null
          linkedin_url?: string | null
          merged_into?: string | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id: string
          outreach_status?: string | null
          owner_user_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          preview_document_id?: string | null
          primary_email?: string | null
          primary_linkedin_url?: string | null
          primary_phone?: string | null
          seg_checked_at?: string | null
          seg_provider?: string | null
          source?: string | null
          source_campaign_id?: string | null
          source_details?: Json | null
          source_lead_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          state?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_analysis_status?: string | null
          ai_analyzed_at?: string | null
          archived_at?: string
          avatar_url?: string | null
          city?: string | null
          company?: string | null
          company_id?: string | null
          company_name?: string | null
          company_website?: string | null
          contact_type?: string | null
          country?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          discovery_metadata?: Json | null
          discovery_score?: number | null
          discovery_signal_strength?: string | null
          display_name?: string
          email?: string | null
          email_is_catch_all?: boolean | null
          email_is_deliverable?: boolean | null
          email_is_disposable?: boolean | null
          email_is_free?: boolean | null
          email_is_role?: boolean | null
          email_is_spamtrap?: boolean | null
          email_verification_score?: number | null
          email_verification_source?: string | null
          email_verification_status?: string | null
          email_verified_at?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          first_name?: string | null
          first_seen_at?: string | null
          full_name?: string | null
          id?: string
          is_linkedin_connection?: boolean | null
          job_title?: string | null
          last_activity_at?: string | null
          last_name?: string | null
          lead_score?: number | null
          lead_score_breakdown?: Json | null
          lead_score_updated_at?: string | null
          linkedin_connected_at?: string | null
          linkedin_url?: string | null
          merged_into?: string | null
          notion_page_id?: string | null
          notion_preview_url?: string | null
          organization_id?: string
          outreach_status?: string | null
          owner_user_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          preview_document_id?: string | null
          primary_email?: string | null
          primary_linkedin_url?: string | null
          primary_phone?: string | null
          seg_checked_at?: string | null
          seg_provider?: string | null
          source?: string | null
          source_campaign_id?: string | null
          source_details?: Json | null
          source_lead_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          state?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_conversation_participants: {
        Row: {
          contact_id: string | null
          conversation_id: string
          created_at: string | null
          id: string
          last_read_at: string | null
          last_read_message_id: string | null
          notifications_enabled: boolean | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          contact_id?: string | null
          conversation_id: string
          created_at?: string | null
          id?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          notifications_enabled?: boolean | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          notifications_enabled?: boolean | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_participants_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversations: {
        Row: {
          agent_profile_id: string | null
          ai_context: Json | null
          ai_enabled: boolean | null
          ai_paused_until: string | null
          assigned_to_type: string | null
          assigned_to_user_id: string | null
          autopilot_state: Json | null
          avg_response_time_ms: number | null
          channel: string
          channel_account_id: string | null
          contact_id: string
          created_at: string | null
          external_conversation_id: string | null
          external_participant_id: string | null
          has_inbound_message: boolean
          has_outbound_message: boolean
          human_takeover_at: string | null
          human_takeover_reason: string | null
          id: string
          is_system: boolean | null
          last_message_at: string | null
          last_message_direction: string | null
          last_message_preview: string | null
          last_message_subject: string | null
          lead_intent: string | null
          mailbox_id: string | null
          message_count: number | null
          metadata: Json | null
          momentum_score: number | null
          momentum_trend: string | null
          organization_id: string
          priority_score: number | null
          sla_status: string | null
          snooze_context: Json | null
          snooze_type: string | null
          snoozed_until: string | null
          status: string | null
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          agent_profile_id?: string | null
          ai_context?: Json | null
          ai_enabled?: boolean | null
          ai_paused_until?: string | null
          assigned_to_type?: string | null
          assigned_to_user_id?: string | null
          autopilot_state?: Json | null
          avg_response_time_ms?: number | null
          channel: string
          channel_account_id?: string | null
          contact_id: string
          created_at?: string | null
          external_conversation_id?: string | null
          external_participant_id?: string | null
          has_inbound_message?: boolean
          has_outbound_message?: boolean
          human_takeover_at?: string | null
          human_takeover_reason?: string | null
          id?: string
          is_system?: boolean | null
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          last_message_subject?: string | null
          lead_intent?: string | null
          mailbox_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          momentum_score?: number | null
          momentum_trend?: string | null
          organization_id: string
          priority_score?: number | null
          sla_status?: string | null
          snooze_context?: Json | null
          snooze_type?: string | null
          snoozed_until?: string | null
          status?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_profile_id?: string | null
          ai_context?: Json | null
          ai_enabled?: boolean | null
          ai_paused_until?: string | null
          assigned_to_type?: string | null
          assigned_to_user_id?: string | null
          autopilot_state?: Json | null
          avg_response_time_ms?: number | null
          channel?: string
          channel_account_id?: string | null
          contact_id?: string
          created_at?: string | null
          external_conversation_id?: string | null
          external_participant_id?: string | null
          has_inbound_message?: boolean
          has_outbound_message?: boolean
          human_takeover_at?: string | null
          human_takeover_reason?: string | null
          id?: string
          is_system?: boolean | null
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          last_message_subject?: string | null
          lead_intent?: string | null
          mailbox_id?: string | null
          message_count?: number | null
          metadata?: Json | null
          momentum_score?: number | null
          momentum_trend?: string | null
          organization_id?: string
          priority_score?: number | null
          sla_status?: string | null
          snooze_context?: Json | null
          snooze_type?: string | null
          snoozed_until?: string | null
          status?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversations_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_field_defs: {
        Row: {
          created_at: string | null
          default_value: string | null
          description: string | null
          display_name: string
          display_order: number | null
          field_key: string
          field_type: string
          id: string
          is_required: boolean | null
          is_searchable: boolean | null
          is_visible_in_list: boolean | null
          options: Json | null
          organization_id: string
          updated_at: string | null
          validation_rules: Json | null
        }
        Insert: {
          created_at?: string | null
          default_value?: string | null
          description?: string | null
          display_name: string
          display_order?: number | null
          field_key: string
          field_type: string
          id?: string
          is_required?: boolean | null
          is_searchable?: boolean | null
          is_visible_in_list?: boolean | null
          options?: Json | null
          organization_id: string
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Update: {
          created_at?: string | null
          default_value?: string | null
          description?: string | null
          display_name?: string
          display_order?: number | null
          field_key?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          is_searchable?: boolean | null
          is_visible_in_list?: boolean | null
          options?: Json | null
          organization_id?: string
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_field_defs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_handoff_log: {
        Row: {
          actions_executed: Json | null
          contact_id: string
          conversation_id: string
          created_at: string | null
          id: string
          organization_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          trigger_data: Json | null
          trigger_id: string | null
          trigger_reason: string | null
          trigger_type: string
          triggering_message_id: string | null
        }
        Insert: {
          actions_executed?: Json | null
          contact_id: string
          conversation_id: string
          created_at?: string | null
          id?: string
          organization_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          trigger_data?: Json | null
          trigger_id?: string | null
          trigger_reason?: string | null
          trigger_type: string
          triggering_message_id?: string | null
        }
        Update: {
          actions_executed?: Json | null
          contact_id?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          organization_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          trigger_data?: Json | null
          trigger_id?: string | null
          trigger_reason?: string | null
          trigger_type?: string
          triggering_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_handoff_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_handoff_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_handoff_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_handoff_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_handoff_log_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "crm_handoff_triggers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_handoff_log_triggering_message_id_fkey"
            columns: ["triggering_message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_handoff_triggers: {
        Row: {
          actions: Json | null
          auto_assign_to: string | null
          config: Json | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          notify_users: string[] | null
          organization_id: string
          priority: string | null
          total_triggered: number | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          actions?: Json | null
          auto_assign_to?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          notify_users?: string[] | null
          organization_id: string
          priority?: string | null
          total_triggered?: number | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          actions?: Json | null
          auto_assign_to?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          notify_users?: string[] | null
          organization_id?: string
          priority?: string | null
          total_triggered?: number | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_handoff_triggers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_message_queue: {
        Row: {
          attachments: Json | null
          attempts: number | null
          channel: string
          channel_account_id: string | null
          contact_id: string
          content: string
          content_type: string | null
          conversation_id: string | null
          created_at: string | null
          email_bcc: string[] | null
          email_cc: string[] | null
          email_subject: string | null
          error_code: string | null
          error_details: Json | null
          error_message: string | null
          external_message_id: string | null
          id: string
          last_attempt_at: string | null
          max_attempts: number | null
          message_id: string | null
          metadata: Json | null
          next_retry_at: string | null
          organization_id: string
          priority: number | null
          recipient_display_name: string | null
          recipient_external_id: string
          recipient_identity_id: string | null
          scheduled_for: string
          sender_type: string | null
          sender_user_id: string | null
          sent_at: string | null
          source_id: string | null
          source_type: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attachments?: Json | null
          attempts?: number | null
          channel: string
          channel_account_id?: string | null
          contact_id: string
          content: string
          content_type?: string | null
          conversation_id?: string | null
          created_at?: string | null
          email_bcc?: string[] | null
          email_cc?: string[] | null
          email_subject?: string | null
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          max_attempts?: number | null
          message_id?: string | null
          metadata?: Json | null
          next_retry_at?: string | null
          organization_id: string
          priority?: number | null
          recipient_display_name?: string | null
          recipient_external_id: string
          recipient_identity_id?: string | null
          scheduled_for?: string
          sender_type?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attachments?: Json | null
          attempts?: number | null
          channel?: string
          channel_account_id?: string | null
          contact_id?: string
          content?: string
          content_type?: string | null
          conversation_id?: string | null
          created_at?: string | null
          email_bcc?: string[] | null
          email_cc?: string[] | null
          email_subject?: string | null
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          max_attempts?: number | null
          message_id?: string | null
          metadata?: Json | null
          next_retry_at?: string | null
          organization_id?: string
          priority?: number | null
          recipient_display_name?: string | null
          recipient_external_id?: string
          recipient_identity_id?: string | null
          scheduled_for?: string
          sender_type?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_message_queue_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_message_queue_recipient_identity_id_fkey"
            columns: ["recipient_identity_id"]
            isOneToOne: false
            referencedRelation: "crm_contact_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_message_templates: {
        Row: {
          category: string | null
          channels: string[] | null
          content: string
          content_type: string | null
          created_at: string | null
          created_by_user_id: string | null
          description: string | null
          id: string
          is_shared: boolean | null
          last_used_at: string | null
          name: string
          organization_id: string
          subject: string | null
          times_used: number | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          category?: string | null
          channels?: string[] | null
          content: string
          content_type?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_shared?: boolean | null
          last_used_at?: string | null
          name: string
          organization_id: string
          subject?: string | null
          times_used?: number | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          category?: string | null
          channels?: string[] | null
          content?: string
          content_type?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          is_shared?: boolean | null
          last_used_at?: string | null
          name?: string
          organization_id?: string
          subject?: string | null
          times_used?: number | null
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_messages: {
        Row: {
          ai_completion_tokens: number | null
          ai_generated: boolean | null
          ai_model: string | null
          ai_prompt_tokens: number | null
          attachments: Json | null
          clicked_at: string | null
          contact_id: string
          content: string
          content_tsv: unknown
          content_type: string | null
          conversation_id: string
          created_at: string | null
          delivered_at: string | null
          direction: string
          email_bcc: string[] | null
          email_cc: string[] | null
          email_from: string | null
          email_headers: Json | null
          email_subject: string | null
          email_to: string[] | null
          error_message: string | null
          external_message_id: string | null
          external_thread_id: string | null
          id: string
          metadata: Json | null
          organization_id: string
          read_at: string | null
          reply_to_message_id: string | null
          sender_type: string
          sender_user_id: string | null
          status: string | null
          status_updated_at: string | null
          updated_at: string | null
        }
        Insert: {
          ai_completion_tokens?: number | null
          ai_generated?: boolean | null
          ai_model?: string | null
          ai_prompt_tokens?: number | null
          attachments?: Json | null
          clicked_at?: string | null
          contact_id: string
          content: string
          content_tsv?: unknown
          content_type?: string | null
          conversation_id: string
          created_at?: string | null
          delivered_at?: string | null
          direction: string
          email_bcc?: string[] | null
          email_cc?: string[] | null
          email_from?: string | null
          email_headers?: Json | null
          email_subject?: string | null
          email_to?: string[] | null
          error_message?: string | null
          external_message_id?: string | null
          external_thread_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          read_at?: string | null
          reply_to_message_id?: string | null
          sender_type: string
          sender_user_id?: string | null
          status?: string | null
          status_updated_at?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_completion_tokens?: number | null
          ai_generated?: boolean | null
          ai_model?: string | null
          ai_prompt_tokens?: number | null
          attachments?: Json | null
          clicked_at?: string | null
          contact_id?: string
          content?: string
          content_tsv?: unknown
          content_type?: string | null
          conversation_id?: string
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          email_bcc?: string[] | null
          email_cc?: string[] | null
          email_from?: string | null
          email_headers?: Json | null
          email_subject?: string | null
          email_to?: string[] | null
          error_message?: string | null
          external_message_id?: string | null
          external_thread_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          read_at?: string | null
          reply_to_message_id?: string | null
          sender_type?: string
          sender_user_id?: string | null
          status?: string | null
          status_updated_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          contact_id: string
          content: string
          created_at: string | null
          created_by_user_id: string | null
          id: string
          is_internal: boolean | null
          is_pinned: boolean | null
          mentioned_user_ids: string[] | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          contact_id: string
          content: string
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          is_internal?: boolean | null
          is_pinned?: boolean | null
          mentioned_user_ids?: string[] | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          contact_id?: string
          content?: string
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          is_internal?: boolean | null
          is_pinned?: boolean | null
          mentioned_user_ids?: string[] | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          expected_days: number | null
          id: string
          name: string
          organization_id: string
          pipeline_id: string
          stage_order: number
          stage_type: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          expected_days?: number | null
          id?: string
          name: string
          organization_id: string
          pipeline_id: string
          stage_order: number
          stage_type?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          expected_days?: number | null
          id?: string
          name?: string
          organization_id?: string
          pipeline_id?: string
          stage_order?: number
          stage_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_rule_log: {
        Row: {
          actions_executed: Json | null
          completed_at: string | null
          condition_results: Json | null
          conditions_met: boolean | null
          contact_id: string | null
          conversation_id: string | null
          duration_ms: number | null
          error_message: string | null
          execution_status: string | null
          id: string
          message_id: string | null
          organization_id: string
          rule_id: string
          started_at: string | null
          success: boolean | null
          trigger_data: Json | null
          trigger_type: string
        }
        Insert: {
          actions_executed?: Json | null
          completed_at?: string | null
          condition_results?: Json | null
          conditions_met?: boolean | null
          contact_id?: string | null
          conversation_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          execution_status?: string | null
          id?: string
          message_id?: string | null
          organization_id: string
          rule_id: string
          started_at?: string | null
          success?: boolean | null
          trigger_data?: Json | null
          trigger_type: string
        }
        Update: {
          actions_executed?: Json | null
          completed_at?: string | null
          condition_results?: Json | null
          conditions_met?: boolean | null
          contact_id?: string | null
          conversation_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          execution_status?: string | null
          id?: string
          message_id?: string | null
          organization_id?: string
          rule_id?: string
          started_at?: string | null
          success?: boolean | null
          trigger_data?: Json | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_rule_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rule_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rule_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rule_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rule_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rule_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sequence_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          conversation_id: string | null
          current_step_id: string | null
          current_step_position: number | null
          enrolled_at: string | null
          enrolled_by: string | null
          exit_reason: string | null
          exited_at: string | null
          id: string
          messages_clicked: number | null
          messages_opened: number | null
          messages_sent: number | null
          next_step_at: string | null
          organization_id: string
          paused_at: string | null
          sequence_id: string
          status: string
          steps_completed: number | null
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          conversation_id?: string | null
          current_step_id?: string | null
          current_step_position?: number | null
          enrolled_at?: string | null
          enrolled_by?: string | null
          exit_reason?: string | null
          exited_at?: string | null
          id?: string
          messages_clicked?: number | null
          messages_opened?: number | null
          messages_sent?: number | null
          next_step_at?: string | null
          organization_id: string
          paused_at?: string | null
          sequence_id: string
          status?: string
          steps_completed?: number | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          conversation_id?: string | null
          current_step_id?: string | null
          current_step_position?: number | null
          enrolled_at?: string | null
          enrolled_by?: string | null
          exit_reason?: string | null
          exited_at?: string | null
          id?: string
          messages_clicked?: number | null
          messages_opened?: number | null
          messages_sent?: number | null
          next_step_at?: string | null
          organization_id?: string
          paused_at?: string | null
          sequence_id?: string
          status?: string
          steps_completed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_enrollments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_enrollments_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "crm_sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "crm_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sequence_log: {
        Row: {
          created_at: string | null
          enrollment_id: string
          error_message: string | null
          event_data: Json | null
          event_type: string
          id: string
          message_id: string | null
          organization_id: string
          queue_item_id: string | null
          step_id: string | null
          success: boolean | null
        }
        Insert: {
          created_at?: string | null
          enrollment_id: string
          error_message?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          message_id?: string | null
          organization_id: string
          queue_item_id?: string | null
          step_id?: string | null
          success?: boolean | null
        }
        Update: {
          created_at?: string | null
          enrollment_id?: string
          error_message?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          message_id?: string | null
          organization_id?: string
          queue_item_id?: string | null
          step_id?: string | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_sequence_log_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "crm_sequence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_log_queue_item_id_fkey"
            columns: ["queue_item_id"]
            isOneToOne: false
            referencedRelation: "crm_message_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_log_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "crm_sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sequence_steps: {
        Row: {
          action_config: Json | null
          action_type: string | null
          condition_config: Json | null
          condition_type: string | null
          content: string | null
          content_type: string | null
          created_at: string | null
          delay_amount: number | null
          delay_unit: string | null
          id: string
          is_active: boolean | null
          position: number
          sequence_id: string
          step_type: string
          subject: string | null
          template_id: string | null
          total_clicked: number | null
          total_opened: number | null
          total_replied: number | null
          total_sent: number | null
          updated_at: string | null
          variants: Json | null
        }
        Insert: {
          action_config?: Json | null
          action_type?: string | null
          condition_config?: Json | null
          condition_type?: string | null
          content?: string | null
          content_type?: string | null
          created_at?: string | null
          delay_amount?: number | null
          delay_unit?: string | null
          id?: string
          is_active?: boolean | null
          position?: number
          sequence_id: string
          step_type: string
          subject?: string | null
          template_id?: string | null
          total_clicked?: number | null
          total_opened?: number | null
          total_replied?: number | null
          total_sent?: number | null
          updated_at?: string | null
          variants?: Json | null
        }
        Update: {
          action_config?: Json | null
          action_type?: string | null
          condition_config?: Json | null
          condition_type?: string | null
          content?: string | null
          content_type?: string | null
          created_at?: string | null
          delay_amount?: number | null
          delay_unit?: string | null
          id?: string
          is_active?: boolean | null
          position?: number
          sequence_id?: string
          step_type?: string
          subject?: string | null
          template_id?: string | null
          total_clicked?: number | null
          total_opened?: number | null
          total_replied?: number | null
          total_sent?: number | null
          updated_at?: string | null
          variants?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "crm_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "crm_message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sequences: {
        Row: {
          channel: string
          channel_account_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_archived: boolean | null
          name: string
          organization_id: string
          settings: Json | null
          total_bounced: number | null
          total_completed: number | null
          total_enrolled: number | null
          total_replied: number | null
          updated_at: string | null
        }
        Insert: {
          channel: string
          channel_account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          name: string
          organization_id: string
          settings?: Json | null
          total_bounced?: number | null
          total_completed?: number | null
          total_enrolled?: number | null
          total_replied?: number | null
          updated_at?: string | null
        }
        Update: {
          channel?: string
          channel_account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean | null
          name?: string
          organization_id?: string
          settings?: Json | null
          total_bounced?: number | null
          total_completed?: number | null
          total_enrolled?: number | null
          total_replied?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_sequences_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tags: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          csv_data: Json | null
          current_row: number | null
          error_message: string | null
          failed_count: number | null
          field_mappings: Json
          file_path: string | null
          filename: string
          id: string
          imported_count: number | null
          organization_id: string
          processing_lock_at: string | null
          progress: number | null
          skip_reasons: Json | null
          skipped_count: number | null
          started_at: string | null
          status: string
          target_list_id: string
          total_rows: number | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          csv_data?: Json | null
          current_row?: number | null
          error_message?: string | null
          failed_count?: number | null
          field_mappings: Json
          file_path?: string | null
          filename: string
          id?: string
          imported_count?: number | null
          organization_id: string
          processing_lock_at?: string | null
          progress?: number | null
          skip_reasons?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          target_list_id: string
          total_rows?: number | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          csv_data?: Json | null
          current_row?: number | null
          error_message?: string | null
          failed_count?: number | null
          field_mappings?: Json
          file_path?: string | null
          filename?: string
          id?: string
          imported_count?: number | null
          organization_id?: string
          processing_lock_at?: string | null
          progress?: number | null
          skip_reasons?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          target_list_id?: string
          total_rows?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "csv_import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_import_jobs_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_imports: {
        Row: {
          campaign_id: string | null
          column_mapping: Json
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_log: Json | null
          failed_rows: number | null
          file_url: string
          filename: string
          id: string
          organization_id: string
          processed_rows: number | null
          status: string | null
          total_rows: number
        }
        Insert: {
          campaign_id?: string | null
          column_mapping: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_log?: Json | null
          failed_rows?: number | null
          file_url: string
          filename: string
          id?: string
          organization_id: string
          processed_rows?: number | null
          status?: string | null
          total_rows: number
        }
        Update: {
          campaign_id?: string | null
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_log?: Json | null
          failed_rows?: number | null
          file_url?: string
          filename?: string
          id?: string
          organization_id?: string
          processed_rows?: number | null
          status?: string | null
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "csv_imports_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "csv_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          email: string
          fbc_cookie: string | null
          fbp_cookie: string | null
          first_seen_at: string | null
          gclid: string | null
          ghl_contact_id: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          name: string | null
          obclid: string | null
          org_id: string
          phone: string | null
          stripe_customer_id: string | null
          tblci: string | null
          ttclid: string | null
          ttp_cookie: string | null
          updated_at: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          fbc_cookie?: string | null
          fbp_cookie?: string | null
          first_seen_at?: string | null
          gclid?: string | null
          ghl_contact_id?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          name?: string | null
          obclid?: string | null
          org_id: string
          phone?: string | null
          stripe_customer_id?: string | null
          tblci?: string | null
          ttclid?: string | null
          ttp_cookie?: string | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          fbc_cookie?: string | null
          fbp_cookie?: string | null
          first_seen_at?: string | null
          gclid?: string | null
          ghl_contact_id?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          name?: string | null
          obclid?: string | null
          org_id?: string
          phone?: string | null
          stripe_customer_id?: string | null
          tblci?: string | null
          ttclid?: string | null
          ttp_cookie?: string | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diag_lock_samples: {
        Row: {
          blocked_duration_ms: number | null
          blocked_pid: number | null
          blocked_query: string | null
          blocked_state: string | null
          blocked_user: string | null
          blocked_wait: string | null
          blocking_duration_ms: number | null
          blocking_pid: number | null
          blocking_query: string | null
          blocking_state: string | null
          blocking_user: string | null
          blocking_wait: string | null
          blocking_xact_ms: number | null
          captured_at: string
          id: number
        }
        Insert: {
          blocked_duration_ms?: number | null
          blocked_pid?: number | null
          blocked_query?: string | null
          blocked_state?: string | null
          blocked_user?: string | null
          blocked_wait?: string | null
          blocking_duration_ms?: number | null
          blocking_pid?: number | null
          blocking_query?: string | null
          blocking_state?: string | null
          blocking_user?: string | null
          blocking_wait?: string | null
          blocking_xact_ms?: number | null
          captured_at?: string
          id?: number
        }
        Update: {
          blocked_duration_ms?: number | null
          blocked_pid?: number | null
          blocked_query?: string | null
          blocked_state?: string | null
          blocked_user?: string | null
          blocked_wait?: string | null
          blocking_duration_ms?: number | null
          blocking_pid?: number | null
          blocking_query?: string | null
          blocking_state?: string | null
          blocking_user?: string | null
          blocking_wait?: string | null
          blocking_xact_ms?: number | null
          captured_at?: string
          id?: number
        }
        Relationships: []
      }
      dns_providers: {
        Row: {
          account_id: string | null
          account_name: string | null
          api_token_encrypted: string
          created_at: string | null
          id: string
          last_error: string | null
          last_used_at: string | null
          organization_id: string
          provider: string
          token_permissions: Json | null
          updated_at: string | null
          validated_at: string | null
          zone_count: number | null
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          api_token_encrypted: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          organization_id: string
          provider: string
          token_permissions?: Json | null
          updated_at?: string | null
          validated_at?: string | null
          zone_count?: number | null
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          api_token_encrypted?: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_used_at?: string | null
          organization_id?: string
          provider?: string
          token_permissions?: Json | null
          updated_at?: string | null
          validated_at?: string | null
          zone_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dns_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_aliases: {
        Row: {
          alias_domain: string
          discovered_at: string
          discovered_via: string
          id: string
          organization_id: string
          primary_domain: string
          relationship: string
        }
        Insert: {
          alias_domain: string
          discovered_at?: string
          discovered_via: string
          id?: string
          organization_id: string
          primary_domain: string
          relationship: string
        }
        Update: {
          alias_domain?: string
          discovered_at?: string
          discovered_via?: string
          id?: string
          organization_id?: string
          primary_domain?: string
          relationship?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_aliases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_pattern_cache: {
        Row: {
          bounce_count: number
          catch_all: boolean
          confidence: number
          created_at: string
          discovery_exhausted: boolean
          domain: string
          expires_at: string | null
          hard_bounce_window_30d: number
          id: string
          known_patterns: Json
          last_discovery_at: string | null
          last_verified_at: string | null
          multi_pattern: boolean
          mx_provider: string | null
          mx_valid: boolean
          negative_result: boolean
          organization_id: string
          pattern: string | null
          sample_size: number
          tier: number | null
          updated_at: string
        }
        Insert: {
          bounce_count?: number
          catch_all?: boolean
          confidence?: number
          created_at?: string
          discovery_exhausted?: boolean
          domain: string
          expires_at?: string | null
          hard_bounce_window_30d?: number
          id?: string
          known_patterns?: Json
          last_discovery_at?: string | null
          last_verified_at?: string | null
          multi_pattern?: boolean
          mx_provider?: string | null
          mx_valid?: boolean
          negative_result?: boolean
          organization_id: string
          pattern?: string | null
          sample_size?: number
          tier?: number | null
          updated_at?: string
        }
        Update: {
          bounce_count?: number
          catch_all?: boolean
          confidence?: number
          created_at?: string
          discovery_exhausted?: boolean
          domain?: string
          expires_at?: string | null
          hard_bounce_window_30d?: number
          id?: string
          known_patterns?: Json
          last_discovery_at?: string | null
          last_verified_at?: string | null
          multi_pattern?: boolean
          mx_provider?: string | null
          mx_valid?: boolean
          negative_result?: boolean
          organization_id?: string
          pattern?: string | null
          sample_size?: number
          tier?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_pattern_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_seg_cache: {
        Row: {
          checked_at: string
          created_at: string
          domain: string
          has_seg: boolean
          id: string
          mx_records: Json | null
          seg_provider: string | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          domain: string
          has_seg?: boolean
          id?: string
          mx_records?: Json | null
          seg_provider?: string | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          domain?: string
          has_seg?: boolean
          id?: string
          mx_records?: Json | null
          seg_provider?: string | null
        }
        Relationships: []
      }
      drip_preferences: {
        Row: {
          created_at: string
          muted_stages: string[]
          organization_id: string
          paused: boolean
          stage_feedback: Json
          stream_alerts: boolean
          stream_checkins: boolean
          stream_content_drops: boolean
          stream_daily_briefs: boolean
          stream_digest: boolean
          stream_education: boolean
          stream_reply_alerts: boolean
          stream_reveals: boolean
          stream_winback: boolean
          updated_at: string
          voice_guidance: string | null
          weekly_cap: number
        }
        Insert: {
          created_at?: string
          muted_stages?: string[]
          organization_id: string
          paused?: boolean
          stage_feedback?: Json
          stream_alerts?: boolean
          stream_checkins?: boolean
          stream_content_drops?: boolean
          stream_daily_briefs?: boolean
          stream_digest?: boolean
          stream_education?: boolean
          stream_reply_alerts?: boolean
          stream_reveals?: boolean
          stream_winback?: boolean
          updated_at?: string
          voice_guidance?: string | null
          weekly_cap?: number
        }
        Update: {
          created_at?: string
          muted_stages?: string[]
          organization_id?: string
          paused?: boolean
          stage_feedback?: Json
          stream_alerts?: boolean
          stream_checkins?: boolean
          stream_content_drops?: boolean
          stream_daily_briefs?: boolean
          stream_digest?: boolean
          stream_education?: boolean
          stream_reply_alerts?: boolean
          stream_reveals?: boolean
          stream_winback?: boolean
          updated_at?: string
          voice_guidance?: string | null
          weekly_cap?: number
        }
        Relationships: [
          {
            foreignKeyName: "drip_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_ab_variants: {
        Row: {
          auto_disabled: boolean
          auto_disabled_reason: string | null
          body: string
          bounced: number | null
          clicked: number | null
          created_at: string | null
          deliverability_score: number | null
          deliverability_scored_at: string | null
          deliverability_warnings: Json | null
          id: string
          is_winner: boolean | null
          opened: number | null
          replied: number | null
          sent: number | null
          sequence_id: string
          split_percentage: number
          step_index: number
          subject: string
          variant_label: string
        }
        Insert: {
          auto_disabled?: boolean
          auto_disabled_reason?: string | null
          body: string
          bounced?: number | null
          clicked?: number | null
          created_at?: string | null
          deliverability_score?: number | null
          deliverability_scored_at?: string | null
          deliverability_warnings?: Json | null
          id?: string
          is_winner?: boolean | null
          opened?: number | null
          replied?: number | null
          sent?: number | null
          sequence_id: string
          split_percentage: number
          step_index: number
          subject: string
          variant_label: string
        }
        Update: {
          auto_disabled?: boolean
          auto_disabled_reason?: string | null
          body?: string
          bounced?: number | null
          clicked?: number | null
          created_at?: string | null
          deliverability_score?: number | null
          deliverability_scored_at?: string | null
          deliverability_warnings?: Json | null
          id?: string
          is_winner?: boolean | null
          opened?: number | null
          replied?: number | null
          sent?: number | null
          sequence_id?: string
          split_percentage?: number
          step_index?: number
          subject?: string
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_ab_variants_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_address_verifications: {
        Row: {
          created_at: string
          domain: string
          email: string
          email_lower: string
          expires_at: string
          id: string
          is_catch_all: boolean
          is_disposable: boolean
          is_role: boolean
          is_spamtrap: boolean
          local_part: string
          organization_id: string
          provider: string
          raw_response: Json | null
          smtp_response_code: number | null
          status: string
          updated_at: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          email: string
          email_lower: string
          expires_at?: string
          id?: string
          is_catch_all?: boolean
          is_disposable?: boolean
          is_role?: boolean
          is_spamtrap?: boolean
          local_part: string
          organization_id: string
          provider: string
          raw_response?: Json | null
          smtp_response_code?: number | null
          status: string
          updated_at?: string
          verified_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          email?: string
          email_lower?: string
          expires_at?: string
          id?: string
          is_catch_all?: boolean
          is_disposable?: boolean
          is_role?: boolean
          is_spamtrap?: boolean
          local_part?: string
          organization_id?: string
          provider?: string
          raw_response?: Json | null
          smtp_response_code?: number | null
          status?: string
          updated_at?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_address_verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_content_hash_log: {
        Row: {
          content_hash: string
          id: string
          mailbox_id: string
          organization_id: string
          recipient_domain: string
          sent_at: string
          sequence_id: string | null
        }
        Insert: {
          content_hash: string
          id?: string
          mailbox_id: string
          organization_id: string
          recipient_domain: string
          sent_at?: string
          sequence_id?: string | null
        }
        Update: {
          content_hash?: string
          id?: string
          mailbox_id?: string
          organization_id?: string
          recipient_domain?: string
          sent_at?: string
          sequence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_content_hash_log_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_content_hash_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_content_hash_log_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_reconciliation_runs: {
        Row: {
          domains_blocked: number
          dry_run: boolean
          errors: Json
          finished_at: string | null
          id: string
          reputation_blocks: number
          rows_delivered: number
          rows_examined: number
          rows_exhausted: number
          rows_failed: number
          rows_pending: number
          rows_spam: number
          started_at: string
          tenants_considered: number
          tenants_traced: number
          trace_calls: number
        }
        Insert: {
          domains_blocked?: number
          dry_run?: boolean
          errors?: Json
          finished_at?: string | null
          id?: string
          reputation_blocks?: number
          rows_delivered?: number
          rows_examined?: number
          rows_exhausted?: number
          rows_failed?: number
          rows_pending?: number
          rows_spam?: number
          started_at?: string
          tenants_considered?: number
          tenants_traced?: number
          trace_calls?: number
        }
        Update: {
          domains_blocked?: number
          dry_run?: boolean
          errors?: Json
          finished_at?: string | null
          id?: string
          reputation_blocks?: number
          rows_delivered?: number
          rows_examined?: number
          rows_exhausted?: number
          rows_failed?: number
          rows_pending?: number
          rows_spam?: number
          started_at?: string
          tenants_considered?: number
          tenants_traced?: number
          trace_calls?: number
        }
        Relationships: []
      }
      email_dmarc_reports: {
        Row: {
          alignment_failures: Json | null
          dkim_pass_count: number
          dmarc_pass_count: number
          domain_id: string | null
          id: string
          ingested_at: string
          org_name: string | null
          organization_id: string
          policy_domain: string | null
          policy_p: string | null
          policy_pct: number | null
          raw_xml: string | null
          report_date_range_begin: string | null
          report_date_range_end: string | null
          report_email: string | null
          report_id: string
          spf_pass_count: number
          total_messages: number
        }
        Insert: {
          alignment_failures?: Json | null
          dkim_pass_count?: number
          dmarc_pass_count?: number
          domain_id?: string | null
          id?: string
          ingested_at?: string
          org_name?: string | null
          organization_id: string
          policy_domain?: string | null
          policy_p?: string | null
          policy_pct?: number | null
          raw_xml?: string | null
          report_date_range_begin?: string | null
          report_date_range_end?: string | null
          report_email?: string | null
          report_id: string
          spf_pass_count?: number
          total_messages?: number
        }
        Update: {
          alignment_failures?: Json | null
          dkim_pass_count?: number
          dmarc_pass_count?: number
          domain_id?: string | null
          id?: string
          ingested_at?: string
          org_name?: string | null
          organization_id?: string
          policy_domain?: string | null
          policy_p?: string | null
          policy_pct?: number | null
          raw_xml?: string | null
          report_date_range_begin?: string | null
          report_date_range_end?: string | null
          report_email?: string | null
          report_id?: string
          spf_pass_count?: number
          total_messages?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_dmarc_reports_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_dmarc_reports_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_dmarc_reports_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_dmarc_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_health_log: {
        Row: {
          blacklisted: boolean | null
          bounce_rate: number | null
          domain_health: string | null
          domain_id: string
          health_score: number | null
          id: string
          notes: string | null
          recorded_at: string | null
          spam_rate: number | null
          total_sent_7d: number | null
        }
        Insert: {
          blacklisted?: boolean | null
          bounce_rate?: number | null
          domain_health?: string | null
          domain_id: string
          health_score?: number | null
          id?: string
          notes?: string | null
          recorded_at?: string | null
          spam_rate?: number | null
          total_sent_7d?: number | null
        }
        Update: {
          blacklisted?: boolean | null
          bounce_rate?: number | null
          domain_health?: string | null
          domain_id?: string
          health_score?: number | null
          id?: string
          notes?: string | null
          recorded_at?: string | null
          spam_rate?: number | null
          total_sent_7d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_health_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_health_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_health_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_probe_seeds: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          organization_id: string
          provider: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          organization_id: string
          provider?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          organization_id?: string
          provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_probe_seeds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_probes: {
        Row: {
          checked_at: string | null
          created_at: string
          domain_id: string
          id: string
          mailbox_id: string | null
          organization_id: string
          outcome: string
          probe_token: string
          seed_email: string
          seed_provider: string | null
          send_error: string | null
          sent_at: string | null
          subject: string | null
          trace_attempts: number
          trace_detail: string | null
          trace_status: string | null
          transport: string | null
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          domain_id: string
          id?: string
          mailbox_id?: string | null
          organization_id: string
          outcome?: string
          probe_token: string
          seed_email: string
          seed_provider?: string | null
          send_error?: string | null
          sent_at?: string | null
          subject?: string | null
          trace_attempts?: number
          trace_detail?: string | null
          trace_status?: string | null
          transport?: string | null
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          domain_id?: string
          id?: string
          mailbox_id?: string | null
          organization_id?: string
          outcome?: string
          probe_token?: string
          seed_email?: string
          seed_provider?: string | null
          send_error?: string | null
          sent_at?: string | null
          subject?: string | null
          trace_attempts?: number
          trace_detail?: string | null
          trace_status?: string | null
          transport?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_probes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_probes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_probes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_probes_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_probes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_reputation_log: {
        Row: {
          delivery_errors: Json | null
          dkim_success_ratio: number | null
          dmarc_success_ratio: number | null
          domain_id: string
          domain_reputation: string | null
          id: string
          ip_reputation: string | null
          organization_id: string
          raw_payload: Json | null
          recorded_at: string
          recorded_for: string
          spam_rate: number | null
          spf_success_ratio: number | null
        }
        Insert: {
          delivery_errors?: Json | null
          dkim_success_ratio?: number | null
          dmarc_success_ratio?: number | null
          domain_id: string
          domain_reputation?: string | null
          id?: string
          ip_reputation?: string | null
          organization_id: string
          raw_payload?: Json | null
          recorded_at?: string
          recorded_for: string
          spam_rate?: number | null
          spf_success_ratio?: number | null
        }
        Update: {
          delivery_errors?: Json | null
          dkim_success_ratio?: number | null
          dmarc_success_ratio?: number | null
          domain_id?: string
          domain_reputation?: string | null
          id?: string
          ip_reputation?: string | null
          organization_id?: string
          raw_payload?: Json | null
          recorded_at?: string
          recorded_for?: string
          spam_rate?: number | null
          spf_success_ratio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_reputation_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_reputation_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_reputation_log_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_reputation_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_ip_reputation_log: {
        Row: {
          byo_server_ip_id: string | null
          data_commands: number | null
          filter_result: string | null
          id: string
          ip_address: unknown
          message_recipients: number | null
          organization_id: string
          raw_payload: Json | null
          rcpt_commands: number | null
          recorded_at: string
          recorded_for: string
          snds_status: string | null
          spam_complaint_rate: number | null
          trap_message_period_end: string | null
          trap_message_period_start: string | null
          trap_messages: number | null
        }
        Insert: {
          byo_server_ip_id?: string | null
          data_commands?: number | null
          filter_result?: string | null
          id?: string
          ip_address: unknown
          message_recipients?: number | null
          organization_id: string
          raw_payload?: Json | null
          rcpt_commands?: number | null
          recorded_at?: string
          recorded_for: string
          snds_status?: string | null
          spam_complaint_rate?: number | null
          trap_message_period_end?: string | null
          trap_message_period_start?: string | null
          trap_messages?: number | null
        }
        Update: {
          byo_server_ip_id?: string | null
          data_commands?: number | null
          filter_result?: string | null
          id?: string
          ip_address?: unknown
          message_recipients?: number | null
          organization_id?: string
          raw_payload?: Json | null
          rcpt_commands?: number | null
          recorded_at?: string
          recorded_for?: string
          snds_status?: string | null
          spam_complaint_rate?: number | null
          trap_message_period_end?: string | null
          trap_message_period_start?: string | null
          trap_messages?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_ip_reputation_log_byo_server_ip_id_fkey"
            columns: ["byo_server_ip_id"]
            isOneToOne: false
            referencedRelation: "byo_server_ips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_ip_reputation_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_mailbox_daily_stats: {
        Row: {
          bounced: number | null
          clicked: number | null
          delivered: number | null
          id: string
          mailbox_id: string
          opened: number | null
          replied: number | null
          sent: number | null
          spam_complaints: number | null
          stat_date: string
        }
        Insert: {
          bounced?: number | null
          clicked?: number | null
          delivered?: number | null
          id?: string
          mailbox_id: string
          opened?: number | null
          replied?: number | null
          sent?: number | null
          spam_complaints?: number | null
          stat_date?: string
        }
        Update: {
          bounced?: number | null
          clicked?: number | null
          delivered?: number | null
          id?: string
          mailbox_id?: string
          opened?: number | null
          replied?: number | null
          sent?: number | null
          spam_complaints?: number | null
          stat_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_mailbox_daily_stats_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_mailboxes: {
        Row: {
          bounce_rate: number | null
          connection_type: string | null
          created_at: string | null
          daily_limit: number | null
          daily_limit_baseline: number | null
          daily_sent: number | null
          daily_sent_reset_at: string | null
          display_name: string | null
          email_address: string
          engagement_metrics: Json | null
          engagement_score: number | null
          engagement_score_recorded_at: string | null
          first_name: string | null
          health_score: number | null
          id: string
          imap_connected: boolean | null
          last_error: string | null
          last_name: string | null
          last_send_at: string | null
          metadata: Json | null
          organization_id: string
          owner_user_id: string | null
          provider: string | null
          reply_rate: number | null
          sending_domain_id: string | null
          spam_rate: number | null
          status: string | null
          tags: string[] | null
          updated_at: string | null
          warmup_auto_adjust: boolean | null
          warmup_custom_tracking: boolean | null
          warmup_daily_rampup: number | null
          warmup_daily_reply_target: number | null
          warmup_day: number | null
          warmup_delivered_total: number
          warmup_enabled: boolean
          warmup_last_send_at: string | null
          warmup_max_daily: number | null
          warmup_randomize: boolean | null
          warmup_randomize_range: number | null
          warmup_reply_rate_target: number | null
          warmup_sends_total: number
          warmup_stall_alerted_at: string | null
          warmup_start_date: string | null
          warmup_tag: string | null
          warmup_weekdays_only: boolean | null
          zapmail_api_key_id: string | null
          zapmail_mailbox_id: string | null
        }
        Insert: {
          bounce_rate?: number | null
          connection_type?: string | null
          created_at?: string | null
          daily_limit?: number | null
          daily_limit_baseline?: number | null
          daily_sent?: number | null
          daily_sent_reset_at?: string | null
          display_name?: string | null
          email_address: string
          engagement_metrics?: Json | null
          engagement_score?: number | null
          engagement_score_recorded_at?: string | null
          first_name?: string | null
          health_score?: number | null
          id?: string
          imap_connected?: boolean | null
          last_error?: string | null
          last_name?: string | null
          last_send_at?: string | null
          metadata?: Json | null
          organization_id: string
          owner_user_id?: string | null
          provider?: string | null
          reply_rate?: number | null
          sending_domain_id?: string | null
          spam_rate?: number | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          warmup_auto_adjust?: boolean | null
          warmup_custom_tracking?: boolean | null
          warmup_daily_rampup?: number | null
          warmup_daily_reply_target?: number | null
          warmup_day?: number | null
          warmup_delivered_total?: number
          warmup_enabled?: boolean
          warmup_last_send_at?: string | null
          warmup_max_daily?: number | null
          warmup_randomize?: boolean | null
          warmup_randomize_range?: number | null
          warmup_reply_rate_target?: number | null
          warmup_sends_total?: number
          warmup_stall_alerted_at?: string | null
          warmup_start_date?: string | null
          warmup_tag?: string | null
          warmup_weekdays_only?: boolean | null
          zapmail_api_key_id?: string | null
          zapmail_mailbox_id?: string | null
        }
        Update: {
          bounce_rate?: number | null
          connection_type?: string | null
          created_at?: string | null
          daily_limit?: number | null
          daily_limit_baseline?: number | null
          daily_sent?: number | null
          daily_sent_reset_at?: string | null
          display_name?: string | null
          email_address?: string
          engagement_metrics?: Json | null
          engagement_score?: number | null
          engagement_score_recorded_at?: string | null
          first_name?: string | null
          health_score?: number | null
          id?: string
          imap_connected?: boolean | null
          last_error?: string | null
          last_name?: string | null
          last_send_at?: string | null
          metadata?: Json | null
          organization_id?: string
          owner_user_id?: string | null
          provider?: string | null
          reply_rate?: number | null
          sending_domain_id?: string | null
          spam_rate?: number | null
          status?: string | null
          tags?: string[] | null
          updated_at?: string | null
          warmup_auto_adjust?: boolean | null
          warmup_custom_tracking?: boolean | null
          warmup_daily_rampup?: number | null
          warmup_daily_reply_target?: number | null
          warmup_day?: number | null
          warmup_delivered_total?: number
          warmup_enabled?: boolean
          warmup_last_send_at?: string | null
          warmup_max_daily?: number | null
          warmup_randomize?: boolean | null
          warmup_randomize_range?: number | null
          warmup_reply_rate_target?: number | null
          warmup_sends_total?: number
          warmup_stall_alerted_at?: string | null
          warmup_start_date?: string | null
          warmup_tag?: string | null
          warmup_weekdays_only?: boolean | null
          zapmail_api_key_id?: string | null
          zapmail_mailbox_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_mailboxes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_mailboxes_sending_domain_id_fkey"
            columns: ["sending_domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_mailboxes_sending_domain_id_fkey"
            columns: ["sending_domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_mailboxes_sending_domain_id_fkey"
            columns: ["sending_domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_mailboxes_zapmail_api_key_id_fkey"
            columns: ["zapmail_api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      email_provider_lookup_outcomes: {
        Row: {
          campaign_id: string | null
          contact_id: string
          created_at: string
          id: string
          lead_list_id: string | null
          organization_id: string
          outcome: string
          provider: string
          source: string
        }
        Insert: {
          campaign_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          lead_list_id?: string | null
          organization_id: string
          outcome: string
          provider: string
          source: string
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          lead_list_id?: string | null
          organization_id?: string
          outcome?: string
          provider?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_provider_lookup_outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_provider_lookup_outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_provider_lookup_outcomes_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_provider_lookup_outcomes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          body: string | null
          bounce_handled_at: string | null
          bounced_at: string | null
          campaign_id: string | null
          clicked_at: string | null
          created_at: string | null
          crm_message_id: string | null
          email_in_reply_to: string | null
          email_message_id: string | null
          email_references: string[] | null
          error_category: string | null
          error_message: string | null
          id: string
          lead_id: string | null
          mailbox_id: string | null
          message_id: string | null
          opened_at: string | null
          organization_id: string
          recipient_email: string
          replied_at: string | null
          sent_at: string | null
          sequence_id: string | null
          sequence_step: number | null
          status: string | null
          subject: string | null
          trace_attempts: number
          trace_checked_at: string | null
          trace_status: string | null
          unsubscribed_at: string | null
          variant_id: string | null
        }
        Insert: {
          body?: string | null
          bounce_handled_at?: string | null
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string | null
          crm_message_id?: string | null
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_references?: string[] | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          mailbox_id?: string | null
          message_id?: string | null
          opened_at?: string | null
          organization_id: string
          recipient_email: string
          replied_at?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          sequence_step?: number | null
          status?: string | null
          subject?: string | null
          trace_attempts?: number
          trace_checked_at?: string | null
          trace_status?: string | null
          unsubscribed_at?: string | null
          variant_id?: string | null
        }
        Update: {
          body?: string | null
          bounce_handled_at?: string | null
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string | null
          crm_message_id?: string | null
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_references?: string[] | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          mailbox_id?: string | null
          message_id?: string | null
          opened_at?: string | null
          organization_id?: string
          recipient_email?: string
          replied_at?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          sequence_step?: number | null
          status?: string | null
          subject?: string | null
          trace_attempts?: number
          trace_checked_at?: string | null
          trace_status?: string | null
          unsubscribed_at?: string | null
          variant_id?: string | null
        }
        Relationships: []
      }
      email_sending_domains: {
        Row: {
          acs_comm_service_name: string | null
          acs_comm_service_resource_id: string | null
          acs_domain_resource_id: string | null
          acs_domain_verification_status: string | null
          acs_email_service_name: string | null
          acs_email_service_resource_id: string | null
          acs_entra_app_id: string | null
          acs_entra_app_object_id: string | null
          acs_entra_app_secret_encrypted: string | null
          acs_entra_sp_id: string | null
          acs_resource_group: string | null
          acs_smtp_username: string | null
          bounce_rate: number | null
          burned_at: string | null
          byo_helo_hostname: string | null
          byo_ip_pool: Json | null
          byo_postmaster_email: string | null
          byo_server_id: string | null
          byo_smtp_password_hash: string | null
          catchall_email: string | null
          catchall_enabled: boolean | null
          clean_probe_streak: number
          cloudflare_zone_id: string | null
          consecutive_550: number
          created_at: string | null
          daily_email_limit: number | null
          daily_emails_sent: number | null
          dkim_private_key_encrypted: string | null
          dkim_selector: string | null
          dkim_verified: boolean | null
          dmarc_email: string | null
          dmarc_verified: boolean | null
          dns_managed: boolean
          dns_provider_id: string | null
          dns_records: Json | null
          dns_status: string | null
          domain: string
          domain_health: string | null
          forwarding_email: string | null
          forwarding_url: string | null
          health_score: number | null
          health_status: string
          id: string
          inbound_webhook_subscription_id: string | null
          infra_type: string | null
          ip_assigned_at: string | null
          last_550_at: string | null
          last_550_reason: string | null
          last_dns_check_at: string | null
          last_health_check_at: string | null
          last_probe_at: string | null
          last_probe_result: string | null
          m365_domain_id: string | null
          m365_domain_verified: boolean | null
          m365_tenant_id: string | null
          mailbox_count: number | null
          max_mailboxes: number | null
          metadata: Json | null
          mx_verified: boolean
          nameservers_active: string[] | null
          nameservers_assigned: string[] | null
          next_probe_at: string | null
          organization_id: string
          public_ip: string | null
          public_ip_resource_id: string | null
          registrar_credentials_id: string | null
          replaced_by_id: string | null
          replaces_id: string | null
          reputation_block_reason: string | null
          reputation_blocked_at: string | null
          rest_until: string | null
          sending_paused_at: string | null
          sending_paused_by: string | null
          sending_pause_reason: string | null
          sender_addresses: Json | null
          spam_rate: number | null
          spf_verified: boolean | null
          subscription_id: string | null
          sync_avatars_to_m365: boolean | null
          updated_at: string | null
          vm_admin_password_encrypted: string | null
          vm_name: string | null
          vm_status: string | null
        }
        Insert: {
          acs_comm_service_name?: string | null
          acs_comm_service_resource_id?: string | null
          acs_domain_resource_id?: string | null
          acs_domain_verification_status?: string | null
          acs_email_service_name?: string | null
          acs_email_service_resource_id?: string | null
          acs_entra_app_id?: string | null
          acs_entra_app_object_id?: string | null
          acs_entra_app_secret_encrypted?: string | null
          acs_entra_sp_id?: string | null
          acs_resource_group?: string | null
          acs_smtp_username?: string | null
          bounce_rate?: number | null
          burned_at?: string | null
          byo_helo_hostname?: string | null
          byo_ip_pool?: Json | null
          byo_postmaster_email?: string | null
          byo_server_id?: string | null
          byo_smtp_password_hash?: string | null
          catchall_email?: string | null
          catchall_enabled?: boolean | null
          clean_probe_streak?: number
          cloudflare_zone_id?: string | null
          consecutive_550?: number
          created_at?: string | null
          daily_email_limit?: number | null
          daily_emails_sent?: number | null
          dkim_private_key_encrypted?: string | null
          dkim_selector?: string | null
          dkim_verified?: boolean | null
          dmarc_email?: string | null
          dmarc_verified?: boolean | null
          dns_managed?: boolean
          dns_provider_id?: string | null
          dns_records?: Json | null
          dns_status?: string | null
          domain: string
          domain_health?: string | null
          forwarding_email?: string | null
          forwarding_url?: string | null
          health_score?: number | null
          health_status?: string
          id?: string
          inbound_webhook_subscription_id?: string | null
          infra_type?: string | null
          ip_assigned_at?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          last_dns_check_at?: string | null
          last_health_check_at?: string | null
          last_probe_at?: string | null
          last_probe_result?: string | null
          m365_domain_id?: string | null
          m365_domain_verified?: boolean | null
          m365_tenant_id?: string | null
          mailbox_count?: number | null
          max_mailboxes?: number | null
          metadata?: Json | null
          mx_verified?: boolean
          nameservers_active?: string[] | null
          nameservers_assigned?: string[] | null
          next_probe_at?: string | null
          organization_id: string
          public_ip?: string | null
          public_ip_resource_id?: string | null
          registrar_credentials_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
          sender_addresses?: Json | null
          spam_rate?: number | null
          spf_verified?: boolean | null
          subscription_id?: string | null
          sync_avatars_to_m365?: boolean | null
          updated_at?: string | null
          vm_admin_password_encrypted?: string | null
          vm_name?: string | null
          vm_status?: string | null
        }
        Update: {
          acs_comm_service_name?: string | null
          acs_comm_service_resource_id?: string | null
          acs_domain_resource_id?: string | null
          acs_domain_verification_status?: string | null
          acs_email_service_name?: string | null
          acs_email_service_resource_id?: string | null
          acs_entra_app_id?: string | null
          acs_entra_app_object_id?: string | null
          acs_entra_app_secret_encrypted?: string | null
          acs_entra_sp_id?: string | null
          acs_resource_group?: string | null
          acs_smtp_username?: string | null
          bounce_rate?: number | null
          burned_at?: string | null
          byo_helo_hostname?: string | null
          byo_ip_pool?: Json | null
          byo_postmaster_email?: string | null
          byo_server_id?: string | null
          byo_smtp_password_hash?: string | null
          catchall_email?: string | null
          catchall_enabled?: boolean | null
          clean_probe_streak?: number
          cloudflare_zone_id?: string | null
          consecutive_550?: number
          created_at?: string | null
          daily_email_limit?: number | null
          daily_emails_sent?: number | null
          dkim_private_key_encrypted?: string | null
          dkim_selector?: string | null
          dkim_verified?: boolean | null
          dmarc_email?: string | null
          dmarc_verified?: boolean | null
          dns_managed?: boolean
          dns_provider_id?: string | null
          dns_records?: Json | null
          dns_status?: string | null
          domain?: string
          domain_health?: string | null
          forwarding_email?: string | null
          forwarding_url?: string | null
          health_score?: number | null
          health_status?: string
          id?: string
          inbound_webhook_subscription_id?: string | null
          infra_type?: string | null
          ip_assigned_at?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          last_dns_check_at?: string | null
          last_health_check_at?: string | null
          last_probe_at?: string | null
          last_probe_result?: string | null
          m365_domain_id?: string | null
          m365_domain_verified?: boolean | null
          m365_tenant_id?: string | null
          mailbox_count?: number | null
          max_mailboxes?: number | null
          metadata?: Json | null
          mx_verified?: boolean
          nameservers_active?: string[] | null
          nameservers_assigned?: string[] | null
          next_probe_at?: string | null
          organization_id?: string
          public_ip?: string | null
          public_ip_resource_id?: string | null
          registrar_credentials_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
          sender_addresses?: Json | null
          spam_rate?: number | null
          spf_verified?: boolean | null
          subscription_id?: string | null
          sync_avatars_to_m365?: boolean | null
          updated_at?: string | null
          vm_admin_password_encrypted?: string | null
          vm_name?: string | null
          vm_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sending_domains_byo_server_id_fkey"
            columns: ["byo_server_id"]
            isOneToOne: false
            referencedRelation: "byo_servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_dns_provider_id_fkey"
            columns: ["dns_provider_id"]
            isOneToOne: false
            referencedRelation: "dns_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            isOneToOne: false
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_registrar_credentials_id_fkey"
            columns: ["registrar_credentials_id"]
            isOneToOne: false
            referencedRelation: "registrar_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "azure_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_enrollments: {
        Row: {
          condition_waiting_since: string | null
          created_at: string | null
          current_step: number | null
          custom_data: Json | null
          cycle_number: number
          id: string
          lead_id: string
          mailbox_id: string | null
          metadata: Json | null
          next_send_at: string | null
          organization_id: string | null
          pause_reason: string | null
          paused_by_conversation_id: string | null
          resume_at: string | null
          sequence_id: string
          status: string | null
          updated_at: string | null
          variant_assignments: Json | null
        }
        Insert: {
          condition_waiting_since?: string | null
          created_at?: string | null
          current_step?: number | null
          custom_data?: Json | null
          cycle_number?: number
          id?: string
          lead_id: string
          mailbox_id?: string | null
          metadata?: Json | null
          next_send_at?: string | null
          organization_id?: string | null
          pause_reason?: string | null
          paused_by_conversation_id?: string | null
          resume_at?: string | null
          sequence_id: string
          status?: string | null
          updated_at?: string | null
          variant_assignments?: Json | null
        }
        Update: {
          condition_waiting_since?: string | null
          created_at?: string | null
          current_step?: number | null
          custom_data?: Json | null
          cycle_number?: number
          id?: string
          lead_id?: string
          mailbox_id?: string | null
          metadata?: Json | null
          next_send_at?: string | null
          organization_id?: string | null
          pause_reason?: string | null
          paused_by_conversation_id?: string | null
          resume_at?: string | null
          sequence_id?: string
          status?: string | null
          updated_at?: string | null
          variant_assignments?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_enrollments_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_enrollments_paused_by_conversation_id_fkey"
            columns: ["paused_by_conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_followup_rules: {
        Row: {
          campaign_id: string | null
          created_at: string
          delay_hours: number
          id: string
          is_active: boolean
          lead_magnet_campaign_id: string | null
          name: string
          organization_id: string
          sequence_id: string | null
          target_sequence_id: string
          total_triggered: number
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          delay_hours?: number
          id?: string
          is_active?: boolean
          lead_magnet_campaign_id?: string | null
          name: string
          organization_id: string
          sequence_id?: string | null
          target_sequence_id: string
          total_triggered?: number
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          delay_hours?: number
          id?: string
          is_active?: boolean
          lead_magnet_campaign_id?: string | null
          name?: string
          organization_id?: string
          sequence_id?: string | null
          target_sequence_id?: string
          total_triggered?: number
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_followup_rules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_followup_rules_lead_magnet_campaign_id_fkey"
            columns: ["lead_magnet_campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "email_sequence_followup_rules_lead_magnet_campaign_id_fkey"
            columns: ["lead_magnet_campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_followup_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_followup_rules_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_followup_rules_target_sequence_id_fkey"
            columns: ["target_sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_jobs: {
        Row: {
          completed_at: string | null
          contact_ids: string[]
          created_at: string | null
          current_contact_name: string | null
          email_count: number
          error_message: string | null
          failed_count: number | null
          generated_count: number | null
          generation_config: Json
          id: string
          job_type: string
          model: string
          notion_config: Json | null
          notion_failed_count: number | null
          notion_generated_count: number | null
          notion_skipped_count: number | null
          organization_id: string
          progress: number | null
          pushed_count: number | null
          results: Json | null
          skipped_count: number | null
          started_at: string | null
          status: string
          total_contacts: number | null
        }
        Insert: {
          completed_at?: string | null
          contact_ids: string[]
          created_at?: string | null
          current_contact_name?: string | null
          email_count?: number
          error_message?: string | null
          failed_count?: number | null
          generated_count?: number | null
          generation_config?: Json
          id?: string
          job_type?: string
          model?: string
          notion_config?: Json | null
          notion_failed_count?: number | null
          notion_generated_count?: number | null
          notion_skipped_count?: number | null
          organization_id: string
          progress?: number | null
          pushed_count?: number | null
          results?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          total_contacts?: number | null
        }
        Update: {
          completed_at?: string | null
          contact_ids?: string[]
          created_at?: string | null
          current_contact_name?: string | null
          email_count?: number
          error_message?: string | null
          failed_count?: number | null
          generated_count?: number | null
          generation_config?: Json
          id?: string
          job_type?: string
          model?: string
          notion_config?: Json | null
          notion_failed_count?: number | null
          notion_generated_count?: number | null
          notion_skipped_count?: number | null
          organization_id?: string
          progress?: number | null
          pushed_count?: number | null
          results?: Json | null
          skipped_count?: number | null
          started_at?: string | null
          status?: string
          total_contacts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          agent_profile_id: string | null
          auto_enroll_new_members: boolean
          autopilot_config: Json | null
          campaign_id: string | null
          created_at: string | null
          enroll_filter_criteria: Json
          id: string
          knowledge_document_ids: string[] | null
          lead_list_id: string | null
          lead_list_ids: string[]
          name: string
          organization_id: string
          settings: Json | null
          source_type: string | null
          status: string | null
          steps: Json
          tracking_domain_id: string | null
          updated_at: string | null
        }
        Insert: {
          agent_profile_id?: string | null
          auto_enroll_new_members?: boolean
          autopilot_config?: Json | null
          campaign_id?: string | null
          created_at?: string | null
          enroll_filter_criteria?: Json
          id?: string
          knowledge_document_ids?: string[] | null
          lead_list_id?: string | null
          lead_list_ids?: string[]
          name: string
          organization_id: string
          settings?: Json | null
          source_type?: string | null
          status?: string | null
          steps?: Json
          tracking_domain_id?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_profile_id?: string | null
          auto_enroll_new_members?: boolean
          autopilot_config?: Json | null
          campaign_id?: string | null
          created_at?: string | null
          enroll_filter_criteria?: Json
          id?: string
          knowledge_document_ids?: string[] | null
          lead_list_id?: string | null
          lead_list_ids?: string[]
          name?: string
          organization_id?: string
          settings?: Json | null
          source_type?: string | null
          status?: string | null
          steps?: Json
          tracking_domain_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequences_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequences_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequences_tracking_domain_id_fkey"
            columns: ["tracking_domain_id"]
            isOneToOne: false
            referencedRelation: "email_tracking_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      email_tool_connections: {
        Row: {
          api_key_encrypted: string
          created_at: string | null
          default_campaign_id: string | null
          error_message: string | null
          id: string
          last_verified_at: string | null
          name: string
          organization_id: string
          status: string | null
          tool_type: string
          updated_at: string | null
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string | null
          default_campaign_id?: string | null
          error_message?: string | null
          id?: string
          last_verified_at?: string | null
          name: string
          organization_id: string
          status?: string | null
          tool_type: string
          updated_at?: string | null
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string | null
          default_campaign_id?: string | null
          error_message?: string | null
          id?: string
          last_verified_at?: string | null
          name?: string
          organization_id?: string
          status?: string | null
          tool_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_tool_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_tracking_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          is_default: boolean
          is_verified: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          is_default?: boolean
          is_verified?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          is_default?: boolean
          is_verified?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verification_jobs: {
        Row: {
          apify_actor_id: string
          apify_dataset_id: string | null
          apify_run_id: string | null
          cache_hit_count: number
          contact_ids: string[] | null
          created_at: string
          created_by: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          list_id: string | null
          organization_id: string
          started_at: string | null
          status: string
          submitted_count: number
          tier1_drop_count: number
          verified_count: number
        }
        Insert: {
          apify_actor_id: string
          apify_dataset_id?: string | null
          apify_run_id?: string | null
          cache_hit_count?: number
          contact_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          list_id?: string | null
          organization_id: string
          started_at?: string | null
          status?: string
          submitted_count?: number
          tier1_drop_count?: number
          verified_count?: number
        }
        Update: {
          apify_actor_id?: string
          apify_dataset_id?: string | null
          apify_run_id?: string | null
          cache_hit_count?: number
          contact_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          list_id?: string | null
          organization_id?: string
          started_at?: string | null
          status?: string
          submitted_count?: number
          tier1_drop_count?: number
          verified_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_verification_jobs_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_verification_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verification_progress: {
        Row: {
          apify_submitted: number
          cache_hits: number
          list_id: string
          organization_id: string
          phase: string
          processed: number
          started_at: string
          tier1_drops: number
          tier1_passes: number
          total: number
          updated_at: string
        }
        Insert: {
          apify_submitted?: number
          cache_hits?: number
          list_id: string
          organization_id: string
          phase?: string
          processed?: number
          started_at?: string
          tier1_drops?: number
          tier1_passes?: number
          total: number
          updated_at?: string
        }
        Update: {
          apify_submitted?: number
          cache_hits?: number
          list_id?: string
          organization_id?: string
          phase?: string
          processed?: number
          started_at?: string
          tier1_drops?: number
          tier1_passes?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_verification_progress_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: true
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      email_warmup_sends: {
        Row: {
          created_at: string
          error: string | null
          from_mailbox_id: string
          from_organization_id: string | null
          id: string
          is_reply: boolean
          last_rescue_attempt_at: string | null
          message_id: string | null
          parent_send_id: string | null
          placement: string | null
          placement_attempts: number
          placement_checked_at: string | null
          replied_at: string | null
          rescue_attempts: number
          rescued_at: string | null
          sent_at: string | null
          status: string
          subject: string
          to_mailbox_id: string
          to_organization_id: string | null
          transport: string | null
          warmup_ref: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          from_mailbox_id: string
          from_organization_id?: string | null
          id?: string
          is_reply?: boolean
          last_rescue_attempt_at?: string | null
          message_id?: string | null
          parent_send_id?: string | null
          placement?: string | null
          placement_attempts?: number
          placement_checked_at?: string | null
          replied_at?: string | null
          rescue_attempts?: number
          rescued_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          to_mailbox_id: string
          to_organization_id?: string | null
          transport?: string | null
          warmup_ref: string
        }
        Update: {
          created_at?: string
          error?: string | null
          from_mailbox_id?: string
          from_organization_id?: string | null
          id?: string
          is_reply?: boolean
          last_rescue_attempt_at?: string | null
          message_id?: string | null
          parent_send_id?: string | null
          placement?: string | null
          placement_attempts?: number
          placement_checked_at?: string | null
          replied_at?: string | null
          rescue_attempts?: number
          rescued_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_mailbox_id?: string
          to_organization_id?: string | null
          transport?: string | null
          warmup_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_warmup_sends_from_mailbox_id_fkey"
            columns: ["from_mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_warmup_sends_parent_send_id_fkey"
            columns: ["parent_send_id"]
            isOneToOne: false
            referencedRelation: "email_warmup_sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_warmup_sends_to_mailbox_id_fkey"
            columns: ["to_mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_history: {
        Row: {
          contact_id: string
          created_at: string | null
          credits_used: number | null
          data_applied: boolean | null
          data_found: Json | null
          enrichment_type: string
          id: string
          organization_id: string
          provider: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          credits_used?: number | null
          data_applied?: boolean | null
          data_found?: Json | null
          enrichment_type: string
          id?: string
          organization_id: string
          provider: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          credits_used?: number | null
          data_applied?: boolean | null
          data_found?: Json | null
          enrichment_type?: string
          id?: string
          organization_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_jobs: {
        Row: {
          attempts: number | null
          contact_id: string
          created_at: string | null
          credits_used: number | null
          enrichment_type: string
          error_message: string | null
          id: string
          organization_id: string
          priority: number | null
          processed_at: string | null
          provider: string | null
          result: Json | null
          source: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          contact_id: string
          created_at?: string | null
          credits_used?: number | null
          enrichment_type: string
          error_message?: string | null
          id?: string
          organization_id: string
          priority?: number | null
          processed_at?: string | null
          provider?: string | null
          result?: Json | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          contact_id?: string
          created_at?: string | null
          credits_used?: number | null
          enrichment_type?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          priority?: number | null
          processed_at?: string | null
          provider?: string | null
          result?: Json | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_provider_daily_usage: {
        Row: {
          daily_cap: number
          organization_id: string
          provider: string
          request_count: number
          usage_date: string
        }
        Insert: {
          daily_cap: number
          organization_id: string
          provider: string
          request_count?: number
          usage_date?: string
        }
        Update: {
          daily_cap?: number
          organization_id?: string
          provider?: string
          request_count?: number
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_provider_daily_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_provider_fairness_state: {
        Row: {
          last_served_at: string
          last_served_list_id: string | null
          organization_id: string
          provider: string
        }
        Insert: {
          last_served_at?: string
          last_served_list_id?: string | null
          organization_id: string
          provider: string
        }
        Update: {
          last_served_at?: string
          last_served_list_id?: string | null
          organization_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_provider_fairness_state_last_served_list_id_fkey"
            columns: ["last_served_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_provider_fairness_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_provider_rate_limit_state: {
        Row: {
          next_slot_at: string
          organization_id: string
          provider: string
          recent_records: number
          recent_requests: number
          updated_at: string
        }
        Insert: {
          next_slot_at?: string
          organization_id: string
          provider: string
          recent_records?: number
          recent_requests?: number
          updated_at?: string
        }
        Update: {
          next_slot_at?: string
          organization_id?: string
          provider?: string
          recent_records?: number
          recent_requests?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_provider_rate_limit_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_provider_request_events: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          provider: string
          requests_per_minute: number
          scheduled_at: string | null
          status: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          provider: string
          requests_per_minute: number
          scheduled_at?: string | null
          status: string
          usage_date?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          requests_per_minute?: number
          scheduled_at?: string | null
          status?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_provider_request_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_pages: {
        Row: {
          bullet_points: string[] | null
          content: Json
          created_at: string | null
          cta_text: string | null
          decline_text: string | null
          design_config: Json | null
          funnel_id: string
          headline: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          on_accept_step: number | null
          on_decline_step: number | null
          page_type: string
          slug_suffix: string | null
          step_order: number
          subheadline: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          bullet_points?: string[] | null
          content?: Json
          created_at?: string | null
          cta_text?: string | null
          decline_text?: string | null
          design_config?: Json | null
          funnel_id: string
          headline?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          on_accept_step?: number | null
          on_decline_step?: number | null
          page_type: string
          slug_suffix?: string | null
          step_order: number
          subheadline?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          bullet_points?: string[] | null
          content?: Json
          created_at?: string | null
          cta_text?: string | null
          decline_text?: string | null
          design_config?: Json | null
          funnel_id?: string
          headline?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          on_accept_step?: number | null
          on_decline_step?: number | null
          page_type?: string
          slug_suffix?: string | null
          step_order?: number
          subheadline?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_pages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_pages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_products: {
        Row: {
          config: Json | null
          created_at: string | null
          display_order: number | null
          funnel_id: string
          id: string
          page_id: string | null
          product_id: string
          role: string
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          display_order?: number | null
          funnel_id: string
          id?: string
          page_id?: string | null
          product_id: string
          role: string
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          display_order?: number | null
          funnel_id?: string
          id?: string
          page_id?: string | null
          product_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_products_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_products_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_products_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "funnel_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          config: Json
          created_at: string | null
          domain: string | null
          id: string
          name: string
          niche: string
          org_id: string
          slug: string
          status: string
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          domain?: string | null
          id?: string
          name: string
          niche: string
          org_id: string
          slug: string
          status?: string
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          domain?: string | null
          id?: string
          name?: string
          niche?: string
          org_id?: string
          slug?: string
          status?: string
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_appointment_log: {
        Row: {
          appointment_status: string | null
          contact_id: string
          conversation_id: string
          created_at: string | null
          end_time: string
          ghl_appointment_id: string | null
          ghl_calendar_id: string
          ghl_contact_id: string | null
          id: string
          notes: string | null
          organization_id: string
          queue_item_id: string | null
          source_id: string | null
          source_type: string
          start_time: string
          timezone: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          appointment_status?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string | null
          end_time: string
          ghl_appointment_id?: string | null
          ghl_calendar_id: string
          ghl_contact_id?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          queue_item_id?: string | null
          source_id?: string | null
          source_type: string
          start_time: string
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          appointment_status?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string | null
          end_time?: string
          ghl_appointment_id?: string | null
          ghl_calendar_id?: string
          ghl_contact_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          queue_item_id?: string | null
          source_id?: string | null
          source_type?: string
          start_time?: string
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_appointment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_appointment_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_appointment_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_appointment_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_calendar_cache: {
        Row: {
          calendar_description: string | null
          calendar_id: string
          calendar_name: string
          calendar_type: string | null
          created_at: string | null
          group_id: string | null
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          location_id: string
          organization_id: string
          raw_data: Json | null
          updated_at: string | null
        }
        Insert: {
          calendar_description?: string | null
          calendar_id: string
          calendar_name: string
          calendar_type?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          location_id: string
          organization_id: string
          raw_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          calendar_description?: string | null
          calendar_id?: string
          calendar_name?: string
          calendar_type?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          location_id?: string
          organization_id?: string
          raw_data?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_calendar_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_oauth_tokens: {
        Row: {
          access_token_encrypted: string
          company_id: string | null
          created_at: string | null
          expires_at: string
          ghl_user_id: string | null
          id: string
          location_id: string
          organization_id: string
          refresh_token_encrypted: string
          scopes: string[] | null
          updated_at: string | null
        }
        Insert: {
          access_token_encrypted: string
          company_id?: string | null
          created_at?: string | null
          expires_at: string
          ghl_user_id?: string | null
          id?: string
          location_id: string
          organization_id: string
          refresh_token_encrypted: string
          scopes?: string[] | null
          updated_at?: string | null
        }
        Update: {
          access_token_encrypted?: string
          company_id?: string | null
          created_at?: string | null
          expires_at?: string
          ghl_user_id?: string | null
          id?: string
          location_id?: string
          organization_id?: string
          refresh_token_encrypted?: string
          scopes?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_oauth_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_published_posts: {
        Row: {
          content_output_id: string
          created_at: string | null
          error_message: string | null
          ghl_post_id: string | null
          id: string
          organization_id: string
          platform: string
          platform_account_id: string
          platform_account_name: string | null
          published_at: string | null
          scheduled_for: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          content_output_id: string
          created_at?: string | null
          error_message?: string | null
          ghl_post_id?: string | null
          id?: string
          organization_id: string
          platform: string
          platform_account_id: string
          platform_account_name?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          content_output_id?: string
          created_at?: string | null
          error_message?: string | null
          ghl_post_id?: string | null
          id?: string
          organization_id?: string
          platform?: string
          platform_account_id?: string
          platform_account_name?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_published_posts_content_output_id_fkey"
            columns: ["content_output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_published_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      heygen_webhook_endpoints: {
        Row: {
          created_at: string | null
          endpoint_id: string
          events: string[]
          id: string
          organization_id: string
          secret: string
          status: string
        }
        Insert: {
          created_at?: string | null
          endpoint_id: string
          events?: string[]
          id?: string
          organization_id: string
          secret: string
          status?: string
        }
        Update: {
          created_at?: string | null
          endpoint_id?: string
          events?: string[]
          id?: string
          organization_id?: string
          secret?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "heygen_webhook_endpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      icp_block_fit: {
        Row: {
          block_id: string
          created_at: string | null
          fit_score: number | null
          icp_id: string
          id: string
          notes: string | null
        }
        Insert: {
          block_id: string
          created_at?: string | null
          fit_score?: number | null
          icp_id: string
          id?: string
          notes?: string | null
        }
        Update: {
          block_id?: string
          created_at?: string | null
          fit_score?: number | null
          icp_id?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "icp_block_fit_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "library_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "icp_block_fit_icp_id_fkey"
            columns: ["icp_id"]
            isOneToOne: false
            referencedRelation: "library_icps"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_folders: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_tag_assignments: {
        Row: {
          created_at: string | null
          id: string
          idea_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          idea_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          idea_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idea_tag_assignments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "idea_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_tags: {
        Row: {
          created_at: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_logs: {
        Row: {
          action: string
          created_at: string | null
          ended_at: string | null
          id: string
          super_admin_id: string
          target_organization_id: string
          target_organization_name: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          ended_at?: string | null
          id?: string
          super_admin_id: string
          target_organization_id: string
          target_organization_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          ended_at?: string | null
          id?: string
          super_admin_id?: string
          target_organization_id?: string
          target_organization_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_logs_super_admin_id_fkey"
            columns: ["super_admin_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "impersonation_logs_super_admin_id_fkey"
            columns: ["super_admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_logs_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_autopilot_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          contact_id: string
          conversation_id: string
          created_at: string | null
          draft_message: string
          draft_subject: string | null
          id: string
          metadata: Json | null
          organization_id: string
          owner_user_id: string | null
          status: string
          trigger_intent: string
          trigger_message_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string | null
          draft_message: string
          draft_subject?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          owner_user_id?: string | null
          status?: string
          trigger_intent: string
          trigger_message_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string | null
          draft_message?: string
          draft_subject?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          owner_user_id?: string | null
          status?: string
          trigger_intent?: string
          trigger_message_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbox_autopilot_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_canned_responses: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          shortcut: string | null
          title: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          shortcut?: string | null
          title: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          shortcut?: string | null
          title?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "inbox_canned_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_keyword_exclusions: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          keyword: string
          normalized_keyword: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          keyword: string
          normalized_keyword: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          keyword?: string
          normalized_keyword?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_keyword_exclusions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_keyword_sweep_queue: {
        Row: {
          attempts: number
          contacts_archived: number | null
          conversations_excluded: number | null
          error: string | null
          finished_at: string | null
          id: number
          keyword_cursor: number
          next_attempt_at: string
          organization_id: string
          requested_at: string
          started_at: string | null
        }
        Insert: {
          attempts?: number
          contacts_archived?: number | null
          conversations_excluded?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          keyword_cursor?: number
          next_attempt_at?: string
          organization_id: string
          requested_at?: string
          started_at?: string | null
        }
        Update: {
          attempts?: number
          contacts_archived?: number | null
          conversations_excluded?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          keyword_cursor?: number
          next_attempt_at?: string
          organization_id?: string
          requested_at?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbox_keyword_sweep_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_user_tone_profiles: {
        Row: {
          channel: string
          example_messages: string[] | null
          id: string
          last_updated_at: string | null
          organization_id: string
          tone_summary: string | null
          user_id: string
        }
        Insert: {
          channel: string
          example_messages?: string[] | null
          id?: string
          last_updated_at?: string | null
          organization_id: string
          tone_summary?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          example_messages?: string[] | null
          id?: string
          last_updated_at?: string | null
          organization_id?: string
          tone_summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      infra_byo_jobs: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input: Json
          job_type: string
          locked_until: string | null
          log: string | null
          max_attempts: number
          organization_id: string
          output: Json
          started_at: string | null
          status: string
          target_id: string | null
          target_kind: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          job_type: string
          locked_until?: string | null
          log?: string | null
          max_attempts?: number
          organization_id: string
          output?: Json
          started_at?: string | null
          status?: string
          target_id?: string | null
          target_kind: string
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          job_type?: string
          locked_until?: string | null
          log?: string | null
          max_attempts?: number
          organization_id?: string
          output?: Json
          started_at?: string | null
          status?: string
          target_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "infra_byo_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          last_resent_at: string | null
          organization_id: string
          resent_count: number | null
          role: string | null
          status: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          last_resent_at?: string | null
          organization_id: string
          resent_count?: number | null
          role?: string | null
          status?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_resent_at?: string | null
          organization_id?: string
          resent_count?: number | null
          role?: string | null
          status?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          error_stack: string | null
          expires_at: string | null
          id: string
          job_name: string
          job_type: string
          max_retries: number
          metadata: Json | null
          organization_id: string
          payload: Json
          priority: number
          retry_count: number
          scheduled_for: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          error_stack?: string | null
          expires_at?: string | null
          id?: string
          job_name: string
          job_type: string
          max_retries?: number
          metadata?: Json | null
          organization_id: string
          payload?: Json
          priority?: number
          retry_count?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          error_stack?: string | null
          expires_at?: string | null
          id?: string
          job_name?: string
          job_type?: string
          max_retries?: number
          metadata?: Json | null
          organization_id?: string
          payload?: Json
          priority?: number
          retry_count?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          organization_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_documents: {
        Row: {
          chunk_count: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          file_path: string | null
          file_size_bytes: number | null
          file_type: string
          id: string
          name: string
          organization_id: string
          processing_error: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type: string
          id?: string
          name: string
          organization_id: string
          processing_error?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          chunk_count?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type?: string
          id?: string
          name?: string
          organization_id?: string
          processing_error?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_decision_makers: {
        Row: {
          claude_reasoning: string | null
          company_id: string
          confidence: number | null
          created_at: string
          first_name: string
          id: string
          job_id: string
          last_name: string | null
          linkedin_url: string | null
          middle_name: string | null
          name_flags: Json
          organization_id: string
          seniority_score: number | null
          source_page: string | null
          title: string | null
        }
        Insert: {
          claude_reasoning?: string | null
          company_id: string
          confidence?: number | null
          created_at?: string
          first_name: string
          id?: string
          job_id: string
          last_name?: string | null
          linkedin_url?: string | null
          middle_name?: string | null
          name_flags?: Json
          organization_id: string
          seniority_score?: number | null
          source_page?: string | null
          title?: string | null
        }
        Update: {
          claude_reasoning?: string | null
          company_id?: string
          confidence?: number | null
          created_at?: string
          first_name?: string
          id?: string
          job_id?: string
          last_name?: string | null
          linkedin_url?: string | null
          middle_name?: string | null
          name_flags?: Json
          organization_id?: string
          seniority_score?: number | null
          source_page?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lb_decision_makers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "lb_discovered_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_decision_makers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_decision_makers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_discovered_companies: {
        Row: {
          address: string | null
          city: string | null
          company_name: string
          country: string | null
          dm_attempt_count: number
          dm_dead: boolean
          dm_dead_reason: string | null
          dm_last_attempted_at: string | null
          domain: string | null
          employee_count_estimate: number | null
          employee_signal: string | null
          filter_status: string
          firmographics_checked_at: string | null
          firmographics_source: string | null
          id: string
          job_id: string
          linkedin_url: string | null
          organization_id: string
          phone: string | null
          raw_html_snippet: string | null
          revenue_range: string | null
          scraped_at: string
          source: string
          state: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name: string
          country?: string | null
          dm_attempt_count?: number
          dm_dead?: boolean
          dm_dead_reason?: string | null
          dm_last_attempted_at?: string | null
          domain?: string | null
          employee_count_estimate?: number | null
          employee_signal?: string | null
          filter_status?: string
          firmographics_checked_at?: string | null
          firmographics_source?: string | null
          id?: string
          job_id: string
          linkedin_url?: string | null
          organization_id: string
          phone?: string | null
          raw_html_snippet?: string | null
          revenue_range?: string | null
          scraped_at?: string
          source: string
          state?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string
          country?: string | null
          dm_attempt_count?: number
          dm_dead?: boolean
          dm_dead_reason?: string | null
          dm_last_attempted_at?: string | null
          domain?: string | null
          employee_count_estimate?: number | null
          employee_signal?: string | null
          filter_status?: string
          firmographics_checked_at?: string | null
          firmographics_source?: string | null
          id?: string
          job_id?: string
          linkedin_url?: string | null
          organization_id?: string
          phone?: string | null
          raw_html_snippet?: string | null
          revenue_range?: string | null
          scraped_at?: string
          source?: string
          state?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lb_discovered_companies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_discovered_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_domain_index: {
        Row: {
          address_raw: string | null
          city: string | null
          country: string | null
          domain: string
          email: string | null
          employee_signal: string | null
          enriched_at: string
          id: string
          industry_keywords: string[]
          meta_description: string | null
          organization_id: string
          phone: string | null
          schema_org_type: string | null
          source: string
          state: string | null
          tech_stack: string[]
          title: string | null
          website_url: string | null
        }
        Insert: {
          address_raw?: string | null
          city?: string | null
          country?: string | null
          domain: string
          email?: string | null
          employee_signal?: string | null
          enriched_at?: string
          id?: string
          industry_keywords?: string[]
          meta_description?: string | null
          organization_id: string
          phone?: string | null
          schema_org_type?: string | null
          source?: string
          state?: string | null
          tech_stack?: string[]
          title?: string | null
          website_url?: string | null
        }
        Update: {
          address_raw?: string | null
          city?: string | null
          country?: string | null
          domain?: string
          email?: string | null
          employee_signal?: string | null
          enriched_at?: string
          id?: string
          industry_keywords?: string[]
          meta_description?: string | null
          organization_id?: string
          phone?: string | null
          schema_org_type?: string | null
          source?: string
          state?: string | null
          tech_stack?: string[]
          title?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lb_domain_index_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_email_verifications: {
        Row: {
          attempts: number
          catch_all: boolean
          dm_id: string
          email: string
          engagement_status: string | null
          engagement_window_ends_at: string | null
          error: string | null
          id: string
          job_id: string
          organization_id: string
          pattern: string | null
          proxy_id: string | null
          smtp_response_code: number | null
          status: string
          tier: number | null
          verified_at: string
        }
        Insert: {
          attempts?: number
          catch_all?: boolean
          dm_id: string
          email: string
          engagement_status?: string | null
          engagement_window_ends_at?: string | null
          error?: string | null
          id?: string
          job_id: string
          organization_id: string
          pattern?: string | null
          proxy_id?: string | null
          smtp_response_code?: number | null
          status: string
          tier?: number | null
          verified_at?: string
        }
        Update: {
          attempts?: number
          catch_all?: boolean
          dm_id?: string
          email?: string
          engagement_status?: string | null
          engagement_window_ends_at?: string | null
          error?: string | null
          id?: string
          job_id?: string
          organization_id?: string
          pattern?: string | null
          proxy_id?: string | null
          smtp_response_code?: number | null
          status?: string
          tier?: number | null
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lb_email_verifications_dm_id_fkey"
            columns: ["dm_id"]
            isOneToOne: false
            referencedRelation: "lb_decision_makers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_email_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_email_verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_enriched_leads: {
        Row: {
          claude_reasoning: string | null
          company_id: string
          created_at: string
          dm_id: string
          email_status: string
          exported_at: string | null
          exported_lead_id: string | null
          fit_label: string
          icp_score: number
          id: string
          job_id: string
          organization_id: string
          score_breakdown: Json
          verified_email: string
        }
        Insert: {
          claude_reasoning?: string | null
          company_id: string
          created_at?: string
          dm_id: string
          email_status: string
          exported_at?: string | null
          exported_lead_id?: string | null
          fit_label: string
          icp_score: number
          id?: string
          job_id: string
          organization_id: string
          score_breakdown?: Json
          verified_email: string
        }
        Update: {
          claude_reasoning?: string | null
          company_id?: string
          created_at?: string
          dm_id?: string
          email_status?: string
          exported_at?: string | null
          exported_lead_id?: string | null
          fit_label?: string
          icp_score?: number
          id?: string
          job_id?: string
          organization_id?: string
          score_breakdown?: Json
          verified_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "lb_enriched_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "lb_discovered_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_enriched_leads_dm_id_fkey"
            columns: ["dm_id"]
            isOneToOne: false
            referencedRelation: "lb_decision_makers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_enriched_leads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_enriched_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_job_logs: {
        Row: {
          created_at: string
          data: Json | null
          id: number
          job_id: string
          level: string
          message: string
          stage: string
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: number
          job_id: string
          level?: string
          message: string
          stage: string
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: number
          job_id?: string
          level?: string
          message?: string
          stage?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lb_job_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_mx_throughput: {
        Row: {
          attempts: number
          minute_bucket: string
          mx_host: string
          rate_limit_hits: number
          successes: number
        }
        Insert: {
          attempts?: number
          minute_bucket: string
          mx_host: string
          rate_limit_hits?: number
          successes?: number
        }
        Update: {
          attempts?: number
          minute_bucket?: string
          mx_host?: string
          rate_limit_hits?: number
          successes?: number
        }
        Relationships: []
      }
      lb_proxy_pool: {
        Row: {
          active: boolean
          created_at: string
          fail_count: number
          host: string
          id: string
          last_failed_at: string | null
          last_used_at: string | null
          organization_id: string | null
          password_enc: string | null
          port: number
          provider: string
          proxy_type: string
          retired_at: string | null
          success_count: number
          username_enc: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          fail_count?: number
          host: string
          id?: string
          last_failed_at?: string | null
          last_used_at?: string | null
          organization_id?: string | null
          password_enc?: string | null
          port: number
          provider: string
          proxy_type: string
          retired_at?: string | null
          success_count?: number
          username_enc?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          fail_count?: number
          host?: string
          id?: string
          last_failed_at?: string | null
          last_used_at?: string | null
          organization_id?: string | null
          password_enc?: string | null
          port?: number
          provider?: string
          proxy_type?: string
          retired_at?: string | null
          success_count?: number
          username_enc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lb_proxy_pool_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_work_items: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          depends_on: number | null
          error: string | null
          id: number
          job_id: string
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on?: number | null
          error?: string | null
          id?: number
          job_id: string
          max_attempts?: number
          organization_id: string
          payload: Json
          priority?: number
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on?: number | null
          error?: string | null
          id?: number
          job_id?: string
          max_attempts?: number
          organization_id?: string
          payload?: Json
          priority?: number
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lb_work_items_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "lb_work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lb_work_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      lb_worker_heartbeats: {
        Row: {
          current_job_id: string | null
          in_flight_items: number
          kind: string
          last_seen_at: string
          throughput_per_sec: number
          worker_id: string
        }
        Insert: {
          current_job_id?: string | null
          in_flight_items?: number
          kind: string
          last_seen_at?: string
          throughput_per_sec?: number
          worker_id: string
        }
        Update: {
          current_job_id?: string | null
          in_flight_items?: number
          kind?: string
          last_seen_at?: string
          throughput_per_sec?: number
          worker_id?: string
        }
        Relationships: []
      }
      lead_handoffs: {
        Row: {
          campaign_id: string | null
          connection_id: string | null
          contact_id: string
          created_at: string | null
          deleted_at: string | null
          deletion_error: string | null
          deletion_status: string | null
          email_body: string | null
          email_subject: string | null
          error_message: string | null
          external_campaign_id: string | null
          external_lead_id: string | null
          external_workflow_id: string | null
          id: string
          organization_id: string | null
          progress_id: string | null
          push_mode: string | null
          pushed_at: string | null
          retry_count: number | null
          status: string | null
          tool_type: string
          updated_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          connection_id?: string | null
          contact_id: string
          created_at?: string | null
          deleted_at?: string | null
          deletion_error?: string | null
          deletion_status?: string | null
          email_body?: string | null
          email_subject?: string | null
          error_message?: string | null
          external_campaign_id?: string | null
          external_lead_id?: string | null
          external_workflow_id?: string | null
          id?: string
          organization_id?: string | null
          progress_id?: string | null
          push_mode?: string | null
          pushed_at?: string | null
          retry_count?: number | null
          status?: string | null
          tool_type: string
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          connection_id?: string | null
          contact_id?: string
          created_at?: string | null
          deleted_at?: string | null
          deletion_error?: string | null
          deletion_status?: string | null
          email_body?: string | null
          email_subject?: string | null
          error_message?: string | null
          external_campaign_id?: string | null
          external_lead_id?: string | null
          external_workflow_id?: string | null
          id?: string
          organization_id?: string | null
          progress_id?: string | null
          push_mode?: string | null
          pushed_at?: string | null
          retry_count?: number | null
          status?: string | null
          tool_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_handoffs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_handoffs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_tool_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_handoffs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_handoffs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_handoffs_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "campaign_lead_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_channel_stats: {
        Row: {
          computed_at: string | null
          email_pct: number | null
          has_email: number | null
          has_instagram: number | null
          has_linkedin: number | null
          has_phone: number | null
          has_twitter: number | null
          has_whatsapp: number | null
          id: string
          instagram_pct: number | null
          linkedin_pct: number | null
          list_id: string
          phone_pct: number | null
          total_leads: number | null
          twitter_pct: number | null
          whatsapp_pct: number | null
        }
        Insert: {
          computed_at?: string | null
          email_pct?: number | null
          has_email?: number | null
          has_instagram?: number | null
          has_linkedin?: number | null
          has_phone?: number | null
          has_twitter?: number | null
          has_whatsapp?: number | null
          id?: string
          instagram_pct?: number | null
          linkedin_pct?: number | null
          list_id: string
          phone_pct?: number | null
          total_leads?: number | null
          twitter_pct?: number | null
          whatsapp_pct?: number | null
        }
        Update: {
          computed_at?: string | null
          email_pct?: number | null
          has_email?: number | null
          has_instagram?: number | null
          has_linkedin?: number | null
          has_phone?: number | null
          has_twitter?: number | null
          has_whatsapp?: number | null
          id?: string
          instagram_pct?: number | null
          linkedin_pct?: number | null
          list_id?: string
          phone_pct?: number | null
          total_leads?: number | null
          twitter_pct?: number | null
          whatsapp_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_channel_stats_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: true
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_channel_stats_refresh_queue: {
        Row: {
          id: number
          list_id: string
          requested_at: string
        }
        Insert: {
          id?: never
          list_id: string
          requested_at?: string
        }
        Update: {
          id?: never
          list_id?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_channel_stats_refresh_queue_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_connections: {
        Row: {
          added_at: string | null
          added_by: string | null
          connection_id: string
          id: string
          lead_list_id: string
          organization_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          connection_id: string
          id?: string
          lead_list_id: string
          organization_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          connection_id?: string
          id?: string
          lead_list_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_connections_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_members: {
        Row: {
          added_at: string | null
          contact_id: string
          email_lower: string | null
          id: string
          list_id: string
          source_data: Json | null
        }
        Insert: {
          added_at?: string | null
          contact_id: string
          email_lower?: string | null
          id?: string
          list_id: string
          source_data?: Json | null
        }
        Update: {
          added_at?: string | null
          contact_id?: string
          email_lower?: string | null
          id?: string
          list_id?: string
          source_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_processing_items: {
        Row: {
          analysis_reused: boolean
          attempts: number
          cancel_requested_at: string | null
          canceled_at: string | null
          claimed_at: string | null
          completed_at: string | null
          contact_email_search_attempted: boolean
          contact_email_verification_status: string | null
          contact_has_email: boolean
          contact_id: string
          created_at: string
          failure_category: string | null
          force_reprocess: boolean
          id: string
          last_error: string | null
          lead_list_id: string
          manual_run: boolean
          next_attempt_at: string
          organization_id: string
          pause_requested_at: string | null
          policy_id: string
          recovery_attempts: number
          rejected_reason: string | null
          replacement_attempts: number
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          analysis_reused?: boolean
          attempts?: number
          cancel_requested_at?: string | null
          canceled_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          contact_email_search_attempted?: boolean
          contact_email_verification_status?: string | null
          contact_has_email?: boolean
          contact_id: string
          created_at?: string
          failure_category?: string | null
          force_reprocess?: boolean
          id?: string
          last_error?: string | null
          lead_list_id: string
          manual_run?: boolean
          next_attempt_at?: string
          organization_id: string
          pause_requested_at?: string | null
          policy_id: string
          recovery_attempts?: number
          rejected_reason?: string | null
          replacement_attempts?: number
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          analysis_reused?: boolean
          attempts?: number
          cancel_requested_at?: string | null
          canceled_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          contact_email_search_attempted?: boolean
          contact_email_verification_status?: string | null
          contact_has_email?: boolean
          contact_id?: string
          created_at?: string
          failure_category?: string | null
          force_reprocess?: boolean
          id?: string
          last_error?: string | null
          lead_list_id?: string
          manual_run?: boolean
          next_attempt_at?: string
          organization_id?: string
          pause_requested_at?: string | null
          policy_id?: string
          recovery_attempts?: number
          rejected_reason?: string | null
          replacement_attempts?: number
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_processing_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_items_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_items_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "lead_list_processing_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_processing_policies: {
        Row: {
          analysis_freshness_days: number
          analyze_icp: boolean
          analyze_when: string
          approved_destination_id: string | null
          approved_destination_type: string
          created_at: string
          email_provider: string | null
          email_provider_chain: string[]
          enabled: boolean
          fetch_home_page_text: boolean
          find_email: boolean
          find_replacement_email_on_invalid: boolean
          icebreaker_field_key: string
          icebreaker_llm_model: string | null
          icebreaker_prompt: string | null
          icebreaker_temperature: number | null
          icp_ids: string[]
          icp_llm_model: string | null
          icp_llm_provider: string | null
          icp_product_id: string | null
          id: string
          lead_list_id: string
          low_icp_destination_id: string | null
          low_icp_destination_type: string
          message_llm_model: string | null
          message_product_id: string | null
          message_prompt: string | null
          message_temperature: number | null
          min_icp_score: number | null
          no_email_destination_id: string | null
          no_email_destination_type: string
          no_email_list_id: string | null
          no_source_data_destination_id: string | null
          no_source_data_destination_type: string
          organization_id: string
          paused_at: string | null
          require_valid_email: boolean
          sequence_id: string | null
          stage_order: string[]
          unverified_email_destination_id: string | null
          unverified_email_destination_type: string
          unverified_email_list_id: string | null
          updated_at: string
          verification_provider: string
          verification_provider_chain: string[]
          verify_email: boolean
          verify_freshness_days: number
          verify_when: string
          write_icebreaker: boolean
          write_message: boolean
        }
        Insert: {
          analysis_freshness_days?: number
          analyze_icp?: boolean
          analyze_when?: string
          approved_destination_id?: string | null
          approved_destination_type?: string
          created_at?: string
          email_provider?: string | null
          email_provider_chain?: string[]
          enabled?: boolean
          fetch_home_page_text?: boolean
          find_email?: boolean
          find_replacement_email_on_invalid?: boolean
          icebreaker_field_key?: string
          icebreaker_llm_model?: string | null
          icebreaker_prompt?: string | null
          icebreaker_temperature?: number | null
          icp_ids?: string[]
          icp_llm_model?: string | null
          icp_llm_provider?: string | null
          icp_product_id?: string | null
          id?: string
          lead_list_id: string
          low_icp_destination_id?: string | null
          low_icp_destination_type?: string
          message_llm_model?: string | null
          message_product_id?: string | null
          message_prompt?: string | null
          message_temperature?: number | null
          min_icp_score?: number | null
          no_email_destination_id?: string | null
          no_email_destination_type?: string
          no_email_list_id?: string | null
          no_source_data_destination_id?: string | null
          no_source_data_destination_type?: string
          organization_id: string
          paused_at?: string | null
          require_valid_email?: boolean
          sequence_id?: string | null
          stage_order?: string[]
          unverified_email_destination_id?: string | null
          unverified_email_destination_type?: string
          unverified_email_list_id?: string | null
          updated_at?: string
          verification_provider?: string
          verification_provider_chain?: string[]
          verify_email?: boolean
          verify_freshness_days?: number
          verify_when?: string
          write_icebreaker?: boolean
          write_message?: boolean
        }
        Update: {
          analysis_freshness_days?: number
          analyze_icp?: boolean
          analyze_when?: string
          approved_destination_id?: string | null
          approved_destination_type?: string
          created_at?: string
          email_provider?: string | null
          email_provider_chain?: string[]
          enabled?: boolean
          fetch_home_page_text?: boolean
          find_email?: boolean
          find_replacement_email_on_invalid?: boolean
          icebreaker_field_key?: string
          icebreaker_llm_model?: string | null
          icebreaker_prompt?: string | null
          icebreaker_temperature?: number | null
          icp_ids?: string[]
          icp_llm_model?: string | null
          icp_llm_provider?: string | null
          icp_product_id?: string | null
          id?: string
          lead_list_id?: string
          low_icp_destination_id?: string | null
          low_icp_destination_type?: string
          message_llm_model?: string | null
          message_product_id?: string | null
          message_prompt?: string | null
          message_temperature?: number | null
          min_icp_score?: number | null
          no_email_destination_id?: string | null
          no_email_destination_type?: string
          no_email_list_id?: string | null
          no_source_data_destination_id?: string | null
          no_source_data_destination_type?: string
          organization_id?: string
          paused_at?: string | null
          require_valid_email?: boolean
          sequence_id?: string | null
          stage_order?: string[]
          unverified_email_destination_id?: string | null
          unverified_email_destination_type?: string
          unverified_email_list_id?: string | null
          updated_at?: string
          verification_provider?: string
          verification_provider_chain?: string[]
          verify_email?: boolean
          verify_freshness_days?: number
          verify_when?: string
          write_icebreaker?: boolean
          write_message?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_processing_policies_icp_product_id_fkey"
            columns: ["icp_product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: true
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_message_product_id_fkey"
            columns: ["message_product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_no_email_list_id_fkey"
            columns: ["no_email_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_policies_unverified_email_list_id_fkey"
            columns: ["unverified_email_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_processing_provider_attempts: {
        Row: {
          completed_at: string | null
          contact_id: string
          created_at: string
          credits_used: number
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          lead_list_id: string
          organization_id: string
          processing_item_id: string
          provider: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          created_at?: string
          credits_used?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          lead_list_id: string
          organization_id: string
          processing_item_id: string
          provider: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          credits_used?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          lead_list_id?: string
          organization_id?: string
          processing_item_id?: string
          provider?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_processing_provider_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_provider_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_provider_attempts_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_provider_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_processing_provider_attempts_processing_item_id_fkey"
            columns: ["processing_item_id"]
            isOneToOne: false
            referencedRelation: "lead_list_processing_items"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_sources: {
        Row: {
          account_id: string | null
          config: Json
          consecutive_errors: number
          created_at: string
          error_message: string | null
          expires_at: string | null
          id: string
          last_new_leads_at: string | null
          last_polled_at: string | null
          list_id: string
          next_poll_at: string
          organization_id: string
          parent_source_id: string | null
          poll_interval_minutes: number
          source_key: string
          source_type: string
          source_url: string
          state: Json
          status: string
          total_imported: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          config?: Json
          consecutive_errors?: number
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          id?: string
          last_new_leads_at?: string | null
          last_polled_at?: string | null
          list_id: string
          next_poll_at?: string
          organization_id: string
          parent_source_id?: string | null
          poll_interval_minutes?: number
          source_key: string
          source_type: string
          source_url: string
          state?: Json
          status?: string
          total_imported?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          config?: Json
          consecutive_errors?: number
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          id?: string
          last_new_leads_at?: string | null
          last_polled_at?: string | null
          list_id?: string
          next_poll_at?: string
          organization_id?: string
          parent_source_id?: string | null
          poll_interval_minutes?: number
          source_key?: string
          source_type?: string
          source_url?: string
          state?: Json
          status?: string
          total_imported?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_sources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_sources_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_sources_parent_source_id_fkey"
            columns: ["parent_source_id"]
            isOneToOne: false
            referencedRelation: "lead_list_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          filter_criteria: Json | null
          id: string
          is_smart: boolean | null
          last_computed_at: string | null
          lead_count: number | null
          name: string
          organization_id: string
          source_config: Json | null
          source_type: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filter_criteria?: Json | null
          id?: string
          is_smart?: boolean | null
          last_computed_at?: string | null
          lead_count?: number | null
          name: string
          organization_id: string
          source_config?: Json | null
          source_type?: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filter_criteria?: Json | null
          id?: string
          is_smart?: boolean | null
          last_computed_at?: string | null
          lead_count?: number | null
          name?: string
          organization_id?: string
          source_config?: Json | null
          source_type?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnet_captures: {
        Row: {
          campaign_id: string
          captured_at: string | null
          created_at: string | null
          email: string
          id: string
          lead_id: string
          organization_id: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          captured_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          lead_id: string
          organization_id: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          captured_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          lead_id?: string
          organization_id?: string
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_magnet_captures_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "lead_magnet_captures_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_magnet_captures_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "unipile_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_magnet_captures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnet_drip_state: {
        Row: {
          completed_at: string | null
          created_at: string
          email: string
          last_sent_at: string | null
          source: string
          stages_sent: string[]
          started_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          email: string
          last_sent_at?: string | null
          source: string
          stages_sent?: string[]
          started_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          email?: string
          last_sent_at?: string | null
          source?: string
          stages_sent?: string[]
          started_at?: string | null
        }
        Relationships: []
      }
      lead_magnet_events: {
        Row: {
          campaign_id: string
          created_at: string | null
          event_metadata: Json | null
          event_type: string
          id: string
          lead_id: string
          organization_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          event_metadata?: Json | null
          event_type: string
          id?: string
          lead_id: string
          organization_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          event_metadata?: Json | null
          event_type?: string
          id?: string
          lead_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_magnet_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "lead_magnet_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_magnet_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unipile_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_magnet_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_pool_classify_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          domain: string
          lease_until: string | null
          priority: number
          source: string | null
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain: string
          lease_until?: string | null
          priority?: number
          source?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain?: string
          lease_until?: string | null
          priority?: number
          source?: string | null
          status?: string
        }
        Relationships: []
      }
      lead_pool_company_enrichments: {
        Row: {
          classified_at: string | null
          created_at: string
          domain: string
          qwen_category: string | null
          qwen_confidence: number | null
          qwen_is_target: boolean | null
          qwen_model: string | null
          qwen_payload: Json
          qwen_reason: string | null
          source: string
          updated_at: string
          website_description: string | null
          website_final_url: string | null
          website_http_status: number | null
          website_status: string
          website_title: string | null
          website_url: string | null
        }
        Insert: {
          classified_at?: string | null
          created_at?: string
          domain: string
          qwen_category?: string | null
          qwen_confidence?: number | null
          qwen_is_target?: boolean | null
          qwen_model?: string | null
          qwen_payload?: Json
          qwen_reason?: string | null
          source?: string
          updated_at?: string
          website_description?: string | null
          website_final_url?: string | null
          website_http_status?: number | null
          website_status: string
          website_title?: string | null
          website_url?: string | null
        }
        Update: {
          classified_at?: string | null
          created_at?: string
          domain?: string
          qwen_category?: string | null
          qwen_confidence?: number | null
          qwen_is_target?: boolean | null
          qwen_model?: string | null
          qwen_payload?: Json
          qwen_reason?: string | null
          source?: string
          updated_at?: string
          website_description?: string | null
          website_final_url?: string | null
          website_http_status?: number | null
          website_status?: string
          website_title?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      lead_pool_enrich_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          domain: string
          last_error: string | null
          lease_until: string | null
          linkedin_url: string
          priority: number
          requested_by: string | null
          source: string | null
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain: string
          last_error?: string | null
          lease_until?: string | null
          linkedin_url: string
          priority?: number
          requested_by?: string | null
          source?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain?: string
          last_error?: string | null
          lease_until?: string | null
          linkedin_url?: string
          priority?: number
          requested_by?: string | null
          source?: string | null
          status?: string
        }
        Relationships: []
      }
      lead_pool_person_enrichments: {
        Row: {
          checked_at: string | null
          created_at: string
          current_company: string | null
          current_company_city: string | null
          current_company_country: string | null
          current_company_domain: string | null
          current_company_employee_count: number | null
          current_company_employee_range: string | null
          current_company_industry: string | null
          current_company_linkedin_url: string | null
          current_company_revenue_range: string | null
          current_company_state: string | null
          current_first_name: string | null
          current_full_name: string | null
          current_last_name: string | null
          current_location: string | null
          current_title: string | null
          linkedin_url: string
          lookup_status: string
          moltsets_payload: Json
          source: string
          source_company_match: boolean | null
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          current_company?: string | null
          current_company_city?: string | null
          current_company_country?: string | null
          current_company_domain?: string | null
          current_company_employee_count?: number | null
          current_company_employee_range?: string | null
          current_company_industry?: string | null
          current_company_linkedin_url?: string | null
          current_company_revenue_range?: string | null
          current_company_state?: string | null
          current_first_name?: string | null
          current_full_name?: string | null
          current_last_name?: string | null
          current_location?: string | null
          current_title?: string | null
          linkedin_url: string
          lookup_status: string
          moltsets_payload?: Json
          source?: string
          source_company_match?: boolean | null
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          current_company?: string | null
          current_company_city?: string | null
          current_company_country?: string | null
          current_company_domain?: string | null
          current_company_employee_count?: number | null
          current_company_employee_range?: string | null
          current_company_industry?: string | null
          current_company_linkedin_url?: string | null
          current_company_revenue_range?: string | null
          current_company_state?: string | null
          current_first_name?: string | null
          current_full_name?: string | null
          current_last_name?: string | null
          current_location?: string | null
          current_title?: string | null
          linkedin_url?: string
          lookup_status?: string
          moltsets_payload?: Json
          source?: string
          source_company_match?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      lead_pool_person_verified: {
        Row: {
          business_email: string | null
          business_email_risk: string | null
          business_email_validated_at: string | null
          checked_at: string
          city: string | null
          company_city: string | null
          company_country: string | null
          company_domain: string | null
          company_linkedin_url: string | null
          company_name: string | null
          company_state: string | null
          country: string | null
          created_at: string
          first_name: string | null
          full_name: string | null
          headline: string | null
          last_name: string | null
          linkedin_url: string
          moltsets_payload: Json
          personal_email: string | null
          personal_email_risk: string | null
          personal_email_validated_at: string | null
          seniority: string | null
          source_updated_at: string | null
          state: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          business_email?: string | null
          business_email_risk?: string | null
          business_email_validated_at?: string | null
          checked_at?: string
          city?: string | null
          company_city?: string | null
          company_country?: string | null
          company_domain?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          company_state?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          last_name?: string | null
          linkedin_url: string
          moltsets_payload?: Json
          personal_email?: string | null
          personal_email_risk?: string | null
          personal_email_validated_at?: string | null
          seniority?: string | null
          source_updated_at?: string | null
          state?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          business_email?: string | null
          business_email_risk?: string | null
          business_email_validated_at?: string | null
          checked_at?: string
          city?: string | null
          company_city?: string | null
          company_country?: string | null
          company_domain?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          company_state?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          last_name?: string | null
          linkedin_url?: string
          moltsets_payload?: Json
          personal_email?: string | null
          personal_email_risk?: string | null
          personal_email_validated_at?: string | null
          seniority?: string | null
          source_updated_at?: string | null
          state?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      lead_pool_verified: {
        Row: {
          business_email: string | null
          business_email_risk: string | null
          business_email_validated_at: string | null
          category: string | null
          category_confidence: string | null
          category_evidence: string | null
          company_city: string | null
          company_country: string | null
          company_linkedin_url: string | null
          company_name: string | null
          company_state: string | null
          created_at: string
          domain: string
          employee_count: number | null
          employee_range: string | null
          linkedin_industry: string | null
          linkedin_url: string | null
          moltsets_checked_at: string | null
          moltsets_company_payload: Json
          moltsets_location: string | null
          moltsets_status: string | null
          revenue_range: string | null
          source_updated_at: string | null
          updated_at: string
          website_checked_at: string | null
          website_location: string | null
          website_status: string | null
        }
        Insert: {
          business_email?: string | null
          business_email_risk?: string | null
          business_email_validated_at?: string | null
          category?: string | null
          category_confidence?: string | null
          category_evidence?: string | null
          company_city?: string | null
          company_country?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          company_state?: string | null
          created_at?: string
          domain: string
          employee_count?: number | null
          employee_range?: string | null
          linkedin_industry?: string | null
          linkedin_url?: string | null
          moltsets_checked_at?: string | null
          moltsets_company_payload?: Json
          moltsets_location?: string | null
          moltsets_status?: string | null
          revenue_range?: string | null
          source_updated_at?: string | null
          updated_at?: string
          website_checked_at?: string | null
          website_location?: string | null
          website_status?: string | null
        }
        Update: {
          business_email?: string | null
          business_email_risk?: string | null
          business_email_validated_at?: string | null
          category?: string | null
          category_confidence?: string | null
          category_evidence?: string | null
          company_city?: string | null
          company_country?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          company_state?: string | null
          created_at?: string
          domain?: string
          employee_count?: number | null
          employee_range?: string | null
          linkedin_industry?: string | null
          linkedin_url?: string | null
          moltsets_checked_at?: string | null
          moltsets_company_payload?: Json
          moltsets_location?: string | null
          moltsets_status?: string | null
          revenue_range?: string | null
          source_updated_at?: string | null
          updated_at?: string
          website_checked_at?: string | null
          website_location?: string | null
          website_status?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          assigned_mailbox_id: string | null
          company: string | null
          created_at: string | null
          email: string
          email_status: string | null
          first_name: string | null
          id: string
          job_title: string | null
          last_name: string | null
          last_sequence_email_at: string | null
          linkedin_url: string | null
          organization_id: string
          source: string | null
          source_id: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_mailbox_id?: string | null
          company?: string | null
          created_at?: string | null
          email: string
          email_status?: string | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          last_sequence_email_at?: string | null
          linkedin_url?: string | null
          organization_id: string
          source?: string | null
          source_id?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_mailbox_id?: string | null
          company?: string | null
          created_at?: string | null
          email?: string
          email_status?: string | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          last_sequence_email_at?: string | null
          linkedin_url?: string | null
          organization_id?: string
          source?: string | null
          source_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_mailbox_id_fkey"
            columns: ["assigned_mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      library_blocks: {
        Row: {
          block_type: string
          content: string
          created_at: string | null
          id: string
          name: string | null
          organization_id: string
          tags: string[] | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          block_type: string
          content: string
          created_at?: string | null
          id?: string
          name?: string | null
          organization_id?: string
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          block_type?: string
          content?: string
          created_at?: string | null
          id?: string
          name?: string | null
          organization_id?: string
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "library_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_brand_voices: {
        Row: {
          accent_style: string | null
          color_palette: Json | null
          created_at: string | null
          description: string | null
          font_style: string | null
          id: string
          logo: string | null
          logos: string[] | null
          mood_keywords: string[] | null
          name: string
          organization_id: string
          style_guidelines: string | null
          tone: string | null
          updated_at: string | null
          visual_style_description: string | null
          visual_template: string | null
        }
        Insert: {
          accent_style?: string | null
          color_palette?: Json | null
          created_at?: string | null
          description?: string | null
          font_style?: string | null
          id?: string
          logo?: string | null
          logos?: string[] | null
          mood_keywords?: string[] | null
          name: string
          organization_id?: string
          style_guidelines?: string | null
          tone?: string | null
          updated_at?: string | null
          visual_style_description?: string | null
          visual_template?: string | null
        }
        Update: {
          accent_style?: string | null
          color_palette?: Json | null
          created_at?: string | null
          description?: string | null
          font_style?: string | null
          id?: string
          logo?: string | null
          logos?: string[] | null
          mood_keywords?: string[] | null
          name?: string
          organization_id?: string
          style_guidelines?: string | null
          tone?: string | null
          updated_at?: string | null
          visual_style_description?: string | null
          visual_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_voices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_characters: {
        Row: {
          accessories: Json | null
          age_range: string | null
          build: string | null
          created_at: string | null
          description: string | null
          ethnicity: string | null
          expertise: Json | null
          gender: string | null
          hair_description: string | null
          heygen_avatar_group_id: string | null
          heygen_avatar_id: string | null
          heygen_avatar_status: string | null
          heygen_avatars: Json | null
          heygen_config: Json | null
          heygen_voice_id: string | null
          id: string
          name: string
          organization_id: string
          overall_tone: string | null
          personality: Json | null
          personality_traits: Json | null
          reference_images: string[] | null
          reference_videos: string[] | null
          speaking_style: string | null
          tags: string[] | null
          typical_clothing: string | null
          updated_at: string | null
          usage_count: number | null
          visual_config: Json | null
          visual_style: string | null
          voice_config: Json | null
          voice_selection: string | null
        }
        Insert: {
          accessories?: Json | null
          age_range?: string | null
          build?: string | null
          created_at?: string | null
          description?: string | null
          ethnicity?: string | null
          expertise?: Json | null
          gender?: string | null
          hair_description?: string | null
          heygen_avatar_group_id?: string | null
          heygen_avatar_id?: string | null
          heygen_avatar_status?: string | null
          heygen_avatars?: Json | null
          heygen_config?: Json | null
          heygen_voice_id?: string | null
          id?: string
          name: string
          organization_id?: string
          overall_tone?: string | null
          personality?: Json | null
          personality_traits?: Json | null
          reference_images?: string[] | null
          reference_videos?: string[] | null
          speaking_style?: string | null
          tags?: string[] | null
          typical_clothing?: string | null
          updated_at?: string | null
          usage_count?: number | null
          visual_config?: Json | null
          visual_style?: string | null
          voice_config?: Json | null
          voice_selection?: string | null
        }
        Update: {
          accessories?: Json | null
          age_range?: string | null
          build?: string | null
          created_at?: string | null
          description?: string | null
          ethnicity?: string | null
          expertise?: Json | null
          gender?: string | null
          hair_description?: string | null
          heygen_avatar_group_id?: string | null
          heygen_avatar_id?: string | null
          heygen_avatar_status?: string | null
          heygen_avatars?: Json | null
          heygen_config?: Json | null
          heygen_voice_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          overall_tone?: string | null
          personality?: Json | null
          personality_traits?: Json | null
          reference_images?: string[] | null
          reference_videos?: string[] | null
          speaking_style?: string | null
          tags?: string[] | null
          typical_clothing?: string | null
          updated_at?: string | null
          usage_count?: number | null
          visual_config?: Json | null
          visual_style?: string | null
          voice_config?: Json | null
          voice_selection?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_characters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_icps: {
        Row: {
          created_at: string | null
          decision_maker_notes: string | null
          description: string | null
          desires: string[] | null
          id: string
          language_style: string | null
          name: string
          objections: string[] | null
          organization_id: string
          pain_points: string[] | null
          summary: string | null
          tags: string[] | null
          target_departments: string[] | null
          target_employee_bands: string[]
          target_industries: string[]
          target_locations: string[] | null
          target_revenue_bands: string[]
          target_seniorities: string[] | null
          target_title_keywords: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          decision_maker_notes?: string | null
          description?: string | null
          desires?: string[] | null
          id?: string
          language_style?: string | null
          name: string
          objections?: string[] | null
          organization_id?: string
          pain_points?: string[] | null
          summary?: string | null
          tags?: string[] | null
          target_departments?: string[] | null
          target_employee_bands?: string[]
          target_industries?: string[]
          target_locations?: string[] | null
          target_revenue_bands?: string[]
          target_seniorities?: string[] | null
          target_title_keywords?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          decision_maker_notes?: string | null
          description?: string | null
          desires?: string[] | null
          id?: string
          language_style?: string | null
          name?: string
          objections?: string[] | null
          organization_id?: string
          pain_points?: string[] | null
          summary?: string | null
          tags?: string[] | null
          target_departments?: string[] | null
          target_employee_bands?: string[]
          target_industries?: string[]
          target_locations?: string[] | null
          target_revenue_bands?: string[]
          target_seniorities?: string[] | null
          target_title_keywords?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_icps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_identities: {
        Row: {
          brand_voice_id: string
          character_id: string
          created_at: string | null
          delivery: Json | null
          description: string | null
          id: string
          is_master: boolean | null
          last_synced_from_master_at: string | null
          master_resource_id: string | null
          name: string
          organization_id: string
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          brand_voice_id: string
          character_id: string
          created_at?: string | null
          delivery?: Json | null
          description?: string | null
          id?: string
          is_master?: boolean | null
          last_synced_from_master_at?: string | null
          master_resource_id?: string | null
          name: string
          organization_id?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          brand_voice_id?: string
          character_id?: string
          created_at?: string | null
          delivery?: Json | null
          description?: string | null
          id?: string
          is_master?: boolean | null
          last_synced_from_master_at?: string | null
          master_resource_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "identities_brand_voice_id_fkey"
            columns: ["brand_voice_id"]
            isOneToOne: false
            referencedRelation: "library_brand_voices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_images: {
        Row: {
          created_at: string
          id: string
          images: string[]
          name: string
          organization_id: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          images?: string[]
          name: string
          organization_id: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          images?: string[]
          name?: string
          organization_id?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_images_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_products: {
        Row: {
          affiliate_links: Json | null
          analysis_questions: string[]
          booking_url: string | null
          brand: string | null
          category: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          features: string[] | null
          id: string
          images: Json | null
          key_benefits: string[] | null
          logo: string | null
          name: string
          organization_id: string
          price: number | null
          sku: string | null
          specifications: Json | null
          tags: string[] | null
          testimonial_embed: string | null
          updated_at: string | null
          videos: Json | null
        }
        Insert: {
          affiliate_links?: Json | null
          analysis_questions?: string[]
          booking_url?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          images?: Json | null
          key_benefits?: string[] | null
          logo?: string | null
          name: string
          organization_id?: string
          price?: number | null
          sku?: string | null
          specifications?: Json | null
          tags?: string[] | null
          testimonial_embed?: string | null
          updated_at?: string | null
          videos?: Json | null
        }
        Update: {
          affiliate_links?: Json | null
          analysis_questions?: string[]
          booking_url?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          images?: Json | null
          key_benefits?: string[] | null
          logo?: string | null
          name?: string
          organization_id?: string
          price?: number | null
          sku?: string | null
          specifications?: Json | null
          tags?: string[] | null
          testimonial_embed?: string | null
          updated_at?: string | null
          videos?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "library_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_saved_content: {
        Row: {
          content: Json
          content_type: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_favorite: boolean | null
          linked_brand_voice_ids: string[] | null
          linked_character_ids: string[] | null
          linked_icp_ids: string[] | null
          linked_product_ids: string[] | null
          name: string
          organization_id: string
          source_job_id: string | null
          source_output_id: string | null
          source_stage: string | null
          tags: string[] | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          content: Json
          content_type: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          linked_brand_voice_ids?: string[] | null
          linked_character_ids?: string[] | null
          linked_icp_ids?: string[] | null
          linked_product_ids?: string[] | null
          name: string
          organization_id: string
          source_job_id?: string | null
          source_output_id?: string | null
          source_stage?: string | null
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          content?: Json
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          linked_brand_voice_ids?: string[] | null
          linked_character_ids?: string[] | null
          linked_icp_ids?: string[] | null
          linked_product_ids?: string[] | null
          name?: string
          organization_id?: string
          source_job_id?: string | null
          source_output_id?: string | null
          source_stage?: string | null
          tags?: string[] | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "library_saved_content_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_saved_content_source_job_id_fkey"
            columns: ["source_job_id"]
            isOneToOne: false
            referencedRelation: "content_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_saved_content_source_output_id_fkey"
            columns: ["source_output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      library_strategy_documents: {
        Row: {
          content: string | null
          created_at: string | null
          description: string | null
          document_type: string
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          related_icp_ids: string[] | null
          related_product_ids: string[] | null
          tags: string[] | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          description?: string | null
          document_type: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          related_icp_ids?: string[] | null
          related_product_ids?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          description?: string | null
          document_type?: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          related_icp_ids?: string[] | null
          related_product_ids?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "library_strategy_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_digest_state: {
        Row: {
          last_dormancy_at: string | null
          last_weekly_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          last_dormancy_at?: string | null
          last_weekly_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          last_dormancy_at?: string | null
          last_weekly_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      linkedin_audits: {
        Row: {
          about_rewrite: string | null
          about_score: number | null
          activity_score: number | null
          banner_score: number | null
          created_at: string | null
          headline_rewrite: string | null
          headline_score: number | null
          id: string
          linkedin_url: string | null
          organization_id: string
          overall_score: number | null
          profile_snapshot: Json | null
          recommendations: Json | null
          status: string
          summary: string | null
          updated_at: string | null
        }
        Insert: {
          about_rewrite?: string | null
          about_score?: number | null
          activity_score?: number | null
          banner_score?: number | null
          created_at?: string | null
          headline_rewrite?: string | null
          headline_score?: number | null
          id?: string
          linkedin_url?: string | null
          organization_id: string
          overall_score?: number | null
          profile_snapshot?: Json | null
          recommendations?: Json | null
          status?: string
          summary?: string | null
          updated_at?: string | null
        }
        Update: {
          about_rewrite?: string | null
          about_score?: number | null
          activity_score?: number | null
          banner_score?: number | null
          created_at?: string | null
          headline_rewrite?: string | null
          headline_score?: number | null
          id?: string
          linkedin_url?: string | null
          organization_id?: string
          overall_score?: number | null
          profile_snapshot?: Json | null
          recommendations?: Json | null
          status?: string
          summary?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_audits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_campaigns: {
        Row: {
          agent_profile_id: string | null
          ai_message_config: Json | null
          auto_enroll_new_members: boolean
          autopilot_config: Json | null
          campaign_settings: Json | null
          campaign_type: string | null
          channel_fallback_enabled: boolean | null
          channel_metrics: Json | null
          completed_at: string | null
          connection_rate: number | null
          contacted_leads: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          enroll_filter_criteria: Json
          entry_triggers: Json
          exclude_other_campaigns: boolean | null
          exclude_same_sender: boolean | null
          exclusion_list_ids: string[] | null
          fallback_order: string[] | null
          icp_product_id: string | null
          id: string
          lead_list_id: string | null
          lead_list_ids: string[]
          min_icp_score: number | null
          name: string
          needs_lead_init: boolean | null
          organization_id: string
          paused_at: string | null
          primary_channel: string | null
          processed_leads: number | null
          rate_settings: Json | null
          replied_count: number | null
          sender_account_ids: string[]
          sender_accounts: Json | null
          sequence_edges: Json | null
          sequence_nodes: Json | null
          started_at: string | null
          status: string | null
          stop_on_reply: boolean
          total_leads: number | null
          updated_at: string | null
        }
        Insert: {
          agent_profile_id?: string | null
          ai_message_config?: Json | null
          auto_enroll_new_members?: boolean
          autopilot_config?: Json | null
          campaign_settings?: Json | null
          campaign_type?: string | null
          channel_fallback_enabled?: boolean | null
          channel_metrics?: Json | null
          completed_at?: string | null
          connection_rate?: number | null
          contacted_leads?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          enroll_filter_criteria?: Json
          entry_triggers?: Json
          exclude_other_campaigns?: boolean | null
          exclude_same_sender?: boolean | null
          exclusion_list_ids?: string[] | null
          fallback_order?: string[] | null
          icp_product_id?: string | null
          id?: string
          lead_list_id?: string | null
          lead_list_ids?: string[]
          min_icp_score?: number | null
          name: string
          needs_lead_init?: boolean | null
          organization_id: string
          paused_at?: string | null
          primary_channel?: string | null
          processed_leads?: number | null
          rate_settings?: Json | null
          replied_count?: number | null
          sender_account_ids?: string[]
          sender_accounts?: Json | null
          sequence_edges?: Json | null
          sequence_nodes?: Json | null
          started_at?: string | null
          status?: string | null
          stop_on_reply?: boolean
          total_leads?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_profile_id?: string | null
          ai_message_config?: Json | null
          auto_enroll_new_members?: boolean
          autopilot_config?: Json | null
          campaign_settings?: Json | null
          campaign_type?: string | null
          channel_fallback_enabled?: boolean | null
          channel_metrics?: Json | null
          completed_at?: string | null
          connection_rate?: number | null
          contacted_leads?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          enroll_filter_criteria?: Json
          entry_triggers?: Json
          exclude_other_campaigns?: boolean | null
          exclude_same_sender?: boolean | null
          exclusion_list_ids?: string[] | null
          fallback_order?: string[] | null
          icp_product_id?: string | null
          id?: string
          lead_list_id?: string | null
          lead_list_ids?: string[]
          min_icp_score?: number | null
          name?: string
          needs_lead_init?: boolean | null
          organization_id?: string
          paused_at?: string | null
          primary_channel?: string | null
          processed_leads?: number | null
          rate_settings?: Json | null
          replied_count?: number | null
          sender_account_ids?: string[]
          sender_accounts?: Json | null
          sequence_edges?: Json | null
          sequence_nodes?: Json | null
          started_at?: string | null
          status?: string | null
          stop_on_reply?: boolean
          total_leads?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_campaigns_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_campaigns_icp_product_id_fkey"
            columns: ["icp_product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_campaigns_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_connections: {
        Row: {
          account_id: string
          company: string | null
          connected_at: string | null
          created_at: string | null
          first_name: string | null
          full_name: string | null
          headline: string | null
          id: string
          job_title: string | null
          last_name: string | null
          linkedin_id: string
          linkedin_url: string | null
          location: string | null
          organization_id: string
          profile_picture_url: string | null
          raw_data: Json | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          company?: string | null
          connected_at?: string | null
          created_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_id: string
          linkedin_url?: string | null
          location?: string | null
          organization_id: string
          profile_picture_url?: string | null
          raw_data?: Json | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          company?: string | null
          connected_at?: string | null
          created_at?: string | null
          first_name?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_id?: string
          linkedin_url?: string | null
          location?: string | null
          organization_id?: string
          profile_picture_url?: string | null
          raw_data?: Json | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_import_jobs: {
        Row: {
          account_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          organization_id: string
          progress: number | null
          source_url: string
          started_at: string | null
          status: string
          target_list_id: string
          total_found: number | null
          total_imported: number | null
          total_skipped: number | null
          type: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          progress?: number | null
          source_url: string
          started_at?: string | null
          status?: string
          target_list_id: string
          total_found?: number | null
          total_imported?: number | null
          total_skipped?: number | null
          type: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          progress?: number | null
          source_url?: string
          started_at?: string | null
          status?: string
          target_list_id?: string
          total_found?: number | null
          total_imported?: number | null
          total_skipped?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_import_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_import_jobs_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_building_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          found_dms: number
          icp_id: string | null
          id: string
          metadata: Json
          name: string
          organization_id: string
          progress: number
          query: Json
          started_at: string | null
          status: string
          strong_leads: number
          target_list_id: string | null
          total_companies: number
          updated_at: string
          verified_emails: number
          worker_config: Json
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          found_dms?: number
          icp_id?: string | null
          id?: string
          metadata?: Json
          name: string
          organization_id: string
          progress?: number
          query?: Json
          started_at?: string | null
          status?: string
          strong_leads?: number
          target_list_id?: string | null
          total_companies?: number
          updated_at?: string
          verified_emails?: number
          worker_config?: Json
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          found_dms?: number
          icp_id?: string | null
          id?: string
          metadata?: Json
          name?: string
          organization_id?: string
          progress?: number
          query?: Json
          started_at?: string | null
          status?: string
          strong_leads?: number
          target_list_id?: string | null
          total_companies?: number
          updated_at?: string
          verified_emails?: number
          worker_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: "list_building_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_building_jobs_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_building_pool_search_log: {
        Row: {
          created_at: string
          id: string
          mode: string
          organization_id: string
          query: Json
          result_count: number
          user_id: string
          worker_elapsed_ms: number
        }
        Insert: {
          created_at?: string
          id?: string
          mode: string
          organization_id: string
          query: Json
          result_count?: number
          user_id: string
          worker_elapsed_ms?: number
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          organization_id?: string
          query?: Json
          result_count?: number
          user_id?: string
          worker_elapsed_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_building_pool_search_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      list_building_saved_searches: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_building_saved_searches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_tenants: {
        Row: {
          admin_email: string | null
          admin_password_encrypted: string | null
          consent_granted: boolean | null
          consent_granted_at: string | null
          created_at: string | null
          delivery_reconciled_at: string | null
          display_name: string | null
          exo_consent_granted: boolean | null
          exo_consent_granted_at: string | null
          id: string
          last_error: string | null
          last_validated_at: string | null
          metadata: Json | null
          onmicrosoft_domain: string
          organization_id: string
          pending_tenant_smtp_fix: boolean
          prerequisites_status: Json
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          admin_email?: string | null
          admin_password_encrypted?: string | null
          consent_granted?: boolean | null
          consent_granted_at?: string | null
          created_at?: string | null
          delivery_reconciled_at?: string | null
          display_name?: string | null
          exo_consent_granted?: boolean | null
          exo_consent_granted_at?: string | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          onmicrosoft_domain: string
          organization_id: string
          pending_tenant_smtp_fix?: boolean
          prerequisites_status?: Json
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          admin_email?: string | null
          admin_password_encrypted?: string | null
          consent_granted?: boolean | null
          consent_granted_at?: string | null
          created_at?: string | null
          delivery_reconciled_at?: string | null
          display_name?: string | null
          exo_consent_granted?: boolean | null
          exo_consent_granted_at?: string | null
          id?: string
          last_error?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          onmicrosoft_domain?: string
          organization_id?: string
          pending_tenant_smtp_fix?: boolean
          prerequisites_status?: Json
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_tenants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_avatar_sync_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          current_email: string | null
          errors: Json
          heartbeat_at: string | null
          id: string
          mailbox_ids: Json
          organization_id: string
          processed_index: number
          skipped: Json
          started_at: string | null
          status: string
          synced_count: number
          total: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_email?: string | null
          errors?: Json
          heartbeat_at?: string | null
          id?: string
          mailbox_ids: Json
          organization_id: string
          processed_index?: number
          skipped?: Json
          started_at?: string | null
          status?: string
          synced_count?: number
          total?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_email?: string | null
          errors?: Json
          heartbeat_at?: string | null
          id?: string
          mailbox_ids?: Json
          organization_id?: string
          processed_index?: number
          skipped?: Json
          started_at?: string | null
          status?: string
          synced_count?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_avatar_sync_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_daily_ceilings: {
        Row: {
          connection_type: string
          max_daily_limit: number
          note: string | null
          updated_at: string
        }
        Insert: {
          connection_type: string
          max_daily_limit: number
          note?: string | null
          updated_at?: string
        }
        Update: {
          connection_type?: string
          max_daily_limit?: number
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      mailbox_provisioning_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_count: number
          created_mailbox_ids: Json
          current_username: string | null
          domain_id: string
          error_message: string | null
          errors: Json
          failed_count: number
          generate_avatars: boolean
          heartbeat_at: string | null
          id: string
          mailboxes: Json
          organization_id: string
          processed_index: number
          started_at: string | null
          status: string
          total: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_count?: number
          created_mailbox_ids?: Json
          current_username?: string | null
          domain_id: string
          error_message?: string | null
          errors?: Json
          failed_count?: number
          generate_avatars?: boolean
          heartbeat_at?: string | null
          id?: string
          mailboxes: Json
          organization_id: string
          processed_index?: number
          started_at?: string | null
          status?: string
          total?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_count?: number
          created_mailbox_ids?: Json
          current_username?: string | null
          domain_id?: string
          error_message?: string | null
          errors?: Json
          failed_count?: number
          generate_avatars?: boolean
          heartbeat_at?: string | null
          id?: string
          mailboxes?: Json
          organization_id?: string
          processed_index?: number
          started_at?: string | null
          status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_provisioning_jobs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailbox_provisioning_jobs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailbox_provisioning_jobs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailbox_provisioning_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_sets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          mailbox_ids: string[]
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          mailbox_ids?: string[]
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          mailbox_ids?: string[]
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mailtester_job_lists: {
        Row: {
          attached_at: string
          emails_contributed: number
          job_id: string
          list_id: string
        }
        Insert: {
          attached_at?: string
          emails_contributed?: number
          job_id: string
          list_id: string
        }
        Update: {
          attached_at?: string
          emails_contributed?: number
          job_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailtester_job_lists_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mailtester_verification_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailtester_job_lists_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      mailtester_verification_jobs: {
        Row: {
          catch_all: number
          consecutive_timeout_ticks: number
          created_at: string
          created_by: string | null
          daily_limit_reached: boolean
          error: string | null
          finished_at: string | null
          id: string
          invalid: number
          last_tick_at: string | null
          list_id: string | null
          locked_by: string | null
          organization_id: string
          pending_emails: string[]
          plan: string
          pre_pass_resolved: number
          processed: number
          retry_after: string | null
          started_at: string | null
          status: string
          timeout_attempts: Json
          total: number
          unknown: number
          valid: number
        }
        Insert: {
          catch_all?: number
          consecutive_timeout_ticks?: number
          created_at?: string
          created_by?: string | null
          daily_limit_reached?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          last_tick_at?: string | null
          list_id?: string | null
          locked_by?: string | null
          organization_id: string
          pending_emails?: string[]
          plan: string
          pre_pass_resolved?: number
          processed?: number
          retry_after?: string | null
          started_at?: string | null
          status?: string
          timeout_attempts?: Json
          total?: number
          unknown?: number
          valid?: number
        }
        Update: {
          catch_all?: number
          consecutive_timeout_ticks?: number
          created_at?: string
          created_by?: string | null
          daily_limit_reached?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          last_tick_at?: string | null
          list_id?: string | null
          locked_by?: string | null
          organization_id?: string
          pending_emails?: string[]
          plan?: string
          pre_pass_resolved?: number
          processed?: number
          retry_after?: string | null
          started_at?: string | null
          status?: string
          timeout_attempts?: Json
          total?: number
          unknown?: number
          valid?: number
        }
        Relationships: [
          {
            foreignKeyName: "mailtester_verification_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_api_keys: {
        Row: {
          api_key: string
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_name: string
          last_used_at: string | null
          organization_id: string
          permissions: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          api_key: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_name: string
          last_used_at?: string | null
          organization_id: string
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_name?: string
          last_used_at?: string | null
          organization_id?: string
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mcp_api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_audit_logs: {
        Row: {
          api_key_id: string | null
          created_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          input_params: Json | null
          operation: string
          organization_id: string
          result_summary: string | null
          tool_name: string | null
          user_id: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_params?: Json | null
          operation: string
          organization_id: string
          result_summary?: string | null
          tool_name?: string | null
          user_id?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_params?: Json | null
          operation?: string
          organization_id?: string
          result_summary?: string | null
          tool_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_access_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          redirect_uri?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_oauth_authorization_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_oauth_clients: {
        Row: {
          allowed_scopes: string[]
          client_id: string
          created_at: string
          is_active: boolean
          redirect_uris: string[]
          updated_at: string
        }
        Insert: {
          allowed_scopes: string[]
          client_id: string
          created_at?: string
          is_active?: boolean
          redirect_uris: string[]
          updated_at?: string
        }
        Update: {
          allowed_scopes?: string[]
          client_id?: string
          created_at?: string
          is_active?: boolean
          redirect_uris?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      mcp_oauth_tokens: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          created_at: string
          id: string
          last_used_at: string | null
          organization_id: string
          refresh_expires_at: string
          refresh_token_hash: string
          revoked_at: string | null
          rotated_from_id: string | null
          scopes: string[]
          token_family_id: string
          user_id: string
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          organization_id: string
          refresh_expires_at: string
          refresh_token_hash: string
          revoked_at?: string | null
          rotated_from_id?: string | null
          scopes: string[]
          token_family_id?: string
          user_id: string
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          client_id?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          organization_id?: string
          refresh_expires_at?: string
          refresh_token_hash?: string
          revoked_at?: string | null
          rotated_from_id?: string | null
          scopes?: string[]
          token_family_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_oauth_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_oauth_tokens_rotated_from_id_fkey"
            columns: ["rotated_from_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_session_state: {
        Row: {
          active_organization_id: string
          api_key_id: string
          switched_at: string | null
          updated_at: string | null
        }
        Insert: {
          active_organization_id: string
          api_key_id: string
          switched_at?: string | null
          updated_at?: string | null
        }
        Update: {
          active_organization_id?: string
          api_key_id?: string
          switched_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_session_state_active_organization_id_fkey"
            columns: ["active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_session_state_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: true
            referencedRelation: "api_access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_usage_logs: {
        Row: {
          api_key_id: string
          duration_ms: number | null
          error_message: string | null
          executed_at: string | null
          id: string
          metadata: Json | null
          success: boolean
          tool_name: string
        }
        Insert: {
          api_key_id: string
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json | null
          success: boolean
          tool_name: string
        }
        Update: {
          api_key_id?: string
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json | null
          success?: boolean
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_usage_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "mcp_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_templates: {
        Row: {
          body_template: string | null
          conference_provider: string | null
          created_at: string | null
          description: string | null
          duration_minutes: number
          id: string
          is_default: boolean
          location: string | null
          name: string
          organization_id: string
          title_template: string
          updated_at: string | null
        }
        Insert: {
          body_template?: string | null
          conference_provider?: string | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_default?: boolean
          location?: string | null
          name: string
          organization_id: string
          title_template: string
          updated_at?: string | null
        }
        Update: {
          body_template?: string | null
          conference_provider?: string | null
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_default?: boolean
          location?: string | null
          name?: string
          organization_id?: string
          title_template?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      moltsets_account_state: {
        Row: {
          fair_use_fetched_at: string | null
          organization_id: string
          plan: string | null
          plan_fetched_at: string | null
          plan_unlimited: boolean | null
          records_remaining_1w: number | null
          records_remaining_5h: number | null
          records_reset_1w: string | null
          records_reset_5h: string | null
          updated_at: string
        }
        Insert: {
          fair_use_fetched_at?: string | null
          organization_id: string
          plan?: string | null
          plan_fetched_at?: string | null
          plan_unlimited?: boolean | null
          records_remaining_1w?: number | null
          records_remaining_5h?: number | null
          records_reset_1w?: string | null
          records_reset_5h?: string | null
          updated_at?: string
        }
        Update: {
          fair_use_fetched_at?: string | null
          organization_id?: string
          plan?: string | null
          plan_fetched_at?: string | null
          plan_unlimited?: boolean | null
          records_remaining_1w?: number | null
          records_remaining_5h?: number | null
          records_reset_1w?: string | null
          records_reset_5h?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moltsets_account_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      moltsets_worker_lists: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_run_at: string | null
          lead_list_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          lead_list_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          lead_list_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moltsets_worker_lists_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moltsets_worker_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_events: {
        Row: {
          action_taken: string | null
          content_ideas_created: string[] | null
          id: string
          monitor_id: string
          status: string | null
          trigger_data: Json | null
          triggered_at: string | null
        }
        Insert: {
          action_taken?: string | null
          content_ideas_created?: string[] | null
          id?: string
          monitor_id: string
          status?: string | null
          trigger_data?: Json | null
          triggered_at?: string | null
        }
        Update: {
          action_taken?: string | null
          content_ideas_created?: string[] | null
          id?: string
          monitor_id?: string
          status?: string | null
          trigger_data?: Json | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitor_events_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "content_monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      notion_custom_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          custom_prompt: string
          description: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          custom_prompt: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          custom_prompt?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notion_custom_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          app_url: string | null
          created_at: string | null
          expires_at: string
          id: string
          organization_id: string
          state: string
        }
        Insert: {
          app_url?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          organization_id: string
          state: string
        }
        Update: {
          app_url?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_drip_state: {
        Row: {
          alerts_fired: Json | null
          converted_at: string | null
          last_sent_at: string | null
          last_stage: string | null
          organization_id: string
          stages_sent: string[] | null
          updated_at: string | null
        }
        Insert: {
          alerts_fired?: Json | null
          converted_at?: string | null
          last_sent_at?: string | null
          last_stage?: string | null
          organization_id: string
          stages_sent?: string[] | null
          updated_at?: string | null
        }
        Update: {
          alerts_fired?: Json | null
          converted_at?: string | null
          last_sent_at?: string | null
          last_stage?: string | null
          organization_id?: string
          stages_sent?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_drip_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      openrouter_rate_limits: {
        Row: {
          id: string
          max_requests: number
          organization_id: string
          request_count: number
          window_start: string
        }
        Insert: {
          id?: string
          max_requests?: number
          organization_id: string
          request_count?: number
          window_start: string
        }
        Update: {
          id?: string
          max_requests?: number
          organization_id?: string
          request_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "openrouter_rate_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          funnel_product_role: string
          id: string
          order_id: string
          price_cents: number
          product_id: string
          quantity: number | null
          status: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          created_at?: string | null
          funnel_product_role: string
          id?: string
          order_id: string
          price_cents: number
          product_id: string
          quantity?: number | null
          status?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          created_at?: string | null
          funnel_product_role?: string
          id?: string
          order_id?: string
          price_cents?: number
          product_id?: string
          quantity?: number | null
          status?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          currency: string | null
          customer_id: string
          funnel_id: string
          id: string
          ip_address: unknown
          metadata: Json | null
          org_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          total_cents: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          customer_id: string
          funnel_id: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          org_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_cents: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          funnel_id?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          org_id?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_cents?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "orders_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_branding: {
        Row: {
          accent_color: Json | null
          app_name: string
          created_at: string
          cta_color: Json | null
          custom_css: string | null
          favicon_url: string | null
          footer_text: string | null
          hide_powered_by: boolean | null
          id: string
          logo_dark_url: string | null
          logo_url: string | null
          meta_description: string | null
          meta_title: string | null
          og_image_url: string | null
          organization_id: string
          primary_color: Json | null
          privacy_url: string | null
          support_email: string | null
          support_url: string | null
          tagline: string | null
          terms_url: string | null
          twitter_handle: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: Json | null
          app_name?: string
          created_at?: string
          cta_color?: Json | null
          custom_css?: string | null
          favicon_url?: string | null
          footer_text?: string | null
          hide_powered_by?: boolean | null
          id?: string
          logo_dark_url?: string | null
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          organization_id: string
          primary_color?: Json | null
          privacy_url?: string | null
          support_email?: string | null
          support_url?: string | null
          tagline?: string | null
          terms_url?: string | null
          twitter_handle?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: Json | null
          app_name?: string
          created_at?: string
          cta_color?: Json | null
          custom_css?: string | null
          favicon_url?: string | null
          footer_text?: string | null
          hide_powered_by?: boolean | null
          id?: string
          logo_dark_url?: string | null
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          organization_id?: string
          primary_color?: Json | null
          privacy_url?: string | null
          support_email?: string | null
          support_url?: string | null
          tagline?: string | null
          terms_url?: string | null
          twitter_handle?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_channel_limits: {
        Row: {
          active_days: number[] | null
          business_hours_end: string | null
          business_hours_only: boolean | null
          business_hours_start: string | null
          channel: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id: string | null
          created_at: string | null
          current_zone: Database["public"]["Enums"]["limit_zone"] | null
          custom_daily_limit: number | null
          custom_hourly_limit: number | null
          id: string
          is_enabled: boolean | null
          max_mailbox_daily_limit: number | null
          notes: string | null
          organization_id: string
          risk_tolerance: number | null
          timezone: string | null
          updated_at: string | null
          warmup_completed_at: string | null
          warmup_current_day: number | null
          warmup_paused_at: string | null
          warmup_progress_percent: number | null
          warmup_started_at: string | null
          warmup_status: Database["public"]["Enums"]["warmup_status"] | null
        }
        Insert: {
          active_days?: number[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean | null
          business_hours_start?: string | null
          channel: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id?: string | null
          created_at?: string | null
          current_zone?: Database["public"]["Enums"]["limit_zone"] | null
          custom_daily_limit?: number | null
          custom_hourly_limit?: number | null
          id?: string
          is_enabled?: boolean | null
          max_mailbox_daily_limit?: number | null
          notes?: string | null
          organization_id: string
          risk_tolerance?: number | null
          timezone?: string | null
          updated_at?: string | null
          warmup_completed_at?: string | null
          warmup_current_day?: number | null
          warmup_paused_at?: string | null
          warmup_progress_percent?: number | null
          warmup_started_at?: string | null
          warmup_status?: Database["public"]["Enums"]["warmup_status"] | null
        }
        Update: {
          active_days?: number[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean | null
          business_hours_start?: string | null
          channel?: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id?: string | null
          created_at?: string | null
          current_zone?: Database["public"]["Enums"]["limit_zone"] | null
          custom_daily_limit?: number | null
          custom_hourly_limit?: number | null
          id?: string
          is_enabled?: boolean | null
          max_mailbox_daily_limit?: number | null
          notes?: string | null
          organization_id?: string
          risk_tolerance?: number | null
          timezone?: string | null
          updated_at?: string | null
          warmup_completed_at?: string | null
          warmup_current_day?: number | null
          warmup_paused_at?: string | null
          warmup_progress_percent?: number | null
          warmup_started_at?: string | null
          warmup_status?: Database["public"]["Enums"]["warmup_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_channel_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_domains: {
        Row: {
          created_at: string
          dns_configured: boolean | null
          domain: string
          domain_type: string
          id: string
          last_verification_attempt: string | null
          organization_id: string
          ssl_status: string | null
          updated_at: string
          vercel_domain_id: string | null
          vercel_project_id: string | null
          verification_status: string
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          dns_configured?: boolean | null
          domain: string
          domain_type?: string
          id?: string
          last_verification_attempt?: string | null
          organization_id: string
          ssl_status?: string | null
          updated_at?: string
          vercel_domain_id?: string | null
          vercel_project_id?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          dns_configured?: boolean | null
          domain?: string
          domain_type?: string
          id?: string
          last_verification_attempt?: string | null
          organization_id?: string
          ssl_status?: string | null
          updated_at?: string
          vercel_domain_id?: string | null
          vercel_project_id?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          is_primary_owner: boolean | null
          joined_at: string | null
          organization_id: string
          permissions: Json | null
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_primary_owner?: boolean | null
          joined_at?: string | null
          organization_id: string
          permissions?: Json | null
          role?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_primary_owner?: boolean | null
          joined_at?: string | null
          organization_id?: string
          permissions?: Json | null
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_public_users_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "organization_members_user_id_public_users_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          activated_at: string | null
          analysis_concurrency_limit: number | null
          api_key_strategy: string
          branding: Json | null
          checklist_dismissed: boolean | null
          checklist_state: Json | null
          created_at: string | null
          default_image_generator_model: string | null
          default_image_generator_updated_at: string | null
          default_image_to_video_model: string | null
          default_image_to_video_updated_at: string | null
          default_llm_model: string | null
          default_llm_model_updated_at: string | null
          default_tts_model: string | null
          default_tts_updated_at: string | null
          default_world_simulator_model: string | null
          default_world_simulator_updated_at: string | null
          default_brand_voice_id: string | null
          default_character_id: string | null
          default_icp_id: string | null
          default_product_id: string | null
          enabled_features: Json | null
          first_generation_at: string | null
          hide_non_outreach_inbound: boolean
          id: string
          inherit_api_keys_from_parent: boolean | null
          inherited_providers: string[] | null
          onboarding_completed: boolean | null
          onboarding_step: string | null
          organization_id: string
          setup_completed: boolean | null
          updated_at: string | null
          user_persona: string | null
        }
        Insert: {
          activated_at?: string | null
          analysis_concurrency_limit?: number | null
          api_key_strategy?: string
          branding?: Json | null
          checklist_dismissed?: boolean | null
          checklist_state?: Json | null
          created_at?: string | null
          default_image_generator_model?: string | null
          default_image_generator_updated_at?: string | null
          default_image_to_video_model?: string | null
          default_image_to_video_updated_at?: string | null
          default_llm_model?: string | null
          default_llm_model_updated_at?: string | null
          default_tts_model?: string | null
          default_tts_updated_at?: string | null
          default_world_simulator_model?: string | null
          default_world_simulator_updated_at?: string | null
          default_brand_voice_id?: string | null
          default_character_id?: string | null
          default_icp_id?: string | null
          default_product_id?: string | null
          enabled_features?: Json | null
          first_generation_at?: string | null
          hide_non_outreach_inbound?: boolean
          id?: string
          inherit_api_keys_from_parent?: boolean | null
          inherited_providers?: string[] | null
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          organization_id: string
          setup_completed?: boolean | null
          updated_at?: string | null
          user_persona?: string | null
        }
        Update: {
          activated_at?: string | null
          analysis_concurrency_limit?: number | null
          api_key_strategy?: string
          branding?: Json | null
          checklist_dismissed?: boolean | null
          checklist_state?: Json | null
          created_at?: string | null
          default_image_generator_model?: string | null
          default_image_generator_updated_at?: string | null
          default_image_to_video_model?: string | null
          default_image_to_video_updated_at?: string | null
          default_llm_model?: string | null
          default_llm_model_updated_at?: string | null
          default_tts_model?: string | null
          default_tts_updated_at?: string | null
          default_world_simulator_model?: string | null
          default_world_simulator_updated_at?: string | null
          default_brand_voice_id?: string | null
          default_character_id?: string | null
          default_icp_id?: string | null
          default_product_id?: string | null
          enabled_features?: Json | null
          first_generation_at?: string | null
          hide_non_outreach_inbound?: boolean
          id?: string
          inherit_api_keys_from_parent?: boolean | null
          inherited_providers?: string[] | null
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          organization_id?: string
          setup_completed?: boolean | null
          updated_at?: string | null
          user_persona?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_webhook_settings: {
        Row: {
          auth_header_name: string | null
          auth_header_value: string | null
          created_at: string | null
          default_webhook_url: string | null
          enabled_events: string[] | null
          event_webhooks: Json | null
          id: string
          is_active: boolean | null
          last_event_at: string | null
          max_events_per_minute: number | null
          max_retries: number | null
          organization_id: string
          retry_delay_seconds: number | null
          total_events_failed: number | null
          total_events_sent: number | null
          updated_at: string | null
          webhook_secret: string | null
        }
        Insert: {
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string | null
          default_webhook_url?: string | null
          enabled_events?: string[] | null
          event_webhooks?: Json | null
          id?: string
          is_active?: boolean | null
          last_event_at?: string | null
          max_events_per_minute?: number | null
          max_retries?: number | null
          organization_id: string
          retry_delay_seconds?: number | null
          total_events_failed?: number | null
          total_events_sent?: number | null
          updated_at?: string | null
          webhook_secret?: string | null
        }
        Update: {
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string | null
          default_webhook_url?: string | null
          enabled_events?: string[] | null
          event_webhooks?: Json | null
          id?: string
          is_active?: boolean | null
          last_event_at?: string | null
          max_events_per_minute?: number | null
          max_retries?: number | null
          organization_id?: string
          retry_delay_seconds?: number | null
          total_events_failed?: number | null
          total_events_sent?: number | null
          updated_at?: string | null
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_webhook_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          attribution: Json | null
          created_at: string | null
          created_by_user_id: string | null
          current_usage: Json | null
          dmarc_ingest_secret: string | null
          id: string
          inbox_visibility_mode: string | null
          is_suspended: boolean | null
          is_white_labeled: boolean | null
          limit_hits: Json | null
          limits: Json | null
          logo_url: string | null
          name: string
          onboarded_at: string | null
          parent_id: string | null
          past_due_since: string | null
          plan_changed_at: string | null
          plan_changed_by: string | null
          plan_tier: string | null
          primary_domain: string | null
          settings: Json | null
          slug: string
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          trial_ends_at: string | null
          type: string
          updated_at: string | null
          white_label: Json | null
          white_label_enabled_at: string | null
        }
        Insert: {
          attribution?: Json | null
          created_at?: string | null
          created_by_user_id?: string | null
          current_usage?: Json | null
          dmarc_ingest_secret?: string | null
          id?: string
          inbox_visibility_mode?: string | null
          is_suspended?: boolean | null
          is_white_labeled?: boolean | null
          limit_hits?: Json | null
          limits?: Json | null
          logo_url?: string | null
          name: string
          onboarded_at?: string | null
          parent_id?: string | null
          past_due_since?: string | null
          plan_changed_at?: string | null
          plan_changed_by?: string | null
          plan_tier?: string | null
          primary_domain?: string | null
          settings?: Json | null
          slug: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          trial_ends_at?: string | null
          type: string
          updated_at?: string | null
          white_label?: Json | null
          white_label_enabled_at?: string | null
        }
        Update: {
          attribution?: Json | null
          created_at?: string | null
          created_by_user_id?: string | null
          current_usage?: Json | null
          dmarc_ingest_secret?: string | null
          id?: string
          inbox_visibility_mode?: string | null
          is_suspended?: boolean | null
          is_white_labeled?: boolean | null
          limit_hits?: Json | null
          limits?: Json | null
          logo_url?: string | null
          name?: string
          onboarded_at?: string | null
          parent_id?: string | null
          past_due_since?: string | null
          plan_changed_at?: string | null
          plan_changed_by?: string | null
          plan_tier?: string | null
          primary_domain?: string | null
          settings?: Json | null
          slug?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          trial_ends_at?: string | null
          type?: string
          updated_at?: string | null
          white_label?: Json | null
          white_label_enabled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "organizations_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_refresh_jobs: {
        Row: {
          apify_runs: Json
          contacts_added: number
          contacts_skipped: number
          created_at: string
          errors: Json
          finished_at: string | null
          id: string
          list_building_job_id: string | null
          organization_id: string
          poll_lock_until: string | null
          started_at: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          apify_runs?: Json
          contacts_added?: number
          contacts_skipped?: number
          created_at?: string
          errors?: Json
          finished_at?: string | null
          id?: string
          list_building_job_id?: string | null
          organization_id: string
          poll_lock_until?: string | null
          started_at?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          apify_runs?: Json
          contacts_added?: number
          contacts_skipped?: number
          created_at?: string
          errors?: Json
          finished_at?: string | null
          id?: string
          list_building_job_id?: string | null
          organization_id?: string
          poll_lock_until?: string | null
          started_at?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_refresh_jobs_list_building_job_id_fkey"
            columns: ["list_building_job_id"]
            isOneToOne: false
            referencedRelation: "list_building_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_refresh_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_refresh_jobs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "pack_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_subscriptions: {
        Row: {
          config: Json
          created_at: string
          daily_cap: number | null
          deleted_at: string | null
          destination_id: string | null
          destination_type: string | null
          icp_id: string | null
          icp_product_id: string | null
          id: string
          is_public: boolean
          last_refreshed_at: string | null
          lead_list_id: string | null
          min_icp_score: number | null
          name: string | null
          next_refresh_at: string
          organization_id: string
          pack_key: string
          public_published_at: string | null
          public_share_token: string | null
          refresh_cadence: string
          refresh_interval_minutes: number | null
          review_band: number | null
          signal_types: string[] | null
          smart_list_id: string | null
          stale_after_days: number | null
          status: string
          tier: string
          updated_at: string
          weekly_cap: number | null
        }
        Insert: {
          config?: Json
          created_at?: string
          daily_cap?: number | null
          deleted_at?: string | null
          destination_id?: string | null
          destination_type?: string | null
          icp_id?: string | null
          icp_product_id?: string | null
          id?: string
          is_public?: boolean
          last_refreshed_at?: string | null
          lead_list_id?: string | null
          min_icp_score?: number | null
          name?: string | null
          next_refresh_at?: string
          organization_id: string
          pack_key: string
          public_published_at?: string | null
          public_share_token?: string | null
          refresh_cadence?: string
          refresh_interval_minutes?: number | null
          review_band?: number | null
          signal_types?: string[] | null
          smart_list_id?: string | null
          stale_after_days?: number | null
          status?: string
          tier: string
          updated_at?: string
          weekly_cap?: number | null
        }
        Update: {
          config?: Json
          created_at?: string
          daily_cap?: number | null
          deleted_at?: string | null
          destination_id?: string | null
          destination_type?: string | null
          icp_id?: string | null
          icp_product_id?: string | null
          id?: string
          is_public?: boolean
          last_refreshed_at?: string | null
          lead_list_id?: string | null
          min_icp_score?: number | null
          name?: string | null
          next_refresh_at?: string
          organization_id?: string
          pack_key?: string
          public_published_at?: string | null
          public_share_token?: string | null
          refresh_cadence?: string
          refresh_interval_minutes?: number | null
          review_band?: number | null
          signal_types?: string[] | null
          smart_list_id?: string | null
          stale_after_days?: number | null
          status?: string
          tier?: string
          updated_at?: string
          weekly_cap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pack_subscriptions_icp_id_fkey"
            columns: ["icp_id"]
            isOneToOne: false
            referencedRelation: "library_icps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_subscriptions_icp_product_id_fkey"
            columns: ["icp_product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_subscriptions_lead_list_id_fkey"
            columns: ["lead_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_subscriptions_smart_list_id_fkey"
            columns: ["smart_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_evidence: {
        Row: {
          confidence: number
          domain: string
          email: string
          found_at: string
          id: string
          organization_id: string
          pattern_inferred: string | null
          source: string
          source_url: string | null
        }
        Insert: {
          confidence?: number
          domain: string
          email: string
          found_at?: string
          id?: string
          organization_id: string
          pattern_inferred?: string | null
          source: string
          source_url?: string | null
        }
        Update: {
          confidence?: number
          domain?: string
          email?: string
          found_at?: string
          id?: string
          organization_id?: string
          pattern_inferred?: string | null
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pattern_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      playbook_leads: {
        Row: {
          attribution: Json | null
          biggest_need: string | null
          email: string
          full_name: string | null
          icp_generated: Json | null
          icp_regen_count: number
          id: string
          linkedin_url: string | null
          niche: string | null
          notes: string | null
          organization_id: string | null
          outcome: string | null
          playbook_slug: string | null
          revenue: string | null
          source: string
          submitted_at: string
          team_size: string | null
          website: string | null
          what_tried: string | null
        }
        Insert: {
          attribution?: Json | null
          biggest_need?: string | null
          email: string
          full_name?: string | null
          icp_generated?: Json | null
          icp_regen_count?: number
          id?: string
          linkedin_url?: string | null
          niche?: string | null
          notes?: string | null
          organization_id?: string | null
          outcome?: string | null
          playbook_slug?: string | null
          revenue?: string | null
          source?: string
          submitted_at?: string
          team_size?: string | null
          website?: string | null
          what_tried?: string | null
        }
        Update: {
          attribution?: Json | null
          biggest_need?: string | null
          email?: string
          full_name?: string | null
          icp_generated?: Json | null
          icp_regen_count?: number
          id?: string
          linkedin_url?: string | null
          niche?: string | null
          notes?: string | null
          organization_id?: string | null
          outcome?: string | null
          playbook_slug?: string | null
          revenue?: string | null
          source?: string
          submitted_at?: string
          team_size?: string | null
          website?: string | null
          what_tried?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playbook_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_add_to_list_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_offset: number | null
          cursor_id: string | null
          cursor_row_count: number | null
          error_message: string | null
          errors: number | null
          id: string
          lease_until: string | null
          organization_id: string
          processed: number | null
          query_body: Json
          started_at: string | null
          status: string
          target_list_id: string
          total: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_offset?: number | null
          cursor_id?: string | null
          cursor_row_count?: number | null
          error_message?: string | null
          errors?: number | null
          id?: string
          lease_until?: string | null
          organization_id: string
          processed?: number | null
          query_body: Json
          started_at?: string | null
          status?: string
          target_list_id: string
          total?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_offset?: number | null
          cursor_id?: string | null
          cursor_row_count?: number | null
          error_message?: string | null
          errors?: number | null
          id?: string
          lease_until?: string | null
          organization_id?: string
          processed?: number | null
          query_body?: Json
          started_at?: string | null
          status?: string
          target_list_id?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_add_to_list_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_add_to_list_jobs_target_list_id_fkey"
            columns: ["target_list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_email_verifications: {
        Row: {
          created_at: string
          email_hash: string
          is_catch_all: boolean | null
          is_deliverable: boolean | null
          is_disabled: boolean | null
          is_disposable: boolean | null
          is_free: boolean | null
          is_role: boolean | null
          is_spamtrap: boolean | null
          last_source: string
          last_verified_at: string
          mx_host: string | null
          overall_score: number | null
          raw_result: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          email_hash: string
          is_catch_all?: boolean | null
          is_deliverable?: boolean | null
          is_disabled?: boolean | null
          is_disposable?: boolean | null
          is_free?: boolean | null
          is_role?: boolean | null
          is_spamtrap?: boolean | null
          last_source: string
          last_verified_at?: string
          mx_host?: string | null
          overall_score?: number | null
          raw_result?: Json | null
          status: string
        }
        Update: {
          created_at?: string
          email_hash?: string
          is_catch_all?: boolean | null
          is_deliverable?: boolean | null
          is_disabled?: boolean | null
          is_disposable?: boolean | null
          is_free?: boolean | null
          is_role?: boolean | null
          is_spamtrap?: boolean | null
          last_source?: string
          last_verified_at?: string
          mx_host?: string | null
          overall_score?: number | null
          raw_result?: Json | null
          status?: string
        }
        Relationships: []
      }
      pool_export_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedup_by_email: boolean
          error_message: string | null
          estimated_rows: number | null
          expires_at: string | null
          id: string
          lease_until: string | null
          next_slice: number
          organization_id: string
          parts: Json
          query_body: Json
          r2_prefix: string | null
          rows_written: number
          slice_rows: number | null
          slices_total: number | null
          started_at: string | null
          status: string
          total_rows: number | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedup_by_email?: boolean
          error_message?: string | null
          estimated_rows?: number | null
          expires_at?: string | null
          id?: string
          lease_until?: string | null
          next_slice?: number
          organization_id: string
          parts?: Json
          query_body: Json
          r2_prefix?: string | null
          rows_written?: number
          slice_rows?: number | null
          slices_total?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedup_by_email?: boolean
          error_message?: string | null
          estimated_rows?: number | null
          expires_at?: string | null
          id?: string
          lease_until?: string | null
          next_slice?: number
          organization_id?: string
          parts?: Json
          query_body?: Json
          r2_prefix?: string | null
          rows_written?: number
          slice_rows?: number | null
          slices_total?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_industries: {
        Row: {
          bucket: string
          display_name: string | null
          industry: string
          row_count: number
          updated_at: string
        }
        Insert: {
          bucket: string
          display_name?: string | null
          industry: string
          row_count: number
          updated_at?: string
        }
        Update: {
          bucket?: string
          display_name?: string | null
          industry?: string
          row_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      post_categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      postmaster_oauth_tokens: {
        Row: {
          access_token_encrypted: string | null
          access_token_expires_at: string | null
          account_email: string | null
          created_at: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          refresh_token_encrypted: string
          scopes: string[] | null
          status: string
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          account_email?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          refresh_token_encrypted: string
          scopes?: string[] | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          access_token_expires_at?: string | null
          account_email?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          refresh_token_encrypted?: string
          scopes?: string[] | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postmaster_oauth_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      presenter_avatars: {
        Row: {
          asset_url: string | null
          character_id: string | null
          created_at: string
          heygen_avatar_id: string | null
          id: string
          metadata: Json | null
          name: string
          organization_id: string
          type: string
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          asset_url?: string | null
          character_id?: string | null
          created_at?: string
          heygen_avatar_id?: string | null
          id?: string
          metadata?: Json | null
          name: string
          organization_id: string
          type: string
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          asset_url?: string | null
          character_id?: string | null
          created_at?: string
          heygen_avatar_id?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          organization_id?: string
          type?: string
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presenter_avatars_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "library_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presenter_avatars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      preview_documents: {
        Row: {
          blueprint_ids: string[] | null
          contact_id: string
          created_at: string
          document_json: Json
          icon: string | null
          id: string
          organization_id: string
          product_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          blueprint_ids?: string[] | null
          contact_id: string
          created_at?: string
          document_json: Json
          icon?: string | null
          id?: string
          organization_id: string
          product_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          blueprint_ids?: string[] | null
          contact_id?: string
          created_at?: string
          document_json?: Json
          icon?: string | null
          id?: string
          organization_id?: string
          product_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preview_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_block_fit: {
        Row: {
          block_id: string
          created_at: string | null
          fit_score: number | null
          id: string
          notes: string | null
          product_id: string
        }
        Insert: {
          block_id: string
          created_at?: string | null
          fit_score?: number | null
          id?: string
          notes?: string | null
          product_id: string
        }
        Update: {
          block_id?: string
          created_at?: string | null
          fit_score?: number | null
          id?: string
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_block_fit_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "library_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_block_fit_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_icp_fit: {
        Row: {
          created_at: string | null
          fit_score: number | null
          icp_id: string
          id: string
          notes: string | null
          product_id: string
        }
        Insert: {
          created_at?: string | null
          fit_score?: number | null
          icp_id: string
          id?: string
          notes?: string | null
          product_id: string
        }
        Update: {
          created_at?: string | null
          fit_score?: number | null
          icp_id?: string
          id?: string
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_icp_fit_icp_id_fkey"
            columns: ["icp_id"]
            isOneToOne: false
            referencedRelation: "library_icps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_icp_fit_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "library_products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          compare_price_cents: number | null
          created_at: string | null
          delivery_config: Json | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          price_cents: number
          product_type: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          compare_price_cents?: number | null
          created_at?: string | null
          delivery_config?: Json | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          price_cents: number
          product_type: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          compare_price_cents?: number | null
          created_at?: string | null
          delivery_config?: Json | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          price_cents?: number
          product_type?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_library: {
        Row: {
          category: string | null
          composed_of: string[] | null
          content_types: string[] | null
          created_at: string | null
          created_by: string | null
          description: string | null
          goals: string[] | null
          id: string
          is_preset: boolean | null
          is_public: boolean | null
          name: string
          organization_id: string
          pipeline_type: string | null
          preview_url: string | null
          prompt_content: string
          prompt_type: string
          scenario: string | null
          updated_at: string | null
          usage_count: number | null
          variables: Json | null
        }
        Insert: {
          category?: string | null
          composed_of?: string[] | null
          content_types?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          goals?: string[] | null
          id?: string
          is_preset?: boolean | null
          is_public?: boolean | null
          name: string
          organization_id: string
          pipeline_type?: string | null
          preview_url?: string | null
          prompt_content: string
          prompt_type?: string
          scenario?: string | null
          updated_at?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Update: {
          category?: string | null
          composed_of?: string[] | null
          content_types?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          goals?: string[] | null
          id?: string
          is_preset?: boolean | null
          is_public?: boolean | null
          name?: string
          organization_id?: string
          pipeline_type?: string | null
          preview_url?: string | null
          prompt_content?: string
          prompt_type?: string
          scenario?: string | null
          updated_at?: string | null
          usage_count?: number | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "prompt_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_library_tags: {
        Row: {
          created_at: string | null
          prompt_id: string
          tag: string
        }
        Insert: {
          created_at?: string | null
          prompt_id: string
          tag: string
        }
        Update: {
          created_at?: string | null
          prompt_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_library_tags_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompt_library"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_configs: {
        Row: {
          created_at: string | null
          fallback_providers: string[] | null
          id: string
          organization_id: string
          primary_provider: string
          provider_settings: Json | null
          service_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          fallback_providers?: string[] | null
          id?: string
          organization_id: string
          primary_provider: string
          provider_settings?: Json | null
          service_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          fallback_providers?: string[] | null
          id?: string
          organization_id?: string
          primary_provider?: string
          provider_settings?: Json | null
          service_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_registry: {
        Row: {
          api_version: string | null
          auth_type: string | null
          base_url: string | null
          capabilities: Json | null
          created_at: string | null
          display_name: string
          id: string
          is_active: boolean | null
          pricing_model: string | null
          pricing_rates: Json | null
          provider_name: string
          rate_limits: Json | null
          service_type: string
          updated_at: string | null
        }
        Insert: {
          api_version?: string | null
          auth_type?: string | null
          base_url?: string | null
          capabilities?: Json | null
          created_at?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          pricing_model?: string | null
          pricing_rates?: Json | null
          provider_name: string
          rate_limits?: Json | null
          service_type: string
          updated_at?: string | null
        }
        Update: {
          api_version?: string | null
          auth_type?: string | null
          base_url?: string | null
          capabilities?: Json | null
          created_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          pricing_model?: string | null
          pricing_rates?: Json | null
          provider_name?: string
          rate_limits?: Json | null
          service_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      provisioning_jobs: {
        Row: {
          completed_at: string | null
          current_task: string | null
          error: string | null
          id: string
          lead_id: string | null
          organization_id: string | null
          playbook_slug: string | null
          provisioning_token: string
          started_at: string
          status: string
          tasks_done: Json
          token_expires_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          current_task?: string | null
          error?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          playbook_slug?: string | null
          provisioning_token: string
          started_at?: string
          status?: string
          tasks_done?: Json
          token_expires_at?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          current_task?: string | null
          error?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          playbook_slug?: string | null
          provisioning_token?: string
          started_at?: string
          status?: string
          tasks_done?: Json
          token_expires_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "playbook_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provisioning_rate_limit: {
        Row: {
          hits: number
          key: string
          last_seen_at: string
          window_started_at: string
        }
        Insert: {
          hits?: number
          key: string
          last_seen_at?: string
          window_started_at?: string
        }
        Update: {
          hits?: number
          key?: string
          last_seen_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      public_signal_auto_enroll_rules: {
        Row: {
          created_at: string
          created_by: string | null
          filter_criteria: Json
          id: string
          last_run_at: string | null
          list_id: string
          lookback_days: number
          organization_id: string
          require_email: boolean
          signal_types: string[] | null
          source: string
          status: string
          total_enrolled: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filter_criteria?: Json
          id?: string
          last_run_at?: string | null
          list_id: string
          lookback_days?: number
          organization_id: string
          require_email?: boolean
          signal_types?: string[] | null
          source?: string
          status?: string
          total_enrolled?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filter_criteria?: Json
          id?: string
          last_run_at?: string | null
          list_id?: string
          lookback_days?: number
          organization_id?: string
          require_email?: boolean
          signal_types?: string[] | null
          source?: string
          status?: string
          total_enrolled?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_signal_auto_enroll_rules_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_signal_auto_enroll_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_signal_companies: {
        Row: {
          city: string | null
          company_key: string
          country: string | null
          domain: string | null
          employee_count: number | null
          employee_range: string | null
          enriched_at: string
          industry: string | null
          linkedin_industries: string[] | null
          naics_titles: string[] | null
          revenue_range: string | null
          source: string
          state: string | null
        }
        Insert: {
          city?: string | null
          company_key: string
          country?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_range?: string | null
          enriched_at?: string
          industry?: string | null
          linkedin_industries?: string[] | null
          naics_titles?: string[] | null
          revenue_range?: string | null
          source?: string
          state?: string | null
        }
        Update: {
          city?: string | null
          company_key?: string
          country?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_range?: string | null
          enriched_at?: string
          industry?: string | null
          linkedin_industries?: string[] | null
          naics_titles?: string[] | null
          revenue_range?: string | null
          source?: string
          state?: string | null
        }
        Relationships: []
      }
      public_signal_people: {
        Row: {
          company_key: string
          company_linkedin_url: string | null
          domain: string | null
          email: string | null
          email_status: string | null
          enriched_at: string
          full_name: string
          id: string
          linkedin_url: string
          photo_url: string | null
          seniority_rank: number
          source: string
          title: string | null
        }
        Insert: {
          company_key: string
          company_linkedin_url?: string | null
          domain?: string | null
          email?: string | null
          email_status?: string | null
          enriched_at?: string
          full_name: string
          id?: string
          linkedin_url: string
          photo_url?: string | null
          seniority_rank?: number
          source?: string
          title?: string | null
        }
        Update: {
          company_key?: string
          company_linkedin_url?: string | null
          domain?: string | null
          email?: string | null
          email_status?: string | null
          enriched_at?: string
          full_name?: string
          id?: string
          linkedin_url?: string
          photo_url?: string | null
          seniority_rank?: number
          source?: string
          title?: string | null
        }
        Relationships: []
      }
      public_signal_people_enrichment_state: {
        Row: {
          attempts: number
          company_key: string
          company_linkedin_url: string | null
          company_name: string
          completed_at: string | null
          created_at: string
          domain: string
          last_error: string | null
          last_signal_date: string
          lease_expires_at: string | null
          next_attempt_at: string
          pages_fetched: number
          people_found: number
          provider: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_key: string
          company_linkedin_url?: string | null
          company_name: string
          completed_at?: string | null
          created_at?: string
          domain: string
          last_error?: string | null
          last_signal_date: string
          lease_expires_at?: string | null
          next_attempt_at?: string
          pages_fetched?: number
          people_found?: number
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_key?: string
          company_linkedin_url?: string | null
          company_name?: string
          completed_at?: string | null
          created_at?: string
          domain?: string
          last_error?: string | null
          last_signal_date?: string
          lease_expires_at?: string | null
          next_attempt_at?: string
          pages_fetched?: number
          people_found?: number
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_signal_people_takedowns: {
        Row: {
          company_key: string | null
          created_at: string
          id: string
          linkedin_url: string | null
          reason: string | null
          scope: string
        }
        Insert: {
          company_key?: string | null
          created_at?: string
          id?: string
          linkedin_url?: string | null
          reason?: string | null
          scope: string
        }
        Update: {
          company_key?: string | null
          created_at?: string
          id?: string
          linkedin_url?: string | null
          reason?: string | null
          scope?: string
        }
        Relationships: []
      }
      public_signals: {
        Row: {
          amount_label: string | null
          amount_usd: number | null
          company_linkedin_url: string | null
          company_name: string
          confidence: number
          country: string | null
          created_at: string
          created_by: string | null
          date_precision: string
          dedup_key: string
          domain: string | null
          id: string
          location: string | null
          logo_url: string | null
          metadata: Json
          published: boolean
          quality_score: number
          signal_date: string
          signal_type: string
          source_key: string | null
          source_label: string | null
          source_url: string
          summary: string | null
          title: string | null
          updated_at: string
          verified: boolean
          why_it_matters: string | null
        }
        Insert: {
          amount_label?: string | null
          amount_usd?: number | null
          company_linkedin_url?: string | null
          company_name: string
          confidence?: number
          country?: string | null
          created_at?: string
          created_by?: string | null
          date_precision?: string
          dedup_key: string
          domain?: string | null
          id?: string
          location?: string | null
          logo_url?: string | null
          metadata?: Json
          published?: boolean
          quality_score?: number
          signal_date?: string
          signal_type: string
          source_key?: string | null
          source_label?: string | null
          source_url: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          verified?: boolean
          why_it_matters?: string | null
        }
        Update: {
          amount_label?: string | null
          amount_usd?: number | null
          company_linkedin_url?: string | null
          company_name?: string
          confidence?: number
          country?: string | null
          created_at?: string
          created_by?: string | null
          date_precision?: string
          dedup_key?: string
          domain?: string | null
          id?: string
          location?: string | null
          logo_url?: string | null
          metadata?: Json
          published?: boolean
          quality_score?: number
          signal_date?: string
          signal_type?: string
          source_key?: string | null
          source_label?: string | null
          source_url?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          verified?: boolean
          why_it_matters?: string | null
        }
        Relationships: []
      }
      publish_queue: {
        Row: {
          account_id: string
          attempts: number | null
          autopilot_id: string | null
          created_at: string | null
          id: string
          is_repost: boolean | null
          last_error: string | null
          organization_id: string | null
          output_id: string | null
          platform: string | null
          published_at: string | null
          scheduled_for: string
          source_publication_id: string | null
          status: string | null
          tweet_thread: Json | null
          variation_mode: string | null
        }
        Insert: {
          account_id: string
          attempts?: number | null
          autopilot_id?: string | null
          created_at?: string | null
          id?: string
          is_repost?: boolean | null
          last_error?: string | null
          organization_id?: string | null
          output_id?: string | null
          platform?: string | null
          published_at?: string | null
          scheduled_for: string
          source_publication_id?: string | null
          status?: string | null
          tweet_thread?: Json | null
          variation_mode?: string | null
        }
        Update: {
          account_id?: string
          attempts?: number | null
          autopilot_id?: string | null
          created_at?: string | null
          id?: string
          is_repost?: boolean | null
          last_error?: string | null
          organization_id?: string | null
          output_id?: string | null
          platform?: string | null
          published_at?: string | null
          scheduled_for?: string
          source_publication_id?: string | null
          status?: string | null
          tweet_thread?: Json | null
          variation_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publish_queue_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pool_stats"
            referencedColumns: ["autopilot_id"]
          },
          {
            foreignKeyName: "publish_queue_autopilot_id_fkey"
            columns: ["autopilot_id"]
            isOneToOne: false
            referencedRelation: "autopilots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_queue_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_queue: {
        Row: {
          content_output_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          organization_id: string
          platform: string
          platform_url: string | null
          platform_video_id: string | null
          published_at: string | null
          retry_count: number | null
          scheduled_for: string | null
          status: string | null
          video_id: string
        }
        Insert: {
          content_output_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          platform: string
          platform_url?: string | null
          platform_video_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          scheduled_for?: string | null
          status?: string | null
          video_id: string
        }
        Update: {
          content_output_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          platform?: string
          platform_url?: string | null
          platform_video_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          scheduled_for?: string | null
          status?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_queue_content_output_id_fkey"
            columns: ["content_output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_queue_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          created_at: string
          expires_at: string
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          count?: number
          created_at?: string
          expires_at: string
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          count?: number
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      registrar_credentials: {
        Row: {
          api_key_encrypted: string
          created_at: string | null
          id: string
          label: string
          last_error: string | null
          last_used_at: string | null
          organization_id: string
          provider: string
          secret_key_encrypted: string
          updated_at: string | null
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string | null
          id?: string
          label: string
          last_error?: string | null
          last_used_at?: string | null
          organization_id: string
          provider: string
          secret_key_encrypted: string
          updated_at?: string | null
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string | null
          id?: string
          label?: string
          last_error?: string | null
          last_used_at?: string | null
          organization_id?: string
          provider?: string
          secret_key_encrypted?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrar_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_notification_state: {
        Row: {
          conversation_id: string
          notified_at: string
          notified_message_at: string
          organization_id: string
        }
        Insert: {
          conversation_id: string
          notified_at?: string
          notified_message_at: string
          organization_id: string
        }
        Update: {
          conversation_id?: string
          notified_at?: string
          notified_message_at?: string
          organization_id?: string
        }
        Relationships: []
      }
      research_content: {
        Row: {
          ai_analysis: Json | null
          analyzed_at: string | null
          author_avatar_url: string | null
          author_handle: string | null
          author_name: string | null
          author_url: string | null
          conversion_in_progress: boolean | null
          converted_to_idea: boolean | null
          converted_to_idea_at: string | null
          created_at: string
          creator_id: string | null
          dataset_id: string | null
          description: string | null
          duration_seconds: number | null
          engagement: Json | null
          id: string
          idea_id: string | null
          organization_id: string
          platform: string
          platform_data: Json | null
          published_at: string | null
          raw_data: Json
          search_term_id: string | null
          source: string
          source_run_ids: string[] | null
          thumbnail_url: string | null
          title: string | null
          transcript: string | null
          transcript_error: string | null
          transcript_prediction_id: string | null
          transcript_preview: string | null
          transcript_url: string | null
          transcript_source: string | null
          transcript_status: string | null
          updated_at: string
          url: string
        }
        Insert: {
          ai_analysis?: Json | null
          analyzed_at?: string | null
          author_avatar_url?: string | null
          author_handle?: string | null
          author_name?: string | null
          author_url?: string | null
          conversion_in_progress?: boolean | null
          converted_to_idea?: boolean | null
          converted_to_idea_at?: string | null
          created_at?: string
          creator_id?: string | null
          dataset_id?: string | null
          description?: string | null
          duration_seconds?: number | null
          engagement?: Json | null
          id: string
          idea_id?: string | null
          organization_id: string
          platform: string
          platform_data?: Json | null
          published_at?: string | null
          raw_data?: Json
          search_term_id?: string | null
          source?: string
          source_run_ids?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
          transcript?: string | null
          transcript_error?: string | null
          transcript_prediction_id?: string | null
          transcript_preview?: string | null
          transcript_url?: string | null
          transcript_source?: string | null
          transcript_status?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          ai_analysis?: Json | null
          analyzed_at?: string | null
          author_avatar_url?: string | null
          author_handle?: string | null
          author_name?: string | null
          author_url?: string | null
          conversion_in_progress?: boolean | null
          converted_to_idea?: boolean | null
          converted_to_idea_at?: string | null
          created_at?: string
          creator_id?: string | null
          dataset_id?: string | null
          description?: string | null
          duration_seconds?: number | null
          engagement?: Json | null
          id?: string
          idea_id?: string | null
          organization_id?: string
          platform?: string
          platform_data?: Json | null
          published_at?: string | null
          raw_data?: Json
          search_term_id?: string | null
          source?: string
          source_run_ids?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
          transcript?: string | null
          transcript_error?: string | null
          transcript_prediction_id?: string | null
          transcript_preview?: string | null
          transcript_url?: string | null
          transcript_source?: string | null
          transcript_status?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_content_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "research_creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_content_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_content_search_term_id_fkey"
            columns: ["search_term_id"]
            isOneToOne: false
            referencedRelation: "research_search_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      research_creators: {
        Row: {
          avatar_url: string | null
          channel_id: string | null
          channel_url: string | null
          created_at: string | null
          description: string | null
          display_name: string
          follower_count: number | null
          following_count: number | null
          id: string
          last_scraped_at: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string
          platform: string
          sort_order: number | null
          subscriber_count: number | null
          tags: string[] | null
          total_comments: number | null
          total_content_items: number | null
          total_likes: number | null
          total_shares: number | null
          updated_at: string | null
          verified: boolean | null
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          avatar_url?: string | null
          channel_id?: string | null
          channel_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name: string
          follower_count?: number | null
          following_count?: number | null
          id: string
          last_scraped_at?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id: string
          platform: string
          sort_order?: number | null
          subscriber_count?: number | null
          tags?: string[] | null
          total_comments?: number | null
          total_content_items?: number | null
          total_likes?: number | null
          total_shares?: number | null
          updated_at?: string | null
          verified?: boolean | null
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          avatar_url?: string | null
          channel_id?: string | null
          channel_url?: string | null
          created_at?: string | null
          description?: string | null
          display_name?: string
          follower_count?: number | null
          following_count?: number | null
          id?: string
          last_scraped_at?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string
          platform?: string
          sort_order?: number | null
          subscriber_count?: number | null
          tags?: string[] | null
          total_comments?: number | null
          total_content_items?: number | null
          total_likes?: number | null
          total_shares?: number | null
          updated_at?: string | null
          verified?: boolean | null
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "research_creators_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      research_scrape_runs: {
        Row: {
          actor_id: string | null
          apify_run_id: string | null
          apify_run_url: string | null
          completed_at: string | null
          creator_id: string | null
          dataset_id: string | null
          error_message: string | null
          items_scraped: number | null
          metadata: Json | null
          organization_id: string
          retry_of_run_id: string | null
          run_id: string
          schedule_id: string | null
          search_term_id: string | null
          status: string
          triggered_at: string
        }
        Insert: {
          actor_id?: string | null
          apify_run_id?: string | null
          apify_run_url?: string | null
          completed_at?: string | null
          creator_id?: string | null
          dataset_id?: string | null
          error_message?: string | null
          items_scraped?: number | null
          metadata?: Json | null
          organization_id: string
          retry_of_run_id?: string | null
          run_id: string
          schedule_id?: string | null
          search_term_id?: string | null
          status: string
          triggered_at: string
        }
        Update: {
          actor_id?: string | null
          apify_run_id?: string | null
          apify_run_url?: string | null
          completed_at?: string | null
          creator_id?: string | null
          dataset_id?: string | null
          error_message?: string | null
          items_scraped?: number | null
          metadata?: Json | null
          organization_id?: string
          retry_of_run_id?: string | null
          run_id?: string
          schedule_id?: string | null
          search_term_id?: string | null
          status?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_scrape_runs_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "research_creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_scrape_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_scrape_runs_search_term_id_fkey"
            columns: ["search_term_id"]
            isOneToOne: false
            referencedRelation: "research_search_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      research_search_terms: {
        Row: {
          created_at: string | null
          id: string
          last_scraped_at: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string
          platform: string
          search_term: string
          sort_order: number | null
          tags: string[] | null
          total_results: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          last_scraped_at?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id: string
          platform: string
          search_term: string
          sort_order?: number | null
          tags?: string[] | null
          total_results?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_scraped_at?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string
          platform?: string
          search_term?: string
          sort_order?: number | null
          tags?: string[] | null
          total_results?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_search_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_sync_log: {
        Row: {
          error_message: string | null
          id: string
          resource_id: string
          resource_type: string
          shared_resource_id: string | null
          sync_status: string
          synced_at: string | null
          target_organization_id: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          resource_id: string
          resource_type: string
          shared_resource_id?: string | null
          sync_status: string
          synced_at?: string | null
          target_organization_id?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          resource_id?: string
          resource_type?: string
          shared_resource_id?: string | null
          sync_status?: string
          synced_at?: string | null
          target_organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_sync_log_shared_resource_id_fkey"
            columns: ["shared_resource_id"]
            isOneToOne: false
            referencedRelation: "shared_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_sync_log_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_cache: {
        Row: {
          cache_key: string
          created_at: string
          payload: Json
          website: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          payload: Json
          website: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          payload?: Json
          website?: string
        }
        Relationships: []
      }
      sandbox_rate_limit: {
        Row: {
          created_at: string
          id: number
          ip: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          ip: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          ip?: string
          website?: string | null
        }
        Relationships: []
      }
      scenes: {
        Row: {
          approved: boolean | null
          audio_path: string | null
          audio_url: string | null
          created_at: string | null
          description: string
          duration: number | null
          id: string
          image_path: string | null
          image_prompt: string
          image_url: string | null
          metadata: Json | null
          narration: string | null
          organization_id: string
          regeneration_count: number | null
          scene_number: number
          status: string | null
          updated_at: string | null
          video_id: string
          video_path: string | null
          video_url: string | null
        }
        Insert: {
          approved?: boolean | null
          audio_path?: string | null
          audio_url?: string | null
          created_at?: string | null
          description: string
          duration?: number | null
          id?: string
          image_path?: string | null
          image_prompt: string
          image_url?: string | null
          metadata?: Json | null
          narration?: string | null
          organization_id: string
          regeneration_count?: number | null
          scene_number: number
          status?: string | null
          updated_at?: string | null
          video_id: string
          video_path?: string | null
          video_url?: string | null
        }
        Update: {
          approved?: boolean | null
          audio_path?: string | null
          audio_url?: string | null
          created_at?: string | null
          description?: string
          duration?: number | null
          id?: string
          image_path?: string | null
          image_prompt?: string
          image_url?: string | null
          metadata?: Json | null
          narration?: string | null
          organization_id?: string
          regeneration_count?: number | null
          scene_number?: number
          status?: string | null
          updated_at?: string | null
          video_id?: string
          video_path?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_schedules: {
        Row: {
          auto_pause_on_failure: boolean | null
          consecutive_failures: number | null
          created_at: string | null
          created_by: string | null
          creator_id: string
          cron_expression: string | null
          description: string | null
          frequency_type: string
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string | null
          next_run_at: string
          organization_id: string
          parent_schedule_id: string | null
          platform: string
          schedule_type: string | null
          scrape_config: Json | null
          updated_at: string | null
        }
        Insert: {
          auto_pause_on_failure?: boolean | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          creator_id: string
          cron_expression?: string | null
          description?: string | null
          frequency_type: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string | null
          next_run_at: string
          organization_id: string
          parent_schedule_id?: string | null
          platform: string
          schedule_type?: string | null
          scrape_config?: Json | null
          updated_at?: string | null
        }
        Update: {
          auto_pause_on_failure?: boolean | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          creator_id?: string
          cron_expression?: string | null
          description?: string | null
          frequency_type?: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string | null
          next_run_at?: string
          organization_id?: string
          parent_schedule_id?: string | null
          platform?: string
          schedule_type?: string | null
          scrape_config?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "scrape_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_schedules_parent_schedule_id_fkey"
            columns: ["parent_schedule_id"]
            isOneToOne: false
            referencedRelation: "scrape_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      scraper_configs: {
        Row: {
          config: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          next_run_at: string | null
          organization_id: string
          run_interval_minutes: number | null
          source_type: string
        }
        Insert: {
          config: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id: string
          run_interval_minutes?: number | null
          source_type: string
        }
        Update: {
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id?: string
          run_interval_minutes?: number | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraper_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      script_scenes: {
        Row: {
          b_roll_suggestions: string[] | null
          camera_direction: string | null
          created_at: string | null
          emotional_cues: Json | null
          end_time: number | null
          generated_from_research: string[] | null
          graphics_needed: string[] | null
          id: string
          metadata: Json | null
          narration: string
          narration_duration: number | null
          narration_word_count: number | null
          on_screen_text: string | null
          pacing: string | null
          regeneration_count: number | null
          scene_number: number
          scene_title: string | null
          scene_type: string | null
          script_id: string
          start_time: number | null
          transition_duration: number | null
          transition_type: string | null
          updated_at: string | null
          visual_description: string | null
        }
        Insert: {
          b_roll_suggestions?: string[] | null
          camera_direction?: string | null
          created_at?: string | null
          emotional_cues?: Json | null
          end_time?: number | null
          generated_from_research?: string[] | null
          graphics_needed?: string[] | null
          id?: string
          metadata?: Json | null
          narration: string
          narration_duration?: number | null
          narration_word_count?: number | null
          on_screen_text?: string | null
          pacing?: string | null
          regeneration_count?: number | null
          scene_number: number
          scene_title?: string | null
          scene_type?: string | null
          script_id: string
          start_time?: number | null
          transition_duration?: number | null
          transition_type?: string | null
          updated_at?: string | null
          visual_description?: string | null
        }
        Update: {
          b_roll_suggestions?: string[] | null
          camera_direction?: string | null
          created_at?: string | null
          emotional_cues?: Json | null
          end_time?: number | null
          generated_from_research?: string[] | null
          graphics_needed?: string[] | null
          id?: string
          metadata?: Json | null
          narration?: string
          narration_duration?: number | null
          narration_word_count?: number | null
          on_screen_text?: string | null
          pacing?: string | null
          regeneration_count?: number | null
          scene_number?: number
          scene_title?: string | null
          scene_type?: string | null
          script_id?: string
          start_time?: number | null
          transition_duration?: number | null
          transition_type?: string | null
          updated_at?: string | null
          visual_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "script_scenes_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "youtube_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      script_versions: {
        Row: {
          change_summary: string | null
          change_type: string | null
          created_at: string | null
          created_by: string | null
          diff: Json | null
          id: string
          script_id: string
          snapshot: Json
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          change_type?: string | null
          created_at?: string | null
          created_by?: string | null
          diff?: Json | null
          id?: string
          script_id: string
          snapshot: Json
          version_number: number
        }
        Update: {
          change_summary?: string | null
          change_type?: string | null
          created_at?: string | null
          created_by?: string | null
          diff?: Json | null
          id?: string
          script_id?: string
          snapshot?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_versions_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "youtube_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      search_history: {
        Row: {
          apify_dataset_id: string | null
          apify_run_id: string | null
          completed_at: string | null
          created_at: string | null
          error_details: Json | null
          error_message: string | null
          id: string
          items_added: number | null
          items_duplicate: number | null
          items_scraped: number | null
          organization_id: string
          platform: string
          schedule_id: string | null
          scrape_config: Json | null
          search_term: string
          search_term_id: string
          started_at: string | null
          status: string
          trigger_type: string | null
          triggered_at: string | null
          triggered_by: string | null
        }
        Insert: {
          apify_dataset_id?: string | null
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_added?: number | null
          items_duplicate?: number | null
          items_scraped?: number | null
          organization_id: string
          platform: string
          schedule_id?: string | null
          scrape_config?: Json | null
          search_term: string
          search_term_id: string
          started_at?: string | null
          status?: string
          trigger_type?: string | null
          triggered_at?: string | null
          triggered_by?: string | null
        }
        Update: {
          apify_dataset_id?: string | null
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_added?: number | null
          items_duplicate?: number | null
          items_scraped?: number | null
          organization_id?: string
          platform?: string
          schedule_id?: string | null
          scrape_config?: Json | null
          search_term?: string
          search_term_id?: string
          started_at?: string | null
          status?: string
          trigger_type?: string | null
          triggered_at?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_search_history_schedule"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "search_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_history_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "search_history_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      search_schedules: {
        Row: {
          auto_pause_on_failure: boolean | null
          consecutive_failures: number | null
          created_at: string | null
          created_by: string | null
          cron_expression: string | null
          description: string | null
          frequency_type: string
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string | null
          next_run_at: string
          organization_id: string
          parent_schedule_id: string | null
          schedule_type: string | null
          scrape_config: Json | null
          search_term_id: string
          updated_at: string | null
        }
        Insert: {
          auto_pause_on_failure?: boolean | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          cron_expression?: string | null
          description?: string | null
          frequency_type: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string | null
          next_run_at: string
          organization_id: string
          parent_schedule_id?: string | null
          schedule_type?: string | null
          scrape_config?: Json | null
          search_term_id: string
          updated_at?: string | null
        }
        Update: {
          auto_pause_on_failure?: boolean | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          cron_expression?: string | null
          description?: string | null
          frequency_type?: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string | null
          next_run_at?: string
          organization_id?: string
          parent_schedule_id?: string | null
          schedule_type?: string | null
          scrape_config?: Json | null
          search_term_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "search_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_schedules_parent_schedule_id_fkey"
            columns: ["parent_schedule_id"]
            isOneToOne: false
            referencedRelation: "search_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_resources: {
        Row: {
          auto_sync_updates: boolean | null
          created_at: string | null
          id: string
          is_master: boolean | null
          last_synced_at: string | null
          owner_organization_id: string
          resource_id: string
          resource_type: string
        }
        Insert: {
          auto_sync_updates?: boolean | null
          created_at?: string | null
          id?: string
          is_master?: boolean | null
          last_synced_at?: string | null
          owner_organization_id: string
          resource_id: string
          resource_type: string
        }
        Update: {
          auto_sync_updates?: boolean | null
          created_at?: string | null
          id?: string
          is_master?: boolean | null
          last_synced_at?: string | null
          owner_organization_id?: string
          resource_id?: string
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_resources_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_activity_log: {
        Row: {
          contact_id: string | null
          contact_id_resolved: string | null
          created_at: string
          data: Json | null
          destination_id: string | null
          destination_type: string | null
          discovered_company_id: string | null
          event_cluster_key: string | null
          export_destination_record_id: string | null
          export_error: string | null
          exported_at: string | null
          icp_score: number | null
          id: number
          organization_id: string
          outcome: string
          signal_dedup_key: string | null
          signal_detail: string | null
          signal_type: string | null
          subscription_id: string
        }
        Insert: {
          contact_id?: string | null
          contact_id_resolved?: string | null
          created_at?: string
          data?: Json | null
          destination_id?: string | null
          destination_type?: string | null
          discovered_company_id?: string | null
          event_cluster_key?: string | null
          export_destination_record_id?: string | null
          export_error?: string | null
          exported_at?: string | null
          icp_score?: number | null
          id?: number
          organization_id: string
          outcome: string
          signal_dedup_key?: string | null
          signal_detail?: string | null
          signal_type?: string | null
          subscription_id: string
        }
        Update: {
          contact_id?: string | null
          contact_id_resolved?: string | null
          created_at?: string
          data?: Json | null
          destination_id?: string | null
          destination_type?: string | null
          discovered_company_id?: string | null
          event_cluster_key?: string | null
          export_destination_record_id?: string | null
          export_error?: string | null
          exported_at?: string | null
          icp_score?: number | null
          id?: number
          organization_id?: string
          outcome?: string
          signal_dedup_key?: string | null
          signal_detail?: string | null
          signal_type?: string | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_activity_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_contact_id_resolved_fkey"
            columns: ["contact_id_resolved"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_contact_id_resolved_fkey"
            columns: ["contact_id_resolved"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_discovered_company_id_fkey"
            columns: ["discovered_company_id"]
            isOneToOne: false
            referencedRelation: "lb_discovered_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_activity_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "pack_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_engine_runs: {
        Row: {
          collector_key: string
          error: string | null
          finished_at: string | null
          id: string
          llm_calls: number
          llm_cost_usd: number
          meta: Json
          observations_duplicate: number
          observations_written: number
          source_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          collector_key: string
          error?: string | null
          finished_at?: string | null
          id?: string
          llm_calls?: number
          llm_cost_usd?: number
          meta?: Json
          observations_duplicate?: number
          observations_written?: number
          source_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          collector_key?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          llm_calls?: number
          llm_cost_usd?: number
          meta?: Json
          observations_duplicate?: number
          observations_written?: number
          source_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_engine_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "signal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_events: {
        Row: {
          company_identity_id: string
          confidence: number
          corroboration_count: number
          created_at: string
          dedupe_key: string
          event_type: string
          first_seen_at: string
          id: string
          last_seen_at: string
          observation_ids: string[]
          occurred_at: string
          payload: Json
          public_signal_id: string | null
          publish_attempts: number
          publish_error: string | null
          publish_status: string
          published_to_public_at: string | null
          source_ids: string[]
          updated_at: string
        }
        Insert: {
          company_identity_id: string
          confidence?: number
          corroboration_count?: number
          created_at?: string
          dedupe_key: string
          event_type: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          observation_ids?: string[]
          occurred_at: string
          payload?: Json
          public_signal_id?: string | null
          publish_attempts?: number
          publish_error?: string | null
          publish_status?: string
          published_to_public_at?: string | null
          source_ids?: string[]
          updated_at?: string
        }
        Update: {
          company_identity_id?: string
          confidence?: number
          corroboration_count?: number
          created_at?: string
          dedupe_key?: string
          event_type?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          observation_ids?: string[]
          occurred_at?: string
          payload?: Json
          public_signal_id?: string | null
          publish_attempts?: number
          publish_error?: string | null
          publish_status?: string
          published_to_public_at?: string | null
          source_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_events_company_identity_id_fkey"
            columns: ["company_identity_id"]
            isOneToOne: false
            referencedRelation: "company_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_public_signal_id_fkey"
            columns: ["public_signal_id"]
            isOneToOne: false
            referencedRelation: "public_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_observations: {
        Row: {
          attempts: number
          body_text: string | null
          claimed_by: string | null
          collector_key: string
          company_identity_id: string | null
          created_at: string
          entity_hints: Json
          error: string | null
          event_type: string | null
          external_id: string
          extracted: Json | null
          id: string
          lease_until: string | null
          observed_at: string
          published_at: string | null
          signal_event_id: string | null
          source_id: string
          source_url: string | null
          status: string
          structured: Json | null
          title: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          body_text?: string | null
          claimed_by?: string | null
          collector_key: string
          company_identity_id?: string | null
          created_at?: string
          entity_hints?: Json
          error?: string | null
          event_type?: string | null
          external_id: string
          extracted?: Json | null
          id?: string
          lease_until?: string | null
          observed_at?: string
          published_at?: string | null
          signal_event_id?: string | null
          source_id: string
          source_url?: string | null
          status?: string
          structured?: Json | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          body_text?: string | null
          claimed_by?: string | null
          collector_key?: string
          company_identity_id?: string | null
          created_at?: string
          entity_hints?: Json
          error?: string | null
          event_type?: string | null
          external_id?: string
          extracted?: Json | null
          id?: string
          lease_until?: string | null
          observed_at?: string
          published_at?: string | null
          signal_event_id?: string | null
          source_id?: string
          source_url?: string | null
          status?: string
          structured?: Json | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_observations_company_identity_id_fkey"
            columns: ["company_identity_id"]
            isOneToOne: false
            referencedRelation: "company_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_observations_signal_event_id_fkey"
            columns: ["signal_event_id"]
            isOneToOne: false
            referencedRelation: "signal_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "signal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_review_queue: {
        Row: {
          contact_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          discovered_company_id: string | null
          evidence_url: string | null
          expires_at: string
          icp_score: number | null
          icp_score_reasoning: string | null
          id: string
          organization_id: string
          signal_date: string | null
          signal_detail: string | null
          signal_type: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          discovered_company_id?: string | null
          evidence_url?: string | null
          expires_at?: string
          icp_score?: number | null
          icp_score_reasoning?: string | null
          id?: string
          organization_id: string
          signal_date?: string | null
          signal_detail?: string | null
          signal_type?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          discovered_company_id?: string | null
          evidence_url?: string | null
          expires_at?: string
          icp_score?: number | null
          icp_score_reasoning?: string | null
          id?: string
          organization_id?: string
          signal_date?: string | null
          signal_detail?: string | null
          signal_type?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_review_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_review_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_review_queue_discovered_company_id_fkey"
            columns: ["discovered_company_id"]
            isOneToOne: false
            referencedRelation: "lb_discovered_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_review_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_review_queue_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "pack_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_sources: {
        Row: {
          collector_key: string
          config: Json
          consecutive_empty_runs: number
          consecutive_failures: number
          created_at: string
          cursor: Json
          enabled: boolean
          external_key: string
          id: string
          kind: string
          label: string
          last_error: string | null
          last_run_at: string | null
          last_success_at: string | null
          updated_at: string
        }
        Insert: {
          collector_key: string
          config?: Json
          consecutive_empty_runs?: number
          consecutive_failures?: number
          created_at?: string
          cursor?: Json
          enabled?: boolean
          external_key: string
          id?: string
          kind: string
          label: string
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Update: {
          collector_key?: string
          config?: Json
          consecutive_empty_runs?: number
          consecutive_failures?: number
          created_at?: string
          cursor?: Json
          enabled?: boolean
          external_key?: string
          id?: string
          kind?: string
          label?: string
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      signals_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          last_sent_at: string | null
          source: string | null
          status: string
          unsubscribe_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          last_sent_at?: string | null
          source?: string | null
          status?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_sent_at?: string | null
          source?: string | null
          status?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      signup_requests: {
        Row: {
          admin_notes: string | null
          assigned_plan_tier: string | null
          created_at: string | null
          created_organization_id: string | null
          created_user_id: string | null
          email: string
          full_name: string
          id: string
          processed_at: string | null
          processed_by: string | null
          rejection_reason: string | null
          skool_username: string | null
          source: string | null
          source_data: Json | null
          status: Database["public"]["Enums"]["signup_request_status"] | null
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          assigned_plan_tier?: string | null
          created_at?: string | null
          created_organization_id?: string | null
          created_user_id?: string | null
          email: string
          full_name: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          rejection_reason?: string | null
          skool_username?: string | null
          source?: string | null
          source_data?: Json | null
          status?: Database["public"]["Enums"]["signup_request_status"] | null
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          assigned_plan_tier?: string | null
          created_at?: string | null
          created_organization_id?: string | null
          created_user_id?: string | null
          email?: string
          full_name?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          rejection_reason?: string | null
          skool_username?: string | null
          source?: string | null
          source_data?: Json | null
          status?: Database["public"]["Enums"]["signup_request_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_requests_created_organization_id_fkey"
            columns: ["created_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          install_count: number
          is_public: boolean
          name: string
          organization_id: string
          slug: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          install_count?: number
          is_public?: boolean
          name: string
          organization_id: string
          slug: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          install_count?: number
          is_public?: boolean
          name?: string
          organization_id?: string
          slug?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skool_communities: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          is_active: boolean | null
          last_sync_result: Json | null
          last_synced_at: string | null
          name: string
          plan_mapping: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          is_active?: boolean | null
          last_sync_result?: Json | null
          last_synced_at?: string | null
          name: string
          plan_mapping?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          is_active?: boolean | null
          last_sync_result?: Json | null
          last_synced_at?: string | null
          name?: string
          plan_mapping?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          angle_application: Json | null
          campaign_id: string | null
          content: string
          content_idea_id: string | null
          created_at: string | null
          created_by: string | null
          cta_variations: Json | null
          engagement_metrics: Json | null
          hashtags: string[] | null
          hook_variations: Json | null
          id: string
          image_prompts: Json | null
          image_urls: string[] | null
          library_elements: Json | null
          metadata: Json | null
          organization_id: string
          parent_post_id: string | null
          performance_score: number | null
          platform: string
          post_structure: Json | null
          predicted_metrics: Json | null
          published_at: string | null
          published_url: string | null
          scheduled_for: string | null
          selected_cta_index: number | null
          selected_hook_index: number | null
          status: string | null
          strategic_purpose: Json | null
          updated_at: string | null
          variation_metadata: Json | null
          variation_type: string | null
          video_urls: string[] | null
        }
        Insert: {
          angle_application?: Json | null
          campaign_id?: string | null
          content: string
          content_idea_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cta_variations?: Json | null
          engagement_metrics?: Json | null
          hashtags?: string[] | null
          hook_variations?: Json | null
          id?: string
          image_prompts?: Json | null
          image_urls?: string[] | null
          library_elements?: Json | null
          metadata?: Json | null
          organization_id: string
          parent_post_id?: string | null
          performance_score?: number | null
          platform: string
          post_structure?: Json | null
          predicted_metrics?: Json | null
          published_at?: string | null
          published_url?: string | null
          scheduled_for?: string | null
          selected_cta_index?: number | null
          selected_hook_index?: number | null
          status?: string | null
          strategic_purpose?: Json | null
          updated_at?: string | null
          variation_metadata?: Json | null
          variation_type?: string | null
          video_urls?: string[] | null
        }
        Update: {
          angle_application?: Json | null
          campaign_id?: string | null
          content?: string
          content_idea_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cta_variations?: Json | null
          engagement_metrics?: Json | null
          hashtags?: string[] | null
          hook_variations?: Json | null
          id?: string
          image_prompts?: Json | null
          image_urls?: string[] | null
          library_elements?: Json | null
          metadata?: Json | null
          organization_id?: string
          parent_post_id?: string | null
          performance_score?: number | null
          platform?: string
          post_structure?: Json | null
          predicted_metrics?: Json | null
          published_at?: string | null
          published_url?: string | null
          scheduled_for?: string | null
          selected_cta_index?: number | null
          selected_hook_index?: number | null
          status?: string | null
          strategic_purpose?: Json | null
          updated_at?: string | null
          variation_metadata?: Json | null
          variation_type?: string | null
          video_urls?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_content_idea_id_fkey"
            columns: ["content_idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_parent_post_id_fkey"
            columns: ["parent_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_approvals: {
        Row: {
          action: string
          created_at: string | null
          id: string
          notes: string | null
          output_id: string
          stage_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          notes?: string | null
          output_id: string
          stage_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          output_id?: string
          stage_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_approvals_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "content_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_credentials: {
        Row: {
          bucket_name: string
          created_at: string | null
          credentials_encrypted: string
          error_message: string | null
          id: string
          is_active: boolean | null
          is_valid: boolean | null
          last_tested_at: string | null
          last_upload_at: string | null
          organization_id: string
          provider: string
          public_url: string | null
          region: string | null
          total_size_bytes: number | null
          total_uploads: number | null
          updated_at: string | null
        }
        Insert: {
          bucket_name: string
          created_at?: string | null
          credentials_encrypted: string
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          last_upload_at?: string | null
          organization_id: string
          provider: string
          public_url?: string | null
          region?: string | null
          total_size_bytes?: number | null
          total_uploads?: number | null
          updated_at?: string | null
        }
        Update: {
          bucket_name?: string
          created_at?: string | null
          credentials_encrypted?: string
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          last_upload_at?: string | null
          organization_id?: string
          provider?: string
          public_url?: string | null
          region?: string | null
          total_size_bytes?: number | null
          total_uploads?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_orders: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          business_domain: string
          city: string | null
          company_name: string
          contact_email: string
          contact_first_name: string
          contact_last_name: string
          country_code: string | null
          created_at: string | null
          created_by: string | null
          failure_reason: string | null
          id: string
          m365_admin_email: string | null
          m365_admin_temp_password_sent_at: string | null
          m365_tenant_domain: string | null
          organization_id: string
          pax8_company_id: string | null
          pax8_order_id: string | null
          pax8_subscription_id: string | null
          pax8_tenant_id: string | null
          phone_country_code: string | null
          phone_number: string | null
          postal_code: string | null
          state_province: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          terms_accepted_at: string | null
          updated_at: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          business_domain: string
          city?: string | null
          company_name: string
          contact_email: string
          contact_first_name: string
          contact_last_name: string
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          failure_reason?: string | null
          id?: string
          m365_admin_email?: string | null
          m365_admin_temp_password_sent_at?: string | null
          m365_tenant_domain?: string | null
          organization_id: string
          pax8_company_id?: string | null
          pax8_order_id?: string | null
          pax8_subscription_id?: string | null
          pax8_tenant_id?: string | null
          phone_country_code?: string | null
          phone_number?: string | null
          postal_code?: string | null
          state_province?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          business_domain?: string
          city?: string | null
          company_name?: string
          contact_email?: string
          contact_first_name?: string
          contact_last_name?: string
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          failure_reason?: string | null
          id?: string
          m365_admin_email?: string | null
          m365_admin_temp_password_sent_at?: string | null
          m365_tenant_domain?: string | null
          organization_id?: string
          pax8_company_id?: string | null
          pax8_order_id?: string | null
          pax8_subscription_id?: string | null
          pax8_tenant_id?: string | null
          phone_country_code?: string | null
          phone_number?: string | null
          postal_code?: string | null
          state_province?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          country: string | null
          created_at: string | null
          customer_id: string | null
          device_type: string | null
          event_data: Json | null
          event_type: string
          funnel_id: string | null
          id: string
          ip_address: unknown
          org_id: string
          page_id: string | null
          referrer: string | null
          session_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          customer_id?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_type: string
          funnel_id?: string | null
          id?: string
          ip_address?: unknown
          org_id: string
          page_id?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          customer_id?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_type?: string
          funnel_id?: string | null
          id?: string
          ip_address?: unknown
          org_id?: string
          page_id?: string | null
          referrer?: string | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "tracking_events_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "funnel_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      twitter_accounts: {
        Row: {
          access_token_encrypted: string
          access_token_secret_encrypted: string
          consumer_key_encrypted: string
          consumer_secret_encrypted: string
          created_at: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          is_valid: boolean | null
          last_tested_at: string | null
          name: string
          organization_id: string
          profile_image_url: string | null
          twitter_handle: string | null
          twitter_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_token_encrypted: string
          access_token_secret_encrypted: string
          consumer_key_encrypted: string
          consumer_secret_encrypted: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          name: string
          organization_id: string
          profile_image_url?: string | null
          twitter_handle?: string | null
          twitter_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token_encrypted?: string
          access_token_secret_encrypted?: string
          consumer_key_encrypted?: string
          consumer_secret_encrypted?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          name?: string
          organization_id?: string
          profile_image_url?: string | null
          twitter_handle?: string | null
          twitter_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "twitter_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_accounts: {
        Row: {
          access_token_encrypted: string
          avatar_url: string | null
          connections_count: number | null
          connections_sync_status: string | null
          connections_synced_at: string | null
          created_at: string | null
          display_name: string | null
          dsn_url: string
          error_message: string | null
          first_name: string | null
          id: string
          last_name: string | null
          last_synced_at: string | null
          metadata: Json | null
          organization_id: string
          owner_user_id: string | null
          profile_url: string | null
          provider: string
          scopes: string[] | null
          status: string | null
          unipile_account_id: string
          updated_at: string | null
          username: string | null
        }
        Insert: {
          access_token_encrypted: string
          avatar_url?: string | null
          connections_count?: number | null
          connections_sync_status?: string | null
          connections_synced_at?: string | null
          created_at?: string | null
          display_name?: string | null
          dsn_url?: string
          error_message?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          organization_id: string
          owner_user_id?: string | null
          profile_url?: string | null
          provider: string
          scopes?: string[] | null
          status?: string | null
          unipile_account_id: string
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          access_token_encrypted?: string
          avatar_url?: string | null
          connections_count?: number | null
          connections_sync_status?: string | null
          connections_synced_at?: string | null
          created_at?: string | null
          display_name?: string | null
          dsn_url?: string
          error_message?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          organization_id?: string
          owner_user_id?: string | null
          profile_url?: string | null
          provider?: string
          scopes?: string[] | null
          status?: string | null
          unipile_account_id?: string
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_campaign_auto_accounts: {
        Row: {
          account_id: string
          campaign_id: string
          created_at: string | null
          id: string
          last_fetched_at: string | null
        }
        Insert: {
          account_id: string
          campaign_id: string
          created_at?: string | null
          id?: string
          last_fetched_at?: string | null
        }
        Update: {
          account_id?: string
          campaign_id?: string
          created_at?: string | null
          id?: string
          last_fetched_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_campaign_auto_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaign_auto_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "unipile_campaign_auto_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_campaign_sender_accounts: {
        Row: {
          account_id: string
          campaign_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unipile_campaign_sender_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaign_sender_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "unipile_campaign_sender_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_campaigns: {
        Row: {
          account_id: string | null
          agent_profile_id: string | null
          ai_chatbot_brand_voice_id: string | null
          ai_chatbot_enabled: boolean | null
          ai_chatbot_handoff_keywords: string[] | null
          ai_chatbot_instructions: string | null
          ai_chatbot_max_turns: number | null
          ai_chatbot_model: string | null
          ai_mode: string | null
          auto_accept_connections: boolean | null
          auto_add_posts: boolean | null
          auto_send_on_connection: boolean | null
          autopilot_config: Json | null
          comment_link_mode: string | null
          comment_reply_templates: string[] | null
          created_at: string | null
          description: string | null
          dm_delay_seconds: number | null
          dm_template: string
          icp_id: string | null
          icp_threshold: number | null
          id: string
          is_active: boolean | null
          lead_magnet_title: string | null
          lead_magnet_url: string | null
          max_dms_per_day: number | null
          max_dms_per_hour: number | null
          name: string
          organization_id: string
          require_connection_for_linkedin: boolean | null
          smart_config: Json | null
          status: string | null
          total_dms_failed: number | null
          total_dms_sent: number | null
          total_leads: number | null
          trigger_keywords: string
          updated_at: string | null
          user_cooldown_hours: number | null
          webhook_url: string | null
        }
        Insert: {
          account_id?: string | null
          agent_profile_id?: string | null
          ai_chatbot_brand_voice_id?: string | null
          ai_chatbot_enabled?: boolean | null
          ai_chatbot_handoff_keywords?: string[] | null
          ai_chatbot_instructions?: string | null
          ai_chatbot_max_turns?: number | null
          ai_chatbot_model?: string | null
          ai_mode?: string | null
          auto_accept_connections?: boolean | null
          auto_add_posts?: boolean | null
          auto_send_on_connection?: boolean | null
          autopilot_config?: Json | null
          comment_link_mode?: string | null
          comment_reply_templates?: string[] | null
          created_at?: string | null
          description?: string | null
          dm_delay_seconds?: number | null
          dm_template: string
          icp_id?: string | null
          icp_threshold?: number | null
          id?: string
          is_active?: boolean | null
          lead_magnet_title?: string | null
          lead_magnet_url?: string | null
          max_dms_per_day?: number | null
          max_dms_per_hour?: number | null
          name: string
          organization_id: string
          require_connection_for_linkedin?: boolean | null
          smart_config?: Json | null
          status?: string | null
          total_dms_failed?: number | null
          total_dms_sent?: number | null
          total_leads?: number | null
          trigger_keywords: string
          updated_at?: string | null
          user_cooldown_hours?: number | null
          webhook_url?: string | null
        }
        Update: {
          account_id?: string | null
          agent_profile_id?: string | null
          ai_chatbot_brand_voice_id?: string | null
          ai_chatbot_enabled?: boolean | null
          ai_chatbot_handoff_keywords?: string[] | null
          ai_chatbot_instructions?: string | null
          ai_chatbot_max_turns?: number | null
          ai_chatbot_model?: string | null
          ai_mode?: string | null
          auto_accept_connections?: boolean | null
          auto_add_posts?: boolean | null
          auto_send_on_connection?: boolean | null
          autopilot_config?: Json | null
          comment_link_mode?: string | null
          comment_reply_templates?: string[] | null
          created_at?: string | null
          description?: string | null
          dm_delay_seconds?: number | null
          dm_template?: string
          icp_id?: string | null
          icp_threshold?: number | null
          id?: string
          is_active?: boolean | null
          lead_magnet_title?: string | null
          lead_magnet_url?: string | null
          max_dms_per_day?: number | null
          max_dms_per_hour?: number | null
          name?: string
          organization_id?: string
          require_connection_for_linkedin?: boolean | null
          smart_config?: Json | null
          status?: string | null
          total_dms_failed?: number | null
          total_dms_sent?: number | null
          total_leads?: number | null
          trigger_keywords?: string
          updated_at?: string | null
          user_cooldown_hours?: number | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaigns_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaigns_ai_chatbot_brand_voice_id_fkey"
            columns: ["ai_chatbot_brand_voice_id"]
            isOneToOne: false
            referencedRelation: "library_brand_voices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaigns_icp_id_fkey"
            columns: ["icp_id"]
            isOneToOne: false
            referencedRelation: "library_icps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_job_logs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_details: Json | null
          error_message: string | null
          id: string
          items_created: number | null
          items_failed: number | null
          items_processed: number | null
          job_type: string
          organization_id: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          job_type: string
          organization_id?: string | null
          started_at?: string | null
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          job_type?: string
          organization_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "unipile_job_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_leads: {
        Row: {
          ai_conversation_active: boolean | null
          ai_conversation_turn_count: number | null
          ai_handoff_reason: string | null
          ai_handoff_requested: boolean | null
          campaign_id: string
          captured_at: string | null
          comment_id: string
          comment_replied_at: string | null
          comment_reply_id: string | null
          comment_reply_text: string | null
          comment_text: string | null
          commenter_avatar_url: string | null
          commenter_headline: string | null
          commenter_id: string
          commenter_name: string | null
          commenter_profile_url: string | null
          commenter_public_identifier: string | null
          connection_checked_at: string | null
          connection_detected_at: string | null
          connection_request_sent_at: string | null
          connection_source: string | null
          created_at: string | null
          crm_contact_id: string | null
          crm_conversation_id: string | null
          dm_chat_id: string | null
          dm_delivered_at: string | null
          dm_error: string | null
          dm_message_id: string | null
          dm_read_at: string | null
          dm_sent_at: string | null
          followup_count: number | null
          icp_score: number | null
          icp_score_reasoning: string | null
          icp_scored_at: string | null
          id: string
          intent_classified_at: string | null
          intent_confidence: number | null
          is_connected: boolean | null
          last_followup_at: string | null
          lead_intent: string | null
          matched_keyword: string | null
          organization_id: string
          post_id: string | null
          replied_at: string | null
          reply_text: string | null
          sender_account_id: string | null
          status: string | null
          updated_at: string | null
          webhook_notified_at: string | null
        }
        Insert: {
          ai_conversation_active?: boolean | null
          ai_conversation_turn_count?: number | null
          ai_handoff_reason?: string | null
          ai_handoff_requested?: boolean | null
          campaign_id: string
          captured_at?: string | null
          comment_id: string
          comment_replied_at?: string | null
          comment_reply_id?: string | null
          comment_reply_text?: string | null
          comment_text?: string | null
          commenter_avatar_url?: string | null
          commenter_headline?: string | null
          commenter_id: string
          commenter_name?: string | null
          commenter_profile_url?: string | null
          commenter_public_identifier?: string | null
          connection_checked_at?: string | null
          connection_detected_at?: string | null
          connection_request_sent_at?: string | null
          connection_source?: string | null
          created_at?: string | null
          crm_contact_id?: string | null
          crm_conversation_id?: string | null
          dm_chat_id?: string | null
          dm_delivered_at?: string | null
          dm_error?: string | null
          dm_message_id?: string | null
          dm_read_at?: string | null
          dm_sent_at?: string | null
          followup_count?: number | null
          icp_score?: number | null
          icp_score_reasoning?: string | null
          icp_scored_at?: string | null
          id?: string
          intent_classified_at?: string | null
          intent_confidence?: number | null
          is_connected?: boolean | null
          last_followup_at?: string | null
          lead_intent?: string | null
          matched_keyword?: string | null
          organization_id: string
          post_id?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sender_account_id?: string | null
          status?: string | null
          updated_at?: string | null
          webhook_notified_at?: string | null
        }
        Update: {
          ai_conversation_active?: boolean | null
          ai_conversation_turn_count?: number | null
          ai_handoff_reason?: string | null
          ai_handoff_requested?: boolean | null
          campaign_id?: string
          captured_at?: string | null
          comment_id?: string
          comment_replied_at?: string | null
          comment_reply_id?: string | null
          comment_reply_text?: string | null
          comment_text?: string | null
          commenter_avatar_url?: string | null
          commenter_headline?: string | null
          commenter_id?: string
          commenter_name?: string | null
          commenter_profile_url?: string | null
          commenter_public_identifier?: string | null
          connection_checked_at?: string | null
          connection_detected_at?: string | null
          connection_request_sent_at?: string | null
          connection_source?: string | null
          created_at?: string | null
          crm_contact_id?: string | null
          crm_conversation_id?: string | null
          dm_chat_id?: string | null
          dm_delivered_at?: string | null
          dm_error?: string | null
          dm_message_id?: string | null
          dm_read_at?: string | null
          dm_sent_at?: string | null
          followup_count?: number | null
          icp_score?: number | null
          icp_score_reasoning?: string | null
          icp_scored_at?: string | null
          id?: string
          intent_classified_at?: string | null
          intent_confidence?: number | null
          is_connected?: boolean | null
          last_followup_at?: string | null
          lead_intent?: string | null
          matched_keyword?: string | null
          organization_id?: string
          post_id?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sender_account_id?: string | null
          status?: string | null
          updated_at?: string | null
          webhook_notified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "unipile_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_leads_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_leads_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_leads_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "unipile_monitored_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_leads_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_message_queue: {
        Row: {
          account_id: string
          attempts: number | null
          campaign_id: string
          chat_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          last_attempt_at: string | null
          lead_id: string
          max_attempts: number | null
          message_id: string | null
          message_text: string
          organization_id: string
          priority: number | null
          recipient_name: string | null
          recipient_platform_id: string
          scheduled_for: string
          sent_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          attempts?: number | null
          campaign_id: string
          chat_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          lead_id: string
          max_attempts?: number | null
          message_id?: string | null
          message_text: string
          organization_id: string
          priority?: number | null
          recipient_name?: string | null
          recipient_platform_id: string
          scheduled_for: string
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          attempts?: number | null
          campaign_id?: string
          chat_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          lead_id?: string
          max_attempts?: number | null
          message_id?: string | null
          message_text?: string
          organization_id?: string
          priority?: number | null
          recipient_name?: string | null
          recipient_platform_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_message_queue_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_message_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "unipile_message_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_message_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "unipile_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_message_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_monitored_posts: {
        Row: {
          campaign_id: string
          comments_processed: number | null
          created_at: string | null
          error_count: number | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_comment_cursor: string | null
          last_polled_at: string | null
          organization_id: string
          post_author_avatar: string | null
          post_author_name: string | null
          post_content: string | null
          post_created_at: string | null
          post_id: string
          post_thumbnail_url: string | null
          post_title: string | null
          post_url: string
          provider: string
          social_id: string | null
          source_account_id: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          comments_processed?: number | null
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_comment_cursor?: string | null
          last_polled_at?: string | null
          organization_id: string
          post_author_avatar?: string | null
          post_author_name?: string | null
          post_content?: string | null
          post_created_at?: string | null
          post_id: string
          post_thumbnail_url?: string | null
          post_title?: string | null
          post_url: string
          provider: string
          social_id?: string | null
          source_account_id?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          comments_processed?: number | null
          created_at?: string | null
          error_count?: number | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_comment_cursor?: string | null
          last_polled_at?: string | null
          organization_id?: string
          post_author_avatar?: string | null
          post_author_name?: string | null
          post_content?: string | null
          post_created_at?: string | null
          post_id?: string
          post_thumbnail_url?: string | null
          post_title?: string | null
          post_url?: string
          provider?: string
          social_id?: string | null
          source_account_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_monitored_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "lead_magnet_campaign_metrics"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "unipile_monitored_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unipile_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_monitored_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_monitored_posts_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_webhook_events: {
        Row: {
          account_id: string | null
          created_at: string | null
          error_message: string | null
          event_data: Json
          event_type: string
          id: string
          organization_id: string | null
          processed_at: string | null
          processing_result: Json | null
          status: string | null
          unipile_account_id: string | null
          unipile_event_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_data: Json
          event_type: string
          id?: string
          organization_id?: string | null
          processed_at?: string | null
          processing_result?: Json | null
          status?: string | null
          unipile_account_id?: string | null
          unipile_event_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_data?: Json
          event_type?: string
          id?: string
          organization_id?: string | null
          processed_at?: string | null
          processing_result?: Json | null
          status?: string | null
          unipile_account_id?: string | null
          unipile_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_webhook_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unipile_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_preferences: {
        Row: {
          created_at: string
          organization_id: string
          reply_alerts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          reply_alerts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          reply_alerts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string | null
          id: string
          preferences: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preferences?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preferences?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          active_organization_id: string | null
          avatar_url: string | null
          can_access_organizations: string[] | null
          created_at: string | null
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          impersonating_organization_id: string | null
          is_active: boolean | null
          is_super_admin: boolean | null
          last_identity_used_at: string | null
          last_login_at: string | null
          last_name: string | null
          last_used_identity_id: string | null
          organization_id: string
          role: string | null
          skool_profile_url: string | null
          updated_at: string | null
        }
        Insert: {
          active_organization_id?: string | null
          avatar_url?: string | null
          can_access_organizations?: string[] | null
          created_at?: string | null
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          impersonating_organization_id?: string | null
          is_active?: boolean | null
          is_super_admin?: boolean | null
          last_identity_used_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_used_identity_id?: string | null
          organization_id: string
          role?: string | null
          skool_profile_url?: string | null
          updated_at?: string | null
        }
        Update: {
          active_organization_id?: string | null
          avatar_url?: string | null
          can_access_organizations?: string[] | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          impersonating_organization_id?: string | null
          is_active?: boolean | null
          is_super_admin?: boolean | null
          last_identity_used_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_used_identity_id?: string | null
          organization_id?: string
          role?: string | null
          skool_profile_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_active_organization_id_fkey"
            columns: ["active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_impersonating_organization_id_fkey"
            columns: ["impersonating_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_last_used_identity_id_fkey"
            columns: ["last_used_identity_id"]
            isOneToOne: false
            referencedRelation: "library_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      video_analytics: {
        Row: {
          comments: number | null
          created_at: string | null
          ctr: number | null
          engagement_rate: number | null
          id: string
          likes: number | null
          platform: string
          shares: number | null
          synced_at: string | null
          video_id: string
          views: number | null
          watch_time_seconds: number | null
        }
        Insert: {
          comments?: number | null
          created_at?: string | null
          ctr?: number | null
          engagement_rate?: number | null
          id?: string
          likes?: number | null
          platform: string
          shares?: number | null
          synced_at?: string | null
          video_id: string
          views?: number | null
          watch_time_seconds?: number | null
        }
        Update: {
          comments?: number | null
          created_at?: string | null
          ctr?: number | null
          engagement_rate?: number | null
          id?: string
          likes?: number | null
          platform?: string
          shares?: number | null
          synced_at?: string | null
          video_id?: string
          views?: number | null
          watch_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_analytics_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_projects: {
        Row: {
          chat_messages: Json | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          error_message: string | null
          fal_ai_job_ids: Json | null
          final_video_duration_seconds: number | null
          final_video_thumbnail_url: string | null
          final_video_url: string | null
          generation_cost: number | null
          generation_time_seconds: number | null
          id: string
          idea_id: string | null
          identity_id: string | null
          music: Json | null
          narrative: Json | null
          organization_id: string
          output_url: string | null
          platforms: string[] | null
          published_at: string | null
          remotion_code: string | null
          render_error: string | null
          render_progress: number | null
          scene_prompts: Json | null
          scenes: Json
          session_id: string | null
          settings: Json
          sound_effects: Json | null
          status: string | null
          template_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          user_id: string
          video_urls: Json | null
          voiceover: Json | null
          voiceover_settings: Json | null
          voiceover_urls: Json | null
        }
        Insert: {
          chat_messages?: Json | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          fal_ai_job_ids?: Json | null
          final_video_duration_seconds?: number | null
          final_video_thumbnail_url?: string | null
          final_video_url?: string | null
          generation_cost?: number | null
          generation_time_seconds?: number | null
          id?: string
          idea_id?: string | null
          identity_id?: string | null
          music?: Json | null
          narrative?: Json | null
          organization_id: string
          output_url?: string | null
          platforms?: string[] | null
          published_at?: string | null
          remotion_code?: string | null
          render_error?: string | null
          render_progress?: number | null
          scene_prompts?: Json | null
          scenes?: Json
          session_id?: string | null
          settings?: Json
          sound_effects?: Json | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          video_urls?: Json | null
          voiceover?: Json | null
          voiceover_settings?: Json | null
          voiceover_urls?: Json | null
        }
        Update: {
          chat_messages?: Json | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          fal_ai_job_ids?: Json | null
          final_video_duration_seconds?: number | null
          final_video_thumbnail_url?: string | null
          final_video_url?: string | null
          generation_cost?: number | null
          generation_time_seconds?: number | null
          id?: string
          idea_id?: string | null
          identity_id?: string | null
          music?: Json | null
          narrative?: Json | null
          organization_id?: string
          output_url?: string | null
          platforms?: string[] | null
          published_at?: string | null
          remotion_code?: string | null
          render_error?: string | null
          render_progress?: number | null
          scene_prompts?: Json | null
          scenes?: Json
          session_id?: string | null
          settings?: Json
          sound_effects?: Json | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          video_urls?: Json | null
          voiceover?: Json | null
          voiceover_settings?: Json | null
          voiceover_urls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "video_projects_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_projects_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "library_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_projects_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "content_creation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      video_scenes: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          effects: Json | null
          id: string
          image_prompt: string | null
          image_url: string | null
          scene_type: string | null
          script_text: string | null
          sequence_order: number
          video_id: string
          video_url: string | null
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          effects?: Json | null
          id?: string
          image_prompt?: string | null
          image_url?: string | null
          scene_type?: string | null
          script_text?: string | null
          sequence_order: number
          video_id: string
          video_url?: string | null
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          effects?: Json | null
          id?: string
          image_prompt?: string | null
          image_url?: string | null
          scene_type?: string | null
          script_text?: string | null
          sequence_order?: number
          video_id?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_scenes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          assigned_characters: string[] | null
          assigned_products: string[] | null
          campaign_id: string | null
          content_idea_id: string | null
          content_source_id: string | null
          cost: number | null
          created_at: string | null
          description: string | null
          duration: number | null
          duration_seconds: number | null
          error_message: string | null
          format: string | null
          generation_cost: number | null
          generation_stage: string | null
          id: string
          last_updated_at: string | null
          metadata: Json | null
          mode: string | null
          organization_id: string
          platform: string[] | null
          progress: number | null
          progress_message: string | null
          providers_used: Json | null
          remix_config: Json | null
          resolution: string | null
          script: string | null
          status: string | null
          template_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          video_url: string | null
          workflow_status: string | null
        }
        Insert: {
          assigned_characters?: string[] | null
          assigned_products?: string[] | null
          campaign_id?: string | null
          content_idea_id?: string | null
          content_source_id?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          format?: string | null
          generation_cost?: number | null
          generation_stage?: string | null
          id?: string
          last_updated_at?: string | null
          metadata?: Json | null
          mode?: string | null
          organization_id: string
          platform?: string[] | null
          progress?: number | null
          progress_message?: string | null
          providers_used?: Json | null
          remix_config?: Json | null
          resolution?: string | null
          script?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
          video_url?: string | null
          workflow_status?: string | null
        }
        Update: {
          assigned_characters?: string[] | null
          assigned_products?: string[] | null
          campaign_id?: string | null
          content_idea_id?: string | null
          content_source_id?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          duration?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          format?: string | null
          generation_cost?: number | null
          generation_stage?: string | null
          id?: string
          last_updated_at?: string | null
          metadata?: Json | null
          mode?: string | null
          organization_id?: string
          platform?: string[] | null
          progress?: number | null
          progress_message?: string | null
          providers_used?: Json | null
          remix_config?: Json | null
          resolution?: string | null
          script?: string | null
          status?: string | null
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          video_url?: string | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_content_idea_id_fkey"
            columns: ["content_idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_content_source_id_fkey"
            columns: ["content_source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_id_reclass: {
        Row: {
          category: string | null
          contact_id: string
          created_at: string | null
          is_target: boolean | null
          list_key: string
        }
        Insert: {
          category?: string | null
          contact_id: string
          created_at?: string | null
          is_target?: boolean | null
          list_key: string
        }
        Update: {
          category?: string | null
          contact_id?: string
          created_at?: string | null
          is_target?: boolean | null
          list_key?: string
        }
        Relationships: []
      }
      web_capture_cache: {
        Row: {
          captured_at: string
          expires_at: string
          id: string
          organization_id: string
          page_metadata: Json
          screenshots: Json
          url: string
          url_hash: string
        }
        Insert: {
          captured_at?: string
          expires_at?: string
          id?: string
          organization_id: string
          page_metadata: Json
          screenshots: Json
          url: string
          url_hash: string
        }
        Update: {
          captured_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          page_metadata?: Json
          screenshots?: Json
          url?: string
          url_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_capture_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_dispatcher_state: {
        Row: {
          id: boolean
          last_kick_at: string
          lease_until: string
        }
        Insert: {
          id?: boolean
          last_kick_at?: string
          lease_until?: string
        }
        Update: {
          id?: boolean
          last_kick_at?: string
          lease_until?: string
        }
        Relationships: []
      }
      webhook_event_log: {
        Row: {
          attempt_count: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          event_data: Json
          event_type: string
          id: string
          max_attempts: number | null
          next_retry_at: string | null
          organization_id: string
          response_body: string | null
          response_status: number | null
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subscription_id: string | null
          webhook_url: string
        }
        Insert: {
          attempt_count?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          event_data: Json
          event_type: string
          id?: string
          max_attempts?: number | null
          next_retry_at?: string | null
          organization_id: string
          response_body?: string | null
          response_status?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
          webhook_url: string
        }
        Update: {
          attempt_count?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          event_data?: Json
          event_type?: string
          id?: string
          max_attempts?: number | null
          next_retry_at?: string | null
          organization_id?: string
          response_body?: string | null
          response_status?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_event_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_event_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "webhook_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_incoming_messages: {
        Row: {
          action: string
          action_data: Json
          contact_id: string | null
          conversation_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          organization_id: string
          processed_at: string | null
          result_data: Json | null
          source_event_id: string | null
          source_webhook_id: string | null
          status: string
        }
        Insert: {
          action: string
          action_data: Json
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          processed_at?: string | null
          result_data?: Json | null
          source_event_id?: string | null
          source_webhook_id?: string | null
          status?: string
        }
        Update: {
          action?: string
          action_data?: Json
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          processed_at?: string | null
          result_data?: Json | null
          source_event_id?: string | null
          source_webhook_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_incoming_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_incoming_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "linkedin_connections_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_incoming_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_incoming_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_incoming_messages_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "webhook_event_log"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_subscriptions: {
        Row: {
          auth_header_name: string | null
          auth_header_value: string | null
          created_at: string
          created_by: string | null
          events: string[]
          filters: Json
          id: string
          is_active: boolean
          max_attempts: number
          organization_id: string
          secret: string
          source: string
          target_url: string
          updated_at: string
        }
        Insert: {
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string
          created_by?: string | null
          events: string[]
          filters?: Json
          id?: string
          is_active?: boolean
          max_attempts?: number
          organization_id: string
          secret?: string
          source?: string
          target_url: string
          updated_at?: string
        }
        Update: {
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string
          created_by?: string | null
          events?: string[]
          filters?: Json
          id?: string
          is_active?: boolean
          max_attempts?: number
          organization_id?: string
          secret?: string
          source?: string
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      website_scrape_cache: {
        Row: {
          cached_at: string
          domain: string
          expires_at: string
          pages: Json
          tech_signals: Json | null
          total_chars: number
        }
        Insert: {
          cached_at?: string
          domain: string
          expires_at?: string
          pages?: Json
          tech_signals?: Json | null
          total_chars?: number
        }
        Update: {
          cached_at?: string
          domain?: string
          expires_at?: string
          pages?: Json
          tech_signals?: Json | null
          total_chars?: number
        }
        Relationships: []
      }
      wordpress_sites: {
        Row: {
          api_url: string
          app_password_encrypted: string
          created_at: string | null
          default_author_id: number | null
          default_status: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          is_valid: boolean | null
          last_tested_at: string | null
          name: string
          organization_id: string
          site_url: string
          updated_at: string | null
          username: string
        }
        Insert: {
          api_url: string
          app_password_encrypted: string
          created_at?: string | null
          default_author_id?: number | null
          default_status?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          name: string
          organization_id: string
          site_url: string
          updated_at?: string | null
          username: string
        }
        Update: {
          api_url?: string
          app_password_encrypted?: string
          created_at?: string | null
          default_author_id?: number | null
          default_status?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          is_valid?: boolean | null
          last_tested_at?: string | null
          name?: string
          organization_id?: string
          site_url?: string
          updated_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "wordpress_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_heartbeats: {
        Row: {
          last_run_at: string
          metrics: Json
          updated_at: string
          worker: string
        }
        Insert: {
          last_run_at?: string
          metrics?: Json
          updated_at?: string
          worker: string
        }
        Update: {
          last_run_at?: string
          metrics?: Json
          updated_at?: string
          worker?: string
        }
        Relationships: []
      }
      youtube_scripts: {
        Row: {
          blueprint_id: string | null
          bulk_job_id: string | null
          content_idea_id: string | null
          created_at: string | null
          created_by: string | null
          cta_variations: Json[] | null
          estimated_duration: number | null
          exports: Json | null
          format_variant: string | null
          generation_config: Json | null
          generation_flow: string | null
          hook_variations: Json[] | null
          id: string
          is_template: boolean | null
          library_elements: Json | null
          organization_id: string
          parent_version_id: string | null
          predicted_retention_curve: Json | null
          research_insights: Json | null
          research_sources: string[] | null
          scenes: Json[] | null
          script_type: string
          selected_cta_index: number | null
          selected_hook_index: number | null
          status: string | null
          target_duration: number | null
          template_description: string | null
          template_name: string | null
          title: string
          updated_at: string | null
          version: number | null
          video_id: string | null
          youtube_metadata: Json | null
        }
        Insert: {
          blueprint_id?: string | null
          bulk_job_id?: string | null
          content_idea_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cta_variations?: Json[] | null
          estimated_duration?: number | null
          exports?: Json | null
          format_variant?: string | null
          generation_config?: Json | null
          generation_flow?: string | null
          hook_variations?: Json[] | null
          id?: string
          is_template?: boolean | null
          library_elements?: Json | null
          organization_id: string
          parent_version_id?: string | null
          predicted_retention_curve?: Json | null
          research_insights?: Json | null
          research_sources?: string[] | null
          scenes?: Json[] | null
          script_type: string
          selected_cta_index?: number | null
          selected_hook_index?: number | null
          status?: string | null
          target_duration?: number | null
          template_description?: string | null
          template_name?: string | null
          title: string
          updated_at?: string | null
          version?: number | null
          video_id?: string | null
          youtube_metadata?: Json | null
        }
        Update: {
          blueprint_id?: string | null
          bulk_job_id?: string | null
          content_idea_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cta_variations?: Json[] | null
          estimated_duration?: number | null
          exports?: Json | null
          format_variant?: string | null
          generation_config?: Json | null
          generation_flow?: string | null
          hook_variations?: Json[] | null
          id?: string
          is_template?: boolean | null
          library_elements?: Json | null
          organization_id?: string
          parent_version_id?: string | null
          predicted_retention_curve?: Json | null
          research_insights?: Json | null
          research_sources?: string[] | null
          scenes?: Json[] | null
          script_type?: string
          selected_cta_index?: number | null
          selected_hook_index?: number | null
          status?: string | null
          target_duration?: number | null
          template_description?: string | null
          template_name?: string | null
          title?: string
          updated_at?: string | null
          version?: number | null
          video_id?: string | null
          youtube_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_scripts_bulk_job_id_fkey"
            columns: ["bulk_job_id"]
            isOneToOne: false
            referencedRelation: "bulk_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_scripts_content_idea_id_fkey"
            columns: ["content_idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_scripts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_scripts_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "youtube_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ab_test_results: {
        Row: {
          conversion_rate: number | null
          conversions: number | null
          revenue_cents: number | null
          revenue_per_visitor_cents: number | null
          status: string | null
          test_id: string | null
          test_name: string | null
          variant_key: string | null
          views: number | null
        }
        Relationships: []
      }
      autopilot_pool_stats: {
        Row: {
          autopilot_id: string | null
          autopilot_name: string | null
          available_ideas: number | null
          completion_percentage: number | null
          failed_ideas: number | null
          in_progress_ideas: number | null
          organization_id: string | null
          produced_ideas: number | null
          skipped_ideas: number | null
          total_ideas: number | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_sending_domains: {
        Row: {
          consecutive_550: number | null
          domain: string | null
          health_status: string | null
          id: string | null
          last_550_at: string | null
          last_550_reason: string | null
          organization_id: string | null
          reputation_block_reason: string | null
          reputation_blocked_at: string | null
          rest_until: string | null
          sending_paused_at: string | null
          sending_paused_by: string | null
          sending_pause_reason: string | null
        }
        Insert: {
          consecutive_550?: number | null
          domain?: string | null
          health_status?: string | null
          id?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          organization_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
        }
        Update: {
          consecutive_550?: number | null
          domain?: string | null
          health_status?: string | null
          id?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          organization_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sending_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_analytics_summary: {
        Row: {
          acceptance_rate: number | null
          account_id: string | null
          campaign_id: string | null
          first_activity_date: string | null
          inmail_reply_rate: number | null
          last_activity_date: string | null
          organization_id: string | null
          reply_rate: number | null
          total_connections_accepted: number | null
          total_connections_sent: number | null
          total_follows: number | null
          total_inmails_replied: number | null
          total_inmails_sent: number | null
          total_messages_replied: number | null
          total_messages_sent: number | null
          total_post_likes: number | null
          total_profile_views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "unipile_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_analytics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "linkedin_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_analytics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diag_lock_contention_summary: {
        Row: {
          blocked_query: string | null
          blocking_query: string | null
          distinct_blocked_pids: number | null
          minute: string | null
          samples: number | null
          worst_blocked_ms: number | null
          worst_blocking_xact_ms: number | null
        }
        Relationships: []
      }
      epv_by_source: {
        Row: {
          conversions: number | null
          funnel_id: string | null
          total_revenue_cents: number | null
          utm_campaign: string | null
          utm_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "conversions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_revenue: {
        Row: {
          avg_order_value_cents: number | null
          funnel_id: string | null
          funnel_name: string | null
          niche: string | null
          total_orders: number | null
          total_revenue_cents: number | null
          unique_buyers: number | null
        }
        Relationships: []
      }
      funnel_step_rates: {
        Row: {
          conversion_rate: number | null
          conversions: number | null
          funnel_id: string | null
          page_type: string | null
          step_order: number | null
          views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_pages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnel_revenue"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_pages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_magnet_campaign_metrics: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          emails_captured: number | null
          organization_id: string | null
          page_views: number | null
          resource_clicks: number | null
          unique_captured_leads: number | null
        }
        Relationships: [
          {
            foreignKeyName: "unipile_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_connections_view: {
        Row: {
          account_id: string | null
          company: string | null
          connected_at: string | null
          first_name: string | null
          full_name: string | null
          headline: string | null
          id: string | null
          job_title: string | null
          last_name: string | null
          linked_account_ids: string[] | null
          linkedin_id: string | null
          linkedin_url: string | null
          location: string | null
          organization_id: string | null
          profile_picture_url: string | null
          raw_data: Json | null
          synced_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_signal_eligible_people: {
        Row: {
          company_domain: string | null
          company_key: string | null
          company_people_count: number | null
          email: string | null
          email_status: string | null
          enriched_at: string | null
          full_name: string | null
          linkedin_url: string | null
          person_domain: string | null
          person_id: string | null
          person_rank: number | null
          photo_url: string | null
          seniority_rank: number | null
          title: string | null
        }
        Relationships: []
      }
      public_signal_visible_people: {
        Row: {
          company_domain: string | null
          company_key: string | null
          company_people_count: number | null
          email: string | null
          email_status: string | null
          enriched_at: string | null
          full_name: string | null
          linkedin_url: string | null
          person_domain: string | null
          person_id: string | null
          person_rank: number | null
          photo_url: string | null
          seniority_rank: number | null
          title: string | null
        }
        Relationships: []
      }
      sendable_sending_domains: {
        Row: {
          acs_comm_service_name: string | null
          acs_comm_service_resource_id: string | null
          acs_domain_resource_id: string | null
          acs_domain_verification_status: string | null
          acs_email_service_name: string | null
          acs_email_service_resource_id: string | null
          acs_entra_app_id: string | null
          acs_entra_app_object_id: string | null
          acs_entra_app_secret_encrypted: string | null
          acs_entra_sp_id: string | null
          acs_resource_group: string | null
          acs_smtp_username: string | null
          bounce_rate: number | null
          burned_at: string | null
          byo_helo_hostname: string | null
          byo_ip_pool: Json | null
          byo_postmaster_email: string | null
          byo_server_id: string | null
          byo_smtp_password_hash: string | null
          catchall_email: string | null
          catchall_enabled: boolean | null
          clean_probe_streak: number | null
          cloudflare_zone_id: string | null
          consecutive_550: number | null
          created_at: string | null
          daily_email_limit: number | null
          daily_emails_sent: number | null
          dkim_private_key_encrypted: string | null
          dkim_selector: string | null
          dkim_verified: boolean | null
          dmarc_email: string | null
          dmarc_verified: boolean | null
          dns_managed: boolean | null
          dns_provider_id: string | null
          dns_records: Json | null
          dns_status: string | null
          domain: string | null
          domain_health: string | null
          forwarding_email: string | null
          forwarding_url: string | null
          health_score: number | null
          health_status: string | null
          id: string | null
          inbound_webhook_subscription_id: string | null
          infra_type: string | null
          ip_assigned_at: string | null
          last_550_at: string | null
          last_550_reason: string | null
          last_dns_check_at: string | null
          last_health_check_at: string | null
          last_probe_at: string | null
          last_probe_result: string | null
          m365_domain_id: string | null
          m365_domain_verified: boolean | null
          m365_tenant_id: string | null
          mailbox_count: number | null
          max_mailboxes: number | null
          metadata: Json | null
          nameservers_active: string[] | null
          nameservers_assigned: string[] | null
          next_probe_at: string | null
          organization_id: string | null
          public_ip: string | null
          public_ip_resource_id: string | null
          registrar_credentials_id: string | null
          replaced_by_id: string | null
          replaces_id: string | null
          reputation_block_reason: string | null
          reputation_blocked_at: string | null
          rest_until: string | null
          sender_addresses: Json | null
          spam_rate: number | null
          spf_verified: boolean | null
          subscription_id: string | null
          sync_avatars_to_m365: boolean | null
          updated_at: string | null
          vm_admin_password_encrypted: string | null
          vm_name: string | null
          vm_status: string | null
          sending_paused_at: string | null
          sending_paused_by: string | null
          sending_pause_reason: string | null
        }
        Insert: {
          acs_comm_service_name?: string | null
          acs_comm_service_resource_id?: string | null
          acs_domain_resource_id?: string | null
          acs_domain_verification_status?: string | null
          acs_email_service_name?: string | null
          acs_email_service_resource_id?: string | null
          acs_entra_app_id?: string | null
          acs_entra_app_object_id?: string | null
          acs_entra_app_secret_encrypted?: string | null
          acs_entra_sp_id?: string | null
          acs_resource_group?: string | null
          acs_smtp_username?: string | null
          bounce_rate?: number | null
          burned_at?: string | null
          byo_helo_hostname?: string | null
          byo_ip_pool?: Json | null
          byo_postmaster_email?: string | null
          byo_server_id?: string | null
          byo_smtp_password_hash?: string | null
          catchall_email?: string | null
          catchall_enabled?: boolean | null
          clean_probe_streak?: number | null
          cloudflare_zone_id?: string | null
          consecutive_550?: number | null
          created_at?: string | null
          daily_email_limit?: number | null
          daily_emails_sent?: number | null
          dkim_private_key_encrypted?: string | null
          dkim_selector?: string | null
          dkim_verified?: boolean | null
          dmarc_email?: string | null
          dmarc_verified?: boolean | null
          dns_managed?: boolean | null
          dns_provider_id?: string | null
          dns_records?: Json | null
          dns_status?: string | null
          domain?: string | null
          domain_health?: string | null
          forwarding_email?: string | null
          forwarding_url?: string | null
          health_score?: number | null
          health_status?: string | null
          id?: string | null
          inbound_webhook_subscription_id?: string | null
          infra_type?: string | null
          ip_assigned_at?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          last_dns_check_at?: string | null
          last_health_check_at?: string | null
          last_probe_at?: string | null
          last_probe_result?: string | null
          m365_domain_id?: string | null
          m365_domain_verified?: boolean | null
          m365_tenant_id?: string | null
          mailbox_count?: number | null
          max_mailboxes?: number | null
          metadata?: Json | null
          nameservers_active?: string[] | null
          nameservers_assigned?: string[] | null
          next_probe_at?: string | null
          organization_id?: string | null
          public_ip?: string | null
          public_ip_resource_id?: string | null
          registrar_credentials_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sender_addresses?: Json | null
          spam_rate?: number | null
          spf_verified?: boolean | null
          subscription_id?: string | null
          sync_avatars_to_m365?: boolean | null
          updated_at?: string | null
          vm_admin_password_encrypted?: string | null
          vm_name?: string | null
          vm_status?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
        }
        Update: {
          acs_comm_service_name?: string | null
          acs_comm_service_resource_id?: string | null
          acs_domain_resource_id?: string | null
          acs_domain_verification_status?: string | null
          acs_email_service_name?: string | null
          acs_email_service_resource_id?: string | null
          acs_entra_app_id?: string | null
          acs_entra_app_object_id?: string | null
          acs_entra_app_secret_encrypted?: string | null
          acs_entra_sp_id?: string | null
          acs_resource_group?: string | null
          acs_smtp_username?: string | null
          bounce_rate?: number | null
          burned_at?: string | null
          byo_helo_hostname?: string | null
          byo_ip_pool?: Json | null
          byo_postmaster_email?: string | null
          byo_server_id?: string | null
          byo_smtp_password_hash?: string | null
          catchall_email?: string | null
          catchall_enabled?: boolean | null
          clean_probe_streak?: number | null
          cloudflare_zone_id?: string | null
          consecutive_550?: number | null
          created_at?: string | null
          daily_email_limit?: number | null
          daily_emails_sent?: number | null
          dkim_private_key_encrypted?: string | null
          dkim_selector?: string | null
          dkim_verified?: boolean | null
          dmarc_email?: string | null
          dmarc_verified?: boolean | null
          dns_managed?: boolean | null
          dns_provider_id?: string | null
          dns_records?: Json | null
          dns_status?: string | null
          domain?: string | null
          domain_health?: string | null
          forwarding_email?: string | null
          forwarding_url?: string | null
          health_score?: number | null
          health_status?: string | null
          id?: string | null
          inbound_webhook_subscription_id?: string | null
          infra_type?: string | null
          ip_assigned_at?: string | null
          last_550_at?: string | null
          last_550_reason?: string | null
          last_dns_check_at?: string | null
          last_health_check_at?: string | null
          last_probe_at?: string | null
          last_probe_result?: string | null
          m365_domain_id?: string | null
          m365_domain_verified?: boolean | null
          m365_tenant_id?: string | null
          mailbox_count?: number | null
          max_mailboxes?: number | null
          metadata?: Json | null
          nameservers_active?: string[] | null
          nameservers_assigned?: string[] | null
          next_probe_at?: string | null
          organization_id?: string | null
          public_ip?: string | null
          public_ip_resource_id?: string | null
          registrar_credentials_id?: string | null
          replaced_by_id?: string | null
          replaces_id?: string | null
          reputation_block_reason?: string | null
          reputation_blocked_at?: string | null
          rest_until?: string | null
          sender_addresses?: Json | null
          spam_rate?: number | null
          spf_verified?: boolean | null
          subscription_id?: string | null
          sync_avatars_to_m365?: boolean | null
          updated_at?: string | null
          vm_admin_password_encrypted?: string | null
          vm_name?: string | null
          vm_status?: string | null
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_pause_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sending_domains_byo_server_id_fkey"
            columns: ["byo_server_id"]
            isOneToOne: false
            referencedRelation: "byo_servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_dns_provider_id_fkey"
            columns: ["dns_provider_id"]
            isOneToOne: false
            referencedRelation: "dns_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            isOneToOne: false
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_registrar_credentials_id_fkey"
            columns: ["registrar_credentials_id"]
            isOneToOne: false
            referencedRelation: "registrar_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "blocked_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "email_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: false
            referencedRelation: "sendable_sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sending_domains_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "azure_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organizations: {
        Row: {
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_domain_delivery_monitoring: {
        Args: { p_domain_id: string; p_days?: number }
        Returns: Json
      }
      set_sending_domain_paused: {
        Args: { p_domain_id: string; p_paused: boolean; p_reason?: string }
        Returns: Json
      }
      get_blueprint_latest_samples: {
        Args: { p_organization_id: string }
        Returns: {
          blueprint_id: string
          created_at: string
          image_url: string
          output_id: string
          pipeline: string
          text_snippet: string
          title: string
        }[]
      }
      get_autopilot_fuel: {
        Args: { p_organization_id: string }
        Returns: {
          autopilot_id: string
          awaiting_review: number
          draws_from_all: boolean
          entries: Json
          feed_tags: string[]
          fresh_ideas: number
          last_output_at: string | null
          matching_ideas: number
          name: string
          paused_reason: string | null
          posts_per_day: number | null
          recycles: boolean
          runway_days: number | null
          starved_runs_7d: number
          starving_since: string | null
          status: string
        }[]
      }
      get_idea_usage: {
        Args: { p_organization_id: string }
        Returns: {
          autopilot_ids: string[]
          idea_id: string
          last_used_at: string
          used_count: number
        }[]
      }
      get_blueprint_run_stats: {
        Args: { p_organization_id: string }
        Returns: {
          blueprint_id: string
          failed: number
          failed_in_last_two: number
          in_progress: number
          last_error: string
          last_run_at: string
          last_status: string
          last_success_at: string
          runs: number
          succeeded: number
        }[]
      }
      _public_signal_company_id: { Args: { p_key: string }; Returns: string }
      _public_signal_mask_name: { Args: { p_name: string }; Returns: string }
      _public_signal_person_card_is_eligible: {
        Args: { card: Json }
        Returns: boolean
      }
      _public_signal_type_label: { Args: { p_type: string }; Returns: string }
      _public_signals_caller_is_admin: { Args: never; Returns: boolean }
      abandon_zombie_list_building_jobs: { Args: never; Returns: undefined }
      aca_split_linkedin_display_name: {
        Args: { raw: string }
        Returns: {
          first_name: string
          last_name: string
        }[]
      }
      acquire_analysis_slot: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_organization_id: string
          p_slot_key?: string
        }
        Returns: string
      }
      acquire_openrouter_slot: {
        Args: { p_max_requests?: number; p_organization_id: string }
        Returns: {
          acquired: boolean
          current_count: number
          max_allowed: number
          retry_after_ms: number
        }[]
      }
      acquire_webhook_dispatcher_lease: {
        Args: { p_lease?: string }
        Returns: boolean
      }
      add_existing_signal_leads_to_list: {
        Args: { p_contact_ids: string[]; p_list_id: string }
        Returns: Json
      }
      add_leads_to_campaign: {
        Args: { p_campaign_id: string; p_contact_ids: string[] }
        Returns: number
      }
      add_public_signal_lead_to_list: {
        Args: { p_list_id: string; p_person_id: string; p_signal_id: string }
        Returns: Json
      }
      add_public_signal_to_list: {
        Args: { p_list_id: string; p_signal_id: string }
        Returns: Json
      }
      admin_list_public_signals: {
        Args: {
          p_include_unpublished?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      admin_set_public_signal_published: {
        Args: { p_id: string; p_published: boolean }
        Returns: Json
      }
      all_scenes_approved: { Args: { vid: string }; Returns: boolean }
      apply_domain_probe_outcome: {
        Args: {
          p_clean_probes_to_healthy?: number
          p_domain_id: string
          p_outcome: string
          p_reason?: string
          p_rest_days?: number
          p_source?: string
        }
        Returns: string
      }
      apply_mailbox_metadata_patch: {
        Args: { p_id: string; p_set?: Json; p_unset?: string[] }
        Returns: undefined
      }
      apply_verification_cache_to_list: {
        Args: { p_list_id: string; p_org_id: string }
        Returns: number
      }
      approve_signal_review_item: {
        Args: { p_review_id: string }
        Returns: {
          activity_rows_flipped: number
          discovered_company_id: string
          dm_work_item_id: number
          organization_id: string
          review_id: string
          subscription_id: string
        }[]
      }
      approve_signup_request: {
        Args: {
          p_admin_notes?: string
          p_plan_tier: string
          p_request_id: string
        }
        Returns: Json
      }
      auth_user_is_org_admin: { Args: { org_id: string }; Returns: boolean }
      auth_user_organization_ids: { Args: never; Returns: string[] }
      auto_progress_account_stage: {
        Args: never
        Returns: {
          promoted_to_active: number
        }[]
      }
      bucket_employee_range: { Args: { p_count: number }; Returns: string }
      bulk_remove_filtered_list_members: {
        Args: { p_filters?: Json; p_list_id: string }
        Returns: number
      }
      bulk_remove_list_members: {
        Args: { p_contact_ids: string[]; p_list_id: string }
        Returns: number
      }
      bulk_set_contact_custom_field: {
        Args: {
          p_contact_ids: string[]
          p_field_key: string
          p_field_value: string
          p_organization_id: string
        }
        Returns: number
      }
      bulk_update_mailbox_owner: {
        Args: { p_ids: string[]; p_user_id: string }
        Returns: number
      }
      bulk_update_mailbox_tags: {
        Args: { p_ids: string[]; p_mode: string; p_tags: string[] }
        Returns: number
      }
      bulk_update_mailboxes: {
        Args: {
          p_column_updates?: Json
          p_ids: string[]
          p_metadata_merge?: Json
        }
        Returns: number
      }
      bulk_upsert_csv_contacts: {
        Args: { p_organization_id: string; p_rows: Json }
        Returns: {
          id: string
          is_new: boolean
        }[]
      }
      bump_email_verification_progress: {
        Args: {
          p_delta_apify?: number
          p_delta_cache_hits?: number
          p_delta_drops?: number
          p_delta_passes?: number
          p_delta_processed?: number
          p_list_id: string
          p_organization_id: string
          p_phase?: string
          p_total: number
        }
        Returns: undefined
      }
      calculate_next_run: {
        Args: { cron_expr?: string; frequency: string; from_time?: string }
        Returns: string
      }
      calculate_scene_duration: {
        Args: { word_count: number }
        Returns: number
      }
      can_manage_client_org: {
        Args: { required_roles?: string[]; target_org_id: string }
        Returns: boolean
      }
      can_user_access_organization: {
        Args: { org_id: string; user_id: string }
        Returns: boolean
      }
      cancel_lb_job_work_items: { Args: { p_job_id: string }; Returns: number }
      cancel_lead_list_processing_contacts: {
        Args: { p_contact_ids: string[]; p_list_id: string }
        Returns: number
      }
      cancel_lead_list_processing_run: {
        Args: { p_list_id: string }
        Returns: number
      }
      check_api_rate_limit: {
        Args: { p_key: string; p_limit?: number; p_window_seconds?: number }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
          used: number
        }[]
      }
      check_channel_limit: {
        Args: {
          p_channel: Database["public"]["Enums"]["crm_channel_type"]
          p_channel_account_id?: string
          p_organization_id: string
        }
        Returns: {
          allowed: boolean
          daily_limit: number
          daily_used: number
          hourly_limit: number
          hourly_used: number
          reason: string
          remaining: number
        }[]
      }
      check_org_membership: {
        Args: { org_id: string; required_roles?: string[] }
        Returns: boolean
      }
      check_organization_quota: {
        Args: { p_count?: number; p_org_id: string }
        Returns: Json
      }
      check_provisioning_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      check_unipile_rate_limit: {
        Args: {
          p_account_id: string
          p_max_per_day: number
          p_max_per_hour: number
        }
        Returns: boolean
      }
      claim_apify_leads_import_job: {
        Args: { p_job_id: string; p_lock_seconds?: number }
        Returns: string
      }
      claim_contacts_for_moltsets: {
        Args: { p_batch_size: number; p_lead_list_id: string }
        Returns: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          avatar_url: string | null
          city: string | null
          company: string | null
          company_employee_count: number | null
          company_employee_range: string | null
          company_id: string | null
          company_industry: string | null
          company_name: string | null
          company_revenue_range: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_last_validated_at: string | null
          email_type: string | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          firmographics_checked_at: string | null
          firmographics_source: string | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          home_page_text: string | null
          home_page_text_fetched_at: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_bio: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          moltsets_attempted_at: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          quickenrich_attempted_at: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          signal_confidence: number | null
          signal_date: string | null
          signal_detail: string | null
          signal_event_id: string | null
          signal_source_url: string | null
          signal_subscription_id: string | null
          signal_type: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_contacts_for_quickenrich: {
        Args: { p_batch_size: number; p_lead_list_id: string }
        Returns: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          avatar_url: string | null
          city: string | null
          company: string | null
          company_employee_count: number | null
          company_employee_range: string | null
          company_id: string | null
          company_industry: string | null
          company_name: string | null
          company_revenue_range: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_last_validated_at: string | null
          email_type: string | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          firmographics_checked_at: string | null
          firmographics_source: string | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          home_page_text: string | null
          home_page_text_fetched_at: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_bio: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          moltsets_attempted_at: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          quickenrich_attempted_at: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          signal_confidence: number | null
          signal_date: string | null
          signal_detail: string | null
          signal_event_id: string | null
          signal_source_url: string | null
          signal_subscription_id: string | null
          signal_type: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_crm_contacts_for_firmographics: {
        Args: {
          p_batch_size?: number
          p_org_id?: string
          p_recheck_days?: number
        }
        Returns: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          avatar_url: string | null
          city: string | null
          company: string | null
          company_employee_count: number | null
          company_employee_range: string | null
          company_id: string | null
          company_industry: string | null
          company_name: string | null
          company_revenue_range: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_last_validated_at: string | null
          email_type: string | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          firmographics_checked_at: string | null
          firmographics_source: string | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          home_page_text: string | null
          home_page_text_fetched_at: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_bio: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          moltsets_attempted_at: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          quickenrich_attempted_at: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          signal_confidence: number | null
          signal_date: string | null
          signal_detail: string | null
          signal_event_id: string | null
          signal_source_url: string | null
          signal_subscription_id: string | null
          signal_type: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_csv_import_job: {
        Args: { p_job_id: string }
        Returns: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          csv_data: Json | null
          current_row: number | null
          error_message: string | null
          failed_count: number | null
          field_mappings: Json
          file_path: string | null
          filename: string
          id: string
          imported_count: number | null
          organization_id: string
          processing_lock_at: string | null
          progress: number | null
          skip_reasons: Json | null
          skipped_count: number | null
          started_at: string | null
          status: string
          target_list_id: string
          total_rows: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "csv_import_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_lb_work_items: {
        Args: { p_batch_size: number; p_stage: string; p_worker_id: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          depends_on: number | null
          error: string | null
          id: number
          job_id: string
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lb_work_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_lead_list_processing_items: {
        Args: { p_limit?: number; p_list_id?: string }
        Returns: {
          analysis_reused: boolean
          attempts: number
          cancel_requested_at: string | null
          canceled_at: string | null
          claimed_at: string | null
          completed_at: string | null
          contact_email_search_attempted: boolean
          contact_email_verification_status: string | null
          contact_has_email: boolean
          contact_id: string
          created_at: string
          failure_category: string | null
          force_reprocess: boolean
          id: string
          last_error: string | null
          lead_list_id: string
          manual_run: boolean
          next_attempt_at: string
          organization_id: string
          pause_requested_at: string | null
          policy_id: string
          recovery_attempts: number
          rejected_reason: string | null
          replacement_attempts: number
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_list_processing_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_lead_list_source: {
        Args: { p_lock_seconds?: number; p_source_id: string }
        Returns: string
      }
      claim_pack_refresh_job: {
        Args: { p_job_id: string; p_lock_seconds?: number }
        Returns: string
      }
      claim_pending_dm_work_items: {
        Args: { p_batch_size?: number; p_claimed_by?: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          depends_on: number | null
          error: string | null
          id: number
          job_id: string
          max_attempts: number
          organization_id: string
          payload: Json
          priority: number
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lb_work_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pool_add_to_list_job: {
        Args: { p_job_id?: string; p_lease_seconds?: number }
        Returns: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_offset: number | null
          cursor_id: string | null
          cursor_row_count: number | null
          error_message: string | null
          errors: number | null
          id: string
          lease_until: string | null
          organization_id: string
          processed: number | null
          query_body: Json
          started_at: string | null
          status: string
          target_list_id: string
          total: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "pool_add_to_list_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pool_classify_batch: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          domain: string
          lease_until: string | null
          priority: number
          source: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_pool_classify_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pool_enrich_batch: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          domain: string
          last_error: string | null
          lease_until: string | null
          linkedin_url: string
          priority: number
          requested_by: string | null
          source: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_pool_enrich_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pool_export_job: {
        Args: { p_job_id?: string; p_lease_seconds?: number }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedup_by_email: boolean
          error_message: string | null
          estimated_rows: number | null
          expires_at: string | null
          id: string
          lease_until: string | null
          next_slice: number
          organization_id: string
          parts: Json
          query_body: Json
          r2_prefix: string | null
          rows_written: number
          slice_rows: number | null
          slices_total: number | null
          started_at: string | null
          status: string
          total_rows: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "pool_export_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_profile_email_items: {
        Args: { p_batch_size?: number }
        Returns: {
          id: number
          job_id: string
          organization_id: string
          payload: Json
        }[]
      }
      claim_public_signal_companies_for_quickenrich: {
        Args: { p_batch_size?: number; p_lookback_days?: number }
        Returns: {
          company_key: string
          company_linkedin_url: string
          company_name: string
          domain: string
        }[]
      }
      claim_public_signal_companies_for_quickenrich_by_company: {
        Args: { p_batch_size?: number; p_lookback_days?: number }
        Returns: {
          company_key: string
          company_linkedin_url: string
          company_name: string
          domain: string
        }[]
      }
      claim_signal_identities: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_max_attempts?: number
          p_worker?: string
        }
        Returns: {
          aliases: string[]
          cik: string | null
          country: string | null
          created_at: string
          domain: string | null
          employee_count: number | null
          founded_year: number | null
          id: string
          industry: string | null
          last_resolution_error: string | null
          linkedin_url: string | null
          name: string
          name_normalized: string
          resolution_attempts: number
          resolution_claimed_by: string | null
          resolution_lease_until: string | null
          resolved_at: string | null
          resolved_via: string | null
          updated_at: string
          website_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "company_identities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_signal_observations: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_max_attempts?: number
          p_status: string
          p_worker?: string
        }
        Returns: {
          attempts: number
          body_text: string | null
          claimed_by: string | null
          collector_key: string
          company_identity_id: string | null
          created_at: string
          entity_hints: Json
          error: string | null
          event_type: string | null
          external_id: string
          extracted: Json | null
          id: string
          lease_until: string | null
          observed_at: string
          published_at: string | null
          signal_event_id: string | null
          source_id: string
          source_url: string | null
          status: string
          structured: Json | null
          title: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "signal_observations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_expired_oauth_states: { Args: never; Returns: undefined }
      cleanup_expired_rate_limits: { Args: never; Returns: undefined }
      cleanup_expired_web_captures: { Args: never; Returns: undefined }
      cleanup_old_jobs: { Args: { p_days_old?: number }; Returns: undefined }
      cleanup_old_unipile_job_logs: { Args: never; Returns: undefined }
      complete_generation_job: {
        Args: {
          p_duration_ms?: number
          p_errors?: Json
          p_job_id: string
          p_results?: Json
          p_status: string
          p_total_cost?: number
          p_total_tokens?: number
        }
        Returns: boolean
      }
      complete_job: {
        Args: { p_job_id: string; p_result?: Json }
        Returns: undefined
      }
      complete_lb_work_item: {
        Args: { p_err: string; p_item_id: number; p_ok: boolean }
        Returns: undefined
      }
      compute_conversation_priority: {
        Args: { conv: Database["public"]["Tables"]["crm_conversations"]["Row"] }
        Returns: number
      }
      compute_lead_list_channel_stats: {
        Args: { p_list_id: string }
        Returns: undefined
      }
      compute_smart_list_count: { Args: { p_list_id: string }; Returns: number }
      contact_excluded_by_campaign_history: {
        Args: {
          p_campaign_id: string
          p_contact_id: string
          p_exclude_other_campaigns: boolean
          p_exclude_same_sender: boolean
          p_organization_id: string
          p_sender_account_ids: string[]
        }
        Returns: boolean
      }
      count_filtered_lead_list_members: {
        Args: { p_filters?: Json; p_list_id: string }
        Returns: number
      }
      create_default_pipeline_for_org: {
        Args: { p_org_id: string }
        Returns: string
      }
      create_script_version_snapshot: {
        Args: { script_uuid: string }
        Returns: string
      }
      crm_company_size_matches: {
        Args: {
          p_count: number
          p_legacy_size: string
          p_range: string
          p_sizes: string[]
        }
        Returns: boolean
      }
      crm_contact_ids_by_custom_field: {
        Args: {
          p_field_key: string
          p_operator: string
          p_organization_id: string
          p_value?: string
        }
        Returns: {
          id: string
        }[]
      }
      crm_contact_ids_by_custom_question: {
        Args: {
          p_min_score?: number
          p_organization_id: string
          p_question: string
        }
        Returns: {
          id: string
        }[]
      }
      crm_email_quality_matches: {
        Args: {
          c: Database["public"]["Tables"]["crm_contacts"]["Row"]
          p_qualities: string[]
        }
        Returns: boolean
      }
      delete_email_mailboxes: { Args: { p_ids: string[] }; Returns: number }
      determine_contact_type: {
        Args: { p_is_linkedin_connection: boolean; p_source: string }
        Returns: string
      }
      dpc_record_hard_bounce: {
        Args: { p_domain: string; p_org_id: string }
        Returns: undefined
      }
      dpc_reset_30d_bounce_window: { Args: never; Returns: undefined }
      enqueue_lead_list_processing_all: {
        Args: { p_list_id: string }
        Returns: number
      }
      enqueue_lead_list_processing_contacts: {
        Args: { p_contact_ids: string[]; p_list_id: string }
        Returns: number
      }
      enqueue_pool_classification: {
        Args: { p_domains: string[]; p_priority?: number; p_source?: string }
        Returns: number
      }
      enqueue_pool_enrichment: {
        Args: {
          p_priority?: number
          p_requested_by?: string
          p_rows: Json
          p_source?: string
        }
        Returns: number
      }
      enrich_pool_contacts_from_rows: {
        Args: { p_org_id: string; p_rows: Json }
        Returns: {
          matched: number
          updated: number
        }[]
      }
      enroll_in_sequence: {
        Args: {
          p_contact_id: string
          p_conversation_id?: string
          p_enrolled_by?: string
          p_org_id: string
          p_sequence_id: string
        }
        Returns: string
      }
      enroll_smart_list_into_active_campaigns: {
        Args: { p_max_per_campaign?: number }
        Returns: {
          campaign_id: string
          enrolled: number
          is_smart: boolean
          list_id: string
          skipped: number
        }[]
      }
      enroll_smart_list_into_active_sequences: {
        Args: never
        Returns: {
          http_request_id: number
          list_id: string
          sequence_id: string
        }[]
      }
      enrollment_filter_preview: {
        Args: { p_criteria: Json; p_list_ids: string[]; p_org: string }
        Returns: {
          matching: number
          total_in_lists: number
        }[]
      }
      enrollment_pipeline_inflows: {
        Args: { p_dest_id: string; p_dest_type: string; p_org: string }
        Returns: {
          approved: number
          awaiting: number
          enabled: boolean
          list_id: string
          list_name: string
          rejected: number
          total: number
        }[]
      }
      exit_sequence_enrollment: {
        Args: { p_enrollment_id: string; p_reason?: string }
        Returns: boolean
      }
      expire_stale_signal_reviews: { Args: never; Returns: undefined }
      fail_job: {
        Args: {
          p_error_message: string
          p_error_stack?: string
          p_job_id: string
        }
        Returns: undefined
      }
      filter_contact_ids_by_criteria: {
        Args: { p_criteria: Json; p_ids: string[]; p_org: string }
        Returns: string[]
      }
      filter_contact_ids_by_pipeline_gate: {
        Args: {
          p_dest_id: string
          p_dest_type: string
          p_ids: string[]
          p_list_ids: string[]
          p_org: string
        }
        Returns: string[]
      }
      filter_lead_list_member_rows: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_list_id: string
          p_offset?: number
        }
        Returns: {
          added_at: string
          contact_id: string
          member_id: string
        }[]
      }
      filter_lead_list_member_rows_legacy: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_list_id: string
          p_offset?: number
        }
        Returns: {
          added_at: string
          contact_id: string
          member_id: string
        }[]
      }
      filter_lead_list_members: {
        Args: {
          p_filters?: Json
          p_list_id: string
          p_page?: number
          p_page_size?: number
        }
        Returns: {
          members: Json
          total_count: number
        }[]
      }
      finalize_mailtester_tick: {
        Args: {
          p_catch_all_delta: number
          p_daily_limit_reached: boolean
          p_invalid_delta: number
          p_job_id: string
          p_processed_emails: string[]
          p_token: string
          p_unknown_delta: number
          p_valid_delta: number
        }
        Returns: {
          applied: boolean
          pending_after: number
          status: string
        }[]
      }
      find_contacts_by_lower_email: {
        Args: { p_emails: string[]; p_organization_id: string }
        Returns: {
          custom_fields: Json
          enrichment_data: Json
          id: string
          primary_email: string
        }[]
      }
      find_crm_contact_by_email: {
        Args: { p_email: string; p_org_id: string }
        Returns: {
          display_name: string
          id: string
          primary_email: string
        }[]
      }
      find_keyword_excluded_conversations: {
        Args: { p_keywords: string[]; p_org_id: string }
        Returns: {
          conversation_id: string
        }[]
      }
      fn_slug_to_label: { Args: { slug: string }; Returns: string }
      generate_api_key: { Args: never; Returns: string }
      generate_mcp_api_key: { Args: never; Returns: string }
      get_accessible_organization_ids: { Args: never; Returns: string[] }
      get_admin_action_logs: {
        Args: {
          p_action_type?: string
          p_limit?: number
          p_organization_id?: string
        }
        Returns: {
          action_type: string
          admin_email: string
          admin_name: string
          admin_user_id: string
          created_at: string
          id: string
          new_value: Json
          notes: string
          previous_value: Json
          target_organization_id: string
          target_organization_name: string
        }[]
      }
      get_agency_clients_with_metrics: {
        Args: { p_agency_id: string }
        Returns: {
          content_count: number
          created_at: string
          id: string
          jobs_count: number
          logo_url: string
          name: string
          parent_id: string
          slug: string
          status: string
          user_count: number
        }[]
      }
      get_all_organizations_with_metrics: {
        Args: {
          p_include_suspended?: boolean
          p_plan_filter?: string
          p_search?: string
          p_status_filter?: string
          p_type_filter?: string
        }
        Returns: {
          api_key_count: number
          content_count: number
          created_at: string
          id: string
          is_suspended: boolean
          jobs_count: number
          logo_url: string
          name: string
          owner_email: string
          parent_id: string
          parent_name: string
          plan_tier: string
          slug: string
          status: string
          suspended_at: string
          suspension_reason: string
          type: string
          user_count: number
        }[]
      }
      get_batch_progress: {
        Args: { batch_uuid: string }
        Returns: {
          batch_id: string
          batch_size: number
          completed: number
          failed: number
          in_progress: number
          progress_percentage: number
        }[]
      }
      get_branding_by_domain: {
        Args: { p_domain: string }
        Returns: {
          accent_color: Json
          app_name: string
          cta_color: Json
          custom_css: string
          favicon_url: string
          footer_text: string
          hide_powered_by: boolean
          logo_dark_url: string
          logo_url: string
          meta_description: string
          meta_title: string
          og_image_url: string
          organization_id: string
          organization_slug: string
          primary_color: Json
          privacy_url: string
          support_email: string
          support_url: string
          tagline: string
          terms_url: string
          twitter_handle: string
        }[]
      }
      get_bulk_job_summary: {
        Args: { job_uuid: string }
        Returns: {
          avg_generation_time_ms: number
          cancelled_count: number
          completed_count: number
          failed_count: number
          generating_count: number
          job_id: string
          job_name: string
          pending_count: number
          total_cost: number
          total_count: number
        }[]
      }
      get_channel_limits_summary: {
        Args: { p_date_range_days?: number; p_organization_id: string }
        Returns: {
          avg_daily_usage: number
          brand_color: string
          channel: Database["public"]["Enums"]["crm_channel_type"]
          current_zone: Database["public"]["Enums"]["limit_zone"]
          daily_limit: number
          description: string
          display_name: string
          icon: string
          is_enabled: boolean
          logo_url: string
          reply_rate: number
          today_remaining: number
          today_used: number
          total_delivered_period: number
          total_failed_period: number
          total_sent_period: number
          usage_percent: number
          warmup_progress: number
          warmup_status: Database["public"]["Enums"]["warmup_status"]
        }[]
      }
      get_child_organizations: {
        Args: { parent_org_id: string }
        Returns: {
          id: string
          name: string
          type: string
        }[]
      }
      get_connections_count_by_account: {
        Args: { p_account_id: string }
        Returns: number
      }
      get_contact_available_channels: {
        Args: { p_contact_id: string }
        Returns: string[]
      }
      get_contact_enrollments: {
        Args: { p_contact_id: string }
        Returns: {
          enrollment_id: string
          enrollment_status: string
          is_active: boolean
          is_followup: boolean
          next_action_at: string | null
          pause_reason: string | null
          sequence_id: string
          sequence_name: string
          sequence_status: string
          source: string
        }[]
      }
      get_contact_ids_for_list_filter: {
        Args: {
          p_exclude_list_ids?: string[]
          p_in_list_ids?: string[]
          p_organization_id: string
        }
        Returns: string[]
      }
      get_contact_ids_not_in_lists: {
        Args: { p_exclude_list_ids: string[]; p_organization_id: string }
        Returns: string[]
      }
      get_contact_unified_messages: {
        Args: { p_contact_id: string; p_limit?: number; p_org_id: string }
        Returns: {
          ai_generated: boolean
          attachments: Json
          channel: string
          content: string
          content_type: string
          conversation_id: string
          created_at: string
          direction: string
          email_subject: string
          message_id: string
          metadata: Json
          sender_type: string
          status: string
        }[]
      }
      get_custom_signal_leads: {
        Args: {
          p_employee_bands?: string[]
          p_has_email?: boolean
          p_industries?: string[]
          p_limit?: number
          p_max_age_days?: number
          p_offset?: number
          p_org_id: string
          p_revenue_bands?: string[]
          p_search?: string
          p_signal_types?: string[]
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      get_decrypted_api_key: {
        Args: { p_organization_id: string; p_provider: string }
        Returns: string
      }
      get_effective_daily_limit: {
        Args: {
          p_channel: Database["public"]["Enums"]["crm_channel_type"]
          p_channel_account_id?: string
          p_organization_id: string
        }
        Returns: number
      }
      get_effective_daily_limits_for_accounts: {
        Args: {
          p_channel_account_ids: string[]
          p_channels?: Database["public"]["Enums"]["crm_channel_type"][]
          p_organization_id: string
        }
        Returns: {
          channel: Database["public"]["Enums"]["crm_channel_type"]
          channel_account_id: string
          daily_limit: number
        }[]
      }
      get_email_analytics_daily_trend: {
        Args: {
          p_end: string
          p_mailbox_id?: string
          p_org: string
          p_sequence_id?: string
          p_start: string
          p_tz?: string
        }
        Returns: {
          bounced: number
          clicked: number
          day: string
          delivered: number
          opened: number
          replied: number
          sent: number
          unique_leads: number
        }[]
      }
      get_email_analytics_stats: {
        Args: {
          p_end: string
          p_mailbox_id?: string
          p_org: string
          p_prev_end: string
          p_prev_start: string
          p_sequence_id?: string
          p_start: string
        }
        Returns: Json
      }
      get_email_reply_leads: {
        Args: {
          p_end: string
          p_kind?: string
          p_limit?: number
          p_mailbox_id?: string
          p_org: string
          p_sequence_id?: string
          p_start: string
        }
        Returns: {
          contact_id: string
          contact_name: string
          conversation_id: string
          lead_intent: string
          lead_key: string
          meeting: boolean
          recipient_email: string
          replied_at: string
          sequence_id: string
          sequence_name: string
          subject: string
        }[]
      }
      get_email_sequence_mailbox_ids: {
        Args: { p_org: string; p_sequence_id: string }
        Returns: string[]
      }
      get_email_sequence_performance: {
        Args: {
          p_end: string
          p_mailbox_id?: string
          p_org: string
          p_start: string
        }
        Returns: {
          auto_replies: number
          blocked: number
          bounced: number
          delivered: number
          last_sent_at: string
          meetings: number
          positive: number
          replied: number
          sent: number
          sequence_id: string
          sequence_name: string
          sequence_status: string
          unique_leads: number
        }[]
      }
      get_farm_campaign_stats: {
        Args: { campaign_uuid: string; target_date?: string }
        Returns: {
          campaign_id: string
          date: string
          derivatives_created: number
          pieces_generated: number
          pieces_published: number
          target_pieces: number
        }[]
      }
      get_filtered_lead_list_member_ids:
        | { Args: { p_filters?: Json; p_list_id: string }; Returns: Json }
        | {
            Args: { p_filters?: Json; p_limit?: number; p_list_id: string }
            Returns: Json
          }
      get_ideas_count_by_tag: {
        Args: { p_organization_id?: string }
        Returns: {
          idea_count: number
          tag_name: string
        }[]
      }
      get_lead_handoffs_by_contacts: {
        Args: {
          p_connection_id?: string
          p_contact_ids: string[]
          p_deletion_status?: string
          p_external_campaign_id?: string
          p_org_id: string
          p_status?: string
          p_tool_type?: string
        }
        Returns: Json[]
      }
      get_lead_list_ai_analysis_summary: {
        Args: { p_list_id: string }
        Returns: {
          analyzed: number
          analyzing: number
          failed: number
          not_analyzed: number
          total: number
        }[]
      }
      get_lead_list_member_emails: {
        Args: { p_list_id: string }
        Returns: Json
      }
      get_lead_list_member_ids: { Args: { p_list_id: string }; Returns: Json }
      get_lead_list_processing_llm_key_status: {
        Args: { p_list_id: string }
        Returns: {
          health_checked_at: string
          health_message: string
          health_reason: string
          health_status: string
          key_configured: boolean
          key_valid: boolean
          model: string
          provider: string
        }[]
      }
      get_lead_list_processing_operational_metrics: {
        Args: { p_list_id: string }
        Returns: {
          active_contacts: number
          analysis_ran: number
          analysis_reused: number
          cleared_find_email: number
          cleared_icp: number
          cleared_verify_email: number
          completed_last_five_minutes: number
          contacts_with_email: number
          email_found_total: number
          email_searches_total: number
          enrolled: number
          no_email_searched: number
          no_email_unsearched: number
          ready_contacts: number
          stage_find_email_enabled: boolean
          stage_icp_enabled: boolean
          stage_order: string[]
          stage_verify_email_enabled: boolean
          total_people: number
          valid_emails: number
          verified_emails: number
        }[]
      }
      get_lead_list_processing_provider_fairness: {
        Args: { p_list_id: string }
        Returns: {
          active_lists: number
          list_waiting: number
          provider: string
        }[]
      }
      get_lead_list_processing_provider_status: {
        Args: { p_list_id: string }
        Returns: {
          attempt_count: number
          chain_position: number
          daily_cap: number
          daily_found_count: number
          daily_request_count: number
          failed_count: number
          found_count: number
          key_configured: boolean
          key_valid: boolean
          last_attempt_at: string
          last_error: string
          last_success_at: string
          not_found_count: number
          provider: string
          provider_plan: string
          running_count: number
          skipped_count: number
        }[]
      }
      get_lead_list_processing_status: {
        Args: { p_list_id: string }
        Returns: {
          failure_category: string
          item_count: number
          item_stage: string
          item_status: string
          latest_updated_at: string
          policy_paused_at: string
          recovery_exhausted: boolean
        }[]
      }
      get_next_job: {
        Args: { p_job_types?: string[] }
        Returns: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          error_stack: string | null
          expires_at: string | null
          id: string
          job_name: string
          job_type: string
          max_retries: number
          metadata: Json | null
          organization_id: string
          payload: Json
          priority: number
          retry_count: number
          scheduled_for: string
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_next_pool_idea:
        | {
            Args: { p_autopilot_id: string }
            Returns: {
              idea_id: string
              idea_title: string
              pool_entry_id: string
            }[]
          }
        | {
            Args: { p_autopilot_id: string; p_blueprint_id?: string }
            Returns: {
              idea_id: string
              idea_title: string
              pool_entry_id: string
            }[]
          }
      get_or_create_conversation:
        | {
            Args: {
              p_channel: string
              p_channel_account_id?: string
              p_contact_id: string
              p_external_conversation_id?: string
              p_external_participant_id?: string
              p_org_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_channel: string
              p_channel_account_id?: string
              p_contact_id: string
              p_external_conversation_id?: string
              p_external_participant_id?: string
              p_mailbox_id?: string
              p_org_id: string
            }
            Returns: string
          }
      get_org_lead_list_workflow_status: {
        Args: { p_org_id: string }
        Returns: {
          latest_updated_at: string
          lead_list_id: string
          pending_count: number
          policy_enabled: boolean
          policy_paused_at: string
          processing_count: number
          total_count: number
        }[]
      }
      get_pending_crm_messages: {
        Args: { p_channel?: string; p_limit?: number }
        Returns: {
          attachments: Json
          attempts: number
          channel: string
          channel_account_id: string
          contact_id: string
          content: string
          content_type: string
          conversation_id: string
          email_bcc: string[]
          email_cc: string[]
          email_subject: string
          id: string
          metadata: Json
          organization_id: string
          priority: number
          recipient_display_name: string
          recipient_external_id: string
          recipient_identity_id: string
          scheduled_for: string
          sender_type: string
          sender_user_id: string
          source_id: string
          source_type: string
        }[]
      }
      get_pending_unipile_messages: {
        Args: { p_limit?: number }
        Returns: {
          account_id: string
          attempts: number
          campaign_id: string
          id: string
          lead_id: string
          message_text: string
          organization_id: string
          recipient_name: string
          recipient_platform_id: string
          scheduled_for: string
        }[]
      }
      get_pending_webhook_events: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          auth_header_name: string
          auth_header_value: string
          event_data: Json
          event_type: string
          id: string
          max_attempts: number
          organization_id: string
          webhook_secret: string
          webhook_url: string
        }[]
      }
      get_product_tags: { Args: { org_id: string }; Returns: string[] }
      get_prompt_tags: { Args: { p_prompt_id: string }; Returns: string[] }
      get_public_company_signal_timeline: {
        Args: { p_company_id: string; p_limit?: number; p_token: string }
        Returns: Json
      }
      get_public_signal_companies: {
        Args: {
          p_direction?: string
          p_has_people?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_token: string
          p_window?: string
        }
        Returns: Json
      }
      get_public_signal_company: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_public_signal_company_unfiltered: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_public_signal_library_companies_page: {
        Args: {
          p_employee_bands?: string[]
          p_industries?: string[]
          p_limit?: number
          p_offset?: number
          p_revenue_bands?: string[]
          p_search?: string
          p_sort_by?: string
          p_sort_dir?: string
          p_type?: string
          p_window?: string
        }
        Returns: Json
      }
      get_public_signal_library_people: {
        Args: { p_signal_ids: string[] }
        Returns: Json
      }
      get_public_signal_library_people_page: {
        Args: {
          p_employee_bands?: string[]
          p_has_email?: boolean
          p_industries?: string[]
          p_limit?: number
          p_offset?: number
          p_revenue_bands?: string[]
          p_search?: string
          p_sort_by?: string
          p_sort_dir?: string
          p_type?: string
          p_window?: string
        }
        Returns: Json
      }
      get_public_signal_summary: { Args: { p_token: string }; Returns: Json }
      get_public_signals_feed: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_type?: string
          p_window?: string
        }
        Returns: Json
      }
      get_public_signals_feed_unfiltered: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_type?: string
          p_window?: string
        }
        Returns: Json
      }
      get_public_signals_meta: { Args: never; Returns: Json }
      get_response_time_stats: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          avg_ms: number
          channel: string
          median_ms: number
          total_convs: number
        }[]
      }
      get_scene_stats: {
        Args: { vid: string }
        Returns: {
          approved_scenes: number
          failed_scenes: number
          pending_scenes: number
          total_scenes: number
        }[]
      }
      get_signal_companies: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_outcome_filter?: string
          p_search?: string
          p_sort_by?: string
          p_sort_dir?: string
          p_subscription_id: string
        }
        Returns: {
          best_icp_score: number
          best_outcome: string
          company_name: string
          country: string
          crm_contacts_count: number
          dms_count: number
          domain: string
          employee_count: number
          exported: boolean
          id: string
          industry: string
          latest_evidence_url: string
          latest_raw_signal: Json
          latest_signal_at: string
          latest_signal_date: string
          latest_signal_detail: string
          latest_signal_type: string
          linkedin_url: string
          signal_count: number
          signal_types: string[]
          total_count: number
          verified_emails_count: number
          website_url: string
        }[]
      }
      get_signal_company_detail: {
        Args: { p_company_id: string; p_subscription_id: string }
        Returns: {
          contact_discovery_score: number
          contact_display_name: string
          contact_id: string
          contact_job_title: string
          contact_primary_email: string
          dm_email: string
          dm_email_status: string
          dm_first_name: string
          dm_last_name: string
          dm_linkedin_url: string
          dm_title: string
          icp_score: number
          kind: string
          occurred_at: string
          outcome: string
          raw_signal: Json
          ref_id: string
          signal_detail: string
          signal_type: string
        }[]
      }
      get_signal_engine_shadow_report: {
        Args: { p_days?: number }
        Returns: Json
      }
      get_signal_funnel: {
        Args: { p_subscription_id: string }
        Returns: {
          companies_total: number
          dms_found: number
          emails_verified: number
          enrolled_today: number
          enrolled_week: number
          in_crm: number
          linkedin_only: number
          pending_review: number
          signals_total: number
          stuck_24h: number
        }[]
      }
      get_signup_request_stats: { Args: never; Returns: Json }
      get_suggested_blocks: {
        Args: {
          p_block_type?: string
          p_organization_id: string
          p_product_ids: string[]
        }
        Returns: {
          avg_fit_score: number
          block_content: string
          block_id: string
          block_name: string
          block_type: string
          total_fit_score: number
        }[]
      }
      get_suggested_icps: {
        Args: { p_organization_id: string; p_product_ids: string[] }
        Returns: {
          avg_fit_score: number
          icp_id: string
          icp_name: string
          matching_products: number
          total_fit_score: number
        }[]
      }
      get_user_active_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids_cached: { Args: never; Returns: string[] }
      get_user_org_role: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: string
      }
      get_user_organization_from_jwt: { Args: never; Returns: string }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_storage_path: { Args: never; Returns: string }
      get_user_video_stats: {
        Args: { p_user_id: string }
        Returns: {
          completed_projects: number
          in_progress_projects: number
          total_cost: number
          total_generation_time: number
          total_projects: number
        }[]
      }
      import_pool_rows_to_list: {
        Args: { p_list_id: string; p_org_id: string; p_rows: Json }
        Returns: {
          added_members: number
          inserted_contacts: number
        }[]
      }
      inbox_keyword_regex: { Args: { p_keywords: string[] }; Returns: string }
      increment_api_usage: {
        Args: { cost_amount: number; org_id: string; provider_name: string }
        Returns: undefined
      }
      increment_campaign_analytics: {
        Args: {
          p_account_id: string
          p_campaign_id: string
          p_metric: string
          p_organization_id: string
          p_value?: number
        }
        Returns: undefined
      }
      increment_channel_usage: {
        Args: {
          p_channel: Database["public"]["Enums"]["crm_channel_type"]
          p_channel_account_id?: string
          p_organization_id: string
          p_status?: string
        }
        Returns: boolean
      }
      increment_conversation_counters: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      increment_csv_import_progress: {
        Args: {
          p_failed_delta?: number
          p_imported_delta?: number
          p_is_complete?: boolean
          p_job_id: string
          p_progress?: number
          p_rows_delta?: number
          p_skip_reasons_invalid?: number
          p_skip_reasons_missing?: number
          p_skipped_delta?: number
        }
        Returns: undefined
      }
      increment_job_progress:
        | {
            Args: {
              p_current_platform?: string
              p_job_id: string
              p_total?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_increment_completed?: boolean
              p_increment_failed?: boolean
              p_job_id: string
            }
            Returns: undefined
          }
      increment_mailbox_count: {
        Args: { delta: number; domain_id_input: string }
        Returns: undefined
      }
      increment_organization_usage: {
        Args: { p_cost?: number; p_count?: number; p_org_id: string }
        Returns: Json
      }
      increment_prompt_usage: {
        Args: { prompt_id: string }
        Returns: undefined
      }
      increment_storage_usage: {
        Args: { org_id: string; size_bytes: number }
        Returns: undefined
      }
      increment_unipile_campaign_stats: {
        Args: {
          p_campaign_id: string
          p_dms_failed?: number
          p_dms_sent?: number
          p_leads?: number
        }
        Returns: undefined
      }
      increment_variant_stat: {
        Args: { p_column: string; p_variant_id: string }
        Returns: undefined
      }
      initialize_agency_user_access: {
        Args: { user_id: string }
        Returns: undefined
      }
      initialize_campaign_leads: {
        Args: { p_campaign_id: string }
        Returns: {
          leads_added: number
          leads_excluded: number
          total_in_list: number
        }[]
      }
      is_batch_complete: { Args: { batch_uuid: string }; Returns: boolean }
      is_current_user_super_admin: { Args: never; Returns: boolean }
      is_sending_domain_sendable: {
        Args: { p_domain_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { user_id: string }; Returns: boolean }
      kick_webhook_dispatcher: { Args: never; Returns: undefined }
      lead_list_member_page: {
        Args: {
          p_after_added_at?: string
          p_after_id?: string
          p_limit?: number
          p_list_id: string
        }
        Returns: {
          added_at: string
          contact_id: string
          member_id: string
        }[]
      }
      lead_lists_awaiting_processing: {
        Args: { p_list_ids: string[]; p_org: string }
        Returns: number
      }
      lookup_email_verifications: {
        Args: {
          p_apify_only?: boolean
          p_hashes_hex: string[]
          p_min_score: number
          p_stale_cutoff: string
        }
        Returns: {
          created_at: string
          email_hash: string
          is_catch_all: boolean | null
          is_deliverable: boolean | null
          is_disabled: boolean | null
          is_disposable: boolean | null
          is_free: boolean | null
          is_role: boolean | null
          is_spamtrap: boolean | null
          last_source: string
          last_verified_at: string
          mx_host: string | null
          overall_score: number | null
          raw_result: Json | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pool_email_verifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_user_id?: string }
        Returns: undefined
      }
      mark_emails_delivered: { Args: never; Returns: number }
      mark_keyword_excluded_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      mark_keyword_excluded_conversations: {
        Args: { p_keywords?: string[]; p_org_id: string }
        Returns: {
          contacts_archived: number
          conversations_excluded: number
        }[]
      }
      mark_webhook_sent: {
        Args: {
          p_error_message?: string
          p_event_id: string
          p_response_body?: string
          p_response_status?: number
          p_success: boolean
        }
        Returns: undefined
      }
      materialize_quickenrich_signal_leads: {
        Args: { p_batch_size?: number }
        Returns: Json
      }
      merge_contact_custom_fields: {
        Args: { p_contact_id: string; p_organization_id: string; p_patch: Json }
        Returns: Json
      }
      merge_conversation_metadata: {
        Args: { p_conversation_id: string; p_metadata_update: Json }
        Returns: Json
      }
      merge_into_active_mailtester_job: {
        Args: {
          p_catch_all_increment: number
          p_invalid_increment: number
          p_list_id: string
          p_new_emails: string[]
          p_new_total_increment: number
          p_organization_id: string
          p_pre_pass_increment: number
          p_unknown_increment: number
          p_valid_increment: number
        }
        Returns: {
          appended: number
          id: string
          pending_after: number
          total_after: number
        }[]
      }
      merge_lead_lists: {
        Args: { p_source_list_ids: string[]; p_target_list_id: string }
        Returns: number
      }
      merge_mailbox_metadata: {
        Args: { p_id: string; p_merge: Json }
        Returns: undefined
      }
      merge_mailbox_smtp_credentials: {
        Args: { p_encrypted: string; p_id: string }
        Returns: undefined
      }
      migrate_linkedin_connections_to_crm: {
        Args: never
        Returns: {
          accounts_linked: number
          connections_migrated: number
          contacts_created: number
          contacts_updated: number
          errors: number
        }[]
      }
      normalize_company_domain: { Args: { p_domain: string }; Returns: string }
      normalize_country_code: { Args: { p_value: string }; Returns: string }
      normalize_employee_range_text: {
        Args: { p_raw: string }
        Returns: string
      }
      normalize_inbox_keyword: { Args: { p_keyword: string }; Returns: string }
      normalize_industry_text: { Args: { p_raw: string }; Returns: string }
      pause_lead_list_processing: {
        Args: { p_list_id: string }
        Returns: number
      }
      pick_warmup_partners: {
        Args: {
          p_cooldown_days?: number
          p_max_receives_per_day?: number
          p_sender_ids: string[]
        }
        Returns: {
          partner_id: string
          sender_id: string
        }[]
      }
      preview_eligible_leads_count: {
        Args: {
          p_campaign_id: string
          p_exclude_other_campaigns: boolean
          p_exclude_same_sender?: boolean
          p_exclusion_list_ids: string[]
          p_lead_list_id: string
          p_organization_id: string
          p_sender_account_ids?: string[]
        }
        Returns: {
          eligible_count: number
          excluded_by_list: number
          excluded_by_other_campaign: number
          excluded_by_same_sender: number
          total_in_list: number
        }[]
      }
      preview_eligible_leads_count_multi: {
        Args: {
          p_campaign_id: string
          p_exclude_other_campaigns: boolean
          p_exclude_same_sender?: boolean
          p_exclusion_list_ids: string[]
          p_lead_list_ids: string[]
          p_organization_id: string
          p_sender_account_ids?: string[]
        }
        Returns: {
          eligible_count: number
          excluded_by_list: number
          excluded_by_other_campaign: number
          excluded_by_same_sender: number
          total_in_list: number
        }[]
      }
      process_channel_stats_refresh_queue: {
        Args: { p_max?: number }
        Returns: number
      }
      process_inbox_keyword_sweep_queue: {
        Args: { p_limit?: number }
        Returns: number
      }
      progress_warmup: { Args: never; Returns: number }
      prune_api_rate_limits: { Args: never; Returns: number }
      prune_delivery_reconciliation_runs: { Args: never; Returns: undefined }
      prune_enrichment_provider_request_events: {
        Args: { p_retention?: string }
        Returns: number
      }
      prune_lb_mx_throughput: { Args: never; Returns: undefined }
      prune_webhook_event_log: {
        Args: never
        Returns: {
          deleted_settled: number
          deleted_stale_pending: number
        }[]
      }
      public_signal_auto_enroll_custom_candidates: {
        Args: {
          p_criteria: Json
          p_list_id: string
          p_org: string
          p_require_email: boolean
          p_signal_types: string[]
        }
        Returns: {
          contact_id: string
          subscription_id: string
        }[]
      }
      public_signal_auto_enroll_preview: {
        Args: {
          p_criteria?: Json
          p_list_id?: string
          p_lookback_days?: number
          p_org: string
          p_require_email?: boolean
          p_signal_types?: string[]
          p_source?: string
        }
        Returns: number
      }
      public_signal_auto_enroll_public_candidates: {
        Args: {
          p_criteria: Json
          p_list_id: string
          p_lookback_days: number
          p_org: string
          p_require_email: boolean
          p_signal_types: string[]
        }
        Returns: {
          company_key: string
          company_linkedin_url: string
          company_name: string
          domain: string
          email: string
          full_name: string
          linkedin_url: string
          person_id: string
          person_title: string
          signal_id: string
          signal_type: string
          source_url: string
        }[]
      }
      queue_contact_enrichment: {
        Args: {
          p_contact_id: string
          p_enrichment_types?: string
          p_priority?: number
          p_source?: string
        }
        Returns: string
      }
      queue_list_enrichment: {
        Args: {
          p_enrichment_types?: string
          p_list_id: string
          p_only_missing?: boolean
          p_priority?: number
        }
        Returns: number
      }
      queue_webhook_event: {
        Args: {
          p_event_data: Json
          p_event_type: string
          p_organization_id: string
        }
        Returns: string
      }
      reap_lead_list_sources: {
        Args: { p_stale_lock_minutes?: number }
        Returns: Json
      }
      reap_orphaned_sending_emails: {
        Args: { p_batch_limit?: number; p_grace_minutes?: number }
        Returns: number
      }
      reap_stranded_email_verifications: {
        Args: never
        Returns: {
          enqueued: number
          org_id: string
        }[]
      }
      reap_stuck_autopilot_pool_entries: {
        Args: { p_max_attempts?: number; p_stuck_minutes?: number }
        Returns: Json
      }
      reclaim_stale_lb_work_items: { Args: never; Returns: number }
      reclaim_stuck_webhook_events: {
        Args: { p_older_than?: string }
        Returns: number
      }
      recompute_warmup_day: {
        Args: { p_mailbox_id: string }
        Returns: undefined
      }
      record_limit_hit: {
        Args: { p_limit_type: string; p_org_id: string }
        Returns: undefined
      }
      recover_stale_lb_work_items: { Args: never; Returns: number }
      recover_stuck_csv_import_jobs: { Args: never; Returns: undefined }
      recover_stuck_dm_signals: { Args: never; Returns: number }
      recover_stuck_generations: { Args: never; Returns: undefined }
      recover_stuck_import_jobs: { Args: never; Returns: undefined }
      recover_stuck_list_building_jobs: { Args: never; Returns: undefined }
      recycle_autopilot_pool: {
        Args: {
          p_autopilot_id: string
          p_include_failed?: boolean
          p_min_idle?: unknown
        }
        Returns: Json
      }
      refresh_all_campaign_metrics: { Args: never; Returns: number }
      refresh_all_smart_list_counts: { Args: never; Returns: number }
      refund_rate_limited_enrichment_request: {
        Args: { p_reservation_id: string }
        Returns: boolean
      }
      reinitialize_campaign_leads: {
        Args: { p_campaign_id: string }
        Returns: {
          leads_added: number
          leads_removed: number
          total_leads: number
        }[]
      }
      reject_signup_request: {
        Args: { p_reason?: string; p_request_id: string }
        Returns: Json
      }
      release_analysis_slot: { Args: { p_slot_id: string }; Returns: undefined }
      release_apify_leads_import_job: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      release_lead_list_source: {
        Args: { p_source_id: string }
        Returns: undefined
      }
      release_pack_refresh_job: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      release_pool_classify_batch: {
        Args: { p_domains: string[] }
        Returns: number
      }
      release_webhook_dispatcher_lease: { Args: never; Returns: undefined }
      remap_leads_on_sequence_change: {
        Args: { p_campaign_id: string; p_old_node_ids: string[] }
        Returns: {
          leads_remapped: number
        }[]
      }
      renew_webhook_dispatcher_lease: {
        Args: { p_lease?: string }
        Returns: undefined
      }
      report_enrichment_provider_record: {
        Args: {
          p_consumed: boolean
          p_organization_id: string
          p_provider: string
        }
        Returns: undefined
      }
      request_lead_list_channel_stats_refresh: {
        Args: { p_list_id: string }
        Returns: undefined
      }
      reserve_enrichment_provider_request: {
        Args: {
          p_daily_cap?: number
          p_list_id?: string
          p_max_requests_per_minute?: number
          p_max_wait_ms?: number
          p_min_find_rate?: number
          p_organization_id: string
          p_provider: string
          p_records_per_minute?: number
          p_requests_per_minute: number
        }
        Returns: {
          daily_cap: number
          daily_used: number
          requests_per_minute: number
          reservation_id: string
          reservation_status: string
          scheduled_at: string
          wait_ms: number
        }[]
      }
      reset_daily_usage: { Args: never; Returns: undefined }
      reset_email_verification_progress: {
        Args: {
          p_list_id: string
          p_organization_id: string
          p_phase?: string
          p_total: number
        }
        Returns: undefined
      }
      reset_lead_list_processing_run: {
        Args: { p_list_id: string }
        Returns: number
      }
      reset_monthly_usage: { Args: never; Returns: undefined }
      reset_response_time_stats: { Args: { p_org_id: string }; Returns: number }
      restart_canceled_lead_processing_run: {
        Args: { p_list_id: string }
        Returns: number
      }
      resume_lead_list_processing: {
        Args: { p_list_id: string }
        Returns: number
      }
      retry_failed_lead_list_processing_run: {
        Args: { p_list_id: string }
        Returns: number
      }
      retry_transient_lead_processing_failures: { Args: never; Returns: number }
      route_lead_list_processing_no_data: {
        Args: {
          p_destination_id: string
          p_destination_type: string
          p_list_id: string
        }
        Returns: number
      }
      route_lead_list_processing_no_source_data: {
        Args: { p_list_id: string }
        Returns: number
      }
      run_public_signal_auto_enroll: { Args: never; Returns: Json }
      sample_lock_contention_once: { Args: never; Returns: number }
      scrub_deleted_mailbox_links: {
        Args: { p_mailbox_id: string }
        Returns: undefined
      }
      scrub_disconnected_sender_links: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      search_campaign_leads:
        | {
            Args: {
              p_campaign_id: string
              p_page?: number
              p_page_size?: number
              p_search?: string
              p_status?: string
            }
            Returns: {
              leads: Json
              total_count: number
            }[]
          }
        | {
            Args: {
              p_campaign_id: string
              p_page?: number
              p_page_size?: number
              p_search?: string
              p_sort_by?: string
              p_sort_dir?: string
              p_status?: string
            }
            Returns: {
              leads: Json
              total_count: number
            }[]
          }
      search_crm_contacts: {
        Args: { p_limit?: number; p_org_id: string; p_query: string }
        Returns: {
          contact_id: string
        }[]
      }
      search_crm_contacts_keyset: {
        Args: {
          p_after_id?: string
          p_limit?: number
          p_org_id: string
          p_query: string
        }
        Returns: {
          contact_id: string
        }[]
      }
      search_inbox_messages: {
        Args: { p_limit?: number; p_org_id: string; p_query: string }
        Returns: {
          contact_email: string
          contact_name: string
          content: string
          conversation_id: string
          created_at: string
          direction: string
          email_subject: string
          message_id: string
          rank: number
        }[]
      }
      search_knowledge_chunks: {
        Args: {
          p_document_ids: string[]
          p_limit?: number
          p_organization_id: string
          p_query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          similarity: number
        }[]
      }
      search_linkedin_connections: {
        Args: {
          p_account_id?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_search_query?: string
        }
        Returns: {
          account_id: string
          company: string
          connected_at: string
          first_name: string
          full_name: string
          headline: string
          id: string
          job_title: string
          last_name: string
          linkedin_id: string
          linkedin_url: string
          location: string
          profile_picture_url: string
          synced_at: string
          total_count: number
        }[]
      }
      search_prompts_by_tags: {
        Args: { p_organization_id?: string; p_tags: string[] }
        Returns: {
          category: string | null
          composed_of: string[] | null
          content_types: string[] | null
          created_at: string | null
          created_by: string | null
          description: string | null
          goals: string[] | null
          id: string
          is_preset: boolean | null
          is_public: boolean | null
          name: string
          organization_id: string
          pipeline_type: string | null
          prompt_content: string
          prompt_type: string
          scenario: string | null
          updated_at: string | null
          usage_count: number | null
          variables: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "prompt_library"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_sequence_enrollments: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sequence_id: string
          p_status?: string
        }
        Returns: {
          enrollments: Json
          total_count: number
        }[]
      }
      seed_lead_list_processing_items: {
        Args: { p_list_id: string }
        Returns: number
      }
      select_campaign_channel_for_contact: {
        Args: { p_campaign_id: string; p_contact_id: string }
        Returns: {
          channel: string
          identifier: string
          identity_id: string
        }[]
      }
      set_inbox_keyword_exclusions: {
        Args: { p_keywords: string[]; p_org_id: string }
        Returns: {
          contacts_archived: number
          conversations_excluded: number
          keyword_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      signal_company_passes_filter: {
        Args: {
          p_criteria: Json
          p_employee_count: number
          p_employee_range: string
          p_revenue_range: string
        }
        Returns: boolean
      }
      signal_domain_agrees: {
        Args: { p_left: string; p_right: string }
        Returns: boolean
      }
      signal_employee_band: {
        Args: { p_count: number; p_range: string }
        Returns: string
      }
      signal_enrollment_counts: {
        Args: { p_subscription_id: string }
        Returns: {
          today_count: number
          week_count: number
        }[]
      }
      signal_filter_int: {
        Args: { p_criteria: Json; p_default: number; p_key: string }
        Returns: number
      }
      signal_firmographic_candidates: {
        Args: {
          p_include_domain_only?: boolean
          p_limit?: number
          p_org?: string
          p_recheck_days?: number
          p_sources?: string[]
        }
        Returns: {
          anchor_linkedin_url: string
          company_name: string
          domain: string
          employee_count_estimate: number
          id: string
          organization_id: string
          revenue_range: string
          source: string
          website_url: string
        }[]
      }
      signal_has_company_gate: { Args: { p_criteria: Json }; Returns: boolean }
      signal_lead_passes_filter: {
        Args: {
          p_country: string
          p_criteria: Json
          p_seniority: number
          p_title: string
        }
        Returns: boolean
      }
      signal_normalize_domain: { Args: { p_domain: string }; Returns: string }
      signal_person_is_eligible: {
        Args: { p_linkedin_url: string; p_title: string }
        Returns: boolean
      }
      signal_person_title_is_senior: {
        Args: { p_title: string }
        Returns: boolean
      }
      signal_person_url_is_valid: { Args: { p_url: string }; Returns: boolean }
      signal_revenue_band: { Args: { p_range: string }; Returns: string }
      signal_revenue_rank: { Args: { p_range: string }; Returns: number }
      signal_seniority_rank: { Args: { p_title: string }; Returns: number }
      smart_list_contact_page: {
        Args: {
          p_direction?: string
          p_list_id: string
          p_page?: number
          p_page_size?: number
          p_sort?: string
        }
        Returns: {
          ai_analysis_status: string | null
          ai_analyzed_at: string | null
          avatar_url: string | null
          city: string | null
          company: string | null
          company_employee_count: number | null
          company_employee_range: string | null
          company_id: string | null
          company_industry: string | null
          company_name: string | null
          company_revenue_range: string | null
          company_website: string | null
          contact_type: string | null
          country: string | null
          created_at: string | null
          custom_fields: Json | null
          discovery_metadata: Json | null
          discovery_score: number | null
          discovery_signal_strength: string | null
          display_name: string
          email: string | null
          email_is_catch_all: boolean | null
          email_is_deliverable: boolean | null
          email_is_disposable: boolean | null
          email_is_free: boolean | null
          email_is_role: boolean | null
          email_is_spamtrap: boolean | null
          email_last_validated_at: string | null
          email_type: string | null
          email_verification_score: number | null
          email_verification_source: string | null
          email_verification_status: string | null
          email_verified_at: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          firmographics_checked_at: string | null
          firmographics_source: string | null
          first_name: string | null
          first_seen_at: string | null
          full_name: string | null
          home_page_text: string | null
          home_page_text_fetched_at: string | null
          id: string
          is_linkedin_connection: boolean | null
          job_title: string | null
          last_activity_at: string | null
          last_name: string | null
          lead_score: number | null
          lead_score_breakdown: Json | null
          lead_score_updated_at: string | null
          linkedin_bio: string | null
          linkedin_connected_at: string | null
          linkedin_url: string | null
          moltsets_attempted_at: string | null
          notion_page_id: string | null
          notion_preview_url: string | null
          organization_id: string
          outreach_status: string | null
          owner_user_id: string | null
          phone: string | null
          pipeline_id: string | null
          preview_document_id: string | null
          primary_email: string | null
          primary_linkedin_url: string | null
          primary_phone: string | null
          quickenrich_attempted_at: string | null
          seg_checked_at: string | null
          seg_provider: string | null
          signal_confidence: number | null
          signal_date: string | null
          signal_detail: string | null
          signal_event_id: string | null
          signal_source_url: string | null
          signal_subscription_id: string | null
          signal_type: string | null
          source: string | null
          source_campaign_id: string | null
          source_details: Json | null
          source_lead_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          state: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      smart_list_eligible_contact_ids: {
        Args: { p_list_id: string }
        Returns: string[]
      }
      smart_list_eligible_contacts_for_criteria: {
        Args: { p_candidate_ids?: string[]; p_criteria: Json; p_org_id: string }
        Returns: string[]
      }
      smart_list_eligible_contacts_for_flat_criteria: {
        Args: { p_candidate_ids?: string[]; p_criteria: Json; p_org_id: string }
        Returns: string[]
      }
      smart_list_eligible_contacts_for_flat_criteria_legacy: {
        Args: { p_candidate_ids?: string[]; p_criteria: Json; p_org_id: string }
        Returns: string[]
      }
      smart_list_preview_count: {
        Args: { p_criteria: Json; p_org_id: string }
        Returns: number
      }
      smart_segment_group_to_sql: {
        Args: { p_depth?: number; p_group: Json }
        Returns: string
      }
      smart_segment_rule_to_sql: { Args: { p_rule: Json }; Returns: string }
      resume_due_ooo_email_enrollments: { Args: never; Returns: number }
      stop_sequence_enrollments: {
        Args: {
          p_lead_ids?: string[]
          p_reason?: string
          p_sequence_id: string
        }
        Returns: number
      }
      strip_html_to_text: { Args: { html: string }; Returns: string }
      suggest_inbox_warmup_keywords: {
        Args: {
          p_days?: number
          p_limit?: number
          p_min_senders?: number
          p_org_id: string
        }
        Returns: {
          already_excluded: boolean
          keyword: string
          message_count: number
          sender_count: number
        }[]
      }
      sync_autopilot_pool_from_tags: {
        Args: { p_autopilot_id: string }
        Returns: Json
      }
      sync_job_progress: { Args: { p_job_id: string }; Returns: undefined }
      sync_linkedin_connection_to_crm: {
        Args: {
          p_account_id: string
          p_company: string
          p_connected_at: string
          p_first_name: string
          p_full_name: string
          p_headline: string
          p_job_title: string
          p_last_name: string
          p_linkedin_id: string
          p_linkedin_url: string
          p_location: string
          p_organization_id: string
          p_profile_picture_url: string
          p_raw_data?: Json
        }
        Returns: {
          action: string
          contact_id: string
        }[]
      }
      sync_signal_crm_contacts_to_public_people: {
        Args: { p_lookback?: string }
        Returns: number
      }
      toggle_conversation_favorite: {
        Args: { p_conversation_id: string; p_is_favorite?: boolean }
        Returns: boolean
      }
      try_claim_mailtester_job: {
        Args: { p_job_id: string; p_lease_seconds: number; p_token: string }
        Returns: boolean
      }
      try_increment_enrichment_daily_usage: {
        Args: {
          p_daily_cap: number
          p_organization_id: string
          p_provider: string
        }
        Returns: boolean
      }
      unsnooze_expired_conversations: { Args: never; Returns: number }
      update_batch_progress: {
        Args: {
          p_batch_id: string
          p_completed: number
          p_failed?: number
          p_total: number
          p_total_posts?: number
        }
        Returns: Json
      }
      update_clip_video: {
        Args: {
          p_completed_at: string
          p_metrics: Json
          p_output_id: string
          p_scene_number: number
          p_stage_id: string
          p_status: string
          p_video_url: string
        }
        Returns: undefined
      }
      update_conversation_on_message: {
        Args: {
          p_conversation_id: string
          p_direction?: string
          p_last_message_preview: string
          p_organization_id: string
        }
        Returns: undefined
      }
      update_last_used_identity: {
        Args: { p_identity_id: string; p_user_id: string }
        Returns: undefined
      }
      update_scene_image: {
        Args: {
          p_completed_at: string
          p_image_url: string
          p_metrics: Json
          p_output_id: string
          p_scene_number: number
          p_stage_id: string
          p_status: string
        }
        Returns: undefined
      }
      update_schedule_after_run: {
        Args: { error_msg?: string; schedule_uuid: string; success: boolean }
        Returns: undefined
      }
      update_script_duration: {
        Args: { script_uuid: string }
        Returns: undefined
      }
      update_search_schedule_after_run: {
        Args: { error_msg?: string; schedule_uuid: string; success: boolean }
        Returns: undefined
      }
      upsert_enrollment_with_cycle: {
        Args: {
          p_custom_data?: Json
          p_lead_id: string
          p_mailbox_id?: string
          p_next_send_at?: string
          p_organization_id: string
          p_sequence_id: string
        }
        Returns: {
          cycle_number: number
          enrollment_id: string
          is_reenrollment: boolean
        }[]
      }
      upsert_verified_person: { Args: { p: Json }; Returns: string }
      user_organization_id: { Args: never; Returns: string }
      user_organizations: { Args: never; Returns: string[] }
      validate_api_token: {
        Args: { p_token_hash: string }
        Returns: {
          organization_id: string
          scopes: string[]
          token_id: string
          user_id: string
        }[]
      }
      wake_event_snoozed_conversations: { Args: never; Returns: number }
      warmup_today_counts: {
        Args: { p_mailbox_ids?: string[] }
        Returns: {
          delivered_in: number
          mailbox_id: string
          received_today: number
          replies_today: number
          sent_today: number
        }[]
      }
      webhook_subscription_matches: {
        Args: { p_event_data: Json; p_event_type: string; p_filters: Json }
        Returns: boolean
      }
    }
    Enums: {
      crm_account_stage: "prospect" | "active" | "customer" | "lost"
      crm_channel_type:
        | "email"
        | "linkedin_invitation"
        | "linkedin_message"
        | "linkedin_comment"
        | "instagram_dm"
        | "twitter_dm"
        | "sms"
        | "whatsapp"
        | "linkedin_profile_view"
        | "linkedin_follow"
        | "linkedin_post_like"
        | "linkedin_inmail"
      limit_zone: "safe" | "moderate" | "faster" | "risky"
      signup_request_status: "pending" | "approved" | "rejected" | "processing"
      warmup_status: "not_started" | "in_progress" | "paused" | "completed"
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
    Enums: {
      crm_account_stage: ["prospect", "active", "customer", "lost"],
      crm_channel_type: [
        "email",
        "linkedin_invitation",
        "linkedin_message",
        "linkedin_comment",
        "instagram_dm",
        "twitter_dm",
        "sms",
        "whatsapp",
        "linkedin_profile_view",
        "linkedin_follow",
        "linkedin_post_like",
        "linkedin_inmail",
      ],
      limit_zone: ["safe", "moderate", "faster", "risky"],
      signup_request_status: ["pending", "approved", "rejected", "processing"],
      warmup_status: ["not_started", "in_progress", "paused", "completed"],
    },
  },
} as const
