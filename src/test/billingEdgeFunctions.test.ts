import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invokeBillingEdgeFunction, readFunctionErrorMessage } from "../lib/billingEdgeFunctions";

describe("billing edge function invocation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PROJECT_ID", "hchflmrvmfvunedjhwta");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", originalFetch);
  });

  it("sends keepalive verification requests to the Supabase functions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeBillingEdgeFunction<{ success: boolean }>(
      "verify-razorpay-payment",
      {
        libraryId: "lib-1",
        razorpay_order_id: "order_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "sig_123",
      },
      {
        Authorization: "Bearer test-token",
        "x-request-id": "req-123",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/verify-razorpay-payment",
      expect.objectContaining({
        keepalive: true,
        method: "POST",
      }),
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      "x-request-id": "req-123",
    });
    expect(requestInit.body).toBe(
      JSON.stringify({
        libraryId: "lib-1",
        razorpay_order_id: "order_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "sig_123",
      }),
    );
    expect(result.data).toEqual({ success: true });
    expect(result.error).toBeNull();
  });

  it("returns the server response body when verification fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Payment order not found." }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeBillingEdgeFunction(
      "verify-razorpay-payment",
      {
        libraryId: "lib-1",
        razorpay_order_id: "order_404",
        razorpay_payment_id: "pay_404",
        razorpay_signature: "sig_404",
      },
      { Authorization: "Bearer test-token" },
    );

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toBe("Payment order not found.");
    expect(result.error?.context?.status).toBe(404);
  });

  it("surfaces a deployment hint when verify-payment is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeBillingEdgeFunction(
      "verify-razorpay-payment",
      {
        libraryId: "lib-1",
        razorpay_order_id: "order_missing",
        razorpay_payment_id: "pay_missing",
        razorpay_signature: "sig_missing",
      },
      { Authorization: "Bearer test-token" },
    );

    const message = await readFunctionErrorMessage(result.error as Parameters<typeof readFunctionErrorMessage>[0], "verify-razorpay-payment");

    expect(message).toContain("verify-razorpay-payment Edge Function");
    expect(message).toContain("not deployed or reachable");
  });

  it("surfaces a deployment hint when razorpay-webhook is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeBillingEdgeFunction(
      "razorpay-webhook",
      {
        event: "payment.captured",
      },
      undefined,
    );

    const message = await readFunctionErrorMessage(result.error as Parameters<typeof readFunctionErrorMessage>[0], "razorpay-webhook");

    expect(message).toContain("razorpay-webhook Edge Function");
    expect(message).toContain("not deployed or reachable");
  });
});
