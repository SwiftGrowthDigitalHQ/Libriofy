import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SuperAdminLibraries from "@/pages/SuperAdminLibraries";

const mockUseLibraries = vi.fn();
const mockToast = vi.fn();
const mockStartImpersonation = vi.fn();

vi.mock("@/components/dashboard/SuperAdminLayout", () => ({
  default: ({ children }: { children: import("react").ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    startImpersonation: mockStartImpersonation,
  }),
}));

vi.mock("@/hooks/superAdmin", () => ({
  useLibraries: (...args: unknown[]) => mockUseLibraries(...args),
}));

const buildLibrariesResult = (overrides: Record<string, unknown> = {}) => ({
  libraries: [
    {
      activeStudents: 18,
      city: "Patna",
      controlReason: null,
      controlStatus: "active",
      controlUntilAt: null,
      enabled: true,
      id: "library-1",
      lastActivityAt: "2026-05-19T06:20:00.000Z",
      monthlyRevenue: 0,
      name: "PATNA LIBRARY's Library",
      ownerEmail: "owner@libriofy.com",
      ownerId: "owner-1",
      ownerName: "Patna Owner",
      paymentStatus: "pending",
      state: "Bihar",
      subscriptionStatus: "active",
      totalSeats: 30,
    },
  ],
  librariesPagination: { page: 1, pageCount: 1, pageSize: 10, totalCount: 1 },
  librariesQuery: { error: null, isLoading: false },
  libraryAction: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
  recentActivity: [
    {
      activityType: "attendance_scan",
      actorUserId: null,
      createdAt: "2026-05-19T06:20:00.000Z",
      id: "activity-1",
      libraryId: "library-1",
      message: "PATNA LIBRARY's Library recorded an attendance scan.",
      metadata: {},
      userId: null,
    },
  ],
  summary: {
    activeImpersonationCount: 1,
    activeLibraryCount: 1,
    controlledLibraryCount: 2,
    controlledUserCount: 3,
    disabledLibraryCount: 1,
    forcedLogoutCount: 1,
    passwordResetCount: 1,
    pendingLibraryCount: 1,
    totalLibraryCount: 4,
    trialLibraryCount: 1,
    verificationRequiredCount: 0,
  },
  userAction: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
  users: [
    {
      activeImpersonationId: "imp-1",
      activeImpersonationStartedAt: "2026-05-19T06:10:00.000Z",
      clearSessionsAfter: "2026-05-19T06:05:00.000Z",
      controlReason: "Manual moderation",
      controlStatus: "suspended",
      controlUntilAt: null,
      email: "owner@libriofy.com",
      fullName: "Patna Owner",
      lastLoginAt: "2026-05-19T06:12:00.000Z",
      libraryId: "library-1",
      libraryName: "PATNA LIBRARY's Library",
      loginFailures24h: 2,
      passwordResetRequired: true,
      phone: null,
      primaryRole: "library_owner",
      roles: ["library_owner"],
      userId: "owner-1",
    },
  ],
  usersPagination: { page: 1, pageCount: 1, pageSize: 10, totalCount: 1 },
  usersQuery: { error: null, isLoading: false },
  ...overrides,
});

describe("super admin libraries page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders live operational summaries and revenue fallback data", () => {
    mockUseLibraries.mockReturnValue(buildLibrariesResult());

    render(<SuperAdminLibraries />);

    expect(screen.getByText("4 onboarded libraries are visible to the control plane.")).toBeInTheDocument();
    expect(screen.getByText("1 disabled, 1 pending, 1 trial.")).toBeInTheDocument();
    expect(screen.getByText("1 session resets, 1 password resets, 1 live impersonations.")).toBeInTheDocument();
    expect(screen.getByText("PATNA LIBRARY's Library")).toBeInTheDocument();
    expect(screen.getByText("Owner: Patna Owner")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("No billed revenue yet")).toBeInTheDocument();
  });

  it("uses human operational empty states instead of blank tables", () => {
    mockUseLibraries.mockReturnValue(
      buildLibrariesResult({
        libraries: [],
        librariesPagination: { page: 1, pageCount: 1, pageSize: 10, totalCount: 0 },
        recentActivity: [],
        summary: {
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
        },
        users: [],
        usersPagination: { page: 1, pageCount: 1, pageSize: 10, totalCount: 0 },
      }),
    );

    render(<SuperAdminLibraries />);

    expect(
      screen.getByText("No libraries have been onboarded yet. Libraries created through Libriofy onboarding will appear here automatically."),
    ).toBeInTheDocument();
  });

  it("surfaces library query failures instead of silently showing zeros", () => {
    mockUseLibraries.mockReturnValue(
      buildLibrariesResult({
        librariesQuery: {
          error: new Error("Admin request to /api/admin/libraries timed out after 20s."),
          isLoading: false,
        },
      }),
    );

    render(<SuperAdminLibraries />);

    expect(screen.getByText("Library telemetry is temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText("Admin request to /api/admin/libraries timed out after 20s.")).toBeInTheDocument();
  });
});
