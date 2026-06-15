import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";

const mockUseAuth = vi.fn();
const mockUseCurrentLibraryId = vi.fn();
const mockGetStoredAccessToken = vi.fn();
const mockFrom = vi.fn();

const createBuilder = (result: { data: unknown; error: null }) => {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };

  return builder;
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/useCurrentLibraryId", () => ({
  useCurrentLibraryId: () => mockUseCurrentLibraryId(),
}));

vi.mock("@/lib/authSession", () => ({
  getStoredAccessToken: () => mockGetStoredAccessToken(),
}));

vi.mock("@/components/dashboard/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/dashboard/AttendanceLog", () => ({
  default: () => <div data-testid="attendance-log" />,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import AttendancePage from "@/pages/AttendancePage";

describe("AttendancePage monthly analytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");

    mockUseAuth.mockReturnValue({ user: { id: "user-1" } });
    mockUseCurrentLibraryId.mockReturnValue({ libraryId: "library-1", isLoading: false });
    mockGetStoredAccessToken.mockResolvedValue("access-token");

    mockFrom.mockImplementation((table: string) => {
      if (table === "students") {
        return createBuilder({
          data: [
            {
              full_name: "Alice Example",
              id: "student-1",
              status: "active",
            },
          ],
          error: null,
        });
      }

      if (table === "attendance_logs") {
        return createBuilder({
          data: [
            {
              check_in: "2026-06-02T08:00:00.000Z",
              check_out: "2026-06-02T11:00:00.000Z",
              date: "2026-06-02",
              student_id: "student-1",
            },
            {
              check_in: "2026-06-05T08:00:00.000Z",
              check_out: null,
              date: "2026-06-05",
              student_id: "student-1",
            },
          ],
          error: null,
        });
      }

      return createBuilder({ data: [], error: null });
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PGRST202",
          details:
            "Searched for the function public.get_monthly_attendance_analytics with parameters p_library_id, p_month or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
          hint: "Perhaps you meant to call the function public.scan_attendance_entry",
          message: "Could not find the function public.get_monthly_attendance_analytics(p_library_id, p_month) in the schema cache",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 404,
        },
      ),
    );
  });

  it("falls back to table reads when the RPC is missing from schema cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard/attendance"]}>
          <AttendancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Example")).toBeInTheDocument();
    });

    expect(screen.getByText("1 students")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/^\d+\.\d%$/)).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText(/Unable to load monthly attendance analytics/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("attendance-log")).toBeInTheDocument();

    const expectedMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const fetchMock = vi.mocked(globalThis.fetch);
    const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_monthly_attendance_analytics",
      expect.objectContaining({
        body: JSON.stringify({
          p_library_id: "library-1",
          p_month: expectedMonthStart,
        }),
        headers: expect.objectContaining({
          apikey: "test-anon-key",
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        }),
        method: "POST",
      }),
    );

    expect(fetchBody).toEqual({
      p_library_id: "library-1",
      p_month: expectedMonthStart,
    });
  });
});
