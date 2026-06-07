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
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          commission_earned: number
          commission_rate: number
          created_at: string
          id: string
          library_id: string
          paid_at: string | null
          status: string
          subscription_payment_id: string | null
          user_id: string
        }
        Insert: {
          affiliate_id: string
          commission_earned: number
          commission_rate: number
          created_at?: string
          id?: string
          library_id: string
          paid_at?: string | null
          status?: string
          subscription_payment_id?: string | null
          user_id: string
        }
        Update: {
          affiliate_id?: string
          commission_earned?: number
          commission_rate?: number
          created_at?: string
          id?: string
          library_id?: string
          paid_at?: string | null
          status?: string
          subscription_payment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
          {
            foreignKeyName: "affiliate_commissions_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: true
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          bank_details: Json
          city: string | null
          code: string
          commission_rate: number
          created_at: string
          email: string
          experience: string | null
          id: string
          is_active: boolean
          name: string
          payout_method: string | null
          phone: string | null
          total_commission: number
          total_sales: number
          updated_at: string
          upi_id: string | null
          user_id: string | null
        }
        Insert: {
          bank_details?: Json
          city?: string | null
          code?: string
          commission_rate?: number
          created_at?: string
          email: string
          experience?: string | null
          id?: string
          is_active?: boolean
          name: string
          payout_method?: string | null
          phone?: string | null
          total_commission?: number
          total_sales?: number
          updated_at?: string
          upi_id?: string | null
          user_id?: string | null
        }
        Update: {
          bank_details?: Json
          city?: string | null
          code?: string
          commission_rate?: number
          created_at?: string
          email?: string
          experience?: string | null
          id?: string
          is_active?: boolean
          name?: string
          payout_method?: string | null
          phone?: string | null
          total_commission?: number
          total_sales?: number
          updated_at?: string
          upi_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_error_logs: {
        Row: {
          created_at: string
          error_message: string
          error_type: string
          id: string
          metadata: Json
          route: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          error_type?: string
          id?: string
          metadata?: Json
          route: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          error_type?: string
          id?: string
          metadata?: Json
          route?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_event_logs: {
        Row: {
          classification: string | null
          created_at: string
          entity_id: string | null
          event_type: string
          fingerprint: string | null
          group_key: string | null
          id: string
          message: string | null
          metadata: Json
          metric_key: string | null
          occurred_at: string
          occurrence_count: number
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          user_identifier: string | null
        }
        Insert: {
          classification?: string | null
          created_at?: string
          entity_id?: string | null
          event_type: string
          fingerprint?: string | null
          group_key?: string | null
          id?: string
          message?: string | null
          metadata?: Json
          metric_key?: string | null
          occurred_at?: string
          occurrence_count?: number
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status: string
          user_identifier?: string | null
        }
        Update: {
          classification?: string | null
          created_at?: string
          entity_id?: string | null
          event_type?: string
          fingerprint?: string | null
          group_key?: string | null
          id?: string
          message?: string | null
          metadata?: Json
          metric_key?: string | null
          occurred_at?: string
          occurrence_count?: number
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          user_identifier?: string | null
        }
        Relationships: []
      }
      attendance_logs: {
        Row: {
          check_in: string
          check_out: string | null
          created_at: string
          date: string
          device_id: string | null
          entry_id: string | null
          id: string
          library_id: string
          student_id: string
        }
        Insert: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          date?: string
          device_id?: string | null
          entry_id?: string | null
          id?: string
          library_id: string
          student_id: string
        }
        Update: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          date?: string
          device_id?: string | null
          entry_id?: string | null
          id?: string
          library_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "attendance_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_trusted_devices: {
        Row: {
          auth_level: number
          created_at: string
          delivery_channel: string | null
          device_fingerprint_hash: string | null
          device_label: string | null
          expires_at: string
          id: string
          idle_timeout_seconds: number | null
          last_ip: string | null
          last_used_at: string
          login_method: string
          phone_number: string | null
          refresh_token_hash: string
          revocation_reason: string | null
          revoked_at: string | null
          session_scope: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_level?: number
          created_at?: string
          delivery_channel?: string | null
          device_fingerprint_hash?: string | null
          device_label?: string | null
          expires_at: string
          id?: string
          idle_timeout_seconds?: number | null
          last_ip?: string | null
          last_used_at?: string
          login_method: string
          phone_number?: string | null
          refresh_token_hash: string
          revocation_reason?: string | null
          revoked_at?: string | null
          session_scope?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_level?: number
          created_at?: string
          delivery_channel?: string | null
          device_fingerprint_hash?: string | null
          device_label?: string | null
          expires_at?: string
          id?: string
          idle_timeout_seconds?: number | null
          last_ip?: string | null
          last_used_at?: string
          login_method?: string
          phone_number?: string | null
          refresh_token_hash?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          session_scope?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      automated_calls: {
        Row: {
          answered_at: string | null
          audio_bucket: string | null
          audio_path: string | null
          call_provider: string
          call_status: string
          called_phone: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          estimated_recovery_impact: number
          id: string
          ivr_action: string | null
          ivr_choice: string | null
          library_id: string
          library_name_snapshot: string
          metadata: Json
          overdue_days_snapshot: number
          payment_status_snapshot: string
          pending_amount_snapshot: number
          pickup_status: string
          provider_call_sid: string | null
          recovery_stage_label: string | null
          script_text: string
          status_callback_payload: Json
          student_id: string | null
          student_name_snapshot: string
          trigger_source: string
          tts_provider: string
          twiml_requested_at: string | null
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          audio_bucket?: string | null
          audio_path?: string | null
          call_provider?: string
          call_status?: string
          called_phone?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          estimated_recovery_impact?: number
          id?: string
          ivr_action?: string | null
          ivr_choice?: string | null
          library_id: string
          library_name_snapshot: string
          metadata?: Json
          overdue_days_snapshot?: number
          payment_status_snapshot?: string
          pending_amount_snapshot?: number
          pickup_status?: string
          provider_call_sid?: string | null
          recovery_stage_label?: string | null
          script_text: string
          status_callback_payload?: Json
          student_id?: string | null
          student_name_snapshot: string
          trigger_source?: string
          tts_provider?: string
          twiml_requested_at?: string | null
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          audio_bucket?: string | null
          audio_path?: string | null
          call_provider?: string
          call_status?: string
          called_phone?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          estimated_recovery_impact?: number
          id?: string
          ivr_action?: string | null
          ivr_choice?: string | null
          library_id?: string
          library_name_snapshot?: string
          metadata?: Json
          overdue_days_snapshot?: number
          payment_status_snapshot?: string
          pending_amount_snapshot?: number
          pickup_status?: string
          provider_call_sid?: string | null
          recovery_stage_label?: string | null
          script_text?: string
          status_callback_payload?: Json
          student_id?: string | null
          student_name_snapshot?: string
          trigger_source?: string
          tts_provider?: string
          twiml_requested_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automated_calls_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_calls_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "automated_calls_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_refunds: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string | null
          initiated_by: string | null
          invoice_id: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          library_id: string
          metadata: Json
          payment_id: string | null
          processed_at: string | null
          processed_by: string | null
          provider: string
          provider_order_id: string | null
          provider_payment_id: string | null
          provider_receipt: string | null
          provider_refund_id: string | null
          provider_status: string | null
          reason: string
          refund_kind: string
          status: string
          subscription_payment_id: string | null
          sync_attempts: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          invoice_id?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          library_id: string
          metadata?: Json
          payment_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_receipt?: string | null
          provider_refund_id?: string | null
          provider_status?: string | null
          reason: string
          refund_kind?: string
          status?: string
          subscription_payment_id?: string | null
          sync_attempts?: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          invoice_id?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          library_id?: string
          metadata?: Json
          payment_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_receipt?: string | null
          provider_refund_id?: string | null
          provider_status?: string | null
          reason?: string
          refund_kind?: string
          status?: string
          subscription_payment_id?: string | null
          sync_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "platform_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refunds_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refunds_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          is_active: boolean
          key: string
          name: string
          subject: string | null
          updated_at: string
          updated_by: string | null
          variables: Json
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          subject?: string | null
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          subject?: string | null
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          captured_at: string | null
          code: string
          coupon_id: string
          created_at: string
          discount_amount: number
          id: string
          library_id: string
          razorpay_order_id: string
          status: string
          subscription_payment_id: string | null
          user_id: string
        }
        Insert: {
          captured_at?: string | null
          code: string
          coupon_id: string
          created_at?: string
          discount_amount?: number
          id?: string
          library_id: string
          razorpay_order_id: string
          status?: string
          subscription_payment_id?: string | null
          user_id: string
        }
        Update: {
          captured_at?: string | null
          code?: string
          coupon_id?: string
          created_at?: string
          discount_amount?: number
          id?: string
          library_id?: string
          razorpay_order_id?: string
          status?: string
          subscription_payment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "admin_coupon_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          discount_type: string
          discount_value: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      device_commands: {
        Row: {
          acknowledged_at: string | null
          command_type: string
          completed_at: string | null
          device_id: string
          error_message: string | null
          failed_at: string | null
          id: string
          library_id: string
          metadata: Json
          payload: Json
          requested_at: string
          requested_by: string | null
          requested_by_role: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          command_type: string
          completed_at?: string | null
          device_id: string
          error_message?: string | null
          failed_at?: string | null
          id?: string
          library_id: string
          metadata?: Json
          payload?: Json
          requested_at?: string
          requested_by?: string | null
          requested_by_role?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          command_type?: string
          completed_at?: string | null
          device_id?: string
          error_message?: string | null
          failed_at?: string | null
          id?: string
          library_id?: string
          metadata?: Json
          payload?: Json
          requested_at?: string
          requested_by?: string | null
          requested_by_role?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "entry_devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_commands_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      device_setup_attempts: {
        Row: {
          attempt_count: number
          created_at: string
          device_id: string
          first_failed_at: string | null
          last_access_key_suffix: string | null
          last_failed_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          device_id: string
          first_failed_at?: string | null
          last_access_key_suffix?: string | null
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          device_id?: string
          first_failed_at?: string | null
          last_access_key_suffix?: string | null
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      domain_requests: {
        Row: {
          created_at: string
          domain: string
          id: string
          library_id: string
          requested_at: string
          review_note: string | null
          reviewed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          library_id: string
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          library_id?: string
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_requests_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_devices: {
        Row: {
          created_at: string
          device_id: string
          device_name: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          library_id: string
          metadata: Json
          secret_token_hash: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          library_id: string
          metadata?: Json
          secret_token_hash?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          library_id?: string
          metadata?: Json
          secret_token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_devices_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          id: string
          library_id: string
          notes: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          date?: string
          id?: string
          library_id: string
          notes?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          id?: string
          library_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          cache_ttl_seconds: number
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          key: string
          name: string
          rollout_percentage: number
          updated_at: string
          updated_by: string | null
          variants: Json
        }
        Insert: {
          cache_ttl_seconds?: number
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key: string
          name: string
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
          variants?: Json
        }
        Update: {
          cache_ttl_seconds?: number
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key?: string
          name?: string
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
          variants?: Json
        }
        Relationships: []
      }
      id_card_delivery_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_delivery_channel: string | null
          last_error: string | null
          last_file_bucket: string | null
          last_file_path: string | null
          last_provider_message_id: string | null
          last_provider_name: string | null
          library_id: string
          max_attempts: number
          next_retry_at: string
          processing_started_at: string | null
          queued_at: string
          requested_format: string
          sent_at: string | null
          source: string
          status: string
          student_id: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_delivery_channel?: string | null
          last_error?: string | null
          last_file_bucket?: string | null
          last_file_path?: string | null
          last_provider_message_id?: string | null
          last_provider_name?: string | null
          library_id: string
          max_attempts?: number
          next_retry_at?: string
          processing_started_at?: string | null
          queued_at?: string
          requested_format?: string
          sent_at?: string | null
          source?: string
          status?: string
          student_id: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_delivery_channel?: string | null
          last_error?: string | null
          last_file_bucket?: string | null
          last_file_path?: string | null
          last_provider_message_id?: string | null
          last_provider_name?: string | null
          library_id?: string
          max_attempts?: number
          next_retry_at?: string
          processing_started_at?: string | null
          queued_at?: string
          requested_format?: string
          sent_at?: string | null
          source?: string
          status?: string
          student_id?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "id_card_delivery_jobs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "id_card_delivery_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "id_card_delivery_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      id_card_delivery_logs: {
        Row: {
          attempt_number: number
          created_at: string
          delivery_channel: string | null
          error_message: string | null
          file_bucket: string | null
          file_path: string | null
          id: string
          job_id: string
          library_id: string
          metadata: Json
          provider_message_id: string | null
          provider_name: string | null
          sent_at: string | null
          status: string
          student_id: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          file_bucket?: string | null
          file_path?: string | null
          id?: string
          job_id: string
          library_id: string
          metadata?: Json
          provider_message_id?: string | null
          provider_name?: string | null
          sent_at?: string | null
          status: string
          student_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          file_bucket?: string | null
          file_path?: string | null
          id?: string
          job_id?: string
          library_id?: string
          metadata?: Json
          provider_message_id?: string | null
          provider_name?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "id_card_delivery_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "id_card_delivery_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "id_card_delivery_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "id_card_delivery_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "id_card_delivery_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          auto_whatsapp_sent: boolean
          city: string | null
          converted_at: string | null
          created_at: string
          demo_scheduled_at: string | null
          expected_value: number | null
          id: string
          last_contacted_at: string | null
          library_id: string | null
          library_name: string
          next_followup_at: string | null
          notes: string | null
          owner_name: string
          partner_id: string
          phone: string
          seats: number | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          whatsapp_opt_in: boolean
        }
        Insert: {
          auto_whatsapp_sent?: boolean
          city?: string | null
          converted_at?: string | null
          created_at?: string
          demo_scheduled_at?: string | null
          expected_value?: number | null
          id?: string
          last_contacted_at?: string | null
          library_id?: string | null
          library_name: string
          next_followup_at?: string | null
          notes?: string | null
          owner_name: string
          partner_id: string
          phone: string
          seats?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Update: {
          auto_whatsapp_sent?: boolean
          city?: string | null
          converted_at?: string | null
          created_at?: string
          demo_scheduled_at?: string | null
          expected_value?: number | null
          id?: string
          last_contacted_at?: string | null
          library_id?: string | null
          library_name?: string
          next_followup_at?: string | null
          notes?: string | null
          owner_name?: string
          partner_id?: string
          phone?: string
          seats?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "leads_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "leads_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      libraries: {
        Row: {
          about_text: string | null
          active_students: number
          address: string | null
          city: string | null
          country: string
          created_at: string
          cta_background_color: string | null
          cta_background_image_url: string | null
          cta_background_type: string
          cta_button_color: string | null
          cta_button_text_color: string | null
          cta_gradient_from: string | null
          cta_gradient_to: string | null
          cta_subtitle: string | null
          cta_subtitle_color: string | null
          cta_text_color: string | null
          cta_title: string | null
          cta_title_color: string | null
          custom_domain: string | null
          district: string | null
          enabled: boolean
          header_background_color: string | null
          header_background_type: string
          header_background_url: string | null
          header_overlay_opacity: number
          header_text_color: string | null
          hero_background_url: string | null
          hero_overlay_color: string | null
          hero_overlay_disabled: boolean
          hero_overlay_opacity: number
          hero_subtitle: string | null
          hero_subtitle_color: string | null
          hero_title: string | null
          hero_title_color: string | null
          id: string
          library_name: string | null
          logo_url: string | null
          max_lockers: number
          max_seats: number
          monthly_revenue: number
          name: string
          opening_hours: string | null
          owner_id: string
          owner_name: string | null
          phone: string | null
          primary_color: string | null
          section_heading_color: string | null
          slug: string | null
          state: string | null
          total_lockers: number
          total_seats: number
          updated_at: string
          upi_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          about_text?: string | null
          active_students?: number
          address?: string | null
          city?: string | null
          country?: string
          created_at?: string
          cta_background_color?: string | null
          cta_background_image_url?: string | null
          cta_background_type?: string
          cta_button_color?: string | null
          cta_button_text_color?: string | null
          cta_gradient_from?: string | null
          cta_gradient_to?: string | null
          cta_subtitle?: string | null
          cta_subtitle_color?: string | null
          cta_text_color?: string | null
          cta_title?: string | null
          cta_title_color?: string | null
          custom_domain?: string | null
          district?: string | null
          enabled?: boolean
          header_background_color?: string | null
          header_background_type?: string
          header_background_url?: string | null
          header_overlay_opacity?: number
          header_text_color?: string | null
          hero_background_url?: string | null
          hero_overlay_color?: string | null
          hero_overlay_disabled?: boolean
          hero_overlay_opacity?: number
          hero_subtitle?: string | null
          hero_subtitle_color?: string | null
          hero_title?: string | null
          hero_title_color?: string | null
          id?: string
          library_name?: string | null
          logo_url?: string | null
          max_lockers?: number
          max_seats?: number
          monthly_revenue?: number
          name: string
          opening_hours?: string | null
          owner_id: string
          owner_name?: string | null
          phone?: string | null
          primary_color?: string | null
          section_heading_color?: string | null
          slug?: string | null
          state?: string | null
          total_lockers?: number
          total_seats?: number
          updated_at?: string
          upi_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          about_text?: string | null
          active_students?: number
          address?: string | null
          city?: string | null
          country?: string
          created_at?: string
          cta_background_color?: string | null
          cta_background_image_url?: string | null
          cta_background_type?: string
          cta_button_color?: string | null
          cta_button_text_color?: string | null
          cta_gradient_from?: string | null
          cta_gradient_to?: string | null
          cta_subtitle?: string | null
          cta_subtitle_color?: string | null
          cta_text_color?: string | null
          cta_title?: string | null
          cta_title_color?: string | null
          custom_domain?: string | null
          district?: string | null
          enabled?: boolean
          header_background_color?: string | null
          header_background_type?: string
          header_background_url?: string | null
          header_overlay_opacity?: number
          header_text_color?: string | null
          hero_background_url?: string | null
          hero_overlay_color?: string | null
          hero_overlay_disabled?: boolean
          hero_overlay_opacity?: number
          hero_subtitle?: string | null
          hero_subtitle_color?: string | null
          hero_title?: string | null
          hero_title_color?: string | null
          id?: string
          library_name?: string | null
          logo_url?: string | null
          max_lockers?: number
          max_seats?: number
          monthly_revenue?: number
          name?: string
          opening_hours?: string | null
          owner_id?: string
          owner_name?: string | null
          phone?: string | null
          primary_color?: string | null
          section_heading_color?: string | null
          slug?: string | null
          state?: string | null
          total_lockers?: number
          total_seats?: number
          updated_at?: string
          upi_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      library_access_keys: {
        Row: {
          access_key: string
          created_at: string
          library_id: string
          rotated_at: string
          updated_at: string
        }
        Insert: {
          access_key: string
          created_at?: string
          library_id: string
          rotated_at?: string
          updated_at?: string
        }
        Update: {
          access_key?: string
          created_at?: string
          library_id?: string
          rotated_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_access_keys_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_acquisition: {
        Row: {
          affiliate_id: string | null
          created_at: string
          library_id: string
          owner_id: string
          referral_code: string | null
          referred_by: string | null
        }
        Insert: {
          affiliate_id?: string | null
          created_at?: string
          library_id: string
          owner_id: string
          referral_code?: string | null
          referred_by?: string | null
        }
        Update: {
          affiliate_id?: string | null
          created_at?: string
          library_id?: string
          owner_id?: string
          referral_code?: string | null
          referred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_acquisition_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "library_acquisition_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_acquisition_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
          {
            foreignKeyName: "library_acquisition_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_commission_overrides: {
        Row: {
          commission_percent: number
          created_at: string
          id: string
          library_id: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          commission_percent: number
          created_at?: string
          id?: string
          library_id: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          commission_percent?: number
          created_at?: string
          id?: string
          library_id?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_commission_overrides_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_control_overrides: {
        Row: {
          created_at: string
          id: string
          library_id: string
          metadata: Json
          reason: string | null
          status: string
          until_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          library_id: string
          metadata?: Json
          reason?: string | null
          status?: string
          until_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          library_id?: string
          metadata?: Json
          reason?: string | null
          status?: string
          until_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_control_overrides_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_gallery_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          library_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          library_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          library_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_gallery_images_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_payout_queue: {
        Row: {
          amount: number
          approved_at: string | null
          currency: string
          id: string
          library_id: string
          metadata: Json
          note: string | null
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          requested_by: string | null
          status: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          currency?: string
          id?: string
          library_id: string
          metadata?: Json
          note?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          currency?: string
          id?: string
          library_id?: string
          metadata?: Json
          note?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_payout_queue_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_reviews: {
        Row: {
          created_at: string
          id: string
          is_published: boolean
          library_id: string
          rating: number
          review_text: string
          reviewer_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_published?: boolean
          library_id: string
          rating?: number
          review_text: string
          reviewer_name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_published?: boolean
          library_id?: string
          rating?: number
          review_text?: string
          reviewer_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_reviews_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      library_subscriptions: {
        Row: {
          ai_call_enabled: boolean
          created_at: string
          expires_at: string | null
          features: Json
          id: string
          library_id: string
          lockers_limit: number | null
          payment_status: string
          plan_expiry_date: string | null
          plan_name: string
          plan_price: number | null
          plan_start_date: string | null
          plan_type: string
          price: number
          seats_limit: number
          started_at: string
          status: string
          trial_end_date: string | null
          trial_start_date: string | null
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          ai_call_enabled?: boolean
          created_at?: string
          expires_at?: string | null
          features?: Json
          id?: string
          library_id: string
          lockers_limit?: number | null
          payment_status?: string
          plan_expiry_date?: string | null
          plan_name?: string
          plan_price?: number | null
          plan_start_date?: string | null
          plan_type?: string
          price?: number
          seats_limit?: number
          started_at?: string
          status?: string
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          ai_call_enabled?: boolean
          created_at?: string
          expires_at?: string | null
          features?: Json
          id?: string
          library_id?: string
          lockers_limit?: number | null
          payment_status?: string
          plan_expiry_date?: string | null
          plan_name?: string
          plan_price?: number | null
          plan_start_date?: string | null
          plan_type?: string
          price?: number
          seats_limit?: number
          started_at?: string
          status?: string
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "library_subscriptions_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      lockers: {
        Row: {
          col_position: number | null
          column: number
          created_at: string
          id: string
          library_id: string
          locker_number: string
          monthly_price: number
          payment_due_date: string | null
          row: number
          row_position: number | null
          status: string
          student_id: string | null
          updated_at: string
        }
        Insert: {
          col_position?: number | null
          column: number
          created_at?: string
          id?: string
          library_id: string
          locker_number: string
          monthly_price?: number
          payment_due_date?: string | null
          row: number
          row_position?: number | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          col_position?: number | null
          column?: number
          created_at?: string
          id?: string
          library_id?: string
          locker_number?: string
          monthly_price?: number
          payment_due_date?: string | null
          row?: number
          row_position?: number | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lockers_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lockers_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "lockers_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      login_logs: {
        Row: {
          channel: string | null
          device: string | null
          email: string | null
          id: string
          ip_address: string | null
          login_step: string
          login_time: string
          reason: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          channel?: string | null
          device?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          login_step: string
          login_time?: string
          reason?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          channel?: string | null
          device?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          login_step?: string
          login_time?: string
          reason?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          category: Database["public"]["Enums"]["notification_category"] | null
          channel: string | null
          created_at: string
          delivery_status: string
          id: string
          is_read: boolean
          library_id: string
          message: string | null
          metadata: Json
          provider_error: string | null
          provider_message_id: string | null
          provider_name: string | null
          recipient_phone: string | null
          role: Database["public"]["Enums"]["notification_role"] | null
          sent_at: string | null
          student_id: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["notification_category"] | null
          channel?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          is_read?: boolean
          library_id: string
          message?: string | null
          metadata?: Json
          provider_error?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          recipient_phone?: string | null
          role?: Database["public"]["Enums"]["notification_role"] | null
          sent_at?: string | null
          student_id?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["notification_category"] | null
          channel?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          is_read?: boolean
          library_id?: string
          message?: string | null
          metadata?: Json
          provider_error?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          recipient_phone?: string | null
          role?: Database["public"]["Enums"]["notification_role"] | null
          sent_at?: string | null
          student_id?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_lead_activity: {
        Row: {
          action_type: string
          created_at: string
          id: string
          lead_id: string
          metadata: Json
          partner_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          lead_id: string
          metadata?: Json
          partner_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          lead_id?: string
          metadata?: Json
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_lead_activity_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_lead_activity_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "partner_lead_activity_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_lead_activity_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      partner_lead_notes: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          note: string
          partner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          note: string
          partner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          note?: string
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_lead_notes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "partner_lead_notes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_lead_notes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      partner_notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          metadata: Json
          partner_id: string
          read: boolean
          scheduled_at: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          partner_id: string
          read?: boolean
          scheduled_at?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          partner_id?: string
          read?: boolean
          scheduled_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_notifications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "partner_notifications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_notifications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      partner_referral_clicks: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          partner_id: string | null
          referral_code: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          partner_id?: string | null
          referral_code: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          partner_id?: string | null
          referral_code?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_referral_clicks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "partner_referral_clicks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referral_clicks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          library_id: string
          payment_method: string | null
          payment_screenshot: string | null
          period_end: string | null
          period_start: string | null
          plan: string | null
          seat_id: string | null
          source: string
          status: string
          student_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          library_id: string
          payment_method?: string | null
          payment_screenshot?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string | null
          seat_id?: string | null
          source?: string
          status?: string
          student_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          library_id?: string
          payment_method?: string | null
          payment_screenshot?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string | null
          seat_id?: string | null
          source?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          approved_at: string | null
          created_at: string
          id: string
          note: string | null
          paid_at: string | null
          partner_id: string
          payout_destination: string | null
          payout_method: string | null
          requested_at: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          paid_at?: string | null
          partner_id: string
          payout_destination?: string | null
          payout_method?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          created_at?: string
          id?: string
          note?: string | null
          paid_at?: string | null
          partner_id?: string
          payout_destination?: string | null
          payout_method?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
        ]
      }
      photo_upload_logs: {
        Row: {
          error_message: string | null
          final_original_path: string | null
          final_thumbnail_path: string | null
          id: string
          library_id: string
          status: string
          student_id: string
          temp_original_path: string | null
          temp_thumbnail_path: string | null
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          error_message?: string | null
          final_original_path?: string | null
          final_thumbnail_path?: string | null
          id?: string
          library_id: string
          status: string
          student_id: string
          temp_original_path?: string | null
          temp_thumbnail_path?: string | null
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          error_message?: string | null
          final_original_path?: string | null
          final_thumbnail_path?: string | null
          id?: string
          library_id?: string
          status?: string
          student_id?: string
          temp_original_path?: string | null
          temp_thumbnail_path?: string | null
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_upload_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_upload_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "photo_upload_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          description: string | null
          duration_hours: number
          id: string
          is_active: boolean
          library_id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_hours: number
          id?: string
          is_active?: boolean
          library_id: string
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_hours?: number
          id?: string
          is_active?: boolean
          library_id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_account_controls: {
        Row: {
          clear_sessions_after: string | null
          created_at: string
          id: string
          library_id: string | null
          metadata: Json
          password_reset_required: boolean
          reason: string | null
          status: string
          until_at: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          clear_sessions_after?: string | null
          created_at?: string
          id?: string
          library_id?: string | null
          metadata?: Json
          password_reset_required?: boolean
          reason?: string | null
          status?: string
          until_at?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          clear_sessions_after?: string | null
          created_at?: string
          id?: string
          library_id?: string | null
          metadata?: Json
          password_reset_required?: boolean
          reason?: string | null
          status?: string
          until_at?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_account_controls_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_activity_logs: {
        Row: {
          activity_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          library_id: string | null
          message: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          activity_type: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          library_id?: string | null
          message: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          library_id?: string | null
          message?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_activity_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_broadcasts: {
        Row: {
          audience: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          message: string
          metadata: Json
          sent_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          metadata?: Json
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          metadata?: Json
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_broadcasts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_invoices: {
        Row: {
          currency: string
          generated_by: string | null
          id: string
          invoice_number: string
          invoice_type: string
          issued_at: string
          library_id: string
          metadata: Json
          pdf_path: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subtotal: number
          tax_amount: number
          total_amount: number
        }
        Insert: {
          currency?: string
          generated_by?: string | null
          id?: string
          invoice_number: string
          invoice_type?: string
          issued_at?: string
          library_id: string
          metadata?: Json
          pdf_path?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
        }
        Update: {
          currency?: string
          generated_by?: string | null
          id?: string
          invoice_number?: string
          invoice_type?: string
          issued_at?: string
          library_id?: string
          metadata?: Json
          pdf_path?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_invoices_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_job_dead_letters: {
        Row: {
          attempts: number
          created_at: string
          dead_lettered_at: string
          error_message: string | null
          id: string
          job_id: string
          job_payload: Json
          job_type: string
          max_attempts: number
          source_correlation_id: string | null
          source_request_id: string | null
          source_trace_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_lettered_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          job_payload?: Json
          job_type: string
          max_attempts?: number
          source_correlation_id?: string | null
          source_request_id?: string | null
          source_trace_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_lettered_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          job_payload?: Json
          job_type?: string
          max_attempts?: number
          source_correlation_id?: string | null
          source_request_id?: string | null
          source_trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_job_dead_letters_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "platform_job_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_job_queue: {
        Row: {
          attempts: number
          cancel_requested_at: string | null
          cancel_requested_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          claim_token: string | null
          claimed_by: string | null
          concurrency_key: string | null
          created_at: string
          created_by: string | null
          dead_lettered_at: string | null
          deduplication_key: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          last_heartbeat_at: string | null
          max_attempts: number
          max_concurrency: number
          payload: Json
          recovered_at: string | null
          scheduled_for: string
          source_correlation_id: string | null
          source_request_id: string | null
          source_trace_id: string | null
          started_at: string | null
          status: string
          updated_at: string
          visibility_timeout_at: string | null
        }
        Insert: {
          attempts?: number
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          claim_token?: string | null
          claimed_by?: string | null
          concurrency_key?: string | null
          created_at?: string
          created_by?: string | null
          dead_lettered_at?: string | null
          deduplication_key?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          max_attempts?: number
          max_concurrency?: number
          payload?: Json
          recovered_at?: string | null
          scheduled_for?: string
          source_correlation_id?: string | null
          source_request_id?: string | null
          source_trace_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          visibility_timeout_at?: string | null
        }
        Update: {
          attempts?: number
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          claim_token?: string | null
          claimed_by?: string | null
          concurrency_key?: string | null
          created_at?: string
          created_by?: string | null
          dead_lettered_at?: string | null
          deduplication_key?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          max_attempts?: number
          max_concurrency?: number
          payload?: Json
          recovered_at?: string | null
          scheduled_for?: string
          source_correlation_id?: string | null
          source_request_id?: string | null
          source_trace_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          visibility_timeout_at?: string | null
        }
        Relationships: []
      }
      platform_metric_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          metric_breakdown: Json
          metric_key: string
          metric_value: number
          metric_window: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          metric_breakdown?: Json
          metric_key: string
          metric_value: number
          metric_window: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          metric_breakdown?: Json
          metric_key?: string
          metric_value?: number
          metric_window?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_phone_verified: boolean
          phone_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_phone_verified?: boolean
          phone_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_phone_verified?: boolean
          phone_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          amount: number
          created_at: string
          id: string
          library_id: string
          paid_at: string | null
          referred_user_id: string
          referrer_user_id: string
          status: string
          subscription_payment_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          library_id: string
          paid_at?: string | null
          referred_user_id: string
          referrer_user_id: string
          status?: string
          subscription_payment_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          library_id?: string
          paid_at?: string | null
          referred_user_id?: string
          referrer_user_id?: string
          status?: string
          subscription_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: true
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_logs: {
        Row: {
          created_at: string
          delivery_channel: string | null
          error_message: string | null
          id: string
          library_id: string
          message: string
          notification_id: string | null
          phone: string | null
          reminder_date: string
          reminder_type: string
          sent_at: string | null
          status: string
          student_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          id?: string
          library_id: string
          message: string
          notification_id?: string | null
          phone?: string | null
          reminder_date?: string
          reminder_type: string
          sent_at?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_channel?: string | null
          error_message?: string | null
          id?: string
          library_id?: string
          message?: string
          notification_id?: string | null
          phone?: string | null
          reminder_date?: string
          reminder_type?: string
          sent_at?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "reminder_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_adjustments: {
        Row: {
          amount_delta: number
          created_at: string
          created_by: string | null
          id: string
          library_id: string
          metadata: Json
          payment_id: string | null
          reason: string
          subscription_payment_id: string | null
        }
        Insert: {
          amount_delta: number
          created_at?: string
          created_by?: string | null
          id?: string
          library_id: string
          metadata?: Json
          payment_id?: string | null
          reason: string
          subscription_payment_id?: string | null
        }
        Update: {
          amount_delta?: number
          created_at?: string
          created_by?: string | null
          id?: string
          library_id?: string
          metadata?: Json
          payment_id?: string | null
          reason?: string
          subscription_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_adjustments_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_adjustments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_adjustments_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      seats: {
        Row: {
          created_at: string
          id: string
          library_id: string
          seat_index: number
          seat_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          library_id: string
          seat_index: number
          seat_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          library_id?: string
          seat_index?: number
          seat_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seats_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      student_slot_assignments: {
        Row: {
          created_at: string
          id: string
          library_id: string
          slot_id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          library_id: string
          slot_id: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          library_id?: string
          slot_id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_slot_assignments_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_slot_assignments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_slot_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "student_slot_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          aadhaar_number: string | null
          aadhaar_photo_path: string | null
          address: string | null
          created_at: string
          email: string | null
          expiry_date: string | null
          full_name: string
          gender: Database["public"]["Enums"]["student_gender"] | null
          id: string
          last_check_in: string | null
          library_id: string
          no_show_days: number
          notes: string | null
          phone: string | null
          photo_storage_path: string | null
          photo_thumbnail_path: string | null
          photo_url: string | null
          photo_version: number | null
          plan: string | null
          plan_id: string | null
          qr_code: string
          seat_id: string | null
          seat_number: string | null
          slot: string | null
          slot_id: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          aadhaar_number?: string | null
          aadhaar_photo_path?: string | null
          address?: string | null
          created_at?: string
          email?: string | null
          expiry_date?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["student_gender"] | null
          id?: string
          last_check_in?: string | null
          library_id: string
          no_show_days?: number
          notes?: string | null
          phone?: string | null
          photo_storage_path?: string | null
          photo_thumbnail_path?: string | null
          photo_url?: string | null
          photo_version?: number | null
          plan?: string | null
          plan_id?: string | null
          qr_code?: string
          seat_id?: string | null
          seat_number?: string | null
          slot?: string | null
          slot_id?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          aadhaar_number?: string | null
          aadhaar_photo_path?: string | null
          address?: string | null
          created_at?: string
          email?: string | null
          expiry_date?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["student_gender"] | null
          id?: string
          last_check_in?: string | null
          library_id?: string
          no_show_days?: number
          notes?: string | null
          phone?: string | null
          photo_storage_path?: string | null
          photo_thumbnail_path?: string | null
          photo_url?: string | null
          photo_version?: number | null
          plan?: string | null
          plan_id?: string | null
          qr_code?: string
          seat_id?: string | null
          seat_number?: string | null
          slot?: string | null
          slot_id?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          capture_correlation_id: string | null
          capture_processed_at: string | null
          capture_request_id: string | null
          capture_source: string | null
          capture_trace_id: string | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string | null
          last_processing_error: string | null
          library_id: string
          metadata: Json
          months_purchased: number
          paid_at: string | null
          razorpay_order_id: string
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          capture_correlation_id?: string | null
          capture_processed_at?: string | null
          capture_request_id?: string | null
          capture_source?: string | null
          capture_trace_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          last_processing_error?: string | null
          library_id: string
          metadata?: Json
          months_purchased?: number
          paid_at?: string | null
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          status?: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          capture_correlation_id?: string | null
          capture_processed_at?: string | null
          capture_request_id?: string | null
          capture_source?: string | null
          capture_trace_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          last_processing_error?: string | null
          library_id?: string
          metadata?: Json
          months_purchased?: number
          paid_at?: string | null
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "library_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          lockers_limit: number | null
          name: string
          price: number
          seats_limit: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          lockers_limit?: number | null
          name: string
          price: number
          seats_limit?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          lockers_limit?: number | null
          name?: string
          price?: number
          seats_limit?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      super_admin_action_tokens: {
        Row: {
          action_id: string
          actor_email: string | null
          actor_user_id: string | null
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          expires_at: string
          fingerprint: string
          id: string
          metadata: Json
          preview: Json
          target_id: string | null
          target_type: string
          token_hash: string
        }
        Insert: {
          action_id: string
          actor_email?: string | null
          actor_user_id?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at: string
          fingerprint: string
          id?: string
          metadata?: Json
          preview?: Json
          target_id?: string | null
          target_type: string
          token_hash: string
        }
        Update: {
          action_id?: string
          actor_email?: string | null
          actor_user_id?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at?: string
          fingerprint?: string
          id?: string
          metadata?: Json
          preview?: Json
          target_id?: string | null
          target_type?: string
          token_hash?: string
        }
        Relationships: []
      }
      super_admin_approval_decisions: {
        Row: {
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          decision: string
          id: string
          metadata: Json
          note: string | null
          request_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          decision: string
          id?: string
          metadata?: Json
          note?: string | null
          request_id: string
        }
        Update: {
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          decision?: string
          id?: string
          metadata?: Json
          note?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "super_admin_approval_decisions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "super_admin_approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_approval_requests: {
        Row: {
          action_id: string
          approved_at: string | null
          cooldown_until: string | null
          created_at: string
          escalation_after: string | null
          executed_at: string | null
          expires_at: string
          fingerprint: string
          id: string
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          metadata: Json
          optional_second_approver: boolean
          policy: Json
          preview: Json
          reason: string | null
          rejected_at: string | null
          requester_email: string | null
          requester_user_id: string | null
          required_approvals: number
          status: string
          target_display: string | null
          target_id: string | null
          target_type: string
          token_hash: string | null
          updated_at: string
        }
        Insert: {
          action_id: string
          approved_at?: string | null
          cooldown_until?: string | null
          created_at?: string
          escalation_after?: string | null
          executed_at?: string | null
          expires_at?: string
          fingerprint: string
          id?: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          metadata?: Json
          optional_second_approver?: boolean
          policy?: Json
          preview?: Json
          reason?: string | null
          rejected_at?: string | null
          requester_email?: string | null
          requester_user_id?: string | null
          required_approvals?: number
          status?: string
          target_display?: string | null
          target_id?: string | null
          target_type: string
          token_hash?: string | null
          updated_at?: string
        }
        Update: {
          action_id?: string
          approved_at?: string | null
          cooldown_until?: string | null
          created_at?: string
          escalation_after?: string | null
          executed_at?: string | null
          expires_at?: string
          fingerprint?: string
          id?: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          metadata?: Json
          optional_second_approver?: boolean
          policy?: Json
          preview?: Json
          reason?: string | null
          rejected_at?: string | null
          requester_email?: string | null
          requester_user_id?: string | null
          required_approvals?: number
          status?: string
          target_display?: string | null
          target_id?: string | null
          target_type?: string
          token_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      super_admin_audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          request_id: string | null
          target_display: string | null
          target_id: string | null
          target_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          request_id?: string | null
          target_display?: string | null
          target_id?: string | null
          target_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          request_id?: string | null
          target_display?: string | null
          target_id?: string | null
          target_type?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      super_admin_impersonation_sessions: {
        Row: {
          ended_at: string | null
          expires_at: string
          id: string
          last_used_at: string
          metadata: Json
          reason: string | null
          revocation_reason: string | null
          revoked_at: string | null
          started_at: string
          super_admin_user_id: string
          target_library_id: string | null
          target_user_id: string
          trusted_session_id: string
        }
        Insert: {
          ended_at?: string | null
          expires_at: string
          id?: string
          last_used_at?: string
          metadata?: Json
          reason?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          started_at?: string
          super_admin_user_id: string
          target_library_id?: string | null
          target_user_id: string
          trusted_session_id: string
        }
        Update: {
          ended_at?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string
          metadata?: Json
          reason?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          started_at?: string
          super_admin_user_id?: string
          target_library_id?: string | null
          target_user_id?: string
          trusted_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "super_admin_impersonation_sessions_target_library_id_fkey"
            columns: ["target_library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_admin_impersonation_sessions_trusted_session_id_fkey"
            columns: ["trusted_session_id"]
            isOneToOne: false
            referencedRelation: "auth_trusted_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_role_grants: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string | null
          grant_mode: string
          granted_by: string | null
          id: string
          metadata: Json
          reason: string | null
          restrictions: Json
          revoked_at: string | null
          revoked_by: string | null
          role: string
          scope_id: string | null
          scope_label: string | null
          scope_type: string
          starts_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at?: string | null
          grant_mode?: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          restrictions?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          role: string
          scope_id?: string | null
          scope_label?: string | null
          scope_type?: string
          starts_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string | null
          grant_mode?: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          restrictions?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          role?: string
          scope_id?: string | null
          scope_label?: string | null
          scope_type?: string
          starts_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          admin_replied_at: string | null
          admin_replied_by: string | null
          admin_reply: string | null
          created_at: string
          description: string | null
          id: string
          library_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_replied_at?: string | null
          admin_replied_by?: string | null
          admin_reply?: string | null
          created_at?: string
          description?: string | null
          id?: string
          library_id: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_replied_at?: string | null
          admin_replied_by?: string | null
          admin_reply?: string | null
          created_at?: string
          description?: string | null
          id?: string
          library_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slots: {
        Row: {
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          library_id: string
          max_seats: number | null
          name: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          library_id: string
          max_seats?: number | null
          name: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          library_id?: string
          max_seats?: number | null
          name?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_referrals: {
        Row: {
          created_at: string
          referral_code: string
          referred_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          referral_code: string
          referred_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          referral_code?: string
          referred_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          library_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          library_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          library_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiting_list: {
        Row: {
          aadhaar_photo_path: string | null
          confirmation_deadline: string | null
          confirmed_at: string | null
          created_at: string
          email: string | null
          gender: Database["public"]["Enums"]["student_gender"] | null
          id: string
          library_id: string
          notes: string | null
          notified_at: string | null
          phone: string | null
          position: number
          preferred_plan: string | null
          preferred_slot: string | null
          status: string
          student_name: string
          updated_at: string
        }
        Insert: {
          aadhaar_photo_path?: string | null
          confirmation_deadline?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string | null
          gender?: Database["public"]["Enums"]["student_gender"] | null
          id?: string
          library_id: string
          notes?: string | null
          notified_at?: string | null
          phone?: string | null
          position: number
          preferred_plan?: string | null
          preferred_slot?: string | null
          status?: string
          student_name: string
          updated_at?: string
        }
        Update: {
          aadhaar_photo_path?: string | null
          confirmation_deadline?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string | null
          gender?: Database["public"]["Enums"]["student_gender"] | null
          id?: string
          library_id?: string
          notes?: string | null
          notified_at?: string | null
          phone?: string | null
          position?: number
          preferred_plan?: string | null
          preferred_slot?: string | null
          status?: string
          student_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiting_list_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_affiliate_dashboard: {
        Row: {
          affiliate_id: string | null
          city: string | null
          code: string | null
          commission_rate: number | null
          created_at: string | null
          email: string | null
          is_active: boolean | null
          name: string | null
          pending_payouts: number | null
          phone: string | null
          total_earnings: number | null
          total_referrals: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      admin_city_analytics: {
        Row: {
          city: string | null
          libraries: number | null
          state: string | null
        }
        Relationships: []
      }
      admin_coupon_dashboard: {
        Row: {
          code: string | null
          created_at: string | null
          discount_type: string | null
          discount_value: number | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          max_uses: number | null
          updated_at: string | null
          uses_captured: number | null
          uses_reserved: number | null
        }
        Relationships: []
      }
      admin_district_analytics: {
        Row: {
          district: string | null
          libraries: number | null
          state: string | null
        }
        Relationships: []
      }
      admin_platform_coverage: {
        Row: {
          active_cities: number | null
          active_districts: number | null
          india_market_penetration_percent: number | null
          states_covered: number | null
          total_libraries: number | null
        }
        Relationships: []
      }
      admin_state_analytics: {
        Row: {
          libraries: number | null
          state: string | null
        }
        Relationships: []
      }
      attendance: {
        Row: {
          check_in: string | null
          check_out: string | null
          created_at: string | null
          date: string | null
          id: string | null
          library_id: string | null
          student_id: string | null
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          date?: string | null
          id?: string | null
          library_id?: string | null
          student_id?: string | null
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          date?: string | null
          id?: string | null
          library_id?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "recovery_queue"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "attendance_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          commission_amount: number | null
          created_at: string | null
          id: string | null
          library_id: string | null
          partner_id: string | null
          partner_uuid: string | null
          sale_amount: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["partner_uuid"]
            isOneToOne: false
            referencedRelation: "admin_affiliate_dashboard"
            referencedColumns: ["affiliate_id"]
          },
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["partner_uuid"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["partner_uuid"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_uuid"]
          },
          {
            foreignKeyName: "affiliate_commissions_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          city: string | null
          commission_rate: number | null
          created_at: string | null
          email: string | null
          id: string | null
          name: string | null
          partner_uuid: string | null
          phone: string | null
          total_commission: number | null
          total_sales: number | null
        }
        Insert: {
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          partner_uuid?: string | null
          phone?: string | null
          total_commission?: number | null
          total_sales?: number | null
        }
        Update: {
          city?: string | null
          commission_rate?: number | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          partner_uuid?: string | null
          phone?: string | null
          total_commission?: number | null
          total_sales?: number | null
        }
        Relationships: []
      }
      recovery_queue: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          due_date: string | null
          last_payment_date: string | null
          library_id: string | null
          overdue_days: number | null
          phone: string | null
          plan_name: string | null
          queue_status: string | null
          recovery_urgency_label: string | null
          seat_number: string | null
          slot_label: string | null
          student_id: string | null
          student_name: string | null
          successful_payment_count: number | null
          total_fees: number | null
        }
        Relationships: [
          {
            foreignKeyName: "students_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          ai_call_enabled: boolean | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          library_id: string | null
          payment_status: string | null
          plan: string | null
          plan_expiry_date: string | null
          plan_price: number | null
          plan_start_date: string | null
          plan_type: string | null
          price: number | null
          seat_limit: number | null
          started_at: string | null
          status: string | null
          trial_end_date: string | null
          trial_start_date: string | null
          updated_at: string | null
          whatsapp_enabled: boolean | null
        }
        Insert: {
          ai_call_enabled?: boolean | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          library_id?: string | null
          payment_status?: string | null
          plan?: string | null
          plan_expiry_date?: string | null
          plan_price?: never
          plan_start_date?: string | null
          plan_type?: string | null
          price?: never
          seat_limit?: number | null
          started_at?: string | null
          status?: string | null
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string | null
          whatsapp_enabled?: boolean | null
        }
        Update: {
          ai_call_enabled?: boolean | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          library_id?: string | null
          payment_status?: string | null
          plan?: string | null
          plan_expiry_date?: string | null
          plan_price?: never
          plan_start_date?: string | null
          plan_type?: string | null
          price?: never
          seat_limit?: number | null
          started_at?: string | null
          status?: string | null
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string | null
          whatsapp_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "library_subscriptions_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: true
            referencedRelation: "libraries"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admin_daily_metrics: {
        Row: {
          active_libraries: number | null
          active_students: number | null
          adjustment_revenue: number | null
          day: string | null
          new_libraries: number | null
          payment_revenue: number | null
          subscription_revenue: number | null
          total_revenue: number | null
        }
        Relationships: []
      }
      super_admin_event_groups: {
        Row: {
          event_type: string | null
          first_seen_at: string | null
          incident_key: string | null
          last_seen_at: string | null
          latest_message: string | null
          severity: string | null
          total_occurrences: number | null
          unresolved_count: number | null
        }
        Relationships: []
      }
      super_admin_revenue_by_city: {
        Row: {
          city: string | null
          libraries: number | null
          state: string | null
          total_revenue: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          is_phone_verified: boolean | null
          name: string | null
          phone: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_phone_verified?: boolean | null
          name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_phone_verified?: boolean | null
          name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_to_waiting_list:
        | {
            Args: {
              p_email?: string
              p_library_id: string
              p_phone?: string
              p_preferred_plan?: string
              p_preferred_slot?: string
              p_student_name: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_aadhaar_photo_path?: string
              p_email?: string
              p_library_id: string
              p_phone?: string
              p_preferred_plan?: string
              p_preferred_slot?: string
              p_student_name: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_aadhaar_photo_path?: string
              p_email?: string
              p_gender?: Database["public"]["Enums"]["student_gender"]
              p_library_id: string
              p_phone?: string
              p_preferred_plan?: string
              p_preferred_slot?: string
              p_student_name: string
            }
            Returns: Json
          }
      admin_approve_partner_payout: {
        Args: { p_payout_id: string }
        Returns: undefined
      }
      admin_mark_partner_payout_paid: {
        Args: { p_payout_id: string }
        Returns: undefined
      }
      assign_locker: {
        Args: {
          p_locker_id: string
          p_monthly_price?: number
          p_student_id: string
        }
        Returns: Json
      }
      can_access_library: {
        Args: { _library_id: string; _user_id: string }
        Returns: boolean
      }
      claim_id_card_delivery_jobs: {
        Args: {
          p_force?: boolean
          p_library_id?: string
          p_limit?: number
          p_student_ids?: string[]
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          last_delivery_channel: string | null
          last_error: string | null
          last_file_bucket: string | null
          last_file_path: string | null
          last_provider_message_id: string | null
          last_provider_name: string | null
          library_id: string
          max_attempts: number
          next_retry_at: string
          processing_started_at: string | null
          queued_at: string
          requested_format: string
          sent_at: string | null
          source: string
          status: string
          student_id: string
          triggered_by: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "id_card_delivery_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      confirm_waiting_list: { Args: { p_entry_id: string }; Returns: Json }
      derive_student_original_photo_path: {
        Args: { p_thumbnail_path: string }
        Returns: string
      }
      detect_no_shows: { Args: never; Returns: undefined }
      ensure_library_subscription: {
        Args: { p_actor_user_id?: string; p_library_id: string }
        Returns: {
          ai_call_enabled: boolean
          created_at: string
          expires_at: string | null
          features: Json
          id: string
          library_id: string
          lockers_limit: number | null
          payment_status: string
          plan_expiry_date: string | null
          plan_name: string
          plan_price: number | null
          plan_start_date: string | null
          plan_type: string
          price: number
          seats_limit: number
          started_at: string
          status: string
          trial_end_date: string | null
          trial_start_date: string | null
          updated_at: string
          whatsapp_enabled: boolean
        }
        SetofOptions: {
          from: "*"
          to: "library_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      extract_student_photo_path_from_url: {
        Args: { p_photo_url: string }
        Returns: string
      }
      extract_student_photo_version_from_url: {
        Args: { p_photo_url: string }
        Returns: number
      }
      find_super_admin_by_email: {
        Args: { candidate_email: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      format_compact_time: { Args: { p_time: string }; Returns: string }
      generate_affiliate_code: { Args: never; Returns: string }
      generate_library_access_key_value: { Args: never; Returns: string }
      generate_partner_code: { Args: never; Returns: string }
      generate_referral_code: { Args: never; Returns: string }
      get_attendance_runtime_diagnostics: {
        Args: { p_qr_code?: string; p_student_id?: string }
        Returns: Json
      }
      get_auth_runtime_status: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      get_billing_runtime_diagnostics: {
        Args: { p_library_id?: string }
        Returns: Json
      }
      get_library_public: {
        Args: { p_identifier: string }
        Returns: {
          about_text: string | null
          active_students: number
          address: string | null
          city: string | null
          country: string
          created_at: string
          cta_background_color: string | null
          cta_background_image_url: string | null
          cta_background_type: string
          cta_button_color: string | null
          cta_button_text_color: string | null
          cta_gradient_from: string | null
          cta_gradient_to: string | null
          cta_subtitle: string | null
          cta_subtitle_color: string | null
          cta_text_color: string | null
          cta_title: string | null
          cta_title_color: string | null
          custom_domain: string | null
          district: string | null
          enabled: boolean
          header_background_color: string | null
          header_background_type: string
          header_background_url: string | null
          header_overlay_opacity: number
          header_text_color: string | null
          hero_background_url: string | null
          hero_overlay_color: string | null
          hero_overlay_disabled: boolean
          hero_overlay_opacity: number
          hero_subtitle: string | null
          hero_subtitle_color: string | null
          hero_title: string | null
          hero_title_color: string | null
          id: string
          library_name: string | null
          logo_url: string | null
          max_lockers: number
          max_seats: number
          monthly_revenue: number
          name: string
          opening_hours: string | null
          owner_id: string
          owner_name: string | null
          phone: string | null
          primary_color: string | null
          section_heading_color: string | null
          slug: string | null
          state: string | null
          total_lockers: number
          total_seats: number
          updated_at: string
          upi_id: string | null
          whatsapp_number: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "libraries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_partner_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          city: string
          partner_code: string
          partner_name: string
          rank: number
          total_sales: number
        }[]
      }
      get_schema_entity_status: {
        Args: { p_entities: string[] }
        Returns: {
          entity_name: string
          exists_in_schema: boolean
          relation_name: string
        }[]
      }
      get_slot_availability: {
        Args: { p_library_id: string }
        Returns: {
          available_seats: number
          occupied_seats: number
          slot_id: string
          slot_name: string
          total_seats: number
        }[]
      }
      get_student_id_profile:
        | { Args: { p_qr_code: string }; Returns: Json }
        | {
            Args: {
              p_library_id?: string
              p_qr_code?: string
              p_student_id?: string
            }
            Returns: Json
          }
      get_student_photo_upload_diagnostics: {
        Args: {
          p_library_id?: string
          p_storage_path?: string
          p_student_id?: string
        }
        Returns: Json
      }
      get_student_renewal_context: {
        Args: { p_student_token: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_maintenance_mode_enabled: { Args: never; Returns: boolean }
      is_student_photo_final_storage_path: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      is_student_photo_temp_storage_path: {
        Args: { p_storage_path: string; p_user_id: string }
        Returns: boolean
      }
      issue_device_command: {
        Args: {
          p_command_type: string
          p_device_id: string
          p_library_id: string
          p_payload?: Json
        }
        Returns: {
          acknowledged_at: string | null
          command_type: string
          completed_at: string | null
          device_id: string
          error_message: string | null
          failed_at: string | null
          id: string
          library_id: string
          metadata: Json
          payload: Json
          requested_at: string
          requested_by: string | null
          requested_by_role: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "device_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_library_access_key: {
        Args: { p_library_id: string }
        Returns: string
      }
      library_locker_plan_limit: {
        Args: { p_library_id: string }
        Returns: number
      }
      library_seat_plan_limit: {
        Args: { p_library_id: string }
        Returns: number
      }
      locker_label_from_index: { Args: { p_index: number }; Returns: string }
      log_attendance_failure: {
        Args: {
          p_code: string
          p_message: string
          p_metadata?: Json
          p_route: string
          p_source?: string
        }
        Returns: undefined
      }
      log_student_photo_upload_failure: {
        Args: {
          p_error_message?: string
          p_final_photo_storage_path?: string
          p_final_photo_thumbnail_path?: string
          p_student_id: string
          p_temp_original_path?: string
          p_temp_thumbnail_path?: string
        }
        Returns: Json
      }
      normalize_lookup_text: { Args: { p_text: string }; Returns: string }
      normalize_seat_number: { Args: { p_text: string }; Returns: string }
      notification_category_for_event: {
        Args: { p_type: string }
        Returns: Database["public"]["Enums"]["notification_category"]
      }
      notify_library_users: {
        Args: {
          p_category?: Database["public"]["Enums"]["notification_category"]
          p_library_id: string
          p_message: string
          p_metadata?: Json
          p_student_id?: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      notify_next_in_queue: { Args: { p_library_id: string }; Returns: Json }
      notify_super_admins: {
        Args: {
          p_category?: Database["public"]["Enums"]["notification_category"]
          p_library_id: string
          p_message: string
          p_metadata?: Json
          p_student_id?: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      prepare_student_photo_upload: {
        Args: { p_student_id: string; p_temp_original_path: string }
        Returns: Json
      }
      process_attendance_scan: {
        Args: {
          p_device_id?: string
          p_entry_id?: string
          p_entry_timestamp?: string
          p_failure_route: string
          p_library_id?: string
          p_qr_code?: string
          p_student_id?: string
        }
        Returns: Json
      }
      get_monthly_attendance_analytics: {
        Args: { p_library_id: string; p_month?: string }
        Returns: {
          absent_days: number
          attendance_percent: number
          full_name: string
          last_check_in: string | null
          last_check_out: string | null
          membership_status: string | null
          present_days: number
          student_id: string
        }[]
      }
      process_library_subscription_renewals: { Args: never; Returns: Json }
      process_locker_renewals: { Args: never; Returns: Json }
      process_renewals: { Args: never; Returns: Json }
      process_subscription_payment_capture: {
        Args: {
          p_capture_source?: string
          p_correlation_id?: string
          p_razorpay_order_id: string
          p_razorpay_payment_id: string
          p_razorpay_signature?: string
          p_request_id?: string
          p_trace_id?: string
        }
        Returns: Json
      }
      process_waiting_list_timeouts: { Args: never; Returns: Json }
      pull_device_commands: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_library_access_key: string
          p_library_id: string
          p_limit?: number
        }
        Returns: {
          acknowledged_at: string | null
          command_type: string
          completed_at: string | null
          device_id: string
          error_message: string | null
          failed_at: string | null
          id: string
          library_id: string
          metadata: Json
          payload: Json
          requested_at: string
          requested_by: string | null
          requested_by_role: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "device_commands"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      qr_check_in:
        | { Args: { p_library_id: string; p_qr_code: string }; Returns: Json }
        | {
            Args: {
              p_entry_id?: string
              p_entry_timestamp?: string
              p_library_id: string
              p_qr_code: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_device_id?: string
              p_entry_id?: string
              p_entry_timestamp?: string
              p_library_id?: string
              p_qr_code?: string
              p_student_id?: string
            }
            Returns: Json
          }
      recalculate_affiliate_totals: {
        Args: { p_affiliate_id: string }
        Returns: undefined
      }
      record_device_command_status: {
        Args: {
          p_command_id: string
          p_device_id: string
          p_device_token: string
          p_error_message?: string
          p_library_access_key: string
          p_library_id: string
          p_metadata?: Json
          p_status: string
        }
        Returns: {
          acknowledged_at: string | null
          command_type: string
          completed_at: string | null
          device_id: string
          error_message: string | null
          failed_at: string | null
          id: string
          library_id: string
          metadata: Json
          payload: Json
          requested_at: string
          requested_by: string | null
          requested_by_role: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "device_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      regenerate_library_access_key: {
        Args: { p_library_id: string }
        Returns: Json
      }
      release_locker: { Args: { p_locker_id: string }; Returns: Json }
      renew_student: {
        Args: { p_amount?: number; p_months?: number; p_student_id: string }
        Returns: Json
      }
      request_partner_payout: {
        Args: { p_amount?: number; p_payout_method?: string }
        Returns: string
      }
      resolve_app_error_library_id: {
        Args: { p_metadata: Json }
        Returns: string
      }
      resolve_supabase_edge_function_url: {
        Args: { p_function_name: string }
        Returns: string
      }
      run_renewal_reminder_scan: {
        Args: { p_library_id?: string }
        Returns: Json
      }
      scan_attendance_entry:
        | { Args: { p_library_id: string; p_qr_code: string }; Returns: Json }
        | {
            Args: {
              p_entry_id?: string
              p_entry_timestamp?: string
              p_library_id: string
              p_qr_code: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_device_id?: string
              p_entry_id?: string
              p_entry_timestamp?: string
              p_library_id?: string
              p_qr_code?: string
              p_student_id?: string
            }
            Returns: Json
          }
      seat_label_from_index: {
        Args: { p_columns?: number; p_index: number }
        Returns: string
      }
      slot_lookup_matches: {
        Args: {
          p_end: string
          p_input: string
          p_name: string
          p_start: string
        }
        Returns: boolean
      }
      student_photo_storage_library_id: {
        Args: { p_storage_path: string }
        Returns: string
      }
      submit_renewal_payment: {
        Args: {
          p_amount: number
          p_payment_screenshot?: string
          p_student_token: string
        }
        Returns: Json
      }
      sync_library_lockers: {
        Args: {
          p_columns?: number
          p_library_id: string
          p_total_lockers: number
        }
        Returns: undefined
      }
      sync_library_seats: {
        Args: {
          p_columns?: number
          p_library_id: string
          p_total_seats: number
        }
        Returns: undefined
      }
      trigger_daily_renewal_reminder_scan: { Args: never; Returns: number }
      trigger_student_id_card_delivery_processing: {
        Args: never
        Returns: number
      }
      trigger_student_photo_cleanup: { Args: never; Returns: number }
      update_student_photo_url: {
        Args: {
          p_expected_photo_storage_path?: string
          p_expected_photo_thumbnail_path?: string
          p_final_photo_storage_path: string
          p_final_photo_thumbnail_path: string
          p_photo_url: string
          p_photo_version?: number
          p_student_id: string
          p_temp_original_path?: string
          p_temp_thumbnail_path?: string
        }
        Returns: Json
      }
      upsert_student_id_card_delivery_job: {
        Args: {
          p_available_at?: string
          p_requested_format?: string
          p_source?: string
          p_student_id: string
          p_triggered_by?: string
        }
        Returns: string
      }
      user_can_access_library: {
        Args: { _library_id: string; _user_id: string }
        Returns: boolean
      }
      validate_and_bind_scanner_device: {
        Args: { p_device_id?: string; p_library_access_key: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "library_owner"
        | "staff"
        | "student"
        | "partner"
      lead_status: "new" | "contacted" | "demo_done" | "converted" | "rejected"
      notification_category:
        | "payment"
        | "renewal"
        | "support"
        | "system"
        | "affiliate"
      notification_role: "admin" | "library"
      payout_status: "pending" | "approved" | "paid" | "rejected"
      student_gender: "male" | "female"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["super_admin", "library_owner", "staff", "student", "partner"],
      lead_status: ["new", "contacted", "demo_done", "converted", "rejected"],
      notification_category: [
        "payment",
        "renewal",
        "support",
        "system",
        "affiliate",
      ],
      notification_role: ["admin", "library"],
      payout_status: ["pending", "approved", "paid", "rejected"],
      student_gender: ["male", "female"],
    },
  },
} as const

