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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      attendance_logs: {
        Row: {
          check_in: string
          check_out: string | null
          created_at: string
          date: string
          id: string
          library_id: string
          student_id: string
        }
        Insert: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          date?: string
          id?: string
          library_id: string
          student_id: string
        }
        Update: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          date?: string
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
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
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
      libraries: {
        Row: {
          active_students: number
          address: string | null
          city: string | null
          created_at: string
          custom_domain: string | null
          enabled: boolean
          id: string
          logo_url: string | null
          monthly_revenue: number
          name: string
          opening_hours: string | null
          owner_id: string
          primary_color: string | null
          slug: string | null
          total_seats: number
          upi_id: string | null
          updated_at: string
        }
        Insert: {
          active_students?: number
          address?: string | null
          city?: string | null
          created_at?: string
          custom_domain?: string | null
          enabled?: boolean
          id?: string
          logo_url?: string | null
          monthly_revenue?: number
          name: string
          opening_hours?: string | null
          owner_id: string
          primary_color?: string | null
          slug?: string | null
          total_seats?: number
          upi_id?: string | null
          updated_at?: string
        }
        Update: {
          active_students?: number
          address?: string | null
          city?: string | null
          created_at?: string
          custom_domain?: string | null
          enabled?: boolean
          id?: string
          logo_url?: string | null
          monthly_revenue?: number
          name?: string
          opening_hours?: string | null
          owner_id?: string
          primary_color?: string | null
          slug?: string | null
          total_seats?: number
          upi_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      library_subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          features: Json
          id: string
          library_id: string
          plan_name: string
          price: number
          seats_limit: number
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          features?: Json
          id?: string
          library_id: string
          plan_name?: string
          price?: number
          seats_limit?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          features?: Json
          id?: string
          library_id?: string
          plan_name?: string
          price?: number
          seats_limit?: number
          started_at?: string
          status?: string
          updated_at?: string
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
      notifications: {
        Row: {
          channel: string | null
          created_at: string
          delivery_status: string
          id: string
          library_id: string
          message: string | null
          metadata: Json
          provider_error: string | null
          provider_message_id: string | null
          provider_name: string | null
          read: boolean
          recipient_phone: string | null
          sent_at: string | null
          student_id: string | null
          title: string
          type: string
        }
        Insert: {
          channel?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          library_id: string
          message?: string | null
          metadata?: Json
          provider_error?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          read?: boolean
          recipient_phone?: string | null
          sent_at?: string | null
          student_id?: string | null
          title: string
          type: string
        }
        Update: {
          channel?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          library_id?: string
          message?: string | null
          metadata?: Json
          provider_error?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          read?: boolean
          recipient_phone?: string | null
          sent_at?: string | null
          student_id?: string | null
          title?: string
          type?: string
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
            referencedRelation: "students"
            referencedColumns: ["id"]
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
      students: {
        Row: {
          created_at: string
          email: string | null
          expiry_date: string | null
          full_name: string
          id: string
          last_check_in: string | null
          library_id: string
          no_show_days: number
          plan_id: string | null
          phone: string | null
          plan: string | null
          qr_code: string
          seat_id: string | null
          seat_number: string | null
          slot_id: string | null
          slot: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          expiry_date?: string | null
          full_name: string
          id?: string
          last_check_in?: string | null
          library_id: string
          no_show_days?: number
          plan_id?: string | null
          phone?: string | null
          plan?: string | null
          qr_code?: string
          seat_id?: string | null
          seat_number?: string | null
          slot_id?: string | null
          slot?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expiry_date?: string | null
          full_name?: string
          id?: string
          last_check_in?: string | null
          library_id?: string
          no_show_days?: number
          plan_id?: string | null
          phone?: string | null
          plan?: string | null
          qr_code?: string
          seat_id?: string | null
          seat_number?: string | null
          slot_id?: string | null
          slot?: string | null
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
      support_tickets: {
        Row: {
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
          confirmation_deadline: string | null
          confirmed_at: string | null
          created_at: string
          email: string | null
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
          confirmation_deadline?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string | null
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
          confirmation_deadline?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string | null
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
      [_ in never]: never
    }
    Functions: {
      add_to_waiting_list: {
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
      confirm_waiting_list: { Args: { p_entry_id: string }; Returns: Json }
      detect_no_shows: { Args: never; Returns: undefined }
      get_library_public: {
        Args: { p_identifier: string }
        Returns: {
          active_students: number
          address: string | null
          city: string | null
          created_at: string
          custom_domain: string | null
          enabled: boolean
          id: string
          logo_url: string | null
          monthly_revenue: number
          name: string
          opening_hours: string | null
          owner_id: string
          primary_color: string | null
          slug: string | null
          total_seats: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "libraries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_slot_availability: {
        Args: { p_library_id: string }
        Returns: {
          available_seats: number
          slot_name: string
        }[]
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
      notify_next_in_queue: { Args: { p_library_id: string }; Returns: Json }
      process_renewals: { Args: never; Returns: Json }
      process_waiting_list_timeouts: { Args: never; Returns: Json }
      qr_check_in: {
        Args: { p_library_id: string; p_qr_code: string }
        Returns: Json
      }
      renew_student: {
        Args: { p_amount?: number; p_months?: number; p_student_id: string }
        Returns: Json
      }
      submit_renewal_payment: {
        Args: {
          p_amount: number
          p_payment_screenshot?: string
          p_student_token: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "super_admin" | "library_owner" | "staff" | "student"
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
      app_role: ["super_admin", "library_owner", "staff", "student"],
    },
  },
} as const
