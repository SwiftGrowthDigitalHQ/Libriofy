import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

import { createAttendanceQueueEntry, submitAttendanceScanDetailed } from "@/lib/attendanceSync";
import { resolvePublicScanDenial } from "@/lib/scanDenial";

const navigatorProto = Object.getPrototypeOf(window.navigator);
const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigatorProto, "onLine");

describe("attendance scan normalization", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", {});
    Object.defineProperty(navigatorProto, "onLine", {
      configurable: true,
      get: () => true,
    });
  });

  afterEach(() => {
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigatorProto, "onLine", originalOnLineDescriptor);
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("maps duplicate scans to the duplicate denial contract", () => {
    const denial = resolvePublicScanDenial({ duplicate: true });

    expect(denial.code).toBe("DUPLICATE_SCAN");
    expect(denial.message).toBe("Duplicate Scan");
  });

  it("normalizes duplicate attendance success payloads", async () => {
    const entry = createAttendanceQueueEntry({
      deviceId: "LIB_GATE_01",
      studentId: "student-1",
      libraryId: "library-1",
      libraryAccessKey: "access-key-1",
      qrCode: "student-1",
      timestamp: "2026-06-02T08:15:00.000Z",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          status: "success",
          duplicate: true,
          action: "check-in",
          message: "Already scanned today",
          seat: "A-12",
          studentName: "Alice",
          time: "08:15",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    const result = await submitAttendanceScanDetailed({
      entry,
      scanApiUrl: "/api/attendance/scan",
    });

    expect(result.payload.status).toBe("success");
    if (result.payload.status === "success") {
      expect(result.payload.duplicate).toBe(true);
      expect(result.payload.studentName).toBe("Alice");
      expect(result.payload.seat).toBe("A-12");
    }
  });

  it("converts invalid QR responses into the public invalid QR denial", async () => {
    const entry = createAttendanceQueueEntry({
      deviceId: "LIB_GATE_01",
      studentId: "student-1",
      libraryId: "library-1",
      libraryAccessKey: "access-key-1",
      qrCode: "student-1",
      timestamp: "2026-06-02T08:15:00.000Z",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          status: "error",
          code: "INVALID_QR",
          message: "Invalid ID",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 400,
        },
      ),
    );

    const result = await submitAttendanceScanDetailed({
      entry,
      scanApiUrl: "/api/attendance/scan",
    });

    expect(result.payload.status).toBe("error");
    if (result.payload.status === "error") {
      expect(result.payload.code).toBe("INVALID_QR");
      expect(result.payload.message).toBe("Invalid QR");
    }
  });
});
