import type {
  AdminBillingPaymentRow,
  AdminRuntimeGovernanceState,
  SuperAdminBillingCenterData,
} from "./types.js";

type BillingPaymentRow = Pick<
  AdminBillingPaymentRow,
  "duplicateDetected" | "reconciliationStatus" | "retryCount" | "status" | "verificationAttempts" | "webhookAttempts"
>;

type BillingOperationsInput = {
  paymentHistory: BillingPaymentRow[];
  runtimeGovernance: Pick<AdminRuntimeGovernanceState, "billingMutationsEnabled">;
};

export type BillingOperationsSnapshot = SuperAdminBillingCenterData["operations"];

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export const buildBillingOperationsSnapshot = ({
  paymentHistory,
  runtimeGovernance,
}: BillingOperationsInput): BillingOperationsSnapshot => {
  const pendingPayments = paymentHistory.filter((payment) => normalizeText(payment.status) === "pending").length;
  const failedPayments = paymentHistory.filter((payment) => normalizeText(payment.status) === "failed").length;
  const reconciledPayments = paymentHistory.filter((payment) => payment.reconciliationStatus === "reconciled").length;
  const webhookDeliveryFailures = paymentHistory.filter((payment) => payment.webhookAttempts > 0).length;

  return {
    billingMutationsEnabled: runtimeGovernance.billingMutationsEnabled,
    duplicatePayments: paymentHistory.filter((payment) => payment.duplicateDetected).length,
    failedPayments,
    manualReviewPayments: paymentHistory.filter((payment) => payment.reconciliationStatus === "manual_review").length,
    pendingPayments,
    paymentRetryRate:
      paymentHistory.length > 0
        ? Number(
            (
              (paymentHistory.filter((payment) => payment.retryCount > 0).length / paymentHistory.length) *
              100
            ).toFixed(2),
          )
        : 0,
    reconciledPayments,
    stuckPayments: paymentHistory.filter((payment) => payment.reconciliationStatus === "stuck").length,
    verificationRetries: paymentHistory.reduce((sum, payment) => sum + payment.verificationAttempts, 0),
    webhookDeliveryFailures,
    webhookRetries: paymentHistory.reduce((sum, payment) => sum + payment.webhookAttempts, 0),
  };
};

export const createEmptyBillingOperationsSnapshot = (
  billingMutationsEnabled: boolean,
): BillingOperationsSnapshot => ({
  billingMutationsEnabled,
  duplicatePayments: 0,
  failedPayments: 0,
  manualReviewPayments: 0,
  pendingPayments: 0,
  paymentRetryRate: 0,
  reconciledPayments: 0,
  stuckPayments: 0,
  verificationRetries: 0,
  webhookDeliveryFailures: 0,
  webhookRetries: 0,
});
