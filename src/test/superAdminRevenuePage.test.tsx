import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SuperAdminRevenue from "@/pages/SuperAdminRevenue";

const mockUseControlPlane = vi.fn();
const mockUseRevenue = vi.fn();
const mockUseRevenueMutations = vi.fn();
const mockToast = vi.fn();

vi.mock("@/components/dashboard/RevenueChart", () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/dashboard/SuperAdminLayout", () => ({
  default: ({ children }: { children: import("react").ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/hooks/superAdmin", () => ({
  useControlPlane: (...args: unknown[]) => mockUseControlPlane(...args),
  useRevenue: (...args: unknown[]) => mockUseRevenue(...args),
  useRevenueMutations: (...args: unknown[]) => mockUseRevenueMutations(...args),
}));

const buildQueryState = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  error: null,
  isLoading: false,
  ...overrides,
});

describe("super admin revenue page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseControlPlane.mockReturnValue(buildQueryState());
    mockUseRevenueMutations.mockReturnValue({
      approveOrRejectPayout: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
      saveCommission: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
      saveRevenueAdjustment: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
    });
  });

  it("surfaces super admin auth failures instead of rendering zero revenue", () => {
    const authError = Object.assign(new Error("Super admin verification is required."), { status: 401 });

    mockUseRevenue.mockImplementation((options?: { query?: { scope?: string } }) =>
      options?.query?.scope ? buildQueryState() : buildQueryState({ error: authError }),
    );

    render(<SuperAdminRevenue />);

    expect(screen.getByText("Session expired. Please sign in again.")).toBeInTheDocument();
    expect(screen.getByText("Admin APIs require an active super admin session.")).toBeInTheDocument();
    expect(screen.queryByText("Total Revenue")).not.toBeInTheDocument();
  });
});
