import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ImpersonationBanner from "@/components/auth/ImpersonationBanner";

const mockUseAuth = vi.fn();
const mockAuditImpersonationActivity = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/authApi", () => ({
  auditImpersonationActivity: (...args: unknown[]) => mockAuditImpersonationActivity(...args),
}));

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    cleanup();
    mockUseAuth.mockReset();
    mockAuditImpersonationActivity.mockReset();
    mockAuditImpersonationActivity.mockResolvedValue({
      message: "ok",
      success: true,
    });
  });

  it("renders the active real/effective identities and stop control", async () => {
    const stopImpersonation = vi.fn().mockResolvedValue({});
    mockUseAuth.mockReturnValue({
      session: {
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
      },
      stopImpersonation,
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ImpersonationBanner />
      </MemoryRouter>,
    );

    expect(screen.getByText("Impersonation active")).toBeInTheDocument();
    expect(screen.getByText("Super Admin is acting as Library Owner.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Impersonation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop Impersonation" }));

    await waitFor(() => {
      expect(stopImpersonation).toHaveBeenCalledTimes(1);
    });
    expect(mockAuditImpersonationActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "route_view",
        requestPath: "/dashboard",
        requestSource: "browser_route_transition",
      }),
    );
  });

  it("does not render when impersonation is inactive", () => {
    mockUseAuth.mockReturnValue({
      session: {
        impersonation: null,
      },
      stopImpersonation: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ImpersonationBanner />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Impersonation active")).not.toBeInTheDocument();
  });
});
