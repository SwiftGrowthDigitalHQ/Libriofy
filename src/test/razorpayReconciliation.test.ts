import { describe, expect, it } from "vitest";

import {
  evaluatePendingPaymentReconciliation,
  getCapturedPayment,
  selectPendingPaymentsForReconciliation,
} from "../../supabase/functions/_shared/razorpay-reconciliation";

describe("razorpay payment reconciliation helpers", () => {
  it("selects only pending payments older than five minutes", () => {
    const rows = selectPendingPaymentsForReconciliation(
      [
        {
          created_at: "2026-06-01T10:00:00.000Z",
          id: "payment-too-recent",
          library_id: "lib-1",
          razorpay_order_id: "order_recent",
          status: "pending",
          subscription_id: "sub-1",
        },
        {
          created_at: "2026-06-01T09:50:00.000Z",
          id: "payment-ready",
          library_id: "lib-1",
          razorpay_order_id: "order_ready",
          status: "pending",
          subscription_id: "sub-1",
        },
        {
          created_at: "2026-06-01T09:45:00.000Z",
          id: "payment-paid",
          library_id: "lib-1",
          razorpay_order_id: "order_paid",
          status: "paid",
          subscription_id: "sub-1",
        },
      ],
      Date.parse("2026-06-01T10:00:00.000Z"),
    );

    expect(rows.map((row) => row.id)).toEqual(["payment-ready"]);
  });

  it("chooses the newest captured Razorpay payment during recovery", () => {
    const capturedPayment = getCapturedPayment({
      items: [
        {
          created_at: 10,
          id: "pay_old",
          status: "captured",
        },
        {
          captured: true,
          created_at: 20,
          id: "pay_new",
          status: "authorized",
        },
      ],
    });

    expect(capturedPayment?.id).toBe("pay_new");
  });

  it("plans a capture recovery when Razorpay has already captured the order", () => {
    const decision = evaluatePendingPaymentReconciliation(
      {
        created_at: "2026-06-01T09:53:00.000Z",
        id: "payment-pending",
        library_id: "lib-1",
        razorpay_order_id: "order_recoverable",
        status: "pending",
        subscription_id: "sub-1",
      },
      {
        items: [
          {
            created_at: 20,
            id: "pay_recovered",
            status: "captured",
          },
        ],
      },
      Date.parse("2026-06-01T10:00:00.000Z"),
    );

    expect(decision).toMatchObject({
      action: "capture",
      stale: false,
    });
    if (decision.action === "capture") {
      expect(decision.capturedPayment.id).toBe("pay_recovered");
    }
  });

  it("marks long-running unpaid rows as stale alerts", () => {
    const decision = evaluatePendingPaymentReconciliation(
      {
        created_at: "2026-06-01T09:40:00.000Z",
        id: "payment-stale",
        library_id: "lib-1",
        razorpay_order_id: "order_stale",
        status: "pending",
        subscription_id: "sub-1",
      },
      {
        items: [],
      },
      Date.parse("2026-06-01T10:00:00.000Z"),
    );

    expect(decision).toMatchObject({
      action: "alert",
      stale: true,
    });
    if (decision.action === "alert") {
      expect(decision.ageMinutes).toBeGreaterThanOrEqual(10);
    }
  });
});
