import { describe, expect, it } from "vitest";

import {
  buildSubscriptionPaymentIdempotencyKey,
  findReusableSubscriptionPayment,
  mergePaymentTraceMetadata,
} from "../../supabase/functions/_shared/payment-runtime";

describe("subscription payment runtime helpers", () => {
  it("builds stable idempotency keys for identical billing inputs", () => {
    const first = buildSubscriptionPaymentIdempotencyKey({
      couponCode: "SAVE10",
      currentPlanCode: "starter",
      libraryId: "lib-1",
      months: 3,
      planCode: "growth",
    });
    const second = buildSubscriptionPaymentIdempotencyKey({
      couponCode: "SAVE10",
      currentPlanCode: "starter",
      libraryId: "lib-1",
      months: 3,
      planCode: "growth",
    });

    expect(first).toBe(second);
  });

  it("holds idempotency steady across a renewal spike of duplicate billing requests", async () => {
    const requests = await Promise.all(
      Array.from({ length: 250 }, () =>
        Promise.resolve(
          buildSubscriptionPaymentIdempotencyKey({
            couponCode: "SAVE10",
            currentPlanCode: "starter",
            libraryId: "lib-1",
            months: 3,
            planCode: "growth",
          }),
        ),
      ),
    );

    expect(new Set(requests)).toEqual(new Set(["lib-1:growth:3:SAVE10:starter"]));
  });

  it("reuses a recent pending payment with the same idempotency key", () => {
    const reusable = findReusableSubscriptionPayment(
      [
        {
          amount: 1499,
          created_at: "2026-05-07T10:00:00.000Z",
          currency: "INR",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_live_123",
          status: "pending",
        },
      ],
      "lib-1:growth:3:SAVE10:starter",
      Date.parse("2026-05-07T10:20:00.000Z"),
    );

    expect(reusable?.razorpay_order_id).toBe("order_live_123");
  });

  it("reuses the newest valid pending payment during duplicate webhook-style retries", () => {
    const reusable = findReusableSubscriptionPayment(
      [
        {
          created_at: "2026-05-07T10:03:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_newest",
          status: "pending",
        },
        {
          created_at: "2026-05-07T10:01:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_oldest",
          status: "pending",
        },
        {
          created_at: "2026-05-07T10:02:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_middle",
          status: "pending",
        },
      ],
      "lib-1:growth:3:SAVE10:starter",
      Date.parse("2026-05-07T10:20:00.000Z"),
    );

    expect(reusable?.razorpay_order_id).toBe("order_newest");
  });

  it("ignores stale or non-pending reusable payments", () => {
    const reusable = findReusableSubscriptionPayment(
      [
        {
          created_at: "2026-05-07T08:00:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_stale",
          status: "pending",
        },
        {
          created_at: "2026-05-07T10:10:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "order_captured",
          status: "paid",
        },
      ],
      "lib-1:growth:3:SAVE10:starter",
      Date.parse("2026-05-07T10:40:00.000Z"),
    );

    expect(reusable).toBeNull();
  });

  it("ignores partial failure rows that timed out before an order id was stored", () => {
    const reusable = findReusableSubscriptionPayment(
      [
        {
          created_at: "2026-05-07T10:11:00.000Z",
          idempotency_key: "lib-1:growth:3:SAVE10:starter",
          razorpay_order_id: "",
          status: "pending",
        },
        {
          created_at: "2026-05-07T10:12:00.000Z",
          metadata: {
            idempotency_key: "lib-1:growth:3:SAVE10:starter",
          },
          razorpay_order_id: "order_recovered",
          status: "pending",
        },
      ],
      "lib-1:growth:3:SAVE10:starter",
      Date.parse("2026-05-07T10:20:00.000Z"),
    );

    expect(reusable?.razorpay_order_id).toBe("order_recovered");
  });

  it("merges trace fields into payment metadata", () => {
    expect(
      mergePaymentTraceMetadata(
        { source: "create_payment_edge" },
        {
          correlationId: "corr-123",
          requestId: "req-123",
          traceId: "trace-123",
        },
      ),
    ).toMatchObject({
      correlation_id: "corr-123",
      request_id: "req-123",
      source: "create_payment_edge",
      trace_id: "trace-123",
    });
  });
});
