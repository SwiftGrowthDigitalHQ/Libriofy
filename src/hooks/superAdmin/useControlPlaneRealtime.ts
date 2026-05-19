import { useEffect, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED } from "@/lib/superAdmin/lightweightMode";

const CONTROL_PLANE_REALTIME_TABLES = [
  "attendance_logs",
  "libraries",
  "library_subscriptions",
  "library_control_overrides",
  "platform_account_controls",
  "platform_activity_logs",
  "platform_job_dead_letters",
  "platform_job_queue",
  "platform_metric_snapshots",
  "payments",
  "subscription_payments",
  "login_logs",
  "app_event_logs",
] as const;

export const useControlPlaneRealtime = ({
  enabled,
  queryKeys,
}: {
  enabled: boolean;
  queryKeys: QueryKey[];
}) => {
  const queryClient = useQueryClient();
  const subscriptionKey = queryKeys.map((key) => key.join("-")).join("|");
  const invalidateQueryKeys = useMemo(() => queryKeys, [subscriptionKey]);

  useEffect(() => {
    if (!enabled || SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED) {
      return;
    }

    let timeoutId: number | null = null;
    const scheduleRefresh = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        for (const queryKey of invalidateQueryKeys) {
          queryClient.invalidateQueries({ queryKey });
        }
      }, 600);
    };

    const channel = CONTROL_PLANE_REALTIME_TABLES.reduce(
      (currentChannel, table) =>
        currentChannel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh),
      supabase.channel(`super-admin-control-plane:${subscriptionKey}`),
    ).subscribe();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      supabase.removeChannel(channel);
    };
  }, [enabled, invalidateQueryKeys, queryClient, subscriptionKey]);
};
