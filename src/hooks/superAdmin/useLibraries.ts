import type {
  AdminLibrariesListResponse,
  AdminLibrariesWorkflowMutation,
  AdminListQuery,
  AdminUserControlRow,
  AdminUsersListResponse,
  AdminUserWorkflowMutation,
} from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
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
  query,
  userQuery,
}: {
  enabled?: boolean;
  query?: AdminListQuery;
  userQuery?: AdminListQuery;
} = {}) => {
  const librariesQuery = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getLibraries(query),
    queryKey: ["admin-libraries", query ?? {}],
    staleTime: 20_000,
  });

  const usersQuery = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getUsers(userQuery),
    queryKey: ["admin-users", userQuery ?? {}],
    staleTime: 20_000,
  });

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
    userAction,
    users: usersQuery.data?.users.items ?? [],
    usersPagination: usersQuery.data?.users.pagination,
    usersQuery,
  };
};
