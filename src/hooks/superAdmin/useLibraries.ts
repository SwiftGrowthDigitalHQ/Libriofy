import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AdminLibrariesListResponse,
  AdminLibrariesWorkflowMutation,
  AdminListQuery,
  AdminUserControlRow,
  AdminUsersListResponse,
  AdminUserWorkflowMutation,
} from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import {
  SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED,
  SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
} from "@/lib/superAdmin/lightweightMode";
import type { AdminLibraryCenterSummary } from "@/lib/superAdmin/types";
import { supabase } from "@/integrations/supabase/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

const applyLibraryActionOptimistically = (
  current: AdminLibrariesListResponse,
  variables?: AdminLibrariesWorkflowMutation,
): AdminLibrariesListResponse => {
  if (!variables || !("libraryId" in variables) || !variables.libraryId) {
    return current;
  }

  return {
    ...current,
    libraries: {
      ...current.libraries,
      items: current.libraries.items.map((library) => {
        if (library.id !== variables.libraryId) {
          return library;
        }

        if (variables.action === "enable") {
          return {
            ...library,
            controlReason: null,
            controlStatus: "active",
            controlUntilAt: null,
            enabled: true,
          };
        }

        if (variables.action === "disable") {
          return {
            ...library,
            enabled: false,
          };
        }

        if (variables.action === "suspend" || variables.action === "ban") {
          return {
            ...library,
            controlReason: variables.note ?? library.controlReason,
            controlStatus: variables.action === "ban" ? "banned" : "suspended",
            controlUntilAt: variables.untilAt ?? null,
          };
        }

        if (variables.action === "clear_control") {
          return {
            ...library,
            controlReason: null,
            controlStatus: "active",
            controlUntilAt: null,
          };
        }

        return library;
      }),
    },
  };
};

const applyUserActionOptimistically = (
  current: AdminUsersListResponse,
  variables?: AdminUserWorkflowMutation,
): AdminUsersListResponse => {
  if (!variables?.userId) {
    return current;
  }

  return {
    ...current,
    users: {
      ...current.users,
      items: current.users.items.map((user) => {
        if (user.userId !== variables.userId) {
          return user;
        }

        if (variables.action === "clear_control" || variables.action === "clear_sessions") {
          return {
            ...user,
            controlReason: variables.note ?? null,
            controlStatus: "active",
            controlUntilAt: null,
          };
        }

        if (variables.action === "suspend" || variables.action === "ban") {
          return {
            ...user,
            controlReason: variables.note ?? user.controlReason,
            controlStatus: variables.action === "ban" ? "banned" : "suspended",
            controlUntilAt: variables.untilAt ?? null,
          };
        }

        return user;
      }),
    },
  };
};

export const useLibraries = ({
  enabled = true,
  enableUsers = true,
  query,
  userQuery,
}: {
  enabled?: boolean;
  enableUsers?: boolean;
  query?: AdminListQuery;
  userQuery?: AdminListQuery;
} = {}) => {
  const queryClient = useQueryClient();
  const librariesQuery = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getLibraries(query),
    queryKey: ["admin-libraries", query ?? {}],
    staleTime: SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  });

  const usersQuery = useAdminQuery({
    enabled: enabled && enableUsers,
    queryFn: () => adminClient.getUsers(userQuery),
    queryKey: ["admin-users", userQuery ?? {}],
    staleTime: SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  });

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
        queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
        if (enableUsers) {
          queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        }
      }, 600);
    };

    const channel = supabase
      .channel("super-admin-library-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "libraries" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "library_subscriptions" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "library_control_overrides" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_account_controls" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_activity_logs" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_logs" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "login_logs" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      supabase.removeChannel(channel);
    };
  }, [enableUsers, enabled, queryClient]);

  const libraryAction = useAdminMutation<Record<string, unknown>, AdminLibrariesWorkflowMutation, AdminLibrariesListResponse>({
    invalidateQueryKeys: [["admin-libraries"], ["admin-users"], ["admin-platform"], ["admin-security"]],
    mutationFn: adminClient.mutateLibrary,
    optimistic: {
      filters: { queryKey: ["admin-libraries"] },
      updater: (current, variables) =>
        applyLibraryActionOptimistically(current, variables as AdminLibrariesWorkflowMutation),
    },
  });

  const userAction = useAdminMutation<Record<string, unknown>, AdminUserWorkflowMutation, AdminUsersListResponse>({
    invalidateQueryKeys: [["admin-users"], ["admin-libraries"], ["admin-security"]],
    mutationFn: adminClient.mutateUser,
    optimistic: {
      filters: { queryKey: ["admin-users"] },
      updater: (current, variables) =>
        applyUserActionOptimistically(current, variables as AdminUserWorkflowMutation),
    },
  });

  const impersonate = useAdminMutation<Record<string, unknown>, Extract<AdminLibrariesWorkflowMutation, { action: "impersonate_admin" }>>({
    mutationFn: adminClient.mutateLibrary,
  });

  return {
    impersonate,
    libraries: librariesQuery.data?.libraries.items ?? [],
    librariesPagination: librariesQuery.data?.libraries.pagination,
    librariesQuery,
    libraryAction,
    recentActivity: librariesQuery.data?.recentActivity ?? [],
    summary:
      librariesQuery.data?.summary ??
      ({
        activeImpersonationCount: 0,
        activeLibraryCount: 0,
        controlledLibraryCount: 0,
        controlledUserCount: 0,
        disabledLibraryCount: 0,
        forcedLogoutCount: 0,
        passwordResetCount: 0,
        pendingLibraryCount: 0,
        totalLibraryCount: 0,
        trialLibraryCount: 0,
        verificationRequiredCount: 0,
      } satisfies AdminLibraryCenterSummary),
    userAction,
    users: usersQuery.data?.users.items ?? [],
    usersPagination: usersQuery.data?.users.pagination,
    usersQuery,
  };
};
