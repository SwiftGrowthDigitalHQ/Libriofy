import { describe, expect, it } from "vitest";

import { recoverSuperAdminUserFromBootstrapSources } from "@/lib/otpAuth.server";

type MockStore = {
  authUsers: Array<{ email?: string | null; id: string }>;
  profiles: Array<{ email: string | null; full_name: string | null; phone_number: string | null; user_id: string }>;
  roleGrants: Array<{
    email: string | null;
    expires_at: string | null;
    grant_mode?: string | null;
    id: string;
    revoked_at: string | null;
    role: string | null;
    scope_label?: string | null;
    scope_type: string | null;
    user_id: string | null;
  }>;
  userRoles: Array<{ id?: string; library_id: string | null; role: string; user_id: string }>;
};

const buildMockServiceClient = (store: MockStore) => {
  const resolveTable = (table: string) => {
    switch (table) {
      case "profiles":
        return store.profiles;
      case "user_roles":
        return store.userRoles;
      case "super_admin_role_grants":
        return store.roleGrants;
      default:
        throw new Error(`Unsupported table ${table}`);
    }
  };

  const buildQuery = (table: string) => {
    const state: {
      filters: Array<(row: Record<string, unknown>) => boolean>;
      limit: number | null;
      mode: "select";
    } = {
      filters: [],
      limit: null,
      mode: "select",
    };

    const executeSelect = () => {
      let rows = [...resolveTable(table)] as Record<string, unknown>[];
      for (const filter of state.filters) {
        rows = rows.filter(filter);
      }
      if (typeof state.limit === "number") {
        rows = rows.slice(0, state.limit);
      }
      return rows;
    };

    return {
      select() {
        return this;
      },
      eq(field: string, value: unknown) {
        state.filters.push((row) => row[field] === value);
        return this;
      },
      ilike(field: string, value: string) {
        const normalized = String(value).trim().toLowerCase();
        state.filters.push((row) => String(row[field] ?? "").trim().toLowerCase() === normalized);
        return this;
      },
      is(field: string, value: unknown) {
        state.filters.push((row) => {
          const rowValue = row[field] ?? null;
          return value === null ? rowValue === null : rowValue === value;
        });
        return this;
      },
      limit(value: number) {
        state.limit = value;
        return this;
      },
      maybeSingle() {
        const rows = executeSelect();
        return Promise.resolve({
          data: rows[0] ?? null,
          error: null,
        });
      },
      insert(payload: Record<string, unknown>) {
        if (table === "user_roles") {
          store.userRoles.push({
            id: `role-${store.userRoles.length + 1}`,
            library_id: (payload.library_id as string | null) ?? null,
            role: String(payload.role),
            user_id: String(payload.user_id),
          });
        } else if (table === "super_admin_role_grants") {
          store.roleGrants.push({
            email: (payload.email as string | null) ?? null,
            expires_at: null,
            grant_mode: String(payload.grant_mode ?? "legacy_migrated"),
            id: `grant-${store.roleGrants.length + 1}`,
            revoked_at: null,
            role: String(payload.role),
            scope_label: String(payload.scope_label ?? "Bootstrap"),
            scope_type: String(payload.scope_type ?? "global"),
            user_id: (payload.user_id as string | null) ?? null,
          });
        } else {
          throw new Error(`Unsupported insert on ${table}`);
        }

        return Promise.resolve({
          data: payload,
          error: null,
        });
      },
      upsert(payload: Record<string, unknown>) {
        if (table !== "profiles") {
          throw new Error(`Unsupported upsert on ${table}`);
        }

        const userId = String(payload.user_id);
        const existing = store.profiles.find((row) => row.user_id === userId);
        if (existing) {
          existing.email = (payload.email as string | null) ?? existing.email;
          existing.full_name = (payload.full_name as string | null) ?? existing.full_name;
        } else {
          store.profiles.push({
            email: (payload.email as string | null) ?? null,
            full_name: (payload.full_name as string | null) ?? null,
            phone_number: null,
            user_id: userId,
          });
        }

        return Promise.resolve({
          data: payload,
          error: null,
        });
      },
      then(onFulfilled: (value: { data: Record<string, unknown>[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve({
          data: executeSelect(),
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };
  };

  return {
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: store.authUsers,
          },
          error: null,
        }),
      },
    },
    from: (table: string) => buildQuery(table),
  };
};

describe("super admin bootstrap recovery", () => {
  it("repairs the canonical hello@libriofy.com role mapping when the database seed row is missing", async () => {
    const store: MockStore = {
      authUsers: [{ email: "hello@libriofy.com", id: "user-1" }],
      profiles: [],
      roleGrants: [],
      userRoles: [],
    };

    const user = await recoverSuperAdminUserFromBootstrapSources(
      {} as Record<string, string | undefined>,
      "hello@libriofy.com",
      buildMockServiceClient(store) as never,
    );

    expect(user?.id).toBe("user-1");
    expect(user?.roles).toContain("super_admin");
    expect(store.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "hello@libriofy.com",
          user_id: "user-1",
        }),
      ]),
    );
    expect(store.userRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "super_admin",
          user_id: "user-1",
        }),
      ]),
    );
    expect(store.roleGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "hello@libriofy.com",
          role: "super_admin",
          user_id: "user-1",
        }),
      ]),
    );
  });

  it("recovers a granted super admin email by syncing the missing user_roles mapping", async () => {
    const store: MockStore = {
      authUsers: [],
      profiles: [
        {
          email: "ops@example.com",
          full_name: "Ops",
          phone_number: null,
          user_id: "user-2",
        },
      ],
      roleGrants: [
        {
          email: "ops@example.com",
          expires_at: null,
          id: "grant-1",
          revoked_at: null,
          role: "super_admin",
          scope_type: "global",
          user_id: "user-2",
        },
      ],
      userRoles: [],
    };

    const user = await recoverSuperAdminUserFromBootstrapSources(
      {} as Record<string, string | undefined>,
      "ops@example.com",
      buildMockServiceClient(store) as never,
    );

    expect(user?.id).toBe("user-2");
    expect(user?.roles).toContain("super_admin");
    expect(store.userRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "super_admin",
          user_id: "user-2",
        }),
      ]),
    );
  });

  it("does not authorize unrelated emails without a bootstrap identity or active super admin grant", async () => {
    const store: MockStore = {
      authUsers: [],
      profiles: [
        {
          email: "owner@example.com",
          full_name: "Owner",
          phone_number: null,
          user_id: "user-3",
        },
      ],
      roleGrants: [],
      userRoles: [],
    };

    const user = await recoverSuperAdminUserFromBootstrapSources(
      {} as Record<string, string | undefined>,
      "owner@example.com",
      buildMockServiceClient(store) as never,
    );

    expect(user).toBeNull();
    expect(store.userRoles).toHaveLength(0);
  });
});
