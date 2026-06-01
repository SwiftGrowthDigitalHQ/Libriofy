import { describe, expect, it } from "vitest";

import {
  buildBillingOperationsSnapshot,
  createEmptyBillingOperationsSnapshot,
} from "../lib/superAdmin/billingMetrics";

describe("billing metrics snapshot", () => {
  it("counts the new payment safety metrics alongside existing billing operations", () => {
    const snapshot = buildBillingOperationsSnapshot({
      paymentHistory: [
        {
          duplicateDetected: false,
          reconciliationStatus: "pending",
          retryCount: 0,
          status: "pending",
          verificationAttempts: 0,
          webhookAttempts: 0,
        },
        {
          duplicateDetected: true,
          reconciliationStatus: "reconciled",
          retryCount: 2,
          status: "paid",
          verificationAttempts: 1,
          webhookAttempts: 1,
        },
        {
          duplicateDetected: false,
          reconciliationStatus: "manual_review",
          retryCount: 1,
          status: "failed",
          verificationAttempts: 2,
          webhookAttempts: 0,
        },
        {
          duplicateDetected: false,
          reconciliationStatus: "stuck",
          retryCount: 3,
          status: "pending",
          verificationAttempts: 0,
          webhookAttempts: 2,
        },
      ],
      runtimeGovernance: {
        billingMutationsEnabled: true,
      },
    });

    expect(snapshot).toMatchObject({
      billingMutationsEnabled: true,
      duplicatePayments: 1,
      failedPayments: 1,
      manualReviewPayments: 1,
      pendingPayments: 2,
      reconciledPayments: 1,
      webhookDeliveryFailures: 2,
      webhookRetries: 3,
    });
    expect(snapshot.paymentRetryRate).toBe(75);
    expect(snapshot.verificationRetries).toBe(3);
  });

  it("creates an empty billing snapshot when the admin API is in fallback mode", () => {
    expect(createEmptyBillingOperationsSnapshot(false)).toMatchObject({
      billingMutationsEnabled: false,
      duplicatePayments: 0,
      failedPayments: 0,
      manualReviewPayments: 0,
      pendingPayments: 0,
      reconciledPayments: 0,
      webhookDeliveryFailures: 0,
      webhookRetries: 0,
    });
  });
});
