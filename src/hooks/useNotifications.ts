import { useEffect } from "react";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";

export type NotificationCategory = Database["public"]["Enums"]["notification_category"];
export type NotificationRecipientRole = Database["public"]["Enums"]["notification_role"];
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationWithLibrary = NotificationRow & {
  libraries: { name: string | null } | null;
};

type NotificationFeedResult = {
  items: NotificationWithLibrary[];
  pageCount: number;
  totalCount: number;
};

type NotificationSummaryResult = {
  recent: NotificationWithLibrary[];
  unreadCount: number;
};

type UseNotificationsOptions = {
  category?: NotificationCategory | "all";
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
};

const NOTIFICATION_SELECT = "id, user_id, library_id, role, category, type, title, message, is_read, created_at, metadata, channel, delivery_status, sent_at, libraries(name)";

const invalidateNotificationQueries = (queryClient: QueryClient, userId?: string) => {
  if (!userId) return;
  queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
  queryClient.invalidateQueries({ queryKey: ["notification-summary", userId] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-overview"] });
};

export const useNotificationRealtime = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          invalidateNotificationQueries(queryClient, user.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);
};

export const useNotifications = ({
  category = "all",
  page = 1,
  pageSize = 10,
  unreadOnly = false,
}: UseNotificationsOptions = {}) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notifications", user?.id, category, page, pageSize, unreadOnly],
    queryFn: async (): Promise<NotificationFeedResult> => {
      if (!user?.id) {
        return { items: [], pageCount: 1, totalCount: 0 };
      }

      let query = supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT, { count: "exact" })
        .eq("user_id", user.id);

      if (category !== "all") {
        query = query.eq("category", category);
      }

      if (unreadOnly) {
        query = query.eq("is_read", false);
      }

      const from = (Math.max(page, 1) - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      const totalCount = count ?? 0;
      return {
        items: (data ?? []) as NotificationWithLibrary[],
        pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
        totalCount,
      };
    },
    enabled: !!user?.id,
  });
};

export const useNotificationSummary = (limit = 6) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notification-summary", user?.id, limit],
    queryFn: async (): Promise<NotificationSummaryResult> => {
      if (!user?.id) {
        return { recent: [], unreadCount: 0 };
      }

      const [recentResult, unreadResult] = await Promise.all([
        supabase
          .from("notifications")
          .select(NOTIFICATION_SELECT)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false),
      ]);

      if (recentResult.error) throw recentResult.error;
      if (unreadResult.error) throw unreadResult.error;

      return {
        recent: (recentResult.data ?? []) as NotificationWithLibrary[],
        unreadCount: unreadResult.count ?? 0,
      };
    },
    enabled: !!user?.id,
  });
};

export const useNotificationActions = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!user?.id) throw new Error("Not authenticated.");

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => invalidateNotificationQueries(queryClient, user?.id),
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated.");

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) throw error;
    },
    onSuccess: () => invalidateNotificationQueries(queryClient, user?.id),
  });

  return {
    markAllAsRead,
    markAsRead,
  };
};
