import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthRoute from "@/components/auth/AuthRoute";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

const mockUseAuth = vi.fn();
const mockUseUserRole = vi.fn();
const mockUseLibrarySubscription = vi.fn();
const mockEvaluateSubscriptionAccess = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/useUserRole", () => ({
  getRoleHomeRoute: (roles: Array<{ role: string }> | null | undefined) => {
    if (roles?.some((role) => role.role === "super_admin")) return "/super-admin-dashboard";
    if (roles?.some((role) => role.role === "partner")) return "/partner/dashboard";
    if (roles?.some((role) => role.role === "library_owner" || role.role === "staff")) return "/dashboard";
    return "/auth";
  },
  getRoleHomeRouteFromRoleNames: (roles: readonly string[] | null | undefined) => {
    if (roles?.includes("super_admin")) return "/super-admin-dashboard";
    if (roles?.includes("partner")) return "/partner/dashboard";
    if (roles?.some((role) => role === "library_owner" || role === "staff")) return "/dashboard";
    return "/auth";
  },
  isSupabaseUnauthorizedError: () => false,
  isUserRolesSchemaError: () => false,
  useUserRole: (...args: unknown[]) => mockUseUserRole(...args),
}));

vi.mock("@/hooks/useLibrarySubscription", () => ({
  evaluateSubscriptionAccess: (...args: unknown[]) => mockEvaluateSubscriptionAccess(...args),
  useLibrarySubscription: (...args: unknown[]) => mockUseLibrarySubscription(...args),
}));

const buildSession = (overrides?: Partial<ReturnType<typeof buildSession>>) => ({
  accessToken: "token",
  authLevel: 1,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  idleTimeoutSeconds: null,
  loginMethod: "email" as const,
  provider: "custom" as const,
  sessionScope: "general" as const,
  trustedDevice: false,
  user: {
    email: "admin@libriofy.test",
    fullName: "Control Plane Admin",
    id: "user-1",
    phone: null,
    roles: [] as string[],
  },
  ...overrides,
});

describe("super-admin route guards", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseUserRole.mockReset();
    mockUseLibrarySubscription.mockReset();
    mockEvaluateSubscriptionAccess.mockReset();

    mockUseLibrarySubscription.mockReturnValue({ data: null, isLoading: false });
    mockEvaluateSubscriptionAccess.mockReturnValue({ isAllowed: true });
  });

  it("keeps partner routes available to partners even when super_admin is also allowed", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      session: buildSession(),
      user: { email: "partner@libriofy.test", id: "partner-1" },
    });
    mockUseUserRole.mockReturnValue({
      data: [{ library_id: null, role: "partner" }],
      error: null,
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/partner/dashboard"]}>
        <Routes>
          <Route path="/super-admin-login" element={<div>Super admin login</div>} />
          <Route
            path="/partner/dashboard"
            element={(
              <ProtectedRoute allowRoles={["partner", "super_admin"]}>
                <div>Partner dashboard</div>
              </ProtectedRoute>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Partner dashboard")).toBeInTheDocument();
  });

  it("disables browser-side role and subscription fetches on super-admin dashboard routes", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      session: buildSession({
        authLevel: 2,
        sessionScope: "super_admin",
        user: {
          email: "super-admin@libriofy.test",
          fullName: "Super Admin",
          id: "super-admin-1",
          phone: null,
          roles: ["super_admin"],
        },
      }),
      user: { email: "super-admin@libriofy.test", id: "super-admin-1" },
    });
    mockUseUserRole.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/admin/incidents"]}>
        <Routes>
          <Route path="/super-admin-login" element={<div>Super admin login</div>} />
          <Route
            path="/admin/incidents"
            element={(
              <ProtectedRoute allowRoles={["super_admin"]}>
                <div>Incidents console</div>
              </ProtectedRoute>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Incidents console")).toBeInTheDocument();
    expect(mockUseUserRole).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseLibrarySubscription).toHaveBeenCalledWith(undefined, { enabled: false });
  });

  it("lets unverified super admins reach the OTP login flow without querying user_roles", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      session: buildSession({
        user: {
          email: "super-admin@libriofy.test",
          fullName: "Super Admin",
          id: "super-admin-1",
          phone: null,
          roles: ["super_admin"],
        },
      }),
      user: { email: "super-admin@libriofy.test", id: "super-admin-1" },
    });
    mockUseUserRole.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/super-admin-login"]}>
        <Routes>
          <Route
            path="/super-admin-login"
            element={(
              <AuthRoute>
                <div>Super Admin OTP</div>
              </AuthRoute>
            )}
          />
          <Route path="/super-admin-dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Super Admin OTP")).toBeInTheDocument();
    expect(mockUseUserRole).toHaveBeenCalledWith({ enabled: false });
  });

  it("keeps the impersonation banner flow on library routes while the control plane stays unavailable", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      session: buildSession({
        authLevel: 2,
        impersonation: {
          effectiveUser: {
            email: "owner@libriofy.test",
            fullName: "Library Owner",
            id: "owner-1",
            phone: null,
            roles: ["library_owner"],
          },
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          impersonationId: "imp-1",
          realUser: {
            email: "super-admin@libriofy.test",
            fullName: "Super Admin",
            id: "super-admin-1",
            phone: null,
            roles: ["super_admin"],
          },
          startedAt: new Date().toISOString(),
        },
        realUser: {
          email: "super-admin@libriofy.test",
          fullName: "Super Admin",
          id: "super-admin-1",
          phone: null,
          roles: ["super_admin"],
        },
        sessionScope: "impersonation",
        user: {
          email: "owner@libriofy.test",
          fullName: "Library Owner",
          id: "owner-1",
          phone: null,
          roles: ["library_owner"],
        },
      }),
      user: { email: "owner@libriofy.test", id: "owner-1" },
    });
    mockUseUserRole.mockReturnValue({
      data: [{ library_id: "library-1", role: "library_owner" }],
      error: null,
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={(
              <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                <div>Library dashboard</div>
              </ProtectedRoute>
            )}
          />
          <Route path="/super-admin-dashboard" element={<div>Control plane</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Library dashboard")).toBeInTheDocument();
  });
});
