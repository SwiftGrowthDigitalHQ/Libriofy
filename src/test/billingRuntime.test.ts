import { describe, expect, it } from "vitest";

import {
  computeCouponDiscount,
  createSupabaseOperationError,
  resolveBillingCheckoutAvailability,
  resolveBillingProviderStatus,
  validateBillingRuntimeEnv,
} from "../../supabase/functions/_shared/billing-runtime";

describe("billing runtime helpers", () => {
  it("computes a predictable subscription quote discount for coupons", () => {
    const subtotal = 1499;
    const discount = computeCouponDiscount(subtotal, {
      discount_type: "percentage",
      discount_value: 20,
    });
    const total = Math.max(1, Math.floor(subtotal - discount));

    expect(discount).toBe(299);
    expect(total).toBe(1200);
  });

  it("reports missing live Razorpay provider secrets", () => {
    const result = validateBillingRuntimeEnv({
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_live_key",
      SUPABASE_URL: "https://libriofy-prod.supabase.co",
    }, {
      provider: "razorpay",
      requireWebhookSecret: true,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("RAZORPAY_KEY_ID");
    expect(result.missing).toContain("RAZORPAY_KEY_SECRET");
    expect(result.missing).toContain("RAZORPAY_WEBHOOK_SECRET");
  });

  it("rejects test-mode Razorpay provider keys", () => {
    const result = validateBillingRuntimeEnv({
      RAZORPAY_KEY_ID: "your_live_razorpay_key_id",
      RAZORPAY_KEY_SECRET: "secret",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_live_key",
      SUPABASE_URL: "https://libriofy-prod.supabase.co",
    }, {
      provider: "razorpay",
      requireWebhookSecret: false,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("RAZORPAY_KEY_ID");
  });

  it("tracks the active billing provider and its config status", () => {
    const status = resolveBillingProviderStatus({
      BILLING_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_live_key",
      RAZORPAY_KEY_SECRET: "secret",
      RAZORPAY_WEBHOOK_SECRET: "webhook",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_live_key",
      SUPABASE_URL: "https://libriofy-prod.supabase.co",
    });

    expect(status.activeProvider).toBe("razorpay");
    expect(status.providers.razorpay.configured).toBe(true);
    expect(status.providers.stripe.configured).toBe(false);
  });

  it("surfaces checkout availability for the active provider", () => {
    const availability = resolveBillingCheckoutAvailability({
      BILLING_PROVIDER: "razorpay",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_live_key",
      SUPABASE_URL: "https://libriofy-prod.supabase.co",
    });

    expect(availability.provider).toBe("razorpay");
    expect(availability.ready).toBe(false);
    expect(availability.message).toContain("Razorpay checkout is temporarily unavailable");
  });

  it("preserves the real Supabase error code and layer in structured billing failures", () => {
    const failure = createSupabaseOperationError({
      diagnostics: {
        libraryId: "lib-1",
      },
      error: {
        code: "42501",
        details: "new row violates row-level security policy",
        message: "permission denied for table subscription_payments",
      },
      layer: "db.subscription_payments.insert",
      message: "Failed to persist the new payment session in Supabase.",
      requestId: "req-123",
    });

    expect(failure.payload.code).toBe("42501");
    expect(failure.payload.layer).toBe("db.subscription_payments.insert");
    expect(failure.payload.requestId).toBe("req-123");
    expect(failure.payload.detail).toContain("permission denied");
  });
});
