import { describe, expect, it } from "vitest";

import { getEffectiveStudentStatus, isStudentCurrentlyActive, isStudentMembershipActiveOnDate } from "@/lib/studentMembership";

describe("student membership status helpers", () => {
  const referenceNow = new Date("2026-06-02T00:00:00.000Z");

  it("treats active students with past expiry dates as expired", () => {
    expect(
      getEffectiveStudentStatus(
        {
          expiry_date: "2026-05-26",
          status: "active",
        },
        referenceNow,
      ),
    ).toBe("expired");

    expect(
      isStudentCurrentlyActive(
        {
          expiry_date: "2026-05-26",
          status: "active",
        },
        referenceNow,
      ),
    ).toBe(false);
  });

  it("restores active status when a renewal extends expiry into the future", () => {
    expect(
      getEffectiveStudentStatus(
        {
          expiry_date: "2026-06-10",
          status: "expired",
        },
        referenceNow,
      ),
    ).toBe("active");

    expect(
      isStudentCurrentlyActive(
        {
          expiry_date: "2026-06-10",
          status: "expired",
        },
        referenceNow,
      ),
    ).toBe(true);
  });

  it("keeps inactive and waiting students out of the active pool", () => {
    expect(
      getEffectiveStudentStatus(
        {
          expiry_date: "2026-06-10",
          status: "inactive",
        },
        referenceNow,
      ),
    ).toBe("inactive");

    expect(
      isStudentCurrentlyActive(
        {
          expiry_date: "2026-06-10",
          status: "waiting",
        },
        referenceNow,
      ),
    ).toBe(false);
  });

  it("evaluates historical activity against a specific date", () => {
    expect(
      isStudentMembershipActiveOnDate(
        {
          expiry_date: "2026-06-10",
          status: "active",
        },
        new Date("2026-06-05T00:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      isStudentMembershipActiveOnDate(
        {
          expiry_date: "2026-06-01",
          status: "active",
        },
        new Date("2026-06-05T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
