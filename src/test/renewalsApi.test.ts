import { describe, expect, it, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { runRenewalReminderScan } from "@/api/renewals";

describe("renewals api", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("keeps the renewal worker invocation wired to the batch scan path", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
      },
      error: null,
    });

    await runRenewalReminderScan("library-123");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("process-renewals", {
      body: {
        includeLockerRenewalScan: false,
        includeRenewalScan: true,
        libraryId: "library-123",
        source: "renewals_page",
      },
    });
  });
});
